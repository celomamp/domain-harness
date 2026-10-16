// Database suite for the service CI Gate record store: runs against a real
// PostgreSQL 18 named by SERVICE_TEST_DATABASE_URL (an admin connection).
// Creates a throwaway database, migrates it with apps/service/migrations
// (0001–0003) and exercises the Postgres store implementation.
import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isUuidV7 } from "@domain-harness/contract";
import type { Deviation, UuidV7 } from "@domain-harness/contract";
import { migrate } from "../db/migrate.ts";
import { mintUuidV7 } from "./ids.ts";
import { createPool, createPostgresGateRecordStore, migratePostgres } from "./store.ts";
import type { GateRecordStore } from "./store.ts";

const ENV = "SERVICE_TEST_DATABASE_URL";
const adminUrl = process.env[ENV];
const inCi = process.env["CI"] !== undefined && process.env["CI"] !== "" && process.env["CI"] !== "false";

if (adminUrl === undefined || adminUrl === "") {
  if (inCi) {
    describe("service CI Gate database suite", () => {
      it(`requires ${ENV} when CI is set`, () => {
        expect.fail(`${ENV} is not set; CI must run the service database suite against PostgreSQL 18`);
      });
    });
  } else {
    process.stderr.write(`store.postgres.test.ts skipped: ${ENV} is not set\n`);
  }
}

function withDatabase(url: string, database: string): string {
  const next = new URL(url);
  next.pathname = `/${database}`;
  return next.toString();
}

