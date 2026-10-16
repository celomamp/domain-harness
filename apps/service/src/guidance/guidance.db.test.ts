/**
 * Database suite for the Guidance identity store (Story 4.3): runs against a
 * real PostgreSQL 18 named by SERVICE_TEST_DATABASE_URL (an admin
 * connection), in the 4.2 harness style: a throwaway database migrated with
 * apps/service/migrations, then the Postgres twin exercised — migration
 * report including 0003, the shared binding tables, refusal rows the Gate
 * store also sees, the mismatch ledger, and the two-replica race on the
 * first bind.
 */
import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UuidV7 } from "@domain-harness/contract";
import { DUPLICATE_APPLICATION_ID } from "@domain-harness/gate";
import { migrate } from "../db/migrate.ts";
import { createPool, createPostgresGateRecordStore } from "../ci-gate/store.ts";
import { createPostgresGuidanceIdentityStore } from "./store.ts";
import type { GuidanceIdentityStore } from "./store.ts";
import { resolveGuidanceIdentity } from "./identity.ts";
import { makeBundlePayload } from "../bundles/test-fixtures.ts";

const ENV = "SERVICE_TEST_DATABASE_URL";
const adminUrl = process.env[ENV];
const inCi = process.env["CI"] !== undefined && process.env["CI"] !== "" && process.env["CI"] !== "false";

if (adminUrl === undefined || adminUrl === "") {
  if (inCi) {
    describe("service guidance identity database suite", () => {
      it(`requires ${ENV} when CI is set`, () => {
        expect.fail(`${ENV} is not set; CI must run the service database suite against PostgreSQL 18`);
      });
    });
  } else {
    process.stderr.write(`guidance.db.test.ts skipped: ${ENV} is not set\n`);
  }
}

function withDatabase(url: string, database: string): string {
  const next = new URL(url);
  next.pathname = `/${database}`;
  return next.toString();
}

