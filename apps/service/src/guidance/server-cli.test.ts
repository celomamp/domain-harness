// Spawn-style suite for the Guidance server entry (Stories 4.4 + 4.5): with
// a bad SERVICE_TENANT_ID, exactly one parseable envelope on stderr, exit
// code 1 and nothing on stdout — no database needed, in the bundles daemon's
// service-cli suite style — plus, against a real PostgreSQL 18 named by
// SERVICE_TEST_DATABASE_URL, the deployed wiring: `createGuidanceHttpServer`
// over a real pool records one bound MCP `hit` durably in `guidance_events`
// (an InMemory swap or dropped threading would leave Postgres empty), and a
// record failure keeps the typed answer while logging one ids-only
// `guidance_record_error` line.
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { promisify } from "node:util";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { canonicalJson, GUIDANCE_IDENTITY_HEADERS } from "@domain-harness/contract";
import type { GuidanceToolResult, StandardBundlePayload, UuidV7 } from "@domain-harness/contract";
import { createGuidanceHttpServer } from "./server-cli.ts";
import type { LogEvent } from "./server-cli.ts";
import { migrate } from "../db/migrate.ts";
import { createPool, createPostgresBundleRecordStore } from "../bundles/store.ts";
import { bundleHashOf } from "../bundles/verify.ts";
import { makeBundlePayload, makeSigningKey, signPayload } from "../bundles/test-fixtures.ts";

const run = promisify(execFile);
const CLI_PATH = path.resolve(import.meta.dirname, "./server-cli.ts");
const TENANT = "018f3d2a-7000-7000-8000-000000000100";

function entryEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    SERVICE_TENANT_ID: TENANT,
    SERVICE_RECORD_DATABASE_URL: "postgres://postgres:postgres@localhost/dh_never_used",
    SERVICE_READ_CREDENTIAL: "read-secret-4-6-opaque",
    ...overrides,
  };
}

describe("guidance server-cli: start failure", () => {
  it("prints exactly one parseable envelope on stderr for a bad tenant id, exits 1 and writes nothing to stdout", async () => {
    try {
      await run(process.execPath, [CLI_PATH], { env: entryEnv({ SERVICE_TENANT_ID: "not-a-uuid" }) });
      throw new Error("the guidance server entry did not exit 1");
    } catch (error) {
      const failure = error as { code?: number; stdout?: string; stderr?: string };
      expect(failure.code).toBe(1);
      const lines = (failure.stderr ?? "").split("\n").filter((line) => line.trim() !== "");
      expect(lines).toHaveLength(1);
      const envelopeLine = lines[0];
      if (envelopeLine === undefined) {
        throw new Error("stderr carried no line", { cause: error });
      }
      const envelope = JSON.parse(envelopeLine) as { code?: unknown; message?: unknown; subject?: unknown };
      expect(envelope.code).toBe("invalid_configuration");
      expect(envelope.subject).toBe("SERVICE_TENANT_ID");
      expect(typeof envelope.message === "string" && envelope.message.length > 0).toBe(true);
      expect(failure.stdout ?? "").toBe("");
    }
  }, 60_000);

  it("reports a missing variable as missing_configuration", async () => {
    try {
      await run(process.execPath, [CLI_PATH], { env: entryEnv({ SERVICE_RECORD_DATABASE_URL: undefined }) });
      throw new Error("the guidance server entry did not exit 1");
    } catch (error) {
      const failure = error as { code?: number; stdout?: string; stderr?: string };
      expect(failure.code).toBe(1);
      const lines = (failure.stderr ?? "").split("\n").filter((line) => line.trim() !== "");
      expect(lines).toHaveLength(1);
      const envelope = JSON.parse(lines[0] ?? "") as { code?: unknown; subject?: unknown };
      expect(envelope.code).toBe("missing_configuration");
      expect(envelope.subject).toBe("SERVICE_RECORD_DATABASE_URL");
      expect(failure.stdout ?? "").toBe("");
    }
  }, 60_000);

  it("reports a missing read credential as missing_configuration and never logs it", async () => {
    try {
      await run(process.execPath, [CLI_PATH], { env: entryEnv({ SERVICE_READ_CREDENTIAL: undefined }) });
      throw new Error("the guidance server entry did not exit 1");
    } catch (error) {
      const failure = error as { code?: number; stdout?: string; stderr?: string };
      expect(failure.code).toBe(1);
      const lines = (failure.stderr ?? "").split("\n").filter((line) => line.trim() !== "");
      expect(lines).toHaveLength(1);
      const envelope = JSON.parse(lines[0] ?? "") as { code?: unknown; subject?: unknown };
      expect(envelope.code).toBe("missing_configuration");
      expect(envelope.subject).toBe("SERVICE_READ_CREDENTIAL");
      expect(failure.stdout ?? "").toBe("");
    }
  }, 60_000);
});

