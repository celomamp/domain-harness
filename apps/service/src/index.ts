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

// Story 4.4: the serving unit (Document response through the four MCP tools).

export { SERVE_REFUSED_ORIGIN, SERVE_SET_UNREADABLE_ORIGIN, SERVE_UNAVAILABLE_ORIGIN, missSentenceOf, serveGuidanceCall } from "./guidance/serve.ts";
export type { ServeGuidanceCallInput } from "./guidance/serve.ts";

// Story 4.5: Guidance event records and gaps (one table, miss projection).

export {
  InMemoryGuidanceEventStore,
  PostgresGuidanceEventStore,
  createInMemoryGuidanceEventStore,
  createPostgresGuidanceEventStore,
} from "./guidance/events.ts";
export type { GuidanceEventInput, GuidanceEventStore } from "./guidance/events.ts";

export {
  DEFAULT_GUIDANCE_PORT,
  GuidanceConfigError,
  guidanceServiceConfigFromEnv,
} from "./guidance/config.ts";
export type { GuidanceServiceConfig } from "./guidance/config.ts";

export {
  GUIDANCE_MCP_PATH,
  GUIDANCE_SERVER_INFO,
  createGuidanceMcpHandler,
  readIdentityHeaders,
  respondEnvelope,
} from "./guidance/mcp.ts";
export type { GuidanceMcpDeps, GuidanceMcpHandler } from "./guidance/mcp.ts";

// Story 4.6: the Company Read API (credentialed reads of the pinned bundle through the shared derivation).

export { effectiveSetInputOf, joinEffectiveSet } from "./read/effective.ts";
export type { EffectiveJoinResult } from "./read/effective.ts";

export { handleReadRequest, isReadApiPath, readRouteOf } from "./read/server.ts";
export type { ReadApiDeps, ReadRouteLabel } from "./read/server.ts";
