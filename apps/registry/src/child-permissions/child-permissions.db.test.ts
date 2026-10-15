// Database suite for the child-Project permission (Story 2.5): runs against a
// real PostgreSQL 18 named by REGISTRY_TEST_DATABASE_URL (an admin connection).
// Like the other suites it creates a throwaway database, migrates it as the
// admin (owner) and runs every data-access call as dh_registry_app
// (`-c role=dh_registry_app`). Every matrix row is exercised over HTTP with
// real sessions as Bearer tokens.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  isChildPermissionList,
  isChildPermissionState,
  isEffectiveStandardSet,
  isLockedRuleState,
  isProjectInfo,
  isStandardInfo,
} from "@domain-harness/contract";
import type {
  ChildPermissionList,
  ChildPermissionState,
  EffectiveStandardSet,
  ProjectInfo,
  SessionInfo,
  StandardInfo,
  UuidV7,
} from "@domain-harness/contract";
import { createRegistryDb } from "../db/client.ts";
import type { RegistryDb } from "../db/client.ts";
import { migrate } from "../db/migrate.ts";
import { childPermissionChanges } from "../db/schema.ts";
import { withTenant } from "../db/tenant-scope.ts";
import { createRegistryServer } from "../http/server.ts";
import { createLockedRuleService } from "../locked-rules/service.ts";
import { MemoryTransport } from "../mail/memory.ts";
import { assignModuleOwner, createModule, createModuleService } from "../modules/service.ts";
import { createProjectService } from "../projects/service.ts";
import { consumeSignInLink, createSignInService, requestSignInLinks } from "../sign-in/service.ts";
import { createStandardService } from "../standards/service.ts";
import { provisionCompany } from "../tenancy/provision.ts";
import { createApplicationService } from "../applications/service.ts";
import { createBoilerplateService } from "../boilerplate/service.ts";
import { createAcceptedDeviationsService } from "../accepted-deviations/service.ts";
import { createAcceptedDeviationAlertsService } from "../accepted-deviation-alerts/service.ts";
import { createGuidanceEndpointService } from "../guidance-endpoint/service.ts";
import { createBuildGrantService } from "../build-grants/service.ts";
import { createChildPermissionService } from "./service.ts";

const ENV = "REGISTRY_TEST_DATABASE_URL";
const adminUrl = process.env[ENV];
const inCi = process.env["CI"] !== undefined && process.env["CI"] !== "" && process.env["CI"] !== "false";
const APP_ROLE = "dh_registry_app";
const MIGRATION_SUITE_LOCK = 7_202_610_103;
const PANEL = { panelUrl: "http://panel.test" };

if (adminUrl === undefined || adminUrl === "") {
  if (inCi) {
    describe("child-Project permission database suite", () => {
      it(`requires ${ENV} when CI is set`, () => {
        expect.fail(`${ENV} is not set; CI must run the database suite against PostgreSQL 18`);
      });
    });
  } else {
    process.stderr.write(`child-permissions.db.test.ts skipped: ${ENV} is not set (see README, "Database")\n`);
  }
}

function withDatabase(url: string, database: string, role?: string): string {
  const next = new URL(url);
  next.pathname = `/${database}`;
  if (role !== undefined) next.searchParams.set("options", `-c role=${role}`);
  return next.toString();
}

