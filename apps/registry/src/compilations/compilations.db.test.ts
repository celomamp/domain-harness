// Database suite for the Compilation catalog (Story 6.1): runs against a
// real PostgreSQL 18 named by REGISTRY_TEST_DATABASE_URL (an admin
// connection). Creates a throwaway database, migrates it as the admin
// (owner) and runs every data-access call as dh_registry_app
// (`-c role=dh_registry_app`). Exercises every I/O & Edge-Case Matrix row in
// spec-6-1.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  COMPILATION_API_PATHS,
  COMPILATION_CATALOG_VERSION,
} from "@domain-harness/contract";
import type { Compilation, UuidV7 } from "@domain-harness/contract";
import { createRegistryDb } from "../db/client.ts";
import type { RegistryDb } from "../db/client.ts";
import { migrate } from "../db/migrate.ts";
import { compilationCatalogReads, compilations } from "../db/schema.ts";
import { withTenant } from "../db/tenant-scope.ts";
import { createRegistryServer, MAX_BODY_BYTES } from "../http/server.ts";
import { createLockedRuleService } from "../locked-rules/service.ts";
import { MemoryTransport } from "../mail/memory.ts";
import { createModuleService } from "../modules/service.ts";
import { createProjectService } from "../projects/service.ts";
import { consumeSignInLink, createSignInService, requestSignInLinks } from "../sign-in/service.ts";
import { mintToken } from "../sign-in/tokens.ts";
import { createStandardService } from "../standards/service.ts";
import { provisionCompany } from "../tenancy/provision.ts";
import { createBuildGrantService } from "../build-grants/service.ts";
import { createChildPermissionService } from "../child-permissions/service.ts";
import { createApplicationService } from "../applications/service.ts";
import { createBoilerplateService } from "../boilerplate/service.ts";
import { createAcceptedDeviationsService } from "../accepted-deviations/service.ts";
import { createAcceptedDeviationAlertsService } from "../accepted-deviation-alerts/service.ts";
import { createGuidanceEndpointService } from "../guidance-endpoint/service.ts";
import { createBundleService } from "../bundles/service.ts";
import { ed25519SignerFromEnv } from "../bundles/sign.ts";
import { mintUuidV7 } from "../ids.ts";
import { createCompilationsService } from "./service.ts";
import { createGuidanceAccessService } from "../guidance-access/service.ts";

const ENV = "REGISTRY_TEST_DATABASE_URL";
const adminUrl = process.env[ENV];
const inCi = process.env["CI"] !== undefined && process.env["CI"] !== "" && process.env["CI"] !== "false";
const APP_ROLE = "dh_registry_app";
const MIGRATION_SUITE_LOCK = 7_202_610_103;
const PANEL = { panelUrl: "http://panel.test" };

if (adminUrl === undefined || adminUrl === "") {
  if (inCi) {
    describe("Compilation catalog database suite", () => {
      it(`requires ${ENV} when CI is set`, () => {
        expect.fail(`${ENV} is not set; CI must run the database suite against PostgreSQL 18`);
      });
    });
  } else {
    process.stderr.write(`compilations.db.test.ts skipped: ${ENV} is not set (see README, "Database")\n`);
  }
}

function withDatabase(url: string, database: string, role?: string): string {
  const next = new URL(url);
  next.pathname = `/${database}`;
  if (role !== undefined) next.searchParams.set("options", `-c role=${role}`);
  return next.toString();
}

const HASH = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const STANDARD = "01928c7e-5b2a-7c3d-ae4f-a1b2c3d4e5f8";

function envelope(type: Compilation["type"], applicationId: UuidV7, sequence: number): Record<string, unknown> {
  return {
    type,
    schemaVersion: "1.0.0",
    catalogVersion: COMPILATION_CATALOG_VERSION,
    idempotencyKey: mintUuidV7(),
    applicationId,
    agentToolName: "claude-code",
    occurredAt: new Date().toISOString(),
    sequence,
  };
}

