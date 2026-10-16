// Database suite for the Standard bundle record store (Story 4.2): runs
// against a real PostgreSQL 18 named by SERVICE_TEST_DATABASE_URL (an admin
// connection), in the CI Gate store's harness style: a throwaway database,
// migrated with apps/service/migrations, then the Postgres bundle record
// store exercised — migration report, pointer semantics, refusal rows,
// two-replica concurrent activation and staleness observations.
import { createHash, randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { canonicalJson } from "@domain-harness/contract";
import { migrate } from "../db/migrate.ts";
import { createPool, createPostgresBundleRecordStore } from "./store.ts";
import type { BundleRecordStore, BundleRefusalInput } from "./store.ts";
import { bundleHashOf } from "./verify.ts";
import {
  makeBundlePayload,
  makeSigningKey,
  signPayload,
  TEST_TENANT_ID,
  OTHER_TENANT_ID,
} from "./test-fixtures.ts";

const ENV = "SERVICE_TEST_DATABASE_URL";
const adminUrl = process.env[ENV];
const inCi = process.env["CI"] !== undefined && process.env["CI"] !== "" && process.env["CI"] !== "false";

if (adminUrl === undefined || adminUrl === "") {
  if (inCi) {
    describe("service bundles database suite", () => {
      it(`requires ${ENV} when CI is set`, () => {
        expect.fail(`${ENV} is not set; CI must run the service database suite against PostgreSQL 18`);
      });
    });
  } else {
    process.stderr.write(`bundles.db.test.ts skipped: ${ENV} is not set\n`);
  }
}

function withDatabase(url: string, database: string): string {
  const next = new URL(url);
  next.pathname = `/${database}`;
  return next.toString();
}

describe.skipIf(adminUrl === undefined || adminUrl === "")("PostgresBundleRecordStore against PostgreSQL", () => {
  const database = `dh_service_bundles_test_${randomBytes(6).toString("hex")}`;
  let admin: pg.Client;
  let owner: pg.Client;
  let pool: pg.Pool;
  let store: BundleRecordStore;

  const tenant = TEST_TENANT_ID;
  const signer = makeSigningKey("key-1");
  const T0 = Date.parse("2026-10-14T12:00:00.000Z");

  const bundleAt = (sequence: number, issuedMs = T0): ReturnType<typeof signPayload> =>
    signPayload(makeBundlePayload({ keyId: signer.keyId, sequence, issuedAt: new Date(issuedMs).toISOString() }), signer);

  function refusalOf(reason: BundleRefusalInput["reason"], overrides: Partial<BundleRefusalInput> = {}): BundleRefusalInput {
    return {
      tenantId: tenant,
      reason,
      sequence: 1,
      hash: "0".repeat(64),
      detail: "test refusal",
      ...overrides,
    };
  }

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
    store = createPostgresBundleRecordStore(pool);
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await owner.end();
    await admin.query(`drop database if exists ${database} with (force)`);
    await admin.end();
  }, 60_000);

  it("creates the four bundle tables beside the gate tables, the guidance mismatch table and the collector outbox", async () => {
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
    // Append-only ledger columns carry the recorded verdict's identity.
    const refusalColumns = await owner.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'bundle_refusals' order by ordinal_position asc`,
    );
    expect(refusalColumns.rows.map((r) => r.column_name)).toEqual([
      "id",
      "tenant_id",
      "reason",
      "sequence",
      "hash",
      "detail",
      "created_at",
    ]);
  });

  it("activates a verified bundle the first time: one hash-keyed row and one pointer", async () => {
    expect(await store.getPointer(tenant)).toBeNull();
    const first = bundleAt(1);
    const firstHash = bundleHashOf(first);

    const activation = await store.activate(first, firstHash, tenant);
    expect(activation).toEqual({ ok: true, activated: true, pointer: { hash: firstHash, sequence: 1 } });
    expect(await store.getPointer(tenant)).toEqual({ hash: firstHash, sequence: 1 });
    expect(await store.pinnedBundle(firstHash)).toEqual(first);

    const { rows: pointerRows } = await owner.query<{ count: string }>(
      "select count(*)::text as count from active_bundle_pointers where tenant_id = $1",
      [tenant],
    );
    expect(pointerRows[0]?.count).toBe("1");
    const { rows: bundleRows } = await owner.query<{ count: string }>(
      "select count(*)::text as count from service_bundles",
    );
    expect(bundleRows[0]?.count).toBe("1");
  });

  it("resolves the same hash the pinned 4.1 rule derives from the stored bytes", async () => {
    const pointer = await store.getPointer(tenant);
    expect(pointer).not.toBeNull();
    const pinned = await store.pinnedBundle(pointer?.hash ?? "");
    expect(pinned).not.toBeNull();
    const recomputed = createHash("sha256")
      .update(Buffer.from(canonicalJson(pinned), "utf8"))
      .digest("hex");
    expect(recomputed).toBe(pointer?.hash);
  });

  it("swaps the pointer to a newer bundle in one transaction and keeps the old bundle row", async () => {
    const pointer = await store.getPointer(tenant);
    const firstHash = pointer?.hash ?? "";
    const second = bundleAt(2, T0 + 60_000);
    const secondHash = bundleHashOf(second);

    const activation = await store.activate(second, secondHash, tenant);
    expect(activation).toEqual({ ok: true, activated: true, pointer: { hash: secondHash, sequence: 2 } });
    expect(await store.getPointer(tenant)).toEqual({ hash: secondHash, sequence: 2 });
    expect(await store.pinnedBundle(firstHash)).not.toBeNull();

    const { rows: bundleRows } = await owner.query<{ count: string }>(
      "select count(*)::text as count from service_bundles",
    );
    expect(bundleRows[0]?.count).toBe("2");
  });

  it("is a no-op for an equal-sequence re-pull of identical bytes (no second bundle row, no refusal)", async () => {
    const pointerBefore = await store.getPointer(tenant);
    const { rows: bundleRowsBeforeQuery } = await owner.query<{ count: string }>("select count(*)::text as count from service_bundles");
    const before = bundleRowsBeforeQuery[0]?.count;

    const same = bundleAt(2, T0 + 60_000);
    const sameHash = bundleHashOf(same);
    const activation = await store.activate(same, sameHash, tenant);
    expect(activation).toEqual({ ok: true, activated: false, pointer: pointerBefore });

    const { rows: bundleRowsAfterQuery } = await owner.query<{ count: string }>("select count(*)::text as count from service_bundles");
    expect(bundleRowsAfterQuery[0]?.count).toBe(before);
    expect(await store.getPointer(tenant)).toEqual(pointerBefore);
    expect(await store.listRefusals()).toEqual([]);
  });

  it("refuses an equal-sequence activation of different bytes without inserting or swapping", async () => {
    const pointerBefore = await store.getPointer(tenant);
    const couple = bundleAt(2, T0 + 120_000);
    const coupleHash = bundleHashOf(couple);
    expect(coupleHash).not.toBe(pointerBefore?.hash);

    const activation = await store.activate(couple, coupleHash, tenant);
    expect(activation).toEqual({ ok: false, reason: "hash_mismatch", pointer: pointerBefore });
    expect(await store.getPointer(tenant)).toEqual(pointerBefore);
    expect(await store.pinnedBundle(coupleHash)).toBeNull();
  });

  it("refuses a lower sequence with the pointer unchanged (sequence-guard monotonicity)", async () => {
    const pointerBefore = await store.getPointer(tenant);
    const lower = bundleAt(1, T0 - 60_000);
    const lowerHash = bundleHashOf(lower);

    const activation = await store.activate(lower, lowerHash, tenant);
    expect(activation).toEqual({ ok: false, reason: "stale_sequence", pointer: pointerBefore });
    expect(await store.getPointer(tenant)).toEqual(pointerBefore);
    expect(await store.pinnedBundle(lowerHash)).toBeNull();

    const newer = bundleAt(3, T0 + 120_000);
    const newerHash = bundleHashOf(newer);
    expect(await store.activate(newer, newerHash, tenant)).toEqual({
      ok: true,
      activated: true,
      pointer: { hash: newerHash, sequence: 3 },
    });
  });

  it("persists and lists refusal rows append-only", async () => {
    const recorded: string[] = [];
    for (const input of [
      refusalOf("shape", { sequence: null, hash: null, detail: "the received body is not a bundle" }),
      refusalOf("unknown_key", { detail: "key id absent from the trust set" }),
      refusalOf("signature_failed"),
      refusalOf("tenant_mismatch", { hash: null }),
      refusalOf("hash_mismatch"),
      refusalOf("stale_sequence", { sequence: 0, hash: null, detail: "lower sequence" }),
      refusalOf("hash_mismatch", { tenantId: OTHER_TENANT_ID, detail: "other tenant" }),
    ]) {
      const row = await store.recordRefusal(input);
      recorded.push(row.id);
      expect(row.reason).toBe(input.reason);
      expect(row.sequence).toBe(input.sequence);
      expect(row.hash).toBe(input.hash);
      expect(row.detail).toBe(input.detail);
    }
    expect(recorded).toHaveLength(7);

    const listed = await store.listRefusals(tenant);
    expect(listed).toHaveLength(6);
    expect(listed.map((r) => r.reason)).toEqual([
      "shape",
      "unknown_key",
      "signature_failed",
      "tenant_mismatch",
      "hash_mismatch",
      "stale_sequence",
    ]);
    expect(listed[0]).toMatchObject({ sequence: null, hash: null, detail: "the received body is not a bundle" });
    expect((await store.listRefusals(OTHER_TENANT_ID)).map((r) => r.reason)).toEqual(["hash_mismatch"]);
  });

  it("activates one newer bundle concurrently from two replicas and both report the same active hash", async () => {
    const replicaPool = createPool(withDatabase(adminUrl ?? "", database));
    try {
      const replica: BundleRecordStore = createPostgresBundleRecordStore(replicaPool);
      const winner = bundleAt(4, T0 + 180_000);
      const winnerHash = bundleHashOf(winner);

      const [first, second] = await Promise.all([
        store.activate(winner, winnerHash, tenant),
        replica.activate(winner, winnerHash, tenant),
      ]);
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      if (first.ok && second.ok) {
        expect(first.pointer).toEqual({ hash: winnerHash, sequence: 4 });
        expect(second.pointer).toEqual({ hash: winnerHash, sequence: 4 });
      }
      expect(await replica.getPointer(tenant)).toEqual({ hash: winnerHash, sequence: 4 });
      expect(await store.getPointer(tenant)).toEqual(await replica.getPointer(tenant));

      const { rows: pointerRows } = await owner.query<{ count: string }>(
        "select count(*)::text as count from active_bundle_pointers where tenant_id = $1",
        [tenant],
      );
      expect(pointerRows[0]?.count).toBe("1");
      const { rows: bundleRows } = await owner.query<{ count: string }>(
        "select count(*)::text as count from service_bundles where hash = $1",
        [winnerHash],
      );
      expect(bundleRows[0]?.count).toBe("1");

      // Anything older loses the guarded swap, no matter the replica.
      const older = bundleAt(3, T0 + 180_000);
      const olderHash = bundleHashOf(older);
      expect(await replica.activate(older, olderHash, tenant)).toEqual({
        ok: false,
        reason: "stale_sequence",
        pointer: { hash: winnerHash, sequence: 4 },
      });
      expect(await replica.getPointer(tenant)).toEqual({ hash: winnerHash, sequence: 4 });
    } finally {
      await replicaPool.end();
    }
  });

  it("refuses an activation whose re-derived stored hash differs, rolling the insert back (this activation only)", async () => {
    const pointerBefore = await store.getPointer(tenant);
    expect(pointerBefore).not.toBeNull();
    const { rows: bundleRowsBeforeQuery } = await owner.query<{ count: string }>("select count(*)::text as count from service_bundles");
    const before = bundleRowsBeforeQuery[0]?.count;

    const candidate = bundleAt(9, T0 + 240_000);
    const wrongHash = "9".repeat(64);
    const activation = await store.activate(candidate, wrongHash, tenant);
    expect(activation).toEqual({ ok: false, reason: "hash_mismatch", pointer: pointerBefore });
    expect(await store.getPointer(tenant)).toEqual(pointerBefore);
    expect(await store.pinnedBundle(wrongHash)).toBeNull();

    const { rows: bundleRowsAfterQuery } = await owner.query<{ count: string }>("select count(*)::text as count from service_bundles");
    expect(bundleRowsAfterQuery[0]?.count).toBe(before);
  });

  it("refuses an activation racing an existing same-tenant same-sequence bundle with different content", async () => {
    const pointerBefore = await store.getPointer(tenant);
    expect(pointerBefore).not.toBeNull();

    // A competing replica already stored one bundle for this tenant and
    // sequence (the pointer still names the older sequence).
    const competing = bundleAt(5, T0 + 300_000);
    const competingHash = bundleHashOf(competing);
    await owner.query(
      `insert into service_bundles (hash, tenant_id, sequence, payload, key_id, signature, issued_at)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [competingHash, tenant, 5, JSON.stringify(competing.payload), competing.keyId, competing.signature, new Date(competing.payload.issuedAt)],
    );

    // A different bundle with the same tenant and sequence now activates: the
    // hidden unique(tenant_id, sequence) conflict is refused, not thrown.
    const candidate = bundleAt(5, T0 + 300_001);
    const candidateHash = bundleHashOf(candidate);
    expect(candidateHash).not.toBe(competingHash);

    const activation = await store.activate(candidate, candidateHash, tenant);
    expect(activation).toEqual({ ok: false, reason: "hash_mismatch", pointer: pointerBefore });
    expect(await store.getPointer(tenant)).toEqual(pointerBefore);
    expect(await store.pinnedBundle(candidateHash)).toBeNull();
  });

  it("records, deduplicates and lists staleness observations", async () => {
    const pointer = await store.getPointer(tenant);
    expect(pointer).not.toBeNull();
    const hash = pointer?.hash ?? "";

    // Non-stale observations record nothing.
    expect(
      await store.recordStalenessObservation({ tenantId: tenant, hash, sequence: 4, stale: false, ageSeconds: 30 }),
    ).toEqual({ recorded: false, observation: null });
    expect(await store.listStalenessObservations(tenant)).toEqual([]);

    const first = await store.recordStalenessObservation({
      tenantId: tenant,
      hash,
      sequence: 4,
      stale: true,
      ageSeconds: 8 * 3600,
    });
    expect(first.recorded).toBe(true);
    if (first.recorded) {
      expect(first.observation).toMatchObject({ tenantId: tenant, hash, sequence: 4, stale: true, ageSeconds: 8 * 3600 });
    }

    // An identical repeated observation (same hash, still stale) adds no row.
    const second = await store.recordStalenessObservation({
      tenantId: tenant,
      hash,
      sequence: 4,
      stale: true,
      ageSeconds: 9 * 3600,
    });
    expect(second).toEqual({ recorded: false, observation: null });

    // A different active hash records a new row.
    const otherPointer = { hash: "f".repeat(64), sequence: 5 };
    const third = await store.recordStalenessObservation({
      tenantId: tenant,
      hash: otherPointer.hash,
      sequence: 5,
      stale: true,
      ageSeconds: 3600,
    });
    expect(third.recorded).toBe(true);

    const listed = await store.listStalenessObservations(tenant);
    expect(listed).toHaveLength(2);
    expect(listed.map((o) => o.hash)).toEqual([hash, otherPointer.hash]);
    expect(listed.map((o) => o.stale)).toEqual([true, true]);
  });
});
