/**
 * Database suite for durable Compilation delivery (Story 6.3): runs against
 * a real PostgreSQL 18 named by SERVICE_TEST_DATABASE_URL (an admin
 * connection), in the 4.5 harness style: a throwaway database migrated with
 * apps/service/migrations, then the Postgres outbox twin exercised —
 * migration report including 0005, per-Application sequences, due ordering,
 * attempt/backoff bookkeeping, resequence plus gap derivation, and the two
 * Builder-invisible paths: a panel-stopped Guidance call plus Gate run whose
 * results match the no-collector baseline while entries accumulate durably,
 * and a catalog_unread keep that sends once the read is recorded.
 */
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GuidanceToolResult, StandardBundlePayload, UuidV7 } from "@domain-harness/contract";
import type { CollectorOutbox, PushResult } from "@domain-harness/collector";
import { migrate } from "../db/migrate.ts";
import { createPool } from "../ci-gate/store.ts";
import { createInMemoryGateRecordStore } from "../ci-gate/store.ts";
import { runGate } from "../ci-gate/runner.ts";
import {
  FIXTURE_APP_ID,
  FIXTURE_NOW,
  makeFactsFixture,
  makeSnapshotFixture,
} from "../ci-gate/test-fixtures.ts";
import { createInMemoryGuidanceIdentityStore } from "../guidance/store.ts";
import { createInMemoryGuidanceEventStore } from "../guidance/events.ts";
import { serveGuidanceCall } from "../guidance/serve.ts";
import { makeBundlePayload } from "../bundles/test-fixtures.ts";
import { createPostgresCollectorOutbox } from "./outbox.ts";
import { CollectorClient } from "./client.ts";

const ENV = "SERVICE_TEST_DATABASE_URL";
const adminUrl = process.env[ENV];
const inCi = process.env["CI"] !== undefined && process.env["CI"] !== "" && process.env["CI"] !== "false";

if (adminUrl === undefined || adminUrl === "") {
  if (inCi) {
    describe("service collector database suite", () => {
      it(`requires ${ENV} when CI is set`, () => {
        expect.fail(`${ENV} is not set; CI must run the service database suite against PostgreSQL 18`);
      });
    });
  } else {
    process.stderr.write(`collector.db.test.ts skipped: ${ENV} is not set\n`);
  }
}

function withDatabase(url: string, database: string): string {
  const next = new URL(url);
  next.pathname = `/${database}`;
  return next.toString();
}

const TENANT = "018f3d2a-7000-7000-8000-000000000100" as UuidV7;
const APP = "018f3d2a-7000-7000-8000-000000000001" as UuidV7;
const ROOT = "018f3d2a-7000-7000-8000-000000000110" as UuidV7;
const FP = "1".repeat(64);
const NOW = "2026-10-16T12:00:00.000Z";
const TENANT_KEY = "test-tenant-service-credential";

const transportDown = (): Promise<PushResult> =>
  Promise.resolve({ ok: false, reason: "transport_failed", detail: "panel stopped" });
const catalogUnread = (): Promise<PushResult> =>
  Promise.resolve({ ok: false, reason: "catalog_unread", status: 403 } as const);
const panelUp = (): Promise<PushResult> => Promise.resolve({ ok: true, sent: true, status: 201 });

