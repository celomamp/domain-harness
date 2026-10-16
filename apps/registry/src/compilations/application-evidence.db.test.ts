// Database suite for one Application's Compilation evidence (Story 6.6):
// runs against a real PostgreSQL 18 named by REGISTRY_TEST_DATABASE_URL (an
// admin connection). Creates a throwaway database, migrates it as the admin
// (owner) and runs every data-access call as dh_registry_app
// (`-c role=dh_registry_app`). Exercises every evidence I/O & Edge-Case
// Matrix row in spec-6-6 (read order and content, empty application,
// unknown/other-tenant/malformed ids, unauthenticated calls, isolation).
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  APPLICATION_API_PATHS,
  COMPILATION_API_PATHS,
  COMPILATION_CATALOG_VERSION,
  applicationEvidencePath,
  isApplicationEvidence,
} from "@domain-harness/contract";
import type { ApplicationEvidence, ApplicationInfo, Compilation, UuidV7 } from "@domain-harness/contract";
import { createRegistryDb } from "../db/client.ts";
import type { RegistryDb } from "../db/client.ts";
import { migrate } from "../db/migrate.ts";
import { createRegistryServer } from "../http/server.ts";
import { createLockedRuleService } from "../locked-rules/service.ts";
import { MemoryTransport } from "../mail/memory.ts";
import { createModuleService } from "../modules/service.ts";
import { createProjectService } from "../projects/service.ts";
import { consumeSignInLink, createSignInService, requestSignInLinks } from "../sign-in/service.ts";
import { createStandardService } from "../standards/service.ts";
import { provisionCompany } from "../tenancy/provision.ts";
import { createBuildGrantService } from "../build-grants/service.ts";
import { createChildPermissionService } from "../child-permissions/service.ts";
import { createApplicationService } from "../applications/service.ts";
import { createBoilerplateService } from "../boilerplate/service.ts";
import { createAcceptedDeviationsService } from "../accepted-deviations/service.ts";
import { createAcceptedDeviationAlertsService } from "../accepted-deviation-alerts/service.ts";
import { createGuidanceEndpointService } from "../guidance-endpoint/service.ts";
import { createBundleService } from "../bundles/service.ts";
import { ed25519SignerFromEnv } from "../bundles/sign.ts";
import { mintUuidV7 } from "../ids.ts";
import { createCompilationsService } from "./service.ts";
import { createGuidanceAccessService } from "../guidance-access/service.ts";

const ENV = "REGISTRY_TEST_DATABASE_URL";
const adminUrl = process.env[ENV];
const inCi = process.env["CI"] !== undefined && process.env["CI"] !== "" && process.env["CI"] !== "false";
const APP_ROLE = "dh_registry_app";
const MIGRATION_SUITE_LOCK = 7_202_610_103;
const PANEL = { panelUrl: "http://panel.test" };

if (adminUrl === undefined || adminUrl === "") {
  if (inCi) {
    describe("Application evidence database suite", () => {
      it(`requires ${ENV} when CI is set`, () => {
        expect.fail(`${ENV} is not set; CI must run the database suite against PostgreSQL 18`);
      });
    });
  } else {
    process.stderr.write(`application-evidence.db.test.ts skipped: ${ENV} is not set (see README, "Database")\n`);
  }
}

function withDatabase(url: string, database: string, role?: string): string {
  const next = new URL(url);
  next.pathname = `/${database}`;
  if (role !== undefined) next.searchParams.set("options", `-c role=${role}`);
  return next.toString();
}

const STANDARD = "01928c7e-5b2a-7c3d-ae4f-a1b2c3d4e5f8";

function envelope(type: Compilation["type"], applicationId: UuidV7, sequence: number): Record<string, unknown> {
  return {
    type,
    schemaVersion: "1.0.0",
    catalogVersion: COMPILATION_CATALOG_VERSION,
    idempotencyKey: mintUuidV7(),
    applicationId,
    agentToolName: "claude-code",
    occurredAt: new Date().toISOString(),
    sequence,
  };
}

