/**
 * The direct in-process Gate adapter (Story 5.4): the Gate surface every
 * adapter shares, run in-process with no database and no environment.
 *
 * It reuses `@domain-harness/extractor` for facts and `@domain-harness/core`
 * for evaluation exactly as the service path does, and never re-sorts,
 * re-implements or post-processes the evaluator's output. Its own
 * classification logic — source outcome mapping, unbound/set/staleness
 * refusals, binding-ledger checks — mirrors the service runner's order and
 * fail-closed semantics; the deterministic fixture suite fails at the byte
 * comparison if either path's ordering or text drifts. It never throws.
 */
import type { UuidV7 } from "@domain-harness/contract";
import { isEffectiveStandardSet, isRevisionFacts } from "@domain-harness/contract";
import { evaluateDeviations } from "@domain-harness/core";
import { extractRevisionFacts } from "@domain-harness/extractor";
import type { BindingLedger } from "./binding.ts";
import type { GateBundle, GateBundleSnapshot } from "./fixtures.ts";
import type { GateOutcome, GateRefusalReason } from "./result.ts";
import { formatDeviationLine } from "./result.ts";
import {
  BUNDLE_STALE,
  BUNDLE_VERIFICATION_FAILED,
  DUPLICATE_APPLICATION_ID,
  EFFECTIVE_STANDARD_SET_COULD_NOT_BE_READ,
  FAIL,
  PASS,
  RUN_DID_NOT_COMPLETE,
  UNBOUND,
} from "./sentences.ts";

/** Default staleness bound in hours when the snapshot omits `stalenessBoundHours` (AD-21). */
export const DEFAULT_STALENESS_BOUND_HOURS = 24;

export interface RunGateDirectInput {
  /** The Application the run is evaluated for, as defined by the fixture. */
  readonly applicationId: UuidV7 | string;
  readonly repoFingerprint: string;
  /** The revision's file contents; the extractor is a pure function of these. */
  readonly files: Readonly<Record<string, string>>;
  readonly bundle: GateBundle;
  /** The binding-ledger state the run starts from (TOFU binding happens here, as on the service path). */
  readonly ledger: BindingLedger;
  /** The run time; the core never reads a clock. */
  readonly now: string;
}

function refusal(sentence: string, reason: GateRefusalReason): GateOutcome {
  return {
    kind: "refusal",
    refusalReason: reason,
    exitCode: 1,
    sentence,
    deviationLines: [],
    deviations: [],
    checked: 0,
    open: 0,
    adherence: 0,
    pinnedHash: null,
  };
}

/** Mirror of the service runner's `applicationIdsOf`: ids may be strings or singleton records. */
function applicationIdsOf(snapshot: GateBundleSnapshot): ReadonlyArray<string> {
  if (!Array.isArray(snapshot.applications)) return [];
  return snapshot.applications.map((item) => {
    if (typeof item === "string") return item;
    if (typeof item === "object" && item !== null && !Array.isArray(item)) {
      const record = item as Record<string, unknown>;
      if (typeof record["id"] === "string") return record["id"];
      if (typeof record["applicationId"] === "string") return record["applicationId"];
    }
    return String(item);
  });
}

/**
 * Run the Gate in-process over the supplied revision files, bundle and
 * binding ledger, classifying refusals in the service runner's exact order
 * and fail-closed semantics: source → unbound → set guard → stale → facts
 * guard → binding/TOFU → evaluate → outcome. Returns a canonical
 * {@link GateOutcome}; never throws.
 */
