// Database suite for Locked rules (Story 2.4): runs against a real PostgreSQL 18
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
import {
  isEffectiveStandardSet,
  isLockedRuleState,
  isProjectInfo,
  isProjectTree,
  isStandardInfo,
} from "@domain-harness/contract";
import type {
  EffectiveStandardSet,
  LockedRuleState,
  ProjectInfo,
  ProjectTree,
  SessionInfo,
  StandardInfo,
  UuidV7,
} from "@domain-harness/contract";
import { createRegistryDb } from "../db/client.ts";
import type { RegistryDb } from "../db/client.ts";
import { migrate } from "../db/migrate.ts";
import { lockedRuleChanges } from "../db/schema.ts";
import { withTenant } from "../db/tenant-scope.ts";
import { createRegistryServer } from "../http/server.ts";
import { MemoryTransport } from "../mail/memory.ts";
import { assignModuleOwner, createModule, createModuleService } from "../modules/service.ts";
import { createProjectService } from "../projects/service.ts";
import { consumeSignInLink, createSignInService, requestSignInLinks } from "../sign-in/service.ts";
import { createStandardService } from "../standards/service.ts";
import { provisionCompany } from "../tenancy/provision.ts";
import { createLockedRuleService } from "./service.ts";
import { createApplicationService } from "../applications/service.ts";
import { createBoilerplateService } from "../boilerplate/service.ts";
import { createCompilationsService } from "../compilations/service.ts";
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
const PANEL = { panelUrl: "http://panel.test" };

if (adminUrl === undefined || adminUrl === "") {
  if (inCi) {
    describe("Locked rule database suite", () => {
      it(`requires ${ENV} when CI is set`, () => {
        expect.fail(`${ENV} is not set; CI must run the database suite against PostgreSQL 18`);
      });
    });
  } else {
    process.stderr.write(`locked-rules.db.test.ts skipped: ${ENV} is not set (see README, "Database")\n`);
  }
}

function withDatabase(url: string, database: string, role?: string): string {
  const next = new URL(url);
  next.pathname = `/${database}`;
  if (role !== undefined) next.searchParams.set("options", `-c role=${role}`);
  return next.toString();
}

