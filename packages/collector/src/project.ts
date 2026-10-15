/**
 * The only record-to-Compilation projection (Story 6.2): one pure function
 * per Compilation type of the 6.1 catalog. Every projected Compilation is
 * asserted through the published contract guard before return; a guard
 * failure throws an internal error, never a partial Compilation.
 *
 * Record shapes cross as structural inputs (never imported from `apps/*`):
 * the service-local stores own their rows, the collector owns the projection.
 */
import { createHmac } from "node:crypto";
import {
  BINDING_REFUSAL_COMPILATION_SCHEMA_VERSION,
  BUNDLE_STATUS_COMPILATION_SCHEMA_VERSION,
  COLLECTOR_HEALTH_COMPILATION_SCHEMA_VERSION,
  COMPILATION_CATALOG_VERSION,
  DEVIATION_COMPILATION_SCHEMA_VERSION,
  GATE_RUN_COMPILATION_SCHEMA_VERSION,
  GUIDANCE_COMPILATION_SCHEMA_VERSION,
  isBindingRefusalCompilation,
  isBundleStatusCompilation,
  isCollectorHealthCompilation,
  isDeviationCompilation,
  isGateRunCompilation,
  isGuidanceCompilation,
  isGuidanceCompilationSubject,
} from "@domain-harness/contract";
import type {
  BindingRefusalCompilation,
  BundleStatusCompilation,
  CollectorHealthCompilation,
  Deviation,
  DeviationCompilation,
  GateRunCompilation,
  GateRunDeviationSummary,
  GuidanceCompilation,
  GuidanceCompilationSubject,
  GuidanceEvent,
  GuidanceUnboundReason,
  UuidV7,
} from "@domain-harness/contract";
import { mintUuidV7 } from "./ids.ts";

/** A Gate run as the record store holds it: the fields the projection reads. */
export interface GateRunRecordInput {
  readonly applicationId: UuidV7;
  readonly revision: string;
  readonly deviations: readonly Deviation[];
  readonly checked: number;
  readonly open: number;
  readonly createdAt: string;
}

/** The live binding-refusal outcome: reason plus its fixed sentence. */
export interface BindingRefusalInput {
  readonly reason: GuidanceUnboundReason;
  readonly sentence: string;
}

/** The active bundle's hash, sequence and issue instant (6.3 wires these to the bundle store). */
export interface BundleStatusInput {
  readonly bundleHash: string;
  readonly bundleSequence: number;
  readonly issuedAt: string;
}

/** The queue depth and the whole-payload drops by reason (no queue exists yet, so callers pass pending 0). */
export interface CollectorHealthInput {
  readonly pendingCount: number;
  readonly droppedByReason: Readonly<Record<string, number>>;
}

/**
 * Guidance projection context: the caller-supplied per-Application `sequence`
 * (one global counter owned by the collector, never the record store's
 * per-type sequence), the tenant service credential as the HMAC key, and the
 * `agentToolName` fallback used only when the event predates agent-tool
 * generation (`event.agentTool` is `null`).
 */
export interface GuidanceProjectionContext {
  readonly sequence: number;
  readonly tenantKey: string;
  readonly agentToolName?: string;
}

/** Gate-run projection context: the caller-supplied sequence and agent tool. */
export interface GateRunProjectionContext {
  readonly sequence: number;
  readonly agentToolName: string;
}

/**
 * Projection context for records carrying no Application, agent tool or
 * instant of their own: the caller supplies all three plus the sequence.
 */
export interface RecordProjectionContext {
  readonly applicationId: UuidV7;
  readonly agentToolName: string;
  readonly sequence: number;
  readonly occurredAt: string;
}

/** HMAC-SHA256 of `subject` keyed by the tenant service credential, 64 lowercase hex. */
export function hashGuidanceSubject(subject: string, tenantKey: string): string {
  if (tenantKey === "") {
    throw new Error("collector: guidance hashing needs a non-empty tenantKey");
  }
  return createHmac("sha256", tenantKey).update(subject, "utf8").digest("hex");
}

/**
 * Project a Guidance subject: it crosses as `{kind: "slot-token"}` only when
 * the subject already satisfies the catalog grammar — decided by feeding the
 * slot-token candidate through the contract's own
 * `isGuidanceCompilationSubject` (the guard IS the grammar, so projector and
 * registry validator can never drift) — otherwise as `{kind:
 * "subject-hash"}`. Raw subject text never crosses.
 */
export function projectGuidanceSubject(subject: string, tenantKey: string): GuidanceCompilationSubject {
  if (tenantKey === "") {
    throw new Error("collector: guidance projection needs a non-empty tenantKey");
  }
  const candidate = { kind: "slot-token", slotToken: subject } as const;
  if (isGuidanceCompilationSubject(candidate)) {
    return { kind: "slot-token", slotToken: subject };
  }
  return { kind: "subject-hash", hash: hashGuidanceSubject(subject, tenantKey) };
}

function envelope(input: {
  readonly applicationId: UuidV7;
  readonly agentToolName: string;
  readonly occurredAt: string;
  readonly sequence: number;
}): {
  readonly catalogVersion: string;
  readonly idempotencyKey: UuidV7;
  readonly applicationId: UuidV7;
  readonly agentToolName: string;
  readonly occurredAt: string;
  readonly sequence: number;
} {
  return {
    catalogVersion: COMPILATION_CATALOG_VERSION,
    idempotencyKey: mintUuidV7(),
    applicationId: input.applicationId,
    agentToolName: input.agentToolName,
    occurredAt: input.occurredAt,
    sequence: input.sequence,
  };
}

