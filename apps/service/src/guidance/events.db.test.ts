/**
 * Database suite for the Guidance event store (Story 4.5): runs against a
 * real PostgreSQL 18 named by SERVICE_TEST_DATABASE_URL (an admin
 * connection), in the 4.3 harness style: a throwaway database migrated with
 * apps/service/migrations, then the Postgres twin exercised — migration
 * report including 0004, per-Application sequences, hit/miss persistence,
 * the gaps (miss) projection, and concurrent-append serialization.
 */
import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isGuidanceEvent, isStandardBundlePayload } from "@domain-harness/contract";
import type { GuidanceEvent, UuidV7 } from "@domain-harness/contract";
import { migrate } from "../db/migrate.ts";
import { createPool } from "../ci-gate/store.ts";
import { createPostgresGuidanceEventStore } from "./events.ts";
import type { GuidanceEventStore } from "./events.ts";
import { makeBundlePayload } from "../bundles/test-fixtures.ts";

const ENV = "SERVICE_TEST_DATABASE_URL";
const adminUrl = process.env[ENV];
const inCi = process.env["CI"] !== undefined && process.env["CI"] !== "" && process.env["CI"] !== "false";

if (adminUrl === undefined || adminUrl === "") {
  if (inCi) {
    describe("service guidance events database suite", () => {
      it(`requires ${ENV} when CI is set`, () => {
        expect.fail(`${ENV} is not set; CI must run the service database suite against PostgreSQL 18`);
      });
    });
  } else {
    process.stderr.write(`events.db.test.ts skipped: ${ENV} is not set\n`);
  }
}

function withDatabase(url: string, database: string): string {
  const next = new URL(url);
  next.pathname = `/${database}`;
  return next.toString();
}

