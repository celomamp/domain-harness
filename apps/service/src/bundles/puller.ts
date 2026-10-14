/**
 * Bundle pulling, activation and staleness orchestration (Story 4.2). One
 * outbound GET per cycle to `standardBundleLatestPath(tenantId)` under the
 * configured base URL with the tenant credential as a Bearer token; registry
 * envelopes (401/403/404) and transport failures surface as pull outcomes
 * touching nothing in the store. Verified bundles activate through the record
 * store's transactional pointer swap; every verification refusal is recorded
 * append-only with its reason. There is no retry, queue, inbound listener or
 * TLS termination here.
 */
import type { UuidV7 } from "@domain-harness/contract";
import { isStandardBundlePayload, standardBundleLatestPath } from "@domain-harness/contract";
import { verifyPulledBundle } from "./verify.ts";
import type { ActiveBundlePointer, BundleRefusalReason, BundleTrustSet } from "./verify.ts";
import type { BundleRecordStore, BundleRefusalRecord, BundleStalenessObservation, StalenessRecordingResult } from "./store.ts";

export interface PullTarget {
  /** Outbound base URL of the vendor registry, no trailing slash. */
  readonly vendorUrl: string;
  readonly tenantId: UuidV7;
  /** The tenant's registry service credential, treated opaquely. */
  readonly credential: string;
  /** Override of the outbound timeout for tests; defaults to {@link PULL_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
}

/** Bound on one outbound GET and its body read; a hung vendor never wedges a cycle. */
export const PULL_TIMEOUT_MS = 30_000;

export type PullOutcome =
  | { readonly ok: true; readonly body: unknown }
  | { readonly ok: false; readonly reason: "registry_envelope"; readonly status: number; readonly envelope: unknown }
  | { readonly ok: false; readonly reason: "transport_failed"; readonly detail: string }
  | { readonly ok: false; readonly reason: "invalid_body"; readonly status: number; readonly detail: string };

/** A pull outcome that did not produce a body (what `pullAndActivate` surfaces). */
export type FailedPullOutcome = Exclude<PullOutcome, { ok: true }>;

export type PullAndActivateOutcome =
  | {
      readonly ok: true;
      readonly pointer: ActiveBundlePointer;
      /** True when this cycle swapped the pointer to the pulled bundle. */
      readonly activated: boolean;
      readonly hash: string;
      readonly sequence: number;
    }
  | { readonly ok: false; readonly stage: "pull"; readonly outcome: FailedPullOutcome }
  | { readonly ok: false; readonly stage: "verify"; readonly reason: BundleRefusalReason; readonly record: BundleRefusalRecord }
  | {
      readonly ok: false;
      readonly stage: "activate";
      readonly reason: BundleRefusalReason;
      readonly pointer: ActiveBundlePointer | null;
      readonly record: BundleRefusalRecord;
    };

/**
 * One outbound GET of the tenant's latest signed bundle. Never throws: any
 * fetch failure is a `transport_failed` outcome, any non-200 response a
 * `registry_envelope` outcome carrying the parsed envelope when the body was
 * JSON, and a 200 whose body is not JSON an `invalid_body` outcome.
 */
export async function pullLatest(target: PullTarget): Promise<PullOutcome> {
  const url = `${target.vendorUrl.replace(/\/+$/, "")}${standardBundleLatestPath(target.tenantId)}`;
  const timeoutMs = target.timeoutMs ?? PULL_TIMEOUT_MS;
  let response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { authorization: `Bearer ${target.credential}`, accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : "the connection failed";
    return { ok: false, reason: "transport_failed", detail };
  }

  const status = response.status;
  let text: string;
  try {
    text = await response.text();
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : "the response body could not be read";
    return { ok: false, reason: "transport_failed", detail };
  }

  if (status !== 200) {
    let envelope: unknown;
    try {
      envelope = JSON.parse(text) as unknown;
    } catch {
      envelope = null;
    }
    return { ok: false, reason: "registry_envelope", status, envelope };
  }

  try {
    const body = JSON.parse(text) as unknown;
    return { ok: true, body };
  } catch {
    return { ok: false, reason: "invalid_body", status, detail: "the response body is not JSON" };
  }
}

export interface PullAndActivateInput {
  readonly target: PullTarget;
  readonly trustSet: BundleTrustSet;
}

/**
 * One pull cycle against a store: read the pointer, pull, verify against the
 * pointer, then activate a verified bundle or record the refusal. Pull-side
 * outcomes (envelopes, transport) touch nothing in the store — they are
 * environmental, not verdicts on a bundle. Never throws.
 */
export async function pullAndActivate(store: BundleRecordStore, input: PullAndActivateInput): Promise<PullAndActivateOutcome> {
  const { target, trustSet } = input;
  const tenantId = target.tenantId;
  const pointer = await store.getPointer(tenantId);

  const pulled = await pullLatest(target);
  if (!pulled.ok) {
    return { ok: false, stage: "pull", outcome: pulled };
  }

  const verdict = verifyPulledBundle({ raw: pulled.body, tenantId, trustSet, active: pointer });
  if (!verdict.ok) {
    const record = await store.recordRefusal({
      tenantId,
      reason: verdict.reason,
      sequence: verdict.sequence,
      hash: verdict.hash,
      detail: verdict.detail,
    });
    return { ok: false, stage: "verify", reason: verdict.reason, record };
  }

  const activation = await store.activate(verdict.signed, verdict.hash, tenantId);
  if (!activation.ok) {
    const record = await store.recordRefusal({
      tenantId,
      reason: activation.reason,
      sequence: verdict.sequence,
      hash: verdict.hash,
      detail: `the activate stage refused the verified bundle: ${activation.reason}`,
    });
    return { ok: false, stage: "activate", reason: activation.reason, pointer: activation.pointer, record };
  }
  return {
    ok: true,
    pointer: activation.pointer,
    activated: activation.activated,
    hash: verdict.hash,
    sequence: verdict.sequence,
  };
}

// ---------------------------------------------------------------------------
// Pinned staleness view and observation.
// ---------------------------------------------------------------------------

/** The pinned active-bundle state the service reports (UX-DR21 fields). */
export interface BundledState {
  readonly hash: string;
  readonly sequence: number;
  /** now − payload.issuedAt, in seconds. */
  readonly ageSeconds: number;
  readonly stalenessHours: number;
  readonly frozen: boolean;
  readonly stale: boolean;
}

export type BundledStateOutcome =
  | { readonly ok: true; readonly state: BundledState }
  | { readonly ok: false; readonly reason: "no_active_bundle" | "active_bundle_missing" | "active_bundle_invalid" };

/**
 * The tenant's pinned state: active hash, sequence, age against the
 * Buyer-set bound carried by the active bundle, and the freeze state. `age =
 * now − payload.issuedAt` against `payload.stalenessHours`; `payload.frozen`
 * true suspends the bound entirely. Never throws.
 */
export async function bundledState(store: BundleRecordStore, tenantId: UuidV7, now: string): Promise<BundledStateOutcome> {
  const pointer = await store.getPointer(tenantId);
  if (pointer === null) {
    return { ok: false, reason: "no_active_bundle" };
  }
  const pinned = await store.pinnedBundle(pointer.hash);
  if (pinned === null) {
    return { ok: false, reason: "active_bundle_missing" };
  }
  const payload = pinned.payload;
  if (!isStandardBundlePayload(payload)) {
    return { ok: false, reason: "active_bundle_invalid" };
  }

  const nowMs = Date.parse(now);
  const issuedMs = Date.parse(payload.issuedAt);
  const finite = Number.isFinite(nowMs) && Number.isFinite(issuedMs);
  const ageSeconds = finite ? (nowMs - issuedMs) / 1000 : 0;
  const stalenessHours = payload.stalenessHours;
  const frozen = payload.frozen;
  const stale = finite && !frozen && ageSeconds > stalenessHours * 60 * 60;
  return {
    ok: true,
    state: {
      hash: pointer.hash,
      sequence: pointer.sequence,
      ageSeconds,
      stalenessHours,
      frozen,
      stale,
    },
  };
}

export type StalenessObservationOutcome =
  | { readonly recorded: true; readonly observation: BundleStalenessObservation; readonly state: BundledState }
  | {
      readonly recorded: false;
      readonly state: BundledState | null;
      readonly reason: "no_active_bundle" | "active_bundle_missing" | "active_bundle_invalid" | "not_stale" | "unchanged";
    };

/**
 * Observe the tenant's staleness. A non-stale observation (frozen, or age
 * within the bound) records nothing; a stale observation records an
 * append-only row of the active hash, sequence and age — identical repeated
 * observations (same hash, still stale, as the last recorded one) add no row.
 * Never throws beyond the store's own transport errors.
 */
export async function observeStaleness(store: BundleRecordStore, tenantId: UuidV7, now: string): Promise<StalenessObservationOutcome> {
  const state = await bundledState(store, tenantId, now);
  if (!state.ok) {
    return { recorded: false, state: null, reason: state.reason };
  }
  if (!state.state.stale) {
    return { recorded: false, state: state.state, reason: "not_stale" };
  }
  const recording: StalenessRecordingResult = await store.recordStalenessObservation({
    tenantId,
    hash: state.state.hash,
    sequence: state.state.sequence,
    stale: true,
    ageSeconds: state.state.ageSeconds,
  });
  if (!recording.recorded) {
    return { recorded: false, state: state.state, reason: "unchanged" };
  }
  return { recorded: true, observation: recording.observation, state: state.state };
}
