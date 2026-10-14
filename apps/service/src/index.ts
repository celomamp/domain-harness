import type { ErrorEnvelope } from "@domain-harness/contract";

/** Workspace name of this unit. Company Standards service: Guidance MCP, CI Gate runner, Read API, bundle puller. */
export const packageName = "@domain-harness/service";

/** Errors from this unit use the shared envelope. */
export type ServiceError = ErrorEnvelope;

// Story 4.2: the bundles unit (pull, verify, activate, staleness).

export { BUNDLE_REFUSAL_REASONS, bundleHashOf, isEd25519PublicKeyPem, verifyPulledBundle } from "./bundles/verify.ts";
export type {
  ActiveBundlePointer,
  BundleRefusalReason,
  BundleTrustSet,
  TrustedBundleKey,
  VerifyOutcome,
  VerifyPulledBundleInput,
} from "./bundles/verify.ts";

export {
  InMemoryBundleRecordStore,
  PostgresBundleRecordStore,
  createInMemoryBundleRecordStore,
  createPool,
  createPostgresBundleRecordStore,
} from "./bundles/store.ts";
export type {
  ActivationOutcome,
  BundleRecordStore,
  BundleRefusalInput,
  BundleRefusalRecord,
  BundleStalenessObservation,
  BundleStalenessObservationInput,
  StalenessRecordingResult,
} from "./bundles/store.ts";

export {
  bundledState,
  observeStaleness,
  pullAndActivate,
  pullLatest,
} from "./bundles/puller.ts";
export type {
  BundledState,
  BundledStateOutcome,
  FailedPullOutcome,
  PullAndActivateInput,
  PullAndActivateOutcome,
  PullOutcome,
  PullTarget,
  StalenessObservationOutcome,
} from "./bundles/puller.ts";

export {
  DEFAULT_PULL_INTERVAL_MS,
  BundleConfigError,
  bundleServiceConfigFromEnv,
  parseTrustKeys,
} from "./bundles/env.ts";
export type { BundleServiceConfig } from "./bundles/env.ts";

// Story 4.3: the guidance identity unit (one decision on every Guidance call).

export { COMMIT_ONCE, UNAVAILABLE, resolveGuidanceIdentity } from "./guidance/identity.ts";
export type {
  GuidanceIdentityHeaders,
  PinnedActiveBundle,
  ResolveGuidanceIdentityInput,
} from "./guidance/identity.ts";

export {
  InMemoryGuidanceIdentityStore,
  PostgresGuidanceIdentityStore,
  createInMemoryGuidanceIdentityStore,
  createPostgresGuidanceIdentityStore,
} from "./guidance/store.ts";
export type {
  GuidanceBinding,
  GuidanceBindingRefusal,
  GuidanceIdentityStore,
  GuidanceProjectMismatchInput,
  GuidanceProjectMismatchRecord,
} from "./guidance/store.ts";
