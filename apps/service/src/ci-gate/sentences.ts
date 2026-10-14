/**
 * The fixed UX-DR29 sentences for the CI Gate, moved verbatim into the
 * shared Gate package (Story 5.4): every sentence constant, the `sentences`
 * map and the `SentenceKey` now live in `@domain-harness/gate`, one source
 * for every adapter; this file re-exports them so the landed surface and its
 * pinning test keep working unchanged.
 */
export {
  PASS,
  FAIL,
  UNBOUND,
  MISSING_IDENTIFICATION_FILE,
  DUPLICATE_APPLICATION_ID,
  RUN_DID_NOT_COMPLETE,
  EFFECTIVE_STANDARD_SET_COULD_NOT_BE_READ,
  BUNDLE_STALE,
  BUNDLE_VERIFICATION_FAILED,
  STEP_CANNOT_RUN,
  sentences,
} from "@domain-harness/gate";
export type { SentenceKey } from "@domain-harness/gate";
