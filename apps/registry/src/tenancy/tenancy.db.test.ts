// Database suite: runs against a real PostgreSQL 18 named by
// REGISTRY_TEST_DATABASE_URL (an admin connection, e.g. the compose service).
// It creates a throwaway database, migrates it as the admin (owner), and runs
// every data-access call as dh_registry_app via `SET ROLE` (the connection
// option `-c role=dh_registry_app`), so no login role or password is needed.
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isUuidV7 } from "@domain-harness/contract";
import type { UuidV7 } from "@domain-harness/contract";
import { createRegistryDb } from "../db/client.ts";
import type { RegistryDb } from "../db/client.ts";
import { migrate } from "../db/migrate.ts";
import { accounts, projects, tenants } from "../db/schema.ts";
import { assertRuntimeRoleSafe, withTenant } from "../db/tenant-scope.ts";
import { mintUuidV7 } from "../ids.ts";
import { provisionCompany, writeCompany } from "./provision.ts";
import { getRootProject, getTenant, listAccounts } from "./queries.ts";

const ENV = "REGISTRY_TEST_DATABASE_URL";
const adminUrl = process.env[ENV];
const inCi = process.env["CI"] !== undefined && process.env["CI"] !== "" && process.env["CI"] !== "false";
const APP_ROLE = "dh_registry_app";
const run = promisify(execFile);
const REGISTRY_ROOT = resolve(import.meta.dirname, "../..");
const MIGRATION_SUITE_LOCK = 7_202_610_103;

if (adminUrl === undefined || adminUrl === "") {
  if (inCi) {
    describe("tenancy database suite", () => {
      it(`requires ${ENV} when CI is set`, () => {
        expect.fail(`${ENV} is not set; CI must run the database suite against PostgreSQL 18`);
      });
    });
  } else {
    process.stderr.write(`tenancy.db.test.ts skipped: ${ENV} is not set (see README, "Database")\n`);
  }
}

const acme = () => ({
  company: "Acme",
  accounts: [
    { name: "Bea Buyer", email: "bea@acme.io", role: "Buyer" },
    { name: "Sam Owner", email: " Sam@Acme.io ", role: "Standard owner" },
    { name: "Bo Builder", email: "bo@acme.io", role: "Builder" },
  ],
});

function withDatabase(url: string, database: string, role?: string): string {
  const next = new URL(url);
  next.pathname = `/${database}`;
  if (role !== undefined) next.searchParams.set("options", `-c role=${role}`);
  return next.toString();
}

