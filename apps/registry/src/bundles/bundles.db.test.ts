// Database suite for Standard bundles (Story 4.1): runs against a real
// PostgreSQL 18 named by REGISTRY_TEST_DATABASE_URL (an admin connection).
// Creates a throwaway database, migrates it as the admin (owner) and runs every
// data-access call as dh_registry_app (`-c role=dh_registry_app`). Exercises
// every I/O & Edge-Case Matrix row in spec-4-1.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { execFile } from "node:child_process";
import { createPublicKey, generateKeyPairSync, randomBytes, verify as cryptoVerify } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BUNDLE_API_PATHS,
  BUNDLE_FORMAT_VERSION,
  BUNDLE_TYPE,
  canonicalJson,
  DEFAULT_STALENESS_HOURS,
  GUIDANCE_ENDPOINT_PATH,
  isAcceptedDeviationRecord,
  isSignedStandardBundle,
  isStandardBundlePayload,
  standardBundleLatestPath,
} from "@domain-harness/contract";
import type {
  ApplicationInfo,
  ModuleInfo,
  ProjectInfo,
  SignedStandardBundle,
  StandardInfo,
  UuidV7,
} from "@domain-harness/contract";
import { createRegistryDb } from "../db/client.ts";
import type { RegistryDb } from "../db/client.ts";
import { migrate } from "../db/migrate.ts";
import { bundleRecords, bundleSettingChanges, tenantServiceCredentials } from "../db/schema.ts";
import { withTenant } from "../db/tenant-scope.ts";
import { createRegistryServer, MAX_BODY_BYTES } from "../http/server.ts";
import type { LogEvent } from "../http/server.ts";
import { createLockedRuleService } from "../locked-rules/service.ts";
import { MemoryTransport } from "../mail/memory.ts";
import { createModuleService } from "../modules/service.ts";
import { createProjectService } from "../projects/service.ts";
import { consumeSignInLink, createSignInService, requestSignInLinks } from "../sign-in/service.ts";
import { hashToken, mintToken } from "../sign-in/tokens.ts";
import { createStandardService, lockBundle } from "../standards/service.ts";
import { provisionCompany } from "../tenancy/provision.ts";
import { createBuildGrantService } from "../build-grants/service.ts";
import { createChildPermissionService } from "../child-permissions/service.ts";
import { createApplicationService } from "../applications/service.ts";
import { createBoilerplateService } from "../boilerplate/service.ts";
import { createCompilationsService } from "../compilations/service.ts";
import { createAcceptedDeviationsService } from "../accepted-deviations/service.ts";
import { createAcceptedDeviationAlertsService } from "../accepted-deviation-alerts/service.ts";
import { createGuidanceEndpointService } from "../guidance-endpoint/service.ts";
import { compileBundle } from "./compile.ts";
import { createBundleService } from "./service.ts";
import { bundleHash, ed25519SignerFromEnv } from "./sign.ts";
import type { Signer } from "./sign.ts";

const ENV = "REGISTRY_TEST_DATABASE_URL";
const adminUrl = process.env[ENV];
const inCi = process.env["CI"] !== undefined && process.env["CI"] !== "" && process.env["CI"] !== "false";
const APP_ROLE = "dh_registry_app";
const MIGRATION_SUITE_LOCK = 7_202_610_103;
const PANEL = { panelUrl: "http://panel.test" };
const REGISTRY_ROOT = resolve(import.meta.dirname, "../..");
const REPO_ROOT = resolve(REGISTRY_ROOT, "../..");
const run = promisify(execFile);

const KEY_FILE_EXTENSIONS = new Set([".pem", ".key", ".p8", ".pkcs8", ".p12", ".pfx", ".der"]);
const PRIVATE_KEY_MARKER = new RegExp(["-----BEGIN", "(?:[A-Z0-9 ]+ )?PRIVATE KEY(?: BLOCK)?-----"].join(" "));
const IGNORED_DIRS = new Set([".git", "node_modules", "dist", "build", ".next", ".turbo", "coverage"]);

async function findKeyFilesInTree(root: string): Promise<string[]> {
  const hits: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = extname(entry.name).toLowerCase();
      if (KEY_FILE_EXTENSIONS.has(ext)) {
        hits.push(fullPath);
        continue;
      }
      try {
        const content = await readFile(fullPath, "utf8");
        if (PRIVATE_KEY_MARKER.test(content)) {
          hits.push(fullPath);
        }
      } catch {
        // Ignore binary / unreadable files
      }
    }
  }
  await walk(root);
  return hits;
}