function validCompilation(type: Compilation["type"], applicationId: UuidV7, sequence: number): Record<string, unknown> {
  const base = envelope(type, applicationId, sequence);
  switch (type) {
    case "guidance":
      return { ...base, tool: "code_stack_rule", outcome: "hit", subject: { kind: "slot-token", slotToken: "code-stack/library/React" } };
    case "gate_run":
      return {
        ...base,
        revision: "abc123",
        verdict: "fail",
        checkedCount: 3,
        openCount: 1,
        deviations: [
          {
            standardId: STANDARD,
            slot: { moduleKind: "code-stack", slotKind: "library", name: "React" },
            subject: "React",
            status: "open",
          },
        ],
      };
    case "deviation":
      return {
        ...base,
        deviation: {
          standardId: STANDARD,
          standardVersion: 2,
          slot: { moduleKind: "code-stack", slotKind: "library", name: "React" },
          subject: "React",
          kind: "prohibited",
          status: "open",
          correction: "Remove React.",
        },
      };
    case "binding_refusal":
      return { ...base, reason: "unknown_application", sentence: "The Application is not bound." };
    case "bundle_status":
      return { ...base, bundleHash: HASH, bundleSequence: 4, issuedAt: new Date().toISOString() };
    case "collector_health":
      return { ...base, pendingCount: 2, droppedByReason: { schema_failed: 1 } };
  }
}

