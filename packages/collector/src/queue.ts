/**
 * The durable Compilation outbox (Story 6.3): the queue that lets panel
 * outages never slow or fail Builder Guidance calls or Gate runs. The Builder
 * hot path only awaits a local `enqueue` (same cost class as the existing
 * record appends); every network push happens in a background flush
 * (`flush.ts`) that never throws into serve/runner results.
 *
 * Ordering: the outbox owns the single durable per-Application sequence
 * counter across all Compilation types (closing the 6.2 handoff — the
 * registry UNIQUE on `(tenant_id, application_id, sequence)` spans all
 * types, so a record store's per-type sequence must never be reused).
 * Sequences are allocated atomically with the enqueue inside the store, so a
 * crash between allocation and insert can never burn a sequence and fake a
 * gap. `detectGaps` derives lost sequences from the durable watermark versus
 * the queued/sent rows; loss is reported, never silent.
 */
import type { Compilation, UuidV7 } from "@domain-harness/contract";
import { validateForSend } from "./validate.ts";
import type { DropReason } from "./validate.ts";

/** One queued Compilation: the validated payload plus its delivery state. */
export interface QueuedCompilation {
  readonly idempotencyKey: UuidV7;
  readonly applicationId: UuidV7;
  sequence: number;
  compilation: Compilation;
  /** Failed delivery attempts so far; the read-gate keep does not count. */
  attempts: number;
  /** The flush may attempt this entry once this instant passes (UTC ISO). */
  nextAttemptAt: string;
  /** `queued` awaits delivery; `sent` was acknowledged (kept for gap derivation). */
  status: "queued" | "sent";
}

/** Queue depth for collector-health projections. */
export interface OutboxStats {
  readonly pendingCount: number;
  readonly sentCount: number;
}

/** Lost sequences per Application, derived from durable state. */
export interface QueueGap {
  readonly applicationId: UuidV7;
  /** Allocated sequences with no queued or sent row (ascending). */
  readonly missing: readonly number[];
}

/** The outcome of offering one Compilation to the outbox. Never throws. */
export type EnqueueOutcome =
  | { readonly stored: true; readonly idempotencyKey: UuidV7; readonly sequence: number }
  | {
      readonly stored: false;
      readonly reason: DropReason;
      readonly subject: string;
      readonly message: string;
    };

/**
 * The durable outbox surface. `enqueue` and `resequence` take a builder that
 * receives the freshly allocated sequence, so allocation and insert stay
 * atomic (a throwing builder advances nothing). Implementations never throw
 * except when the builder itself throws; the service-side client guards even
 * that. Time always arrives as an explicit UTC ISO `now` for determinism.
 */
export interface CollectorOutbox {
  enqueue(
    applicationId: UuidV7,
    build: (sequence: number) => Compilation,
    now: string,
  ): Promise<EnqueueOutcome>;
  listDue(now: string, limit: number): Promise<readonly QueuedCompilation[]>;
  markSent(idempotencyKey: UuidV7): Promise<void>;
  /** A failed delivery: attempts + 1, retried once `nextAttemptAt` passes. */
  noteAttempt(idempotencyKey: UuidV7, nextAttemptAt: string): Promise<void>;
  /** A `catalog_unread` keep: retried once `nextAttemptAt` passes, no attempt penalty. */
  keepForReadGate(idempotencyKey: UuidV7, nextAttemptAt: string): Promise<void>;
  /**
   * Replace a refused entry's payload with `build(freshSequence)` (same
   * idempotency key, attempts reset, due now). The abandoned sequence stays
   * missing and surfaces through `detectGaps`.
   */
  resequence(
    idempotencyKey: UuidV7,
    build: (sequence: number) => Compilation,
    now: string,
  ): Promise<number>;
  /** Remove a refused entry (the caller counts the drop in its ledger). */
  dropEntry(idempotencyKey: UuidV7): Promise<void>;
  stats(): Promise<OutboxStats>;
  detectGaps(): Promise<readonly QueueGap[]>;
}

function snapshot(entry: QueuedCompilation): QueuedCompilation {
  return { ...entry };
}

/**
 * The in-memory outbox twin: the durable-twin stand-in for collector unit
 * tests (no database). The Postgres twin in `apps/service` implements the
 * same interface with the watermark and rows in one transaction.
 */
export class InMemoryCollectorOutbox implements CollectorOutbox {
  private readonly watermarks = new Map<string, number>();
  private readonly rows = new Map<string, QueuedCompilation>();

