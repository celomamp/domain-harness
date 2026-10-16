// Database suite for the Company Guidance endpoint, the Claude Code and
// Cursor Boilerplates and the Application agent-tool recording (Stories 3.3
// and 3.4): runs against a real PostgreSQL named by
// REGISTRY_TEST_DATABASE_URL (an admin connection). Like the other suites it
// creates a throwaway database, migrates it as the admin (owner) and runs
// every data-access call as dh_registry_app. Every matrix row is exercised
// over HTTP with real sessions as Bearer tokens.
import type { AddressInfo } from "node:net";
import { ed25519SignerFromEnv } from "../bundles/sign.ts";
import type { Server } from "node:http";
import { randomBytes, generateKeyPairSync } from "node:crypto";
import { sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  applicationBoilerplatePath,
  GUIDANCE_ENDPOINT_PATH,
  isApplicationInfo,
  isBoilerplateResult,
  isGuidanceEndpointState,
  isProjectInfo,
  isStandardInfo,
  parseIdentificationFile,
} from "@domain-harness/contract";
import type { ApplicationInfo, BoilerplateResult, ProjectInfo, SessionInfo, UuidV7 } from "@domain-harness/contract";
import { createApplicationService } from "../applications/service.ts";
import { createBuildGrantService } from "../build-grants/service.ts";
import { createChildPermissionService } from "../child-permissions/service.ts";
import { createRegistryDb } from "../db/client.ts";
import type { RegistryDb } from "../db/client.ts";
import { migrate } from "../db/migrate.ts";
import { withTenant } from "../db/tenant-scope.ts";
import { mintUuidV7 } from "../ids.ts";
import { createAcceptedDeviationsService } from "../accepted-deviations/service.ts";
import { createAcceptedDeviationAlertsService } from "../accepted-deviation-alerts/service.ts";
import { createGuidanceEndpointService } from "../guidance-endpoint/service.ts";
import { createRegistryServer } from "../http/server.ts";
import { createLockedRuleService } from "../locked-rules/service.ts";
import { MemoryTransport } from "../mail/memory.ts";
import { assignModuleOwner, createModule, createModuleService } from "../modules/service.ts";
import { createProjectService } from "../projects/service.ts";
import { consumeSignInLink, createSignInService, requestSignInLinks } from "../sign-in/service.ts";
import { createStandardService } from "../standards/service.ts";
import { provisionCompany } from "../tenancy/provision.ts";
import { untarGz } from "./archive.ts";
import { createBoilerplateService } from "./service.ts";
import { createCompilationsService } from "../compilations/service.ts";
import { createGuidanceAccessService } from "../guidance-access/service.ts";

const ENV = "REGISTRY_TEST_DATABASE_URL";
const adminUrl = process.env[ENV];
const inCi = process.env["CI"] !== undefined && process.env["CI"] !== "" && process.env["CI"] !== "false";
const APP_ROLE = "dh_registry_app";
const MIGRATION_SUITE_LOCK = 7_202_610_103;
const PANEL = { panelUrl: "http://panel.test" };
const URL_A = "https://g.acme.example/v1";

if (adminUrl === undefined || adminUrl === "") {
  if (inCi) {
    describe("Boilerplate database suite", () => {
      it(`requires ${ENV} when CI is set`, () => {
        expect.fail(`${ENV} is not set; CI must run the database suite against PostgreSQL 18`);
      });
    });
  } else {
    process.stderr.write(`boilerplate.db.test.ts skipped: ${ENV} is not set (see README, "Database")\n`);
  }
}

function withDatabase(url: string, database: string, role?: string): string {
  const next = new URL(url);
  next.pathname = `/${database}`;
  if (role !== undefined) next.searchParams.set("options", `-c role=${role}`);
  return next.toString();
}

