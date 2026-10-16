// Database suite for Modules and Standard-owner assignments: runs against a
// real PostgreSQL 18 named by REGISTRY_TEST_DATABASE_URL (an admin
// connection). Like the other suites it creates a throwaway database,
// migrates it as the admin (owner) and runs every data-access call as
// dh_registry_app (`-c role=dh_registry_app`).
import type { AddressInfo } from "node:net";
import { ed25519SignerFromEnv } from "../bundles/sign.ts";
import { randomBytes, generateKeyPairSync } from "node:crypto";
import { sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isModuleInfo, isModuleList, isUuidV7 } from "@domain-harness/contract";
import type { ModuleInfo, SessionInfo, UuidV7 } from "@domain-harness/contract";
import { createRegistryDb } from "../db/client.ts";
import type { RegistryDb } from "../db/client.ts";
import { migrate } from "../db/migrate.ts";
import { moduleOwnerAssignments, modules } from "../db/schema.ts";
import { withTenant } from "../db/tenant-scope.ts";
import { createRegistryServer } from "../http/server.ts";
import { mintUuidV7 } from "../ids.ts";
import { MemoryTransport } from "../mail/memory.ts";
import { consumeSignInLink, createSignInService, requestSignInLinks } from "../sign-in/service.ts";
import { createStandardService } from "../standards/service.ts";
import { provisionCompany } from "../tenancy/provision.ts";
import { assignModuleOwner, createModule, createModuleService, listModules } from "./service.ts";
import { createProjectService } from "../projects/service.ts";
import { createLockedRuleService } from "../locked-rules/service.ts";
import { createApplicationService } from "../applications/service.ts";
import { createBoilerplateService } from "../boilerplate/service.ts";
import { createCompilationsService } from "../compilations/service.ts";
import { createGuidanceAccessService } from "../guidance-access/service.ts";
import { createAcceptedDeviationsService } from "../accepted-deviations/service.ts";
import { createAcceptedDeviationAlertsService } from "../accepted-deviation-alerts/service.ts";
import { createGuidanceEndpointService } from "../guidance-endpoint/service.ts";
import { createBuildGrantService } from "../build-grants/service.ts";
import { createChildPermissionService } from "../child-permissions/service.ts";

const ENV = "REGISTRY_TEST_DATABASE_URL";
const adminUrl = process.env[ENV];
const inCi = process.env["CI"] !== undefined && process.env["CI"] !== "" && process.env["CI"] !== "false";
const APP_ROLE = "dh_registry_app";
const MIGRATION_SUITE_LOCK = 7_202_610_103;
const JSON_HEADERS = { "content-type": "application/json" };
const INSUFFICIENT_PRIVILEGE = "42501";

if (adminUrl === undefined || adminUrl === "") {
  if (inCi) {
    describe("modules database suite", () => {
      it(`requires ${ENV} when CI is set`, () => {
        expect.fail(`${ENV} is not set; CI must run the database suite against PostgreSQL 18`);
      });
    });
  } else {
    process.stderr.write(`modules.db.test.ts skipped: ${ENV} is not set (see README, "Database")\n`);
  }
}

function withDatabase(url: string, database: string, role?: string): string {
  const next = new URL(url);
  next.pathname = `/${database}`;
  if (role !== undefined) next.searchParams.set("options", `-c role=${role}`);
  return next.toString();
}

/** The Postgres error code anywhere in the cause chain (Drizzle wraps driver errors). */
function pgCode(error: unknown): unknown {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth += 1) {
    const candidate = current as { code?: unknown; cause?: unknown };
    if (typeof candidate.code === "string" && /^[0-9A-Z]{5}$/.test(candidate.code)) return candidate.code;
    current = candidate.cause;
  }
  return undefined;
}