  async enqueue(
    applicationId: UuidV7,
    build: (sequence: number) => Compilation,
    now: string,
  ): Promise<EnqueueOutcome> {
    await Promise.resolve();
    const next = (this.watermarks.get(applicationId) ?? 0) + 1;
    const compilation = build(next);
    const checked = validateForSend(compilation);
    if (!checked.ok) {
      return {
        stored: false,
        reason: checked.reason,
        subject: checked.subject,
        message: checked.message,
      };
    }
    this.watermarks.set(applicationId, next);
    const stored: QueuedCompilation = {
      idempotencyKey: checked.compilation.idempotencyKey,
      applicationId: checked.compilation.applicationId,
      sequence: checked.compilation.sequence,
      compilation: checked.compilation,
      attempts: 0,
      nextAttemptAt: now,
      status: "queued",
    };
    this.rows.set(stored.idempotencyKey, stored);
    return { stored: true, idempotencyKey: stored.idempotencyKey, sequence: stored.sequence };
  }

  async listDue(now: string, limit: number): Promise<readonly QueuedCompilation[]> {
    await Promise.resolve();
    const due = [...this.rows.values()]
      .filter((entry) => entry.status === "queued" && entry.nextAttemptAt <= now)
      .sort((a, b) => (a.nextAttemptAt < b.nextAttemptAt ? -1 : a.nextAttemptAt > b.nextAttemptAt ? 1 : 0))
      .slice(0, Math.max(0, limit));
    return due.map(snapshot);
  }

  async markSent(idempotencyKey: UuidV7): Promise<void> {
    await Promise.resolve();
        const entry = this.rows.get(idempotencyKey);
    if (entry !== undefined) entry.status = "sent";
  }

  async noteAttempt(idempotencyKey: UuidV7, nextAttemptAt: string): Promise<void> {
    await Promise.resolve();
        const entry = this.rows.get(idempotencyKey);
    if (entry !== undefined && entry.status === "queued") {
      entry.attempts += 1;
      entry.nextAttemptAt = nextAttemptAt;
    }
  }

  async keepForReadGate(idempotencyKey: UuidV7, nextAttemptAt: string): Promise<void> {
    await Promise.resolve();
        const entry = this.rows.get(idempotencyKey);
    if (entry !== undefined && entry.status === "queued") {
      entry.nextAttemptAt = nextAttemptAt;
    }
  }

  async resequence(
    idempotencyKey: UuidV7,
    build: (sequence: number) => Compilation,
    now: string,
  ): Promise<number> {
    await Promise.resolve();
    const entry = this.rows.get(idempotencyKey);
    if (entry === undefined) throw new Error("collector: resequence of an unknown queued Compilation");
    if (entry.status !== "queued") throw new Error("collector: resequence of a Compilation that is no longer queued");
    const next = (this.watermarks.get(entry.applicationId) ?? 0) + 1;
    const compilation = build(next);
    const checked = validateForSend(compilation);
    if (!checked.ok) {
      throw new Error(`collector: resequenced Compilation failed validation: ${checked.subject}`);
    }
    this.watermarks.set(entry.applicationId, next);
    entry.sequence = checked.compilation.sequence;
    entry.compilation = checked.compilation;
    entry.attempts = 0;
    entry.nextAttemptAt = now;
    return next;
  }

  async dropEntry(idempotencyKey: UuidV7): Promise<void> {
    await Promise.resolve();
    const entry = this.rows.get(idempotencyKey);
    if (entry !== undefined && entry.status === "queued") this.rows.delete(idempotencyKey);
  }

  async stats(): Promise<OutboxStats> {
    await Promise.resolve();
    let pendingCount = 0;
    let sentCount = 0;
    for (const entry of this.rows.values()) {
      if (entry.status === "queued") pendingCount += 1;
      else sentCount += 1;
    }
    return { pendingCount, sentCount };
  }

  async detectGaps(): Promise<readonly QueueGap[]> {
    await Promise.resolve();
    const present = new Map<string, Set<number>>();
    for (const entry of this.rows.values()) {
      let set = present.get(entry.applicationId);
      if (set === undefined) {
        set = new Set<number>();
        present.set(entry.applicationId, set);
      }
      set.add(entry.sequence);
    }
    const gaps: QueueGap[] = [];
    for (const [applicationId, watermark] of this.watermarks) {
      const seen = present.get(applicationId) ?? new Set<number>();
      const missing: number[] = [];
      for (let sequence = 1; sequence <= watermark; sequence += 1) {
        if (!seen.has(sequence)) missing.push(sequence);
      }
      if (missing.length > 0) gaps.push({ applicationId: applicationId as UuidV7, missing });
    }
    return gaps;
  }

  /** Test seam: remove a queued row the way a restored backup would. */
  removeForTest(idempotencyKey: UuidV7): void {
    this.rows.delete(idempotencyKey);
  }
}