describe.skipIf(adminUrl === undefined || adminUrl === "")("Guidance endpoint and Boilerplate against PostgreSQL", () => {
  const database = `dh_registry_boilerplate_${randomBytes(6).toString("hex")}`;
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
  let boltApp: ApplicationInfo;
  let codeStack: string;
  let designSystem: string;

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
    expect(body).not.toHaveProperty("archiveBase64");
    return body.message ?? "";
  }

  async function endpointRows(): Promise<number> {
    const { rows } = await owner.query<{ n: number }>("select count(*)::int as n from guidance_endpoint_changes");
    return rows[0]?.n ?? 0;
  }

  async function created(name: string, parentId: string): Promise<ProjectInfo> {
    const response = await post("/v1/projects", "buyer", { name, levelName: "Team", parentId });
    const body: unknown = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(201);
    if (!isProjectInfo(body)) throw new Error("not a ProjectInfo");
    return body;
  }

  async function placed(description: string, projectId: string, who = "buyer"): Promise<ApplicationInfo> {
    const response = await post("/v1/applications", who, { description, projectId });
    const body: unknown = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(201);
    if (!isApplicationInfo(body)) throw new Error("not an ApplicationInfo");
    return body;
  }

  async function publish(moduleId: string, entry: unknown, projectId: string): Promise<void> {
    const response = await post(`/v1/modules/${moduleId}/standards`, "sam", { entry, projectId });
    const body: unknown = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(201);
    expect(isStandardInfo(body)).toBe(true);
  }

  async function generated(applicationId: string, who = "builder"): Promise<BoilerplateResult> {
    const response = await post(applicationBoilerplatePath(applicationId), who, { target: "claude-code" });
    const body: unknown = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    if (!isBoilerplateResult(body)) throw new Error("not a BoilerplateResult");
    return body;
  }

  /** Generate one Application's Boilerplate for an explicit target. */
  async function generatedFor(applicationId: string, target: "claude-code" | "cursor", who = "builder"): Promise<BoilerplateResult> {
    const response = await post(applicationBoilerplatePath(applicationId), who, { target });
    const body: unknown = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    if (!isBoilerplateResult(body)) throw new Error("not a BoilerplateResult");
    return body;
  }

  /** The rows of one Application's agent-tool changes. */
  async function agentToolRows(applicationId: string): Promise<number> {
    const { rows } = await owner.query<{ n: number }>(
      "select count(*)::int as n from application_agent_tool_changes where application_id = $1",
      [applicationId],
    );
    return rows[0]?.n ?? 0;
  }

  /** One Application's current agent tool, as the Applications list answers it. */
  async function listedAgentTool(who: string, applicationId: string): Promise<unknown> {
    const list = (await (await get("/v1/applications", who)).json()) as {
      applications: { id: string; agentTool: unknown }[];
    };
    const found = list.applications.find((a) => a.id === applicationId);
    if (found === undefined) throw new Error("the Application is missing from the list");
    return found.agentTool;
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
    buyer = session(a.tenantId, a.accounts[0]);
    sam = session(a.tenantId, a.accounts[1]);

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
    for (const [who, email] of [
      ["buyer", "bea@acme.io"],
      ["sam", "sam@acme.io"],
      ["builder", "bo@acme.io"],
      ["bob", "bob@bolt.io"],
    ] as const) {
      auth[who] = { authorization: `Bearer ${await sessionToken(email)}` };
    }

    const cs = await createModule(db, buyer, { kind: "code-stack", name: "Stack" });
    const ds = await createModule(db, buyer, { kind: "design-system", name: "Design" });
    await assignModuleOwner(db, buyer, cs.id, { accountId: sam.accountId });
    await assignModuleOwner(db, buyer, ds.id, { accountId: sam.accountId });
    codeStack = cs.id;
    designSystem = ds.id;

    boltApp = await placed("Bolt app", rootB, "bob");
  }, 60_000);

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await appPool.end();
    await owner.end();
    await admin.query(`drop database if exists ${database} with (force)`);
    await admin.end();
  }, 60_000);

  describe("migration 0010 (guidance_endpoint_changes)", () => {
    it("enables and forces RLS with the tenant_isolation policy and grants SELECT and INSERT only", async () => {
      const { rows } = await owner.query<{ rls: boolean; forced: boolean; policies: string[] }>(
        `select c.relrowsecurity as rls, c.relforcerowsecurity as forced,
                array(select p.polname::text from pg_policy p where p.polrelid = c.oid order by 1) as policies
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname = 'guidance_endpoint_changes'`,
      );
      expect(rows).toEqual([{ rls: true, forced: true, policies: ["tenant_isolation"] }]);
      const grants = await owner.query<{ privilege_type: string }>(
        `select privilege_type from information_schema.role_table_grants
         where grantee = $1 and table_name = 'guidance_endpoint_changes' order by 1`,
        [APP_ROLE],
      );
      expect(grants.rows).toEqual([{ privilege_type: "INSERT" }, { privilege_type: "SELECT" }]);
    });

    it("refuses UPDATE and DELETE for the app role", async () => {
      for (const statement of ["update guidance_endpoint_changes set url = url", "delete from guidance_endpoint_changes"]) {
        await expect(
          withTenant(db, tenantA, async (tx) => {
            await tx.execute(sql.raw(statement));
          }),
        ).rejects.toThrow();
      }
    });
  });

  describe("migration 0011 (application_agent_tool_changes)", () => {
    it("enables and forces RLS with the tenant_isolation policy and grants SELECT and INSERT only", async () => {
      const { rows } = await owner.query<{ rls: boolean; forced: boolean; policies: string[] }>(
        `select c.relrowsecurity as rls, c.relforcerowsecurity as forced,
                array(select p.polname::text from pg_policy p where p.polrelid = c.oid order by 1) as policies
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname = 'application_agent_tool_changes'`,
      );
      expect(rows).toEqual([{ rls: true, forced: true, policies: ["tenant_isolation"] }]);
      const grants = await owner.query<{ privilege_type: string }>(
        `select privilege_type from information_schema.role_table_grants
         where grantee = $1 and table_name = 'application_agent_tool_changes' order by 1`,
        [APP_ROLE],
      );
      expect(grants.rows).toEqual([{ privilege_type: "INSERT" }, { privilege_type: "SELECT" }]);
    });

    it("refuses UPDATE and DELETE for the app role", async () => {
      for (const statement of [
        "update application_agent_tool_changes set agent_tool = agent_tool",
        "delete from application_agent_tool_changes",
      ]) {
        await expect(
          withTenant(db, tenantA, async (tx) => {
            await tx.execute(sql.raw(statement));
          }),
        ).rejects.toThrow();
      }
    });
  });

  describe("before the endpoint is set", () => {
    it("answers { url: null, changedAt: null } to every role", async () => {
      for (const who of ["buyer", "sam", "builder"]) {
        const response = await get(GUIDANCE_ENDPOINT_PATH, who);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ url: null, changedAt: null });
      }
    });

    it("refuses generation with 409 guidance_endpoint_unset and no archive", async () => {
      const p = await created("Unset P", rootA);
      const app = await placed("Unset app", p.id);
      const message = await expectRefused(
        await post(applicationBoilerplatePath(app.id), "builder", { target: "claude-code" }),
        409,
        "guidance_endpoint_unset",
        "guidanceEndpoint",
      );
      expect(message).toContain("ask the Buyer to set the Guidance endpoint");
      expect(message).toMatch(/nothing was generated$/);
    });

    it("checks the body before the endpoint: an unknown target is 400 target, not 409", async () => {
      const p = await created("Unset body P", rootA);
      const app = await placed("Unset body app", p.id);
      await expectRefused(
        await post(applicationBoilerplatePath(app.id), "builder", { target: "windsurf" }),
        400,
        "invalid_input",
        "target",
      );
    });

    it("checks the endpoint before the ecosystem: a Go Project is 409 guidance_endpoint_unset", async () => {
      const p = await created("Unset Go P", rootA);
      await publish(codeStack, { category: "language", name: "Go", status: "required" }, p.id);
      const app = await placed("Unset Go app", p.id);
      await expectRefused(
        await post(applicationBoilerplatePath(app.id), "builder", { target: "claude-code" }),
        409,
        "guidance_endpoint_unset",
      );
    });
  });

  describe("setting the endpoint", () => {
    it("refuses a Builder and a Standard owner with 403 role_denied, writing nothing", async () => {
      for (const who of ["builder", "sam"]) {
        await expectRefused(await post(GUIDANCE_ENDPOINT_PATH, who, { url: URL_A }), 403, "role_denied");
      }
      expect(await endpointRows()).toBe(0);
    });

    it.each([
      ["http", { url: "http://g.acme.example" }, "url"],
      ["ftp", { url: "ftp://g.acme.example" }, "url"],
      ["not a URL", { url: "not a url" }, "url"],
      ["empty", { url: "" }, "url"],
      ["blank", { url: "   " }, "url"],
      ["credentials", { url: "https://u:p@h.example" }, "url"],
      ["a user name", { url: "https://u@h.example" }, "url"],
      ["a fragment", { url: "https://h.example/#x" }, "url"],
      ["an empty fragment", { url: "https://h.example/#" }, "url"],
      ["2049 characters", { url: `https://h.example/${"a".repeat(2049 - 18)}` }, "url"],
      ["an internal tab", { url: "https://h.example/a\tb" }, "url"],
      ["an internal space", { url: "https://h.example/a b" }, "url"],
      ["a number", { url: 42 }, "url"],
      ["no url", {}, "url"],
      ["an extra key", { url: URL_A, note: "x" }, "note"],
      ["an array", [URL_A], "body"],
    ])("answers 400 invalid_input for %s, writing nothing", async (_label, body, subject) => {
      await expectRefused(await post(GUIDANCE_ENDPOINT_PATH, "buyer", body), 400, "invalid_input", subject);
      expect(await endpointRows()).toBe(0);
    });

    it("lets the Buyer set it: 200, one row, visible to every role; the same URL again writes nothing", async () => {
      const response = await post(GUIDANCE_ENDPOINT_PATH, "buyer", { url: `  ${URL_A}  ` });
      const body: unknown = await response.json();
      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(isGuidanceEndpointState(body)).toBe(true);
      expect(body).toMatchObject({ url: URL_A });
      expect(await endpointRows()).toBe(1);
      for (const who of ["sam", "builder"]) {
        expect(await (await get(GUIDANCE_ENDPOINT_PATH, who)).json()).toEqual(body);
      }

      const again = await post(GUIDANCE_ENDPOINT_PATH, "buyer", { url: URL_A });
      expect(again.status).toBe(200);
      expect(await again.json()).toEqual(body);
      expect(await endpointRows()).toBe(1);
    });

    it("keeps each Company's endpoint to itself", async () => {
      expect(await (await get(GUIDANCE_ENDPOINT_PATH, "bob")).json()).toEqual({ url: null, changedAt: null });
      await expectRefused(
        await post(applicationBoilerplatePath(boltApp.id), "bob", { target: "claude-code" }),
        409,
        "guidance_endpoint_unset",
      );
    });

    it("records a change as a new row; the highest sequence is current", async () => {
      const next = "https://g2.acme.example/v1";
      expect((await post(GUIDANCE_ENDPOINT_PATH, "buyer", { url: next })).status).toBe(200);
      expect(await (await get(GUIDANCE_ENDPOINT_PATH, "builder")).json()).toMatchObject({ url: next });
      expect((await post(GUIDANCE_ENDPOINT_PATH, "buyer", { url: URL_A })).status).toBe(200);
      expect(await (await get(GUIDANCE_ENDPOINT_PATH, "builder")).json()).toMatchObject({ url: URL_A });
      const { rows } = await owner.query<{ sequence: number; url: string }>(
        "select sequence, url from guidance_endpoint_changes order by sequence",
      );
      expect(rows).toEqual([
        { sequence: 1, url: URL_A },
        { sequence: 2, url: next },
        { sequence: 3, url: URL_A },
      ]);
    });

    it("accepts a URL of exactly 2048 characters", async () => {
      const longest = `https://h.example/${"a".repeat(2048 - 18)}`;
      expect(longest).toHaveLength(2048);
      const response = await post(GUIDANCE_ENDPOINT_PATH, "buyer", { url: longest });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ url: longest });
      expect((await post(GUIDANCE_ENDPOINT_PATH, "buyer", { url: URL_A })).status).toBe(200);
    });

    it("answers 401 without a session and 405 for other methods", async () => {
      await expectRefused(await fetch(`${base}${GUIDANCE_ENDPOINT_PATH}`), 401, "session_invalid");
      const response = await fetch(`${base}${GUIDANCE_ENDPOINT_PATH}`, { method: "DELETE", headers: auth["buyer"] ?? {} });
      expect(response.status).toBe(405);
    });
  });

  describe("generating a Claude Code Boilerplate", () => {
    let happy: ApplicationInfo;
    beforeAll(async () => {
      const h = await created("Happy P", rootA);
      await publish(codeStack, { category: "language", name: "TypeScript", versionConstraint: "~5.6", status: "required" }, h.id);
      await publish(codeStack, { category: "library", name: "React", versionConstraint: "^19", status: "required" }, h.id);
      await publish(codeStack, { category: "library", name: "zod", versionConstraint: "^3", status: "approved" }, h.id);
      await publish(codeStack, { category: "library", name: "lodash", status: "prohibited" }, h.id);
      await publish(designSystem, { kind: "import", specifier: "@acme/ui", status: "required" }, h.id);
      await publish(designSystem, { kind: "token", name: "color.brand", status: "required" }, h.id);
      happy = await placed("Happy app", h.id);
    }, 60_000);

    it("returns the six files with the pins, the bridge and the initial-commit rule", async () => {
      const result = await generated(happy.id);
      expect(result).toMatchObject({
        applicationId: happy.id,
        target: "claude-code",
        archiveName: `domain-harness-${happy.id}-claude-code.tar.gz`,
      });
      expect(result.artifacts).toEqual([
        { kind: "identification-file", path: ".domain-harness.json" },
        { kind: "dependency-pins", path: "package.json" },
        { kind: "design-system-references", path: "design-system.json" },
        { kind: "mcp-configuration", path: ".mcp.json" },
        { kind: "instructions", path: "CLAUDE.md" },
        { kind: "skills", path: ".claude/skills/domain-harness-guidance/SKILL.md" },
      ]);
      const files = untarGz(Buffer.from(result.archiveBase64, "base64"));
      expect(files.map((f) => f.path)).toEqual(result.artifacts.map((a) => a.path));
      const content = (path: string): string => files.find((f) => f.path === path)?.content ?? "";

      expect(parseIdentificationFile(content(".domain-harness.json"))).toEqual({
        kind: "parsed",
        file: { version: "1.0.0", applicationId: happy.id, projectId: happy.project.id },
      });
      const pkg = JSON.parse(content("package.json")) as Record<string, Record<string, string>>;
      expect(pkg["dependencies"]).toEqual({ react: "^19" });
      expect(pkg["devDependencies"]).toEqual({ typescript: "~5.6" });
      expect(content("package.json")).not.toMatch(/zod|lodash/);
      expect(JSON.parse(content("design-system.json"))).toMatchObject({
        requiredImports: ["@acme/ui"],
        requiredTokens: ["color.brand"],
      });
      const mcp = JSON.parse(content(".mcp.json")) as { mcpServers: Record<string, { command: string; args: string[] }> };
      expect(mcp.mcpServers["domain-harness"]?.command).toBe("npx");
      expect(mcp.mcpServers["domain-harness"]?.args.at(-1)).toBe(URL_A);
      for (const path of ["CLAUDE.md", ".claude/skills/domain-harness-guidance/SKILL.md"]) {
        expect(content(path).toLowerCase()).toContain("make an initial commit before calling guidance");
      }
      expect(content("CLAUDE.md")).toContain("zod");
      expect(content("CLAUDE.md")).toContain("lodash");
    });

    it("is open to every role and deterministic: identical archives for the same request", async () => {
      const results = await Promise.all(["buyer", "sam", "builder"].map((who) => generated(happy.id, who)));
      const again = await generated(happy.id);
      for (const result of [...results, again]) expect(result.archiveBase64).toBe(again.archiveBase64);
    });

    it("stays neutral: no settings path and no hooks key in any file", async () => {
      const files = untarGz(Buffer.from((await generated(happy.id)).archiveBase64, "base64"));
      for (const file of files) {
        expect(file.path).not.toContain("settings");
        expect(file.content).not.toContain('"hooks"');
      }
    });

    it("refuses an unsupported ecosystem with one sentence naming both entries", async () => {
      const u = await created("Unsupported P", rootA);
      await publish(codeStack, { category: "language", name: "Go", status: "required" }, u.id);
      await publish(codeStack, { category: "framework", name: "Spring Boot", status: "required" }, u.id);
      const app = await placed("Go app", u.id);
      const message = await expectRefused(
        await post(applicationBoilerplatePath(app.id), "builder", { target: "claude-code" }),
        409,
        "unsupported_ecosystem",
        "standards",
      );
      expect(message).toContain("language Go");
      expect(message).toContain("framework Spring Boot");
      expect(message).toMatch(/nothing was generated$/);
    });

    it("refuses a pin that is prohibited with 409 boilerplate_conflict", async () => {
      const k = await created("Conflict P", rootA);
      await publish(codeStack, { category: "library", name: "react", status: "required" }, k.id);
      await publish(codeStack, { category: "framework", name: "React", status: "prohibited" }, k.id);
      const app = await placed("Conflict app", k.id);
      const message = await expectRefused(
        await post(applicationBoilerplatePath(app.id), "builder", { target: "claude-code" }),
        409,
        "boilerplate_conflict",
        "standards",
      );
      expect(message).toContain("library react");
      expect(message).toContain("framework React");
    });

    it.each([
      ["an unknown target", { target: "windsurf" }, "target"],
      ["no target", {}, "target"],
      ["an extra key", { target: "claude-code", x: 1 }, "x"],
    ])("answers 400 invalid_input for %s", async (_label, body, subject) => {
      await expectRefused(await post(applicationBoilerplatePath(happy.id), "builder", body), 400, "invalid_input", subject);
    });

    it("answers 404 application_not_found for a malformed, unknown or other Company's Application, before the body", async () => {
      for (const id of ["nope", "01928c7e-5b2a-7c3d-8e4f-000000000009", boltApp.id]) {
        await expectRefused(
          await post(applicationBoilerplatePath(id), "builder", { target: "windsurf" }),
          404,
          "application_not_found",
          "applicationId",
        );
      }
    });

    it("answers 401 without a session and 405 for GET", async () => {
      await expectRefused(
        await fetch(`${base}${applicationBoilerplatePath(happy.id)}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ target: "claude-code" }),
        }),
        401,
        "session_invalid",
      );
      const response = await get(applicationBoilerplatePath(happy.id), "builder");
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST");
    });
  });

  describe("generating a Cursor Boilerplate and recording the agent tool", () => {
    let cursorApp: ApplicationInfo;

    const filesOf = (result: BoilerplateResult) => untarGz(Buffer.from(result.archiveBase64, "base64"));
    const contentOf = (files: ReturnType<typeof filesOf>, path: string): string =>
      files.find((f) => f.path === path)?.content ?? "";

    beforeAll(async () => {
      const p = await created("Cursor P", rootA);
      await publish(codeStack, { category: "language", name: "TypeScript", versionConstraint: "~5.6", status: "required" }, p.id);
      await publish(codeStack, { category: "library", name: "React", versionConstraint: "^19", status: "required" }, p.id);
      cursorApp = await placed("Cursor app", p.id);
    }, 60_000);

    it("answers agentTool: null before any generation", async () => {
      expect(await listedAgentTool("builder", cursorApp.id)).toBe(null);
    });

    it("returns the six Cursor files with the initial-commit rule in AGENTS.md and the skill", async () => {
      const result = await generatedFor(cursorApp.id, "cursor");
      expect(result).toMatchObject({
        applicationId: cursorApp.id,
        target: "cursor",
        archiveName: `domain-harness-${cursorApp.id}-cursor.tar.gz`,
      });
      expect(result.artifacts).toEqual([
        { kind: "identification-file", path: ".domain-harness.json" },
        { kind: "dependency-pins", path: "package.json" },
        { kind: "design-system-references", path: "design-system.json" },
        { kind: "mcp-configuration", path: ".cursor/mcp.json" },
        { kind: "instructions", path: "AGENTS.md" },
        { kind: "skills", path: ".cursor/skills/domain-harness-guidance/SKILL.md" },
      ]);
      const files = filesOf(result);
      expect(files.map((f) => f.path)).toEqual(result.artifacts.map((a) => a.path));
      const mcp = JSON.parse(contentOf(files, ".cursor/mcp.json")) as {
        mcpServers: Record<string, { type?: string; command?: string; args?: string[] }>;
      };
      expect(mcp.mcpServers["domain-harness"]).toMatchObject({ type: "stdio", command: "npx" });
      expect(mcp.mcpServers["domain-harness"]?.args?.at(-1)).toBe(URL_A);
      for (const path of ["AGENTS.md", ".cursor/skills/domain-harness-guidance/SKILL.md"]) {
        expect(contentOf(files, path).toLowerCase()).toContain("make an initial commit before calling guidance");
      }
      expect(contentOf(files, "AGENTS.md")).toContain("declared in `.cursor/mcp.json`");
    });

    it("records the generated target as the Application's agent tool", async () => {
      expect(await agentToolRows(cursorApp.id)).toBe(1);
      expect(await listedAgentTool("builder", cursorApp.id)).toBe("cursor");
      expect(await listedAgentTool("buyer", cursorApp.id)).toBe("cursor");
      expect(await listedAgentTool("sam", cursorApp.id)).toBe("cursor");
    });

    it("writes no new row when the current target is generated again", async () => {
      await generatedFor(cursorApp.id, "cursor");
      expect(await agentToolRows(cursorApp.id)).toBe(1);
      expect(await listedAgentTool("builder", cursorApp.id)).toBe("cursor");
    });

    it("appends one row when the other target is generated, and the list shows the new target", async () => {
      await generatedFor(cursorApp.id, "claude-code");
      expect(await agentToolRows(cursorApp.id)).toBe(2);
      expect(await listedAgentTool("builder", cursorApp.id)).toBe("claude-code");
    });

    it("refuses an agent tool or a sequence outside the table's CHECKs", async () => {
      for (const [agentTool, sequence] of [
        ["windsurf", 1],
        ["claude-code", 0],
      ] as const) {
        await expect(
          owner.query(
            "insert into application_agent_tool_changes (id, tenant_id, application_id, sequence, agent_tool, changed_by) values ($1, $2, $3, $4, $5, $6)",
            [mintUuidV7(), tenantA, cursorApp.id, sequence, agentTool, buyer.accountId],
          ),
        ).rejects.toThrow();
      }
      expect(await agentToolRows(cursorApp.id)).toBe(2);
    });

    it("records nothing on a refusal: the unknown target, the unknown Application and the unset endpoint", async () => {
      await expectRefused(
        await post(applicationBoilerplatePath(cursorApp.id), "builder", { target: "windsurf" }),
        400,
        "invalid_input",
        "target",
      );
      for (const id of ["nope", "01928c7e-5b2a-7c3d-8e4f-000000000009", boltApp.id]) {
        await expectRefused(
          await post(applicationBoilerplatePath(id), "builder", { target: "cursor" }),
          404,
          "application_not_found",
          "applicationId",
        );
      }
      await expectRefused(
        await post(applicationBoilerplatePath(boltApp.id), "bob", { target: "cursor" }),
        409,
        "guidance_endpoint_unset",
      );
      expect(await agentToolRows(cursorApp.id)).toBe(2);
      expect(await listedAgentTool("builder", cursorApp.id)).toBe("claude-code");
      expect(await agentToolRows(boltApp.id)).toBe(0);
    });

    it("records nothing on an unsupported ecosystem or a conflict refusal", async () => {
      const u = await created("Cursor unsupported P", rootA);
      await publish(codeStack, { category: "language", name: "Go", status: "required" }, u.id);
      const unsupported = await placed("Cursor Go app", u.id);
      await expectRefused(
        await post(applicationBoilerplatePath(unsupported.id), "builder", { target: "cursor" }),
        409,
        "unsupported_ecosystem",
        "standards",
      );
      const k = await created("Cursor conflict P", rootA);
      await publish(codeStack, { category: "library", name: "react", status: "required" }, k.id);
      await publish(codeStack, { category: "framework", name: "React", status: "prohibited" }, k.id);
      const conflict = await placed("Cursor conflict app", k.id);
      await expectRefused(
        await post(applicationBoilerplatePath(conflict.id), "builder", { target: "cursor" }),
        409,
        "boilerplate_conflict",
        "standards",
      );
      for (const app of [unsupported, conflict]) {
        expect(await agentToolRows(app.id)).toBe(0);
        expect(await listedAgentTool("builder", app.id)).toBe(null);
      }
    });

    it("keeps each Company's rows to itself: B generates only its own Application", async () => {
      expect((await post(GUIDANCE_ENDPOINT_PATH, "bob", { url: "https://g.bolt.example/v1" })).status).toBe(200);
      const result = await generatedFor(boltApp.id, "cursor", "bob");
      expect(result).toMatchObject({ applicationId: boltApp.id, target: "cursor" });
      expect(await agentToolRows(boltApp.id)).toBe(1);
      expect(await listedAgentTool("bob", boltApp.id)).toBe("cursor");
      expect(await agentToolRows(cursorApp.id)).toBe(2);
      expect(await listedAgentTool("builder", cursorApp.id)).toBe("claude-code");
      await expectRefused(
        await post(applicationBoilerplatePath(cursorApp.id), "bob", { target: "cursor" }),
        404,
        "application_not_found",
        "applicationId",
      );
    });

    it("ships the identification file and the pins byte for byte the same as Claude Code", async () => {
      const cursor = filesOf(await generatedFor(cursorApp.id, "cursor"));
      const claude = filesOf(await generatedFor(cursorApp.id, "claude-code"));
      for (const path of [".domain-harness.json", "package.json", "design-system.json"]) {
        expect(contentOf(cursor, path)).toBe(contentOf(claude, path));
      }
      expect(parseIdentificationFile(contentOf(cursor, ".domain-harness.json"))).toEqual({
        kind: "parsed",
        file: { version: "1.0.0", applicationId: cursorApp.id, projectId: cursorApp.project.id },
      });
    });

    it("stays neutral: no settings path and no hooks key in any file", async () => {
      for (const file of filesOf(await generatedFor(cursorApp.id, "cursor"))) {
        expect(file.path).not.toContain("settings");
        expect(file.content).not.toContain('"hooks"');
      }
    });
  });
});
