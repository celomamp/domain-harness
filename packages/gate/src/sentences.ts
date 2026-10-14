/**
 * The fixed UX-DR29 sentences for the CI Gate. Every refusal prints exactly
 * one of these strings; the keys never name a plan.
 *
 * Moved verbatim from `apps/service/src/ci-gate/sentences.ts` (Story 5.4):
 * this module is the one shared source, and the service file re-exports it so
 * its pinning test keeps proving no drift.
 */

/** One passing run: no open Deviation (and no refusal). */
export const PASS = "pass";

/** A run with one or more open Deviations. */
export const FAIL = "fail";

/** Application id absent from the bundle / missing repository commit. */
export const UNBOUND = "unbound Application";

/** Missing or unreadable identification file. */
export const MISSING_IDENTIFICATION_FILE = "missing or unreadable identification file";

/** Duplicate Application id presented with a different fingerprint. */
export const DUPLICATE_APPLICATION_ID = "duplicate Application id";

/** Evaluation did not complete. */
export const RUN_DID_NOT_COMPLETE = "run did not complete";

/** Effective Standard set could not be read. */
export const EFFECTIVE_STANDARD_SET_COULD_NOT_BE_READ = "Effective Standard set could not be read";

/** Bundle past its staleness bound with no live freeze. */
export const BUNDLE_STALE = "bundle stale";

/** Bundle failed verification. */
export const BUNDLE_VERIFICATION_FAILED = "bundle verification failed";

/** The step could not run at all (store, snapshot, environment). */
export const STEP_CANNOT_RUN = "the step cannot run";

export const sentences = {
  pass: PASS,
  fail: FAIL,
  unbound: UNBOUND,
  missingOrUnreadableIdentificationFile: MISSING_IDENTIFICATION_FILE,
  duplicateApplicationId: DUPLICATE_APPLICATION_ID,
  runDidNotComplete: RUN_DID_NOT_COMPLETE,
  effectiveStandardSetCouldNotBeRead: EFFECTIVE_STANDARD_SET_COULD_NOT_BE_READ,
  bundleStale: BUNDLE_STALE,
  bundleVerificationFailed: BUNDLE_VERIFICATION_FAILED,
  stepCannotRun: STEP_CANNOT_RUN,
} as const;

export type SentenceKey = keyof typeof sentences;
