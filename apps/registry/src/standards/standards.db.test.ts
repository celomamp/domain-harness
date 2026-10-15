// Database suite for Standards and their versions: runs against a real
// PostgreSQL 18 named by REGISTRY_TEST_DATABASE_URL (an admin connection).
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
import { entrySlotName, isStandardInfo, isStandardList, isStandardVersionList, isUuidV7 } from "@domain-harness/contract";
import type { ModuleInfo, SessionInfo, StandardInfo, UuidV7 } from "@domain-harness/contract";
import { createRegistryDb } from "../db/client.ts";
import type { RegistryDb } from "../db/client.ts";
import { migrate } from "../db/migrate.ts";
import { standards, standardVersions } from "../db/schema.ts";
import { withTenant } from "../db/tenant-scope.ts";
import { createRegistryServer } from "../http/server.ts";
import { mintUuidV7 } from "../ids.ts";
import { MemoryTransport } from "../mail/memory.ts";
import { assignModuleOwner, createModule, createModuleService } from "../modules/service.ts";
import { consumeSignInLink, createSignInService, requestSignInLinks } from "../sign-in/service.ts";
import { provisionCompany } from "../tenancy/provision.ts";
import { createStandardService, publishStandard } from "./service.ts";
import { createProjectService } from "../projects/service.ts";
import { createLockedRuleService } from "../locked-rules/service.ts";
import { createApplicationService } from "../applications/service.ts";
import { createBoilerplateService } from "../boilerplate/service.ts";
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
const INSUFFICIENT_PRIVILEGE = "42501";
const CHECK_VIOLATION = "23514";
const PANEL = { panelUrl: "http://panel.test" };

