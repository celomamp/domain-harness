// Database suite for Guidance access (Story 6.7): runs against a real
// PostgreSQL 18 named by REGISTRY_TEST_DATABASE_URL (an admin connection).
// Creates a throwaway database, migrates it as the admin (owner) and runs
// every data-access call as dh_registry_app (`-c role=dh_registry_app`).
// Exercises every registry-side I/O & Edge-Case Matrix row in spec-6-7:
// the pristine default, Buyer-only writes, idempotent POSTs, tenant
// isolation, append-only privileges, role tokens that reflect the grant and
// verify against the registry key, and the credential-authed retention read.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { generateKeyPairSync, randomBytes, verify } from "node:crypto";
import { sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  decodeRoleTokenBody,
  fromBase64Url,
  GUIDANCE_ACCESS_API_PATHS,
  isGuidanceAccessState,
  isGuidanceRoleToken,
  isGuidanceRoleTokenPayload,
} from "@domain-harness/contract";
import type { UuidV7 } from "@domain-harness/contract";
import { createRegistryDb } from "../db/client.ts";
import { endPool } from "../db/end-pool.ts";
import type { RegistryDb } from "../db/client.ts";
import { migrate } from "../db/migrate.ts";
import { withTenant } from "../db/tenant-scope.ts";
import { createRegistryServer } from "../http/server.ts";
import { createLockedRuleService } from "../locked-rules/service.ts";
import { MemoryTransport } from "../mail/memory.ts";
import { createModuleService } from "../modules/service.ts";
import { createProjectService } from "../projects/service.ts";
import { consumeSignInLink, createSignInService, requestSignInLinks } from "../sign-in/service.ts";
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
import { createCompilationsService } from "../compilations/service.ts";
import { createGuidanceAccessService } from "./service.ts";

const ENV = "REGISTRY_TEST_DATABASE_URL";
const adminUrl = process.env[ENV];
const inCi = process.env["CI"] !== undefined && process.env["CI"] !== "" && process.env["CI"] !== "false";
const APP_ROLE = "dh_registry_app";
const MIGRATION_SUITE_LOCK = 7_202_610_103;
const PANEL = { panelUrl: "http://panel.test" };

if (adminUrl === undefined || adminUrl === "") {
  if (inCi) {
    describe("Guidance access database suite", () => {
      it(`requires ${ENV} when CI is set`, () => {
        expect.fail(`${ENV} is not set; CI must run the database suite against PostgreSQL 18`);
      });
    });
  } else {
    process.stderr.write(`guidance-access.db.test.ts skipped: ${ENV} is not set (see README, "Database")\n`);
  }
}

function withDatabase(url: string, database: string, role?: string): string {
  const next = new URL(url);
  next.pathname = `/${database}`;
  if (role !== undefined) next.searchParams.set("options", `-c role=${role}`);
  return next.toString();
}

function accessBody(grants: Record<string, boolean>, retentionDays: number): Record<string, unknown> {
  return { grants, retentionDays };
}

