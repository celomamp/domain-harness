/**
 * Guidance identity (Story 4.3): the one decision every serving surface
 * shares (AD-19). `resolveGuidanceIdentity` decides — from the presented
 * identity headers against the tenant's active bundle payload — whether the
 * call is served (`bound`, with the Project id resolved from the bundle and
 * the active bundle hash pinned), refused (`unbound` with a fixed sentence
 * or `refused` for a copied identity), and what is recorded (the refusal and
 * the advisory mismatch).
 *
 * The decision table is fixed and never throws; absence of identity values
 * is the same as an absent header:
 *   1. no fingerprint → `unbound` (commit once and retry);
 *   2. no application id → `unbound` (missing or unreadable identification
 *      file);
 *   3. id not in `payload.applications` → `unbound`; no binding changes and
 *      nothing else is resolved;
 *   4. id present: no binding yet → bind once (trust on first use; the first
 *      presented fingerprint wins) and answer `bound`; bound with a
 *      different fingerprint → record the refusal and answer `refused`;
 *      bound with the same fingerprint → `bound`.
 * An advisory Project id that disagrees with the bundle is reported in the
 * result and recorded — never used; the bundle's Project id is the one
 * returned. The advisory mismatch is evaluated and recorded ONLY on the
 * `bound` paths (where the fingerprint agreed with the binding): a `refused`
 * or `unbound` call drops it — the refusals ledger names the copied identity
 * by its fingerprints instead.
 */
import type {
  GuidanceIdentityResult,
  GuidanceUnboundReason,
  StandardBundlePayload,
  UuidV7,
} from "@domain-harness/contract";
import type { GuidanceIdentityStore } from "./store.ts";
import {
  MISSING_IDENTIFICATION_FILE,
  RUN_DID_NOT_COMPLETE,
  DUPLICATE_APPLICATION_ID,
  UNBOUND,
} from "@domain-harness/gate";

/**
 * The one sentence this unit adds (UX-DR29 keeps every other sentence fixed;
 * house precedent: new-reason constants live in the service unit). A
 * repository with no commit is the primary defect, so the commit-once
 * sentence takes precedence over everything else.
 */
export const COMMIT_ONCE = "make an initial commit and call Guidance again";

/** The identity values one Guidance call presented; `undefined` = absent header. */
export interface GuidanceIdentityHeaders {
  readonly applicationId: string | undefined;
  readonly advisoryProjectId: string | undefined;
  readonly repoFingerprint: string | undefined;
}

/** The active bundle an identity is resolved against: its payload and hash. */
export interface PinnedActiveBundle {
  readonly payload: StandardBundlePayload;
  readonly hash: string;
}

/** Input of {@link resolveGuidanceIdentity}. */
export interface ResolveGuidanceIdentityInput {
  readonly headers: GuidanceIdentityHeaders;
  readonly tenantId: UuidV7;
  readonly store: GuidanceIdentityStore;
  /**
   * The tenant's active bundle through the bundles unit (active-bundle
   * pointer → pinned bundle bytes); `null` when none is active, which no
   * application id can be found in.
   */
  readonly getPinnedBundle: (tenantId: UuidV7) => Promise<PinnedActiveBundle | null>;
}

/** The reason for the one unexpected `unbound` outcome (a store failure). */
export const UNAVAILABLE: GuidanceUnboundReason = "unavailable";

/**
 * Resolve the Guidance identity. Never throws; a failing store or bundle
 * read answers the fixed run-did-not-complete sentence without recording
 * anything. `payload.applications` is the single resolution source — never
 * the file.
 */
export async function resolveGuidanceIdentity(input: ResolveGuidanceIdentityInput): Promise<GuidanceIdentityResult> {
  try {
    return await decide(input);
  } catch {
    return { kind: "unbound", reason: UNAVAILABLE, sentence: RUN_DID_NOT_COMPLETE };
  }
}

async function decide(input: ResolveGuidanceIdentityInput): Promise<GuidanceIdentityResult> {
  const fingerprint = input.headers.repoFingerprint;
  if (fingerprint === undefined || fingerprint.trim() === "") {
    return { kind: "unbound", reason: "commit_first", sentence: COMMIT_ONCE };
  }

  const applicationId = input.headers.applicationId;
  if (applicationId === undefined || applicationId.trim() === "") {
    return { kind: "unbound", reason: "missing_identification_file", sentence: MISSING_IDENTIFICATION_FILE };
  }

  const active = (await input.getPinnedBundle(input.tenantId)) ?? null;
  const application = active?.payload.applications.find((entry) => entry.id === applicationId);
  if (active === null || application === undefined) {
    return { kind: "unbound", reason: "unknown_application", sentence: UNBOUND };
  }

  const knownApplicationId = application.id;
  const binding = (await input.store.getBinding(knownApplicationId)) ?? (await input.store.bindApplication(knownApplicationId, fingerprint));
  if (binding.fingerprint !== fingerprint) {
    await input.store.recordBindingRefusal({
      applicationId: knownApplicationId,
      presentedFingerprint: fingerprint,
      boundFingerprint: binding.fingerprint,
    });
    return {
      kind: "refused",
      sentence: DUPLICATE_APPLICATION_ID,
      presentedFingerprint: fingerprint,
      boundFingerprint: binding.fingerprint,
    };
  }

  const advisoryProjectId = input.headers.advisoryProjectId;
  const advisoryMismatch =
    advisoryProjectId === undefined || advisoryProjectId === application.projectId
      ? null
      : { presentedProjectId: advisoryProjectId, bundleProjectId: application.projectId };
  if (advisoryMismatch !== null) {
    await input.store.recordProjectMismatch({
      applicationId: knownApplicationId,
      presentedProjectId: advisoryMismatch.presentedProjectId,
      bundleProjectId: advisoryMismatch.bundleProjectId,
      bundleHash: active.hash,
    });
  }

  return {
    kind: "bound",
    applicationId: knownApplicationId,
    projectId: application.projectId,
    bundleHash: active.hash,
    advisoryMismatch,
  };
}