describe.skipIf(adminUrl === undefined || adminUrl === "")("Compilation catalog against PostgreSQL", () => {
  const database = `dh_registry_compilations_${randomBytes(6).toString("hex")}`;
  let admin: pg.Client;
  let owner: pg.Client;
  let appPool: pg.Pool;
  let db: RegistryDb;
  let server: Server;
  let base: string;
  let appUrl: string;

  const { privateKey } = generateKeyPairSync("ed25519");
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  const KEY_ID = "registry-key-2026-10";

  let tenantA: UuidV7;
  let credentialA: string;
  let buyerA: UuidV7;
  let appA: UuidV7;

  let tenantB: UuidV7;
  let credentialB: string;
  let buyerB: UuidV7;
  let appB: UuidV7;

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

  const ingest = (token: string | undefined, body: unknown) =>
    fetch(`${base}${COMPILATION_API_PATHS.compilations}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify(body),
    });

  async function expectRefused(response: Response, status: number, code: string, subject?: string): Promise<void> {
    const body: unknown = await response.json();
    expect([response.status, body]).toMatchObject([status, subject === undefined ? { code } : { code, subject }]);
  }

  async function compilationCount(tenantId: UuidV7): Promise<number> {
    const { rows } = await owner.query<{ n: number }>(
      "select count(*)::int as n from compilations where tenant_id = $1",
      [tenantId],
    );
    return rows[0]?.n ?? 0;
  }

  async function readCount(tenantId: UuidV7): Promise<number> {
    const { rows } = await owner.query<{ n: number }>(
      "select count(*)::int as n from compilation_catalog_reads where tenant_id = $1",
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

    const signer = ed25519SignerFromEnv({
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
    credentialA = a.serviceCredential;
    const buyerAccountA = a.accounts[0];
    if (buyerAccountA === undefined) throw new Error("missing accounts");
    buyerA = buyerAccountA.id;
    appA = mintUuidV7();

    tenantB = b.tenantId;
    credentialB = b.serviceCredential;
    const buyerAccountB = b.accounts[0];
    if (buyerAccountB === undefined) throw new Error("missing accounts");
    buyerB = buyerAccountB.id;
    appB = mintUuidV7();

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
        bundles: createBundleService(db, signer),
        compilations: createCompilationsService(db),
        guidanceAccess: createGuidanceAccessService(db, signer),
      },
      () => undefined,
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
  }, 60_000);

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await appPool.end();
    await owner.end();
    await admin.query(`drop database if exists ${database} with (force)`);
    await admin.end();
  }, 60_000);

  describe("migration 0015 (compilation_catalog_reads, compilations)", () => {
    it("enables and forces RLS with tenant_isolation and grants SELECT and INSERT only to dh_registry_app", async () => {
      for (const table of ["compilation_catalog_reads", "compilations"]) {
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

    it("refuses UPDATE and DELETE for the app role on both tables", async () => {
      for (const statement of [
        "update compilation_catalog_reads set catalog_version = 'x'",
        "delete from compilation_catalog_reads",
        "update compilations set sequence = 99",
        "delete from compilations",
      ]) {
        await expect(
          withTenant(db, tenantA, async (tx) => {
            await tx.execute(sql.raw(statement));
          }),
        ).rejects.toThrow();
      }
    });
  });

  describe("catalog reads", () => {
    it("refuses a non-Buyer with 403 role_denied before the body is read, storing nothing", async () => {
      expect(await readCount(tenantA)).toBe(0);
      for (const who of ["sam", "builder"]) {
        for (const body of ["{not json", "x".repeat(MAX_BODY_BYTES * 2)]) {
          const response = await rawPost(COMPILATION_API_PATHS.catalogReads, who, body);
          await expectRefused(response, 403, "role_denied", "role");
        }
        await expectRefused(
          await post(COMPILATION_API_PATHS.catalogReads, who, { catalogVersion: COMPILATION_CATALOG_VERSION }),
          403,
          "role_denied",
          "role",
        );
      }
      expect(await readCount(tenantA)).toBe(0);
    });

    it("answers the unread state to every role before any read is recorded", async () => {
      for (const who of ["buyer", "builder"]) {
        const res = await get(COMPILATION_API_PATHS.catalogReads, who);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({
          catalogVersion: COMPILATION_CATALOG_VERSION,
          read: false,
          readBy: null,
          readAt: null,
        });
      }
    });

    it("records the Buyer's read with 201 and answers the read state with the Buyer and date", async () => {
      const res = await post(COMPILATION_API_PATHS.catalogReads, "buyer", {
        catalogVersion: COMPILATION_CATALOG_VERSION,
      });
      expect(res.status).toBe(201);
      const record = (await res.json()) as { catalogVersion: string; readBy: { accountId: string; name: string }; readAt: string };
      expect(record.catalogVersion).toBe(COMPILATION_CATALOG_VERSION);
      expect(record.readBy).toEqual({ accountId: buyerA, name: "Bea Buyer" });
      expect(record.readAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

      const state = await (await get(COMPILATION_API_PATHS.catalogReads, "buyer")).json();
      expect(state).toEqual({
        catalogVersion: COMPILATION_CATALOG_VERSION,
        read: true,
        readBy: { accountId: buyerA, name: "Bea Buyer" },
        readAt: record.readAt,
      });
    });

    it("answers a re-read of the same version with 200 and the existing record, storing no duplicate", async () => {
      const before = await readCount(tenantA);
      const res = await post(COMPILATION_API_PATHS.catalogReads, "buyer", {
        catalogVersion: COMPILATION_CATALOG_VERSION,
      });
      expect(res.status).toBe(200);
      const record = (await res.json()) as { readAt: string };
      const state = (await (await get(COMPILATION_API_PATHS.catalogReads, "buyer")).json()) as { readAt: string };
      expect(record.readAt).toBe(state.readAt);
      expect(await readCount(tenantA)).toBe(before);
    });

    it("refuses another catalog version with 400 invalid_input, storing nothing", async () => {
      const before = await readCount(tenantA);
      await expectRefused(
        await post(COMPILATION_API_PATHS.catalogReads, "buyer", { catalogVersion: "0.9.0" }),
        400,
        "invalid_input",
        "catalogVersion",
      );
      await expectRefused(await post(COMPILATION_API_PATHS.catalogReads, "buyer", {}), 400, "invalid_input", "catalogVersion");
      expect(await readCount(tenantA)).toBe(before);
    });
  });

  describe("ingestion", () => {
    it("answers 401 session_invalid for an absent, malformed or unknown credential, parsing nothing", async () => {
      const body = validCompilation("guidance", appB, 1);
      await expectRefused(await ingest(undefined, body), 401, "session_invalid", "session");
      await expectRefused(await ingest("not-a-valid-token", body), 401, "session_invalid", "session");
      await expectRefused(await ingest(mintToken(tenantB), body), 401, "session_invalid", "session");
      expect(await compilationCount(tenantB)).toBe(0);
    });

    it("answers 405 method_not_allowed with Allow: POST for non-POST methods on the ingest route", async () => {
      const res = await fetch(`${base}${COMPILATION_API_PATHS.compilations}`, {
        method: "GET",
        headers: { authorization: `Bearer ${credentialB}` },
      });
      expect(res.headers.get("allow")).toBe("POST");
      await expectRefused(res, 405, "method_not_allowed");
    });

    it("refuses with 403 catalog_unread while the tenant recorded no read of the current version, storing nothing", async () => {
      expect(await readCount(tenantB)).toBe(0);
      await expectRefused(await ingest(credentialB, validCompilation("guidance", appB, 1)), 403, "catalog_unread", "catalog");
      expect(await compilationCount(tenantB)).toBe(0);
    });

    it("refuses with 403 catalog_unread before the body is read: even malformed bodies lose to the gate", async () => {
      const malformed = await fetch(`${base}${COMPILATION_API_PATHS.compilations}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${credentialB}` },
        body: "{not json",
      });
      await expectRefused(malformed, 403, "catalog_unread", "catalog");
      await expectRefused(await ingest(credentialB, { type: "note" }), 403, "catalog_unread", "catalog");
      expect(await compilationCount(tenantB)).toBe(0);
    });

    it("a read of another version never satisfies the gate for the current version", async () => {
      await owner.query(
        "insert into compilation_catalog_reads (id, tenant_id, catalog_version, read_by, read_at) values ($1, $2, '0.9.0', $3, now())",
        [mintUuidV7(), tenantB, buyerB],
      );
      await expectRefused(await ingest(credentialB, validCompilation("guidance", appB, 1)), 403, "catalog_unread", "catalog");
      expect(await compilationCount(tenantB)).toBe(0);
      const state = (await (await get(COMPILATION_API_PATHS.catalogReads, "bob")).json()) as { read: boolean };
      expect(state.read).toBe(false);
    });

    it("stores a valid Compilation with 201 once the read is recorded", async () => {
      const recorded = await post(COMPILATION_API_PATHS.catalogReads, "bob", {
        catalogVersion: COMPILATION_CATALOG_VERSION,
      });
      expect(recorded.status).toBe(201);
      const body = validCompilation("guidance", appB, 1);
      const res = await ingest(credentialB, body);
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual(body);
      expect(await compilationCount(tenantB)).toBe(1);
    });

    it("answers a replay of the same idempotency key with 200 and the stored Compilation, storing no duplicate", async () => {
      const body = validCompilation("collector_health", appB, 2);
      const first = await ingest(credentialB, body);
      expect(first.status).toBe(201);
      expect(await compilationCount(tenantB)).toBe(2);
      const replay = await ingest(credentialB, body);
      expect(replay.status).toBe(200);
      expect(await replay.json()).toEqual(body);
      expect(await compilationCount(tenantB)).toBe(2);
    });

    it("refuses a reused Application sequence under another key with 400 invalid_input, storing nothing", async () => {
      const before = await compilationCount(tenantB);
      const clash = { ...validCompilation("guidance", appB, 3), sequence: 1 };
      await expectRefused(await ingest(credentialB, clash), 400, "invalid_input", "sequence");
      expect(await compilationCount(tenantB)).toBe(before);
    });

    it("stores one Compilation of each of the six catalog types", async () => {
      const types: readonly Compilation["type"][] = [
        "guidance",
        "gate_run",
        "deviation",
        "binding_refusal",
        "bundle_status",
        "collector_health",
      ];
      let sequence = 10;
      for (const type of types) {
        const body = validCompilation(type, appB, sequence);
        const res = await ingest(credentialB, body);
        expect(res.status).toBe(201);
        expect(await res.json()).toEqual(body);
        sequence += 1;
      }
      expect(await compilationCount(tenantB)).toBe(8);
    });

    it("reports an unknown major schema version with the served major and catalog version, storing nothing", async () => {
      const before = await compilationCount(tenantB);
      const body = { ...validCompilation("guidance", appB, 30), schemaVersion: "2.0.0" };
      const res = await ingest(credentialB, body);
      expect(res.status).toBe(400);
      const envelope = (await res.json()) as { code: string; subject: string; message: string };
      expect(envelope.code).toBe("invalid_input");
      expect(envelope.subject).toBe("schemaVersion");
      expect(envelope.message).toContain("1");
      expect(envelope.message).toContain(COMPILATION_CATALOG_VERSION);
      expect(await compilationCount(tenantB)).toBe(before);
    });

    it("refuses malformed bodies with 400 invalid_input naming the subject, storing nothing", async () => {
      const before = await compilationCount(tenantB);
      const cases: ReadonlyArray<readonly [Record<string, unknown>, string]> = [
        [{ ...validCompilation("guidance", appB, 40), type: "note" }, "type"],
        [{ ...validCompilation("guidance", appB, 41), extra: 1 }, "extra"],
        [{ ...validCompilation("guidance", appB, 42), catalogVersion: "9.9.9" }, "catalogVersion"],
        [{ ...validCompilation("guidance", appB, 43), idempotencyKey: "nope" }, "idempotencyKey"],
        [{ ...validCompilation("guidance", appB, 44), applicationId: "nope" }, "applicationId"],
        [{ ...validCompilation("guidance", appB, 45), agentToolName: "" }, "agentToolName"],
        [{ ...validCompilation("guidance", appB, 46), occurredAt: "15/10/2026" }, "occurredAt"],
        [{ ...validCompilation("guidance", appB, 47), occurredAt: "2026-02-30T00:00:00.000Z" }, "occurredAt"],
        [{ ...validCompilation("guidance", appB, 48), sequence: 0 }, "sequence"],
        [{ ...validCompilation("guidance", appB, 49), sequence: 1.5 }, "sequence"],
        [{ ...validCompilation("guidance", appB, 57), sequence: 2_147_483_648 }, "sequence"],
        [{ ...validCompilation("guidance", appB, 50), subject: "React" }, "subject"],
        [{ ...validCompilation("gate_run", appB, 51), verdict: "maybe" }, "verdict"],
        [{ ...validCompilation("deviation", appB, 52), deviation: { kind: "nope" } }, "deviation"],
        [{ ...validCompilation("binding_refusal", appB, 53), reason: "refused" }, "reason"],
        [{ ...validCompilation("bundle_status", appB, 54), bundleHash: "zz" }, "bundleHash"],
        [{ ...validCompilation("collector_health", appB, 55), pendingCount: -1 }, "pendingCount"],
      ];
      for (const [body, subject] of cases) {
        await expectRefused(await ingest(credentialB, body), 400, "invalid_input", subject);
      }
      expect(await compilationCount(tenantB)).toBe(before);
    });
  });

  describe("tenant isolation on the catalog tables", () => {
    it("RLS returns only the context tenant's rows when the tenant filter is omitted", async () => {
      const seenA = await withTenant(db, tenantA, async (tx) => ({
        reads: await tx.select().from(compilationCatalogReads),
        stored: await tx.select().from(compilations),
      }));
      expect(seenA.reads.every((row) => row.tenantId === tenantA)).toBe(true);
      expect(seenA.stored.every((row) => row.tenantId === tenantA)).toBe(true);

      const seenB = await withTenant(db, tenantB, async (tx) => ({
        reads: await tx.select().from(compilationCatalogReads),
        stored: await tx.select().from(compilations),
      }));
      expect(seenB.reads.length).toBeGreaterThan(0);
      expect(seenB.reads.every((row) => row.tenantId === tenantB)).toBe(true);
      expect(seenB.stored.length).toBeGreaterThan(0);
      expect(seenB.stored.every((row) => row.tenantId === tenantB)).toBe(true);
    });

    it("a raw SELECT as dh_registry_app without app.tenant_id sees zero rows", async () => {
      const { rows } = await appPool.query<{ current_user: string; r: number; c: number }>(
        `select current_user::text as current_user,
                (select count(*) from compilation_catalog_reads)::int as r,
                (select count(*) from compilations)::int as c`,
      );
      expect(rows).toEqual([{ current_user: APP_ROLE, r: 0, c: 0 }]);
    });

    it("ingestion lands in the credential's tenant: tenant A sees none of tenant B's rows", async () => {
      const beforeA = await compilationCount(tenantA);
      const res = await ingest(credentialA, validCompilation("guidance", appA, 7));
      expect(res.status).toBe(201);
      expect(await compilationCount(tenantA)).toBe(beforeA + 1);
      const storedB = await withTenant(db, tenantB, async (tx) => tx.select().from(compilations));
      expect(storedB.every((row) => row.tenantId === tenantB)).toBe(true);
    });
  });
});
