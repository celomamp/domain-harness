// Database suite for the Accepted-deviation store (Story 5.5): runs against a
// real PostgreSQL 18 named by REGISTRY_TEST_DATABASE_URL (an admin connection).
// Creates a throwaway database, migrates it as the admin (owner) and runs
// every data-access call as dh_registry_app (`-c role=dh_registry_app`),
// mirroring the bundles.db.test.ts harness. Every I/O & Edge-Case Matrix row
// of spec-5-5 is pinned by a named test.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { canonicalJson, isAcceptedDeviationRecord, standardBundleLatestPath } from "@domain-harness/contract";
import type { AcceptedDeviationRecord, ModuleInfo, StandardInfo, UuidV7 } from "@domain-harness/contract";
import { withTenant } from "../db/tenant-scope.ts";
import { createRegistryDb } from "../db/client.ts";
import type { RegistryDb } from "../db/client.ts";
import { migrate } from "../db/migrate.ts";
import { acceptedDeviationRecords } from "../db/schema.ts";
import { createRegistryServer } from "../http/server.ts";
import type { LogEvent } from "../http/server.ts";
import { MemoryTransport } from "../mail/memory.ts";
import { createApplicationService } from "../applications/service.ts";
import { createBoilerplateService } from "../boilerplate/service.ts";
import { createCompilationsService } from "../compilations/service.ts";
import { createBuildGrantService } from "../build-grants/service.ts";
import { createChildPermissionService } from "../child-permissions/service.ts";
import { createAcceptedDeviationsService } from "./service.ts";
import { createAcceptedDeviationAlertsService } from "../accepted-deviation-alerts/service.ts";
import { createGuidanceEndpointService } from "../guidance-endpoint/service.ts";
import { createLockedRuleService } from "../locked-rules/service.ts";
import { createModuleService } from "../modules/service.ts";
import { createProjectService } from "../projects/service.ts";
import { consumeSignInLink, createSignInService, requestSignInLinks } from "../sign-in/service.ts";
import { createStandardService } from "../standards/service.ts";
import { compileBundle, currentAcceptedDeviations } from "../bundles/compile.ts";
import { lockBundle } from "../standards/service.ts";
import { createBundleService } from "../bundles/service.ts";
import { bundleHash, ed25519SignerFromEnv } from "../bundles/sign.ts";
import type { Signer } from "../bundles/sign.ts";
import { provisionCompany } from "../tenancy/provision.ts";

const ENV = "REGISTRY_TEST_DATABASE_URL";
const adminUrl = process.env[ENV];
const inCi = process.env["CI"] !== undefined && process.env["CI"] !== "" && process.env["CI"] !== "false";
const APP_ROLE = "dh_registry_app";
const MIGRATION_SUITE_LOCK = 7_202_610_103;
const PANEL = { panelUrl: "http://panel.test" };
const PATH = "/v1/accepted-deviations";

if (adminUrl === undefined || adminUrl === "") {
  if (inCi) {
    describe("accepted deviation records database suite", () => {
      it(`requires ${ENV} when CI is set`, () => {
        expect.fail(`${ENV} is not set; CI must run the database suite against PostgreSQL 18`);
      });
    });
  } else {
    process.stderr.write(`accepted-deviations.db.test.ts skipped: ${ENV} is not set (see README, "Database")\n`);
  }
}

function withDatabase(url: string, database: string, role?: string): string {
  const next = new URL(url);
  next.pathname = `/${database}`;
  if (role !== undefined) next.searchParams.set("options", `-c role=${role}`);
  return next.toString();
}

/** The acceptance body the suite submits; the Standard is published at the root Project. */
function acceptanceBody(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    applicationId: applicationA?.id,
    standardId: standard?.id,
    slot: { moduleKind: "code-stack", slotKind: "library", name: "React" },
    subject: "React",
    start: "2026-10-01T00:00:00.000Z",
    end: "2026-11-01T00:00:00.000Z",
    justification: "Keep React 18 until the dependency pins move in the lockfile.",
    alertIntervalHours: 168,
    ...overrides,
  };
}