describe.skipIf(adminUrl === undefined || adminUrl === "")("tenancy against PostgreSQL", () => {
  const database = `dh_registry_test_${randomBytes(6).toString("hex")}`;
  let admin: pg.Client;
  let owner: pg.Client;
  let appPool: pg.Pool;
  let db: RegistryDb;
  let ownerUrl: string;
  let appUrl: string;

  async function counts(): Promise<Record<string, number>> {
    const { rows } = await owner.query<{ tenants: number; accounts: number; projects: number }>(
      `select (select count(*) from tenants)::int as tenants,
              (select count(*) from accounts)::int as accounts,
              (select count(*) from projects)::int as projects`,
    );
    const [row] = rows;
    if (row === undefined) throw new Error("no counts");
    return { ...row };
  }

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`create database ${database}`);
    ownerUrl = withDatabase(adminUrl ?? "", database);
    appUrl = withDatabase(adminUrl ?? "", database, APP_ROLE);
    owner = new pg.Client({ connectionString: ownerUrl });
    await owner.connect();
    // Roles are cluster-wide: serialise migrations with any other database
    // suite running in parallel (advisory locks are per database, and every
    // suite's admin connection uses the same one).
    await admin.query("select pg_advisory_lock($1)", [MIGRATION_SUITE_LOCK]);
    try {
      await migrate(owner);
    } finally {
      await admin.query("select pg_advisory_unlock($1)", [MIGRATION_SUITE_LOCK]);
    }
    appPool = new pg.Pool({ connectionString: appUrl, max: 4 });
    db = createRegistryDb(appPool);
  }, 60_000);

  afterAll(async () => {
    await appPool.end();
    await owner.end();
    await admin.query(`drop database if exists ${database} with (force)`);
    await admin.end();
  }, 60_000);

  describe("migration", () => {
    it("creates only the tenancy, sign-in, Module, Standard and Project tree tables and registry_migrations", async () => {
      const { rows } = await owner.query<{ relname: string }>(
        `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm') order by 1`,
      );
      expect(rows.map((r) => r.relname)).toEqual([
        "accounts",
        "module_owner_assignments",
        "modules",
        "project_parent_changes",
        "projects",
        "registry_migrations",
        "sessions",
        "sign_in_links",
        "standard_versions",
        "standards",
        "tenants",
      ]);
    });

    it("enables and forces RLS on every tenant table, owned by someone other than the app role", async () => {
      const { rows } = await owner.query<{ relname: string; rls: boolean; forced: boolean; owner: string }>(
        `select c.relname, c.relrowsecurity as rls, c.relforcerowsecurity as forced, pg_get_userbyid(c.relowner) as owner
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public'
           and c.relname in ('tenants', 'accounts', 'projects', 'sign_in_links', 'sessions', 'modules', 'module_owner_assignments',
                             'standards', 'standard_versions', 'project_parent_changes')
         order by 1`,
      );
      expect(rows).toHaveLength(10);
      for (const row of rows) {
        expect(row).toMatchObject({ rls: true, forced: true });
        expect(row.owner).not.toBe(APP_ROLE);
      }
    });

    it("leaves the app role a NOLOGIN, non-bypassing role that owns nothing and may only SELECT and INSERT (whole tables)", async () => {
      const role = await owner.query<{ rolcanlogin: boolean; rolsuper: boolean; rolbypassrls: boolean }>(
        "select rolcanlogin, rolsuper, rolbypassrls from pg_roles where rolname = $1",
        [APP_ROLE],
      );
      expect(role.rows).toEqual([{ rolcanlogin: false, rolsuper: false, rolbypassrls: false }]);

      const owned = await owner.query(
        "select 1 from pg_class where relowner = (select oid from pg_roles where rolname = $1)",
        [APP_ROLE],
      );
      expect(owned.rowCount).toBe(0);

      const privileges = await owner.query<{ table_name: string; privilege_type: string }>(
        `select table_name, privilege_type from information_schema.role_table_grants
         where grantee = $1 order by 1, 2`,
        [APP_ROLE],
      );
      expect(privileges.rows).toEqual(
        [
          "accounts",
          "module_owner_assignments",
          "modules",
          "project_parent_changes",
          "projects",
          "sessions",
          "sign_in_links",
          "standard_versions",
          "standards",
          "tenants",
        ].flatMap((t) => [
          { table_name: t, privilege_type: "INSERT" },
          { table_name: t, privilege_type: "SELECT" },
        ]),
      );
    });

    it("is idempotent: a second run applies nothing", async () => {
      const report = await migrate(owner);
      expect(report).toEqual({ applied: [], alreadyApplied: 6 });
    });

    it("rejects a misnamed .sql file before applying anything", async () => {
      const dir = await mkdtemp(join(tmpdir(), "dh-migrations-"));
      try {
        await writeFile(join(dir, "0001_ok.sql"), "create table should_not_exist (id int);");
        await writeFile(join(dir, "Bad Name.sql"), "select 1;");
        await expect(migrate(owner, dir)).rejects.toMatchObject({ code: "invalid_migration_name", subject: "Bad Name.sql" });
        const table = await owner.query("select to_regclass('public.should_not_exist') as t");
        expect(table.rows).toEqual([{ t: null }]);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it("rolls back a failed migration, keeps earlier ones, and applies it once fixed", async () => {
      const scratch = `dh_registry_migrate_${randomBytes(6).toString("hex")}`;
      const dir = await mkdtemp(join(tmpdir(), "dh-migrations-"));
      await admin.query(`create database ${scratch}`);
      const client = new pg.Client({ connectionString: withDatabase(adminUrl ?? "", scratch) });
      await client.connect();
      try {
        await writeFile(join(dir, "0001_good.sql"), "create table good_t (id int);");
        await writeFile(join(dir, "0002_bad.sql"), "create table bad_t (id int);\nselect * from no_such_table;");
        await expect(migrate(client, dir)).rejects.toThrow();

        const recorded = await client.query<{ name: string }>("select name from registry_migrations order by name");
        expect(recorded.rows.map((r) => r.name)).toEqual(["0001_good.sql"]);
        const tables = await client.query("select to_regclass('public.good_t') as good, to_regclass('public.bad_t') as bad");
        expect(tables.rows).toEqual([{ good: "good_t", bad: null }]);

        await writeFile(join(dir, "0002_bad.sql"), "create table bad_t (id int);");
        expect(await migrate(client, dir)).toEqual({ applied: ["0002_bad.sql"], alreadyApplied: 1 });
      } finally {
        await client.end();
        await admin.query(`drop database if exists ${scratch} with (force)`);
        await rm(dir, { recursive: true, force: true });
      }
    });

    it("runs from the operator command", async () => {
      const { stdout } = await run(process.execPath, ["--conditions=@domain-harness/source", "src/db/migrate-cli.ts"], {
        cwd: REGISTRY_ROOT,
        env: { ...process.env, REGISTRY_MIGRATION_DATABASE_URL: ownerUrl },
      });
      expect(JSON.parse(stdout)).toEqual({ applied: [], alreadyApplied: 6 });
    });
  });

  describe("runtime role", () => {
    it("accepts dh_registry_app", async () => {
      await expect(assertRuntimeRoleSafe(db)).resolves.toBeUndefined();
    });

    describe("non-superuser roles", () => {
      const suffix = randomBytes(4).toString("hex");
      const bypass = `dh_test_bypass_${suffix}`;
      const ownerMember = `dh_test_owner_member_${suffix}`;
      const appMember = `dh_test_app_member_${suffix}`;

      beforeAll(async () => {
        const { rows } = await owner.query<{ owner: string }>(
          "select pg_get_userbyid(relowner) as owner from pg_class where relname = 'tenants' and relnamespace = 'public'::regnamespace",
        );
        const tableOwner = pg.escapeIdentifier(rows[0]?.owner ?? "");
        await admin.query(`create role ${bypass} nologin nosuperuser bypassrls`);
        await admin.query(`create role ${ownerMember} nologin nosuperuser nobypassrls in role ${tableOwner}`);
        await admin.query(`create role ${appMember} nologin nosuperuser nobypassrls in role ${APP_ROLE}`);
      });

      afterAll(async () => {
        await admin.query(`drop role if exists ${bypass}, ${ownerMember}, ${appMember}`);
      });

      async function check(role: string): Promise<void> {
        const pool = new pg.Pool({ connectionString: withDatabase(adminUrl ?? "", database, role), max: 1 });
        try {
          await assertRuntimeRoleSafe(createRegistryDb(pool));
        } finally {
          await pool.end();
        }
      }

      it("rejects a BYPASSRLS role", async () => {
        await expect(check(bypass)).rejects.toMatchObject({ code: "unsafe_database_role" });
      });

      it("rejects a member of the table owner", async () => {
        await expect(check(ownerMember)).rejects.toMatchObject({ code: "unsafe_database_role" });
      });

      it("accepts a plain member of dh_registry_app", async () => {
        await expect(check(appMember)).resolves.toBeUndefined();
      });
    });

    it("rejects a superuser / table-owner connection", async () => {
      const pool = new pg.Pool({ connectionString: ownerUrl, max: 1 });
      try {
        await expect(assertRuntimeRoleSafe(createRegistryDb(pool))).rejects.toMatchObject({
          code: "unsafe_database_role",
        });
      } finally {
        await pool.end();
      }
    });
  });

  describe("provisioning", () => {
    it("writes the tenant (plan Team), its root Project and three accounts with UUIDv7 ids", async () => {
      const before = await counts();
      const result = await provisionCompany(db, acme());

      expect(isUuidV7(result.tenantId)).toBe(true);
      expect(isUuidV7(result.rootProjectId)).toBe(true);
      expect(result.plan).toBe("Team");
      expect(result.accounts.map((a) => a.role)).toEqual(["Buyer", "Standard owner", "Builder"]);
      for (const account of result.accounts) expect(isUuidV7(account.id)).toBe(true);

      const tenant = await getTenant(db, result.tenantId);
      expect(tenant).toMatchObject({ id: result.tenantId, name: "Acme", plan: "Team" });
      expect(tenant?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

      const root = await getRootProject(db, result.tenantId);
      expect(root).toMatchObject({ id: result.rootProjectId, tenantId: result.tenantId, parentId: null, name: "Acme" });

      const stored = await listAccounts(db, result.tenantId);
      expect(stored.map(({ id, email, role }) => ({ id, email, role }))).toEqual([
        { id: result.accounts[0]?.id, email: "bea@acme.io", role: "Buyer" },
        { id: result.accounts[1]?.id, email: "sam@acme.io", role: "Standard owner" },
        { id: result.accounts[2]?.id, email: "bo@acme.io", role: "Builder" },
      ]);

      expect(await counts()).toEqual({
        tenants: (before["tenants"] ?? 0) + 1,
        projects: (before["projects"] ?? 0) + 1,
        accounts: (before["accounts"] ?? 0) + 3,
      });
    });

    it("keeps an explicit plan", async () => {
      const result = await provisionCompany(db, { ...acme(), plan: "Business" });
      expect(result.plan).toBe("Business");
      expect((await getTenant(db, result.tenantId))?.plan).toBe("Business");
    });

    it("writes nothing for an invalid role", async () => {
      const before = await counts();
      const input = acme();
      input.accounts[2] = { name: "Al", email: "al@acme.io", role: "Admin" };
      await expect(provisionCompany(db, input)).rejects.toMatchObject({
        code: "invalid_role",
        subject: "accounts[2].role",
      });
      expect(await counts()).toEqual(before);
    });

    it("writes nothing for a duplicate email", async () => {
      const before = await counts();
      const input = acme();
      input.accounts = [
        { name: "A", email: "a@x.io", role: "Buyer" },
        { name: "B", email: " A@X.io ", role: "Builder" },
      ];
      await expect(provisionCompany(db, input)).rejects.toMatchObject({
        code: "duplicate_email",
        subject: "accounts[1].email",
      });
      expect(await counts()).toEqual(before);
    });

    it("maps a database unique violation to duplicate_email and rolls everything back", async () => {
      const before = await counts();
      await expect(
        writeCompany(db, {
          company: "Dup",
          plan: "Team",
          accounts: [
            { name: "A", email: "a@x.io", role: "Buyer" },
            { name: "B", email: "a@x.io", role: "Builder" },
          ],
        }),
      ).rejects.toMatchObject({ code: "duplicate_email", subject: "accounts[1].email" });
      expect(await counts()).toEqual(before);
    });
  });

  describe("tenant isolation", () => {
    let tenantA: UuidV7;
    let tenantB: UuidV7;

    beforeAll(async () => {
      tenantA = (await provisionCompany(db, { ...acme(), company: "Tenant A" })).tenantId;
      tenantB = (await provisionCompany(db, { ...acme(), company: "Tenant B" })).tenantId;
    });

    it("RLS returns only the context tenant's rows when the tenant filter is omitted", async () => {
      const seen = await withTenant(db, tenantA, async (tx) => ({
        // Deliberately no `where tenant_id = ...`: RLS alone must hold.
        accounts: await tx.select().from(accounts),
        projects: await tx.select().from(projects),
        tenants: await tx.select().from(tenants),
      }));
      expect(seen.accounts).toHaveLength(3);
      expect(seen.accounts.every((row) => row.tenantId === tenantA)).toBe(true);
      expect(seen.projects.map((row) => row.tenantId)).toEqual([tenantA]);
      expect(seen.tenants.map((row) => row.id)).toEqual([tenantA]);

      const owner_view = await owner.query("select 1 from tenants");
      expect(owner_view.rowCount).toBeGreaterThan(1);
    });

    it("a filter on another tenant inside A's context returns nothing", async () => {
      const rows = await withTenant(db, tenantA, (tx) => tx.select().from(accounts).where(eq(accounts.tenantId, tenantB)));
      expect(rows).toEqual([]);
      expect(await listAccounts(db, tenantB)).toHaveLength(3);
    });

    it("refuses to write another tenant's row from A's context", async () => {
      await expect(
        withTenant(db, tenantA, (tx) =>
          tx.insert(accounts).values({ id: mintUuidV7(), tenantId: tenantB, name: "X", email: "x@x.io", role: "Builder" }),
        ),
      ).rejects.toThrow();
      expect(await listAccounts(db, tenantB)).toHaveLength(3);
    });

    it("a raw SELECT as dh_registry_app without app.tenant_id sees zero rows", async () => {
      const { rows } = await appPool.query<{ current_user: string; t: number; a: number; p: number }>(
        `select current_user::text as current_user,
                (select count(*) from tenants)::int as t,
                (select count(*) from accounts)::int as a,
                (select count(*) from projects)::int as p`,
      );
      expect(rows).toEqual([{ current_user: APP_ROLE, t: 0, a: 0, p: 0 }]);
    });

    it("the tenant context is transaction-local and does not leak to the next use of the connection", async () => {
      const pool = new pg.Pool({ connectionString: appUrl, max: 1 });
      try {
        const single = createRegistryDb(pool);
        expect(await listAccounts(single, tenantA)).toHaveLength(3);
        const { rows } = await pool.query<{ setting: string | null; a: number }>(
          "select current_setting('app.tenant_id', true) as setting, (select count(*) from accounts)::int as a",
        );
        expect(rows[0]?.a).toBe(0);
        expect(rows[0]?.setting ?? "").toBe("");
      } finally {
        await pool.end();
      }
    });
  });

  describe("operator command", () => {
    let dir: string;

    beforeAll(async () => {
      dir = await mkdtemp(join(tmpdir(), "dh-provision-"));
    });

    afterAll(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    async function provision(file: string, url: string = appUrl, extraEnv: Record<string, string> = {}) {
      try {
        const { stdout, stderr } = await run(
          process.execPath,
          ["--conditions=@domain-harness/source", "src/operator/provision-cli.ts", file],
          { cwd: REGISTRY_ROOT, env: { ...process.env, REGISTRY_DATABASE_URL: url, ...extraEnv } },
        );
        return { code: 0, stdout, stderr };
      } catch (error) {
        const failed = error as { code: number; stdout: string; stderr: string };
        return { code: failed.code, stdout: failed.stdout, stderr: failed.stderr };
      }
    }

    it("provisions from a JSON file and prints ids only", async () => {
      const file = join(dir, "acme.json");
      await writeFile(file, JSON.stringify({ ...acme(), company: "Cli Co", plan: "Enterprise" }));
      const before = await counts();

      const result = await provision(file);
      expect(result.code).toBe(0);
      const printed = JSON.parse(result.stdout) as {
        tenantId: string;
        rootProjectId: string;
        plan: string;
        accounts: { id: string; role: string }[];
      };
      expect(Object.keys(printed)).toEqual(["tenantId", "rootProjectId", "plan", "accounts"]);
      expect(isUuidV7(printed.tenantId) && isUuidV7(printed.rootProjectId)).toBe(true);
      expect(printed.plan).toBe("Enterprise");
      expect(printed.accounts.map((a) => Object.keys(a))).toEqual([
        ["id", "role"],
        ["id", "role"],
        ["id", "role"],
      ]);
      expect(result.stdout).not.toMatch(/Cli Co|Bea Buyer|Sam Owner|Bo Builder|acme\.io/i);
      expect(await counts()).toEqual({
        tenants: (before["tenants"] ?? 0) + 1,
        projects: (before["projects"] ?? 0) + 1,
        accounts: (before["accounts"] ?? 0) + 3,
      });
    });

    it.each([
      ["an invalid role", JSON.stringify({ company: "X", accounts: [{ name: "A", email: "a@x.io", role: "Admin" }] }), "invalid_role"],
      ["bad JSON", "{ not json", "invalid_input"],
    ])("rejects %s: exit 1, one envelope on stderr, nothing written", async (_label, contents, code) => {
      const file = join(dir, `${code}.json`);
      await writeFile(file, contents);
      const before = await counts();

      const result = await provision(file);
      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      const lines = result.stderr.trim().split("\n");
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0] ?? "")).toMatchObject({ code });
      expect(await counts()).toEqual(before);
    });

    it("resolves a relative file path against INIT_CWD (where pnpm was invoked)", async () => {
      await writeFile(join(dir, "relative.json"), JSON.stringify({ ...acme(), company: "Relative Co" }));
      const result = await provision("relative.json", appUrl, { INIT_CWD: dir });
      expect(result.code).toBe(0);
      expect(isUuidV7((JSON.parse(result.stdout) as { tenantId: string }).tenantId)).toBe(true);
    });

    it("rejects a missing file", async () => {
      const result = await provision(join(dir, "missing.json"));
      expect(result.code).toBe(1);
      expect(JSON.parse(result.stderr)).toMatchObject({ code: "invalid_input", subject: "file" });
    });

    it("refuses to run as a superuser / owner connection and writes nothing", async () => {
      const file = join(dir, "owner.json");
      await writeFile(file, JSON.stringify(acme()));
      const before = await counts();
      const result = await provision(file, ownerUrl);
      expect(result.code).toBe(1);
      expect(JSON.parse(result.stderr)).toMatchObject({ code: "unsafe_database_role" });
      expect(await counts()).toEqual(before);
    });
  });
});