function validCompilation(type: Compilation["type"], applicationId: UuidV7, sequence: number): Record<string, unknown> {
  const base = envelope(type, applicationId, sequence);
  switch (type) {
    case "guidance":
      return { ...base, tool: "code_stack_rule", outcome: "hit", subject: { kind: "slot-token", slotToken: "code-stack/library/React" } };
    case "gate_run":
      return {
        ...base,
        revision: "abc123",
        verdict: "fail",
        checkedCount: 3,
        openCount: 1,
        deviations: [
          {
            standardId: STANDARD,
            slot: { moduleKind: "code-stack", slotKind: "library", name: "React" },
            subject: "React",
            status: "open",
          },
        ],
      };
    case "deviation":
      return {
        ...base,
        deviation: {
          standardId: STANDARD,
          standardVersion: 2,
          slot: { moduleKind: "code-stack", slotKind: "library", name: "React" },
          subject: "React",
          kind: "prohibited",
          status: "open",
          correction: "Remove React.",
        },
      };
    case "binding_refusal":
      return { ...base, reason: "unknown_application", sentence: "The Application is not bound." };
    case "bundle_status":
      return { ...base, bundleHash: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08", bundleSequence: 4, issuedAt: new Date().toISOString() };
    case "collector_health":
      return { ...base, pendingCount: 2, droppedByReason: { schema_failed: 1 } };
  }
}

describe.skipIf(adminUrl === undefined || adminUrl === "")("Application evidence against PostgreSQL", () => {
  const database = `dh_registry_app_evidence_${randomBytes(6).toString("hex")}`;
  let admin: pg.Client;
  let owner: pg.Client;
  let appPool: pg.Pool;
  let db: RegistryDb;
  let server: Server;
  let base: string;

  const { privateKey } = generateKeyPairSync("ed25519");
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  const KEY_ID = "registry-key-2026-10";

  let appA: ApplicationInfo;
  let emptyA: ApplicationInfo;
  let appB: ApplicationInfo;

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

  const ingest = (credential: string, body: unknown) =>
    fetch(`${base}${COMPILATION_API_PATHS.compilations}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${credential}` },
      body: JSON.stringify(body),
    });

  async function expectRefused(response: Response, status: number, code: string, subject?: string): Promise<void> {
    const body: unknown = await response.json();
    expect([response.status, body]).toMatchObject([status, subject === undefined ? { code } : { code, subject }]);
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
    const appUrl = withDatabase(adminUrl ?? "", database, APP_ROLE);
    appPool = new pg.Pool({ connectionString: appUrl, max: 8 });
    db = createRegistryDb(appPool);

    const signer = ed25519SignerFromEnv({
      REGISTRY_BUNDLE_SIGNING_KEY: privateKeyPem,
      REGISTRY_BUNDLE_SIGNING_KEY_ID: KEY_ID,
    });

    const a = await provisionCompany(db, {
      company: "Acme",
      plan: "Enterprise",
      accounts: [
        { name: "Bea Buyer", email: "bea@acme.io", role: "Buyer" },
        { name: "Bo Builder", email: "bo@acme.io", role: "Builder" },
      ],
    });
    const b = await provisionCompany(db, {
      company: "Bolt",
      plan: "Enterprise",
      accounts: [{ name: "Bob Buyer", email: "bob@bolt.io", role: "Buyer" }],
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
        bundles: createBundleService(db, signer),
        compilations: createCompilationsService(db),
        guidanceAccess: createGuidanceAccessService(db, signer),
      },
      () => undefined,
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;

    for (const [who, email] of [
      ["buyer", "bea@acme.io"],
      ["builder", "bo@acme.io"],
      ["bob", "bob@bolt.io"],
    ] as const) {
      auth[who] = { authorization: `Bearer ${await sessionToken(email)}` };
    }

    for (const [who, catalogVersion, status] of [
      ["buyer", COMPILATION_CATALOG_VERSION, 201],
      ["bob", COMPILATION_CATALOG_VERSION, 201],
    ] as const) {
      const read = await post(COMPILATION_API_PATHS.catalogReads, who, { catalogVersion });
      expect(read.status).toBe(status);
    }

    const createdA = await (
      await post(APPLICATION_API_PATHS.applications, "buyer", { description: "Checkout", projectId: a.rootProjectId })
    ).json();
    const createdEmpty = await (
      await post(APPLICATION_API_PATHS.applications, "buyer", { description: "Spare", projectId: a.rootProjectId })
    ).json();
    const createdB = await (
      await post(APPLICATION_API_PATHS.applications, "bob", { description: "Billing", projectId: b.rootProjectId })
    ).json();
    appA = createdA as ApplicationInfo;
    emptyA = createdEmpty as ApplicationInfo;
    appB = createdB as ApplicationInfo;

    for (const [credential, applicationId, type, sequence] of [
      [a.serviceCredential, appA.id, "guidance", 1],
      [a.serviceCredential, appA.id, "gate_run", 2],
      [a.serviceCredential, appA.id, "deviation", 3],
      [a.serviceCredential, appA.id, "binding_refusal", 4],
      [b.serviceCredential, appB.id, "guidance", 1],
    ] as const) {
      const res = await ingest(credential, validCompilation(type, applicationId, sequence));
      expect(res.status).toBe(201);
    }
  }, 60_000);

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await appPool.end();
    await owner.end();
    await admin.query(`drop database if exists ${database} with (force)`);
    await admin.end();
  }, 60_000);

  it("serves the Application with its Compilations in sequence order, to every role", async () => {
    for (const who of ["buyer", "builder"]) {
      const res = await get(applicationEvidencePath(appA.id), who);
      expect(res.status).toBe(200);
      const body: unknown = await res.json();
      expect(isApplicationEvidence(body)).toBe(true);
      const evidence = body as ApplicationEvidence;
      expect(evidence.application).toEqual(appA);
      expect(evidence.compilations.map((entry) => [entry.type, entry.sequence])).toEqual([
        ["guidance", 1],
        ["gate_run", 2],
        ["deviation", 3],
        ["binding_refusal", 4],
      ]);
    }
  });

  it("serves an empty Compilation list for an Application with no evidence", async () => {
    const res = await get(applicationEvidencePath(emptyA.id), "buyer");
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApplicationEvidence;
    expect(isApplicationEvidence(body)).toBe(true);
    expect(body.application).toEqual(emptyA);
    expect(body.compilations).toEqual([]);
  });

  it("keeps tenants apart: no other tenant's Compilation ever leaves", async () => {
    const res = await get(applicationEvidencePath(appB.id), "bob");
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApplicationEvidence;
    expect(body.application).toEqual(appB);
    expect(body.compilations.map((entry) => [entry.type, entry.sequence])).toEqual([["guidance", 1]]);
  });

  it.each([["malformed", "nope"], ["unknown", mintUuidV7()]])(
    "answers 404 application_not_found for a %s id, storing nothing",
    async (_label, id) => {
      await expectRefused(await get(applicationEvidencePath(id), "buyer"), 404, "application_not_found", "applicationId");
    },
  );

  it("answers 404 application_not_found for another tenant's Application id", async () => {
    await expectRefused(await get(applicationEvidencePath(appA.id), "bob"), 404, "application_not_found", "applicationId");
  });

  it("answers 401 session_invalid without a session", async () => {
    const res = await fetch(`${base}${applicationEvidencePath(appA.id)}`);
    await expectRefused(res, 401, "session_invalid", "session");
  });
});
