/**
 * The Company-side Collector client (Story 6.3): the seam the Guidance and
 * Gate record paths call after their local appends. Every method is awaited
 * on the hot path but never touches the network — it only projects (the 6.2
 * chokepoint) and enqueues locally — and never throws: any failure (a bad
 * builder, a down database, a missing agent tool) fires the ids-only
 * `onError` hook and leaves the already-computed serve/runner result
 * unchanged. Delivery happens in `flushNow`, called from a background
 * flusher the service owns — never from serve/runner.
 */
import type { Compilation, GuidanceEvent, UuidV7 } from "@domain-harness/contract";
import type {
  CollectorOutbox,
  FlushReport,
  GateRunRecordInput,
  PushCompilationInput,
  PushResult,
} from "@domain-harness/collector";
import {
  DropLedger,
  flushOnce,
  healthInputOf,
  projectGateRunCompilation,
  projectGuidanceCompilation,
} from "@domain-harness/collector";
import type { CollectorHealthInput } from "@domain-harness/collector";

/** The structural seam serve/runner depend on (fakes satisfy it in tests). */
export interface CollectorSubmission {
  recordGuidance(event: GuidanceEvent, agentToolFallback?: string): Promise<void>;
  recordGateRun(run: GateRunRecordInput, agentToolName: string | null): Promise<void>;
}

/** Ids-only client failure hook: never the subject text, never the payload. */
export interface CollectorErrorInput {
  readonly applicationId: UuidV7 | null;
  readonly stage: "project" | "enqueue" | "flush";
  readonly error: unknown;
}

export interface CollectorClientInput {
  readonly outbox: CollectorOutbox;
  /** The tenant service credential: HMAC key for subjects and bearer for ingest, treated opaquely. */
  readonly tenantKey: string;
  /** Outbound base URL of the panel, no trailing slash. */
  readonly panelBaseUrl: string;
  readonly pushTimeoutMs?: number;
  /** UTC ISO clock for enqueue stamps; defaults to wall-clock time (tests pin it). */
  readonly now?: (() => string) | undefined;
  readonly onError?: ((input: CollectorErrorInput) => void) | undefined;
}

function nowIso(): string {
  return new Date().toISOString();
}

export class CollectorClient implements CollectorSubmission {
  private readonly outbox: CollectorOutbox;
  private readonly tenantKey: string;
  private readonly panelBaseUrl: string;
  private readonly pushTimeoutMs: number | undefined;
  private readonly clock: () => string;
  private readonly onError: ((input: CollectorErrorInput) => void) | undefined;
  /** The client's whole-payload drops (`schema_failed` pre-send, `rejected` on registry refusal). */
  readonly ledger = new DropLedger();

  constructor(input: CollectorClientInput) {
    this.outbox = input.outbox;
    this.tenantKey = input.tenantKey;
    this.panelBaseUrl = input.panelBaseUrl;
    this.pushTimeoutMs = input.pushTimeoutMs;
    this.clock = input.now ?? nowIso;
    this.onError = input.onError;
  }

  private fail(applicationId: UuidV7 | null, stage: CollectorErrorInput["stage"], error: unknown): void {
    try {
      this.onError?.({ applicationId, stage, error });
    } catch {
      // The hook never breaks the typed answer either.
    }
  }

  /**
   * Project a recorded Guidance event and enqueue it. The agent tool
   * defaults to `event.agentTool` verbatim when non-null (the 6.2 rule);
   * without any tool the entry cannot validate, so it is skipped loudly
   * through `onError` rather than enqueued half-formed.
   */
  async recordGuidance(event: GuidanceEvent, agentToolFallback?: string): Promise<void> {
    await Promise.resolve();
    const agentToolName = event.agentTool ?? agentToolFallback ?? null;
    if (agentToolName === null) {
      this.fail(event.applicationId, "project", new Error("collector: no agent tool for this Guidance event"));
      return;
    }
    try {
      await this.outbox.enqueue(
        event.applicationId,
        (sequence) => projectGuidanceCompilation(event, { sequence, tenantKey: this.tenantKey, agentToolName }),
        this.clock(),
      );
    } catch (error) {
      this.fail(event.applicationId, "enqueue", error);
    }
  }

  /**
   * Project an appended Gate run and enqueue it. A `null` agent tool means
   * the caller could not resolve one; the entry is skipped loudly rather
   * than enqueued half-formed.
   */
  async recordGateRun(run: GateRunRecordInput, agentToolName: string | null): Promise<void> {
    await Promise.resolve();
    if (agentToolName === null) {
      this.fail(run.applicationId, "project", new Error("collector: no agent tool for this Gate run"));
      return;
    }
    try {
      await this.outbox.enqueue(
        run.applicationId,
        (sequence) => projectGateRunCompilation(run, { sequence, agentToolName }),
        this.clock(),
      );
    } catch (error) {
      this.fail(run.applicationId, "enqueue", error);
    }
  }

  /** Enqueue any caller-built Compilation (deviations, refusals, health) under the outbox sequence. */
  async submit(
    applicationId: UuidV7,
    build: (sequence: number) => Compilation,
  ): Promise<void> {
    try {
      await this.outbox.enqueue(applicationId, build, this.clock());
    } catch (error) {
      this.fail(applicationId, "enqueue", error);
    }
  }

  /**
   * One background delivery pass over the outbox (the panel base URL and
   * tenant credential are the client's). Never throws; failures stay queued
   * for the next pass.
   */
  async flushNow(
    now: string,
    push?: (input: PushCompilationInput) => Promise<PushResult>,
  ): Promise<FlushReport> {
    try {
      return await flushOnce({
        outbox: this.outbox,
        ...(push === undefined ? {} : { push }),
        baseUrl: this.panelBaseUrl,
        credential: this.tenantKey,
        ...(this.pushTimeoutMs === undefined ? {} : { timeoutMs: this.pushTimeoutMs }),
        now,
        ledger: this.ledger,
      });
    } catch (error) {
      this.fail(null, "flush", error);
      return { attempted: 0, sent: 0, kept: 0, dropped: 0, resequenced: 0 };
    }
  }

  /** The `{pendingCount, droppedByReason}` input of the next collector-health projection, gaps included. */
  async collectorHealth(): Promise<CollectorHealthInput> {
    const [stats, gaps] = await Promise.all([this.outbox.stats(), this.outbox.detectGaps()]);
    return healthInputOf(stats, gaps, this.ledger);
  }
}
