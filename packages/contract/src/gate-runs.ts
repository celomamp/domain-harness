/**
 * The hosted Gate run (pilot "option A"): the request a Builder's CLI sends
 * to the Guidance server and the one result it answers, so a Gate run made
 * outside the Company network still reaches the panel as Application
 * evidence.
 *
 * The request carries the revision SHA and the revision's extracted facts
 * (dependency names and versions, import specifiers, design-token names) —
 * never file contents, never file paths: the client refuses locally when any
 * file was unreadable, so `facts.unreadable` is always empty on the wire.
 * Identity travels in the same {@link GUIDANCE_IDENTITY_HEADERS} the bridge
 * sends, and the route sits behind the same Bearer gate as `/mcp`.
 *
 * The result is the Gate's own output, byte-for-byte what the CI step and
 * the offline CLI print for the same revision and bundle: the fixed
 * sentence, one line per open Deviation, and the exit code. A refusal
 * (unbound, copied identity, stale bundle, …) is a result too, answered 200;
 * only protocol defects answer an error envelope.
 */
import { isRecord } from "./guards.ts";
import { isRevisionFacts } from "./facts.ts";
import type { RevisionFacts } from "./facts.ts";

/** The Guidance server's Gate-run path: `POST`, same Bearer gate as `/mcp`. */
export const GATE_RUN_PATH = "/v1/gate-runs";

/** The largest Gate-run request body the server reads (facts of a large monorepo fit well inside it). */
export const GATE_RUN_MAX_BODY_BYTES = 1024 * 1024;

/** The body of one hosted Gate run. */
export interface GateRunRequest {
  /** The revision's full commit SHA (40 or 64 lowercase hex). */
  readonly revision: string;
  /** The extractor's output for that revision; `unreadable` is always empty. */
  readonly facts: RevisionFacts;
}

/** The three Gate outcomes. */
export type GateRunKind = "pass" | "fail" | "refusal";

/** The one answer of a hosted Gate run. */
export interface GateRunResult {
  readonly kind: GateRunKind;
  /** 0 on pass, 1 otherwise — the CI step's exit code. */
  readonly exitCode: 0 | 1;
  /** The fixed Gate sentence. */
  readonly sentence: string;
  /** One line per open Deviation, in evaluator order (empty unless `fail`). */
  readonly deviationLines: readonly string[];
}

const GATE_RUN_REQUEST_KEYS = new Set(["revision", "facts"]);
const GATE_RUN_RESULT_KEYS = new Set(["kind", "exitCode", "sentence", "deviationLines"]);
const COMMIT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** True when `value` is a full lowercase commit SHA (SHA-1 or SHA-256). Never throws. */
export function isCommitSha(value: unknown): value is string {
  return typeof value === "string" && COMMIT_SHA.test(value);
}

/** True when `value` is exactly a {@link GateRunRequest} with no unreadable rows. Never throws. */
export function isGateRunRequest(value: unknown): value is GateRunRequest {
  if (!isRecord(value)) return false;
  if (Object.keys(value).some((key) => !GATE_RUN_REQUEST_KEYS.has(key))) return false;
  const facts = value["facts"];
  return isCommitSha(value["revision"]) && isRevisionFacts(facts) && facts.unreadable.length === 0;
}

/** True when `value` is exactly a {@link GateRunResult}. Never throws. */
export function isGateRunResult(value: unknown): value is GateRunResult {
  if (!isRecord(value)) return false;
  if (Object.keys(value).some((key) => !GATE_RUN_RESULT_KEYS.has(key))) return false;
  const kind = value["kind"];
  const exitCode = value["exitCode"];
  const lines = value["deviationLines"];
  return (
    (kind === "pass" || kind === "fail" || kind === "refusal") &&
    (exitCode === 0 || exitCode === 1) &&
    (exitCode === 0) === (kind === "pass") &&
    typeof value["sentence"] === "string" &&
    value["sentence"] !== "" &&
    Array.isArray(lines) &&
    lines.every((line) => typeof line === "string")
  );
}