describe.skipIf(adminUrl === undefined || adminUrl === "")("Guidance access against PostgreSQL", () => {
  const database = `dh_registry_guidance_access_${randomBytes(6).toString("hex")}`;
  let admin: pg.Client;
  let owner: pg.Client;
  let appPool: pg.Pool;
  let db: RegistryDb;
  let server: Server;
  let base: string;

  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  const KEY_ID = "registry-key-2026-10";

  let tenantA: UuidV7;
  let credentialA: string;
  let credentialB: string;
  let tenantB: UuidV7;

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

  const retentionGet = (token: string | undefined) =>
    fetch(`${base}${GUIDANCE_ACCESS_API_PATHS.retention}`, {
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    });

  async function expectRefused(response: Response, status: number, code: string, subject?: string): Promise<void> {
    const body: unknown = await response.json();
    expect([response.status, body]).toMatchObject([status, subject === undefined ? { code } : { code, subject }]);
  }

  async function changeCount(table: string, tenantId: UuidV7): Promise<number> {
    const { rows } = await owner.query<{ n: number }>(
      `select count(*)::int as n from ${table} where tenant_id = $1`,
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
    const appUrl = withDatabase(adminUrl ?? "", database, APP_ROLE);
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
    tenantB = b.tenantId;
    credentialB = b.serviceCredential;

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
      ["owner", "sam@acme.io"],
      ["builder", "bo@acme.io"],
      ["bob", "bob@bolt.io"],
      ["ola", "ola@bolt.io"],
    ] as const) {
      auth[who] = { authorization: `Bearer ${await sessionToken(email)}` };
    }
  }, 60_000);

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await endPool(appPool);
    await owner.end();
    await admin.query(`drop database if exists ${database} with (force)`);
    await admin.end();
  }, 60_000);

  describe("migration 0016 (guidance_role_grant_changes, guidance_retention_changes)", () => {
    it("enables and forces RLS with tenant_isolation and grants SELECT and INSERT only to dh_registry_app", async () => {
      for (const table of ["guidance_role_grant_changes", "guidance_retention_changes"]) {
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
        "update guidance_role_grant_changes set granted = not granted",
        "delete from guidance_role_grant_changes",
        "update guidance_retention_changes set days = 1",
        "delete from guidance_retention_changes",
      ]) {
        await expect(
          withTenant(db, tenantA, async (tx) => {
            await tx.execute(sql.raw(statement));
          }),
        ).rejects.toThrow();
      }
    });
  });

  describe("access state", () => {
    it("starts pristine: no grant, the 90-day default, never changed", async () => {
      for (const who of ["buyer", "owner", "builder"]) {
        const response = await get(GUIDANCE_ACCESS_API_PATHS.access, who);
        expect(response.status).toBe(200);
        const state: unknown = await response.json();
        expect(isGuidanceAccessState(state)).toBe(true);
        expect(state).toEqual({ grantedRoles: [], retentionDays: 90, updatedAt: null });
      }
    });

    it("lets the Buyer set the grant and retention, appending one row per change", async () => {
      const response = await post(
        GUIDANCE_ACCESS_API_PATHS.access,
        "buyer",
        accessBody({ "Standard owner": true, Builder: false }, 30),
      );
      expect(response.status).toBe(200);
      const state: unknown = await response.json();
      expect(state).toMatchObject({ grantedRoles: ["Standard owner"], retentionDays: 30 });
      expect(isGuidanceAccessState(state)).toBe(true);
      expect(await changeCount("guidance_role_grant_changes", tenantA)).toBe(1);
      expect(await changeCount("guidance_retention_changes", tenantA)).toBe(1);
    });

    it("answers the same state with nothing written on an identical POST", async () => {
      const response = await post(
        GUIDANCE_ACCESS_API_PATHS.access,
        "buyer",
        accessBody({ "Standard owner": true, Builder: false }, 30),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ grantedRoles: ["Standard owner"], retentionDays: 30 });
      expect(await changeCount("guidance_role_grant_changes", tenantA)).toBe(1);
      expect(await changeCount("guidance_retention_changes", tenantA)).toBe(1);
    });

    it("appends only the rows that changed on a partial change", async () => {
      const response = await post(
        GUIDANCE_ACCESS_API_PATHS.access,
        "buyer",
        accessBody({ "Standard owner": true, Builder: false }, 45),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ grantedRoles: ["Standard owner"], retentionDays: 45 });
      expect(await changeCount("guidance_role_grant_changes", tenantA)).toBe(1);
      expect(await changeCount("guidance_retention_changes", tenantA)).toBe(2);
    });

    it("refuses a non-Buyer with role_denied and writes nothing", async () => {
      for (const who of ["owner", "builder"]) {
        const response = await post(
          GUIDANCE_ACCESS_API_PATHS.access,
          who,
          accessBody({ "Standard owner": false, Builder: false }, 90),
        );
        await expectRefused(response, 403, "role_denied", "role");
      }
      expect(await changeCount("guidance_role_grant_changes", tenantA)).toBe(1);
      expect(await changeCount("guidance_retention_changes", tenantA)).toBe(2);
    });

    it("refuses malformed bodies with invalid_input and writes nothing", async () => {
      const cases: [unknown, string][] = [
        [{ retentionDays: 30 }, "grants"],
        [{ grants: { "Standard owner": true, Builder: false } }, "retentionDays"],
        [accessBody({ "Standard owner": "yes" as unknown as boolean, Builder: false }, 30), "Standard owner"],
        [accessBody({ "Standard owner": true }, 30), "grants"],
        [{ grants: { "Standard owner": true, Builder: false, Admin: true }, retentionDays: 30 }, "Admin"],
        [accessBody({ "Standard owner": true, Builder: false }, 0), "retentionDays"],
        [accessBody({ "Standard owner": true, Builder: false }, 3651), "retentionDays"],
        [{ ...accessBody({ "Standard owner": true, Builder: false }, 30), note: 1 }, "note"],
      ];
      for (const [body, subject] of cases) {
        const response = await post(GUIDANCE_ACCESS_API_PATHS.access, "buyer", body);
        await expectRefused(response, 400, "invalid_input", subject);
      }
      expect(await changeCount("guidance_role_grant_changes", tenantA)).toBe(1);
      expect(await changeCount("guidance_retention_changes", tenantA)).toBe(2);
    });

    it("keeps tenants isolated: tenant B starts pristine and configures its own state", async () => {
      const pristine = await get(GUIDANCE_ACCESS_API_PATHS.access, "bob");
      expect(await pristine.json()).toEqual({ grantedRoles: [], retentionDays: 90, updatedAt: null });
      const response = await post(
        GUIDANCE_ACCESS_API_PATHS.access,
        "bob",
        accessBody({ "Standard owner": true, Builder: false }, 60),
      );
      expect(await response.json()).toMatchObject({ grantedRoles: ["Standard owner"], retentionDays: 60 });
      expect(await changeCount("guidance_role_grant_changes", tenantB)).toBe(1);
      expect(await changeCount("guidance_retention_changes", tenantB)).toBe(1);
      const again = await get(GUIDANCE_ACCESS_API_PATHS.access, "buyer");
      expect(await again.json()).toMatchObject({ grantedRoles: ["Standard owner"], retentionDays: 45 });
    });
  });

  describe("role tokens", () => {
    function checkSignature(token: string, tenantId: UuidV7): void {
      const parts = token.split(".");
      expect(parts).toHaveLength(3);
      const [keyId, body, signature] = parts as [string, string, string];
      expect(keyId).toBe(KEY_ID);
      const payload: unknown = decodeRoleTokenBody(body);
      expect(isGuidanceRoleTokenPayload(payload)).toBe(true);
      expect(payload).toMatchObject({ tenantId });
      const ok = verify(null, Buffer.from(body, "utf8"), publicKey, Buffer.from(fromBase64Url(signature), "base64"));
      expect(ok).toBe(true);
      if (isGuidanceRoleTokenPayload(payload)) {
        const windowMs = Date.parse(payload.expiresAt) - Date.parse(payload.issuedAt);
        expect(windowMs).toBe(5 * 60 * 1000);
      }
    }

    it("mints for the Buyer without a stored row, scoped to the Buyer's tenant", async () => {
      const response = await post(GUIDANCE_ACCESS_API_PATHS.tokens, "buyer", {});
      expect(response.status).toBe(201);
      const minted: unknown = await response.json();
      expect(isGuidanceRoleToken(minted)).toBe(true);
      expect(minted).toMatchObject({ role: "Buyer" });
      if (typeof minted === "object" && minted !== null) {
        checkSignature((minted as { token: string }).token, tenantA);
      }
    });

    it("refuses an ungranted role with role_denied and mints once granted", async () => {
      const denied = await post(GUIDANCE_ACCESS_API_PATHS.tokens, "builder", {});
      await expectRefused(denied, 403, "role_denied", "role");
      const granted = await post(GUIDANCE_ACCESS_API_PATHS.tokens, "owner", {});
      expect(granted.status).toBe(201);
      const minted: unknown = await granted.json();
      expect(minted).toMatchObject({ role: "Standard owner" });
      if (typeof minted === "object" && minted !== null) {
        checkSignature((minted as { token: string }).token, tenantA);
      }
    });

    it("reflects a revoke in new mints", async () => {
      const revoked = await post(
        GUIDANCE_ACCESS_API_PATHS.access,
        "buyer",
        accessBody({ "Standard owner": false, Builder: false }, 45),
      );
      expect(await revoked.json()).toMatchObject({ grantedRoles: [] });
      const denied = await post(GUIDANCE_ACCESS_API_PATHS.tokens, "owner", {});
      await expectRefused(denied, 403, "role_denied", "role");
    });

    it("refuses a non-empty body and an unknown session", async () => {
      const response = await post(GUIDANCE_ACCESS_API_PATHS.tokens, "buyer", { intent: "mint" });
      await expectRefused(response, 400, "invalid_input", "body");
      const forged = await fetch(`${base}${GUIDANCE_ACCESS_API_PATHS.tokens}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer forged" },
        body: "{}",
      });
      await expectRefused(forged, 401, "session_invalid", "session");
    });
  });

  describe("retention for the service sweep", () => {
    it("answers the tenant's retention days to its service credential", async () => {
      const response = await retentionGet(credentialA);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ retentionDays: 45 });
    });

    it("scopes the retention days per tenant: tenant B reads its own configured value", async () => {
      const response = await retentionGet(credentialB);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ retentionDays: 60 });
    });

    it("answers 401 session_invalid for a missing or wrong credential", async () => {
      await expectRefused(await retentionGet(undefined), 401, "session_invalid", "session");
      await expectRefused(await retentionGet("wrong"), 401, "session_invalid", "session");
    });
  });
});