function internalError(type: string): Error {
  return new Error(`collector: projected ${type} Compilation failed its contract guard`);
}

/**
 * Project a Guidance event: tool and hit/miss outcome verbatim, the subject as
 * a slot token or a tenant-keyed hash. `agentToolName` defaults to
 * `event.agentTool` verbatim when non-null; the caller supplies it otherwise.
 * `occurredAt` is the record's `createdAt`; `sequence` is caller-supplied.
 */
export function projectGuidanceCompilation(
  event: GuidanceEvent,
  ctx: GuidanceProjectionContext,
): GuidanceCompilation {
  const agentToolName = event.agentTool ?? ctx.agentToolName;
  if (agentToolName === undefined) {
    throw new Error("collector: guidance projection needs agentToolName when the event predates agent-tool generation");
  }
  const compilation: GuidanceCompilation = {
    type: "guidance",
    schemaVersion: GUIDANCE_COMPILATION_SCHEMA_VERSION,
    ...envelope({
      applicationId: event.applicationId,
      agentToolName,
      occurredAt: event.createdAt,
      sequence: ctx.sequence,
    }),
    tool: event.tool,
    outcome: event.outcome.kind,
    subject: projectGuidanceSubject(event.subject, ctx.tenantKey),
  };
  if (!isGuidanceCompilation(compilation)) throw internalError("guidance");
  return compilation;
}

/**
 * Project a Gate run: revision verbatim, verdict `fail` when at least one
 * Deviation is still open, checked/open counts verbatim, and the per-Deviation
 * match keys (standardId, slot, subject, status) so Adherence is derivable.
 */
export function projectGateRunCompilation(
  run: GateRunRecordInput,
  ctx: GateRunProjectionContext,
): GateRunCompilation {
  const deviations: readonly GateRunDeviationSummary[] = run.deviations.map((deviation) => ({
    standardId: deviation.standardId,
    slot: { ...deviation.slot },
    subject: deviation.subject,
    status: deviation.status,
  }));
  const compilation: GateRunCompilation = {
    type: "gate_run",
    schemaVersion: GATE_RUN_COMPILATION_SCHEMA_VERSION,
    ...envelope({
      applicationId: run.applicationId,
      agentToolName: ctx.agentToolName,
      occurredAt: run.createdAt,
      sequence: ctx.sequence,
    }),
    revision: run.revision,
    verdict: run.open > 0 ? "fail" : "pass",
    checkedCount: run.checked,
    openCount: run.open,
    deviations,
  };
  if (!isGateRunCompilation(compilation)) throw internalError("gate_run");
  return compilation;
}

/** Project a Deviation, reusing it inline (no new deviation model). */
export function projectDeviationCompilation(
  deviation: Deviation,
  ctx: RecordProjectionContext,
): DeviationCompilation {
  const compilation: DeviationCompilation = {
    type: "deviation",
    schemaVersion: DEVIATION_COMPILATION_SCHEMA_VERSION,
    ...envelope(ctx),
    deviation: { ...deviation, slot: { ...deviation.slot } },
  };
  if (!isDeviationCompilation(compilation)) throw internalError("deviation");
  return compilation;
}

/**
 * Project a binding refusal from the live `{reason, sentence}` outcome — never
 * the stored fingerprint rows (those carry fingerprints but no reason or sentence).
 */
export function projectBindingRefusalCompilation(
  input: BindingRefusalInput,
  ctx: RecordProjectionContext,
): BindingRefusalCompilation {
  const compilation: BindingRefusalCompilation = {
    type: "binding_refusal",
    schemaVersion: BINDING_REFUSAL_COMPILATION_SCHEMA_VERSION,
    ...envelope(ctx),
    reason: input.reason,
    sentence: input.sentence,
  };
  if (!isBindingRefusalCompilation(compilation)) throw internalError("binding_refusal");
  return compilation;
}

/** Project the active bundle's hash, sequence and issue instant. */
export function projectBundleStatusCompilation(
  input: BundleStatusInput,
  ctx: RecordProjectionContext,
): BundleStatusCompilation {
  const compilation: BundleStatusCompilation = {
    type: "bundle_status",
    schemaVersion: BUNDLE_STATUS_COMPILATION_SCHEMA_VERSION,
    ...envelope(ctx),
    bundleHash: input.bundleHash,
    bundleSequence: input.bundleSequence,
    issuedAt: input.issuedAt,
  };
  if (!isBundleStatusCompilation(compilation)) throw internalError("bundle_status");
  return compilation;
}

/** Project the queue depth and the whole-payload drops by reason. */
export function projectCollectorHealthCompilation(
  input: CollectorHealthInput,
  ctx: RecordProjectionContext,
): CollectorHealthCompilation {
  const compilation: CollectorHealthCompilation = {
    type: "collector_health",
    schemaVersion: COLLECTOR_HEALTH_COMPILATION_SCHEMA_VERSION,
    ...envelope(ctx),
    pendingCount: input.pendingCount,
    droppedByReason: { ...input.droppedByReason },
  };
  if (!isCollectorHealthCompilation(compilation)) throw internalError("collector_health");
  return compilation;
}
