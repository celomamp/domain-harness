import { evaluateDeviations } from "@domain-harness/core";
import type {
  Deviation,
  RevisionFacts,
  UuidV7,
} from "@domain-harness/contract";
import { isEffectiveStandardSet, isRevisionFacts } from "@domain-harness/contract";
import { DEFAULT_STALENESS_BOUND_HOURS, loadBundleSnapshot, applicationIdsOf } from "./bundle.ts";
import type { BundleSource } from "./bundle.ts";
import {
  PASS,
  FAIL,
  UNBOUND,
  DUPLICATE_APPLICATION_ID,
  RUN_DID_NOT_COMPLETE,
  EFFECTIVE_STANDARD_SET_COULD_NOT_BE_READ,
  BUNDLE_STALE,
  BUNDLE_VERIFICATION_FAILED,
} from "./sentences.ts";
import type { GateRecordStore, GateRunRecordInput } from "./store.ts";

export interface RunGateInput {
  readonly applicationId: UuidV7 | string;
  readonly repoFingerprint: string;
  readonly facts: RevisionFacts;
  readonly revision: string;
  readonly now?: string;
  readonly source: BundleSource;
  readonly store: GateRecordStore;
}

export interface RunGateOutcome {
  readonly ok: boolean;
  readonly kind: "pass" | "fail" | "refusal";
  readonly exitCode: number;
  readonly sentence: string;
  readonly deviationLines: readonly string[];
  readonly deviations: readonly Deviation[];
  readonly checked: number;
  readonly open: number;
  readonly adherence: number;
  readonly pinnedHash: string | null;
  readonly sequence: number | null;
  readonly bindingRefusal: unknown;
}

function nowIso(): string {
  return new Date().toISOString();
}

function refusal(sentence: string, extra: Partial<RunGateOutcome> = {}): RunGateOutcome {
  return {
    ok: false,
    kind: "refusal",
    exitCode: 1,
    sentence,
    deviationLines: [],
    deviations: [],
    checked: 0,
    open: 0,
    adherence: 0,
    pinnedHash: null,
    sequence: null,
    bindingRefusal: null,
    ...extra,
  };
}

export function formatDeviationLine(deviation: Deviation): string {
  const slot = `${deviation.slot.moduleKind}/${deviation.slot.slotKind}/${deviation.slot.name}`;
  return `${deviation.standardId} ${slot} ${deviation.subject}: ${deviation.correction}`;
}

export async function runGate(input: RunGateInput): Promise<RunGateOutcome> {
  const store = input.store;
  const applicationId = input.applicationId as UuidV7;
  const repoFingerprint = input.repoFingerprint;

  const now = input.now ?? nowIso();

  let outcome;
  try {
    outcome = await loadBundleSnapshot(input.source);
  } catch {
    return refusal(RUN_DID_NOT_COMPLETE);
  }

  if (!outcome.ok) {
    if (outcome.reason === "missing-set") {
      return refusal(EFFECTIVE_STANDARD_SET_COULD_NOT_BE_READ);
    }
    return refusal(BUNDLE_VERIFICATION_FAILED);
  }

  const snapshot = outcome.snapshot;

  const ids = applicationIdsOf(snapshot);
  if (!ids.includes(String(applicationId)) || repoFingerprint.trim() === "") {
    return refusal(UNBOUND);
  }

  if (!isEffectiveStandardSet(snapshot.effectiveSet)) {
    return refusal(EFFECTIVE_STANDARD_SET_COULD_NOT_BE_READ);
  }

  const boundHours = snapshot.stalenessBoundHours ?? DEFAULT_STALENESS_BOUND_HOURS;
  const issuedMs = Date.parse(snapshot.issuedAt);
  const nowMs = Date.parse(now);
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
    return refusal(BUNDLE_STALE);
  }

  if (!isRevisionFacts(input.facts) || input.facts.unreadable.length > 0) {
    return refusal(RUN_DID_NOT_COMPLETE);
  }

  try {
    const existing = await store.getBinding(applicationId);
    const binding = existing ?? (await store.bindApplication(applicationId, repoFingerprint));
    if (binding.fingerprint !== "" && binding.fingerprint !== repoFingerprint) {
      await store.recordBindingRefusal({
        applicationId,
        presentedFingerprint: repoFingerprint,
        boundFingerprint: binding.fingerprint,
      });
      return refusal(DUPLICATE_APPLICATION_ID, {
        bindingRefusal: {
          applicationId,
          presentedFingerprint: repoFingerprint,
          boundFingerprint: binding.fingerprint,
        },
      });
    }
  } catch {
    return refusal(RUN_DID_NOT_COMPLETE);
  }

  let evalResult: ReturnType<typeof evaluateDeviations>;
  try {
    evalResult = evaluateDeviations({
      applicationId,
      facts: input.facts,
      effectiveSet: snapshot.effectiveSet,
      accepted: snapshot.accepted,
      now,
    });
  } catch {
    evalResult = { ok: false, error: { code: "x", message: "x", subject: "x" } };
  }

  if (!evalResult.ok) {
    return refusal(RUN_DID_NOT_COMPLETE);
  }

  const deviations = evalResult.deviations;
  const checked = evalResult.checked;
  const open = evalResult.open;
  const adherence = evalResult.adherence;
  const lines = deviations.filter((d) => d.status === "open").map(formatDeviationLine);

  const hasOpen = open > 0;
  const sentence = hasOpen ? FAIL : PASS;
  let sequence: number;
  try {
    const gateRunInput: GateRunRecordInput = {
      applicationId,
      revision: input.revision,
      bundleHash: snapshot.hash,
      extractorVersion: input.facts.extractorVersion,
      deviations,
      checked,
      open,
      adherence,
    };
    const appended = await store.appendGateRun(gateRunInput);
    sequence = appended.sequence;
  } catch {
    return refusal(RUN_DID_NOT_COMPLETE);
  }
  return {
    ok: !hasOpen,
    kind: hasOpen ? "fail" : "pass",
    exitCode: hasOpen ? 1 : 0,
    sentence,
    deviationLines: lines,
    deviations,
    checked,
    open,
    adherence,
    pinnedHash: snapshot.hash,
    sequence,
    bindingRefusal: null,
  };
}