if (adminUrl === undefined || adminUrl === "") {
  if (inCi) {
    describe("standards database suite", () => {
      it(`requires ${ENV} when CI is set`, () => {
        expect.fail(`${ENV} is not set; CI must run the database suite against PostgreSQL 18`);
      });
    });
  } else {
    process.stderr.write(`standards.db.test.ts skipped: ${ENV} is not set (see README, "Database")\n`);
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

interface Entry {
  readonly category?: unknown;
  readonly name?: unknown;
  readonly versionConstraint?: unknown;
  readonly status?: unknown;
  readonly correctionInstruction?: unknown;
  readonly [key: string]: unknown;
}

describe.skipIf(adminUrl === undefined || adminUrl === "")("Standards against PostgreSQL", () => {
  const database = `dh_registry_standards_${randomBytes(6).toString("hex")}`;
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
  let sue: SessionInfo;
  let buyerB: SessionInfo;
  let tomB: SessionInfo;

  /** Bearer headers per account, from real sign-ins. */
  const auth: Record<string, Record<string, string>> = {};

  // Code-stack Modules: m1 owned by Sam, m2 owned by Sue, unowned has no owner.
  // design is a design-system Module owned by Sam; design2 one owned by Sue.
  // foreign is tenant B's, owned by Tom.
  let m1: ModuleInfo;
  let m2: ModuleInfo;
  let unowned: ModuleInfo;
  let design: ModuleInfo;
  let design2: ModuleInfo;
  let foreign: ModuleInfo;

  async function counts(): Promise<{ standards: number; versions: number }> {
    const { rows } = await owner.query<{ standards: number; versions: number }>(
      `select (select count(*) from standards)::int as standards,
              (select count(*) from standard_versions)::int as versions`,
    );
    const [row] = rows;
    if (row === undefined) throw new Error("no counts");
    return { ...row };
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

  const publishNew = (moduleId: string, who: string, entry: Entry) =>
    post(`/v1/modules/${moduleId}/standards`, who, { entry });

  const republish = (standardId: string, who: string, entry: Entry) =>
    post(`/v1/standards/${standardId}/versions`, who, { entry });

  async function expectRefused(response: Response, status: number, code: string, subject?: string): Promise<void> {
    const body: unknown = await response.json();
    expect([response.status, body]).toMatchObject([status, subject === undefined ? { code } : { code, subject }]);
  }

  async function published(response: Response): Promise<StandardInfo> {
    const body: unknown = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(201);
    if (!isStandardInfo(body)) throw new Error("not a StandardInfo");
    return body;
  }

  let nameCounter = 0;
  const fresh = (prefix = "lib"): string => {
    nameCounter += 1;
    return `${prefix}-${String(nameCounter)}`;
  };
  const library = (name: string, rest: Entry = {}): Entry => ({ category: "library", name, status: "approved", ...rest });

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
    rootA = a.rootProjectId;
    rootB = b.rootProjectId;
    const session = (tenantId: UuidV7, account: { id: UuidV7; role: SessionInfo["role"] } | undefined) => {
      if (account === undefined) throw new Error("missing account");
      return { accountId: account.id, tenantId, role: account.role };
    };
    [buyer, sam, sue] = a.accounts.map((account) => session(tenantA, account)) as [SessionInfo, SessionInfo, SessionInfo];
    [buyerB, tomB] = b.accounts.map((account) => session(b.tenantId, account)) as [SessionInfo, SessionInfo];

    m1 = await createModule(db, buyer, { kind: "code-stack", name: "Frontend stack" });
    m2 = await createModule(db, buyer, { kind: "code-stack", name: "Backend stack" });
    unowned = await createModule(db, buyer, { kind: "code-stack", name: "Ownerless stack" });
    design = await createModule(db, buyer, { kind: "design-system", name: "Design system" });
    await assignModuleOwner(db, buyer, m1.id, { accountId: sam.accountId });
    await assignModuleOwner(db, buyer, m2.id, { accountId: sue.accountId });
    await assignModuleOwner(db, buyer, design.id, { accountId: sam.accountId });
    design2 = await createModule(db, buyer, { kind: "design-system", name: "Brand design system" });
    await assignModuleOwner(db, buyer, design2.id, { accountId: sue.accountId });
    foreign = await createModule(db, buyerB, { kind: "code-stack", name: "Frontend stack" });
    await assignModuleOwner(db, buyerB, foreign.id, { accountId: tomB.accountId });

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
      ["sue", "sue@acme.io"],
      ["builder", "bo@acme.io"],
      ["tom", "tom@bolt.io"],
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

  describe("migration 0004", () => {
    it("enables and forces RLS with the tenant_isolation policy on both tables", async () => {
      const { rows } = await owner.query<{ relname: string; rls: boolean; forced: boolean; policies: string[] }>(
        `select c.relname, c.relrowsecurity as rls, c.relforcerowsecurity as forced,
                array(select p.polname::text from pg_policy p where p.polrelid = c.oid order by 1) as policies
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname in ('standards', 'standard_versions') order by 1`,
      );
      expect(rows).toEqual([
        { relname: "standard_versions", rls: true, forced: true, policies: ["tenant_isolation"] },
        { relname: "standards", rls: true, forced: true, policies: ["tenant_isolation"] },
      ]);
    });

    it("grants the app role SELECT and INSERT only on both tables, and no column UPDATE", async () => {
      const { rows } = await owner.query<{ table_name: string; privilege_type: string }>(
        `select table_name, privilege_type from information_schema.role_table_grants
         where grantee = $1 and table_name in ('standards', 'standard_versions') order by 1, 2`,
        [APP_ROLE],
      );
      expect(rows).toEqual([
        { table_name: "standard_versions", privilege_type: "INSERT" },
        { table_name: "standard_versions", privilege_type: "SELECT" },
        { table_name: "standards", privilege_type: "INSERT" },
        { table_name: "standards", privilege_type: "SELECT" },
      ]);
      const columns = await owner.query(
        `select 1 from information_schema.column_privileges
         where grantee = $1 and privilege_type = 'UPDATE' and table_name in ('standards', 'standard_versions')`,
        [APP_ROLE],
      );
      expect(columns.rowCount).toBe(0);
    });
  });

  describe("publishing and re-publishing", () => {
    let first: StandardInfo;

    it("publishes version 1 with a registry-minted id, the Module, the root Project scope and a UTC time", async () => {
      const before = await counts();
      const started = Date.now();
      first = await published(
        await publishNew(m1.id, "sam", { category: "library", name: " React ", versionConstraint: "^18", status: "approved" }),
      );
      expect(isUuidV7(first.id)).toBe(true);
      expect(first).toMatchObject({
        version: 1,
        module: { id: m1.id, kind: "code-stack", name: "Frontend stack" },
        project: { id: rootA, name: "Acme" },
        entry: { category: "library", name: "React", versionConstraint: "^18", status: "approved", correctionInstruction: null },
        publishedBy: { accountId: sam.accountId, name: "Sam Owner" },
      });
      expect(first.publishedAt.endsWith("Z")).toBe(true);
      expect(Date.parse(first.publishedAt)).toBeGreaterThanOrEqual(started - 5_000);
      expect(await counts()).toEqual({ standards: before.standards + 1, versions: before.versions + 1 });

      const { rows } = await owner.query<{ tenant_id: string; module_id: string; project_id: string; created_by: string }>(
        "select tenant_id::text, module_id::text, project_id::text, created_by::text from standards where id = $1",
        [first.id],
      );
      expect(rows).toEqual([{ tenant_id: tenantA, module_id: m1.id, project_id: rootA, created_by: sam.accountId }]);
    });

    it("re-publishes an edited entry as version 2 with the same id; version 1 stays exactly as published", async () => {
      const before = await counts();
      const second = await published(
        await republish(first.id, "sam", {
          category: "library",
          name: "React",
          versionConstraint: "^19",
          status: "required",
          correctionInstruction: " Use React 19. ",
        }),
      );
      expect(second).toMatchObject({
        id: first.id,
        version: 2,
        entry: { versionConstraint: "^19", status: "required", correctionInstruction: "Use React 19." },
      });
      expect(await counts()).toEqual({ standards: before.standards, versions: before.versions + 1 });

      const versions: unknown = await (await get(`/v1/standards/${first.id}/versions`, "builder")).json();
      if (!isStandardVersionList(versions)) throw new Error("not a StandardVersionList");
      expect(versions.standardId).toBe(first.id);
      expect(versions.versions).toEqual([first, second]);

      const list: unknown = await (await get(`/v1/modules/${m1.id}/standards`, "builder")).json();
      if (!isStandardList(list)) throw new Error("not a StandardList");
      expect(list.module).toMatchObject({ id: m1.id, owner: { accountId: sam.accountId } });
      expect(list.standards).toEqual([second]);
    });

    it("lets a Standard move to a free slot (the old slot is freed) and lists every role the live version", async () => {
      const moved = await published(await republish(first.id, "sam", library("Preact")));
      expect(moved.version).toBe(3);
      const reused = await published(await publishNew(m2.id, "sue", library("react")));
      expect(reused.version).toBe(1);
      // Back to React would now collide with Sue's Standard.
      await expectRefused(await republish(first.id, "sam", library("React")), 409, "slot_conflict", reused.id);
      for (const who of ["buyer", "sam", "sue", "builder"]) {
        expect((await get(`/v1/modules/${m1.id}/standards`, who)).status).toBe(200);
      }
    });
  });

  describe("refusals: nothing is written", () => {
    let live: StandardInfo;

    beforeAll(async () => {
      live = await published(await publishNew(m1.id, "sam", library("Lodash")));
    });

    it.each([["buyer"], ["builder"], ["sam"]])(
      "refuses %s publishing into an ownerless Module with module_has_no_owner",
      async (who) => {
        const before = await counts();
        await expectRefused(await publishNew(unowned.id, who, library(fresh())), 409, "module_has_no_owner", "moduleId");
        // The owner check comes before entry validation.
        await expectRefused(await publishNew(unowned.id, who, { name: "" }), 409, "module_has_no_owner");
        expect(await counts()).toEqual(before);
      },
    );

    it.each([["builder"], ["buyer"], ["sue"]])("refuses %s publishing into Sam's Module with not_module_owner", async (who) => {
      const before = await counts();
      await expectRefused(await publishNew(m1.id, who, library(fresh())), 403, "not_module_owner", "role");
      await expectRefused(await republish(live.id, who, library("Lodash")), 403, "not_module_owner", "role");
      // The owner check comes before entry validation.
      await expectRefused(await publishNew(m1.id, who, { extra: true }), 403, "not_module_owner");
      expect(await counts()).toEqual(before);
    });

    it("refuses a different Standard in a held slot, in any Module and case-insensitively, naming the holder", async () => {
      const before = await counts();
      const fromM2 = await publishNew(m2.id, "sue", library(" LODASH "));
      const body: unknown = await fromM2.json();
      expect(fromM2.status).toBe(409);
      expect(body).toMatchObject({ code: "slot_conflict", subject: live.id });
      expect(JSON.stringify(body)).toContain(live.id);
      await expectRefused(await publishNew(m1.id, "sam", library("lodash")), 409, "slot_conflict", live.id);
      expect(await counts()).toEqual(before);
    });

    it("lets library, framework and language with one name be live together", async () => {
      await published(await publishNew(m2.id, "sue", { ...library("lodash"), category: "framework" }));
      await published(await publishNew(m2.id, "sue", { ...library("lodash"), category: "language" }));
    });

    it.each([
      ["a missing name", { category: "library", status: "approved" }, "name"],
      ["a blank name", library("   "), "name"],
      ["a 201-character name", library("x".repeat(201)), "name"],
      ["a bad category", { ...library(fresh()), category: "tool" }, "category"],
      ["a bad status", { ...library(fresh()), status: "allowed" }, "status"],
      ["a 101-character constraint", library(fresh(), { versionConstraint: "x".repeat(101) }), "versionConstraint"],
      ["a 1001-character instruction", library(fresh(), { correctionInstruction: "x".repeat(1001) }), "correctionInstruction"],
      ["an extra key", library(fresh(), { id: mintUuidV7() }), "id"],
    ])("refuses %s with invalid_input on that field", async (_label, entry, subject) => {
      const before = await counts();
      await expectRefused(await publishNew(m1.id, "sam", entry), 400, "invalid_input", subject);
      await expectRefused(await republish(live.id, "sam", entry), 400, "invalid_input", subject);
      expect(await counts()).toEqual(before);
    });

    it("refuses a body that is not exactly { entry }", async () => {
      const before = await counts();
      const response = await post(`/v1/modules/${m1.id}/standards`, "sam", { entry: library(fresh()), standardId: live.id });
      await expectRefused(response, 400, "invalid_input", "standardId");
      expect(await counts()).toEqual(before);
    });

    it("refuses a code-stack entry in a design-system Module, and the reverse, with invalid_input on kind", async () => {
      const before = await counts();
      await expectRefused(await publishNew(design.id, "sam", library(fresh())), 400, "invalid_input", "kind");
      await expectRefused(await publishNew(design.id, "sam", library("")), 400, "invalid_input", "kind");
      await expectRefused(
        await publishNew(m1.id, "sam", { kind: "token", name: fresh("tok"), status: "required" }),
        400,
        "invalid_input",
        "kind",
      );
      await expectRefused(await republish(live.id, "sam", { kind: "token", name: "x", status: "required" }), 400, "invalid_input", "kind");
      expect(await counts()).toEqual(before);
    });

    it("answers module_not_found for random, foreign and malformed Module ids", async () => {
      const before = await counts();
      for (const id of [mintUuidV7(), foreign.id, "nope", "01928C7E-5B2A-7C3D-8E4F-A1B2C3D4E5F6"]) {
        await expectRefused(await publishNew(id, "sam", library(fresh())), 404, "module_not_found", "moduleId");
        await expectRefused(await get(`/v1/modules/${encodeURIComponent(id)}/standards`, "sam"), 404, "module_not_found");
      }
      expect(await counts()).toEqual(before);
    });

    it("answers standard_not_found for random, foreign and malformed Standard ids", async () => {
      const theirs = await published(await publishNew(foreign.id, "tom", library("Lodash")));
      const before = await counts();
      for (const id of [mintUuidV7(), theirs.id, "nope"]) {
        await expectRefused(await republish(id, "sam", library(fresh())), 404, "standard_not_found", "standardId");
        await expectRefused(await get(`/v1/standards/${id}/versions`, "sam"), 404, "standard_not_found");
      }
      expect(await counts()).toEqual(before);
    });

    it("refuses an anonymous publish with session_invalid", async () => {
      const before = await counts();
      await expectRefused(await publishNew(m1.id, "nobody", library(fresh())), 401, "session_invalid");
      expect(await counts()).toEqual(before);
    });

    it("follows the owner: after reassignment the old owner is refused and the new one may publish", async () => {
      const module = await createModule(db, buyer, { kind: "code-stack", name: "Reassigned stack" });
      await assignModuleOwner(db, buyer, module.id, { accountId: sam.accountId });
      const standard = await published(await publishNew(module.id, "sam", library(fresh())));
      await assignModuleOwner(db, buyer, module.id, { accountId: sue.accountId });
      await expectRefused(await republish(standard.id, "sam", library(fresh())), 403, "not_module_owner");
      expect((await published(await republish(standard.id, "sue", library(fresh())))).version).toBe(2);
    });
  });

  describe("design-system entries (Story 1.6)", () => {
    const component = (name: string, rest: Entry = {}): Entry => ({
      kind: "component",
      name,
      usageRule: "Use for primary actions",
      tokens: [],
      ...rest,
    });
    let button: StandardInfo;

    it("publishes a component, a token and an import at the root Project, normalised", async () => {
      const before = await counts();
      button = await published(
        await publishNew(design.id, "sam", component(" Button ", { tokens: [" primary ", "spacing-4"] })),
      );
      expect(button).toMatchObject({
        version: 1,
        module: { id: design.id, kind: "design-system" },
        project: { id: rootA, name: "Acme" },
        entry: {
          kind: "component",
          name: "Button",
          usageRule: "Use for primary actions",
          tokens: ["primary", "spacing-4"],
          correctionInstruction: null,
        },
      });
      const token = await published(await publishNew(design.id, "sam", { kind: "token", name: "primary", status: "prohibited" }));
      expect(token.entry).toEqual({ kind: "token", name: "primary", status: "prohibited" });
      const mui = await published(
        await publishNew(design.id, "sam", { kind: "import", specifier: "@mui/material", status: "required" }),
      );
      expect(mui.entry).toEqual({ kind: "import", specifier: "@mui/material", status: "required" });
      expect(await counts()).toEqual({ standards: before.standards + 3, versions: before.versions + 3 });

      const { rows } = await owner.query<{ category: string; name: string }>(
        "select category, name from standard_versions where standard_id = any($1::uuid[]) order by category",
        [[button.id, token.id, mui.id]],
      );
      expect(rows).toEqual([
        { category: "component", name: "Button" },
        { category: "import", name: "@mui/material" },
        { category: "token", name: "primary" },
      ]);

      const list: unknown = await (await get(`/v1/modules/${design.id}/standards`, "builder")).json();
      if (!isStandardList(list)) throw new Error("not a StandardList");
      expect(list.standards.map((standard) => standard.id)).toEqual([button.id, token.id, mui.id]);
    });

    it("lets a code-stack library and a design-system token named primary be live together", async () => {
      await published(await publishNew(m2.id, "sue", library("primary")));
      // The token "primary" above is still live; a component "primary" is another slot kind too.
      await published(await publishNew(design.id, "sam", component("primary")));
    });

    it("refuses a second component with the same name, in either design-system Module, naming the holder", async () => {
      const before = await counts();
      for (const [moduleId, who] of [
        [design.id, "sam"],
        [design2.id, "sue"],
      ] as const) {
        const response = await publishNew(moduleId, who, component("button"));
        const body: unknown = await response.json();
        expect([response.status, body]).toMatchObject([409, { code: "slot_conflict", subject: button.id }]);
        expect(JSON.stringify(body)).toContain('(design system, component, \\"Button\\")');
      }
      await expectRefused(
        await publishNew(design2.id, "sue", { kind: "import", specifier: " @MUI/material ", status: "prohibited" }),
        409,
        "slot_conflict",
      );
      expect(await counts()).toEqual(before);
    });

    it("re-publishes an edited component as version 2 with the same id; version 1 is unchanged", async () => {
      const second = await published(
        await republish(button.id, "sam", component("Button", { usageRule: "Use for the main action only", tokens: ["primary"] })),
      );
      expect(second).toMatchObject({ id: button.id, version: 2, entry: { usageRule: "Use for the main action only" } });
      const versions: unknown = await (await get(`/v1/standards/${button.id}/versions`, "builder")).json();
      if (!isStandardVersionList(versions)) throw new Error("not a StandardVersionList");
      expect(versions.versions).toEqual([button, second]);
    });

    it("lets a new version change the entry kind; the slot moves and is re-validated", async () => {
      const moving = await published(await publishNew(design.id, "sam", component(fresh("Card"))));
      const asToken = await published(
        await republish(moving.id, "sam", { kind: "token", name: fresh("tok"), status: "required" }),
      );
      expect(asToken).toMatchObject({ id: moving.id, version: 2, entry: { kind: "token" } });
      // Moving onto the held token "primary" is refused.
      await expectRefused(
        await republish(moving.id, "sam", { kind: "token", name: "PRIMARY", status: "required" }),
        409,
        "slot_conflict",
      );
    });

    it.each([
      ["a missing kind", { name: "x", usageRule: "x", tokens: [] }, "kind"],
      ["a bad kind", { kind: "brand", name: "x" }, "kind"],
      ["a blank name", component(" "), "name"],
      ["a 201-character name", component("x".repeat(201)), "name"],
      ["a blank usage rule", component("x", { usageRule: " " }), "usageRule"],
      ["a 1001-character usage rule", component("x", { usageRule: "x".repeat(1001) }), "usageRule"],
      ["51 tokens", component("x", { tokens: Array.from({ length: 51 }, (_, i) => `t${String(i)}`) }), "tokens"],
      ["a blank token", component("x", { tokens: [" "] }), "tokens"],
      ["duplicate tokens", component("x", { tokens: ["a", "A"] }), "tokens"],
      ["tokens not an array", component("x", { tokens: "a" }), "tokens"],
      ["a token with status approved", { kind: "token", name: "x", status: "approved" }, "status"],
      ["a blank specifier", { kind: "import", specifier: " ", status: "required" }, "specifier"],
      ["a 201-character specifier", { kind: "import", specifier: "x".repeat(201), status: "required" }, "specifier"],
      ["versionConstraint on a component", component("x", { versionConstraint: "^1" }), "versionConstraint"],
      ["an extra key", { kind: "token", name: "x", status: "required", owner: "x" }, "owner"],
    ])("refuses %s with invalid_input on that field", async (_label, entry, subject) => {
      const before = await counts();
      await expectRefused(await publishNew(design.id, "sam", entry), 400, "invalid_input", subject);
      await expectRefused(await republish(button.id, "sam", entry), 400, "invalid_input", subject);
      expect(await counts()).toEqual(before);
    });

    it("refuses non-owners, the ownerless check and unknown ids as for code stack", async () => {
      const before = await counts();
      for (const who of ["builder", "buyer", "sue"]) {
        await expectRefused(await publishNew(design.id, who, component(fresh("C"))), 403, "not_module_owner", "role");
        await expectRefused(await republish(button.id, who, component("Button")), 403, "not_module_owner", "role");
      }
      const ownerless = await createModule(db, buyer, { kind: "design-system", name: "Ownerless design system" });
      await expectRefused(await publishNew(ownerless.id, "sam", component(fresh("C"))), 409, "module_has_no_owner");
      await expectRefused(await publishNew(mintUuidV7(), "sam", component(fresh("C"))), 404, "module_not_found");
      await expectRefused(await republish(mintUuidV7(), "sam", component(fresh("C"))), 404, "standard_not_found");
      expect(await counts()).toEqual(before);
    });

    it.each([
      ["a token row with status approved", "token", "primary", { kind: "token", name: "primary", status: "approved" }],
      ["a component row without a usage rule", "component", "Chip", { kind: "component", name: "Chip", tokens: [] }],
      ["an import row whose specifier is not the name", "import", "a", { kind: "import", specifier: "b", status: "required" }],
      ["a code-stack row with a token entry", "library", "x", { kind: "token", name: "x", status: "required" }],
      ["an unknown slot kind", "brand", "x", { kind: "brand", name: "x" }],
    ] as const)("refuses at the database %s (check constraint)", async (_label, category, name, entry) => {
      const before = await counts();
      const error: unknown = await withTenant(db, tenantA, (tx) =>
        tx.insert(standardVersions).values({
          id: mintUuidV7(),
          tenantId: tenantA,
          standardId: button.id,
          version: 99,
          category: category as never,
          name,
          entry: entry as never,
          publishedBy: sam.accountId,
        }),
      ).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(pgCode(error)).toBe(CHECK_VIOLATION);
      expect(await counts()).toEqual(before);
    });
  });

  describe("Project scope (Story 2.2)", () => {
    const publishAt = (moduleId: string, who: string, entry: Entry, projectId: unknown) =>
      post(`/v1/modules/${moduleId}/standards`, who, { entry, projectId });

    async function createProjectAs(name: string, parentId: string): Promise<{ id: UuidV7; name: string }> {
      const response = await post("/v1/projects", "buyer", { name, levelName: "Team", parentId });
      const body = (await response.json()) as { id: UuidV7; name: string };
      expect(response.status, JSON.stringify(body)).toBe(201);
      return body;
    }

    let p: { id: UuidV7; name: string };
    let c: { id: UuidV7; name: string };

    beforeAll(async () => {
      p = await createProjectAs("Web", rootA);
      c = await createProjectAs("Checkout", p.id);
    });

    it("publishes a new Standard at the chosen Project, and the list and versions show that scope", async () => {
      const name = fresh();
      const standard = await published(await publishAt(m1.id, "sam", library(name), p.id));
      expect(standard).toMatchObject({ version: 1, project: { id: p.id, name: "Web" } });
      const { rows } = await owner.query<{ project_id: string }>("select project_id from standards where id = $1", [
        standard.id,
      ]);
      expect(rows).toEqual([{ project_id: p.id }]);

      const list: unknown = await (await get(`/v1/modules/${m1.id}/standards`, "builder")).json();
      if (!isStandardList(list)) throw new Error("not a StandardList");
      expect(list.standards.find((s) => s.id === standard.id)?.project).toEqual({ id: p.id, name: "Web" });
      const versions: unknown = await (await get(`/v1/standards/${standard.id}/versions`, "builder")).json();
      if (!isStandardVersionList(versions)) throw new Error("not a StandardVersionList");
      expect(versions.versions.map((v) => v.project.id)).toEqual([p.id]);
    });

    it("publishes at the root Project when projectId is missing", async () => {
      const standard = await published(await publishNew(m1.id, "sam", library(fresh())));
      expect(standard.project).toEqual({ id: rootA, name: "Acme" });
    });

    it("accepts the same slot at a child scope, and refuses it a second time at one scope naming both", async () => {
      const name = fresh("X");
      const atP = await published(await publishAt(m1.id, "sam", library(name), p.id));
      const atC = await published(await publishAt(m2.id, "sue", library(name.toLowerCase()), c.id));
      expect(atC.project.id).toBe(c.id);
      // The root holds no Standard in this slot, so the root is free as well.
      const atRoot = await published(await publishNew(m1.id, "sam", library(name)));
      expect(atRoot.project.id).toBe(rootA);

      const before = await counts();
      const response = await publishAt(m2.id, "sue", library(name), p.id);
      const body = (await response.json()) as { code: string; subject: string; message: string };
      expect([response.status, body]).toMatchObject([409, { code: "slot_conflict", subject: atP.id }]);
      expect(body.message).toContain(atP.id);
      expect(body.message).toContain(p.id);
      expect(await counts()).toEqual(before);
    });

    it("keeps a Standard's scope on a new version, and checks the slot at that scope", async () => {
      const name = fresh();
      const standard = await published(await publishAt(m1.id, "sam", library(name), c.id));
      const v2 = await published(await republish(standard.id, "sam", { ...library(name), status: "required" }));
      expect(v2).toMatchObject({ id: standard.id, version: 2, project: { id: c.id, name: "Checkout" } });

      // Moving to a slot held at another scope is fine; one held at C is refused.
      const elsewhere = fresh();
      await published(await publishAt(m2.id, "sue", library(elsewhere), p.id));
      await published(await republish(standard.id, "sam", library(elsewhere)));
      const heldAtC = fresh();
      const holder = await published(await publishAt(m2.id, "sue", library(heldAtC), c.id));
      await expectRefused(await republish(standard.id, "sam", library(heldAtC)), 409, "slot_conflict", holder.id);
    });

    it("refuses projectId on a new version: the scope is fixed, nothing is written", async () => {
      const standard = await published(await publishAt(m1.id, "sam", library(fresh()), p.id));
      const before = await counts();
      const response = await post(`/v1/standards/${standard.id}/versions`, "sam", {
        entry: library(entrySlotName(standard.entry)),
        projectId: c.id,
      });
      const body = (await response.json()) as { message: string };
      expect([response.status, body]).toMatchObject([400, { code: "invalid_input", subject: "projectId" }]);
      expect(body.message).toContain("fixed");
      expect(await counts()).toEqual(before);
    });

    it.each([
      ["another tenant's", () => rootB],
      ["an unknown", () => mintUuidV7()],
      ["a malformed", () => "not-a-project"],
    ])("refuses %s projectId as project_not_found, writing nothing", async (_label, id) => {
      const before = await counts();
      await expectRefused(await publishAt(m1.id, "sam", library(fresh()), id()), 404, "project_not_found", "projectId");
      expect(await counts()).toEqual(before);
    });

    it.each([[7], [null], [{ id: "x" }]])("refuses the projectId %j as invalid_input, writing nothing", async (projectId) => {
      const before = await counts();
      await expectRefused(await publishAt(m1.id, "sam", library(fresh()), projectId), 400, "invalid_input", "projectId");
      expect(await counts()).toEqual(before);
    });

    it("checks the entry before the projectId type", async () => {
      await expectRefused(
        await publishAt(m1.id, "sam", { ...library(fresh()), status: "maybe" }, 7),
        400,
        "invalid_input",
        "status",
      );
    });

    it("denies a non-owner sending a foreign projectId (403, not 404)", async () => {
      const before = await counts();
      await expectRefused(await publishAt(m1.id, "sue", library(fresh()), rootB), 403, "not_module_owner", "role");
      expect(await counts()).toEqual(before);
    });
  });

  describe("concurrency", () => {
    it("lets exactly one of two concurrent publishes into one slot succeed", async () => {
      for (let round = 0; round < 3; round += 1) {
        const name = fresh("race");
        const before = await counts();
        const responses = await Promise.all([
          publishNew(m1.id, "sam", library(name)),
          publishNew(m2.id, "sue", library(name.toUpperCase())),
        ]);
        const statuses = responses.map((r) => r.status).sort();
        expect(statuses).toEqual([201, 409]);
        const refused = responses.find((r) => r.status === 409);
        expect(await refused?.json()).toMatchObject({ code: "slot_conflict" });
        expect(await counts()).toEqual({ standards: before.standards + 1, versions: before.versions + 1 });
      }
    });

    it("numbers concurrent re-publishes of one Standard 1, 2, 3 without gaps", async () => {
      const standard = await publishStandard(db, sam, m1.id, { entry: library(fresh()) });
      await Promise.all([
        publishStandard(db, sam, m1.id, { entry: library(fresh()) }),
        republish(standard.id, "sam", { ...library(entrySlotName(standard.entry)), status: "required" }),
        republish(standard.id, "sam", { ...library(entrySlotName(standard.entry)), status: "prohibited" }),
      ]);
      const { rows } = await owner.query<{ version: number }>(
        "select version from standard_versions where standard_id = $1 order by version",
        [standard.id],
      );
      expect(rows.map((r) => r.version)).toEqual([1, 2, 3]);
    });
  });

  describe("append-only and tenant isolation", () => {
    it.each([
      ["UPDATE standards", sql`update standards set module_id = module_id`],
      ["DELETE standards", sql`delete from standards`],
      ["UPDATE standard_versions", sql`update standard_versions set version = version + 100`],
      ["DELETE standard_versions", sql`delete from standard_versions`],
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
        standards: await tx.select().from(standards),
        versions: await tx.select().from(standardVersions),
      }));
      expect(seen.standards.length).toBeGreaterThan(0);
      expect(seen.versions.length).toBeGreaterThan(0);
      expect(seen.standards.every((row) => row.tenantId === tenantA)).toBe(true);
      expect(seen.versions.every((row) => row.tenantId === tenantA)).toBe(true);

      const all = await owner.query<{ n: number }>("select count(distinct tenant_id)::int as n from standards");
      expect(all.rows[0]?.n).toBe(2);
      const raw = await appPool.query<{ s: number; v: number }>(
        "select (select count(*) from standards)::int as s, (select count(*) from standard_versions)::int as v",
      );
      expect(raw.rows).toEqual([{ s: 0, v: 0 }]);
    });

    it("refuses at the database a Standard pointing at another tenant's Module (composite FK)", async () => {
      const before = await counts();
      await expect(
        withTenant(db, tenantA, (tx) =>
          tx.insert(standards).values({
            id: mintUuidV7(),
            tenantId: tenantA,
            moduleId: foreign.id,
            projectId: rootA,
            createdBy: sam.accountId,
          }),
        ),
      ).rejects.toThrow();
      expect(await counts()).toEqual(before);
    });
  });
});