describe.skipIf(adminUrl === undefined || adminUrl === "")("PostgresGuidanceIdentityStore against PostgreSQL", () => {
  const database = `dh_service_guidance_test_${randomBytes(6).toString("hex")}`;
  let admin: pg.Client;
  let owner: pg.Client;
  let pool: pg.Pool;
  let store: GuidanceIdentityStore;

  const appA = "018f3d2a-7000-7000-8000-000000000001" as UuidV7;
  const TENANT = "018f3d2a-7000-7000-8000-000000000100" as UuidV7;
  const BUNDLE_PROJECT_ID = "018f3d2a-7000-7000-8000-000000000002" as UuidV7;

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
    store = createPostgresGuidanceIdentityStore(pool);
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await owner.end();
    await admin.query(`drop database if exists ${database} with (force)`);
    await admin.end();
  }, 60_000);

  it("adds the mismatch table beside the gate, bundle and collector outbox tables", async () => {
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
      "collector_outbox",
      "collector_sequences",
      "gate_runs",
      "guidance_events",
      "guidance_project_mismatches",
      "service_bundles",
      "service_migrations",
    ]);
    const mismatchColumns = await owner.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'guidance_project_mismatches' order by ordinal_position asc`,
    );
    expect(mismatchColumns.rows.map((r) => r.column_name)).toEqual([
      "id",
      "application_id",
      "presented_project_id",
      "bundle_project_id",
      "bundle_hash",
      "created_at",
    ]);
  });

  it("binds trust on first use in the shared application_bindings table and keeps the first fingerprint", async () => {
    expect(await store.getBinding(appA)).toBeNull();

    const first = await store.bindApplication(appA, "1".repeat(64));
    expect(first.applicationId).toBe(appA);
    expect(first.fingerprint).toBe("1".repeat(64));

    const rebind = await store.bindApplication(appA, "2".repeat(64));
    expect(rebind.fingerprint).toBe("1".repeat(64));
    const binding = await store.getBinding(appA);
    expect(binding).toEqual({
      applicationId: appA,
      fingerprint: "1".repeat(64),
      createdAt: expect.any(String) as string,
    });
  });

  it("writes binding refusals to the SHARED binding_refusals table the Gate store also reads", async () => {
    const gate = createPostgresGateRecordStore(pool);
    expect(await gate.listBindingRefusals()).toEqual([]);

    const refusal = await store.recordBindingRefusal({
      applicationId: appA,
      presentedFingerprint: "f".repeat(64),
      boundFingerprint: "0".repeat(64),
    });
    expect(refusal).toMatchObject({
      applicationId: appA,
      presentedFingerprint: "f".repeat(64),
      boundFingerprint: "0".repeat(64),
    });

    // The Gate's store sees the Guidance unit's refusal row.
    const seenByGate = await gate.listBindingRefusals(appA);
    expect(seenByGate).toHaveLength(1);
    expect(seenByGate[0]).toMatchObject({
      applicationId: appA,
      presentedFingerprint: "f".repeat(64),
      boundFingerprint: "0".repeat(64),
    });
    expect(await store.listBindingRefusals(appA)).toEqual(seenByGate);
  });

  it("records and lists advisory Project mismatches append-only", async () => {
    expect(await store.listProjectMismatches()).toEqual([]);
    const recorded = await store.recordProjectMismatch({
      applicationId: appA,
      presentedProjectId: "018f3d2a-7000-7000-8000-000000000003",
      bundleProjectId: "018f3d2a-7000-7000-8000-000000000002",
      bundleHash: "a".repeat(64),
    });
    expect(await store.listProjectMismatches(appA)).toEqual([recorded]);
    expect(recorded).toMatchObject({
      applicationId: appA,
      presentedProjectId: "018f3d2a-7000-7000-8000-000000000003",
      bundleProjectId: "018f3d2a-7000-7000-8000-000000000002",
      bundleHash: "a".repeat(64),
    });
  });

  it("resolves the two-replica race on the first bind: one surviving binding row, the loser refused", async () => {
    const racingApp = "018f3d2a-7000-7000-8000-000000000005" as UuidV7;
    const replicaPool = createPool(withDatabase(adminUrl ?? "", database));
    try {
      const replica: GuidanceIdentityStore = createPostgresGuidanceIdentityStore(replicaPool);
      const fp1 = "1".repeat(64);
      const fp2 = "2".repeat(64);
      const [first, second] = await Promise.all([
        store.bindApplication(racingApp, fp1),
        replica.bindApplication(racingApp, fp2),
      ]);
      // Insert-once with re-read: both callers observe the one surviving
      // row, whichever insert landed first.
      expect(second.fingerprint).toBe(first.fingerprint);
      const surviving = await store.getBinding(racingApp);
      expect([fp1, fp2]).toContain(surviving?.fingerprint);
      expect(await store.getBinding(racingApp)).toEqual(await replica.getBinding(racingApp));

      const { rows } = await owner.query<{ count: string }>(
        "select count(*)::text as count from application_bindings where application_id = $1",
        [racingApp],
      );
      expect(rows[0]?.count).toBe("1");
    } finally {
      await replicaPool.end();
    }
  });

  it("answers two concurrent first calls with different fingerprints exactly once bound (the first presented) once refused", async () => {
    const racingApp = "018f3d2a-7000-7000-8000-000000000007" as UuidV7;
    const bundleHash = "a".repeat(64);
    const bundle = {
      payload: {
        ...makeBundlePayload({ keyId: "identity-db-key", sequence: 1, issuedAt: "2026-10-14T12:00:00.000Z" }),
        applications: [{ id: racingApp, projectId: BUNDLE_PROJECT_ID, fromFlow: false, agentTool: null }],
      },
      hash: bundleHash,
    };
    const getPinnedBundle = () => Promise.resolve(bundle);

    const replicaPool = createPool(withDatabase(adminUrl ?? "", database));
    try {
      const replica: GuidanceIdentityStore = createPostgresGuidanceIdentityStore(replicaPool);
      const [first, second] = await Promise.all([
        resolveGuidanceIdentity({ headers: { applicationId: racingApp, advisoryProjectId: BUNDLE_PROJECT_ID, repoFingerprint: "1".repeat(64) }, tenantId: TENANT, store, getPinnedBundle }),
        resolveGuidanceIdentity({ headers: { applicationId: racingApp, advisoryProjectId: BUNDLE_PROJECT_ID, repoFingerprint: "2".repeat(64) }, tenantId: TENANT, store: replica, getPinnedBundle }),
      ]);
      // Whichever insert lands first binds; the other presents differently and is refused.
      const outcomes = [first, second];
      const winner = outcomes.find((outcome) => outcome.kind === "bound") as Extract<(typeof outcomes)[number], { kind: "bound" }>;
      const loser = outcomes.find((outcome) => outcome.kind === "refused") as Extract<(typeof outcomes)[number], { kind: "refused" }>;
      expect(winner.projectId).toBe(BUNDLE_PROJECT_ID);
      expect(winner.bundleHash).toBe(bundleHash);
      expect(winner.advisoryMismatch).toBeNull();
      expect(loser.sentence).toBe(DUPLICATE_APPLICATION_ID);
      const binding = await store.getBinding(racingApp);
      expect(binding?.fingerprint).toBe(loser.boundFingerprint);
      expect(await store.listBindingRefusals(racingApp)).toHaveLength(1);
    } finally {
      await replicaPool.end();
    }
  });
});