describe.skipIf(adminUrl === undefined || adminUrl === "")("Modules against PostgreSQL", () => {
  const database = `dh_registry_modules_${randomBytes(6).toString("hex")}`;
  let admin: pg.Client;
  let owner: pg.Client;
  let appPool: pg.Pool;
  let db: RegistryDb;

  let tenantA: UuidV7;
  let tenantB: UuidV7;
  let buyer: SessionInfo;
  let sam: SessionInfo;
  let sue: SessionInfo;
  let builder: SessionInfo;
  let buyerB: SessionInfo;
  let tomB: SessionInfo;

  async function counts(): Promise<{ modules: number; assignments: number }> {
    const { rows } = await owner.query<{ modules: number; assignments: number }>(
      `select (select count(*) from modules)::int as modules,
              (select count(*) from module_owner_assignments)::int as assignments`,
    );
    const [row] = rows;
    if (row === undefined) throw new Error("no counts");
    return { ...row };
  }

  async function assignmentRows(moduleId: string) {
    const { rows } = await owner.query<{
      sequence: number;
      owner_account_id: string;
      assigned_by: string;
      assigned_at: Date;
      tenant_id: string;
    }>(
      `select sequence, owner_account_id::text, assigned_by::text, assigned_at, tenant_id::text
       from module_owner_assignments where module_id = $1 order by sequence`,
      [moduleId],
    );
    return rows;
  }

  let nameCounter = 0;
  const freshName = (): string => {
    nameCounter += 1;
    return `Module ${String(nameCounter)}`;
  };

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
    appPool = new pg.Pool({ connectionString: withDatabase(adminUrl ?? "", database, APP_ROLE), max: 6 });
    db = createRegistryDb(appPool);

    const a = await provisionCompany(db, {
      company: "Acme",
      accounts: [
        { name: "Bea Buyer", email: "bea@acme.io", role: "Buyer" },
        { name: "Sam Owner", email: "sam@acme.io", role: "Standard owner" },
        { name: "Sue Owner", email: "sue@acme.io", role: "Standard owner" },
        { name: "Bo Builder", email: "bo@acme.io", role: "Builder" },
      ],
    });
    const b = await provisionCompany(db, {
      company: "Bolt",
      accounts: [
        { name: "Bob Buyer", email: "bob@bolt.io", role: "Buyer" },
        { name: "Tom Owner", email: "tom@bolt.io", role: "Standard owner" },
      ],
    });
    tenantA = a.tenantId;
    tenantB = b.tenantId;
    const session = (tenantId: UuidV7, account: { id: UuidV7; role: SessionInfo["role"] } | undefined) => {
      if (account === undefined) throw new Error("missing account");
      return { accountId: account.id, tenantId, role: account.role };
    };
    [buyer, sam, sue, builder] = a.accounts.map((account) => session(tenantA, account)) as [
      SessionInfo,
      SessionInfo,
      SessionInfo,
      SessionInfo,
    ];
    [buyerB, tomB] = b.accounts.map((account) => session(tenantB, account)) as [SessionInfo, SessionInfo];
  }, 60_000);

  afterAll(async () => {
    await appPool.end();
    await owner.end();
    await admin.query(`drop database if exists ${database} with (force)`);
    await admin.end();
  }, 60_000);

  describe("migration 0003", () => {
    it("enables and forces RLS with the tenant_isolation policy on both tables", async () => {
      const { rows } = await owner.query<{ relname: string; rls: boolean; forced: boolean; policies: string[] }>(
        `select c.relname, c.relrowsecurity as rls, c.relforcerowsecurity as forced,
                array(select p.polname::text from pg_policy p where p.polrelid = c.oid order by 1) as policies
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname in ('modules', 'module_owner_assignments') order by 1`,
      );
      expect(rows).toEqual([
        { relname: "module_owner_assignments", rls: true, forced: true, policies: ["tenant_isolation"] },
        { relname: "modules", rls: true, forced: true, policies: ["tenant_isolation"] },
      ]);
    });

    it("grants the app role SELECT and INSERT only on both tables, and no column UPDATE", async () => {
      const { rows } = await owner.query<{ table_name: string; privilege_type: string }>(
        `select table_name, privilege_type from information_schema.role_table_grants
         where grantee = $1 and table_name in ('modules', 'module_owner_assignments') order by 1, 2`,
        [APP_ROLE],
      );
      expect(rows).toEqual([
        { table_name: "module_owner_assignments", privilege_type: "INSERT" },
        { table_name: "module_owner_assignments", privilege_type: "SELECT" },
        { table_name: "modules", privilege_type: "INSERT" },
        { table_name: "modules", privilege_type: "SELECT" },
      ]);
      const columns = await owner.query(
        `select 1 from information_schema.column_privileges
         where grantee = $1 and privilege_type = 'UPDATE' and table_name in ('modules', 'module_owner_assignments')`,
        [APP_ROLE],
      );
      expect(columns.rowCount).toBe(0);
    });

    it("has no owner column on modules", async () => {
      const { rows } = await owner.query<{ column_name: string }>(
        "select column_name from information_schema.columns where table_name = 'modules' order by ordinal_position",
      );
      expect(rows.map((r) => r.column_name)).toEqual(["id", "tenant_id", "kind", "name", "created_by", "created_at"]);
    });
  });

  describe("creating a Module", () => {
    it("stores a trimmed name, a registry-minted UUIDv7 id, the creator and no owner", async () => {
      const before = await counts();
      const created = await createModule(db, buyer, { kind: "code-stack", name: " Code stack " });
      expect(isModuleInfo(created)).toBe(true);
      expect(created).toMatchObject({ kind: "code-stack", name: "Code stack", owner: null });
      expect(isUuidV7(created.id)).toBe(true);

      const { rows } = await owner.query<{ tenant_id: string; created_by: string; name: string }>(
        "select tenant_id::text, created_by::text, name from modules where id = $1",
        [created.id],
      );
      expect(rows).toEqual([{ tenant_id: tenantA, created_by: buyer.accountId, name: "Code stack" }]);
      expect(await counts()).toEqual({ modules: before.modules + 1, assignments: before.assignments });
    });

    it("creates a design-system Module", async () => {
      const created = await createModule(db, buyer, { kind: "design-system", name: "Design system" });
      expect(created.kind).toBe("design-system");
    });

    it.each([
      ["an unknown kind", { kind: "brand", name: "Brand" }, "kind"],
      ["a missing kind", { kind: undefined, name: "No kind" }, "kind"],
      ["an empty name", { kind: "code-stack", name: "" }, "name"],
      ["a blank name", { kind: "code-stack", name: "   " }, "name"],
      ["a 121-character name", { kind: "code-stack", name: "x".repeat(121) }, "name"],
      ["a missing name", { kind: "code-stack", name: undefined }, "name"],
    ])("refuses %s with invalid_input and stores nothing", async (_label, input, subject) => {
      const before = await counts();
      await expect(createModule(db, buyer, input)).rejects.toMatchObject({ code: "invalid_input", subject });
      expect(await counts()).toEqual(before);
    });

    it("refuses a name another Module of the tenant has, case-insensitively, with module_name_taken", async () => {
      const before = await counts();
      await expect(createModule(db, buyer, { kind: "design-system", name: "code STACK" })).rejects.toMatchObject({
        code: "module_name_taken",
        subject: "name",
      });
      expect(await counts()).toEqual(before);
    });

    it("lets another tenant use the same name", async () => {
      const created = await createModule(db, buyerB, { kind: "code-stack", name: "Code stack" });
      expect(created.name).toBe("Code stack");
    });

    it.each([
      ["a Standard owner", () => sam],
      ["a Builder", () => builder],
    ])("refuses %s with role_denied before validating, and stores nothing", async (_label, who) => {
      const before = await counts();
      await expect(createModule(db, who(), { kind: "code-stack", name: freshName() })).rejects.toMatchObject({
        code: "role_denied",
        subject: "role",
      });
      await expect(createModule(db, who(), { kind: "brand", name: "" })).rejects.toMatchObject({ code: "role_denied" });
      expect(await counts()).toEqual(before);
    });
  });

  describe("assigning the Standard owner", () => {
    let module: ModuleInfo;

    beforeAll(async () => {
      module = await createModule(db, buyer, { kind: "code-stack", name: freshName() });
    });

    it("assigns an ownerless Module: one row, sequence 1, with who and when", async () => {
      const started = Date.now();
      const result = await assignModuleOwner(db, buyer, module.id, { accountId: sam.accountId });
      expect(isModuleInfo(result)).toBe(true);
      expect(result.owner).toMatchObject({
        accountId: sam.accountId,
        name: "Sam Owner",
        assignedBy: { accountId: buyer.accountId, name: "Bea Buyer" },
      });
      expect(Date.parse(result.owner?.assignedAt ?? "")).toBeGreaterThanOrEqual(started - 5_000);

      const rows = await assignmentRows(module.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        sequence: 1,
        owner_account_id: sam.accountId,
        assigned_by: buyer.accountId,
        tenant_id: tenantA,
      });
    });

    it("reassigns: the latest owner is current and both rows remain unchanged", async () => {
      const [first] = await assignmentRows(module.id);
      const result = await assignModuleOwner(db, buyer, module.id, { accountId: sue.accountId });
      expect(result.owner?.accountId).toBe(sue.accountId);

      const rows = await assignmentRows(module.id);
      expect(rows.map((r) => [r.sequence, r.owner_account_id, r.assigned_by])).toEqual([
        [1, sam.accountId, buyer.accountId],
        [2, sue.accountId, buyer.accountId],
      ]);
      expect(rows[0]).toEqual(first);

      const listed = (await listModules(db, builder)).modules.find((m) => m.id === module.id);
      expect(listed?.owner?.accountId).toBe(sue.accountId);
    });

    it("assigning the current owner again is a no-op with no new row", async () => {
      const before = await assignmentRows(module.id);
      const result = await assignModuleOwner(db, buyer, module.id, { accountId: sue.accountId });
      expect(result.owner?.accountId).toBe(sue.accountId);
      expect(result.owner?.assignedAt).toBe(before[1]?.assigned_at.toISOString());
      expect(await assignmentRows(module.id)).toEqual(before);
    });

    it.each([
      ["a Builder account", () => builder.accountId],
      ["a Buyer account", () => buyer.accountId],
      ["an unknown account", () => mintUuidV7()],
      ["another tenant's Standard owner", () => tomB.accountId],
      ["a malformed id", () => "not-an-id"],
      ["a missing id", () => undefined],
    ])("refuses %s with invalid_input on accountId and writes nothing", async (_label, accountId) => {
      const before = await counts();
      await expect(assignModuleOwner(db, buyer, module.id, { accountId: accountId() })).rejects.toMatchObject({
        code: "invalid_input",
        subject: "accountId",
      });
      expect(await counts()).toEqual(before);
    });

    it.each([
      ["a random UUIDv7", () => mintUuidV7()],
      ["a non-UUID id", () => "nope"],
    ])("refuses %s Module with module_not_found", async (_label, moduleId) => {
      const before = await counts();
      await expect(assignModuleOwner(db, buyer, moduleId(), { accountId: sam.accountId })).rejects.toMatchObject({
        code: "module_not_found",
        subject: "moduleId",
      });
      expect(await counts()).toEqual(before);
    });

    it("refuses another tenant's Module with module_not_found", async () => {
      const foreign = await createModule(db, buyerB, { kind: "design-system", name: freshName() });
      const before = await counts();
      await expect(assignModuleOwner(db, buyer, foreign.id, { accountId: sam.accountId })).rejects.toMatchObject({
        code: "module_not_found",
      });
      expect(await counts()).toEqual(before);
    });

    it.each([
      ["a Standard owner", () => sam],
      ["a Builder", () => builder],
    ])("refuses %s with role_denied before any lookup, and writes nothing", async (_label, who) => {
      const before = await counts();
      await expect(assignModuleOwner(db, who(), module.id, { accountId: sam.accountId })).rejects.toMatchObject({
        code: "role_denied",
      });
      await expect(assignModuleOwner(db, who(), "nope", { accountId: "x" })).rejects.toMatchObject({
        code: "role_denied",
      });
      expect(await counts()).toEqual(before);
    });

    it("serialises concurrent reassignments: sequences 1 and 2, exactly one current owner", async () => {
      const fresh = await createModule(db, buyer, { kind: "design-system", name: freshName() });
      const results = await Promise.all([
        assignModuleOwner(db, buyer, fresh.id, { accountId: sam.accountId }),
        assignModuleOwner(db, buyer, fresh.id, { accountId: sue.accountId }),
      ]);
      expect(results.map((r) => r.owner?.accountId).sort()).toEqual([sam.accountId, sue.accountId].sort());
      const rows = await assignmentRows(fresh.id);
      expect(rows.map((r) => r.sequence)).toEqual([1, 2]);
      const listed = (await listModules(db, buyer)).modules.find((m) => m.id === fresh.id);
      expect(listed?.owner?.accountId).toBe(rows[1]?.owner_account_id);
    });
  });

  describe("listing", () => {
    it("lists the tenant's Modules oldest first with current owners, and only its Standard owners", async () => {
      const list = await listModules(db, builder);
      expect(isModuleList(list)).toBe(true);
      expect(list.modules.length).toBeGreaterThan(0);
      expect(list.modules[0]).toMatchObject({ name: "Code stack", kind: "code-stack", owner: null });
      expect(list.standardOwners).toEqual([
        { accountId: sam.accountId, name: "Sam Owner" },
        { accountId: sue.accountId, name: "Sue Owner" },
      ]);
      const other = await listModules(db, tomB);
      expect(other.standardOwners).toEqual([{ accountId: tomB.accountId, name: "Tom Owner" }]);
      expect(other.modules.every((m) => !list.modules.some((n) => n.id === m.id))).toBe(true);
    });
  });

  describe("append-only and tenant isolation", () => {
    it.each([
      ["UPDATE modules", sql`update modules set name = 'Renamed'`],
      ["DELETE modules", sql`delete from modules`],
      ["UPDATE module_owner_assignments", sql`update module_owner_assignments set sequence = sequence + 100`],
      ["DELETE module_owner_assignments", sql`delete from module_owner_assignments`],
    ])("the runtime role cannot %s (permission denied)", async (_label, statement) => {
      const before = await counts();
      const error: unknown = await withTenant(db, tenantA, (tx) => tx.execute(statement)).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(pgCode(error)).toBe(INSUFFICIENT_PRIVILEGE);
      expect(await counts()).toEqual(before);
    });

    it("RLS returns only the context tenant's rows when the tenant filter is omitted", async () => {
      const seen = await withTenant(db, tenantA, async (tx) => ({
        // Deliberately no `where tenant_id = ...`: RLS alone must hold.
        modules: await tx.select().from(modules),
        assignments: await tx.select().from(moduleOwnerAssignments),
      }));
      expect(seen.modules.length).toBeGreaterThan(0);
      expect(seen.assignments.length).toBeGreaterThan(0);
      expect(seen.modules.every((row) => row.tenantId === tenantA)).toBe(true);
      expect(seen.assignments.every((row) => row.tenantId === tenantA)).toBe(true);

      const all = await owner.query<{ n: number }>("select count(distinct tenant_id)::int as n from modules");
      expect(all.rows[0]?.n).toBe(2);
      const raw = await appPool.query<{ m: number; a: number }>(
        "select (select count(*) from modules)::int as m, (select count(*) from module_owner_assignments)::int as a",
      );
      expect(raw.rows).toEqual([{ m: 0, a: 0 }]);
    });

    it("refuses to write a Module or an assignment into another tenant from A's context", async () => {
      const before = await counts();
      await expect(
        withTenant(db, tenantA, (tx) =>
          tx.insert(modules).values({
            id: mintUuidV7(),
            tenantId: tenantB,
            kind: "code-stack",
            name: freshName(),
            createdBy: buyerB.accountId,
          }),
        ),
      ).rejects.toThrow();
      expect(await counts()).toEqual(before);
    });

    it("refuses at the database an assignment whose owner belongs to another tenant (composite FK)", async () => {
      const module = await createModule(db, buyer, { kind: "code-stack", name: freshName() });
      const before = await counts();
      await expect(
        withTenant(db, tenantA, (tx) =>
          tx.insert(moduleOwnerAssignments).values({
            id: mintUuidV7(),
            tenantId: tenantA,
            moduleId: module.id,
            sequence: 1,
            ownerAccountId: tomB.accountId,
            assignedBy: buyer.accountId,
          }),
        ),
      ).rejects.toThrow();
      expect(await counts()).toEqual(before);
    });
  });

  describe("over HTTP", () => {
    it("lists, creates, assigns and refuses end to end with the session as a Bearer token", async () => {
      const mail = new MemoryTransport();
      const { privateKey: guidanceAccessKey } = generateKeyPairSync("ed25519");
      const guidanceAccessSigner = ed25519SignerFromEnv({
        REGISTRY_BUNDLE_SIGNING_KEY: guidanceAccessKey.export({ type: "pkcs8", format: "pem" }) as string,
        REGISTRY_BUNDLE_SIGNING_KEY_ID: "guidance-access-test-key",
      });

      const server = createRegistryServer(
        {
          signIn: createSignInService(db, mail, { panelUrl: "http://panel.test" }),
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
          guidanceAccess: createGuidanceAccessService(db, guidanceAccessSigner),
        },
        () => undefined,
      );
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;

      async function sessionToken(email: string): Promise<string> {
        const inbox = new MemoryTransport();
        await requestSignInLinks(db, inbox, { panelUrl: "http://panel.test" }, email);
        const match = /\/sign-in\/verify\?token=(\S+)/.exec(inbox.messages[0]?.text ?? "");
        if (match?.[1] === undefined) throw new Error("no link");
        return (await consumeSignInLink(db, decodeURIComponent(match[1]))).sessionToken;
      }

      try {
        const buyerAuth = { authorization: `Bearer ${await sessionToken("bea@acme.io")}` };
        const builderAuth = { authorization: `Bearer ${await sessionToken("bo@acme.io")}` };
        const name = freshName();

        const created = await fetch(`${base}/v1/modules`, {
          method: "POST",
          headers: { ...JSON_HEADERS, ...buyerAuth },
          body: JSON.stringify({ kind: "design-system", name: ` ${name} ` }),
        });
        expect(created.status).toBe(201);
        const module: unknown = await created.json();
        if (!isModuleInfo(module)) throw new Error("not a ModuleInfo");
        expect(module).toMatchObject({ name, owner: null });

        const assigned = await fetch(`${base}/v1/modules/${module.id}/owner`, {
          method: "POST",
          headers: { ...JSON_HEADERS, ...buyerAuth },
          body: JSON.stringify({ accountId: sam.accountId }),
        });
        expect(assigned.status).toBe(200);
        expect(await assigned.json()).toMatchObject({ owner: { accountId: sam.accountId, name: "Sam Owner" } });

        const before = await counts();
        const denied = await fetch(`${base}/v1/modules/${module.id}/owner`, {
          method: "POST",
          headers: { ...JSON_HEADERS, ...builderAuth },
          body: JSON.stringify({ accountId: sue.accountId }),
        });
        expect(denied.status).toBe(403);
        expect(await denied.json()).toMatchObject({ code: "role_denied", subject: "role" });
        const deniedCreate = await fetch(`${base}/v1/modules`, {
          method: "POST",
          headers: { ...JSON_HEADERS, ...builderAuth },
          body: JSON.stringify({ kind: "code-stack", name: freshName() }),
        });
        expect(deniedCreate.status).toBe(403);
        expect(await counts()).toEqual(before);

        const duplicate = await fetch(`${base}/v1/modules`, {
          method: "POST",
          headers: { ...JSON_HEADERS, ...buyerAuth },
          body: JSON.stringify({ kind: "code-stack", name: name.toUpperCase() }),
        });
        expect(duplicate.status).toBe(409);

        const missing = await fetch(`${base}/v1/modules/nope/owner`, {
          method: "POST",
          headers: { ...JSON_HEADERS, ...buyerAuth },
          body: JSON.stringify({ accountId: sam.accountId }),
        });
        expect(missing.status).toBe(404);
        expect(await missing.json()).toMatchObject({ code: "module_not_found" });

        const listed = await fetch(`${base}/v1/modules`, { headers: builderAuth });
        expect(listed.status).toBe(200);
        const list: unknown = await listed.json();
        if (!isModuleList(list)) throw new Error("not a ModuleList");
        expect(list.modules.find((m) => m.id === module.id)?.owner?.accountId).toBe(sam.accountId);

        const anonymous = await fetch(`${base}/v1/modules`);
        expect(anonymous.status).toBe(401);
        expect(await anonymous.json()).toMatchObject({ code: "session_invalid" });
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    });
  });
});