describe.skipIf(adminUrl === undefined || adminUrl === "")("Locked rules against PostgreSQL", () => {
  const database = `dh_registry_locked_${randomBytes(6).toString("hex")}`;
  let admin: pg.Client;
  let owner: pg.Client;
  let appPool: pg.Pool;
  let db: RegistryDb;
  let server: Server;
  let base: string;

  let tenantA: UuidV7;
  let tenantB: UuidV7;
  let rootA: UuidV7;
  let rootB: UuidV7;
  let buyer: SessionInfo;
  let bob: SessionInfo;
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

  async function lockedRows(standardId?: string): Promise<{ locked: boolean; sequence: number }[]> {
    const { rows } =
      standardId === undefined
        ? await owner.query<{ locked: boolean; sequence: number }>(
            "select locked, sequence from locked_rule_changes order by tenant_id, sequence",
          )
        : await owner.query<{ locked: boolean; sequence: number }>(
            "select locked, sequence from locked_rule_changes where standard_id = $1 order by sequence",
            [standardId],
          );
    return rows;
  }

  async function rowCount(): Promise<number> {
    return (await lockedRows()).length;
  }

  async function tree(who = "buyer"): Promise<ProjectTree> {
    const response = await get("/v1/projects", who);
    const body: unknown = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    if (!isProjectTree(body)) throw new Error("not a ProjectTree");
    return body;
  }

  async function created(name: string, parentId: string, who = "buyer"): Promise<ProjectInfo> {
    const response = await post("/v1/projects", who, { name, levelName: "Team", parentId });
    const body: unknown = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(201);
    if (!isProjectInfo(body)) throw new Error("not a ProjectInfo");
    return body;
  }

  async function publish(name: string, status: string, projectId: string, moduleId = codeStack, who = "sam"): Promise<StandardInfo> {
    const response = await post(`/v1/modules/${moduleId}/standards`, who, {
      entry: { category: "library", name, status },
      projectId,
    });
    const body: unknown = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(201);
    if (!isStandardInfo(body)) throw new Error("not a StandardInfo");
    return body;
  }

  const lockPath = (standardId: string) => `/v1/standards/${standardId}/locked-rule`;

  async function mark(standardId: string, locked: boolean, who = "buyer"): Promise<LockedRuleState> {
    const response = await post(lockPath(standardId), who, { locked });
    const body: unknown = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    if (!isLockedRuleState(body)) throw new Error("not a LockedRuleState");
    return body;
  }

  async function effective(projectId: string): Promise<EffectiveStandardSet> {
    const response = await get(`/v1/projects/${projectId}/effective-standards`, "buyer");
    const body: unknown = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    if (!isEffectiveStandardSet(body)) throw new Error("not an EffectiveStandardSet");
    return body;
  }

  const named = (set: EffectiveStandardSet, name: string) =>
    set.standards.filter((entry) => entry.slot.name.trim().toLowerCase() === name.toLowerCase());

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
      accounts: [
        { name: "Bob Buyer", email: "bob@bolt.io", role: "Buyer" },
        { name: "Ola Owner", email: "ola@bolt.io", role: "Standard owner" },
      ],
    });
    tenantA = a.tenantId;
    tenantB = b.tenantId;
    rootA = a.rootProjectId;
    rootB = b.rootProjectId;
    const session = (tenantId: UuidV7, account: { id: UuidV7; role: SessionInfo["role"] } | undefined) => {
      if (account === undefined) throw new Error("missing account");
      return { accountId: account.id, tenantId, role: account.role };
    };
    const [aBuyer, aSam] = a.accounts.map((account) => session(tenantA, account)) as [SessionInfo, SessionInfo];
    const [bBuyer, bOla] = b.accounts.map((account) => session(tenantB, account)) as [SessionInfo, SessionInfo];
    buyer = aBuyer;
    bob = bBuyer;

    const cs = await createModule(db, buyer, { kind: "code-stack", name: "Locked stack" });
    await assignModuleOwner(db, buyer, cs.id, { accountId: aSam.accountId });
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
        compilations: createCompilationsService(db),
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

    // Tenant B holds a Locked rule of its own, so the table holds rows of both tenants.
    const boltStack = await createModule(db, bob, { kind: "code-stack", name: "Bolt stack" });
    await assignModuleOwner(db, bob, boltStack.id, { accountId: bOla.accountId });
    const boltStandard = await publish("BoltLib", "approved", rootB, boltStack.id, "ola");
    await mark(boltStandard.id, true, "bob");
  }, 60_000);

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await appPool.end();
    await owner.end();
    await admin.query(`drop database if exists ${database} with (force)`);
    await admin.end();
  }, 60_000);

  describe("migration 0007", () => {
    it("enables and forces RLS with the tenant_isolation policy and grants SELECT and INSERT only", async () => {
      const { rows } = await owner.query<{ rls: boolean; forced: boolean; policies: string[] }>(
        `select c.relrowsecurity as rls, c.relforcerowsecurity as forced,
                array(select p.polname::text from pg_policy p where p.polrelid = c.oid order by 1) as policies
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname = 'locked_rule_changes'`,
      );
      expect(rows).toEqual([{ rls: true, forced: true, policies: ["tenant_isolation"] }]);
      const grants = await owner.query<{ privilege_type: string }>(
        `select privilege_type from information_schema.role_table_grants
         where grantee = $1 and table_name = 'locked_rule_changes' order by 1`,
        [APP_ROLE],
      );
      expect(grants.rows).toEqual([{ privilege_type: "INSERT" }, { privilege_type: "SELECT" }]);
    });

    it("refuses UPDATE and DELETE for the app role", async () => {
      for (const statement of ["update locked_rule_changes set locked = not locked", "delete from locked_rule_changes"]) {
        await expect(
          withTenant(db, tenantA, async (tx) => {
            await tx.execute(sql.raw(statement));
          }),
        ).rejects.toThrow();
      }
    });
  });

  describe("marking, unmarking and resolution", () => {
    let p: ProjectInfo;
    let c: ProjectInfo;
    let s: StandardInfo;
    let childX: StandardInfo;

    beforeAll(async () => {
      // rootA ── P ── C
      p = await created("Lock P", rootA);
      c = await created("Lock C", p.id);
      s = await publish("LockX", "prohibited", p.id);
      childX = await publish("lockx", "approved", c.id);
    }, 60_000);

    it("marks a Standard as a Locked rule: 200, one row, shown on the tree and in P's set", async () => {
      const before = await rowCount();
      const state = await mark(s.id, true);
      expect(state).toMatchObject({ standard: { id: s.id }, locked: true, changedBy: { accountId: buyer.accountId, name: "Bea Buyer" } });
      expect(await rowCount()).toBe(before + 1);
      const marks = (await tree()).lockedRules.filter((m) => m.projectId === p.id);
      expect(marks).toMatchObject([{ standardId: s.id, projectId: p.id, markedBy: { accountId: buyer.accountId } }]);
      expect(named(await effective(p.id), "lockx")).toMatchObject([{ standard: { id: s.id }, locked: true }]);
    });

    it("lets the Locked rule beat a closer Standard: C's set keeps P's prohibition", async () => {
      const x = named(await effective(c.id), "lockx");
      expect(x).toHaveLength(1);
      expect(x[0]).toMatchObject({ standard: { id: s.id }, status: "prohibited", sourceProject: { id: p.id }, locked: true });
    });

    it("writes nothing when marking an already locked Standard or unmarking a never-locked one", async () => {
      const before = await rowCount();
      expect(await mark(s.id, true)).toMatchObject({ locked: true });
      expect(await mark(childX.id, false)).toMatchObject({ locked: false, changedAt: null, changedBy: null });
      expect(await rowCount()).toBe(before);
    });

    it("refuses a contradicting descendant Locked rule with 409 naming both, subject = the ancestor's", async () => {
      const before = await rowCount();
      const response = await post(lockPath(childX.id), "buyer", { locked: true });
      const body = (await response.json()) as { message: string };
      expect([response.status, body]).toMatchObject([409, { code: "locked_rule_conflict", subject: s.id }]);
      expect(body.message).toContain(childX.id);
      expect(body.message).toContain(s.id);
      expect(await rowCount()).toBe(before);
    });

    it("unmarks with a new row, keeps the history, and lets C's Standard win again", async () => {
      await mark(s.id, false);
      expect(await lockedRows(s.id)).toEqual([
        { locked: true, sequence: expect.any(Number) as number },
        { locked: false, sequence: expect.any(Number) as number },
      ]);
      expect((await tree()).lockedRules.some((m) => m.standardId === s.id)).toBe(false);
      expect(named(await effective(c.id), "lockx")).toMatchObject([
        { standard: { id: childX.id }, status: "approved", sourceProject: { id: c.id }, locked: false },
      ]);
    });

    it("refuses a contradicting ancestor Locked rule with 409, subject = the descendant's Standard", async () => {
      await mark(childX.id, true);
      const before = await rowCount();
      await expectRefused(await post(lockPath(s.id), "buyer", { locked: true }), 409, "locked_rule_conflict", childX.id);
      expect(await rowCount()).toBe(before);
      await mark(childX.id, false);
    });
  });

  describe("contradictions across the tree and versions", () => {
    it("accepts the same Locked slot on sibling Projects", async () => {
      const s1 = await created("Sibling 1", rootA);
      const s2 = await created("Sibling 2", rootA);
      const a = await publish("SibLib", "prohibited", s1.id);
      const b = await publish("siblib", "approved", s2.id);
      await mark(a.id, true);
      await mark(b.id, true);
      const marks = (await tree()).lockedRules.map((m) => m.standardId);
      expect(marks).toEqual(expect.arrayContaining([a.id, b.id]));
    });

    it("lists the Locked rules ordered by Project id, then Standard id, whatever the marking order", async () => {
      const first = await created("Order 1", rootA);
      const second = await created("Order 2", rootA);
      // UUIDv7 ids increase with time: b1 (at the later Project) gets the smallest
      // Standard id, so Standard-id order differs from (Project id, Standard id) order.
      const b1 = await publish("OrderB1", "approved", second.id);
      const a1 = await publish("OrderA1", "approved", first.id);
      const a2 = await publish("OrderA2", "approved", first.id);
      for (const standard of [b1, a2, a1]) await mark(standard.id, true);
      const ours = new Set([a1.id, a2.id, b1.id]);
      const listed = (await tree()).lockedRules.filter((m) => ours.has(m.standardId)).map((m) => [m.projectId, m.standardId]);
      const expected = [
        [first.id, a1.id],
        [first.id, a2.id],
        [second.id, b1.id],
      ].sort((x, y) => (x.join() < y.join() ? -1 : x.join() > y.join() ? 1 : 0));
      expect(listed).toEqual(expected);
      // The whole list is in that order too.
      const all = (await tree()).lockedRules.map((m) => `${m.projectId}|${m.standardId}`);
      expect(all).toEqual([...all].sort());
    });

    it("lets unlocked holders publish and Projects be created without a false contradiction", async () => {
      const p = await created("Free P", rootA);
      const c = await created("Free C", p.id);
      const s = await publish("FreeLib", "prohibited", p.id);
      await mark(s.id, true);
      const closer = await publish("freelib", "approved", c.id);
      expect(closer.project.id).toBe(c.id);
      const x = named(await effective(c.id), "freelib");
      expect(x).toMatchObject([{ standard: { id: s.id }, sourceProject: { id: p.id }, locked: true }]);
      const grandchild = await created("Free G", p.id);
      expect(grandchild.parentId).toBe(p.id);
    });

    it("refuses a re-parent that puts a Locked rule under a contradicting ancestor Locked rule", async () => {
      const p = await created("Reparent P", rootA);
      const q = await created("Reparent Q", rootA);
      await mark((await publish("MoveLib", "prohibited", p.id)).id, true);
      await mark((await publish("movelib", "approved", q.id)).id, true);
      await expectRefused(await post(`/v1/projects/${q.id}/parent`, "buyer", { parentId: p.id }), 409, "locked_rule_conflict");
      expect((await tree()).projects.find((project) => project.id === q.id)?.parentId).toBe(rootA);
    });

    it("refuses a new version that moves a locked Standard into a contradicting slot", async () => {
      const p = await created("Version P", rootA);
      const c = await created("Version C", p.id);
      const s = await publish("VerTarget", "prohibited", p.id);
      const t = await publish("VerOther", "approved", c.id);
      await mark(s.id, true);
      await mark(t.id, true);
      const response = await post(`/v1/standards/${t.id}/versions`, "sam", {
        entry: { category: "library", name: "vertarget", status: "approved" },
      });
      await expectRefused(response, 409, "locked_rule_conflict", s.id);
      const { rows } = await owner.query("select 1 from standard_versions where standard_id = $1", [t.id]);
      expect(rows).toHaveLength(1);
    });
  });

  describe("refusals", () => {
    let standard: StandardInfo;

    beforeAll(async () => {
      standard = await publish("RefuseLib", "approved", rootA);
    });

    it("refuses the Standard owner and the Builder with 403 role_denied, writing nothing", async () => {
      const before = await rowCount();
      for (const who of ["sam", "builder"]) {
        for (const locked of [true, false]) {
          const response = await post(lockPath(standard.id), who, { locked });
          const body = (await response.json()) as { message: string };
          expect([response.status, body]).toMatchObject([403, { code: "role_denied", subject: "role" }]);
          expect(body.message).toBe("only the Buyer can mark or remove a Locked rule; nothing was changed");
        }
      }
      expect(await rowCount()).toBe(before);
    });

    it("answers 404 standard_not_found for a foreign, unknown or malformed id", async () => {
      await expectRefused(await post(lockPath(standard.id), "bob", { locked: true }), 404, "standard_not_found");
      await expectRefused(
        await post(lockPath("01928c7e-5b2a-7c3d-8e4f-000000000009"), "buyer", { locked: true }),
        404,
        "standard_not_found",
      );
      await expectRefused(await post(lockPath("nope"), "buyer", { locked: true }), 404, "standard_not_found");
    });

    it.each([
      ["an empty body", {}, "locked"],
      ["a string flag", { locked: "yes" }, "locked"],
      ["an extra key", { locked: true, note: "x" }, "note"],
    ])("answers 400 invalid_input for %s, writing nothing", async (_label, body, subject) => {
      const before = await rowCount();
      await expectRefused(await post(lockPath(standard.id), "buyer", body), 400, "invalid_input", subject);
      expect(await rowCount()).toBe(before);
    });
  });

  describe("tenant isolation", () => {
    it("shows each Company only its own Locked rules", async () => {
      const bTree = await tree("bob");
      expect(bTree.lockedRules).toHaveLength(1);
      expect(bTree.lockedRules.every((m) => m.projectId === rootB)).toBe(true);
      expect((await tree("buyer")).lockedRules.some((m) => m.projectId === rootB)).toBe(false);
    });

    it("RLS returns only the context tenant's rows when the tenant filter is omitted", async () => {
      const seen = await withTenant(db, tenantA, (tx) => tx.select().from(lockedRuleChanges));
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every((row) => row.tenantId === tenantA)).toBe(true);
      const all = await owner.query<{ n: number }>("select count(distinct tenant_id)::int as n from locked_rule_changes");
      expect(all.rows[0]?.n).toBe(2);
      const raw = await appPool.query<{ n: number }>("select count(*)::int as n from locked_rule_changes");
      expect(raw.rows).toEqual([{ n: 0 }]);
    });
  });
});
