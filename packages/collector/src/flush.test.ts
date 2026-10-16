import { describe, expect, it } from "vitest";
import type { GuidanceEvent, UuidV7 } from "@domain-harness/contract";
import { mintUuidV7 } from "./ids.ts";
import {
  FLUSH_READ_GATE_RETRY_MS,
  computeBackoffMs,
  flushOnce,
  healthInputOf,
  isSequenceTakenDetail,
} from "./flush.ts";
import type { PushResult } from "./push.ts";
import { projectGuidanceCompilation } from "./project.ts";
import { InMemoryCollectorOutbox } from "./queue.ts";
import { DropLedger } from "./validate.ts";

const APP = "01928c7e-5b2a-7c3d-9e4f-a1b2c3d4e5f7" as UuidV7;
const AT = "2026-10-16T12:00:00.000Z";
const HASH = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const TENANT_KEY = "tenant-service-credential";

function guidanceEvent(): GuidanceEvent {
  return {
    id: mintUuidV7(),
    applicationId: APP,
    sequence: 7,
    tool: "code_stack_rule",
    subject: "code-stack/library/React",
    outcome: { kind: "hit", standardId: "standard-1", version: 2 },
    agentTool: "claude-code",
    bundleHash: HASH,
    createdAt: AT,
  };
}

async function enqueueOne(outbox: InMemoryCollectorOutbox) {
  const outcome = await outbox.enqueue(
    APP,
    (sequence) => projectGuidanceCompilation(guidanceEvent(), { sequence, tenantKey: TENANT_KEY }),
    AT,
  );
  if (!outcome.stored) throw new Error("setup failed");
  return outcome;
}

const sent = (status: 201 | 200 = 201): PushResult => ({ ok: true, sent: true, status });

describe("computeBackoffMs", () => {
  it("doubles from the 1s base and caps at 5 minutes", () => {
    expect(computeBackoffMs(0)).toBe(1_000);
    expect(computeBackoffMs(1)).toBe(2_000);
    expect(computeBackoffMs(2)).toBe(4_000);
    expect(computeBackoffMs(8)).toBe(256_000);
    expect(computeBackoffMs(9)).toBe(300_000);
    expect(computeBackoffMs(100)).toBe(300_000);
  });
});

describe("isSequenceTakenDetail", () => {
  it("recognizes the sequence-taken refusal and nothing else", () => {
    expect(isSequenceTakenDetail(JSON.stringify({ code: "invalid_input", message: "taken", subject: "sequence" }))).toBe(true);
    expect(isSequenceTakenDetail(JSON.stringify({ code: "invalid_input", message: "bad", subject: "schemaVersion" }))).toBe(false);
    expect(isSequenceTakenDetail("not json")).toBe(false);
    expect(isSequenceTakenDetail("")).toBe(false);
  });
});