const DB_ENV = "SERVICE_TEST_DATABASE_URL";
const dbAdminUrl = process.env[DB_ENV];
const dbInCi = process.env["CI"] !== undefined && process.env["CI"] !== "" && process.env["CI"] !== "false";

if (dbAdminUrl === undefined || dbAdminUrl === "") {
  if (dbInCi) {
    describe("guidance server-cli deployed wiring suite", () => {
      it(`requires ${DB_ENV} when CI is set`, () => {
        expect.fail(`${DB_ENV} is not set; CI must run the guidance wiring suite against PostgreSQL 18`);
      });
    });
  } else {
    process.stderr.write(`server-cli.test.ts wiring suite skipped: ${DB_ENV} is not set\n`);
  }
}

function withDatabase(url: string, database: string): string {
  const next = new URL(url);
  next.pathname = `/${database}`;
  return next.toString();
}

// node:http lowercases header names.
const HEADER_KEYS = {
  applicationId: GUIDANCE_IDENTITY_HEADERS.applicationId.toLowerCase(),
  advisoryProjectId: GUIDANCE_IDENTITY_HEADERS.advisoryProjectId.toLowerCase(),
  repoFingerprint: GUIDANCE_IDENTITY_HEADERS.repoFingerprint.toLowerCase(),
};

const APP = "018f3d2a-7000-7000-8000-000000000001" as UuidV7;
const ROOT = "018f3d2a-7000-7000-8000-000000000110" as UuidV7;
const WEB = "018f3d2a-7000-7000-8000-000000000112" as UuidV7;
const FP_1 = "1".repeat(64);
const ISSUED = "2026-10-14T06:00:00.000Z";
const STD_REACT = "018f3d2a-7000-7000-8000-000000000131" as UuidV7;
const STD_QUETZAL = "018f3d2a-7000-7000-8000-000000000132" as UuidV7;
const READ_CREDENTIAL = "read-secret-4-6-opaque";

/** The identity headers of a bound Application. */
const BOUND_HEADERS: Record<string, string> = {
  [HEADER_KEYS.repoFingerprint]: FP_1,
  [HEADER_KEYS.applicationId]: APP,
  [HEADER_KEYS.advisoryProjectId]: WEB,
};

const PUBLISHER = { accountId: "018f3d2a-7000-7000-8000-000000000140" as UuidV7, name: "Bea" };
const CODE_MODULE = { id: "018f3d2a-7000-7000-8000-000000000120" as UuidV7, kind: "code-stack" as const, name: "Backend" };

function libraryStandard(id: UuidV7, name: string): StandardBundlePayload["standards"][number] {
  return {
    id,
    version: 1,
    module: CODE_MODULE,
    project: { id: ROOT, name: "Root" },
    entry: { category: "library", name, versionConstraint: null, status: "approved", correctionInstruction: null },
    publishedAt: ISSUED,
    publishedBy: PUBLISHER,
  };
}

/** A free localhost port for the wired server to bind. */
async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => {
    probe.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((resolve) => {
    probe.close(() => {
      resolve();
    });
  });
  return port;
}

