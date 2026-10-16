// Database suite for plan refusals (Story 2.6): runs against a real
// PostgreSQL 18 named by REGISTRY_TEST_DATABASE_URL (an admin connection).
// Like the other suites it creates a throwaway database, migrates it as the
// admin (owner) and runs every data-access call as dh_registry_app
// (`-c role=dh_registry_app`). Every matrix row is exercised over HTTP with
// real sessions as Bearer tokens. A downgraded tenant is simulated by
// updating `tenants.plan` as the owner, since the app role has no UPDATE.
import type { AddressInfo } from "node:net";
import { ed25519SignerFromEnv } from "../bundles/sign.ts";
import type { Server } from "node:http";
import { randomBytes, generateKeyPairSync } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isLockedRuleState, isProjectInfo, isStandardInfo, PLANS } from "@domain-harness/contract";
import type { ProjectInfo, SessionInfo, StandardInfo, UuidV7 } from "@domain-harness/contract";
import { createRegistryDb } from "../db/client.ts";
import type { RegistryDb } from "../db/client.ts";
import { migrate } from "../db/migrate.ts";
import { createApplicationService } from "../applications/service.ts";
import { createBoilerplateService } from "../boilerplate/service.ts";
import { createCompilationsService } from "../compilations/service.ts";
import { createGuidanceAccessService } from "../guidance-access/service.ts";
import { createAcceptedDeviationsService } from "../accepted-deviations/service.ts";
import { createAcceptedDeviationAlertsService } from "../accepted-deviation-alerts/service.ts";
import { createGuidanceEndpointService } from "../guidance-endpoint/service.ts";
import { createBuildGrantService } from "../build-grants/service.ts";
import { createChildPermissionService } from "../child-permissions/service.ts";
import { createRegistryServer } from "../http/server.ts";
import { createLockedRuleService } from "../locked-rules/service.ts";
import { MemoryTransport } from "../mail/memory.ts";
import { assignModuleOwner, createModule, createModuleService } from "../modules/service.ts";
import { createProjectService } from "../projects/service.ts";
import { consumeSignInLink, createSignInService, requestSignInLinks } from "../sign-in/service.ts";
import { createStandardService } from "../standards/service.ts";
import { provisionCompany } from "./provision.ts";

const ENV = "REGISTRY_TEST_DATABASE_URL";
const adminUrl = process.env[ENV];
const inCi = process.env["CI"] !== undefined && process.env["CI"] !== "" && process.env["CI"] !== "false";
const APP_ROLE = "dh_registry_app";
const MIGRATION_SUITE_LOCK = 7_202_610_103;
const PANEL = { panelUrl: "http://panel.test" };

if (adminUrl === undefined || adminUrl === "") {
  if (inCi) {
    describe("plan refusal database suite", () => {
      it(`requires ${ENV} when CI is set`, () => {
        expect.fail(`${ENV} is not set; CI must run the database suite against PostgreSQL 18`);
      });
    });
  } else {
    process.stderr.write(`plan.db.test.ts skipped: ${ENV} is not set (see README, "Database")\n`);
  }
}

function withDatabase(url: string, database: string, role?: string): string {
  const next = new URL(url);
  next.pathname = `/${database}`;
  if (role !== undefined) next.searchParams.set("options", `-c role=${role}`);
  return next.toString();
}

interface Company {
  readonly tenantId: UuidV7;
  readonly rootId: UuidV7;
  readonly buyer: SessionInfo;
  readonly owner: SessionInfo;
  readonly builder: SessionInfo;
  readonly moduleId: string;
}

