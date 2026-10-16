/**
 * The background delivery pass (Story 6.3): `flushOnce` pushes every due
 * queued Compilation through the 6.2 `pushCompilation` and maps each typed
 * outcome to a queue fate. It never throws — a throwing push implementation
 * is treated as a transport failure — and it never touches Builder paths:
 * the service calls it from a background flusher, never from serve/runner.
 *
 * Fates: `sent` marks the entry sent; `catalog_unread` keeps the entry
 * queued with a read-gate retry delay and no attempt penalty (it is sent
 * once the Buyer records the read); `transport_failed` and `unauthorized`
 * keep the entry queued with capped exponential backoff; `invalid` drops the
 * entry whole into the caller's ledger, except a sequence-taken refusal
 * (`invalid_input` naming `sequence` — the counter diverged after queue
 * loss), which resequences the entry with a fresh durable sequence under the
 * same idempotency key and leaves the abandoned sequence to `detectGaps`.
 */
import type { Compilation } from "@domain-harness/contract";
import { isRecord } from "@domain-harness/contract";
import type { CollectorOutbox, QueueGap, QueuedCompilation } from "./queue.ts";
import { pushCompilation } from "./push.ts";
import type { PushCompilationInput, PushResult } from "./push.ts";
import type { DropLedger } from "./validate.ts";
import type { CollectorHealthInput } from "./project.ts";

/** First retry delay; doubled per attempt. */
export const FLUSH_BACKOFF_BASE_MS = 1_000;
/** The retry delay never exceeds this, however many attempts fail. */
export const FLUSH_BACKOFF_MAX_MS = 300_000;
/** A `catalog_unread` keep is retried once this delay passes (no backoff: the read is an event, not congestion). */
export const FLUSH_READ_GATE_RETRY_MS = 60_000;
/** Entries attempted per pass; bounds one flush's network fan-out. */
export const FLUSH_BATCH_LIMIT = 100;

/**
 * The deterministic retry delay for `attempts` prior failures: base doubled
 * per attempt, capped. No jitter: unit tests pin the schedule and the cap
 * keeps a long outage's thundering herd bounded by the batch limit.
 */
export function computeBackoffMs(attempts: number): number {
  const doubled = FLUSH_BACKOFF_BASE_MS * 2 ** Math.max(0, attempts);
  return Math.min(doubled, FLUSH_BACKOFF_MAX_MS);
}

/** True when an `invalid` refusal body is the sequence-taken refusal (the counter diverged after queue loss). */
export function isSequenceTakenDetail(detail: string): boolean {
  let body: unknown;
  try {
    body = JSON.parse(detail) as unknown;
  } catch {
    return false;
  }
  return isRecord(body) && body["code"] === "invalid_input" && body["subject"] === "sequence";
}

/** What one flush pass did, by entry fate. */
export interface FlushReport {
  readonly attempted: number;
  readonly sent: number;
  /** Kept queued: transport/unauthorized backoff plus read-gate keeps. */
  readonly kept: number;
  /** Dropped whole into the ledger (registry refusals that retry cannot fix). */
  readonly dropped: number;
  /** Resequenced after a sequence-taken refusal. */
  readonly resequenced: number;
}

/** One flush pass: where to push, what to push with, and the queue to drain. */
export interface FlushOnceInput {
  readonly outbox: CollectorOutbox;
  /** Push implementation; defaults to the 6.2 `pushCompilation`. */
  readonly push?: (input: PushCompilationInput) => Promise<PushResult>;
  readonly baseUrl: string;
  readonly credential: string;
  readonly timeoutMs?: number;
  /** UTC ISO instant due entries are selected against; delivery delays derive from it. */
  readonly now: string;
  /** Whole-payload drops land here under `rejected`. */
  readonly ledger: DropLedger;
  /**
   * Rebuild a resequenced entry's payload with its fresh sequence. The
   * default keeps the stored Compilation's fields with the new sequence;
   * callers that re-project pass their own.
   */
  readonly rebuild?: (compilation: Compilation, sequence: number) => Compilation;
  readonly batchLimit?: number;
}

function shiftToSequence(compilation: Compilation, sequence: number): Compilation {
  return { ...compilation, sequence };
}

function addMs(now: string, ms: number): string {
  return new Date(Date.parse(now) + ms).toISOString();
}

/**
 * Push every due entry once and apply its fate. Never throws: any failure —
 * including a throwing push or a failing store — is contained as a kept
 * entry (store failures leave the entry due) so the next pass can retry.
 */
export async function flushOnce(input: FlushOnceInput): Promise<FlushReport> {
  const push = input.push ?? pushCompilation;
  const rebuild = input.rebuild ?? shiftToSequence;
  const limit = input.batchLimit ?? FLUSH_BATCH_LIMIT;
  const report = { attempted: 0, sent: 0, kept: 0, dropped: 0, resequenced: 0 };
  let due: readonly QueuedCompilation[];
  try {
    due = await input.outbox.listDue(input.now, limit);
  } catch {
    return { ...report };
  }
  for (const entry of due) {
    report.attempted += 1;
    let outcome: PushResult;
    try {
      outcome = await push(
        input.timeoutMs === undefined
          ? { baseUrl: input.baseUrl, credential: input.credential, compilation: entry.compilation }
          : {
              baseUrl: input.baseUrl,
              credential: input.credential,
              compilation: entry.compilation,
              timeoutMs: input.timeoutMs,
            },
      );
    } catch (cause) {
      outcome = {
        ok: false,
        reason: "transport_failed",
        detail: cause instanceof Error ? cause.message : "the push threw",
      };
    }
    try {
      if (outcome.ok) {
        await input.outbox.markSent(entry.idempotencyKey);
        report.sent += 1;
      } else if (outcome.reason === "catalog_unread") {
        await input.outbox.keepForReadGate(entry.idempotencyKey, addMs(input.now, FLUSH_READ_GATE_RETRY_MS));
        report.kept += 1;
      } else if (outcome.reason === "transport_failed" || outcome.reason === "unauthorized") {
        await input.outbox.noteAttempt(entry.idempotencyKey, addMs(input.now, computeBackoffMs(entry.attempts)));
        report.kept += 1;
      } else if (isSequenceTakenDetail(outcome.detail)) {
        await input.outbox.resequence(
          entry.idempotencyKey,
          (sequence) => rebuild(entry.compilation, sequence),
          input.now,
        );
        report.resequenced += 1;
      } else {
        await input.outbox.dropEntry(entry.idempotencyKey);
        input.ledger.record("rejected");
        report.dropped += 1;
      }
    } catch {
      report.kept += 1;
    }
  }
  return { ...report };
}

/**
 * Build the collector-health input: the queue depth plus the ledger's whole
 * drops, with the durable `queue_gap` truth (currently missing sequences)
 * overlaid — a restored backup or a resequenced entry is reported as a gap
 * count here, never silent, and recomputed from state on every pass so it
 * survives restarts without double counting.
 */
export function healthInputOf(
  stats: { readonly pendingCount: number },
  gaps: readonly QueueGap[],
  ledger: DropLedger,
): CollectorHealthInput {
  const droppedByReason: Record<string, number> = { ...ledger.snapshot() };
  const missing = gaps.reduce((total, gap) => total + gap.missing.length, 0);
  if (missing > 0) droppedByReason["queue_gap"] = missing;
  return { pendingCount: stats.pendingCount, droppedByReason };
}