/** A connected SDK client whose every HTTP request carries `headers`. */
async function connectedClient(port: number, headers: Record<string, string>): Promise<Client> {
  const client = new Client({ name: "server-cli-wiring-client", version: "0.0.0" }, { capabilities: {} });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${String(port)}/mcp`), { requestInit: { headers } }) as unknown as Transport,
  );
  return client;
}

/** The first text content of a call-tool answer, whatever shape the SDK returns. */
function textOf(answer: unknown): string {
  const content =
    typeof answer === "object" && answer !== null && "content" in answer ? (answer as { content?: unknown }).content : undefined;
  const text = Array.isArray(content) ? (content[0] as { text?: unknown } | undefined)?.text : undefined;
  if (typeof text !== "string") throw new Error("the tool answer carried no text content");
  return text;
}

describe.skipIf(dbAdminUrl === undefined || dbAdminUrl === "")("guidance server-cli: deployed Postgres wiring against PostgreSQL", () => {
  const database = `dh_service_guidance_server_test_${randomBytes(6).toString("hex")}`;
  let admin: pg.Client;
  let owner: pg.Client;
  let pool: pg.Pool;
  let dbUrl: string;
  let server: HttpServer;
  let hash: string;
  const logs: LogEvent[] = [];

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: dbAdminUrl });
    await admin.connect();
    await admin.query(`create database ${database}`);
    dbUrl = withDatabase(dbAdminUrl ?? "", database);
    owner = new pg.Client({ connectionString: dbUrl });
    await owner.connect();
    await migrate(owner);

    pool = createPool(dbUrl);
    const payload: StandardBundlePayload = {
      ...makeBundlePayload({ keyId: "guidance-server-test-key", sequence: 1, issuedAt: ISSUED }),
      frozen: false,
      standards: [libraryStandard(STD_REACT, "React"), libraryStandard(STD_QUETZAL, "QuetzalDistinctive")],
      tree: {
        rootId: ROOT,
        projects: [
          { id: ROOT, name: "Root", levelName: null, parentId: null, createdAt: ISSUED },
          { id: WEB, name: "Web", levelName: null, parentId: ROOT, createdAt: ISSUED },
        ],
        lockedRules: [],
      },
      applications: [{ id: APP, projectId: WEB, fromFlow: true, agentTool: null }],
      acceptedDeviations: [],
    };
    const signed = signPayload(payload, makeSigningKey("guidance-server-test-key"));
    hash = bundleHashOf(signed);
    await createPostgresBundleRecordStore(pool).activate(signed, hash, TENANT as UuidV7);

    const port = await freePort();
    server = createGuidanceHttpServer(
      { tenantId: TENANT as UuidV7, recordDatabaseUrl: dbUrl, readCredential: READ_CREDENTIAL, port },
      pool,
      (event) => {
        logs.push(event);
      },
    );
    await new Promise<void>((resolve) => {
      server.listen(port, "127.0.0.1", () => {
        resolve();
      });
    });
  }, 60_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
    await pool.end();
    await owner.end();
    await admin.query(`drop database if exists ${database} with (force)`);
    await admin.end();
  }, 60_000);

  it("records one bound hit durably in Postgres through the deployed wiring", async () => {
    const port = (server.address() as AddressInfo).port;
    const client = await connectedClient(port, BOUND_HEADERS);
    try {
      const text = textOf(await client.callTool({ name: "code_stack_rule", arguments: { subject: "react" } }));
      const result = JSON.parse(text) as GuidanceToolResult;
      expect(result.kind).toBe("hit");
      expect(text).toBe(canonicalJson(result));
    } finally {
      await client.close().catch(() => undefined);
    }
    const { rows } = await owner.query<Record<string, unknown>>(
      "select application_id, sequence, tool, subject, outcome, standard_id, standard_version, agent_tool, bundle_hash from guidance_events",
    );
    // An InMemory swap or dropped threading would leave Postgres empty.
    expect(rows).toHaveLength(1);
    const row = rows[0] as Record<string, unknown>;
    expect(row["application_id"]).toBe(APP);
    expect(Number(row["sequence"])).toBe(1);
    expect(row["tool"]).toBe("code_stack_rule");
    expect(row["subject"]).toBe("react");
    expect(row["outcome"]).toBe("hit");
    expect(row["standard_id"]).toBe(STD_REACT);
    expect(Number(row["standard_version"])).toBe(1);
    expect(row["agent_tool"]).toBeNull();
    expect(row["bundle_hash"]).toBe(hash);
    expect(logs.filter((line) => line["event"] === "guidance_record_error")).toEqual([]);
  });

  it("keeps the typed answer and logs an ids-only guidance_record_error when the record insert fails", async () => {
    await owner.query("drop table guidance_events");
    logs.length = 0;
    const distinctive = "quetzaldistinctive";
    const port = (server.address() as AddressInfo).port;
    const client = await connectedClient(port, BOUND_HEADERS);
    try {
      const text = textOf(await client.callTool({ name: "code_stack_rule", arguments: { subject: distinctive } }));
      const result = JSON.parse(text) as GuidanceToolResult;
      expect(result.kind).toBe("hit");
      expect(text).toBe(canonicalJson(result));
    } finally {
      await client.close().catch(() => undefined);
    }
    const recordLines = logs.filter((line) => line["event"] === "guidance_record_error");
    expect(recordLines).toHaveLength(1);
    expect(recordLines[0]).toEqual({
      event: "guidance_record_error",
      code: "record_failed",
      applicationId: APP,
      tool: "code_stack_rule",
    });
    expect(JSON.stringify(recordLines[0])).not.toContain("quetzal");
  });

  it("serves a credentialed Effective set read with the active hash quoted through the deployed wiring", async () => {
    const port = (server.address() as AddressInfo).port;
    const response = await fetch(`http://127.0.0.1:${String(port)}/v1/projects/${WEB}/effective-standards`, {
      headers: { authorization: `Bearer ${READ_CREDENTIAL}` },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { bundleHash?: unknown; project?: unknown; standards?: unknown };
    expect(body.bundleHash).toBe(hash);
    expect(body.project).toEqual({ id: WEB, name: "Web" });
    expect(Array.isArray(body.standards)).toBe(true);
    // A missing credential on the same path is 401, never the set.
    const denied = await fetch(`http://127.0.0.1:${String(port)}/v1/projects/${WEB}/effective-standards`);
    expect(denied.status).toBe(401);
    expect(await denied.json()).toEqual({ code: "session_invalid", message: "the service credential is not valid", subject: "session" });
  });
});
