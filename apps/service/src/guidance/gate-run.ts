/**
 * The hosted Gate run (pilot "option A"): `POST /v1/gate-runs` on the
 * Guidance server, behind the same Bearer gate as `/mcp`. A Builder's CLI
 * (or CI step) that cannot reach the record store sends the revision SHA and
 * the revision's extracted facts; the server evaluates them against ITS
 * pinned active bundle, records the run, enqueues it to the Collector, and
 * answers the Gate's own result.
 *
 * Nothing is evaluated here that the CI Gate does not evaluate: identity is
 * Story 4.3's decision (the shared binding tables, so a copied fingerprint
 * or an unbound Application refuses exactly as Guidance does), the
 * Effective Standard set is the shared derivation Guidance and the Read API
 * resolve through (`joinEffectiveSet`), and the run itself is `runGate` —
 * staleness, the facts guard, `evaluateDeviations`, the record and the
 * Collector enqueue — so the answer is byte-identical to the CI step and the
 * offline CLI for the same revision and bundle.
 *
 * Check order, first failure wins: method (405, `Allow: POST`) → media type
 * (415) → body size (413) → body shape (400 `invalid_input`, subject `body`)
 * → identity → run. Every outcome of the Gate itself, refusals included, is
 * a 200 {@link GateRunResult}. The route logs ids, codes and counts only —
 * never a dependency, import or token name (NFR-9).
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ErrorEnvelope, GateRunRequest, GateRunResult, UuidV7 } from "@domain-harness/contract";
import { GATE_RUN_MAX_BODY_BYTES, GATE_RUN_PATH, isGateRunRequest, isStandardBundlePayload } from "@domain-harness/contract";
import { DUPLICATE_APPLICATION_ID, RUN_DID_NOT_COMPLETE, UNBOUND } from "@domain-harness/gate";
import { runGate } from "../ci-gate/runner.ts";
import type { RunGateOutcome } from "../ci-gate/runner.ts";
import type { ActiveBundleSnapshot, BundleSourceOutcome } from "../ci-gate/bundle.ts";
import type { GateRecordStore } from "../ci-gate/store.ts";
import type { CollectorSubmission } from "../collector/client.ts";
import { joinEffectiveSet } from "../read/effective.ts";
import { resolveGuidanceIdentity } from "./identity.ts";
import type { GuidanceIdentityHeaders, PinnedActiveBundle } from "./identity.ts";
import { readIdentityHeaders, respondEnvelope } from "./mcp.ts";
import { agentToolOf } from "./serve.ts";
import type { GuidanceIdentityStore } from "./store.ts";

/** The dependencies one hosted Gate-run handler serves. */
export interface HostedGateRunDeps {
  readonly tenantId: UuidV7;
  /** Story 4.3's identity store: the one binding check every surface shares. */
  readonly identityStore: GuidanceIdentityStore;
  /** The CI Gate's record store over the same record store (the Postgres twin in production). */
  readonly gateStore: GateRecordStore;
  /** The pinned active bundle through the bundles unit. */
  readonly getPinnedBundle: (tenantId: UuidV7) => Promise<PinnedActiveBundle | null>;
  /** The Collector client every recorded run is enqueued to; absent, nothing is delivered. */
  readonly collector?: CollectorSubmission | undefined;
  /** The clock of a run; defaults to the system time. */
  readonly now?: () => string;
  /** Ids, codes and counts of every completed run (never subject text). */
  readonly onRun?: ((input: { readonly applicationId: string; readonly kind: GateRunResult["kind"]; readonly checked: number; readonly open: number }) => void) | undefined;
}

/** True when `path` is the hosted Gate-run path. */
export function isGateRunPath(path: string): boolean {
  return path === GATE_RUN_PATH;
}

function refusal(sentence: string): GateRunResult {
  return { kind: "refusal", exitCode: 1, sentence, deviationLines: [] };
}

function resultOf(outcome: RunGateOutcome): GateRunResult {
  return {
    kind: outcome.kind,
    exitCode: outcome.exitCode === 0 ? 0 : 1,
    sentence: outcome.sentence,
    deviationLines: [...outcome.deviationLines],
  };
}

/**
 * The Gate snapshot of one Application's Project from the pinned bundle —
 * the same mapping the offline CLI makes from a verified wire bundle
 * (`apps/cli/src/gate-snapshot.ts`): the shared derivation for the set, the
 * payload's issue instant, staleness bound and acceptances, and a frozen
 * bundle frozen through the run.
 */
export function snapshotOfPinned(pinned: PinnedActiveBundle, projectId: string, now: string): BundleSourceOutcome {
  if (!isStandardBundlePayload(pinned.payload)) return { ok: false, reason: "missing-set" };
  const payload = pinned.payload;
  const joined = joinEffectiveSet(payload, projectId);
  if (!joined.ok) return { ok: false, reason: "missing-set" };
  const snapshot: ActiveBundleSnapshot = {
    hash: pinned.hash,
    issuedAt: payload.issuedAt,
    applications: payload.applications.map((entry) => entry.id),
    effectiveSet: joined.set,
    accepted: payload.acceptedDeviations,
    stalenessBoundHours: payload.stalenessHours,
    frozenUntil: payload.frozen ? now : null,
  };
  return { ok: true, snapshot };
}

/**
 * Run one hosted Gate run for already-parsed identity headers and body.
 * Never throws; every failure is the Gate's fixed run-did-not-complete
 * refusal.
 */
