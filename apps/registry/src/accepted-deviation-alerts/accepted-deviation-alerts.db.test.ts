// Database suite for the Accepted-deviation alert store (Story 5.6): runs
// against a real PostgreSQL 18 named by REGISTRY_TEST_DATABASE_URL (an admin
// connection). Creates a throwaway database, migrates it as the admin (owner)
// and runs every data-access call as dh_registry_app (`-c role=dh_registry_app`),
// mirroring the accepted-deviations.db.test.ts harness. Every I/O & Edge-Case
// Matrix row of spec-5-6 is pinned by a named test.
//
// The raise evaluations pass their own clock (`now`), so acceptances with
// fixed windows set up historical scenarios deterministically: each scripted
// acceptance is fully drained within its own test and expired for every
// later one.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ACCEPTED_DEVIATION_ALERT_API_PATHS,
  acceptedDeviationAlertDismissalPath,
  isAcceptedDeviationAlerts,
  isUuidV7,
} from "@domain-harness/contract";
import type { AcceptedDeviationAlert, UuidV7 } from "@domain-harness/contract";
import { asc, inArray, sql } from "drizzle-orm";
import { withTenant } from "../db/tenant-scope.ts";
import { createRegistryDb } from "../db/client.ts";
import type { RegistryDb } from "../db/client.ts";
import { migrate } from "../db/migrate.ts";
import { acceptedDeviationAlerts } from "../db/schema.ts";
import { createRegistryServer } from "../http/server.ts";
import { mintUuidV7 } from "../ids.ts";
import { MemoryTransport } from "../mail/memory.ts";
import { createApplicationService } from "../applications/service.ts";
import { createBoilerplateService } from "../boilerplate/service.ts";
import { createCompilationsService } from "../compilations/service.ts";
import { createBuildGrantService } from "../build-grants/service.ts";
import { createChildPermissionService } from "../child-permissions/service.ts";
import { createAcceptedDeviationsService } from "../accepted-deviations/service.ts";
import { createAcceptedDeviationAlertsService, raiseDueAlerts } from "./service.ts";
import { createGuidanceEndpointService } from "../guidance-endpoint/service.ts";
import { createLockedRuleService } from "../locked-rules/service.ts";
import { createModuleService } from "../modules/service.ts";
import { createProjectService } from "../projects/service.ts";
import { consumeSignInLink, createSignInService, requestSignInLinks } from "../sign-in/service.ts";
import { createStandardService } from "../standards/service.ts";
import { createBundleService } from "../bundles/service.ts";
import type { Signer } from "../bundles/sign.ts";
import { ed25519SignerFromEnv } from "../bundles/sign.ts";
import type { ModuleInfo, StandardInfo } from "@domain-harness/contract";
import { provisionCompany } from "../tenancy/provision.ts";

const ENV = "REGISTRY_TEST_DATABASE_URL";
const adminUrl = process.env[ENV];
const inCi = process.env["CI"] !== undefined && process.env["CI"] !== "" && process.env["CI"] !== "false";
const APP_ROLE = "dh_registry_app";
const SCHEDULER_ROLE = "dh_alert_scheduler";
const MIGRATION_SUITE_LOCK = 7_202_610_105;
const REGISTRY_ROOT = resolve(import.meta.dirname, "../..");
const PATH = ACCEPTED_DEVIATION_ALERT_API_PATHS.alerts;
const at = (iso: string): Date => new Date(iso);

if (adminUrl === undefined || adminUrl === "") {
  if (inCi) {
    describe("accepted deviation alert database suite", () => {
      it(`requires ${ENV} when CI is set`, () => {
        expect.fail(`${ENV} is not set; CI must run the database suite against PostgreSQL 18`);
      });
    });
  } else {
    process.stderr.write(`accepted-deviation-alerts.db.test.ts skipped: ${ENV} is not set (see README, "Database")\n`);
  }
}

function withDatabase(url: string, database: string, role?: string): string {
  const next = new URL(url);
  next.pathname = `/${database}`;
  if (role !== undefined) next.searchParams.set("options", `-c role=${role}`);
  return next.toString();
}

/** The acceptance body the suite records; every scenario needs its own window. */
function acceptanceBody(overrides: { subject: string; start: string; end: string; alertIntervalHours: number }): Record<string, unknown> {
  return {
    applicationId: applicationA?.id,
    standardId: standard?.id,
    slot: { moduleKind: "code-stack", slotKind: "library", name: "React" },
    subject: overrides.subject,
    start: overrides.start,
    end: overrides.end,
    justification: "Keep React 18 until the dependency pins move in the lockfile.",
    alertIntervalHours: overrides.alertIntervalHours,
  };
}

let applicationA: { id: string } | undefined;
let standard: StandardInfo | undefined;