export async function runGateDirect(input: RunGateDirectInput): Promise<GateOutcome> {
  const applicationId = input.applicationId as UuidV7;
  const repoFingerprint = input.repoFingerprint;

  let bundle: GateBundle;
  try {
    bundle = { ...input.bundle };
  } catch {
    bundle = { variant: "verify-failed" };
  }

  if (bundle.variant === "verify-failed") {
    return refusal(BUNDLE_VERIFICATION_FAILED, "bundle-verification-failed");
  }
  if (bundle.variant === "missing-set") {
    return refusal(EFFECTIVE_STANDARD_SET_COULD_NOT_BE_READ, "set-unreadable");
  }
  // Every other bundle shape is malformed (a null bundle, a snapshot-less
  // `{ variant: "snapshot" }`, an unknown variant): fail closed exactly as
  // the service path's malformed-record outcome does, never throw.
  const bundleRecord: unknown = bundle;
  if (
    typeof bundleRecord !== "object" ||
    bundleRecord === null ||
    Array.isArray(bundleRecord) ||
    (bundleRecord as { variant?: unknown }).variant !== "snapshot"
  ) {
    return refusal(BUNDLE_VERIFICATION_FAILED, "bundle-verification-failed");
  }
  const snapshotRecord: unknown = (bundleRecord as { snapshot?: unknown }).snapshot;
  if (typeof snapshotRecord !== "object" || snapshotRecord === null || Array.isArray(snapshotRecord)) {
    return refusal(BUNDLE_VERIFICATION_FAILED, "bundle-verification-failed");
  }

  const snapshot = snapshotRecord as GateBundleSnapshot;

  const ids = applicationIdsOf(snapshot);
  if (!ids.includes(String(applicationId)) || repoFingerprint.trim() === "") {
    return refusal(UNBOUND, "unbound");
  }

  if (!isEffectiveStandardSet(snapshot.effectiveSet)) {
    return refusal(EFFECTIVE_STANDARD_SET_COULD_NOT_BE_READ, "set-unreadable");
  }

  const boundHours = snapshot.stalenessBoundHours ?? DEFAULT_STALENESS_BOUND_HOURS;
  const issuedMs = Date.parse(snapshot.issuedAt);
  const nowMs = Date.parse(input.now);
  const ageOk =
    Number.isFinite(issuedMs) &&
    Number.isFinite(nowMs) &&
    nowMs >= issuedMs &&
    nowMs - issuedMs <= boundHours * 60 * 60 * 1000;
  let frozen = false;
  if (!ageOk) {
    const freezeMs = snapshot.frozenUntil ? Date.parse(snapshot.frozenUntil) : Number.NaN;
    frozen = Number.isFinite(freezeMs) && Number.isFinite(nowMs) && freezeMs >= nowMs;
  }
  if (!ageOk && !frozen) {
    return refusal(BUNDLE_STALE, "stale");
  }

  let facts: ReturnType<typeof extractRevisionFacts>;
  try {
    facts = extractRevisionFacts({ ...input.files });
  } catch {
    return refusal(RUN_DID_NOT_COMPLETE, "run-did-not-complete");
  }
  if (!isRevisionFacts(facts) || facts.unreadable.length > 0) {
    return refusal(RUN_DID_NOT_COMPLETE, "run-did-not-complete");
  }

  try {
    const existing = await input.ledger.getBinding(applicationId);
    const binding = existing ?? (await input.ledger.bindApplication(applicationId, repoFingerprint));
    if (binding.fingerprint !== "" && binding.fingerprint !== repoFingerprint) {
      await input.ledger.recordBindingRefusal({
        applicationId,
        presentedFingerprint: repoFingerprint,
        boundFingerprint: binding.fingerprint,
      });
      return refusal(DUPLICATE_APPLICATION_ID, "duplicate");
    }
  } catch {
    return refusal(RUN_DID_NOT_COMPLETE, "run-did-not-complete");
  }

  let evalResult: ReturnType<typeof evaluateDeviations>;
  try {
    evalResult = evaluateDeviations({
      applicationId,
      facts,
      effectiveSet: snapshot.effectiveSet,
      accepted: snapshot.accepted,
      now: input.now,
    });
  } catch {
    evalResult = { ok: false, error: { code: "x", message: "x", subject: "x" } };
  }

  if (!evalResult.ok) {
    return refusal(RUN_DID_NOT_COMPLETE, "run-did-not-complete");
  }

  const deviations = evalResult.deviations;
  const checked = evalResult.checked;
  const open = evalResult.open;
  const adherence = evalResult.adherence;
  const lines = deviations.filter((deviation) => deviation.status === "open").map(formatDeviationLine);

  const hasOpen = open > 0;
  return {
    kind: hasOpen ? "fail" : "pass",
    refusalReason: null,
    exitCode: hasOpen ? 1 : 0,
    sentence: hasOpen ? FAIL : PASS,
    deviationLines: lines,
    deviations,
    checked,
    open,
    adherence,
    pinnedHash: snapshot.hash,
  };
}