let applicationA: { id: string } | undefined;
let standard: StandardInfo | undefined;

describe.skipIf(adminUrl === undefined || adminUrl === "")("accepted deviation records against PostgreSQL", () => {
  const database = `dh_registry_acceptances_${randomBytes(6).toString("hex")}`;
  let admin: pg.Client;
  let owner: pg.Client;
  let appPool: pg.Pool;
  let db: RegistryDb;
  let server: Server;
  let base: string;
  let signer: Signer;
  const loggedEvents: LogEvent[] = [];

  let tenantA: UuidV7;
  let rootA: UuidV7;
  let credentialA: string;
  let tenantB: UuidV7;
  let samIdA: string;
  let failNextBuild = false;

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

  const rawPost = (path: string, who: string, bodyText: string) =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(auth[who] ?? {}) },
      body: bodyText,
    });

  async function expectRefused(response: Response, status: number, code: string, subject?: string): Promise<string> {
    const body = (await response.json()) as { message?: string };
    expect([response.status, body]).toMatchObject([status, subject === undefined ? { code } : { code, subject }]);
    return body.message ?? "";
  }

  async function recordCount(tenantId: UuidV7): Promise<number> {
    const { rows } = await owner.query<{ n: number }>(
      "select count(*)::int as n from accepted_deviation_records where tenant_id = $1",
      [tenantId],
    );
    return rows[0]?.n ?? 0;
  }

  async function bundleCount(tenantId: UuidV7): Promise<number> {
    const { rows } = await owner.query<{ n: number }>(
      "select count(*)::int as n from bundle_records where tenant_id = $1",
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
    appPool = new pg.Pool({ connectionString: withDatabase(adminUrl ?? "", database, APP_ROLE), max: 8 });
    db = createRegistryDb(appPool);

    const { privateKey } = generateKeyPairSync("ed25519");
    const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
    signer = ed25519SignerFromEnv({
      REGISTRY_BUNDLE_SIGNING_KEY: privateKeyPem,
      REGISTRY_BUNDLE_SIGNING_KEY_ID: "acceptances-suite-key",
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
      plan: "Community",
      accounts: [
        { name: "Bob Buyer", email: "bob@bolt.io", role: "Buyer" },
        { name: "Ola Builder", email: "ola@bolt.io", role: "Builder" },
      ],
    });
    tenantA = a.tenantId;
    rootA = a.rootProjectId;
    credentialA = a.serviceCredential;
    tenantB = b.tenantId;

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
      ["ola", "ola@bolt.io"],
    ] as const) {
      auth[who] = { authorization: `Bearer ${await sessionToken(email)}` };
    }

    // Seed the Standard the match key resolves against, and the Application,
    // through the existing pinned routes of tenant A.
    const modRes = await post("/v1/modules", "buyer", { kind: "code-stack", name: "Frontend stack" });
    expect(modRes.status).toBe(201);
    const mod = (await modRes.json()) as ModuleInfo;
    const samAccount = a.accounts[1];
    if (samAccount === undefined) throw new Error("missing owner account");
    samIdA = samAccount.id;
    const ownerRes = await post(`/v1/modules/${mod.id}/owner`, "buyer", { accountId: samAccount.id });
    expect(ownerRes.status).toBe(200);
    const stdRes = await post(`/v1/modules/${mod.id}/standards`, "sam", {
      entry: { category: "library", name: "React", versionConstraint: "^18.0.0", status: "approved", correctionInstruction: null },
    });
    expect(stdRes.status).toBe(201);
    standard = (await stdRes.json()) as StandardInfo;
    const appRes = await post("/v1/applications", "buyer", { description: "Checkout Web", projectId: rootA });
    expect(appRes.status).toBe(201);
    applicationA = (await appRes.json()) as { id: string };
  }, 60_000);

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await appPool.end();
    await owner.end();
    await admin.query(`drop database if exists ${database} with (force)`);
    await admin.end();
  }, 60_000);

  describe("migration 0013 (accepted_deviation_records)", () => {
    it("enables and forces RLS with tenant_isolation and grants SELECT and INSERT only to dh_registry_app", async () => {
      const { rows } = await owner.query<{ rls: boolean; forced: boolean; policies: string[] }>(
        `select c.relrowsecurity as rls, c.relforcerowsecurity as forced,
                array(select p.polname::text from pg_policy p where p.polrelid = c.oid order by 1) as policies
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname = 'accepted_deviation_records'`,
      );
      // Migration 0014 adds the alert scheduler's per-role SELECT policy (the
      // 0002 pattern) beside the tenant_isolation policy.
      expect(rows).toEqual([{ rls: true, forced: true, policies: ["alert_scheduler", "tenant_isolation"] }]);
      const grants = await owner.query<{ privilege_type: string }>(
        `select privilege_type from information_schema.role_table_grants
         where grantee = $1 and table_name = 'accepted_deviation_records' order by 1`,
        [APP_ROLE],
      );
      expect(grants.rows).toEqual([{ privilege_type: "INSERT" }, { privilege_type: "SELECT" }]);
    });

    it("refuses UPDATE and DELETE for the runtime role (append-only)", async () => {
      for (const statement of [
        "update accepted_deviation_records set justification = 'x'",
        "delete from accepted_deviation_records",
      ]) {
        await expect(
          withTenant(db, tenantA, async (tx) => {
            await tx.execute(sql.raw(statement));
          }),
        ).rejects.toThrow();
      }
    });
  });

  describe("recording an acceptance", () => {
    it("records through the parse path for the Buyer: 201 with every stored field, append-only, and the next bundle carries the acceptance", async () => {
      const before = await bundleCount(tenantA);
      const response = await post(PATH, "buyer", acceptanceBody());
      expect(response.status).toBe(201);
      const record: unknown = await response.json();
      expect(isAcceptedDeviationRecord(record)).toBe(true);
      const stored = record as AcceptedDeviationRecord;
      expect(stored).toEqual({
        id: expect.any(String) as unknown,
        applicationId: applicationA?.id,
        standardId: standard?.id,
        standardVersion: 1,
        slot: { moduleKind: "code-stack", slotKind: "library", name: "React" },
        subject: "React",
        start: "2026-10-01T00:00:00.000Z",
        end: "2026-11-01T00:00:00.000Z",
        buyer: { accountId: expect.any(String) as unknown, name: "Bea Buyer" },
        justification: "Keep React 18 until the dependency pins move in the lockfile.",
        alertIntervalHours: 168,
        createdAt: expect.stringMatching(/^2026-/) as unknown,
      });
      expect(await recordCount(tenantA)).toBe(1);

      // The pinned post-mutation hook built exactly one bundle for the tenant,
      // and it carries the acceptance through `acceptedDeviations`.
      expect(await bundleCount(tenantA)).toBe(before + 1);
      const pull = await fetch(`${base}${standardBundleLatestPath(tenantA)}`, {
        headers: { authorization: `Bearer ${credentialA}` },
      });
      expect(pull.status).toBe(200);
      const bundle = (await pull.json()) as { payload: { sequence: number; acceptedDeviations: unknown } };
      expect(bundle.payload.sequence).toBe(before + 1);
      expect(bundle.payload.acceptedDeviations).toEqual([
        {
          applicationId: applicationA?.id,
          standardId: standard?.id,
          standardVersion: 1,
          slot: { moduleKind: "code-stack", slotKind: "library", name: "React" },
          subject: "React",
          start: "2026-10-01T00:00:00.000Z",
          end: "2026-11-01T00:00:00.000Z",
        },
      ]);
      expect(loggedEvents.filter((e) => e["event"] === "bundle_build_failed")).toEqual([]);
    });

    it("records the manual path the same way and keeps the registry-resolved canonical slot spelling", async () => {
      // A submitted name that differs from the owner's spelling only by case
      // and surrounding whitespace resolves to the same slot (the slot rule)
      // and is stored under the Effective set's canonical spelling.
      const response = await post(PATH, "buyer", acceptanceBody({ subject: "jsx-runtime", slot: { moduleKind: "code-stack", slotKind: "library", name: "  react  " } }));
      expect(response.status).toBe(201);
      const stored = (await response.json()) as AcceptedDeviationRecord;
      expect(stored.slot).toEqual({ moduleKind: "code-stack", slotKind: "library", name: "React" });
      expect(stored.subject).toBe("jsx-runtime");
      expect(stored.standardVersion).toBe(1);
      expect(await recordCount(tenantA)).toBe(2);
    });

    it("refuses a key that resolves to nothing with 400 invalid_input naming standardId, writing nothing", async () => {
      const before = await recordCount(tenantA);
      const message = await expectRefused(
        await post(PATH, "buyer", acceptanceBody({ standardId: "01928c7e-5b2a-7c3d-8e4f-000000000009" })),
        400,
        "invalid_input",
        "standardId",
      );
      expect(message).toContain("no Standard with this id in this Conflict slot");
      expect(await recordCount(tenantA)).toBe(before);
    });

    it("refuses an end at or before its start with 400 invalid_input subject end, writing nothing", async () => {
      const before = await recordCount(tenantA);
      await expectRefused(await post(PATH, "buyer", acceptanceBody({ end: "2026-09-30T00:00:00.000Z" })), 400, "invalid_input", "end");
      await expectRefused(await post(PATH, "buyer", acceptanceBody({ end: "2026-10-01T00:00:00.000Z" })), 400, "invalid_input", "end");
      expect(await recordCount(tenantA)).toBe(before);
    });

    it("refuses a calendar-invalid start with 400 invalid_input subject start, not an end misreport, writing nothing", async () => {
      // `isUtcIso` is regex-only and February 30 rolls `Date.parse` over to
      // March 2, so the window gate must name the invalid instant itself.
      const before = await recordCount(tenantA);
      await expectRefused(
        await post(PATH, "buyer", acceptanceBody({ start: "2026-02-30T00:00:00.000Z" })),
        400,
        "invalid_input",
        "start",
      );
      await expectRefused(
        await post(PATH, "buyer", acceptanceBody({ end: "2026-11-31T00:00:00.000Z" })),
        400,
        "invalid_input",
        "end",
      );
      expect(await recordCount(tenantA)).toBe(before);
    });

    it("refuses a Builder's POST with 403 role_denied before the body is read (drained), on any plan", async () => {
      const beforeA = await recordCount(tenantA);
      const beforeB = await recordCount(tenantB);
      for (const who of ["builder", "sam", "ola"]) {
        await expectRefused(await rawPost(PATH, who, "{not json"), 403, "role_denied", "role");
      }
      expect(await recordCount(tenantA)).toBe(beforeA);
      expect(await recordCount(tenantB)).toBe(beforeB);
    });

    it("refuses a Community tenant's GET and POST of the Buyer with 403 plan_refused subject plan, storing nothing", async () => {
      const before = await recordCount(tenantB);
      const message = await expectRefused(await get(PATH, "bob"), 403, "plan_refused", "plan");
      expect(message).toBe("this Company's plan does not include recording an Accepted deviation; nothing was changed");
      expect(message).not.toMatch(/\$|€|£|price/i);
      // The Buyer's POST hard-refuses at the plan, before the body complains.
      await expectRefused(await post(PATH, "bob", acceptanceBody()), 403, "plan_refused", "plan");
      expect(await recordCount(tenantB)).toBe(before);
    });

    it("answers a Community Builder's POST with role_denied (role before plan)", async () => {
      await expectRefused(await post(PATH, "ola", acceptanceBody()), 403, "role_denied", "role");
    });

    it("answers an unknown Application with 404 application_not_found subject applicationId, writing nothing", async () => {
      const before = await recordCount(tenantA);
      await expectRefused(
        await post(PATH, "buyer", acceptanceBody({ applicationId: "01928c7e-5b2a-7c3d-8e4f-000000000009" })),
        404,
        "application_not_found",
        "applicationId",
      );
      expect(await recordCount(tenantA)).toBe(before);
    });

    it("answers 400 invalid_input subject body for a non-object body and subject applicationId for an empty one", async () => {
      const before = await recordCount(tenantA);
      await expectRefused(await post(PATH, "buyer", []), 400, "invalid_input", "body");
      await expectRefused(await post(PATH, "buyer", {}), 400, "invalid_input", "applicationId");
      expect(await recordCount(tenantA)).toBe(before);
    });

    it.each([
      ["an extra key", { extra: 1 }, "extra"],
      ["a malformed Application id", { applicationId: "nope" }, "applicationId"],
      ["a malformed Standard id", { standardId: 42 }, "standardId"],
      ["a malformed slot", { slot: { moduleKind: "code-stack" } }, "slot"],
      ["an unknown slot Module kind", { slot: { moduleKind: "tree", slotKind: "library", name: "React" } }, "slot"],
      ["an empty subject", { subject: "   " }, "subject"],
      ["an empty justification", { justification: "" }, "justification"],
      ["a non-ISO start", { start: "2026-10-01 00:00:00" }, "start"],
      ["an offset end", { end: "2026-11-01T00:00:00+00:00" }, "end"],
      ["a sub-hour interval", { alertIntervalHours: 1.5 }, "alertIntervalHours"],
      ["an out-of-range interval", { alertIntervalHours: 8761 }, "alertIntervalHours"],
      ["a zero interval", { alertIntervalHours: 0 }, "alertIntervalHours"],
    ])("answers 400 invalid_input naming the field for %s", async (_label, overrides, subject) => {
      const before = await recordCount(tenantA);
      await expectRefused(await post(PATH, "buyer", acceptanceBody(overrides)), 400, "invalid_input", subject);
      expect(await recordCount(tenantA)).toBe(before);
    });
  });

  describe("reading the records back and the store's isolation", () => {
    it("returns the tenant's records newest sequence first, every stored field visible, no row of another tenant", async () => {
      const response = await get(PATH, "buyer");
      expect(response.status).toBe(200);
      const body = (await response.json()) as { records: AcceptedDeviationRecord[] };
      expect(body.records).toHaveLength(2);
      for (const record of body.records) expect(isAcceptedDeviationRecord(record)).toBe(true);
      expect(body.records.every((record) => record.buyer.name === "Bea Buyer")).toBe(true);
      // The first recorded acceptance has the highest sequence, so it comes first.
      expect(body.records[0]?.subject).toBe("jsx-runtime");
      expect(body.records[1]?.subject).toBe("React");
      // A Builder reads the same records (GET is open to every role).
      const builderResponse = await get(PATH, "builder");
      expect(builderResponse.status).toBe(200);
      expect(((await builderResponse.json()) as { records: unknown[] }).records).toHaveLength(2);
    });

    it("never exposes another tenant's rows: RLS leaves tenant B's context empty even with rows next door", async () => {
      const seenA = await withTenant(db, tenantA, (tx) => tx.select().from(acceptedDeviationRecords));
      expect(seenA).toHaveLength(2);
      expect(seenA.every((row) => row.tenantId === tenantA)).toBe(true);
      const seenB = await withTenant(db, tenantB, (tx) => tx.select().from(acceptedDeviationRecords));
      expect(seenB).toEqual([]);
      // The standing GET refusal already proved the refused client sees nothing.
      expect(await recordCount(tenantB)).toBe(0);
    });
  });

  describe("the compiled bundle reads the store", () => {
    it("compiles every stored acceptance into acceptedDeviations deterministically, with only the key, and bytes stay stable across rebuilds", async () => {
      const fixedIssuedAt = "2026-10-13T12:00:00.000Z";
      const [first, second] = await withTenant(db, tenantA, async (tx) => {
        await lockBundle(tx, tenantA);
        const c1 = await compileBundle(tx, tenantA, 99, "acceptances-suite-key", fixedIssuedAt);
        const c2 = await compileBundle(tx, tenantA, 99, "acceptances-suite-key", fixedIssuedAt);
        return [c1, c2] as const;
      });
      expect(first.payload.acceptedDeviations).toEqual([
        {
          applicationId: applicationA?.id,
          standardId: standard?.id,
          standardVersion: 1,
          slot: { moduleKind: "code-stack", slotKind: "library", name: "React" },
          subject: "React",
          start: "2026-10-01T00:00:00.000Z",
          end: "2026-11-01T00:00:00.000Z",
        },
        {
          applicationId: applicationA?.id,
          standardId: standard?.id,
          standardVersion: 1,
          slot: { moduleKind: "code-stack", slotKind: "library", name: "React" },
          subject: "jsx-runtime",
          start: "2026-10-01T00:00:00.000Z",
          end: "2026-11-01T00:00:00.000Z",
        },
      ]);
      expect(canonicalJson(first.payload)).toBe(canonicalJson(second.payload));
      expect(bundleHash({ payload: first.payload, keyId: "acceptances-suite-key", signature: "x" })).toBe(
        bundleHash({ payload: second.payload, keyId: "acceptances-suite-key", signature: "x" }),
      );
      // The read helper agrees with the compile.
      const read = await withTenant(db, tenantA, (tx) => currentAcceptedDeviations(tx, tenantA));
      expect(read).toEqual(first.payload.acceptedDeviations);
    });
  });

  describe("the manual path's slot rule (pinned to core's sameSlot)", () => {
    it("resolves an NFD-effective entry from an NFC submission and stores the Effective set's canonical spelling", async () => {
      const applicationId = applicationA?.id;
      if (applicationId === undefined) throw new Error("missing Application");
      const modRes = await post("/v1/modules", "buyer", { kind: "code-stack", name: "NFC suite stack" });
      expect(modRes.status).toBe(201);
      const mod = (await modRes.json()) as ModuleInfo;
      const ownerRes = await post(`/v1/modules/${mod.id}/owner`, "buyer", { accountId: samIdA });
      expect(ownerRes.status).toBe(200);

      // The Effective-set entry carries the NFD spelling of Café; the
      // submission carries the NFC spelling. core's `sameSlot` (NFC + trim +
      // lowercase) must resolve them to one slot, and the registry stores the
      // Effective set's spelling.
      const nfdName = "Cafe\u0301";
      const nfcName = "Caf\u00e9";
      const stdRes = await post(`/v1/modules/${mod.id}/standards`, "sam", {
        entry: { category: "library", name: nfdName, versionConstraint: "^1.0.0", status: "approved", correctionInstruction: null },
      });
      expect(stdRes.status).toBe(201);
      const nfdStandard = (await stdRes.json()) as StandardInfo;

      const before = await recordCount(tenantA);
      const response = await post(
        PATH,
        "buyer",
        acceptanceBody({ standardId: nfdStandard.id, slot: { moduleKind: "code-stack", slotKind: "library", name: ` ${nfcName} ` } }),
      );
      expect(response.status).toBe(201);
      const stored = (await response.json()) as AcceptedDeviationRecord;
      expect(stored.slot).toEqual({ moduleKind: "code-stack", slotKind: "library", name: nfdName });
      expect(stored.standardVersion).toBe(1);
      expect(await recordCount(tenantA)).toBe(before + 1);
    });
  });

  describe("the acceptance post-mutation bundle build", () => {
    it("answers 500 bundle_build_failed after the acceptance insert, which REMAINS and reads back (committed mutation survives)", async () => {
      const before = await recordCount(tenantA);
      loggedEvents.length = 0;
      failNextBuild = true;

      const response = await post(PATH, "buyer", acceptanceBody({ subject: "survivor" }));
      await expectRefused(response, 500, "bundle_build_failed", "bundle");
      expect(loggedEvents).toContainEqual({ event: "bundle_build_failed", tenantId: tenantA, code: "unexpected" });

      // The append-only insert committed before the build failed.
      expect(await recordCount(tenantA)).toBe(before + 1);
      const list = await get(PATH, "buyer");
      expect(list.status).toBe(200);
      const body = (await list.json()) as { records: AcceptedDeviationRecord[] };
      expect(body.records.some((record) => record.subject === "survivor")).toBe(true);
    });
  });
});