export async function hostedGateRun(
  deps: HostedGateRunDeps,
  headers: GuidanceIdentityHeaders,
  body: GateRunRequest,
): Promise<{ readonly result: GateRunResult; readonly applicationId: string | null; readonly checked: number; readonly open: number }> {
  try {
    const now = (deps.now ?? defaultNow)();
    // One pinned-bundle read for the identity decision and the evaluation,
    // so both name the same bundle.
    let cached: Promise<PinnedActiveBundle | null> | undefined;
    const getPinnedBundleOnce = (tenantId: UuidV7): Promise<PinnedActiveBundle | null> => {
      if (tenantId !== deps.tenantId) return deps.getPinnedBundle(tenantId);
      cached ??= deps.getPinnedBundle(tenantId);
      return cached;
    };

    const identity = await resolveGuidanceIdentity({
      headers,
      tenantId: deps.tenantId,
      store: deps.identityStore,
      getPinnedBundle: getPinnedBundleOnce,
    });
    if (identity.kind === "unbound") {
      // The Gate's sentence vocabulary: a repository with no commit has no
      // fingerprint, which the Gate reports as unbound (the CI entry's rule).
      const sentence = identity.reason === "commit_first" ? UNBOUND : identity.sentence;
      return { result: refusal(sentence), applicationId: null, checked: 0, open: 0 };
    }
    if (identity.kind === "refused") {
      return { result: refusal(DUPLICATE_APPLICATION_ID), applicationId: null, checked: 0, open: 0 };
    }

    const pinned = await getPinnedBundleOnce(deps.tenantId);
    if (pinned === null || pinned.hash !== identity.bundleHash) {
      return { result: refusal(RUN_DID_NOT_COMPLETE), applicationId: identity.applicationId, checked: 0, open: 0 };
    }
    const repoFingerprint = headers.repoFingerprint ?? "";
    const outcome = await runGate({
      applicationId: identity.applicationId,
      repoFingerprint,
      facts: body.facts,
      revision: body.revision,
      now,
      source: async () => {
        await Promise.resolve();
        return snapshotOfPinned(pinned, identity.projectId, now);
      },
      store: deps.gateStore,
      collector: deps.collector,
      collectorAgentToolName: isStandardBundlePayload(pinned.payload)
        ? (agentToolOf(pinned.payload, identity.applicationId) ?? undefined)
        : undefined,
    });
    return { result: resultOf(outcome), applicationId: identity.applicationId, checked: outcome.checked, open: outcome.open };
  } catch {
    return { result: refusal(RUN_DID_NOT_COMPLETE), applicationId: null, checked: 0, open: 0 };
  }
}

/**
 * Handle one hosted Gate-run request. Returns `true` when `path` is the
 * Gate-run path (the response was sent); `false` otherwise, so the caller
 * keeps its routing. The Bearer gate is the caller's, as for `/mcp`.
 */
export async function handleGateRun(
  deps: HostedGateRunDeps,
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
): Promise<boolean> {
  if (!isGateRunPath(path)) return false;

  if (request.method !== "POST") {
    request.resume();
    response.setHeader("Allow", "POST");
    respondEnvelope(response, 405, { code: "method_not_allowed", message: "use POST for Gate runs", subject: "method" });
    return true;
  }

  const body = await readJsonBody(request);
  if (!body.ok) {
    respondEnvelope(response, body.status, body.envelope);
    return true;
  }
  if (!isGateRunRequest(body.value)) {
    respondEnvelope(response, 400, {
      code: "invalid_input",
      message: "the body must be { revision, facts } with a full commit SHA and readable facts",
      subject: "body",
    });
    return true;
  }

  const run = await hostedGateRun(deps, readIdentityHeaders(request), body.value);
  try {
    deps.onRun?.({ applicationId: run.applicationId ?? "", kind: run.result.kind, checked: run.checked, open: run.open });
  } catch {
    // Logging never changes the answer.
  }
  const text = JSON.stringify(run.result);
  response.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    "Cache-Control": "no-store",
  });
  response.end(text);
  return true;
}

type BodyOutcome =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly status: 400 | 413 | 415; readonly envelope: ErrorEnvelope };

/** Read a JSON body of at most {@link GATE_RUN_MAX_BODY_BYTES}, declared `application/json` (the registry's rule). */
async function readJsonBody(request: IncomingMessage): Promise<BodyOutcome> {
  const mediaType = (request.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    request.resume();
    return {
      ok: false,
      status: 415,
      envelope: { code: "unsupported_media_type", message: "the request body must be sent as application/json", subject: "content-type" },
    };
  }
  const tooLarge: BodyOutcome = {
    ok: false,
    status: 413,
    envelope: { code: "payload_too_large", message: `the request body exceeds ${String(GATE_RUN_MAX_BODY_BYTES)} bytes`, subject: "body" },
  };
  if (Number(request.headers["content-length"] ?? "0") > GATE_RUN_MAX_BODY_BYTES) {
    request.resume();
    return tooLarge;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > GATE_RUN_MAX_BODY_BYTES) {
      request.resume();
      return tooLarge;
    }
    chunks.push(chunk);
  }
  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown };
  } catch {
    return { ok: false, status: 400, envelope: { code: "invalid_input", message: "the request body must be JSON", subject: "body" } };
  }
}

function defaultNow(): string {
  return new Date().toISOString();
}
