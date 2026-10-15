// Database suite for the Applications (Story 3.1): runs against a
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
  applicationIdentificationFilePath,
  formatIdentificationFile,
  isApplicationInfo,
  isApplicationList,
  isBuildGrantState,
  isIdentificationFileRendering,
  isProjectInfo,
  isUuidV7,
  parseIdentificationFile,
} from "@domain-harness/contract";
import type {
  ApplicationInfo,
  ApplicationList,
  ProjectInfo,
  SessionInfo,
  UuidV7,
} from "@domain-harness/contract";
import { createRegistryDb } from "../db/client.ts";
import type { RegistryDb } from "../db/client.ts";
import { migrate } from "../db/migrate.ts";
import { applications } from "../db/schema.ts";
import { withTenant } from "../db/tenant-scope.ts";
import { createRegistryServer, MAX_BODY_BYTES } from "../http/server.ts";
import { createLockedRuleService } from "../locked-rules/service.ts";
import { MemoryTransport } from "../mail/memory.ts";
import { createModuleService } from "../modules/service.ts";
import { createProjectService } from "../projects/service.ts";
import { consumeSignInLink, createSignInService, requestSignInLinks } from "../sign-in/service.ts";
import { createStandardService } from "../standards/service.ts";
import { provisionCompany } from "../tenancy/provision.ts";
import { createBuildGrantService } from "../build-grants/service.ts";
import { createChildPermissionService } from "../child-permissions/service.ts";
import { createApplicationService } from "./service.ts";
import { createBoilerplateService } from "../boilerplate/service.ts";
import { createAcceptedDeviationsService } from "../accepted-deviations/service.ts";
import { createAcceptedDeviationAlertsService } from "../accepted-deviation-alerts/service.ts";
import { createGuidanceEndpointService } from "../guidance-endpoint/service.ts";

const ENV = "REGISTRY_TEST_DATABASE_URL";
const adminUrl = process.env[ENV];
const inCi = process.env["CI"] !== undefined && process.env["CI"] !== "" && process.env["CI"] !== "false";
const APP_ROLE = "dh_registry_app";
const MIGRATION_SUITE_LOCK = 7_202_610_103;
const PANEL = { panelUrl: "http://panel.test" };

if (adminUrl === undefined || adminUrl === "") {
  if (inCi) {
    describe("Application database suite", () => {
      it(`requires ${ENV} when CI is set`, () => {
        expect.fail(`${ENV} is not set; CI must run the database suite against PostgreSQL 18`);
      });
    });
  } else {
    process.stderr.write(`applications.db.test.ts skipped: ${ENV} is not set (see README, "Database")\n`);
  }
}

function withDatabase(url: string, database: string, role?: string): string {
  const next = new URL(url);
  next.pathname = `/${database}`;
  if (role !== undefined) next.searchParams.set("options", `-c role=${role}`);
  return next.toString();
}