describe.skipIf(adminUrl === undefined || adminUrl === "")("PostgresGateRecordStore against PostgreSQL", () => {
  const database = `dh_service_test_${randomBytes(6).toString("hex")}`;
  let admin: pg.Client;
  let owner: pg.Client;
  let pool: pg.Pool;
  let store: GateRecordStore;

  const appA = "018f3d2a-7000-7000-8000-000000000001" as UuidV7;
  const appB = "018f3d2a-7000-7000-8000-000000000002" as UuidV7;
  const standardId = "018f3d2a-7000-7000-8000-000000000010" as UuidV7;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`create database ${database}`);

    const dbUrl = withDatabase(adminUrl ?? "", database);
    owner = new pg.Client({ connectionString: dbUrl });
    await owner.connect();

    const firstReport = await migrate(owner);
    expect(firstReport).toEqual({ applied: ["0001_ci_gate.sql", "0002_standard_bundles.sql", "0003_guidance_identity.sql", "0004_guidance_events.sql", "0005_guidance_events_retention_idx.sql"], alreadyApplied: 0 });

    pool = createPool(dbUrl);
    store = createPostgresGateRecordStore(pool);
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await owner.end();
    await admin.query(`drop database if exists ${database} with (force)`);
    await admin.end();
  }, 60_000);

  it("creates the gate tables, the bundle tables and the service_migrations ledger", async () => {
    const { rows } = await owner.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_type = 'BASE TABLE'
       order by table_name asc`,
    );
    expect(rows.map((r) => r.table_name)).toEqual([
      "active_bundle_pointers",
      "application_bindings",
      "binding_refusals",
      "bundle_refusals",
      "bundle_staleness_observations",
      "gate_runs",
      "guidance_events",
      "guidance_project_mismatches",
      "service_bundles",
      "service_migrations",
    ]);

    const reg = await owner.query<{
      bindings: string | null;
      refusals: string | null;
      runs: string | null;
      bundles: string | null;
      pointers: string | null;
    }>(
      `select to_regclass('public.application_bindings')::text as bindings,
              to_regclass('public.binding_refusals')::text as refusals,
              to_regclass('public.gate_runs')::text as runs,
              to_regclass('public.service_bundles')::text as bundles,
              to_regclass('public.active_bundle_pointers')::text as pointers`,
    );
    expect(reg.rows[0]).toEqual({
      bindings: "application_bindings",
      refusals: "binding_refusals",
      runs: "gate_runs",
      bundles: "service_bundles",
      pointers: "active_bundle_pointers",
    });
  });

  it("migrate and migratePostgres are idempotent once 0001, 0002, 0003 and 0004 are applied", async () => {
    expect(await migrate(owner)).toEqual({ applied: [], alreadyApplied: 5 });
    expect(await migratePostgres(owner)).toEqual({ applied: [], alreadyApplied: 5 });
  });

  it("enforces TOFU on application_bindings: first bind persists, subsequent bind with a different fingerprint keeps the original", async () => {
    const freshAppId = mintUuidV7();
    const fp1 = "1".repeat(64);
    const fp2 = "2".repeat(64);

    expect(await store.getBinding(freshAppId)).toBeNull();

    const first = await store.bindApplication(freshAppId, fp1);
    expect(first.applicationId).toBe(freshAppId);
    expect(first.fingerprint).toBe(fp1);

    const second = await store.bindApplication(freshAppId, fp2);
    expect(second.applicationId).toBe(freshAppId);
    expect(second.fingerprint).toBe(fp1);

    const stored = await store.getBinding(freshAppId);
    expect(stored).not.toBeNull();
    expect(stored?.applicationId).toBe(freshAppId);
    expect(stored?.fingerprint).toBe(fp1);
  });

  it("assigns monotonic per-Application sequences starting at 1 and round-trips all gate-run fields including jsonb deviations", async () => {
    const deviation: Deviation = {
      standardId,
      standardVersion: 2,
      slot: { moduleKind: "code-stack", slotKind: "library", name: "lodash" },
      subject: "lodash",
      kind: "prohibited",
      status: "open",
      correction: `The Standard ${standardId} prohibits lodash; use the approved library remeda instead.`,
    };

    const runA1 = await store.appendGateRun({
      applicationId: appA,
      revision: "aaaa1111",
      bundleHash: "sha256:bundle-1",
      extractorVersion: "1.0.0",
      checked: 3,
      open: 1,
      adherence: 2 / 3,
      deviations: [deviation],
    });

    const runA2 = await store.appendGateRun({
      applicationId: appA,
      revision: "aaaa2222",
      bundleHash: "sha256:bundle-2",
      extractorVersion: "1.0.0",
      checked: 3,
      open: 0,
      adherence: 1,
      deviations: [],
    });

    const runB1 = await store.appendGateRun({
      applicationId: appB,
      revision: "bbbb1111",
      bundleHash: "sha256:bundle-1",
      extractorVersion: "1.0.0",
      checked: 1,
      open: 0,
      adherence: 1,
      deviations: [],
    });

    expect(isUuidV7(runA1.id)).toBe(true);
    expect(isUuidV7(runA2.id)).toBe(true);
    expect(isUuidV7(runB1.id)).toBe(true);
    expect(runA1.sequence).toBe(1);
    expect(runA2.sequence).toBe(2);
    expect(runB1.sequence).toBe(1);

    const listedA = await store.listGateRuns(appA);
    expect(listedA).toHaveLength(2);
    expect(listedA.map((r) => r.sequence)).toEqual([1, 2]);
    expect(listedA[0]).toMatchObject({
      id: runA1.id,
      sequence: 1,
      applicationId: appA,
      revision: "aaaa1111",
      bundleHash: "sha256:bundle-1",
      extractorVersion: "1.0.0",
      checked: 3,
      open: 1,
      adherence: 2 / 3,
      deviations: [deviation],
    });
    expect(listedA[1]).toMatchObject({
      id: runA2.id,
      sequence: 2,
      applicationId: appA,
      revision: "aaaa2222",
      bundleHash: "sha256:bundle-2",
      extractorVersion: "1.0.0",
      checked: 3,
      open: 0,
      adherence: 1,
      deviations: [],
    });

    const listedB = await store.listGateRuns(appB);
    expect(listedB).toHaveLength(1);
    expect(listedB[0]?.sequence).toBe(1);
  });

  it("keeps gate_runs append-only and enforces unique(application_id, sequence) at the database level", async () => {
    const before = await store.listGateRuns(appA);
    expect(before).toHaveLength(2);

    await expect(
      owner.query(
        `insert into gate_runs
          (id, application_id, sequence, revision, bundle_hash, extractor_version, checked_count, open_count, adherence, deviations)
         values ($1, $2, 1, 'conflict', 'sha256:x', '1.0.0', 1, 0, 1, '[]'::jsonb)`,
        [mintUuidV7(), appA],
      ),
    ).rejects.toThrow();

    const after = await store.listGateRuns(appA);
    expect(after).toEqual(before);
  });

  it("records and lists binding refusals with presented and bound fingerprints", async () => {
    const recorded = await store.recordBindingRefusal({
      applicationId: appA,
      presentedFingerprint: "f".repeat(64),
      boundFingerprint: "0".repeat(64),
    });
    expect(isUuidV7(recorded.id)).toBe(true);

    const refusals = await store.listBindingRefusals(appA);
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatchObject({
      id: recorded.id,
      applicationId: appA,
      presentedFingerprint: "f".repeat(64),
      boundFingerprint: "0".repeat(64),
    });
  });
});