describe("flushOnce", () => {
  it("marks sent entries sent", async () => {
    const outbox = new InMemoryCollectorOutbox();
    await enqueueOne(outbox);
    const report = await flushOnce({ outbox, push: () => Promise.resolve(sent()), baseUrl: "https://panel.test", credential: "cred", now: AT, ledger: new DropLedger() });
    expect(report).toEqual({ attempted: 1, sent: 1, kept: 0, dropped: 0, resequenced: 0 });
    await expect(outbox.stats()).resolves.toEqual({ pendingCount: 0, sentCount: 1 });
  });

  it("marks a 200 replay (resent idempotency key) sent without storing a duplicate", async () => {
    const outbox = new InMemoryCollectorOutbox();
    await enqueueOne(outbox);
    const report = await flushOnce({ outbox, push: () => Promise.resolve(sent(200)), baseUrl: "https://panel.test", credential: "cred", now: AT, ledger: new DropLedger() });
    expect(report).toEqual({ attempted: 1, sent: 1, kept: 0, dropped: 0, resequenced: 0 });
    await expect(outbox.stats()).resolves.toEqual({ pendingCount: 0, sentCount: 1 });
  });

  it("keeps catalog_unread entries queued without attempt penalty for the read-gate delay", async () => {
    const outbox = new InMemoryCollectorOutbox();
    const { idempotencyKey } = await enqueueOne(outbox);
    const ledger = new DropLedger();
    const kept = await flushOnce({
      outbox,
      push: () => Promise.resolve({ ok: false, reason: "catalog_unread", status: 403 } as const),
      baseUrl: "https://panel.test",
      credential: "cred",
      now: AT,
      ledger,
    });
    expect(kept).toMatchObject({ attempted: 1, sent: 0, kept: 1 });
    const [entry] = await outbox.listDue("2026-10-16T12:00:30.000Z", 10);
    expect(entry).toBeUndefined();
    expect(ledger.snapshot()).toEqual({});
    const resent = await flushOnce({
      outbox,
      push: () => Promise.resolve(sent()),
      baseUrl: "https://panel.test",
      credential: "cred",
      now: new Date(Date.parse(AT) + FLUSH_READ_GATE_RETRY_MS).toISOString(),
      ledger,
    });
    expect(resent).toMatchObject({ sent: 1 });
    await expect(outbox.stats()).resolves.toEqual({ pendingCount: 0, sentCount: 1 });
    expect(idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("backs transport failures off exponentially and keeps the entry", async () => {
    const outbox = new InMemoryCollectorOutbox();
    await enqueueOne(outbox);
    const failing = (): Promise<PushResult> => Promise.resolve({ ok: false, reason: "transport_failed", detail: "down" });
    const input = { outbox, push: failing, baseUrl: "https://panel.test", credential: "cred", ledger: new DropLedger() } as const;
    await flushOnce({ ...input, now: AT });
    const [entry] = await outbox.listDue("2026-10-16T12:00:01.000Z", 10);
    expect(entry?.attempts).toBe(1);
    await expect(outbox.listDue(AT, 10)).resolves.toEqual([]);
    await expect(outbox.stats()).resolves.toEqual({ pendingCount: 1, sentCount: 0 });
  });

  it("keeps unauthorized entries queued (credential rotation may fix them)", async () => {
    const outbox = new InMemoryCollectorOutbox();
    await enqueueOne(outbox);
    const report = await flushOnce({
      outbox,
      push: () => Promise.resolve({ ok: false, reason: "unauthorized", status: 401 } as const),
      baseUrl: "https://panel.test",
      credential: "cred",
      now: AT,
      ledger: new DropLedger(),
    });
    expect(report).toMatchObject({ kept: 1, dropped: 0 });
    await expect(outbox.stats()).resolves.toEqual({ pendingCount: 1, sentCount: 0 });
  });

  it("drops registry refusals whole into the rejected ledger", async () => {
    const outbox = new InMemoryCollectorOutbox();
    await enqueueOne(outbox);
    const ledger = new DropLedger();
    const report = await flushOnce({
      outbox,
      push: () => Promise.resolve({ ok: false, reason: "invalid", status: 400, detail: JSON.stringify({ code: "invalid_input", message: "bad major", subject: "schemaVersion" }) } as const),
      baseUrl: "https://panel.test",
      credential: "cred",
      now: AT,
      ledger,
    });
    expect(report).toMatchObject({ dropped: 1 });
    expect(ledger.snapshot()).toEqual({ rejected: 1 });
    await expect(outbox.stats()).resolves.toEqual({ pendingCount: 0, sentCount: 0 });
  });

  it("resequences sequence-taken refusals under the same key and surfaces the gap", async () => {
    const outbox = new InMemoryCollectorOutbox();
    const { idempotencyKey } = await enqueueOne(outbox);
    const ledger = new DropLedger();
    const report = await flushOnce({
      outbox,
      push: () => Promise.resolve({ ok: false, reason: "invalid", status: 400, detail: JSON.stringify({ code: "invalid_input", message: "taken", subject: "sequence" }) } as const),
      baseUrl: "https://panel.test",
      credential: "cred",
      now: AT,
      ledger,
    });
    expect(report).toMatchObject({ resequenced: 1, dropped: 0 });
    const [entry] = await outbox.listDue(AT, 10);
    expect(entry?.idempotencyKey).toBe(idempotencyKey);
    expect(entry?.sequence).toBe(2);
    const health = healthInputOf(await outbox.stats(), await outbox.detectGaps(), ledger);
    expect(health).toEqual({ pendingCount: 1, droppedByReason: { queue_gap: 1 } });
  });

  it("treats a throwing push as a transport failure, never throwing itself", async () => {
    const outbox = new InMemoryCollectorOutbox();
    await enqueueOne(outbox);
    const report = await flushOnce({
      outbox,
      push: () => Promise.reject(new Error("boom")),
      baseUrl: "https://panel.test",
      credential: "cred",
      now: AT,
      ledger: new DropLedger(),
    });
    expect(report).toMatchObject({ attempted: 1, kept: 1 });
    await expect(outbox.stats()).resolves.toEqual({ pendingCount: 1, sentCount: 0 });
  });
});

describe("healthInputOf", () => {
  it("merges ledger drops with the durable gap truth", async () => {
    const outbox = new InMemoryCollectorOutbox();
    await enqueueOne(outbox);
    const ledger = new DropLedger();
    ledger.record("rejected");
    const health = healthInputOf(await outbox.stats(), await outbox.detectGaps(), ledger);
    expect(health).toEqual({ pendingCount: 1, droppedByReason: { rejected: 1 } });
  });
});