describe.skipIf(adminUrl === undefined || adminUrl === "")("PostgresGuidanceEventStore against PostgreSQL", () => {
  const database = `dh_service_guidance_events_test_${randomBytes(6).toString("hex")}`;
  let admin: pg.Client;
  let owner: pg.Client;
  let pool: pg.Pool;
  let store: GuidanceEventStore;

  const appA = "018f3d2a-7000-7000-8000-000000000001" as UuidV7;
  const appB = "018f3d2a-7000-7000-8000-000000000002" as UuidV7;
  const HASH = "a".repeat(64);

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`create database ${database}`);

    const dbUrl = withDatabase(adminUrl ?? "", database);
    owner = new pg.Client({ connectionString: dbUrl });
    await owner.connect();

    const report = await migrate(owner);
    expect(report).toEqual({
      applied: ["0001_ci_gate.sql", "0002_standard_bundles.sql", "0003_guidance_identity.sql", "0004_guidance_events.sql", "0005_collector_outbox.sql"],
      alreadyApplied: 0,
    });
    expect(await migrate(owner)).toEqual({ applied: [], alreadyApplied: 5 });

    pool = createPool(dbUrl);
    store = createPostgresGuidanceEventStore(pool);
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await owner.end();
    await admin.query(`drop database if exists ${database} with (force)`);
    await admin.end();
  }, 60_000);

  it("creates the append-only guidance_events table with no prompt-text column", async () => {
    const { rows } = await owner.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_type = 'BASE TABLE'
       order by table_name asc`,
    );
    expect(rows.map((r) => r.table_name)).toContain("guidance_events");
    const columns = await owner.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'guidance_events' order by ordinal_position asc`,
    );
    expect(columns.rows.map((r) => r.column_name)).toEqual([
      "id",
      "application_id",
      "sequence",
      "tool",
      "subject",
      "outcome",
      "standard_id",
      "standard_version",
      "agent_tool",
      "bundle_hash",
      "created_at",
    ]);
    // Privacy (NFR-9): no prompt-text column exists anywhere.
    for (const name of columns.rows.map((r) => r.column_name)) {
      expect(name).not.toMatch(/prompt/i);
    }
  });

  it("assigns per-Application sequences: A (2 rows) then B (0 rows) yields A=3, B=1", async () => {
    const first = await store.appendGuidanceEvent({
      applicationId: appA,
      tool: "code_stack_rule",
      subject: "react",
      outcome: { kind: "hit", standardId: "018f3d2a-7000-7000-8000-000000000010", version: 2 },
      agentTool: null,
      bundleHash: HASH,
    });
    const second = await store.appendGuidanceEvent({
      applicationId: appA,
      tool: "design_token",
      subject: "AccentBorder",
      outcome: { kind: "miss" },
      agentTool: "claude-code",
      bundleHash: HASH,
    });
    expect(first.sequence).toBe(1);
    expect(second.sequence).toBe(2);

    const nextA = await store.appendGuidanceEvent({
      applicationId: appA,
      tool: "design_import",
      subject: "~/company/button",
      outcome: { kind: "miss" },
      agentTool: null,
      bundleHash: HASH,
    });
    const firstB = await store.appendGuidanceEvent({
      applicationId: appB,
      tool: "code_stack_rule",
      subject: "react",
      outcome: { kind: "miss" },
      agentTool: null,
      bundleHash: HASH,
    });
    expect(nextA.sequence).toBe(3);
    expect(firstB.sequence).toBe(1);
  });

  it("persists hit/miss shapes with every recorded field and lists them back guarded", async () => {
    const events = await store.listGuidanceEvents(appA);
    expect(events.length).toBeGreaterThanOrEqual(3);
    for (const event of events) {
      expect(isGuidanceEvent(event)).toBe(true);
    }
    const hit = events.find((event) => event.outcome.kind === "hit") as GuidanceEvent;
    expect(hit).toMatchObject({
      applicationId: appA,
      tool: "code_stack_rule",
      subject: "react",
      outcome: { kind: "hit", version: 2 },
      bundleHash: HASH,
    });
    expect(typeof hit.id).toBe("string");
    expect(typeof hit.createdAt).toBe("string");
    expect(await store.countGuidanceEvents(appA)).toBe(events.length);
  });

  it("projects gaps as misses only, with no second write", async () => {
    const gaps = await store.listGuidanceGaps(appA);
    expect(gaps.length).toBeGreaterThanOrEqual(1);
    for (const gap of gaps) {
      expect(gap.outcome).toEqual({ kind: "miss" });
      expect(isGuidanceEvent(gap)).toBe(true);
    }
    const events = await store.listGuidanceEvents(appA);
    // The gap list is exactly the miss subset of the one table.
    expect(gaps.map((gap) => gap.id).sort()).toEqual(
      events.filter((event) => event.outcome.kind === "miss").map((event) => event.id).sort(),
    );
  });

  it("serializes N parallel bound appends to distinct sequences with no duplicates", async () => {
    const racingApp = "018f3d2a-7000-7000-8000-000000000009" as UuidV7;
    const N = 10;
    const appended = await Promise.all(
      Array.from({ length: N }, (_unused, index) =>
        store.appendGuidanceEvent({
          applicationId: racingApp,
          tool: "code_stack_rule",
          subject: `subject-${String(index)}`,
          outcome: { kind: "miss" },
          agentTool: null,
          bundleHash: HASH,
        }),
      ),
    );
    const sequences = appended.map((event) => event.sequence).sort((a, b) => a - b);
    expect(sequences).toEqual(Array.from({ length: N }, (_unused, index) => index + 1));
    expect(await store.countGuidanceEvents(racingApp)).toBe(N);
  });

  it("needs no store change for pre-4.5 payloads: a missing agentTool key still guards valid and records null", async () => {
    const oldShape: Record<string, unknown> = { id: appA, projectId: "018f3d2a-7000-7000-8000-000000000112", fromFlow: true };
    const payload = {
      ...makeBundlePayload({ keyId: "events-db-key", sequence: 1, issuedAt: "2026-10-14T12:00:00.000Z" }),
      applications: [oldShape],
    };
    expect(isStandardBundlePayload(payload)).toBe(true);
    const recorded = await store.appendGuidanceEvent({
      applicationId: appA,
      tool: "code_stack_rule",
      subject: "react",
      outcome: { kind: "miss" },
      agentTool: null,
      bundleHash: HASH,
    });
    expect(recorded.agentTool).toBeNull();
    expect(isGuidanceEvent(recorded)).toBe(true);
  });
});