describe.skipIf(adminUrl === undefined || adminUrl === "")("plan refusals against PostgreSQL", () => {
  const database = `dh_registry_plan_${randomBytes(6).toString("hex")}`;
  let admin: pg.Client;
  let owner: pg.Client;
  let appPool: pg.Pool;
  let db: RegistryDb;
  let server: Server;
  let base: string;

  /** A fresh Community tenant with only its root. */
  let community: Company;
  /** A Team tenant that built a tree and a Locked rule, then was downgraded to Community. */
  let downgraded: Company;
  /** A Team tenant. */
  let team: Company;

  /** Bearer headers per `${prefix}-${role}`, from real sign-ins. */
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

  async function expectRefused(response: Response, status: number, code: string, subject?: string): Promise<string> {
    const body = (await response.json()) as { message?: string };
    expect([response.status, body]).toMatchObject([status, subject === undefined ? { code } : { code, subject }]);
    return body.message ?? "";
  }

  /** Rows written by a tenant across every tree table. */
  async function written(tenantId: string): Promise<Record<string, number>> {
    const { rows } = await owner.query<Record<string, number>>(
      `select (select count(*)::int from projects where tenant_id = $1) as projects,
              (select count(*)::int from project_parent_changes where tenant_id = $1) as parent_changes,
              (select count(*)::int from locked_rule_changes where tenant_id = $1) as locked_rule_changes,
              (select count(*)::int from child_permission_changes where tenant_id = $1) as child_permission_changes`,
      [tenantId],
    );
    return rows[0] ?? {};
  }

  async function currentParent(projectId: string): Promise<string | null> {
    const { rows } = await owner.query<{ parent_id: string | null }>(
      `select parent_id::text from project_parent_changes where project_id = $1 order by sequence desc limit 1`,
      [projectId],
    );
    return rows[0]?.parent_id ?? null;
  }

  const createBody = (name: string, parentId: string) => ({ name, levelName: "Team", parentId });

  async function created(prefix: string, name: string, parentId: string): Promise<ProjectInfo> {
    const response = await post("/v1/projects", `${prefix}-buyer`, createBody(name, parentId));
    const body: unknown = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(201);
    if (!isProjectInfo(body)) throw new Error("not a ProjectInfo");
    return body;
  }

  async function publish(prefix: string, company: Company, name: string): Promise<StandardInfo> {
    const response = await post(`/v1/modules/${company.moduleId}/standards`, `${prefix}-owner`, {
      entry: { category: "library", name, status: "approved" },
      projectId: company.rootId,
    });
    const body: unknown = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(201);
    if (!isStandardInfo(body)) throw new Error("not a StandardInfo");
    return body;
  }

  async function setLock(prefix: string, standardId: string, locked: boolean): Promise<Response> {
    return post(`/v1/standards/${standardId}/locked-rule`, `${prefix}-buyer`, { locked });
  }

  async function provision(prefix: string, plan: (typeof PLANS)[number]): Promise<Company> {
    const result = await provisionCompany(db, {
      company: `Company ${prefix}`,
      plan,
      accounts: [
        { name: "Bea Buyer", email: `bea@${prefix}.io`, role: "Buyer" },
        { name: "Sam Owner", email: `sam@${prefix}.io`, role: "Standard owner" },
        { name: "Bo Builder", email: `bo@${prefix}.io`, role: "Builder" },
      ],
    });
    const [buyer, sam, bo] = result.accounts.map((account) => ({
      accountId: account.id,
      tenantId: result.tenantId,
      role: account.role,
    })) as [SessionInfo, SessionInfo, SessionInfo];
    const module = await createModule(db, buyer, { kind: "code-stack", name: `Stack ${prefix}` });
    await assignModuleOwner(db, buyer, module.id, { accountId: sam.accountId });
    return { tenantId: result.tenantId, rootId: result.rootProjectId, buyer, owner: sam, builder: bo, moduleId: module.id };
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

    const { privateKey: guidanceAccessKey } = generateKeyPairSync("ed25519");
    const guidanceAccessSigner = ed25519SignerFromEnv({
      REGISTRY_BUNDLE_SIGNING_KEY: guidanceAccessKey.export({ type: "pkcs8", format: "pem" }) as string,
      REGISTRY_BUNDLE_SIGNING_KEY_ID: "guidance-access-test-key",
    });

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
        guidanceAccess: createGuidanceAccessService(db, guidanceAccessSigner),
      },
      () => undefined,
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;

    community = await provision("comm", "Community");
    downgraded = await provision("down", "Team");
    team = await provision("team", "Team");
    for (const prefix of ["comm", "down", "team"]) {
      for (const [role, local] of [
        ["buyer", "bea"],
        ["owner", "sam"],
        ["builder", "bo"],
      ] as const) {
        auth[`${prefix}-${role}`] = { authorization: `Bearer ${await sessionToken(`${local}@${prefix}.io`)}` };
      }
    }
  }, 60_000);

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await appPool.end();
    await owner.end();
    await admin.query(`drop database if exists ${database} with (force)`);
    await admin.end();
  }, 60_000);

  describe("a Community tenant with only its root", () => {
    it("refuses the Buyer's create with 403 plan_refused naming the capability, writing nothing", async () => {
      const before = await written(community.tenantId);
      const message = await expectRefused(
        await post("/v1/projects", "comm-buyer", createBody("Second", community.rootId)),
        403,
        "plan_refused",
        "plan",
      );
      expect(message).toBe("this Company's plan does not include creating another Project; nothing was changed");
      for (const plan of PLANS) expect(message).not.toContain(plan);
      expect(message).not.toMatch(/\$|€|£|price/i);
      expect(await written(community.tenantId)).toEqual(before);
    });

    it("refuses a Builder without a grant with plan_refused, not child_permission_denied", async () => {
      const before = await written(community.tenantId);
      await expectRefused(
        await post("/v1/projects", "comm-builder", createBody("No grant", community.rootId)),
        403,
        "plan_refused",
        "plan",
      );
      expect(await written(community.tenantId)).toEqual(before);
    });

    it("refuses a grant holder's create with 403 plan_refused; the grant itself stays allowed", async () => {
      const grant = await post(`/v1/projects/${community.rootId}/child-permissions`, "comm-buyer", {
        accountId: community.builder.accountId,
        granted: true,
      });
      expect(grant.status).toBe(200);
      const before = await written(community.tenantId);
      await expectRefused(
        await post("/v1/projects", "comm-builder", createBody("Granted", community.rootId)),
        403,
        "plan_refused",
        "plan",
      );
      expect(await written(community.tenantId)).toEqual(before);
    });

    it("refuses an invalid create body with plan_refused (plan before body)", async () => {
      const before = await written(community.tenantId);
      for (const body of [{}, { ...createBody("", community.rootId) }, { ...createBody("X", community.rootId), extra: 1 }]) {
        await expectRefused(await post("/v1/projects", "comm-buyer", body), 403, "plan_refused", "plan");
      }
      expect(await written(community.tenantId)).toEqual(before);
    });

    it("refuses the Buyer's mark with 403 plan_refused, writing no row", async () => {
      const standard = await publish("comm", community, "comm-lib");
      const before = await written(community.tenantId);
      const message = await expectRefused(await setLock("comm", standard.id, true), 403, "plan_refused", "plan");
      expect(message).toBe("this Company's plan does not include marking a Locked rule; nothing was changed");
      expect(await written(community.tenantId)).toEqual(before);
    });

    it("answers an unknown Standard on the lock route with 404 standard_not_found (before the plan)", async () => {
      const before = await written(community.tenantId);
      await expectRefused(
        await post("/v1/standards/01928c7e-5b2a-7c3d-8e4f-000000000009/locked-rule", "comm-buyer", { locked: true }),
        404,
        "standard_not_found",
      );
      expect(await written(community.tenantId)).toEqual(before);
    });

    it("keeps revoking a grant open: 200 and one row", async () => {
      const path = `/v1/projects/${community.rootId}/child-permissions`;
      const granted = await post(path, "comm-buyer", { accountId: community.owner.accountId, granted: true });
      expect(granted.status).toBe(200);
      const before = await written(community.tenantId);
      const revoked = await post(path, "comm-buyer", { accountId: community.owner.accountId, granted: false });
      expect(revoked.status).toBe(200);
      expect(await revoked.json()).toMatchObject({ granted: false });
      expect(await written(community.tenantId)).toEqual({
        ...before,
        child_permission_changes: (before["child_permission_changes"] ?? 0) + 1,
      });
    });

    it("answers a non-Buyer's mark with role_denied (role before plan)", async () => {
      const standard = await publish("comm", community, "comm-lib-2");
      const before = await written(community.tenantId);
      await expectRefused(
        await post(`/v1/standards/${standard.id}/locked-rule`, "comm-builder", { locked: true }),
        403,
        "role_denied",
        "role",
      );
      expect(await written(community.tenantId)).toEqual(before);
    });

    it("keeps every read open: the tree, the Effective set and the permissions", async () => {
      for (const path of [
        "/v1/projects",
        `/v1/projects/${community.rootId}`,
        `/v1/projects/${community.rootId}/effective-standards`,
        `/v1/projects/${community.rootId}/child-permissions`,
      ]) {
        expect([path, (await get(path, "comm-builder")).status]).toEqual([path, 200]);
      }
    });
  });

  describe("a tenant downgraded to Community", () => {
    let p: ProjectInfo;
    let c: ProjectInfo;
    let locked: StandardInfo;
    let open: StandardInfo;

    beforeAll(async () => {
      p = await created("down", "Down P", downgraded.rootId);
      c = await created("down", "Down C", p.id);
      locked = await publish("down", downgraded, "down-locked");
      open = await publish("down", downgraded, "down-open");
      expect((await setLock("down", locked.id, true)).status).toBe(200);
      await owner.query("update tenants set plan = 'Community' where id = $1", [downgraded.tenantId]);
    }, 60_000);

    it("refuses a parent change with 403 plan_refused; the parent is unchanged", async () => {
      const before = await written(downgraded.tenantId);
      const message = await expectRefused(
        await post(`/v1/projects/${c.id}/parent`, "down-buyer", { parentId: downgraded.rootId }),
        403,
        "plan_refused",
        "plan",
      );
      expect(message).toBe("this Company's plan does not include setting a parent; nothing was changed");
      expect(await currentParent(c.id)).toBe(p.id);
      expect(await written(downgraded.tenantId)).toEqual(before);
    });

    it("refuses an invalid parent body with plan_refused (plan before body)", async () => {
      await expectRefused(await post(`/v1/projects/${c.id}/parent`, "down-buyer", { parentId: null }), 403, "plan_refused", "plan");
    });

    it("answers a non-Buyer's parent change with role_denied, and an unknown Project with 404", async () => {
      await expectRefused(
        await post(`/v1/projects/${c.id}/parent`, "down-builder", { parentId: downgraded.rootId }),
        403,
        "role_denied",
        "role",
      );
      await expectRefused(
        await post("/v1/projects/01928c7e-5b2a-7c3d-8e4f-000000000009/parent", "down-buyer", { parentId: downgraded.rootId }),
        404,
        "project_not_found",
        "projectId",
      );
    });

    it("refuses a new mark, but answers 200 to an already-locked mark (no row) and to an unmark (one row)", async () => {
      let before = await written(downgraded.tenantId);
      await expectRefused(await setLock("down", open.id, true), 403, "plan_refused", "plan");
      expect(await written(downgraded.tenantId)).toEqual(before);

      const same = await setLock("down", locked.id, true);
      expect(same.status).toBe(200);
      expect(isLockedRuleState(await same.json())).toBe(true);
      expect(await written(downgraded.tenantId)).toEqual(before);

      const unmark = await setLock("down", locked.id, false);
      expect(unmark.status).toBe(200);
      expect(await unmark.json()).toMatchObject({ locked: false });
      expect((await written(downgraded.tenantId))["locked_rule_changes"]).toBe((before["locked_rule_changes"] ?? 0) + 1);

      before = await written(downgraded.tenantId);
      await expectRefused(await setLock("down", locked.id, true), 403, "plan_refused", "plan");
      expect(await written(downgraded.tenantId)).toEqual(before);
    });

    it("keeps reading its tree, the Effective set and the permissions", async () => {
      const tree = await get("/v1/projects", "down-builder");
      expect(tree.status).toBe(200);
      expect(((await tree.json()) as { projects: unknown[] }).projects).toHaveLength(3);
      for (const path of [`/v1/projects/${c.id}/effective-standards`, `/v1/projects/${p.id}/child-permissions`]) {
        expect([path, (await get(path, "down-builder")).status]).toEqual([path, 200]);
      }
    });
  });

  describe("a Team tenant", () => {
    it("creates, changes a parent and marks a Locked rule as before", async () => {
      const p = await created("team", "Team P", team.rootId);
      const q = await created("team", "Team Q", team.rootId);
      const moved = await post(`/v1/projects/${q.id}/parent`, "team-buyer", { parentId: p.id });
      expect(moved.status).toBe(200);
      expect(await currentParent(q.id)).toBe(p.id);
      const standard = await publish("team", team, "team-lib");
      const mark = await setLock("team", standard.id, true);
      expect(mark.status).toBe(200);
      expect(await mark.json()).toMatchObject({ locked: true });
    });
  });
});