describe("repository private-key file scan tripwire", () => {
  // The tripwire walks every file of the repository; under the parallel test
  // pool's contention the walk alone can exceed the default 5 s timeout, so
  // give it room (the scan itself is the same, only the budget loosens).
  it(
    "passes when no private key file exists anywhere in the repository, and fails when one is staged",
    { timeout: 30_000 },
    async () => {
    expect(await findKeyFilesInTree(REPO_ROOT)).toEqual([]);

    const scratch = await mkdtemp(join(tmpdir(), "dh-key-scan-"));
    try {
      await writeFile(join(scratch, "innocent.txt"), "hello world\n");
      expect(await findKeyFilesInTree(scratch)).toEqual([]);

      for (const ext of [".pem", ".key", ".p8", ".pkcs8", ".p12", ".pfx", ".der"]) {
        const keyFile = join(scratch, `leaked${ext}`);
        await writeFile(keyFile, "not even a real key");
        expect(await findKeyFilesInTree(scratch)).toEqual([keyFile]);
        await rm(keyFile);
      }

      const inlineKey = join(scratch, "config.txt");
      await writeFile(inlineKey, ["prefix", ["-----BEGIN", "PRIVATE KEY-----"].join(" "), "MIIB..."].join("\n"));
      expect(await findKeyFilesInTree(scratch)).toEqual([inlineKey]);
      await rm(inlineKey);

      const pgpKey = join(scratch, "armored.asc");
      await writeFile(pgpKey, ["prefix", ["-----BEGIN", "PGP PRIVATE KEY BLOCK-----"].join(" "), "lQOY..."].join("\n"));
      expect(await findKeyFilesInTree(scratch)).toEqual([pgpKey]);
      await rm(pgpKey);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });
});

if (adminUrl === undefined || adminUrl === "") {
  if (inCi) {
    describe("Standard bundles database suite", () => {
      it(`requires ${ENV} when CI is set`, () => {
        expect.fail(`${ENV} is not set; CI must run the database suite against PostgreSQL 18`);
      });
    });
  } else {
    process.stderr.write(`bundles.db.test.ts skipped: ${ENV} is not set (see README, "Database")\n`);
  }
}

function withDatabase(url: string, database: string, role?: string): string {
  const next = new URL(url);
  next.pathname = `/${database}`;
  if (role !== undefined) next.searchParams.set("options", `-c role=${role}`);
  return next.toString();
}

describe.skipIf(adminUrl === undefined || adminUrl === "")("Standard bundles against PostgreSQL", () => {
  const database = `dh_registry_bundles_${randomBytes(6).toString("hex")}`;
  let admin: pg.Client;
  let owner: pg.Client;
  let appPool: pg.Pool;
  let db: RegistryDb;
  let server: Server;
  let base: string;
  let appUrl: string;

  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }) as string;
  const KEY_ID = "registry-key-2026-10";
  let signer: Signer;
  let failNextBuild = false;
  const loggedEvents: LogEvent[] = [];

  let tenantA: UuidV7;
  let rootA: UuidV7;
  let credentialA: string;
  let samIdA: UuidV7;
  let boIdA: UuidV7;

  let tenantB: UuidV7;
  let credentialB: string;

  const auth: Record<string, Record<string, string>> = {};

  async function sessionToken(email: string): Promise<string> {
    const inbox = new MemoryTransport();
    await requestSignInLinks(db, inbox, PANEL, email);
    const match = /\/sign-in\/verify\?token=(\S+)/.exec(inbox.messages[0]?.text ?? "");
    if (match?.[1] === undefined) throw new Error("no link");
    return (await consumeSignInLink(db, decodeURIComponent(match[1]))).sessionToken;
  }

  const get = (path: string, who: string) => fetch(`${base}${path}`, { headers: auth[who] ?? {} });

  const post = (path: string, who: string, body: unknown) =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(auth[who] ?? {}) },
      body: JSON.stringify(body),
    });

  const rawPost = (path: string, who: string, body: string, contentType = "application/json") =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": contentType, ...(auth[who] ?? {}) },
      body,
    });

  const pull = (tenantId: string, token?: string) =>
    fetch(`${base}${standardBundleLatestPath(tenantId)}`, {
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    });

  async function expectRefused(response: Response, status: number, code: string, subject?: string): Promise<void> {
    const body: unknown = await response.json();
    expect([response.status, body]).toMatchObject([status, subject === undefined ? { code } : { code, subject }]);
  }

  async function bundleCount(tenantId: UuidV7): Promise<number> {
    const { rows } = await owner.query<{ n: number }>(
      "select count(*)::int as n from bundle_records where tenant_id = $1",
      [tenantId],
    );
    return rows[0]?.n ?? 0;
  }

  async function settingCount(tenantId: UuidV7): Promise<number> {
    const { rows } = await owner.query<{ n: number }>(
      "select count(*)::int as n from bundle_setting_changes where tenant_id = $1",
      [tenantId],
    );
    return rows[0]?.n ?? 0;
  }

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`create database ${database}`);
    owner = new pg.Client({ connectionString: withDatabase(adminUrl ?? "", database) });
    await owner.connect();
    await admin.query("select pg_advisory_lock($1)", [MIGRATION_SUITE_LOCK]);
    try {
      await migrate(owner);
    } finally {
      await admin.query("select pg_advisory_unlock($1)", [MIGRATION_SUITE_LOCK]);
    }
    appUrl = withDatabase(adminUrl ?? "", database, APP_ROLE);
    appPool = new pg.Pool({ connectionString: appUrl, max: 8 });
    db = createRegistryDb(appPool);

    signer = ed25519SignerFromEnv({
      REGISTRY_BUNDLE_SIGNING_KEY: privateKeyPem,
      REGISTRY_BUNDLE_SIGNING_KEY_ID: KEY_ID,
    });

    const a = await provisionCompany(db, {
      company: "Acme",
      plan: "Enterprise",
      accounts: [
        { name: "Bea Buyer", email: "bea@acme.io", role: "Buyer" },
        { name: "Sam Owner", email: "sam@acme.io", role: "Standard owner" },
        { name: "Bo Builder", email: "bo@acme.io", role: "Builder" },
      ],
    });
    const b = await provisionCompany(db, {
      company: "Bolt",
      plan: "Enterprise",
      accounts: [
        { name: "Bob Buyer", email: "bob@bolt.io", role: "Buyer" },
        { name: "Ola Owner", email: "ola@bolt.io", role: "Standard owner" },
      ],
    });

    tenantA = a.tenantId;
    rootA = a.rootProjectId;
    credentialA = a.serviceCredential;
    const samAccount = a.accounts[1];
    const boAccount = a.accounts[2];
    if (samAccount === undefined || boAccount === undefined) throw new Error("missing accounts");
    samIdA = samAccount.id;
    boIdA = boAccount.id;

    tenantB = b.tenantId;
    credentialB = b.serviceCredential;

    const realBundles = createBundleService(db, signer);
    const wrappedBundles = {
      ...realBundles,
      buildAndSign: async (tid: UuidV7) => {
        if (failNextBuild) {
          failNextBuild = false;
          throw new Error("simulated signing hardware fault");
        }
        return realBundles.buildAndSign(tid);
      },
    };

    server = createRegistryServer(
      {
        signIn: createSignInService(db, new MemoryTransport(), PANEL),
        modules: createModuleService(db),
        standards: createStandardService(db),
        projects: createProjectService(db),
        lockedRules: createLockedRuleService(db),
        childPermissions: createChildPermissionService(db),
        buildGrants: createBuildGrantService(db),
        applications: createApplicationService(db),
        guidanceEndpoint: createGuidanceEndpointService(db),
        acceptedDeviations: createAcceptedDeviationsService(db),
        acceptedDeviationAlerts: createAcceptedDeviationAlertsService(db),
        boilerplate: createBoilerplateService(db),
        compilations: createCompilationsService(db),
        bundles: wrappedBundles,
      },
      (event) => {
        loggedEvents.push(event);
      },
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;

    for (const [who, email] of [
      ["buyer", "bea@acme.io"],
      ["sam", "sam@acme.io"],
      ["builder", "bo@acme.io"],
      ["bob", "bob@bolt.io"],
    ] as const) {
      auth[who] = { authorization: `Bearer ${await sessionToken(email)}` };
    }
  }, 60_000);

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await appPool.end();
    await owner.end();
    await admin.query(`drop database if exists ${database} with (force)`);
    await admin.end();
  }, 60_000);

  describe("migration 0012 (bundle_records, tenant_service_credentials, bundle_setting_changes)", () => {
    it("enables and forces RLS with tenant_isolation and grants SELECT and INSERT only to dh_registry_app", async () => {
      for (const table of ["bundle_records", "tenant_service_credentials", "bundle_setting_changes"]) {
        const { rows } = await owner.query<{ rls: boolean; forced: boolean; policies: string[] }>(
          `select c.relrowsecurity as rls, c.relforcerowsecurity as forced,
                  array(select p.polname::text from pg_policy p where p.polrelid = c.oid order by 1) as policies
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relname = $1`,
          [table],
        );
        expect(rows).toEqual([{ rls: true, forced: true, policies: ["tenant_isolation"] }]);
        const grants = await owner.query<{ privilege_type: string }>(
          `select privilege_type from information_schema.role_table_grants
           where grantee = $1 and table_name = $2 order by 1`,
          [APP_ROLE, table],
        );
        expect(grants.rows).toEqual([{ privilege_type: "INSERT" }, { privilege_type: "SELECT" }]);
      }
    });

    it("refuses UPDATE and DELETE for the app role on all three tables", async () => {
      for (const statement of [
        "update bundle_records set key_id = 'x'",
        "delete from bundle_records",
        "update tenant_service_credentials set token_hash = repeat('0', 64)",
        "delete from tenant_service_credentials",
        "update bundle_setting_changes set frozen = true",
        "delete from bundle_setting_changes",
      ]) {
        await expect(
          withTenant(db, tenantA, async (tx) => {
            await tx.execute(sql.raw(statement));
          }),
        ).rejects.toThrow();
      }
    });

    it("stores only the SHA-256 hex of the provisioned service credential, never the clear token", async () => {
      const { rows } = await owner.query<{ token_hash: string }>(
        "select token_hash from tenant_service_credentials where tenant_id = $1",
        [tenantA],
      );
      expect(rows).toEqual([{ token_hash: hashToken(credentialA) }]);
      const leaked = await owner.query(
        "select 1 from tenant_service_credentials where row_to_json(tenant_service_credentials)::text like $1",
        [`%${credentialA.slice(37)}%`],
      );
      expect(leaked.rowCount).toBe(0);
    });
  });

  describe("credential authentication and pull before any mutation", () => {
    it("answers 404 not_found when the tenant has no bundle yet (provisioning builds no bundle)", async () => {
      expect(await bundleCount(tenantA)).toBe(0);
      expect(await bundleCount(tenantB)).toBe(0);
      await expectRefused(await pull(tenantA, credentialA), 404, "not_found", "bundle");
      await expectRefused(await pull(tenantB, credentialB), 404, "not_found", "bundle");
    });

    it("answers 401 session_invalid for an absent, malformed or unknown credential", async () => {
      await expectRefused(await pull(tenantA), 401, "session_invalid", "session");
      await expectRefused(await pull(tenantA, "not-a-valid-token"), 401, "session_invalid", "session");
      await expectRefused(await pull(tenantA, mintToken(tenantA)), 401, "session_invalid", "session");
      // Swapping the tenant prefix on B's secret never matches anything.
      const crossed = `${tenantA}${credentialB.slice(36)}`;
      await expectRefused(await pull(tenantA, crossed), 401, "session_invalid", "session");
    });

    it("answers 403 role_denied when a valid credential addresses another tenant's bundle", async () => {
      await expectRefused(await pull(tenantA, credentialB), 403, "role_denied", "role");
      await expectRefused(await pull(tenantB, credentialA), 403, "role_denied", "role");
    });

    it("answers 405 method_not_allowed with Allow: GET for non-GET methods on the pull route", async () => {
      const res = await fetch(`${base}${standardBundleLatestPath(tenantA)}`, {
        method: "POST",
        headers: { authorization: `Bearer ${credentialA}`, "content-type": "application/json" },
        body: "{}",
      });
      expect(res.headers.get("allow")).toBe("GET");
      await expectRefused(res, 405, "method_not_allowed");
    });
  });

  describe("domain mutations build and sign monotonic bundles for the mutated tenant only", () => {
    let mod: ModuleInfo;
    let std: StandardInfo;
    let childProject: ProjectInfo;
    let subProject: ProjectInfo;
    let flowApp: ApplicationInfo;

    async function assertLatestBundle(expectedSequence: number): Promise<SignedStandardBundle> {
      expect(await bundleCount(tenantA)).toBe(expectedSequence);
      expect(await bundleCount(tenantB)).toBe(0);

      const res = await pull(tenantA, credentialA);
      expect(res.status).toBe(200);
      const signed: unknown = await res.json();
      expect(isSignedStandardBundle(signed)).toBe(true);
      if (!isSignedStandardBundle(signed)) throw new Error("invalid signed bundle");

      expect(signed.keyId).toBe(KEY_ID);
      expect(signed.payload.keyId).toBe(KEY_ID);
      expect(signed.payload.tenantId).toBe(tenantA);
      expect(signed.payload.sequence).toBe(expectedSequence);
      expect(signed.payload.format).toEqual({ type: BUNDLE_TYPE, version: BUNDLE_FORMAT_VERSION });

      // Verify Ed25519 signature over canonical payload bytes
      const verified = cryptoVerify(
        null,
        Buffer.from(canonicalJson(signed.payload), "utf8"),
        createPublicKey(publicKeyPem),
        Buffer.from(signed.signature, "base64"),
      );
      expect(verified).toBe(true);

      // Verify stored hash in bundle_records matches sha256(canonicalJson(signed))
      const expectedHash = bundleHash(signed);
      const { rows } = await owner.query<{ hash: string; sequence: number; key_id: string }>(
        "select hash, sequence, key_id from bundle_records where tenant_id = $1 and sequence = $2",
        [tenantA, expectedSequence],
      );
      expect(rows).toEqual([{ hash: expectedHash, sequence: expectedSequence, key_id: KEY_ID }]);

      return signed;
    }

    it("builds sequence 1..13 across every pinned domain-mutating POST route and leaves tenant B with no bundle", async () => {
      // 1. POST /v1/modules
      const r1 = await post("/v1/modules", "buyer", { kind: "code-stack", name: "Core Stack" });
      expect(r1.status).toBe(201);
      mod = (await r1.json()) as ModuleInfo;
      await assertLatestBundle(1);

      // 2. POST /v1/modules/{id}/owner
      const r2 = await post(`/v1/modules/${mod.id}/owner`, "buyer", { accountId: samIdA });
      expect(r2.status).toBe(200);
      await assertLatestBundle(2);

      // 3. POST /v1/modules/{id}/standards
      const r3 = await post(`/v1/modules/${mod.id}/standards`, "sam", {
        entry: {
          category: "library",
          name: "React",
          versionConstraint: "^18.0.0",
          status: "approved",
          correctionInstruction: null,
        },
      });
      expect(r3.status).toBe(201);
      std = (await r3.json()) as StandardInfo;
      await assertLatestBundle(3);

      // 4. POST /v1/standards/{id}/versions
      const r4 = await post(`/v1/standards/${std.id}/versions`, "sam", {
        entry: {
          category: "library",
          name: "React",
          versionConstraint: "^19.0.0",
          status: "required",
          correctionInstruction: "Upgrade to React 19.",
        },
      });
      expect(r4.status).toBe(201);
      std = (await r4.json()) as StandardInfo;
      await assertLatestBundle(4);

      // 5. POST /v1/standards/{id}/locked-rule
      const r5 = await post(`/v1/standards/${std.id}/locked-rule`, "buyer", { locked: true });
      expect(r5.status).toBe(200);
      await assertLatestBundle(5);

      // 6. POST /v1/projects
      const r6 = await post("/v1/projects", "buyer", {
        name: "Platform",
        levelName: "Division",
        parentId: rootA,
      });
      expect(r6.status).toBe(201);
      childProject = (await r6.json()) as ProjectInfo;
      await assertLatestBundle(6);

      // 7. POST /v1/projects/{id}/child-permissions
      const r7 = await post(`/v1/projects/${childProject.id}/child-permissions`, "buyer", {
        accountId: boIdA,
        granted: true,
      });
      expect(r7.status).toBe(200);
      await assertLatestBundle(7);

      // Create a second project to reparent
      const r6b = await post("/v1/projects", "builder", {
        name: "Checkout",
        levelName: "Service",
        parentId: childProject.id,
      });
      expect(r6b.status).toBe(201);
      subProject = (await r6b.json()) as ProjectInfo;
      await assertLatestBundle(8);

      // 8. POST /v1/projects/{id}/parent
      const r8 = await post(`/v1/projects/${subProject.id}/parent`, "buyer", {
        parentId: rootA,
      });
      expect(r8.status).toBe(200);
      await assertLatestBundle(9);

      // 9. POST /v1/projects/{id}/build-grants
      const r9 = await post(`/v1/projects/${childProject.id}/build-grants`, "buyer", {
        accountId: boIdA,
        granted: true,
      });
      expect(r9.status).toBe(200);
      await assertLatestBundle(10);

      // 10. POST /v1/applications
      const r10 = await post("/v1/applications", "builder", {
        description: "Checkout Web",
        projectId: childProject.id,
      });
      expect(r10.status).toBe(201);
      flowApp = (await r10.json()) as ApplicationInfo;
      await assertLatestBundle(11);

      // 11. POST /v1/applications/registered
      const r11 = await post("/v1/applications/registered", "buyer", {
        description: "Legacy Billing",
        projectId: subProject.id,
      });
      expect(r11.status).toBe(201);
      await assertLatestBundle(12);

      // 12. POST /v1/guidance-endpoint
      const r12 = await post(GUIDANCE_ENDPOINT_PATH, "buyer", {
        url: "https://guidance.acme.example/mcp",
      });
      expect(r12.status).toBe(200);
      const latest = await assertLatestBundle(13);

      // Verify full compiled contents of the latest bundle
      expect(latest.payload.stalenessHours).toBe(DEFAULT_STALENESS_HOURS);
      expect(latest.payload.frozen).toBe(false);
      // acceptedDeviations stays empty until the first acceptance is recorded (4.1's pinned default).
      expect(latest.payload.acceptedDeviations).toEqual([]);
      expect(latest.payload.standards).toEqual([std]);
      expect(latest.payload.tree.rootId).toBe(rootA);
      expect(latest.payload.tree.projects.map((p) => ({ id: p.id, parentId: p.parentId }))).toEqual([
        { id: rootA, parentId: null },
        { id: childProject.id, parentId: rootA },
        { id: subProject.id, parentId: rootA },
      ]);
      expect(latest.payload.tree.lockedRules).toHaveLength(1);
      expect(latest.payload.tree.lockedRules[0]?.standardId).toBe(std.id);
      expect(latest.payload.applications).toHaveLength(2);
      expect(latest.payload.applications.find((a) => a.id === flowApp.id)).toEqual({
        id: flowApp.id,
        projectId: childProject.id,
        fromFlow: true,
        agentTool: null,
      });
      expect(latest.payload.applications.find((a) => a.id !== flowApp.id)).toMatchObject({
        projectId: subProject.id,
        fromFlow: false,
        agentTool: null,
      });

      // 13. POST /v1/accepted-deviations (Community's pin: this tenant is Enterprise)
      const acceptance = {
        applicationId: flowApp.id,
        standardId: std.id,
        slot: { moduleKind: "code-stack", slotKind: "library", name: "React" },
        subject: "React",
        start: "2026-10-01T00:00:00.000Z",
        end: "2026-11-01T00:00:00.000Z",
        justification: "known exception",
        alertIntervalHours: 168,
      };
      const r13 = await post("/v1/accepted-deviations", "buyer", acceptance);
      expect(r13.status).toBe(201);
      const record: unknown = await r13.json();
      expect(isAcceptedDeviationRecord(record)).toBe(true);
      const withAcceptance = await assertLatestBundle(14);
      // The bundled list drops the stored extras (the Buyer, the justification,
      // the alert interval, the creation time) and keeps only the key, with the
      // registry-resolved Standard version.
      expect(withAcceptance.payload.acceptedDeviations).toEqual([
        {
          applicationId: flowApp.id,
          standardId: std.id,
          standardVersion: std.version,
          slot: { moduleKind: "code-stack", slotKind: "library", name: "React" },
          subject: "React",
          start: "2026-10-01T00:00:00.000Z",
          end: "2026-11-01T00:00:00.000Z",
        },
      ]);

      // Non-mutating routes (GETs, sign-in links, boilerplate generation) do NOT build a bundle
      expect((await get("/v1/modules", "buyer")).status).toBe(200);
      expect((await get("/v1/projects", "buyer")).status).toBe(200);
      expect((await get("/v1/applications", "buyer")).status).toBe(200);
      expect(
        (
          await post("/v1/sign-in-links", "buyer", {
            email: "bea@acme.io",
          })
        ).status,
      ).toBe(202);
      // Publish a language standard so boilerplate generation succeeds
      const langRes = await post(`/v1/modules/${mod.id}/standards`, "sam", {
        entry: {
          category: "language",
          name: "TypeScript",
          versionConstraint: "~5.6.0",
          status: "required",
          correctionInstruction: null,
        },
      });
      expect(langRes.status).toBe(201);
      expect(await bundleCount(tenantA)).toBe(15);

      const bpRes = await post(`/v1/applications/${flowApp.id}/boilerplate`, "buyer", {
        target: "claude-code",
      });
      expect(bpRes.status).toBe(200);
      // Boilerplate generation is not in the pinned mutating hook list
      expect(await bundleCount(tenantA)).toBe(15);

      // A fresh generation's tool appears only after the next bundle: the
      // next mutation builds bundle 16 carrying `claude-code` for the
      // generated app and `null` for the app without a generation.
      const r16 = await post("/v1/applications", "builder", {
        description: "Post-generation app",
        projectId: childProject.id,
      });
      expect(r16.status).toBe(201);
      const afterGeneration = await assertLatestBundle(16);
      expect(afterGeneration.payload.applications.find((a) => a.id === flowApp.id)).toEqual({
        id: flowApp.id,
        projectId: childProject.id,
        fromFlow: true,
        agentTool: "claude-code",
      });
      for (const entry of afterGeneration.payload.applications) {
        if (entry.id !== flowApp.id) expect(entry.agentTool).toBeNull();
      }

      // Tenant B still has no bundle and gets 404
      await expectRefused(await pull(tenantB, credentialB), 404, "not_found", "bundle");
    });

    it("produces byte-identical canonical serialization and identical hash when compiled twice from the same state", async () => {
      const fixedIssuedAt = "2026-10-13T12:00:00.000Z";
      const [first, second] = await withTenant(db, tenantA, async (tx) => {
        await lockBundle(tx, tenantA);
        const c1 = await compileBundle(tx, tenantA, 99, KEY_ID, fixedIssuedAt);
        const c2 = await compileBundle(tx, tenantA, 99, KEY_ID, fixedIssuedAt);
        return [c1.payload, c2.payload] as const;
      });
      expect(isStandardBundlePayload(first)).toBe(true);
      expect(canonicalJson(first)).toBe(canonicalJson(second));
      const s1: SignedStandardBundle = {
        payload: first,
        keyId: signer.keyId,
        signature: signer.sign(Buffer.from(canonicalJson(first), "utf8")),
      };
      const s2: SignedStandardBundle = {
        payload: second,
        keyId: signer.keyId,
        signature: signer.sign(Buffer.from(canonicalJson(second), "utf8")),
      };
      expect(bundleHash(s1)).toBe(bundleHash(s2));
    });
  });

  describe("staleness bound and freeze endpoints (Buyer-only, carried in next bundle)", () => {
    it("refuses a non-Buyer with 403 role_denied before the body is read, storing nothing", async () => {
      const before = await settingCount(tenantA);
      for (const path of [BUNDLE_API_PATHS.staleness, BUNDLE_API_PATHS.freeze]) {
        for (const who of ["sam", "builder"]) {
          for (const body of ["{not json", "x".repeat(MAX_BODY_BYTES * 2)]) {
            const response = await rawPost(path, who, body);
            await expectRefused(response, 403, "role_denied", "role");
          }
        }
      }
      expect(await settingCount(tenantA)).toBe(before);
    });

    it("validates stalenessHours (integer 1..720) and frozen (boolean), refusing invalid inputs with 400 invalid_input", async () => {
      const before = await settingCount(tenantA);
      for (const [body, subject] of [
        [[], "body"],
        [{}, "stalenessHours"],
        [{ stalenessHours: 0 }, "stalenessHours"],
        [{ stalenessHours: 721 }, "stalenessHours"],
        [{ stalenessHours: 12.5 }, "stalenessHours"],
        [{ stalenessHours: "24" }, "stalenessHours"],
        [{ stalenessHours: 24, extra: 1 }, "extra"],
      ] as const) {
        await expectRefused(await post(BUNDLE_API_PATHS.staleness, "buyer", body), 400, "invalid_input", subject);
      }

      for (const [body, subject] of [
        [[], "body"],
        [{}, "frozen"],
        [{ frozen: "true" }, "frozen"],
        [{ frozen: 1 }, "frozen"],
        [{ frozen: true, extra: 1 }, "extra"],
      ] as const) {
        await expectRefused(await post(BUNDLE_API_PATHS.freeze, "buyer", body), 400, "invalid_input", subject);
      }
      expect(await settingCount(tenantA)).toBe(before);
    });

    it("stores stalenessHours and frozen append-only without modifying the already-built bundle, and carries them in the next built bundle", async () => {
      const beforeCount = await bundleCount(tenantA);
      const beforePull = (await (await pull(tenantA, credentialA)).json()) as SignedStandardBundle;
      expect(beforePull.payload.stalenessHours).toBe(24);
      expect(beforePull.payload.frozen).toBe(false);

      const s1 = await post(BUNDLE_API_PATHS.staleness, "buyer", { stalenessHours: 1 });
      expect([s1.status, await s1.json()]).toEqual([200, { stalenessHours: 1 }]);

      // Re-posting the same stalenessHours is a no-op and inserts no duplicate row
      const s1Dup = await post(BUNDLE_API_PATHS.staleness, "buyer", { stalenessHours: 1 });
      expect([s1Dup.status, await s1Dup.json()]).toEqual([200, { stalenessHours: 1 }]);
      expect(await settingCount(tenantA)).toBe(1);

      const s2 = await post(BUNDLE_API_PATHS.staleness, "buyer", { stalenessHours: 720 });
      expect([s2.status, await s2.json()]).toEqual([200, { stalenessHours: 720 }]);

      const f1 = await post(BUNDLE_API_PATHS.freeze, "buyer", { frozen: true });
      expect([f1.status, await f1.json()]).toEqual([200, { frozen: true }]);

      // Re-posting the same frozen state is a no-op and inserts no duplicate row
      const f1Dup = await post(BUNDLE_API_PATHS.freeze, "buyer", { frozen: true });
      expect([f1Dup.status, await f1Dup.json()]).toEqual([200, { frozen: true }]);

      // Setting changes are append-only (3 rows) and do not retroactively alter the already-built bundle
      expect(await settingCount(tenantA)).toBe(3);
      expect(await bundleCount(tenantA)).toBe(beforeCount);
      const stillOld = (await (await pull(tenantA, credentialA)).json()) as SignedStandardBundle;
      expect(stillOld.payload.sequence).toBe(beforeCount);
      expect(stillOld.payload.stalenessHours).toBe(24);
      expect(stillOld.payload.frozen).toBe(false);

      // Next mutation builds a bundle carrying the latest stalenessHours (720) and frozen (true)
      const mut = await post("/v1/modules", "buyer", { kind: "design-system", name: "Design Tokens" });
      expect(mut.status).toBe(201);

      const nextPull = (await (await pull(tenantA, credentialA)).json()) as SignedStandardBundle;
      expect(nextPull.payload.sequence).toBe(beforeCount + 1);
      expect(nextPull.payload.stalenessHours).toBe(720);
      expect(nextPull.payload.frozen).toBe(true);

      // Unfreeze and verify next bundle carries frozen: false while keeping stalenessHours: 720
      const f2 = await post(BUNDLE_API_PATHS.freeze, "buyer", { frozen: false });
      expect([f2.status, await f2.json()]).toEqual([200, { frozen: false }]);
      expect(await settingCount(tenantA)).toBe(4);

      const mut2 = await post("/v1/projects", "buyer", {
        name: "Mobile",
        levelName: "Division",
        parentId: rootA,
      });
      expect(mut2.status).toBe(201);

      const unfrozenPull = (await (await pull(tenantA, credentialA)).json()) as SignedStandardBundle;
      expect(unfrozenPull.payload.sequence).toBe(beforeCount + 2);
      expect(unfrozenPull.payload.stalenessHours).toBe(720);
      expect(unfrozenPull.payload.frozen).toBe(false);
    });
  });

  describe("failure handling and core validation", () => {
    it("answers 500 bundle_build_failed and logs one diagnostic event when bundle building fails after a mutation, while keeping the mutation committed", async () => {
      const beforeBundles = await bundleCount(tenantA);
      loggedEvents.length = 0;
      failNextBuild = true;

      const response = await post("/v1/modules", "buyer", {
        kind: "code-stack",
        name: "Survived Mutation Module",
      });
      await expectRefused(response, 500, "bundle_build_failed", "bundle");
      expect(loggedEvents).toContainEqual({
        event: "bundle_build_failed",
        tenantId: tenantA,
        code: "unexpected",
      });

      // No new bundle was written
      expect(await bundleCount(tenantA)).toBe(beforeBundles);

      // But the mutation itself stayed committed
      const listRes = await get("/v1/modules", "buyer");
      const list = (await listRes.json()) as { modules: ModuleInfo[] };
      expect(list.modules.some((m) => m.name === "Survived Mutation Module")).toBe(true);
    });

    it("rejects bad state in buildAndSign when whole-bundle core validation fails, writing no bundle and surfacing core's envelope", async () => {
      const beforeBundles = await bundleCount(tenantA);
      const x = "01928c7e-5b2a-7c3d-8e4f-0000000000aa";
      const y = "01928c7e-5b2a-7c3d-8e4f-0000000000bb";
      await owner.query("insert into projects (id, tenant_id, parent_id, name) values ($1, $2, $3, 'Cycle Y')", [
        y,
        tenantA,
        rootA,
      ]);
      await owner.query("insert into projects (id, tenant_id, parent_id, name) values ($1, $2, $3, 'Cycle X')", [
        x,
        tenantA,
        y,
      ]);
      await owner.query("update projects set parent_id = $1 where id = $2", [x, y]);
      try {
        const service = createBundleService(db, signer);
        await expect(service.buildAndSign(tenantA)).rejects.toMatchObject({
          code: "project_cycle",
          subject: y,
        });
        const httpRes = await post(GUIDANCE_ENDPOINT_PATH, "buyer", {
          url: "https://guidance-cycle-test.acme.example/mcp",
        });
        await expectRefused(httpRes, 409, "project_cycle", y);
        expect(await bundleCount(tenantA)).toBe(beforeBundles);
      } finally {
        await owner.query("delete from projects where id = any($1)", [[x, y]]);
      }
    });
  });

  describe("tenant isolation on bundle tables", () => {
    it("RLS returns only the context tenant's rows when the tenant filter is omitted", async () => {
      // Build one bundle and one setting row in tenant B
      expect((await post(BUNDLE_API_PATHS.staleness, "bob", { stalenessHours: 48 })).status).toBe(200);
      expect((await post("/v1/modules", "bob", { kind: "code-stack", name: "Bolt Stack" })).status).toBe(201);

      const seenA = await withTenant(db, tenantA, async (tx) => ({
        bundles: await tx.select().from(bundleRecords),
        settings: await tx.select().from(bundleSettingChanges),
        creds: await tx.select().from(tenantServiceCredentials),
      }));
      expect(seenA.bundles.length).toBeGreaterThan(0);
      expect(seenA.bundles.every((r) => r.tenantId === tenantA)).toBe(true);
      expect(seenA.settings.every((r) => r.tenantId === tenantA)).toBe(true);
      expect(seenA.creds.every((r) => r.tenantId === tenantA)).toBe(true);

      const seenB = await withTenant(db, tenantB, async (tx) => ({
        bundles: await tx.select().from(bundleRecords),
        settings: await tx.select().from(bundleSettingChanges),
        creds: await tx.select().from(tenantServiceCredentials),
      }));
      expect(seenB.bundles).toHaveLength(1);
      expect(seenB.bundles[0]?.tenantId).toBe(tenantB);
      expect(seenB.settings).toHaveLength(1);
      expect(seenB.creds).toHaveLength(1);
    });
  });

  describe("serve-cli signing key configuration", () => {
    async function runServe(env: Record<string, string | undefined>): Promise<{ code: number; stderr: string }> {
      try {
        const { stderr } = await run(
          process.execPath,
          ["--conditions=@domain-harness/source", "src/http/serve-cli.ts"],
          {
            cwd: REGISTRY_ROOT,
            timeout: 20_000,
            env: {
              PATH: process.env["PATH"],
              REGISTRY_DATABASE_URL: appUrl,
              REGISTRY_PANEL_URL: "http://panel.test",
              REGISTRY_MAIL_OUTBOX_DIR: join(tmpdir(), "dh-serve-bundles-outbox"),
              REGISTRY_HTTP_PORT: "0",
              ...env,
            },
          },
        );
        return { code: 0, stderr };
      } catch (error) {
        const failed = error as { code: number; stderr: string };
        return { code: failed.code, stderr: failed.stderr };
      }
    }

    it("exits 1 with one missing_configuration envelope when REGISTRY_BUNDLE_SIGNING_KEY or REGISTRY_BUNDLE_SIGNING_KEY_ID is absent", async () => {
      const noKey = await runServe({
        REGISTRY_BUNDLE_SIGNING_KEY: "",
        REGISTRY_BUNDLE_SIGNING_KEY_ID: KEY_ID,
      });
      expect(noKey.code).toBe(1);
      expect(JSON.parse(noKey.stderr.trim())).toMatchObject({
        code: "missing_configuration",
        subject: "REGISTRY_BUNDLE_SIGNING_KEY",
      });

      const noKeyId = await runServe({
        REGISTRY_BUNDLE_SIGNING_KEY: privateKeyPem,
        REGISTRY_BUNDLE_SIGNING_KEY_ID: "",
      });
      expect(noKeyId.code).toBe(1);
      expect(JSON.parse(noKeyId.stderr.trim())).toMatchObject({
        code: "missing_configuration",
        subject: "REGISTRY_BUNDLE_SIGNING_KEY_ID",
      });
    });

    it("throws an invalid_configuration EnvelopeError on a malformed PEM or non-Ed25519 key", () => {
      expect(() =>
        ed25519SignerFromEnv({
          REGISTRY_BUNDLE_SIGNING_KEY: "not-a-valid-pem",
          REGISTRY_BUNDLE_SIGNING_KEY_ID: KEY_ID,
        }),
      ).toThrow(
        expect.objectContaining({
          code: "invalid_configuration",
          subject: "REGISTRY_BUNDLE_SIGNING_KEY",
        }),
      );

      const { privateKey: rsaKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
      const rsaPem = rsaKey.export({ type: "pkcs8", format: "pem" }) as string;
      expect(() =>
        ed25519SignerFromEnv({
          REGISTRY_BUNDLE_SIGNING_KEY: rsaPem,
          REGISTRY_BUNDLE_SIGNING_KEY_ID: KEY_ID,
        }),
      ).toThrow(
        expect.objectContaining({
          code: "invalid_configuration",
          subject: "REGISTRY_BUNDLE_SIGNING_KEY",
        }),
      );
    });
  });
});