describe.skipIf(adminUrl === undefined || adminUrl === "")("child-Project permission against PostgreSQL", () => {
  const database = `dh_registry_childperm_${randomBytes(6).toString("hex")}`;
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
  let bo: SessionInfo;
  let al: SessionInfo;
  let ola: SessionInfo;
  let codeStack: string;

  /** Bearer headers per account, from real sign-ins. */
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

  async function expectRefused(response: Response, status: number, code: string, subject?: string): Promise<void> {
    const body: unknown = await response.json();
    expect([response.status, body]).toMatchObject([status, subject === undefined ? { code } : { code, subject }]);
  }

  const permPath = (projectId: string) => `/v1/projects/${projectId}/child-permissions`;

  async function permissionRows(projectId: string, accountId: string): Promise<{ granted: boolean; changed_by: string }[]> {
    const { rows } = await owner.query<{ granted: boolean; changed_by: string }>(
      `select granted, changed_by::text from child_permission_changes
       where project_id = $1 and account_id = $2 order by sequence`,
      [projectId, accountId],
    );
    return rows;
  }

  async function allRows(): Promise<number> {
    const { rows } = await owner.query<{ n: number }>("select count(*)::int as n from child_permission_changes");
    return rows[0]?.n ?? 0;
  }

  async function treeCounts(): Promise<{ projects: number; changes: number }> {
    const { rows } = await owner.query<{ projects: number; changes: number }>(
      `select (select count(*)::int from projects) as projects,
              (select count(*)::int from project_parent_changes) as changes`,
    );
    return rows[0] ?? { projects: 0, changes: 0 };
  }

  async function list(projectId: string, who = "buyer"): Promise<ChildPermissionList> {
    const response = await get(permPath(projectId), who);
    const body: unknown = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    if (!isChildPermissionList(body)) throw new Error("not a ChildPermissionList");
    return body;
  }

  async function setPermission(projectId: string, accountId: string, granted: boolean, who = "buyer"): Promise<ChildPermissionState> {
    const response = await post(permPath(projectId), who, { accountId, granted });
    const body: unknown = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    if (!isChildPermissionState(body)) throw new Error("not a ChildPermissionState");
    return body;
  }

  function createBody(name: string, parentId: string) {
    return { name, levelName: "Team", parentId };
  }

  async function created(name: string, parentId: string, who = "buyer"): Promise<ProjectInfo> {
    const response = await post("/v1/projects", who, createBody(name, parentId));
    const body: unknown = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(201);
    if (!isProjectInfo(body)) throw new Error("not a ProjectInfo");
    return body;
  }

  async function publish(name: string, status: string, projectId: string): Promise<StandardInfo> {
    const response = await post(`/v1/modules/${codeStack}/standards`, "sam", {
      entry: { category: "library", name, status },
      projectId,
    });
    const body: unknown = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(201);
    if (!isStandardInfo(body)) throw new Error("not a StandardInfo");
    return body;
  }

  async function lock(standardId: string): Promise<void> {
    const response = await post(`/v1/standards/${standardId}/locked-rule`, "buyer", { locked: true });
    const body: unknown = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(isLockedRuleState(body)).toBe(true);
  }

  async function effective(projectId: string): Promise<EffectiveStandardSet> {
    const response = await get(`/v1/projects/${projectId}/effective-standards`, "buyer");
    const body: unknown = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    if (!isEffectiveStandardSet(body)) throw new Error("not an EffectiveStandardSet");
    return body;
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

    const a = await provisionCompany(db, {
      company: "Acme",
      accounts: [
        { name: "Bea Buyer", email: "bea@acme.io", role: "Buyer" },
        { name: "Sam Owner", email: "sam@acme.io", role: "Standard owner" },
        { name: "Bo Builder", email: "bo@acme.io", role: "Builder" },
        { name: "Al Builder", email: "al@acme.io", role: "Builder" },
      ],
    });
    const b = await provisionCompany(db, {
      company: "Bolt",
      accounts: [
        { name: "Bob Buyer", email: "bob@bolt.io", role: "Buyer" },
        { name: "Ola Owner", email: "ola@bolt.io", role: "Standard owner" },
      ],
    });
    tenantA = a.tenantId;
    rootA = a.rootProjectId;
    rootB = b.rootProjectId;
    const session = (tenantId: UuidV7, account: { id: UuidV7; role: SessionInfo["role"] } | undefined) => {
      if (account === undefined) throw new Error("missing account");
      return { accountId: account.id, tenantId, role: account.role };
    };
    [buyer, sam, bo, al] = a.accounts.map((account) => session(a.tenantId, account)) as [
      SessionInfo,
      SessionInfo,
      SessionInfo,
      SessionInfo,
    ];
    ola = session(b.tenantId, b.accounts[1]);

    const cs = await createModule(db, buyer, { kind: "code-stack", name: "Permission stack" });
    await assignModuleOwner(db, buyer, cs.id, { accountId: sam.accountId });
    codeStack = cs.id;

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
      },
      () => undefined,
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
    for (const [who, email] of [
      ["buyer", "bea@acme.io"],
      ["sam", "sam@acme.io"],
      ["builder", "bo@acme.io"],
      ["al", "al@acme.io"],
      ["bob", "bob@bolt.io"],
      ["ola", "ola@bolt.io"],
    ] as const) {
      auth[who] = { authorization: `Bearer ${await sessionToken(email)}` };
    }

    // Tenant B holds a grant of its own, so the table holds rows of both tenants.
    await setPermission(rootB, ola.accountId, true, "bob");
  }, 60_000);

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await appPool.end();
    await owner.end();
    await admin.query(`drop database if exists ${database} with (force)`);
    await admin.end();
  }, 60_000);

  describe("migration 0008", () => {
    it("enables and forces RLS with the tenant_isolation policy and grants SELECT and INSERT only", async () => {
      const { rows } = await owner.query<{ rls: boolean; forced: boolean; policies: string[] }>(
        `select c.relrowsecurity as rls, c.relforcerowsecurity as forced,
                array(select p.polname::text from pg_policy p where p.polrelid = c.oid order by 1) as policies
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname = 'child_permission_changes'`,
      );
      expect(rows).toEqual([{ rls: true, forced: true, policies: ["tenant_isolation"] }]);
      const grants = await owner.query<{ privilege_type: string }>(
        `select privilege_type from information_schema.role_table_grants
         where grantee = $1 and table_name = 'child_permission_changes' order by 1`,
        [APP_ROLE],
      );
      expect(grants.rows).toEqual([{ privilege_type: "INSERT" }, { privilege_type: "SELECT" }]);
    });

    it("refuses UPDATE and DELETE for the app role", async () => {
      for (const statement of ["update child_permission_changes set granted = not granted", "delete from child_permission_changes"]) {
        await expect(
          withTenant(db, tenantA, async (tx) => {
            await tx.execute(sql.raw(statement));
          }),
        ).rejects.toThrow();
      }
    });
  });

  describe("granting, creating and revoking", () => {
    let p: ProjectInfo;
    let c: ProjectInfo;

    beforeAll(async () => {
      p = await created("Perm P", rootA);
    }, 60_000);

    it("lists no grant and every non-Buyer account by name to every role", async () => {
      for (const who of ["buyer", "sam", "builder"]) {
        const listed = await list(p.id, who);
        expect(listed.project).toEqual({ id: p.id, name: "Perm P" });
        expect(listed.grants).toEqual([]);
        expect(listed.eligibleAccounts).toEqual([
          { accountId: al.accountId, name: "Al Builder", role: "Builder" },
          { accountId: bo.accountId, name: "Bo Builder", role: "Builder" },
          { accountId: sam.accountId, name: "Sam Owner", role: "Standard owner" },
        ]);
      }
    });

    it("refuses a Builder without a grant with 403 child_permission_denied, creating nothing", async () => {
      const before = await treeCounts();
      const response = await post("/v1/projects", "builder", createBody("Denied", p.id));
      const body = (await response.json()) as { message: string };
      expect([response.status, body]).toMatchObject([403, { code: "child_permission_denied", subject: "parentId" }]);
      expect(body.message).toBe("you have no permission to create a child Project under this Project; nothing was created");
      expect(await treeCounts()).toEqual(before);
    });

    it("grants: 200 granted, one row, listed with the Buyer as granter", async () => {
      const before = await allRows();
      const state = await setPermission(p.id, bo.accountId, true);
      expect(state).toMatchObject({
        project: { id: p.id, name: "Perm P" },
        account: { accountId: bo.accountId, name: "Bo Builder", role: "Builder" },
        granted: true,
        changedBy: { accountId: buyer.accountId, name: "Bea Buyer" },
      });
      expect(state.changedAt?.endsWith("Z")).toBe(true);
      expect(await allRows()).toBe(before + 1);
      expect(await permissionRows(p.id, bo.accountId)).toEqual([{ granted: true, changed_by: buyer.accountId }]);
      const listed = await list(p.id, "builder");
      expect(listed.grants).toEqual([
        {
          account: { accountId: bo.accountId, name: "Bo Builder", role: "Builder" },
          grantedAt: state.changedAt,
          grantedBy: { accountId: buyer.accountId, name: "Bea Buyer" },
        },
      ]);
    });

    it("writes nothing when granting twice or revoking a never-granted pair", async () => {
      const before = await allRows();
      expect(await setPermission(p.id, bo.accountId, true)).toMatchObject({ granted: true });
      expect(await setPermission(p.id, sam.accountId, false)).toMatchObject({
        granted: false,
        changedAt: null,
        changedBy: null,
      });
      expect(await allRows()).toBe(before);
    });

    it("orders the grants by account name", async () => {
      await setPermission(p.id, sam.accountId, true);
      await setPermission(p.id, al.accountId, true);
      expect((await list(p.id)).grants.map((g) => g.account.name)).toEqual(["Al Builder", "Bo Builder", "Sam Owner"]);
      await setPermission(p.id, sam.accountId, false);
      await setPermission(p.id, al.accountId, false);
    });

    it("lets the granted Builder create a child: 201, parent P, created and recorded by the Builder", async () => {
      c = await created("Perm C", p.id, "builder");
      expect(c.parentId).toBe(p.id);
      const { rows } = await owner.query("select created_by::text from projects where id = $1", [c.id]);
      expect(rows).toEqual([{ created_by: bo.accountId }]);
      const change = await owner.query("select changed_by::text from project_parent_changes where project_id = $1", [c.id]);
      expect(change.rows).toEqual([{ changed_by: bo.accountId }]);
    });

    it("does not inherit the grant: the Builder may not create under P's child", async () => {
      const before = await treeCounts();
      await expectRefused(await post("/v1/projects", "builder", createBody("Grandchild", c.id)), 403, "child_permission_denied", "parentId");
      expect(await treeCounts()).toEqual(before);
    });

    it("keeps re-parenting Buyer-only for a granted Builder", async () => {
      await expectRefused(await post(`/v1/projects/${c.id}/parent`, "builder", { parentId: rootA }), 403, "role_denied");
    });

    it("revokes with a new row, drops it from the list, keeps the history and refuses the next create", async () => {
      const state = await setPermission(p.id, bo.accountId, false);
      expect(state).toMatchObject({ granted: false, changedBy: { accountId: buyer.accountId } });
      expect(await permissionRows(p.id, bo.accountId)).toEqual([
        { granted: true, changed_by: buyer.accountId },
        { granted: false, changed_by: buyer.accountId },
      ]);
      expect((await list(p.id)).grants).toEqual([]);
      const before = await treeCounts();
      await expectRefused(await post("/v1/projects", "builder", createBody("After revoke", p.id)), 403, "child_permission_denied");
      expect(await treeCounts()).toEqual(before);
    });

    it("checks the parent before the permission: a non-Buyer gets 404 for a foreign or unknown parent", async () => {
      const before = await treeCounts();
      for (const who of ["builder", "sam"]) {
        for (const parentId of [rootB, "01928c7e-5b2a-7c3d-8e4f-000000000009"]) {
          await expectRefused(await post("/v1/projects", who, createBody("Nowhere", parentId)), 404, "project_not_found", "parentId");
        }
      }
      expect(await treeCounts()).toEqual(before);
    });

    it("lets the Buyer create anywhere with no grant", async () => {
      expect((await created("Buyer child", c.id)).parentId).toBe(c.id);
    });
  });

  describe("inheritance of Locked rules", () => {
    it("gives a child created with the permission every Locked rule of P and of its ancestors", async () => {
      const p = await created("Inherit P", rootA);
      const x = await publish("InheritX", "prohibited", rootA);
      const y = await publish("InheritY", "prohibited", p.id);
      await lock(x.id);
      await lock(y.id);
      await setPermission(p.id, bo.accountId, true);
      const c = await created("Inherit C", p.id, "builder");
      const set = await effective(c.id);
      const pick = (name: string) => set.standards.filter((entry) => entry.slot.name === name);
      expect(pick("InheritX")).toMatchObject([{ standard: { id: x.id }, locked: true, sourceProject: { id: rootA } }]);
      expect(pick("InheritY")).toMatchObject([{ standard: { id: y.id }, locked: true, sourceProject: { id: p.id } }]);
    });
  });

  describe("refusals", () => {
    let p: ProjectInfo;

    beforeAll(async () => {
      p = await created("Refuse P", rootA);
    }, 60_000);

    it("answers 401 without a session", async () => {
      await expectRefused(await fetch(`${base}${permPath(p.id)}`), 401, "session_invalid");
      await expectRefused(
        await fetch(`${base}${permPath(p.id)}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ accountId: bo.accountId, granted: true }),
        }),
        401,
        "session_invalid",
      );
    });

    it("refuses the Standard owner and the Builder with 403 role_denied, writing nothing", async () => {
      const before = await allRows();
      for (const who of ["sam", "builder"]) {
        for (const granted of [true, false]) {
          const response = await post(permPath(p.id), who, { accountId: bo.accountId, granted });
          const body = (await response.json()) as { message: string };
          expect([response.status, body]).toMatchObject([403, { code: "role_denied", subject: "role" }]);
          expect(body.message).toBe(
            "only the Buyer can grant or revoke the permission to create child Projects; nothing was changed",
          );
        }
      }
      expect(await allRows()).toBe(before);
    });

    it("checks the role before the body and the account", async () => {
      const before = await allRows();
      for (const body of [
        { accountId: buyer.accountId, granted: true },
        { accountId: sam.accountId, granted: "yes" },
      ]) {
        await expectRefused(await post(permPath(p.id), "builder", body), 403, "role_denied", "role");
      }
      expect(await allRows()).toBe(before);
    });

    it("answers 404 project_not_found for a foreign, unknown or malformed Project on GET and POST", async () => {
      const unknown = "01928c7e-5b2a-7c3d-8e4f-000000000009";
      for (const target of [rootB, unknown, "nope"]) {
        await expectRefused(await get(permPath(target), "buyer"), 404, "project_not_found", "projectId");
        await expectRefused(
          await post(permPath(target), "buyer", { accountId: bo.accountId, granted: true }),
          404,
          "project_not_found",
          "projectId",
        );
      }
      // The Project check comes before the role check.
      await expectRefused(await post(permPath(rootB), "builder", { accountId: bo.accountId, granted: true }), 404, "project_not_found");
    });

    it.each([
      ["an empty body", {}, "accountId"],
      ["a missing flag", { accountId: "BO" }, "granted"],
      ["a string flag", { accountId: "BO", granted: "yes" }, "granted"],
      ["a numeric account", { accountId: 7, granted: true }, "accountId"],
      ["an extra key", { accountId: "BO", granted: true, note: "x" }, "note"],
      ["a malformed account", { accountId: "nope", granted: true }, "accountId"],
      ["an unknown account", { accountId: "01928c7e-5b2a-7c3d-8e4f-000000000009", granted: true }, "accountId"],
      ["another Company's account", { accountId: "OLA", granted: true }, "accountId"],
      ["the Buyer", { accountId: "BUYER", granted: true }, "accountId"],
    ])("answers 400 invalid_input for %s, writing nothing", async (_label, body, subject) => {
      const ids: Record<string, string> = { BO: bo.accountId, OLA: ola.accountId, BUYER: buyer.accountId };
      const sent = Object.fromEntries(Object.entries(body).map(([k, v]) => [k, typeof v === "string" ? (ids[v] ?? v) : v]));
      const before = await allRows();
      await expectRefused(await post(permPath(p.id), "buyer", sent), 400, "invalid_input", subject);
      expect(await allRows()).toBe(before);
    });

    it("words the account refusal as the spec says", async () => {
      const response = await post(permPath(p.id), "buyer", { accountId: buyer.accountId, granted: true });
      const body = (await response.json()) as { message: string };
      expect(body.message).toBe(
        "accountId must be the id of an account of this Company that is not the Buyer; nothing was changed",
      );
    });
  });

  describe("tenant isolation", () => {
    it("shows each Company only its own grants and accounts", async () => {
      const bList = await list(rootB, "bob");
      expect(bList.grants.map((g) => g.account.accountId)).toEqual([ola.accountId]);
      expect(bList.eligibleAccounts.map((account) => account.accountId)).toEqual([ola.accountId]);
      await expectRefused(await get(permPath(rootA), "bob"), 404, "project_not_found");
    });

    it("RLS returns only the context tenant's rows when the tenant filter is omitted", async () => {
      const seen = await withTenant(db, tenantA, (tx) => tx.select().from(childPermissionChanges));
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every((row) => row.tenantId === tenantA)).toBe(true);
      const all = await owner.query<{ n: number }>("select count(distinct tenant_id)::int as n from child_permission_changes");
      expect(all.rows[0]?.n).toBe(2);
      const raw = await appPool.query<{ n: number }>("select count(*)::int as n from child_permission_changes");
      expect(raw.rows).toEqual([{ n: 0 }]);
    });
  });
});
