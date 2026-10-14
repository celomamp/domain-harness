// Spawn-style suite for the daemon entry (Story 4.2): runs the CLI as a child
// process. (a) with a malformed trust set, exactly one parseable envelope on
// stderr, exit code 1 and nothing on stdout — no database needed; (b) against
// a real PostgreSQL 18 named by SERVICE_TEST_DATABASE_URL (an admin
// connection), in the db-suite harness style: a throwaway database, the daemon
// started, the first cycle log line awaited, both migrations asserted, then a
// SIGTERM and a prompt exit 0.
import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeSigningKey } from "./test-fixtures.ts";

const ENV = "SERVICE_TEST_DATABASE_URL";
const adminUrl = process.env[ENV];
const inCi = process.env["CI"] !== undefined && process.env["CI"] !== "" && process.env["CI"] !== "false";

const run = promisify(execFile);
const CLI_PATH = path.resolve(import.meta.dirname, "./service-cli.ts");
const TENANT = "018f3d2a-7000-7000-8000-000000000100";
const PEM = makeSigningKey("daemon-test-key").publicKeyPem;

function daemonEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    SERVICE_VENDOR_URL: "http://127.0.0.1:1", // never reachable: cycles pull a transport outcome
    SERVICE_TENANT_ID: TENANT,
    SERVICE_TENANT_CREDENTIAL: "daemon-test-credential",
    SERVICE_BUNDLE_TRUST_KEYS: JSON.stringify({ "daemon-test-key": PEM }),
    SERVICE_PULL_INTERVAL_MS: "200",
    ...overrides,
  };
}

describe("service-cli: malformed trust set at start", () => {
  it("prints exactly one parseable envelope on stderr, exits 1 and writes nothing to stdout", async () => {
    try {
      await run(process.execPath, [CLI_PATH], {
        env: daemonEnv({
          SERVICE_BUNDLE_TRUST_KEYS: "not json at all",
          SERVICE_RECORD_DATABASE_URL: "postgres://postgres:postgres@localhost/dh_never_used",
        }),
      });
      throw new Error("the daemon entry did not exit 1");
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
      expect(envelope.subject).toBe("SERVICE_BUNDLE_TRUST_KEYS");
      expect(typeof envelope.message === "string" && envelope.message.length > 0).toBe(true);
      expect(failure.stdout ?? "").toBe("");
    }
  }, 60_000);
});

if (adminUrl === undefined || adminUrl === "") {
  if (inCi) {
    describe("service-cli daemon suite", () => {
      it(`requires ${ENV} when CI is set`, () => {
        expect.fail(`${ENV} is not set; CI must run the service suite against PostgreSQL 18`);
      });
    });
  } else {
    process.stderr.write(`service-cli.test.ts daemon suite skipped: ${ENV} is not set\n`);
  }
}

function withDatabase(url: string, database: string): string {
  const next = new URL(url);
  next.pathname = `/${database}`;
  return next.toString();
}

describe.skipIf(adminUrl === undefined || adminUrl === "")("service-cli: start, cycle, SIGTERM against PostgreSQL", () => {
  const database = `dh_service_cli_test_${randomBytes(6).toString("hex")}`;
  let admin: pg.Client;
  let owner: pg.Client;
  let dbUrl: string;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`create database ${database}`);
    dbUrl = withDatabase(adminUrl ?? "", database);
    owner = new pg.Client({ connectionString: dbUrl });
    await owner.connect();
  }, 60_000);

  afterAll(async () => {
    await owner.end();
    await admin.query(`drop database if exists ${database} with (force)`);
    await admin.end();
  }, 60_000);

  it("starts, applies both migrations and exits promptly on SIGTERM", async () => {
    const child = spawn(process.execPath, [CLI_PATH], { env: daemonEnv({ SERVICE_RECORD_DATABASE_URL: dbUrl }) });
    child.stdout.setEncoding("utf8");
    let stdout = "";
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });

    const firstLine = await new Promise<string | null>((resolve, reject) => {
      const started = Date.now();
      const poll = setInterval(() => {
        const lines = stdout.split("\n").filter((line) => line.includes('"bundle_cycle"'));
        if (lines.length > 0) {
          clearInterval(poll);
          child.stdout.removeAllListeners();
          resolve(lines[0] ?? null);
        }
        if (Date.now() - started > 20_000) {
          clearInterval(poll);
          reject(new Error(`the daemon logged no cycle line within 20s; stdout=${stdout}`));
        }
      }, 50);
    });
    expect(firstLine).not.toBeNull();

    const ledger = await owner.query<{ name: string }>("select name from service_migrations order by name asc");
    expect(ledger.rows.map((row) => row.name)).toEqual([
      "0001_ci_gate.sql",
      "0002_standard_bundles.sql",
      "0003_guidance_identity.sql",
    ]);
    const tables = await owner.query<{ to_regclass: string | null }>(
      "select to_regclass('public.service_bundles')::text as to_regclass",
    );
    expect(tables.rows[0]?.to_regclass).toBe("service_bundles");

    // SIGTERM must end the pending sleep and exit before SIGKILL would.
    const startedAt = Date.now();
    child.kill("SIGTERM");
    const exitCode = await new Promise<number | null>((resolve) => {
      child.on("exit", (code) => {
        resolve(code);
      });
    });
    expect(exitCode).toBe(0);
    expect(Date.now() - startedAt).toBeLessThan(5_000);
  }, 60_000);
});
