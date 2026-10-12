// Database suite for the Project tree: runs against a real PostgreSQL 18
// named by REGISTRY_TEST_DATABASE_URL (an admin connection). Like the other
// suites it creates a throwaway database, migrates it as the admin (owner)
// and runs every data-access call as dh_registry_app (`-c role=dh_registry_app`).
// Every matrix row is exercised over HTTP with real sessions as Bearer tokens.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isEffectiveStandardSet, isProjectInfo, isProjectTree, isStandardInfo, isUuidV7 } from "@domain-harness/contract";
import type { EffectiveStandardSet, ProjectInfo, ProjectTree, SessionInfo, StandardInfo, UuidV7 } from "@domain-harness/contract";
import { createRegistryDb } from "../db/client.ts";
import type { RegistryDb } from "../db/client.ts";
import { migrate } from "../db/migrate.ts";
import { projectParentChanges, projects } from "../db/schema.ts";
import { withTenant } from "../db/tenant-scope.ts";
import { createRegistryServer } from "../http/server.ts";
import { MemoryTransport } from "../mail/memory.ts";
import { assignModuleOwner, createModule, createModuleService } from "../modules/service.ts";
import { consumeSignInLink, createSignInService, requestSignInLinks } from "../sign-in/service.ts";
import { createStandardService } from "../standards/service.ts";
import { provisionCompany } from "../tenancy/provision.ts";
import { createProjectService } from "./service.ts";

const ENV = "REGISTRY_TEST_DATABASE_URL";
const adminUrl = process.env[ENV];
const inCi = process.env["CI"] !== undefined && process.env["CI"] !== "" && process.env["CI"] !== "false";
const APP_ROLE = "dh_registry_app";
const MIGRATION_SUITE_LOCK = 7_202_610_103;
const INSUFFICIENT_PRIVILEGE = "42501";
const CHECK_VIOLATION = "23514";
const PANEL = { panelUrl: "http://panel.test" };