describe.skipIf(adminUrl === undefined || adminUrl === "")("PostgresCollectorOutbox against PostgreSQL", () => {
  const database = `dh_service_collector_test_${randomBytes(6).toString("hex")}`;
  let admin: pg.Client;
  let owner: pg.Client;
  let pool: pg.Pool;
  let outbox: CollectorOutbox;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`create database ${database}`);

    const dbUrl = withDatabase(adminUrl ?? "", database);
    owner = new pg.Client({ connectionString: dbUrl });
    await owner.connect();
    const report = await migrate(owner);
    expect(report.applied).toContain("0005_collector_outbox.sql");
    pool = createPool(dbUrl);
    outbox = createPostgresCollectorOutbox(pool);
  });

  afterAll(async () => {
    await pool.end();
    await owner.end();
    await admin.query(`drop database if exists ${database} with (force)`);
    await admin.end();
  });

  function payloadOf(): StandardBundlePayload {
    return {
      ...makeBundlePayload({ keyId: "collector-test", sequence: 3, issuedAt: "2026-10-16T06:00:00.000Z" }),
      applications: [{ id: APP, projectId: ROOT, fromFlow: true, agentTool: "claude-code" }],
    };
  }

  function serveCall(collector: CollectorClient): Promise<GuidanceToolResult> {
    const payload = payloadOf();
    return serveGuidanceCall({
      headers: { applicationId: APP, advisoryProjectId: ROOT, repoFingerprint: FP },
      tool: "code_stack_rule",
      subject: "lodash",
      tenantId: TENANT,
      now: NOW,
      identityStore: createInMemoryGuidanceIdentityStore(),
      eventStore: createInMemoryGuidanceEventStore(),
      collector,
      getPinnedBundle: () => Promise.resolve({ payload, hash: "h".repeat(64) }),
      getBundledState: () =>
        Promise.resolve({
          ok: true,
          state: { hash: "h".repeat(64), sequence: 3, ageSeconds: 1, stalenessHours: 24, frozen: false, stale: false },
        }),
    });
  }

  it("allocates one monotonic per-Application sequence and drops schema failures without advancing", async () => {
    const first = await outbox.enqueue(APP, () => ({ type: "note" }) as never, NOW);
    expect(first).toMatchObject({ stored: false, reason: "schema_failed" });
    const client = new CollectorClient({ outbox, tenantKey: TENANT_KEY, panelBaseUrl: "https://panel.test", now: () => NOW });
    await client.submit(APP, (sequence) => ({
      type: "collector_health",
      schemaVersion: "1.0.0",
      catalogVersion: "1.0.0",
      idempotencyKey: "01928c7e-5b2a-7c3d-9e4f-a1b2c3d4e5f7" as UuidV7,
      applicationId: APP,
      agentToolName: "claude-code",
      occurredAt: NOW,
      sequence,
      pendingCount: 0,
      droppedByReason: {},
    }));
    await expect(outbox.stats()).resolves.toEqual({ pendingCount: 1, sentCount: 0 });
    await expect(outbox.listDue(NOW, 10).then((rows) => rows.map((row) => row.sequence))).resolves.toEqual([1]);
  });

  it("panel stopped: Guidance and Gate results match the no-collector baseline while entries accumulate durably", async () => {
    await owner.query("delete from collector_outbox");
    await owner.query("delete from collector_sequences");
    const errors: unknown[] = [];
    const client = new CollectorClient({
      outbox,
      tenantKey: TENANT_KEY,
      panelBaseUrl: "https://panel.test",
      now: () => NOW,
      onError: (input) => {
        errors.push(input);
      },
    });

    const baselineServe = await serveGuidanceCall({
      headers: { applicationId: APP, advisoryProjectId: ROOT, repoFingerprint: FP },
      tool: "code_stack_rule",
      subject: "lodash",
      tenantId: TENANT,
      now: NOW,
      identityStore: createInMemoryGuidanceIdentityStore(),
      eventStore: createInMemoryGuidanceEventStore(),
      getPinnedBundle: () => Promise.resolve({ payload: payloadOf(), hash: "h".repeat(64) }),
      getBundledState: () =>
        Promise.resolve({
          ok: true,
          state: { hash: "h".repeat(64), sequence: 3, ageSeconds: 1, stalenessHours: 24, frozen: false, stale: false },
        }),
    });
    const withCollector = await serveCall(client);
    expect(withCollector).toEqual(baselineServe);
    expect(withCollector.kind).toBe("hit");

    const baselineGate = await runGate({
      applicationId: FIXTURE_APP_ID,
      repoFingerprint: FP,
      facts: makeFactsFixture({ dependencies: [{ name: "remeda", version: "2.1.0" }] }),
      revision: "1".repeat(40),
      now: FIXTURE_NOW,
      source: () => Promise.resolve(makeSnapshotFixture()),
      store: createInMemoryGateRecordStore(),
    });
    const gatedWithCollector = await runGate({
      applicationId: FIXTURE_APP_ID,
      repoFingerprint: FP,
      facts: makeFactsFixture({ dependencies: [{ name: "remeda", version: "2.1.0" }] }),
      revision: "1".repeat(40),
      now: FIXTURE_NOW,
      source: () => Promise.resolve(makeSnapshotFixture()),
      store: createInMemoryGateRecordStore(),
      collector: client,
      collectorAgentToolName: "cursor",
    });
    expect({ ...gatedWithCollector, sequence: null }).toEqual({ ...baselineGate, sequence: null });
    expect(gatedWithCollector.kind).toBe("pass");
    expect(errors).toEqual([]);

    const fresh = createPostgresCollectorOutbox(pool);
    await expect(fresh.stats()).resolves.toEqual({ pendingCount: 2, sentCount: 0 });

    const flushed = await client.flushNow(NOW, transportDown);
    expect(flushed).toMatchObject({ attempted: 2, sent: 0, kept: 2 });
    await expect(fresh.stats()).resolves.toEqual({ pendingCount: 2, sentCount: 0 });
    const [due] = await fresh.listDue("2026-10-16T12:00:01.000Z", 10);
    expect(due?.attempts).toBe(1);
  });

  it("catalog_unread keeps entries queued and sends them once the read is recorded", async () => {
    await owner.query("delete from collector_outbox");
    await owner.query("delete from collector_sequences");
    const client = new CollectorClient({ outbox, tenantKey: TENANT_KEY, panelBaseUrl: "https://panel.test", now: () => NOW });
    await serveCall(client);

    const refused = await client.flushNow(NOW, catalogUnread);
    expect(refused).toMatchObject({ attempted: 1, sent: 0, kept: 1 });
    await expect(outbox.listDue(NOW, 10)).resolves.toEqual([]);

    const delivered = await client.flushNow("2026-10-16T12:01:00.000Z", panelUp);
    expect(delivered).toMatchObject({ attempted: 1, sent: 1 });
    await expect(outbox.stats()).resolves.toEqual({ pendingCount: 0, sentCount: 1 });
  });

  it("a lost queued row surfaces as a queue_gap on collector health, never silent", async () => {
    await owner.query("delete from collector_outbox");
    await owner.query("delete from collector_sequences");
    const client = new CollectorClient({ outbox, tenantKey: TENANT_KEY, panelBaseUrl: "https://panel.test", now: () => NOW });
    await serveCall(client);
    await serveCall(client);
    const rows = await owner.query("select idempotency_key from collector_outbox order by sequence asc");
    await owner.query("delete from collector_outbox where idempotency_key = $1", [
      (rows.rows[0] as { idempotency_key: string }).idempotency_key,
    ]);
    const gaps = await outbox.detectGaps();
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.missing).toEqual([1]);
    const health = await client.collectorHealth();
    expect(health.pendingCount).toBe(1);
    expect(health.droppedByReason).toEqual({ queue_gap: 1 });
  });

  it("real pushCompilation over HTTP honors the registry envelope contract: unread keep, 201 sent, 200 replay", async () => {
    await owner.query("delete from collector_outbox");
    await owner.query("delete from collector_sequences");
    const seen: { authorization: unknown; bodies: unknown[] } = { authorization: null, bodies: [] };
    let mode: "unread" | "up" = "unread";
    const stored = new Map<string, unknown>();
    const server = createServer((req, res) => {
      let text = "";
      req.on("data", (chunk: Buffer) => {
        text += chunk.toString("utf8");
      });
      req.on("end", () => {
        seen.authorization = req.headers["authorization"];
        if (mode === "unread") {
          res.writeHead(403, { "content-type": "application/json" });
          res.end(JSON.stringify({ code: "catalog_unread", message: "m", subject: "catalog" }));
          return;
        }
        const body = JSON.parse(text) as { idempotencyKey: string };
        seen.bodies.push(body);
        const replay = stored.has(body.idempotencyKey);
        stored.set(body.idempotencyKey, body);
        res.writeHead(replay ? 200 : 201, { "content-type": "application/json" });
        res.end(text);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
      const client = new CollectorClient({ outbox, tenantKey: TENANT_KEY, panelBaseUrl: base, now: () => NOW });
      await serveCall(client);

      const refused = await client.flushNow(NOW);
      expect(refused).toMatchObject({ attempted: 1, kept: 1, sent: 0 });

      mode = "up";
      const delivered = await client.flushNow("2026-10-16T12:01:00.000Z");
      expect(delivered).toMatchObject({ attempted: 1, sent: 1 });
      expect(seen.authorization).toBe(`Bearer ${TENANT_KEY}`);

      const replayDue = await client.flushNow("2026-10-16T12:01:00.000Z");
      expect(replayDue.sent).toBe(0);
      await expect(outbox.stats()).resolves.toEqual({ pendingCount: 0, sentCount: 1 });
      expect(seen.bodies).toHaveLength(1);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("real pushCompilation over HTTP resequences on the sequence-taken envelope and reports the gap", async () => {
    await owner.query("delete from collector_outbox");
    await owner.query("delete from collector_sequences");
    let refuseTaken = true;
    const server = createServer((req, res) => {
      let text = "";
      req.on("data", (chunk: Buffer) => {
        text += chunk.toString("utf8");
      });
      req.on("end", () => {
        if (refuseTaken) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              code: "invalid_input",
              message: "this Application already has a Compilation with this sequence; nothing was stored",
              subject: "sequence",
            }),
          );
          return;
        }
        res.writeHead(201, { "content-type": "application/json" });
        res.end(text);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
      const client = new CollectorClient({ outbox, tenantKey: TENANT_KEY, panelBaseUrl: base, now: () => NOW });
      await serveCall(client);

      const refused = await client.flushNow(NOW);
      expect(refused).toMatchObject({ attempted: 1, resequenced: 1, dropped: 0 });
      const health = await client.collectorHealth();
      expect(health.droppedByReason).toEqual({ queue_gap: 1 });

      refuseTaken = false;
      const delivered = await client.flushNow(NOW);
      expect(delivered).toMatchObject({ attempted: 1, sent: 1 });
      await expect(outbox.stats()).resolves.toEqual({ pendingCount: 0, sentCount: 1 });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