describe.skipIf(adminUrl === undefined || adminUrl === "")("Applications against PostgreSQL", () => {
  const database = `dh_registry_apps_${randomBytes(6).toString("hex")}`;
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
  let bo: SessionInfo;
  let boltApp: ApplicationInfo;

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

  const APPS = "/v1/applications";
  const grantPath = (projectId: string) => `/v1/projects/${projectId}/build-grants`;

  async function appRows(): Promise<number> {
    const { rows } = await owner.query<{ n: number }>("select count(*)::int as n from applications");
    return rows[0]?.n ?? 0;
  }

  async function setGrant(projectId: string, accountId: string, granted: boolean, who = "buyer"): Promise<void> {
    const response = await post(grantPath(projectId), who, { accountId, granted });
    const body: unknown = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(isBuildGrantState(body)).toBe(true);
  }

  async function created(name: string, parentId: string): Promise<ProjectInfo> {
    const response = await post("/v1/projects", "buyer", { name, levelName: "Team", parentId });
    const body: unknown = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(201);
    if (!isProjectInfo(body)) throw new Error("not a ProjectInfo");
    return body;
  }

  async function placed(description: string, projectId: string, who: string): Promise<ApplicationInfo> {
    const response = await post(APPS, who, { description, projectId });
    const body: unknown = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(201);
    if (!isApplicationInfo(body)) throw new Error("not an ApplicationInfo");
    return body;
  }

  async function listed(who = "buyer"): Promise<ApplicationList> {
    const response = await get(APPS, who);
    const body: unknown = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    if (!isApplicationList(body)) throw new Error("not an ApplicationList");
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
    bo = session(a.tenantId, a.accounts[2]);
    buyer = session(a.tenantId, a.accounts[0]);

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

    // Tenant B holds an Application of its own, so the table holds rows of both tenants.
    boltApp = await placed("Bolt app", rootB, "bob");
  }, 60_000);

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await appPool.end();
    await owner.end();
    await admin.query(`drop database if exists ${database} with (force)`);
    await admin.end();
  }, 60_000);

  describe("migration 0009 (applications)", () => {
    it("enables and forces RLS with the tenant_isolation policy and grants SELECT and INSERT only", async () => {
      const { rows } = await owner.query<{ rls: boolean; forced: boolean; policies: string[] }>(
        `select c.relrowsecurity as rls, c.relforcerowsecurity as forced,
                array(select p.polname::text from pg_policy p where p.polrelid = c.oid order by 1) as policies
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname = 'applications'`,
      );
      expect(rows).toEqual([{ rls: true, forced: true, policies: ["tenant_isolation"] }]);
      const grants = await owner.query<{ privilege_type: string }>(
        `select privilege_type from information_schema.role_table_grants
         where grantee = $1 and table_name = 'applications' order by 1`,
        [APP_ROLE],
      );
      expect(grants.rows).toEqual([{ privilege_type: "INSERT" }, { privilege_type: "SELECT" }]);
    });

    it("refuses UPDATE and DELETE for the app role", async () => {
      for (const statement of ["update applications set from_flow = not from_flow", "delete from applications"]) {
        await expect(
          withTenant(db, tenantA, async (tx) => {
            await tx.execute(sql.raw(statement));
          }),
        ).rejects.toThrow();
      }
    });
  });

  describe("placing an Application", () => {
    let p: ProjectInfo;
    let c: ProjectInfo;

    beforeAll(async () => {
      p = await created("App P", rootA);
      c = await created("App C", p.id);
    }, 60_000);

    it("answers 401 without a session", async () => {
      await expectRefused(await fetch(`${base}${APPS}`), 401, "session_invalid");
      await expectRefused(
        await fetch(`${base}${APPS}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ description: "x", projectId: p.id }),
        }),
        401,
        "session_invalid",
      );
    });

    it("refuses a Builder without a build grant with 403 build_grant_denied, creating nothing", async () => {
      const before = await appRows();
      const response = await post(APPS, "builder", { description: "Checkout", projectId: p.id });
      const body = (await response.json()) as { message: string };
      expect([response.status, body]).toMatchObject([403, { code: "build_grant_denied", subject: "projectId" }]);
      expect(body.message).toBe("you have no build grant on this Project; nothing was created");
      expect(await appRows()).toBe(before);
    });

    it("does not count the child-Project permission as a build grant", async () => {
      const response = await post(`/v1/projects/${p.id}/child-permissions`, "buyer", { accountId: bo.accountId, granted: true });
      expect(response.status).toBe(200);
      const before = await appRows();
      await expectRefused(await post(APPS, "builder", { description: "Checkout", projectId: p.id }), 403, "build_grant_denied", "projectId");
      expect(await appRows()).toBe(before);
    });

    it("places with a grant: 201, a registry-minted UUIDv7, Project P, from the flow, trimmed; listed for the Buyer", async () => {
      await setGrant(p.id, bo.accountId, true);
      const app = await placed("  Checkout service  ", p.id, "builder");
      expect(isUuidV7(app.id)).toBe(true);
      expect(app).toMatchObject({ description: "Checkout service", project: { id: p.id, name: "App P" }, fromFlow: true });
      expect(app.createdAt.endsWith("Z")).toBe(true);
      expect(JSON.stringify(app)).not.toContain("createdBy");
      const { rows } = await owner.query(
        "select from_flow, created_by::text, project_id::text, description from applications where id = $1",
        [app.id],
      );
      expect(rows).toEqual([{ from_flow: true, created_by: bo.accountId, project_id: p.id, description: "Checkout service" }]);
      const list = await listed("buyer");
      expect(list.applications).toContainEqual(app);
      expect(JSON.stringify(list)).not.toContain(bo.accountId);
      expect(JSON.stringify(list)).not.toContain("Bo Builder");
    });

    it("does not inherit the grant: the granted Builder may not place on P's child", async () => {
      const before = await appRows();
      await expectRefused(await post(APPS, "builder", { description: "Child app", projectId: c.id }), 403, "build_grant_denied", "projectId");
      expect(await appRows()).toBe(before);
    });

    it("lets the Buyer place on any Project with no grant", async () => {
      const app = await placed("Buyer app", c.id, "buyer");
      expect(app).toMatchObject({ project: { id: c.id }, fromFlow: true });
    });

    it("lists every Application of the Company to every role, ordered by creation time, then id", async () => {
      for (const who of ["buyer", "sam", "builder"]) {
        const list = await listed(who);
        expect(list.applications.map((a) => a.description)).toEqual(["Checkout service", "Buyer app"]);
      }
    });

    it("refuses after a revoke, writing nothing", async () => {
      await setGrant(p.id, bo.accountId, false);
      const before = await appRows();
      await expectRefused(await post(APPS, "builder", { description: "Late", projectId: p.id }), 403, "build_grant_denied", "projectId");
      expect(await appRows()).toBe(before);
    });

    it("answers 400 projectId for an absent or empty Project, naming the field", async () => {
      const before = await appRows();
      for (const body of [{ description: "Orphan" }, { description: "Orphan", projectId: "" }, { description: "Orphan", projectId: 7 }]) {
        const response = await post(APPS, "buyer", body);
        const envelope = (await response.json()) as { message: string };
        expect([response.status, envelope]).toMatchObject([400, { code: "invalid_input", subject: "projectId" }]);
        expect(envelope.message).toBe("choose a Project for the Application; nothing was created");
      }
      expect(await appRows()).toBe(before);
    });

    it("answers 404 project_not_found for a foreign, unknown or malformed Project, before the grant check", async () => {
      const before = await appRows();
      for (const who of ["buyer", "builder"]) {
        for (const projectId of [rootB, "01928c7e-5b2a-7c3d-8e4f-000000000009", "nope"]) {
          await expectRefused(await post(APPS, who, { description: "Lost", projectId }), 404, "project_not_found", "projectId");
        }
      }
      expect(await appRows()).toBe(before);
    });

    it.each([
      ["a non-object body", [], "body"],
      ["an extra key", { description: "x", projectId: "P", note: 1 }, "note"],
      ["a missing description", { projectId: "P" }, "description"],
      ["a numeric description", { description: 7, projectId: "P" }, "description"],
      ["a blank description", { description: "   ", projectId: "P" }, "description"],
      ["a 501-character description", { description: "x".repeat(501), projectId: "P" }, "description"],
      ["a bad description and no Project", { description: "" }, "description"],
    ])("answers 400 invalid_input for %s, writing nothing", async (_label, body, subject) => {
      const sent = Array.isArray(body) ? body : { ...body, ...("projectId" in body ? { projectId: p.id } : {}) };
      const before = await appRows();
      await expectRefused(await post(APPS, "buyer", sent), 400, "invalid_input", subject);
      expect(await appRows()).toBe(before);
    });

    it("accepts a description of exactly 500 characters", async () => {
      const app = await placed("y".repeat(500), p.id, "buyer");
      expect(app.description).toHaveLength(500);
    });
  });

  describe("registering an existing Application", () => {
    let r: ProjectInfo;
    const REGISTERED = "/v1/applications/registered";

    /** A POST whose body is sent raw, so a non-Buyer's unreadable body can be proven not read. */
    const rawPost = (path: string, who: string, body: string, contentType = "application/json") =>
      fetch(`${base}${path}`, {
        method: "POST",
        headers: { "content-type": contentType, ...(auth[who] ?? {}) },
        body,
      });

    beforeAll(async () => {
      r = await created("App R", rootA);
    }, 60_000);

    it("registers for the Buyer: 201 with only the identification file, and the row is not from the flow", async () => {
      const before = await appRows();
      const response = await post(REGISTERED, "buyer", { description: "  Legacy checkout  ", projectId: r.id });
      const body: unknown = await response.json();
      expect(response.status, JSON.stringify(body)).toBe(201);
      if (!isIdentificationFileRendering(body)) throw new Error("not an IdentificationFileRendering");
      expect(body.fileName).toBe(".domain-harness.json");
      const parsed = parseIdentificationFile(body.content);
      if (parsed.kind !== "parsed") throw new Error("not a parsed identification file");
      const id = parsed.file.applicationId;
      expect(body.content).toBe(formatIdentificationFile(id, r.id));
      const { rows } = await owner.query(
        "select from_flow, created_by::text, project_id::text, description from applications where id = $1",
        [id],
      );
      expect(rows).toEqual([
        { from_flow: false, created_by: buyer.accountId, project_id: r.id, description: "Legacy checkout" },
      ]);
      expect(await appRows()).toBe(before + 1);
      // The list shows it at once, flagged Registered, with no agent tool.
      const entry = (await listed("buyer")).applications.find((a) => a.id === id);
      expect(entry).toMatchObject({
        description: "Legacy checkout",
        project: { id: r.id, name: "App R" },
        fromFlow: false,
        agentTool: null,
      });
      // Byte-identical to the identification-file endpoint's answer.
      const file = await get(applicationIdentificationFilePath(id), "buyer");
      expect(await file.json()).toMatchObject({ fileName: ".domain-harness.json", content: body.content });
    });

    it("refuses a Builder with 403 role_denied before the body is read, writing nothing", async () => {
      // Even with a current build grant the role check still wins for a Builder.
      await setGrant(r.id, bo.accountId, true);
      const before = await appRows();
      for (const body of ["{not json", JSON.stringify({ description: "x", projectId: r.id }), "x".repeat(MAX_BODY_BYTES * 2)]) {
        const response = await rawPost(REGISTERED, "builder", body);
        const envelope = (await response.json()) as { message: string };
        expect([response.status, envelope]).toMatchObject([403, { code: "role_denied", subject: "role" }]);
        expect(envelope.message).toBe("only the Buyer can register an existing Application; nothing was created");
      }
      expect(await appRows()).toBe(before);
    });

    it("refuses a Standard owner with 403 role_denied, writing nothing", async () => {
      const before = await appRows();
      await expectRefused(
        await post(REGISTERED, "sam", { description: "Legacy", projectId: r.id }),
        403,
        "role_denied",
        "role",
      );
      expect(await appRows()).toBe(before);
    });

    it("refuses the Buyer's body at the transport, writing nothing", async () => {
      const before = await appRows();
      await expectRefused(await rawPost(REGISTERED, "buyer", "{not json"), 400, "invalid_input", "body");
      await expectRefused(await rawPost(REGISTERED, "buyer", "x".repeat(MAX_BODY_BYTES * 2)), 413, "payload_too_large");
      await expectRefused(
        await rawPost(REGISTERED, "buyer", JSON.stringify({ description: "Legacy", projectId: r.id }), "text/plain"),
        415,
        "unsupported_media_type",
      );
      expect(await appRows()).toBe(before);
    });

    it.each([
      ["a non-object body", [], "body"],
      ["an extra key", { description: "x", projectId: "P", note: 1 }, "note"],
      ["a missing description", { projectId: "P" }, "description"],
      ["a numeric description", { description: 7, projectId: "P" }, "description"],
      ["a blank description", { description: "   ", projectId: "P" }, "description"],
      ["a 501-character description", { description: "x".repeat(501), projectId: "P" }, "description"],
      ["a missing Project", { description: "Legacy" }, "projectId"],
      ["a numeric Project", { description: "Legacy", projectId: 7 }, "projectId"],
    ])("answers 400 invalid_input for %s, writing nothing", async (_label, body, subject) => {
      // The "P" placeholder becomes the real Project, but an invalid projectId
      // (the numeric row) is sent as is so the 400 names it.
      const sent =
        Array.isArray(body) || ("projectId" in body && typeof body.projectId !== "string")
          ? body
          : { ...body, ...("projectId" in body ? { projectId: r.id } : {}) };
      const before = await appRows();
      await expectRefused(await post(REGISTERED, "buyer", sent), 400, "invalid_input", subject);
      expect(await appRows()).toBe(before);
    });

    it("answers 404 project_not_found for a foreign, unknown or malformed Project, writing nothing", async () => {
      const before = await appRows();
      // The Buyer against Company B's root; Company B's Buyer against Company A's.
      for (const [who, foreign] of [
        ["buyer", rootB],
        ["bob", rootA],
      ] as const) {
        for (const projectId of [foreign, "01928c7e-5b2a-7c3d-8e4f-000000000009", "nope"]) {
          await expectRefused(await post(REGISTERED, who, { description: "Lost", projectId }), 404, "project_not_found", "projectId");
        }
      }
      expect(await appRows()).toBe(before);
      // The refusal wrote nothing: Company B still holds its one Application.
      expect((await listed("bob")).applications.map((a) => a.description)).toEqual(["Bolt app"]);
    });

    it("answers 401 without a session and 405 for any method but POST, writing nothing", async () => {
      const before = await appRows();
      await expectRefused(
        await post(REGISTERED, "no", { description: "Legacy", projectId: r.id }),
        401,
        "session_invalid",
      );
      for (const method of ["GET", "PUT"]) {
        const response = await fetch(`${base}${REGISTERED}`, { method, headers: auth["buyer"] ?? {} });
        expect(response.headers.get("allow")).toBe("POST");
        await expectRefused(response, 405, "method_not_allowed");
      }
      expect(await appRows()).toBe(before);
    });

    // The matrix's "core validation fails" row: no API path can make the
    // proposed Application node itself fail (a fresh id on a checked
    // Project), so this seeds the only reachable invalid bundle state — a
    // two-Project cycle written out of band — and proves core's envelope
    // passes through with nothing written.
    it("passes core's envelope through when the proposed bundle input is invalid, writing nothing", async () => {
      const x = "01928c7e-5b2a-7c3d-8e4f-00000000000a";
      const y = "01928c7e-5b2a-7c3d-8e4f-00000000000b";
      // One root per tenant, so the pair is born parented and then closed into a cycle.
      await owner.query("insert into projects (id, tenant_id, parent_id, name) values ($1, $2, $3, 'Loop Y')", [y, tenantA, rootA]);
      await owner.query("insert into projects (id, tenant_id, parent_id, name) values ($1, $2, $3, 'Loop X')", [x, tenantA, y]);
      await owner.query("update projects set parent_id = $1 where id = $2", [x, y]);
      try {
        const before = await appRows();
        const response = await post(REGISTERED, "buyer", { description: "Orphan probe", projectId: r.id });
        const envelope = (await response.json()) as { code: string; subject: string; message: string };
        expect([response.status, envelope.code]).toEqual([409, "project_cycle"]);
        expect(envelope.subject).toBe(y);
        // Nothing was written: the valid registration on `r.id` too.
        expect(await appRows()).toBe(before);
      } finally {
        // One statement: the two rows reference each other, so per-row
        // deletes would dangle the surviving parent.
        await owner.query("delete from projects where id = any($1)", [[x, y]]);
      }
    });
  });

  describe("Project identification file", () => {
    const filePath = applicationIdentificationFilePath;
    let q: ProjectInfo;
    let app: ApplicationInfo;

    beforeAll(async () => {
      q = await created("App Q", rootA);
      await setGrant(q.id, bo.accountId, true);
      app = await placed("Identified app", q.id, "builder");
    }, 60_000);

    it("renders the placed Application's file for every role: its id and Project, byte for byte", async () => {
      for (const who of ["buyer", "sam", "builder", "al"]) {
        const response = await get(filePath(app.id), who);
        const body: unknown = await response.json();
        expect(response.status, JSON.stringify(body)).toBe(200);
        if (!isIdentificationFileRendering(body)) throw new Error("not an IdentificationFileRendering");
        expect(body.fileName).toBe(".domain-harness.json");
        expect(body.content).toBe(formatIdentificationFile(app.id, q.id));
        expect(parseIdentificationFile(body.content)).toEqual({
          kind: "parsed",
          file: { version: "1.0.0", applicationId: app.id, projectId: q.id },
        });
      }
    });

    it("answers 404 application_not_found for a malformed, unknown or other Company's Application", async () => {
      for (const id of ["nope", "01928c7e-5b2a-7c3d-8e4f-000000000009", boltApp.id, q.id]) {
        const response = await get(filePath(id), "buyer");
        const body = (await response.json()) as { message: string };
        expect([response.status, body]).toMatchObject([404, { code: "application_not_found", subject: "applicationId" }]);
        expect(body.message).toBe("no such Application in this Company");
      }
      // Company B reads its own, not Company A's.
      expect((await get(filePath(boltApp.id), "ola")).status).toBe(200);
      await expectRefused(await get(filePath(app.id), "bob"), 404, "application_not_found", "applicationId");
    });

    it("answers 401 without a session and 405 for any method but GET, writing nothing", async () => {
      const before = await appRows();
      await expectRefused(await fetch(`${base}${filePath(app.id)}`), 401, "session_invalid");
      const response = await post(filePath(app.id), "buyer", {});
      expect(response.headers.get("allow")).toBe("GET");
      await expectRefused(response, 405, "method_not_allowed");
      expect(await appRows()).toBe(before);
    });
  });

  describe("tenant isolation", () => {
    it("shows each Company only its own Applications", async () => {
      const b = await listed("bob");
      expect(b.applications.map((a) => a.description)).toEqual(["Bolt app"]);
      expect((await listed("buyer")).applications.map((a) => a.description)).not.toContain("Bolt app");
    });

    it("RLS returns only the context tenant's rows when the tenant filter is omitted", async () => {
      const seen = await withTenant(db, tenantA, (tx) => tx.select().from(applications));
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every((row) => row.tenantId === tenantA)).toBe(true);
      const all = await owner.query<{ n: number }>("select count(distinct tenant_id)::int as n from applications");
      expect(all.rows[0]?.n).toBe(2);
      const raw = await appPool.query<{ n: number }>("select count(*)::int as n from applications");
      expect(raw.rows).toEqual([{ n: 0 }]);
    });
  });
});