if (adminUrl === undefined || adminUrl === "") {
  if (inCi) {
    describe("Project tree database suite", () => {
      it(`requires ${ENV} when CI is set`, () => {
        expect.fail(`${ENV} is not set; CI must run the database suite against PostgreSQL 18`);
      });
    });
  } else {
    process.stderr.write(`projects.db.test.ts skipped: ${ENV} is not set (see README, "Database")\n`);
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

describe.skipIf(adminUrl === undefined || adminUrl === "")("Project tree against PostgreSQL", () => {
  const database = `dh_registry_projects_${randomBytes(6).toString("hex")}`;
  let admin: pg.Client;
  let owner: pg.Client;
  let appPool: pg.Pool;
  let db: RegistryDb;
  let server: Server;
  let base: string;

  let tenantA: UuidV7;
  let rootA: UuidV7;
  let rootB: UuidV7;
  let buyer: SessionInfo;
  let sam: SessionInfo;

  /** Bearer headers per account, from real sign-ins. */
  const auth: Record<string, Record<string, string>> = {};

  async function counts(): Promise<{ projects: number; changes: number }> {
    const { rows } = await owner.query<{ projects: number; changes: number }>(
      `select (select count(*) from projects)::int as projects,
              (select count(*) from project_parent_changes)::int as changes`,
    );
    const [row] = rows;
    if (row === undefined) throw new Error("no counts");
    return { ...row };
  }

  async function changeRows(): Promise<unknown[]> {
    const { rows } = await owner.query<Record<string, unknown>>(
      "select id, tenant_id, project_id, sequence, parent_id, changed_by, changed_at from project_parent_changes order by tenant_id, sequence",
    );
    return rows;
  }

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

  async function expectRefused(response: Response, status: number, code: string, subject?: string): Promise<void> {
    const body: unknown = await response.json();
    expect([response.status, body]).toMatchObject([status, subject === undefined ? { code } : { code, subject }]);
  }

  async function tree(who = "buyer"): Promise<ProjectTree> {
    const response = await get("/v1/projects", who);
    const body: unknown = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    if (!isProjectTree(body)) throw new Error("not a ProjectTree");
    return body;
  }

  async function created(name: string, parentId: string, levelName = "Team"): Promise<ProjectInfo> {
    const response = await post("/v1/projects", "buyer", { name, levelName, parentId });
    const body: unknown = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(201);
    if (!isProjectInfo(body)) throw new Error("not a ProjectInfo");
    return body;
  }

  const parentOf = (t: ProjectTree, id: string) => t.projects.find((p) => p.id === id)?.parentId;

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

    const a = await provisionCompany(db, {
      company: "Acme",
      accounts: [
        { name: "Bea Buyer", email: "bea@acme.io", role: "Buyer" },
        { name: "Sam Owner", email: "sam@acme.io", role: "Standard owner" },
        { name: "Bo Builder", email: "bo@acme.io", role: "Builder" },
      ],
    });
    const b = await provisionCompany(db, {
      company: "Bolt",
      accounts: [{ name: "Bob Buyer", email: "bob@bolt.io", role: "Buyer" }],
    });
    tenantA = a.tenantId;
    rootA = a.rootProjectId;
    rootB = b.rootProjectId;
    const session = (tenantId: UuidV7, account: { id: UuidV7; role: SessionInfo["role"] } | undefined) => {
      if (account === undefined) throw new Error("missing account");
      return { accountId: account.id, tenantId, role: account.role };
    };
    [buyer, sam] = a.accounts.map((account) => session(tenantA, account)) as [SessionInfo, SessionInfo];

    server = createRegistryServer(
      {
        signIn: createSignInService(db, new MemoryTransport(), PANEL),
        modules: createModuleService(db),
        standards: createStandardService(db),
        projects: createProjectService(db),
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

  describe("migration 0006", () => {
    it("enables and forces RLS with the tenant_isolation policy on project_parent_changes", async () => {
      const { rows } = await owner.query<{ rls: boolean; forced: boolean; policies: string[] }>(
        `select c.relrowsecurity as rls, c.relforcerowsecurity as forced,
                array(select p.polname::text from pg_policy p where p.polrelid = c.oid order by 1) as policies
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname = 'project_parent_changes'`,
      );
      expect(rows).toEqual([{ rls: true, forced: true, policies: ["tenant_isolation"] }]);
    });

    it("grants the app role SELECT and INSERT only, and no column UPDATE", async () => {
      const { rows } = await owner.query<{ table_name: string; privilege_type: string }>(
        `select table_name, privilege_type from information_schema.role_table_grants
         where grantee = $1 and table_name in ('projects', 'project_parent_changes') order by 1, 2`,
        [APP_ROLE],
      );
      expect(rows).toEqual([
        { table_name: "project_parent_changes", privilege_type: "INSERT" },
        { table_name: "project_parent_changes", privilege_type: "SELECT" },
        { table_name: "projects", privilege_type: "INSERT" },
        { table_name: "projects", privilege_type: "SELECT" },
      ]);
      const columns = await owner.query(
        `select 1 from information_schema.column_privileges
         where grantee = $1 and privilege_type = 'UPDATE' and table_name in ('projects', 'project_parent_changes')`,
        [APP_ROLE],
      );
      expect(columns.rowCount).toBe(0);
    });

    it("leaves the provisioned root with no level name, no creator and no change row", async () => {
      const { rows } = await owner.query("select level_name, created_by, parent_id from projects where id = $1", [rootA]);
      expect(rows).toEqual([{ level_name: null, created_by: null, parent_id: null }]);
      const changes = await owner.query("select 1 from project_parent_changes where project_id = $1", [rootA]);
      expect(changes.rowCount).toBe(0);
    });

    it.each([
      ["a blank level name", "   "],
      ["an empty level name", ""],
      ["a 201-character level name", "x".repeat(201)],
    ])("refuses at the database %s", async (_label, levelName) => {
      const error: unknown = await owner
        .query("insert into projects (id, tenant_id, parent_id, name, level_name) values ($1, $2, $3, 'x', $4)", [
          "01928c7e-5b2a-7c3d-8e4f-000000000001",
          tenantA,
          rootA,
          levelName,
        ])
        .then(
          () => undefined,
          (e: unknown) => e,
        );
      expect(pgCode(error)).toBe(CHECK_VIOLATION);
    });
  });

  describe("reading", () => {
    it("shows only the root while no Project exists beyond it (empty state), to every role", async () => {
      for (const who of ["buyer", "sam", "builder"]) {
        const t = await tree(who);
        expect(t.rootId).toBe(rootA);
        expect(t.projects).toEqual([
          { id: rootA, name: "Acme", levelName: null, parentId: null, createdAt: expect.stringMatching(/Z$/) as unknown },
        ]);
      }
    });

    it("serves one Project to every role", async () => {
      const response = await get(`/v1/projects/${rootA}`, "builder");
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ id: rootA, parentId: null, levelName: null });
    });

    it("answers 401 without a session", async () => {
      await expectRefused(await get("/v1/projects", "nobody"), 401, "session_invalid");
    });
  });

  describe("creating", () => {
    it("creates a Project under the root: registry-minted id, trimmed name, the level name exactly as typed", async () => {
      const before = await counts();
      const changesBefore = await changeRows();
      const response = await post("/v1/projects", "buyer", { name: " Web ", levelName: "  Product line ", parentId: rootA });
      const body: unknown = await response.json();
      expect(response.status).toBe(201);
      if (!isProjectInfo(body)) throw new Error("not a ProjectInfo");
      expect(isUuidV7(body.id)).toBe(true);
      expect(body).toMatchObject({ name: "Web", levelName: "  Product line ", parentId: rootA });
      expect(body.createdAt.endsWith("Z")).toBe(true);
      expect(await counts()).toEqual({ projects: before.projects + 1, changes: before.changes + 1 });
      expect((await changeRows()).slice(0, changesBefore.length)).toEqual(changesBefore);

      const t = await tree("builder");
      expect(t.projects.map((p) => [p.name, p.levelName, p.parentId])).toContainEqual(["Web", "  Product line ", rootA]);

      const { rows } = await owner.query(
        "select created_by::text, level_name, parent_id::text from projects where id = $1",
        [body.id],
      );
      expect(rows).toEqual([{ created_by: buyer.accountId, level_name: "  Product line ", parent_id: rootA }]);
      const change = await owner.query(
        "select sequence, parent_id::text, changed_by::text from project_parent_changes where project_id = $1",
        [body.id],
      );
      expect(change.rows).toEqual([{ sequence: before.changes + 1, parent_id: rootA, changed_by: buyer.accountId }]);
    });

    it("refuses a Standard owner and a Builder with 403 role_denied and writes nothing", async () => {
      const before = await counts();
      for (const who of ["sam", "builder"]) {
        await expectRefused(
          await post("/v1/projects", who, { name: "X", levelName: "Team", parentId: rootA }),
          403,
          "role_denied",
          "role",
        );
      }
      expect(await counts()).toEqual(before);
    });

    it.each([
      ["a blank name", { name: "  ", levelName: "Team", parentId: "ROOT" }, "name"],
      ["a 201-character name", { name: "x".repeat(201), levelName: "Team", parentId: "ROOT" }, "name"],
      ["a blank level name", { name: "X", levelName: "", parentId: "ROOT" }, "levelName"],
      ["a whitespace-only level name", { name: "X", levelName: "   ", parentId: "ROOT" }, "levelName"],
      ["a 201-character level name", { name: "X", levelName: "x".repeat(201), parentId: "ROOT" }, "levelName"],
      ["a missing parent", { name: "X", levelName: "Team" }, "parentId"],
      ["a malformed parent", { name: "X", levelName: "Team", parentId: "root" }, "parentId"],
      ["a null parent", { name: "X", levelName: "Team", parentId: null }, "parentId"],
      ["an extra key", { name: "X", levelName: "Team", parentId: "ROOT", id: "x" }, "id"],
    ])("refuses %s with 400 invalid_input naming the field and writes nothing", async (_label, body, subject) => {
      const before = await counts();
      const sent = Object.fromEntries(Object.entries(body).map(([k, v]) => [k, v === "ROOT" ? rootA : v]));
      await expectRefused(await post("/v1/projects", "buyer", sent), 400, "invalid_input", subject);
      expect(await counts()).toEqual(before);
    });

    it("refuses another tenant's or an unknown parent with 404 project_not_found (parentId)", async () => {
      const before = await counts();
      for (const parentId of [rootB, "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e5f6"]) {
        await expectRefused(
          await post("/v1/projects", "buyer", { name: "X", levelName: "Team", parentId }),
          404,
          "project_not_found",
          "parentId",
        );
      }
      expect(await counts()).toEqual(before);
    });
  });

  describe("changing a parent", () => {
    it("re-parents A under C by appending a change row; earlier rows stay as written", async () => {
      const a = await created("A", rootA);
      const c = await created("C", rootA);
      const before = await counts();
      const earlier = await changeRows();
      const response = await post(`/v1/projects/${a.id}/parent`, "buyer", { parentId: c.id });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ id: a.id, name: "A", parentId: c.id });
      expect(await counts()).toEqual({ projects: before.projects, changes: before.changes + 1 });
      expect((await changeRows()).slice(0, earlier.length)).toEqual(earlier);

      const t = await tree();
      expect(parentOf(t, a.id)).toBe(c.id);
      // Depth-first: A follows C.
      const ids = t.projects.map((p) => p.id);
      expect(ids.indexOf(a.id)).toBe(ids.indexOf(c.id) + 1);
      expect(await (await get(`/v1/projects/${a.id}`, "builder")).json()).toMatchObject({ parentId: c.id });
      // projects.parent_id keeps the parent at creation.
      const { rows } = await owner.query("select parent_id::text from projects where id = $1", [a.id]);
      expect(rows).toEqual([{ parent_id: rootA }]);
    });

    it("answers 200 and writes nothing when the current parent is sent again", async () => {
      const a = await created("Same A", rootA);
      const before = await counts();
      const earlier = await changeRows();
      const response = await post(`/v1/projects/${a.id}/parent`, "buyer", { parentId: rootA });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ id: a.id, parentId: rootA });
      expect(await counts()).toEqual(before);
      expect(await changeRows()).toEqual(earlier);
    });

    it("refuses a cycle naming the parent that closes it, writes nothing and leaves the tree unchanged", async () => {
      const a = await created("Cycle A", rootA);
      const b = await created("Cycle B", a.id);
      const before = await counts();
      const treeBefore = await tree();

      const response = await post(`/v1/projects/${a.id}/parent`, "buyer", { parentId: b.id });
      const body = (await response.json()) as { code: string; subject: string; message: string };
      expect([response.status, body.code, body.subject]).toEqual([409, "project_cycle", b.id]);
      expect(body.message).toContain(b.id);
      await expectRefused(await post(`/v1/projects/${a.id}/parent`, "buyer", { parentId: a.id }), 409, "project_cycle", a.id);

      expect(await counts()).toEqual(before);
      expect(await tree()).toEqual(treeBefore);
    });

    it("refuses re-parenting the root with 409 root_project_fixed", async () => {
      const child = await created("Under root", rootA);
      const before = await counts();
      await expectRefused(
        await post(`/v1/projects/${rootA}/parent`, "buyer", { parentId: child.id }),
        409,
        "root_project_fixed",
        "projectId",
      );
      expect(await counts()).toEqual(before);
    });

    it("refuses a non-Buyer with 403, and checks the Project before the role", async () => {
      const a = await created("Role A", rootA);
      const before = await counts();
      await expectRefused(await post(`/v1/projects/${a.id}/parent`, "builder", { parentId: rootA }), 403, "role_denied");
      await expectRefused(await post(`/v1/projects/${a.id}/parent`, "sam", { parentId: rootA }), 403, "role_denied");
      await expectRefused(
        await post(`/v1/projects/${rootB}/parent`, "builder", { parentId: rootA }),
        404,
        "project_not_found",
        "projectId",
      );
      expect(await counts()).toEqual(before);
    });

    it("refuses an invalid body, then an unknown or foreign parent, writing nothing", async () => {
      const a = await created("Body A", rootA);
      const before = await counts();
      await expectRefused(await post(`/v1/projects/${a.id}/parent`, "buyer", { parentId: null }), 400, "invalid_input", "parentId");
      await expectRefused(await post(`/v1/projects/${a.id}/parent`, "buyer", {}), 400, "invalid_input", "parentId");
      await expectRefused(
        await post(`/v1/projects/${a.id}/parent`, "buyer", { parentId: rootA, name: "x" }),
        400,
        "invalid_input",
        "name",
      );
      await expectRefused(
        await post(`/v1/projects/${a.id}/parent`, "buyer", { parentId: rootB }),
        404,
        "project_not_found",
        "parentId",
      );
      await expectRefused(
        await post("/v1/projects/not-an-id/parent", "buyer", { parentId: rootA }),
        404,
        "project_not_found",
        "projectId",
      );
      expect(await counts()).toEqual(before);
    });

    it("lets exactly one of two concurrent opposite re-parents succeed; the other is a cycle", async () => {
      const x = await created("Race X", rootA);
      const y = await created("Race Y", rootA);
      const before = await counts();
      const [first, second] = await Promise.all([
        post(`/v1/projects/${x.id}/parent`, "buyer", { parentId: y.id }),
        post(`/v1/projects/${y.id}/parent`, "buyer", { parentId: x.id }),
      ]);
      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([200, 409]);
      const refused = (first.status === 409 ? first : second).json() as Promise<{ code: string }>;
      expect((await refused).code).toBe("project_cycle");
      expect(await counts()).toEqual({ projects: before.projects, changes: before.changes + 1 });
      const t = await tree();
      expect(isProjectTree(t)).toBe(true);
      expect([parentOf(t, x.id) === y.id, parentOf(t, y.id) === x.id].filter(Boolean)).toHaveLength(1);
    });
  });

  describe("the whole bundle input", () => {
    it("re-parents while live Standards exist at the root, and root publishes still work after Projects exist", async () => {
      const module = await createModule(db, buyer, { kind: "code-stack", name: "Frontend stack" });
      await assignModuleOwner(db, buyer, module.id, { accountId: sam.accountId });
      const publish = (name: string) =>
        post(`/v1/modules/${module.id}/standards`, "sam", { entry: { category: "library", name, status: "approved" } });

      const first = await publish("React");
      const firstBody: unknown = await first.json();
      expect(first.status).toBe(201);
      expect(isStandardInfo(firstBody) && firstBody.project.id).toBe(rootA);

      const a = await created("Bundle A", rootA);
      const c = await created("Bundle C", rootA);
      expect((await post(`/v1/projects/${a.id}/parent`, "buyer", { parentId: c.id })).status).toBe(200);

      const second = await publish("Vue");
      expect(second.status).toBe(201);
      expect(await second.json()).toMatchObject({ project: { id: rootA } });
      await expectRefused(await publish("react"), 409, "slot_conflict");
    });
  });

  describe("Effective Standard set (Story 2.3)", () => {
    let codeStack: string;
    let designSystem: string;
    let p: ProjectInfo;
    let c: ProjectInfo;
    let s: ProjectInfo;
    const ids: Record<string, string> = {};

    async function publish(moduleId: string, entry: unknown, projectId: string): Promise<StandardInfo> {
      const response = await post(`/v1/modules/${moduleId}/standards`, "sam", { entry, projectId });
      const body: unknown = await response.json();
      expect(response.status, JSON.stringify(body)).toBe(201);
      if (!isStandardInfo(body)) throw new Error("not a StandardInfo");
      return body;
    }

    async function effective(projectId: string, who = "buyer"): Promise<EffectiveStandardSet> {
      const response = await get(`/v1/projects/${projectId}/effective-standards`, who);
      const body: unknown = await response.json();
      expect(response.status, JSON.stringify(body)).toBe(200);
      if (!isEffectiveStandardSet(body)) throw new Error("not an EffectiveStandardSet");
      return body;
    }

    const named = (set: EffectiveStandardSet, name: string) =>
      set.standards.filter((entry) => entry.slot.name.trim().toLowerCase() === name.toLowerCase());

    beforeAll(async () => {
      const cs = await createModule(db, buyer, { kind: "code-stack", name: "Effective stack" });
      const ds = await createModule(db, buyer, { kind: "design-system", name: "Effective design" });
      await assignModuleOwner(db, buyer, cs.id, { accountId: sam.accountId });
      await assignModuleOwner(db, buyer, ds.id, { accountId: sam.accountId });
      codeStack = cs.id;
      designSystem = ds.id;
      // rootA ── P ─┬─ C
      //             └─ S
      p = await created("Effective P", rootA, "Division");
      c = await created("Effective C", p.id);
      s = await created("Effective S", p.id);
      ids["parentX"] = (await publish(codeStack, { category: "library", name: "EffX", status: "approved" }, p.id)).id;
      ids["childX"] = (await publish(codeStack, { category: "library", name: "effx", status: "prohibited" }, c.id)).id;
      ids["token"] = (await publish(designSystem, { kind: "token", name: "eff-primary", status: "required" }, p.id)).id;
      ids["react"] = (await publish(codeStack, { category: "library", name: "EffReact", status: "approved" }, c.id)).id;
      ids["button"] = (
        await publish(designSystem, { kind: "component", name: "EffButton", usageRule: "Primary actions", tokens: [] }, c.id)
      ).id;
      ids["offPath"] = (await publish(codeStack, { category: "library", name: "EffOff", status: "approved" }, s.id)).id;
    }, 60_000);

    it("lets the closest Standard win: the parent allows X, the child prohibits X", async () => {
      const set = await effective(c.id);
      expect(set.project).toEqual({ id: c.id, name: "Effective C" });
      const x = named(set, "effx");
      expect(x).toHaveLength(1);
      expect(x[0]).toMatchObject({
        slot: { moduleKind: "code-stack", slotKind: "library", name: "effx" },
        status: "prohibited",
        standard: { id: ids["childX"], version: 1, project: { id: c.id } },
        sourceProject: { id: c.id, name: "Effective C" },
        locked: false,
      });
    });

    it("lets the parent inherit only its own and its ancestors' Standards", async () => {
      const set = await effective(p.id);
      expect(named(set, "effx")).toMatchObject([
        { status: "approved", standard: { id: ids["parentX"] }, sourceProject: { id: p.id, name: "Effective P" } },
      ]);
      expect(set.standards.some((entry) => entry.standard.id === ids["childX"] || entry.standard.id === ids["react"])).toBe(false);
    });

    it("keeps a token and a library side by side, a component with no status, and excludes an off-path sibling", async () => {
      const set = await effective(c.id);
      expect(named(set, "eff-primary")).toMatchObject([
        { slot: { moduleKind: "design-system", slotKind: "token" }, status: "required", sourceProject: { id: p.id } },
      ]);
      expect(named(set, "effreact")).toMatchObject([{ status: "approved", sourceProject: { id: c.id } }]);
      expect(named(set, "effbutton")).toMatchObject([{ status: null, standard: { id: ids["button"] } }]);
      expect(set.standards.some((entry) => entry.standard.id === ids["offPath"])).toBe(false);
      // The registry serves core's order unchanged.
      const keys = set.standards.map((e) => [e.slot.moduleKind, e.slot.slotKind, e.slot.name.trim().toLowerCase(), e.standard.id].join("|"));
      expect(keys).toEqual([...keys].sort());
    });

    it("answers every role with byte-identical bodies on repeated GETs", async () => {
      const bodies: string[] = [];
      for (const who of ["buyer", "sam", "builder", "buyer"]) {
        const response = await get(`/v1/projects/${c.id}/effective-standards`, who);
        expect(response.status).toBe(200);
        bodies.push(await response.text());
      }
      expect(new Set(bodies).size).toBe(1);
    });

    it("serves the live version: a new version of an on-path Standard replaces the old one", async () => {
      const response = await post(`/v1/standards/${ids["token"] ?? ""}/versions`, "sam", {
        entry: { kind: "token", name: "eff-primary", status: "prohibited" },
      });
      expect(response.status, JSON.stringify(await response.json())).toBe(201);
      const entries = named(await effective(c.id), "eff-primary");
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        status: "prohibited",
        standard: { id: ids["token"], version: 2, entry: { status: "prohibited" } },
        sourceProject: { id: p.id },
      });
    });

    it("refuses a foreign, unknown or malformed id with 404 and a missing session with 401", async () => {
      const path = (id: string) => `/v1/projects/${id}/effective-standards`;
      await expectRefused(await get(path(rootB), "buyer"), 404, "project_not_found", "projectId");
      await expectRefused(await get(path(c.id), "bob"), 404, "project_not_found", "projectId");
      await expectRefused(await get(path("01928c7e-5b2a-7c3d-8e4f-0000000000ff"), "buyer"), 404, "project_not_found", "projectId");
      await expectRefused(await get(path("nope"), "buyer"), 404, "project_not_found", "projectId");
      await expectRefused(await get(path(c.id), "nobody"), 401, "session_invalid");
    });
  });

  describe("append-only and tenant isolation", () => {
    it.each([
      ["UPDATE projects", sql`update projects set name = name`],
      ["DELETE projects", sql`delete from projects`],
      ["UPDATE project_parent_changes", sql`update project_parent_changes set sequence = sequence + 100`],
      ["DELETE project_parent_changes", sql`delete from project_parent_changes`],
    ])("the runtime role cannot %s (permission denied)", async (_label, statement) => {
      const before = await counts();
      const error: unknown = await withTenant(db, tenantA, (tx) => tx.execute(statement)).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(pgCode(error)).toBe(INSUFFICIENT_PRIVILEGE);
      expect(await counts()).toEqual(before);
    });

    it("lists only the caller's Projects and answers 404 for another Company's id", async () => {
      const bTree = await tree("bob");
      expect(bTree.projects.map((p) => p.id)).toEqual([rootB]);
      const aTree = await tree("buyer");
      expect(aTree.projects.some((p) => p.id === rootB)).toBe(false);
      await expectRefused(await get(`/v1/projects/${rootB}`, "buyer"), 404, "project_not_found", "projectId");
      await expectRefused(await get(`/v1/projects/${rootA}`, "bob"), 404, "project_not_found", "projectId");
      await expectRefused(await get("/v1/projects/nope", "buyer"), 404, "project_not_found", "projectId");
    });

    it("RLS returns only the context tenant's rows when the tenant filter is omitted", async () => {
      // Tenant B gets a Project of its own, so both tables hold rows of both tenants.
      const response = await post("/v1/projects", "bob", { name: "Bolt web", levelName: "Squad", parentId: rootB });
      expect(response.status).toBe(201);

      const seen = await withTenant(db, tenantA, async (tx) => ({
        // Deliberately no `where tenant_id = ...`: RLS alone must hold.
        projects: await tx.select().from(projects),
        changes: await tx.select().from(projectParentChanges),
      }));
      expect(seen.projects.length).toBeGreaterThan(1);
      expect(seen.changes.length).toBeGreaterThan(0);
      expect(seen.projects.every((row) => row.tenantId === tenantA)).toBe(true);
      expect(seen.changes.every((row) => row.tenantId === tenantA)).toBe(true);

      const all = await owner.query<{ n: number }>("select count(distinct tenant_id)::int as n from project_parent_changes");
      expect(all.rows[0]?.n).toBe(2);
      const raw = await appPool.query<{ p: number; c: number }>(
        "select (select count(*) from projects)::int as p, (select count(*) from project_parent_changes)::int as c",
      );
      expect(raw.rows).toEqual([{ p: 0, c: 0 }]);
    });

    it("refuses at the database a change row pointing at another tenant's Project (composite FK)", async () => {
      const before = await counts();
      await expect(
        withTenant(db, tenantA, (tx) =>
          tx.insert(projectParentChanges).values({
            id: "01928c7e-5b2a-7c3d-8e4f-000000000002",
            tenantId: tenantA,
            projectId: rootA,
            sequence: 10_000,
            parentId: rootB,
            changedBy: buyer.accountId,
          }),
        ),
      ).rejects.toThrow();
      expect(await counts()).toEqual(before);
    });
  });
});