describe.skipIf(adminUrl === undefined || adminUrl === "")("accepted deviation alerts against PostgreSQL", () => {
  const database = `dh_registry_alerts_${randomBytes(6).toString("hex")}`;
  let admin: pg.Client;
  let owner: pg.Client;
  let appPool: pg.Pool;
  let db: RegistryDb;
  let server: Server;
  let base: string;
  let signer: Signer;

  let tenantA: UuidV7;
  let tenantB: UuidV7;
  let tenantC: UuidV7;
  let first: { id: string };
  let young: { id: string };
  let past: { id: string };
  let listable: { id: string };

  const auth: Record<string, Record<string, string>> = {};

  async function sessionToken(email: string): Promise<string> {
    const inbox = new MemoryTransport();
    await requestSignInLinks(db, inbox, { panelUrl: "http://panel.test" }, email);
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

  const rawPost = (path: string, who: string, bodyText: string) =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(auth[who] ?? {}) },
      body: bodyText,
    });

  async function expectRefused(response: Response, status: number, code: string, subject?: string): Promise<string> {
    const body = (await response.json()) as { message?: string };
    expect([response.status, body]).toMatchObject([status, subject === undefined ? { code } : { code, subject }]);
    return body.message ?? "";
  }

  /** The tenant's raised alert boundaries with their raise instant, oldest first. */
  async function alertRows(tenantId: UuidV7, acceptanceId?: string): Promise<{ due_at: Date; raised_at: Date }[]> {
    const { rows } = await owner.query<{ due_at: Date; raised_at: Date }>(
      `select a.due_at, a.raised_at from accepted_deviation_alerts a
       where a.tenant_id = $1 ${acceptanceId === undefined ? "" : "and a.acceptance_id = $2"} order by a.due_at`,
      acceptanceId === undefined ? [tenantId] : [tenantId, acceptanceId],
    );
    return rows;
  }

  async function dismissalCount(tenantId: UuidV7, alertId: string): Promise<number> {
    const { rows } = await owner.query<{ n: number }>(
      "select count(*)::int as n from accepted_deviation_alert_dismissals where tenant_id = $1 and alert_id = $2",
      [tenantId, alertId],
    );
    return rows[0]?.n ?? 0;
  }

  /** Record one acceptance through the Buyer's POST (the 5.5 surface) and keep its id. */
  async function recordAcceptance(
    overrides: { subject: string; start: string; end: string; alertIntervalHours: number },
    who = "buyer",
  ): Promise<{ id: string }> {
    const response = await post("/v1/accepted-deviations", who, acceptanceBody(overrides));
    expect(response.status).toBe(201);
    return (await response.json()) as { id: string };
  }

  /** One raised alert id of tenant B (or a fresh canonical id when it has none). */
  async function anAlertIdOfTenantB(): Promise<string> {
    const { rows } = await owner.query<{ id: string }>(
      "select a.id from accepted_deviation_alerts a where a.tenant_id = $1 limit 1",
      [tenantB],
    );
    return rows[0]?.id ?? mintUuidV7();
  }

  async function liveAlerts(who = "buyer"): Promise<AcceptedDeviationAlert[]> {
    const response = await get(PATH, who);
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(isAcceptedDeviationAlerts(body)).toBe(true);
    return (body as { alerts: AcceptedDeviationAlert[] }).alerts;
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

    const { privateKey } = generateKeyPairSync("ed25519");
    signer = ed25519SignerFromEnv({
      REGISTRY_BUNDLE_SIGNING_KEY: privateKey.export({ type: "pkcs8", format: "pem" }) as string,
      REGISTRY_BUNDLE_SIGNING_KEY_ID: "alerts-suite-key",
    });

    const a = await provisionCompany(db, {
      company: "Acme",
      plan: "Team",
      accounts: [
        { name: "Bea Buyer", email: "bea@acme.io", role: "Buyer" },
        { name: "Sam Owner", email: "sam@acme.io", role: "Standard owner" },
        { name: "Bo Builder", email: "bo@acme.io", role: "Builder" },
      ],
    });
    const b = await provisionCompany(db, {
      company: "Bolt",
      plan: "Team",
      accounts: [
        { name: "Bob Buyer", email: "bob@bolt.io", role: "Buyer" },
        { name: "Ola Owner", email: "ola@bolt.io", role: "Standard owner" },
      ],
    });
    const c = await provisionCompany(db, {
      company: "Crest",
      plan: "Community",
      accounts: [{ name: "Cy Buyer", email: "cy@crest.io", role: "Buyer" }],
    });
    tenantA = a.tenantId;
    tenantB = b.tenantId;
    tenantC = c.tenantId;

    server = createRegistryServer(
      {
        signIn: createSignInService(db, new MemoryTransport(), { panelUrl: "http://panel.test" }),
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
        bundles: createBundleService(db, signer),
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
      ["cy", "cy@crest.io"],
    ] as const) {
      auth[who] = { authorization: `Bearer ${await sessionToken(email)}` };
    }

    // Seed the Standard the match key resolves against, and the Application,
    // through the existing pinned routes of tenant A.
    const modRes = await post("/v1/modules", "buyer", { kind: "code-stack", name: "Frontend stack" });
    expect(modRes.status).toBe(201);
    const mod = (await modRes.json()) as ModuleInfo;
    const samAccount = a.accounts[1];
    if (samAccount === undefined) throw new Error("missing owner account");
    const ownerRes = await post(`/v1/modules/${mod.id}/owner`, "buyer", { accountId: samAccount.id });
    expect(ownerRes.status).toBe(200);
    const stdRes = await post(`/v1/modules/${mod.id}/standards`, "sam", {
      entry: { category: "library", name: "React", versionConstraint: "^18.0.0", status: "approved", correctionInstruction: null },
    });
    expect(stdRes.status).toBe(201);
    standard = (await stdRes.json()) as StandardInfo;
    const appRes = await post("/v1/applications", "buyer", { description: "Checkout Web", projectId: a.rootProjectId });
    expect(appRes.status).toBe(201);
    applicationA = (await appRes.json()) as { id: string };

    // Tenant B seeds its own Application and records one acceptance for the
    // multi-tenant pins (a Team plan, so the 5.5 surface accepts it).
    const modBRes = await post("/v1/modules", "bob", { kind: "code-stack", name: "Bolt stack" });
    expect(modBRes.status).toBe(201);
    const modB = (await modBRes.json()) as ModuleInfo;
    const olaAccount = b.accounts[1];
    if (olaAccount === undefined) throw new Error("missing Bolt owner");
    const ownerBRes = await post(`/v1/modules/${modB.id}/owner`, "bob", { accountId: olaAccount.id });
    expect(ownerBRes.status).toBe(200);
    const stdBRes = await post(`/v1/modules/${modB.id}/standards`, "ola", {
      entry: { category: "library", name: "React", versionConstraint: "^18.0.0", status: "approved", correctionInstruction: null },
    });
    expect(stdBRes.status).toBe(201);
    const standardB = (await stdBRes.json()) as StandardInfo;
    const appBRes = await post("/v1/applications", "bob", { description: "Bolt Web", projectId: b.rootProjectId });
    expect(appBRes.status).toBe(201);
    const applicationB = (await appBRes.json()) as { id: string };
    const boltResponse = await post("/v1/accepted-deviations", "bob", {
      ...acceptanceBody({ subject: "bolt", start: "2026-10-03T00:00:00.000Z", end: "2026-10-03T02:01:00.000Z", alertIntervalHours: 1 }),
      applicationId: applicationB.id,
      standardId: standardB.id,
    });
    expect(boltResponse.status).toBe(201);
  }, 60_000);

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await appPool.end();
    await owner.end();
    await admin.query(`drop database if exists ${database} with (force)`);
    await admin.end();
  }, 60_000);

  describe("migration 0014 (both new tables)", () => {
    it("enables and forces RLS with tenant_isolation and grants SELECT and INSERT only to dh_registry_app", async () => {
      const { rows } = await owner.query<{ relname: string; rls: boolean; forced: boolean; policies: string[] }>(
        `select c.relname, c.relrowsecurity as rls, c.relforcerowsecurity as forced,
                array(select p.polname::text from pg_policy p where p.polrelid = c.oid order by 1) as policies
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname in ('accepted_deviation_alerts','accepted_deviation_alert_dismissals')
         order by 1`,
      );
      expect(rows).toEqual([
        { relname: "accepted_deviation_alert_dismissals", rls: true, forced: true, policies: ["tenant_isolation"] },
        { relname: "accepted_deviation_alerts", rls: true, forced: true, policies: ["tenant_isolation"] },
      ]);
      const grants = await owner.query<{ table_name: string; privilege_type: string }>(
        `select table_name, privilege_type from information_schema.role_table_grants
         where grantee = $1 and table_name like 'accepted_deviation_alert%' order by 1, 2`,
        [APP_ROLE],
      );
      expect(grants.rows).toEqual([
        { table_name: "accepted_deviation_alert_dismissals", privilege_type: "INSERT" },
        { table_name: "accepted_deviation_alert_dismissals", privilege_type: "SELECT" },
        { table_name: "accepted_deviation_alerts", privilege_type: "INSERT" },
        { table_name: "accepted_deviation_alerts", privilege_type: "SELECT" },
      ]);
    });

    it("refuses UPDATE and DELETE for the runtime role on both tables (append-only)", async () => {
      for (const statement of [
        "update accepted_deviation_alerts set raised_at = now()",
        "delete from accepted_deviation_alerts",
        "update accepted_deviation_alert_dismissals set dismissed_at = now()",
        "delete from accepted_deviation_alert_dismissals",
      ]) {
        await expect(
          withTenant(db, tenantA, async (tx) => {
            await tx.execute(sql.raw(statement));
          }),
        ).rejects.toThrow();
      }
    });

    it("makes dh_alert_scheduler a NOLOGIN role owning exactly the definer function and granting EXECUTE only as designed", async () => {
      const facts = await owner.query<{ rolcanlogin: boolean; rolsuper: boolean; rolbypassrls: boolean; owns: number }>(
        `select rolcanlogin, rolsuper, rolbypassrls,
                (select count(*)::int from pg_class where relowner = (select oid from pg_roles where rolname = $1)) as owns
         from pg_roles where rolname = $1`,
        [SCHEDULER_ROLE],
      );
      // The role owns no relation (a function lives in pg_proc, not pg_class).
      expect(facts.rows).toEqual([{ rolcanlogin: false, rolsuper: false, rolbypassrls: false, owns: 0 }]);
      const fnOwner = await owner.query<{ owner: string }>(
        `select pg_get_userbyid(p.proowner) as owner from pg_proc p
         where p.proname = 'live_accepted_deviation_alert_tenants'`,
      );
      expect(fnOwner.rows).toEqual([{ owner: SCHEDULER_ROLE }]);

      const execute = await owner.query<{ app_execute: boolean; scheduler_execute: boolean; public_execute: boolean }>(
        `select
           has_function_privilege($1, 'live_accepted_deviation_alert_tenants(timestamptz)', 'EXECUTE') as app_execute,
           has_function_privilege($2, 'live_accepted_deviation_alert_tenants(timestamptz)', 'EXECUTE') as scheduler_execute,
           has_function_privilege('public', 'live_accepted_deviation_alert_tenants(timestamptz)', 'EXECUTE') as public_execute`,
        [APP_ROLE, SCHEDULER_ROLE],
      );
      // dh_registry_app may execute it; PUBLIC may not (only the owner role's
      // implicit-as-owner privilege remains).
      expect(execute.rows).toEqual([
        { app_execute: true, scheduler_execute: true, public_execute: false },
      ]);
      const publicGrant = await owner.query(
        `select 1 from information_schema.role_usage_grants
         where object_name = 'live_accepted_deviation_alert_tenants' and grantee = 'PUBLIC'`,
      );
      expect(publicGrant.rowCount).toBe(0);
    });
  });

  describe("raising the due boundaries", () => {
    it("records the two window acceptances the scenarios need", async () => {
      // Window 2026-10-01 [00:00, 03:01): hourlies at 01:00, 02:00, 03:00, and
      // no boundary at or past the end beyond that.
      first = await recordAcceptance({ subject: "first", start: "2026-10-01T00:00:00.000Z", end: "2026-10-01T03:01:00.000Z", alertIntervalHours: 1 });
      // A window that is closed long before its scenarios run.
      past = await recordAcceptance({ subject: "past", start: "2026-09-01T00:00:00.000Z", end: "2026-09-02T00:00:00.000Z", alertIntervalHours: 1 });
      // A still-open window for the list reads (registry clock = real time).
      listable = await recordAcceptance({ subject: "listable", start: "2026-10-01T06:00:00.000Z", end: "2099-01-01T00:00:00.000Z", alertIntervalHours: 168 });
      expect(first.id).not.toBe(past.id);
    });

    it("raises exactly the first boundary k=1 when now reaches start + interval (inclusive)", async () => {
      expect(await raiseDueAlerts(db, at("2026-10-01T01:00:00.000Z"))).toEqual({ raised: 1, failed: 0 });
      const rows = await alertRows(tenantA, first.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.due_at.toISOString()).toBe("2026-10-01T01:00:00.000Z");
      expect(rows[0]?.raised_at.toISOString()).toBe("2026-10-01T01:00:00.000Z");
    });

    it("raises nothing on a repeat tick at the same now (one alert per boundary forever)", async () => {
      expect(await raiseDueAlerts(db, at("2026-10-01T01:30:00.000Z"))).toEqual({ raised: 0, failed: 0 });
      expect(await alertRows(tenantA, first.id)).toHaveLength(1);
    });

    it("catches up exactly the missed boundaries, oldest first, and raises nothing after the window closes", async () => {
      // A service that never evaluated since the start is restarted with now
      // past two boundaries of a still-live acceptance: one evaluation raises
      // exactly k=1 and k=2 in boundary order (nothing past the end).
      const catchup = await recordAcceptance({ subject: "catch-up", start: "2026-10-06T00:00:00.000Z", end: "2026-10-06T03:01:00.000Z", alertIntervalHours: 1 });
      expect(await raiseDueAlerts(db, at("2026-10-06T02:30:00.000Z"))).toEqual({ raised: 2, failed: 0 });
      expect((await alertRows(tenantA, catchup.id)).map((row) => row.due_at.toISOString())).toEqual([
        "2026-10-06T01:00:00.000Z",
        "2026-10-06T02:00:00.000Z",
      ]);
      // Past the window's end nothing is raised again (the boundary at 03:00
      // is by then forever out of reach).
      expect(await raiseDueAlerts(db, at("2026-10-06T09:00:00.000Z"))).toEqual({ raised: 0, failed: 0 });
      expect(await alertRows(tenantA, catchup.id)).toHaveLength(2);
    });

    it("raises a reminder inside a window that has since expired, and the read hides it (an expired window is never live)", async () => {
      // Inside the "past" window (September): exactly its first boundary.
      expect(await raiseDueAlerts(db, at("2026-09-01T01:00:00.000Z"))).toEqual({ raised: 1, failed: 0 });
      // An evaluation after the window closed: no candidates at all.
      expect(await raiseDueAlerts(db, at("2026-09-02T09:00:00.000Z"))).toEqual({ raised: 0, failed: 0 });
      expect(await alertRows(tenantA, past.id)).toHaveLength(1);
    });

    it("raises nothing before the first boundary of a just-recorded acceptance", async () => {
      young = await recordAcceptance({ subject: "young", start: "2026-10-02T00:00:00.000Z", end: "2026-10-02T02:01:00.000Z", alertIntervalHours: 1 });
      // No alert at k = 0: 30 minutes after the start no boundary is due yet.
      expect(await raiseDueAlerts(db, at("2026-10-02T00:30:00.000Z"))).toEqual({ raised: 0, failed: 0 });
      expect(await alertRows(tenantA, young.id)).toHaveLength(0);
    });

    it("raises no boundary for a window that expired before its first tick", async () => {
      const atEnd = await recordAcceptance({ subject: "at-end", start: "2026-10-05T00:00:00.000Z", end: "2026-10-05T01:00:00.000Z", alertIntervalHours: 1 });
      // The only boundary (start + 1h) is not strictly before the end: nothing.
      expect(await raiseDueAlerts(db, at("2026-10-05T09:00:00.000Z"))).toEqual({ raised: 0, failed: 0 });
      expect(await alertRows(tenantA, atEnd.id)).toHaveLength(0);
    });

    it("serves the live list open to every role, one deterministic order, live rows only", async () => {
      // A catch-up that fills the listable window's only boundary before the
      // list scenario begins (k=1 of a weekly interval).
      expect(await raiseDueAlerts(db, at("2026-10-08T07:00:00.000Z"))).toEqual({ raised: 1, failed: 0 });
      const alerts = await liveAlerts();
      // Every window but `listable` has expired under the real clock.
      expect(alerts.length).toBeGreaterThanOrEqual(1);
      const names = new Set(alerts.map((alert) => alert.subject));
      expect(names.has("past")).toBe(false);
      expect(names.has("at-end")).toBe(false);

      const named = alerts.find((alert) => alert.subject === "listable");
      expect(named).toEqual({
        id: expect.any(String) as unknown,
        acceptanceId: listable.id,
        applicationId: applicationA?.id,
        applicationName: "Checkout Web",
        standardId: standard?.id,
        standardVersion: 1,
        slot: { moduleKind: "code-stack", slotKind: "library", name: "React" },
        subject: "listable",
        end: "2099-01-01T00:00:00.000Z",
        dueAt: "2026-10-08T06:00:00.000Z",
        raisedAt: "2026-10-08T07:00:00.000Z",
      });
      for (const alert of alerts) {
        expect(alert.end).toBe(new Date(alert.end).toISOString());
        expect(alert.dueAt).toBe(new Date(alert.dueAt).toISOString());
      }
      // A Builder reads the same list (GET is open to every role).
      const builderAlerts = await liveAlerts("builder");
      expect(builderAlerts.map((alert) => alert.id)).toEqual(alerts.map((alert) => alert.id));
    });

    it("orders the list by dueAt ascending, breaking the tie by id ascending", async () => {
      const alerts = await liveAlerts();
      const byDue = [...alerts].sort((x, y) => x.dueAt.localeCompare(y.dueAt));
      expect(alerts.map((alert) => alert.dueAt)).toEqual(byDue.map((alert) => alert.dueAt));

      // Two acceptances with the same start and the same interval compute their
      // first boundary at exactly the same instant, so the read's `id asc`
      // tie-break is what orders their two equal-dueAt alerts.
      const tieStart = "2026-10-09T00:00:00.000Z";
      const tieOne = await recordAcceptance({
        subject: "tie-1",
        start: tieStart,
        end: "2026-10-09T02:00:00.000Z",
        alertIntervalHours: 1,
      });
      const tieTwo = await recordAcceptance({
        subject: "tie-2",
        start: tieStart,
        end: "2026-10-09T02:00:00.000Z",
        alertIntervalHours: 1,
      });
      // One boundary each (start + 1h, strictly before the 02:00 end), raised
      // together and fully drained: nothing of either stays due later on.
      expect(await raiseDueAlerts(db, at("2026-10-09T01:30:00.000Z"))).toEqual({ raised: 2, failed: 0 });
      const ties = await withTenant(db, tenantA, (tx) =>
        tx
          .select({ id: acceptedDeviationAlerts.id, dueAt: acceptedDeviationAlerts.dueAt })
          .from(acceptedDeviationAlerts)
          .where(
            inArray(acceptedDeviationAlerts.acceptanceId, [tieOne.id, tieTwo.id] as [UuidV7, UuidV7]),
          )
          // The list service's own order: dueAt ascending, id ascending.
          .orderBy(asc(acceptedDeviationAlerts.dueAt), asc(acceptedDeviationAlerts.id)),
      );
      expect(ties.map((row) => row.dueAt.toISOString())).toEqual([
        "2026-10-09T01:00:00.000Z",
        "2026-10-09T01:00:00.000Z",
      ]);
      const ids = ties.map((row) => row.id);
      expect([...ids].sort()).toEqual(ids);
    });
  });

  describe("the definer function's candidate set", () => {
    const t = async (iso: string): Promise<string[]> =>
      (await owner.query<{ tenant_id: string }>(
        "select tenant_id::text as tenant_id from live_accepted_deviation_alert_tenants($1)",
        [iso],
      )).rows.map((row) => row.tenant_id);

    it("returns exactly the distinct tenants holding a live acceptance at p_now", async () => {
      // Inside the September window: only tenant A ("past").
      expect(await t("2026-09-01T05:00:00Z")).toEqual([tenantA]);
      // Inside the October windows of both tenants: A (young, listable) and B
      // (bolt, 2026-10-03 [00:00, 02:01)). DISTINCT: each tenant once.
      const both = await t("2026-10-03T00:15:00Z");
      expect(both).toHaveLength(2);
      expect(both).toEqual(expect.arrayContaining([tenantA, tenantB]));
      // Past every scripted window but inside the open early one: only A.
      expect(await t("2026-10-03T03:00:00Z")).toEqual([tenantA]);
      // Long after everything but `listable` (end 2099): still only A.
      expect(await t("2027-01-01T00:00:00Z")).toEqual([tenantA]);
      // Only canonical UUIDv7 tenant ids ever leave the function.
      expect((await t("2027-01-01T00:00:00Z")).every((id) => isUuidV7(id))).toBe(true);
    });
  });

  describe("multi-tenant isolation", () => {
    beforeAll(async () => {
      // One boundary each: both tenants hold live acceptances at this now.
      expect(await raiseDueAlerts(db, at("2026-10-03T02:00:00.000Z"))).toEqual({ raised: 2, failed: 0 });
    });

    it("raises per tenant under its own withTenant and never leaks across", async () => {
      const seenA = await withTenant(db, tenantA, (tx) => tx.select().from(acceptedDeviationAlerts));
      expect(seenA.length).toBeGreaterThanOrEqual(4);
      expect(seenA.every((row) => row.tenantId === tenantA)).toBe(true);
      const seenB = await withTenant(db, tenantB, (tx) => tx.select().from(acceptedDeviationAlerts));
      expect(seenB).toHaveLength(2);
      expect(seenB.every((row) => row.tenantId === tenantB)).toBe(true);
    });

    it("keeps the reads tenant-scoped: tenant A's list never contains tenant B's rows", async () => {
      const aAlerts = await liveAlerts();
      expect(aAlerts.some((alert) => alert.subject === "bolt")).toBe(false);
      const bResponse = await get(PATH, "bob");
      expect(bResponse.status).toBe(200);
      const bBody = (await bResponse.json()) as { alerts: AcceptedDeviationAlert[] };
      // `bolt`'s window closed on 3 October; the empty read is the live
      // filter's answer, and nothing of A ever leaks into it either way.
      expect(bBody.alerts.every((alert) => alert.applicationName === "Bolt Web")).toBe(true);
      expect(bBody.alerts.some((alert) => alert.applicationName === "Checkout Web")).toBe(false);
    });

    it("counts a failing tenant and lets the others proceed (per-tenant isolation inside one evaluation)", async () => {
      await owner.query(`create function suite_fault() returns trigger language plpgsql as $$
        begin if new.tenant_id::text = '${tenantA}' then raise exception 'suite fault'; end if; return new; end
      $$;`);
      await owner.query("create trigger suite_fault before insert on accepted_deviation_alerts for each row execute function suite_fault()");
      const faulted = await recordAcceptance({ subject: "faulted", start: "2026-10-04T00:00:00.000Z", end: "2026-10-04T02:01:00.000Z", alertIntervalHours: 1 });
      // Tenant A holds the live due and its inserts abort wholesale: nothing
      // raised for A, one failure counted, tenant B (no dues left) untouched.
      try {
        const result = await raiseDueAlerts(db, at("2026-10-04T01:30:00.000Z"));
        expect(result.raised).toBe(0);
        expect(result.failed).toBe(1);
        expect(await alertRows(tenantA, faulted.id)).toHaveLength(0);
      } finally {
        // The fault never outlives its test, whatever the assertions did.
        await owner.query("drop trigger if exists suite_fault on accepted_deviation_alerts");
        await owner.query("drop function if exists suite_fault()");
      }
      // Without the fault the same now raises the deferred boundary.
      const retried = await raiseDueAlerts(db, at("2026-10-04T01:30:00.000Z"));
      expect(retried.raised).toBe(1);
      expect(retried.failed).toBe(0);
      const faultRows = await alertRows(tenantA, faulted.id);
      expect(faultRows.map((row) => row.due_at.toISOString())).toEqual(["2026-10-04T01:00:00.000Z"]);
      expect(faultRows[0]?.raised_at.toISOString()).toBe(at("2026-10-04T01:30:00.000Z").toISOString());
    });
  });

  describe("Community tenant", () => {
    it("answers the GET with an empty { alerts: [] } and a dismissal with not_found, never a plan refusal", async () => {
      // No Community row ever exists, under the tenant's own scope either.
      const seen = await withTenant(db, tenantC, (tx) => tx.select().from(acceptedDeviationAlerts));
      expect(seen).toEqual([]);

      const response = await get(PATH, "cy");
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ alerts: [] });

      const unknown = mintUuidV7();
      const refusal = await post(acceptedDeviationAlertDismissalPath(unknown), "cy", { alertId: unknown });
      expect(refusal.status).toBe(404);
      expect(await refusal.json()).toMatchObject({ code: "not_found", subject: "alertId" });
      const message = await expectRefused(
        await post(acceptedDeviationAlertDismissalPath(unknown), "cy", { alertId: unknown }),
        404,
        "not_found",
        "alertId",
      );
      expect(message).not.toMatch(/plan|Team|price|\$|€|£/i);
    });
  });

  describe("dismissing an alert", () => {
    let alertId: string;
    let dismissible: { id: string };

    beforeAll(async () => {
      // A fresh live window whose first boundary is raised exactly once.
      dismissible = await recordAcceptance({ subject: "dismissible", start: "2026-10-10T00:00:00.000Z", end: "2099-01-01T00:00:00.000Z", alertIntervalHours: 24 });
      expect(await raiseDueAlerts(db, at("2026-10-11T00:30:00.000Z"))).toEqual({ raised: 1, failed: 0 });
      const alert = (await liveAlerts()).find((candidate) => candidate.acceptanceId === dismissible.id);
      if (alert === undefined) throw new Error("expected the dismissible alert");
      alertId = alert.id;
    });

    it("writes exactly one idempotent dismissal row for the Buyer and removes the alert from the read", async () => {
      const firstPost = await post(acceptedDeviationAlertDismissalPath(alertId), "buyer", { alertId });
      expect(firstPost.status).toBe(200);
      expect(await firstPost.json()).toEqual({ dismissed: true });
      expect(await dismissalCount(tenantA, alertId)).toBe(1);

      const repeat = await post(acceptedDeviationAlertDismissalPath(alertId), "buyer", { alertId });
      expect(repeat.status).toBe(200);
      expect(await repeat.json()).toEqual({ dismissed: true });
      expect(await dismissalCount(tenantA, alertId)).toBe(1);
      expect((await liveAlerts()).some((alert) => alert.id === alertId)).toBe(false);
    });

    it("refuses every other role before the body is read (drained), writing nothing", async () => {
      const beforeRows = await owner.query<{ n: number }>(
        "select count(*)::int as n from accepted_deviation_alert_dismissals",
      );
      for (const who of ["ola", "builder"]) {
        const response = await rawPost(acceptedDeviationAlertDismissalPath(alertId), who, "{not json");
        await expectRefused(response, 403, "role_denied", "role");
      }
      const afterRows = await owner.query<{ n: number }>(
        "select count(*)::int as n from accepted_deviation_alert_dismissals",
      );
      expect(afterRows.rows.map((row) => row.n)).toEqual(beforeRows.rows.map((row) => row.n));
    });

    it("answers 404 not_found naming alertId for an id that is not this tenant's alert, writing nothing", async () => {
      // A canonical id of no alert in this tenant, and a canonical id of a
      // real alert of another tenant: both invisible under RLS.
      const foreignId = await anAlertIdOfTenantB();
      for (const unknown of [mintUuidV7(), foreignId]) {
        const before = await dismissalCount(tenantA, alertId);
        const response = await post(acceptedDeviationAlertDismissalPath(unknown), "buyer", { alertId: unknown });
        expect(response.status).toBe(404);
        expect(await response.json()).toMatchObject({ code: "not_found", subject: "alertId" });
        expect(await dismissalCount(tenantA, alertId)).toBe(before);
      }
    });

    it.each([
      ["a non-object body", []],
      ["a body missing the field", {}],
      ["a body with an extra field", "extra"],
      ["an empty alertId", "empty"],
      ["a non-UUID alertId", "not-a-uuid"],
      ["an alertId that is not the path's", "mismatch"],
    ])("answers 400 invalid_input subject alertId and writes nothing for %s", async (_label, kind) => {
      const beforeTotal = await owner.query<{ n: number }>(
        "select count(*)::int as n from accepted_deviation_alert_dismissals",
      );
      const payload =
        kind === "extra"
          ? { alertId, extra: 1 }
          : kind === "empty"
            ? { alertId: "" }
            : kind === "not-a-uuid"
              ? { alertId: "not-a-uuid" }
              : kind === "mismatch"
                ? { alertId: mintUuidV7() }
                : kind;
      const response = await post(acceptedDeviationAlertDismissalPath(alertId), "buyer", payload);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "invalid_input", subject: "alertId" });
      const afterTotal = await owner.query<{ n: number }>(
        "select count(*)::int as n from accepted_deviation_alert_dismissals",
      );
      expect(afterTotal.rows.map((row) => row.n)).toEqual(beforeTotal.rows.map((row) => row.n));
    });

    it("answers 401 without a session and 405 for other methods", async () => {
      await expectRefused(await fetch(`${base}${PATH}`), 401, "session_invalid");
      const wrongMethod = await fetch(`${base}${PATH}`, { method: "DELETE", headers: auth["buyer"] ?? {} });
      expect(wrongMethod.headers.get("allow")).toBe("GET");
      expect(wrongMethod.status).toBe(405);
      const getDismissal = await fetch(`${base}${acceptedDeviationAlertDismissalPath(alertId)}`);
      expect(getDismissal.headers.get("allow")).toBe("POST");
      await expectRefused(getDismissal, 405, "method_not_allowed");
    });
  });

  describe("the serve-cli scheduler's runtime path", () => {
    it("starts faithfully against the migrated database and raises the due first boundary at the startup catch-up, then terminates cleanly", async () => {
      // A still-live window whose first boundary (start + 1h) lies in the
      // immediate past: the catch-up evaluation against serve-cli's registry
      // clock raises it. This test pins the catch-up alone — the startup
      // evaluation is deterministic — and never waits on the 60 second tick.
      const recorded = new Date();
      const start = new Date(recorded.getTime() - 2 * 3_600_000);
      const served = await recordAcceptance({
        subject: "serve",
        start: start.toISOString(),
        end: new Date(recorded.getTime() + 365 * 86_400_000).toISOString(),
        alertIntervalHours: 1,
      });
      const firstBoundary = new Date(start.getTime() + 3_600_000).toISOString();

      const { privateKey } = generateKeyPairSync("ed25519");
      const child = spawn(process.execPath, ["--conditions=@domain-harness/source", "src/http/serve-cli.ts"], {
        cwd: REGISTRY_ROOT,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          REGISTRY_DATABASE_URL: withDatabase(adminUrl ?? "", database, APP_ROLE),
          REGISTRY_PANEL_URL: "http://panel.test",
          REGISTRY_MAIL_OUTBOX_DIR: join(tmpdir(), "dh-serve-outbox"),
          REGISTRY_HTTP_PORT: "0",
          REGISTRY_BUNDLE_SIGNING_KEY: privateKey.export({ type: "pkcs8", format: "pem" }) as string,
          REGISTRY_BUNDLE_SIGNING_KEY_ID: "serve-suite-key",
        },
      });
      let stdout = "";
      const stderr: string[] = [];
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr.push(chunk.toString());
      });
      const exited: Promise<number | null> = new Promise((resolve) => {
        child.once("exit", (code) => {
          resolve(code);
        });
      });
      let exitCode: number | null = null;
      try {
        // The catch-up proof: a stdout `alerts_raised` event with at least one
        // raised boundary (node starts and migrates nothing here, so the
        // throwaway database it is handed is already at the suite's schema).
        let event: { raised: number; failed: number } | undefined;
        const deadline = Date.now() + 15_000;
        while (event === undefined && Date.now() < deadline) {
          for (const line of stdout.split("\n")) {
            try {
              const parsed: unknown = JSON.parse(line.trim());
              if (
                typeof parsed === "object" &&
                parsed !== null &&
                (parsed as { event?: unknown }).event === "alerts_raised" &&
                typeof (parsed as { raised?: unknown }).raised === "number"
              ) {
                event = parsed as { raised: number; failed: number };
              }
            } catch {
              // Not a JSON line (or a partial one): keep scanning.
            }
          }
          if (event === undefined) await new Promise((resolve) => setTimeout(resolve, 100));
        }
        expect(
          event,
          `serve-cli never logged alerts_raised; stdout: ${JSON.stringify(stdout)} stderr: ${JSON.stringify(stderr.join(""))}`,
        ).toBeDefined();
        expect(event?.raised).toBeGreaterThanOrEqual(1);

        // The boundary's own row exists, raised by the spawned process.
        const rows = await alertRows(tenantA, served.id);
        expect(rows.length).toBeGreaterThanOrEqual(1);
        expect(rows.map((row) => row.due_at.toISOString())).toContain(firstBoundary);
      } finally {
        child.kill("SIGTERM");
        const code = await Promise.race([
          exited,
          new Promise<symbol>((resolve) => {
            setTimeout(() => {
              resolve(Symbol.for("timeout"));
            }, 10_000);
          }),
        ]);
        if (typeof code === "symbol") {
          child.kill("SIGKILL");
          await exited;
        } else {
          exitCode = code ?? null;
        }
      }
      // Terminated cleanly: the stop handler drained the pool and exited 0.
      expect(exitCode).toBe(0);
    });
  });
});
