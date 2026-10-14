/**
 * The canonical Gate result (Story 5.4) and its byte serializer.
 *
 * Every adapter returns its own rich shape (the service runner's
 * `RunGateOutcome`, the direct adapter's {@link GateOutcome}, Epic 8's CLI
 * result); the cross-adapter proof compares nothing but the observable Gate
 * result, pulled once through {@link canonicalGateBytes} — the one serializer
 * whose key order is fixed. The store-assigned sequence and the
 * binding-refusal payload are record-keeping, not part of the run's
 * observable result, and are excluded from the byte form (their behavior
 * stays covered by story 5.3's suites).
 */
import type { Deviation } from "@domain-harness/contract";
import {
  BUNDLE_STALE,
  BUNDLE_VERIFICATION_FAILED,
  DUPLICATE_APPLICATION_ID,
  EFFECTIVE_STANDARD_SET_COULD_NOT_BE_READ,
  RUN_DID_NOT_COMPLETE,
  UNBOUND,
} from "./sentences.ts";

/** Why a run was refused: one cause per refusal, in the runner's order. */
export const GATE_REFUSAL_REASONS = [
  "bundle-verification-failed",
  "set-unreadable",
  "unbound",
  "stale",
  "run-did-not-complete",
  "duplicate",
] as const;
export type GateRefusalReason = (typeof GATE_REFUSAL_REASONS)[number];

/** The refusal sentence each refusal reason prints, both adapters alike. */
export const REFUSAL_SENTENCE_BY_REASON: Readonly<Record<GateRefusalReason, string>> = {
  "bundle-verification-failed": BUNDLE_VERIFICATION_FAILED,
  "set-unreadable": EFFECTIVE_STANDARD_SET_COULD_NOT_BE_READ,
  unbound: UNBOUND,
  stale: BUNDLE_STALE,
  "run-did-not-complete": RUN_DID_NOT_COMPLETE,
  duplicate: DUPLICATE_APPLICATION_ID,
};

/** The inverse map: the refusal reason a refusal sentence names. */
export const REFUSAL_REASON_BY_SENTENCE: ReadonlyMap<string, GateRefusalReason> = new Map(
  Object.entries(REFUSAL_SENTENCE_BY_REASON).map(([reason, sentence]) => [sentence, reason as GateRefusalReason]),
);

/** Which keys the byte form carries, in exactly this order. */
export const CANONICAL_GATE_KEYS = [
  "kind",
  "exitCode",
  "sentence",
  "deviationLines",
  "deviations",
  "checked",
  "open",
  "adherence",
  "pinnedHash",
] as const;
export type CanonicalGateKey = (typeof CANONICAL_GATE_KEYS)[number];

/**
 * The one canonical serialized form of a Gate result: an explicitly
 * constructed fixed-key-order object serialized to JSON. Any adapter result
 * supplying these fields serializes to byte-identical output.
 */
export interface CanonicalGateResult {
  readonly kind: "pass" | "fail" | "refusal";
  readonly exitCode: number;
  readonly sentence: string;
  readonly deviationLines: readonly string[];
  /** The evaluator's sorted, deduplicated output, untouched. */
  readonly deviations: readonly Deviation[];
  readonly checked: number;
  readonly open: number;
  readonly adherence: number;
  readonly pinnedHash: string | null;
}

/**
 * The direct in-process adapter's result: the canonical observable result
 * plus the refusal reason the adapter itself classified. Its classification
 * mirrors `runGate`'s order and fail-closed semantics; the fixture suite
 * proves the two agree.
 */
export interface GateOutcome extends CanonicalGateResult {
  readonly refusalReason: GateRefusalReason | null;
}

/** Serialize a Gate result to the canonical bytes. The one serializer the byte comparison uses. */
export function canonicalGateBytes(result: CanonicalGateResult): string {
  return JSON.stringify({
    kind: result.kind,
    exitCode: result.exitCode,
    sentence: result.sentence,
    deviationLines: [...result.deviationLines],
    deviations: result.deviations,
    checked: result.checked,
    open: result.open,
    adherence: result.adherence,
    pinnedHash: result.pinnedHash,
  });
}

/**
 * The printed form of one Deviation log line: Standard id, Conflict slot,
 * subject, then the Correction instruction. Fixed here so every adapter's
 * lines match byte for byte; the service runner's own `formatDeviationLine`
 * must stay identical, and the cross-adapter suite fails if either drifts.
 */
export function formatDeviationLine(deviation: Deviation): string {
  const slot = `${deviation.slot.moduleKind}/${deviation.slot.slotKind}/${deviation.slot.name}`;
  return `${deviation.standardId} ${slot} ${deviation.subject}: ${deviation.correction}`;
}
