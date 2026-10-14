/**
 * The Guidance identity contract (Story 4.3): the versioned identity headers
 * the stdio bridge injects on every forwarded MCP message, the versioned
 * repository-fingerprint algorithm, and the typed identity result the
 * service answers every guidance identity decision with.
 *
 * Header names and the algorithm are versioned here (AD-19): a change to
 * either is a contract change with a semver bump. A header whose value could
 * not be computed is simply absent — presence is the whole wire vocabulary;
 * the service decides every identity outcome and always receives the call.
 *
 * The result is exactly one of `bound` (Application id, the Project id
 * resolved from the active bundle, the pinned bundle hash and an optional
 * advisory mismatch), `unbound` (reason + fixed sentence) or `refused`
 * (sentence + presented/bound fingerprints). Sentences travel inside
 * results, so a service response is byte-stable: hosts print one fixed
 * sentence (UX-DR29).
 */
import { isRecord } from "./guards.ts";
import { isUuidV7 } from "./ids.ts";
import type { UuidV7 } from "./ids.ts";

/**
 * The versioned Guidance identity headers: `applicationId` and
 * `advisoryProjectId` are sent when the identification file parsed;
 * `repoFingerprint` is sent when the repository fingerprint was computable.
 */
export const GUIDANCE_IDENTITY_HEADERS = {
  /** The Application id of the parsed identification file. */
  applicationId: "X-DH-Application-Id",
  /** The advisory Project id of the parsed identification file (the service cannot read the Builder's file). */
  advisoryProjectId: "X-DH-Advisory-Project-Id",
  /** The repository fingerprint at call time. */
  repoFingerprint: "X-DH-Repo-Fingerprint",
} as const;

/**
 * The version of the repository-fingerprint algorithm. Version 1: the
 * lowercase SHA-256 hex digest of the root commit SHA of
 * `git rev-list --max-parents=0 HEAD`. That command may print SEVERAL root
 * SHAs (two unrelated histories merged into one); the pinned rule is the
 * FIRST line as emitted — this is what the CI-Gate mirror computes, and the
 * bridge's `computeBridgeFingerprint` follows it. Forks sharing a root
 * commit share a fingerprint — an accepted pilot risk (AD-19); the remote
 * URL is never involved.
 */
export const REPOSITORY_FINGERPRINT_ALGORITHM_VERSION = 1;

/** Why the identity resolved to `unbound`. Each maps to one fixed sentence. */
export type GuidanceUnboundReason =
  /** The repository has no root commit yet: commit once and retry. */
  | "commit_first"
  /** The identification file is missing or unreadable. */
  | "missing_identification_file"
  /** The presented Application id is not the active bundle. */
  | "unknown_application"
  /** The identity could not be resolved at all: the store or bundle read failed. */
  | "unavailable";

/** The advisory Project id disagreement reported inside a `bound` result. */
export interface GuidanceAdvisoryProjectMismatch {
  /** The Project id the identification file presented. */
  readonly presentedProjectId: string;
  /** The Project id the bundle holds for that Application — the one that is used. */
  readonly bundleProjectId: string;
}

/** One Guidance identity outcome. Never a thrown error. */
export type GuidanceIdentityResult =
  | {
      readonly kind: "bound";
      /** The presented Application id, first seen or already bound. */
      readonly applicationId: UuidV7;
      /** The Project id resolved from the active bundle. */
      readonly projectId: UuidV7;
      /** The hash of the bundle the identity was resolved against. */
      readonly bundleHash: string;
      /** The advisory mismatch, or `null` when the advisory agreed or was absent. */
      readonly advisoryMismatch: GuidanceAdvisoryProjectMismatch | null;
    }
  | {
      readonly kind: "unbound";
      readonly reason: GuidanceUnboundReason;
      /** The fixed sentence a host prints verbatim. */
      readonly sentence: string;
    }
  | {
      readonly kind: "refused";
      /** The fixed sentence a host prints verbatim. */
      readonly sentence: string;
      /** The fingerprint this call presented. */
      readonly presentedFingerprint: string;
      /** The fingerprint the Application id is bound to. */
      readonly boundFingerprint: string;
    };

const UNBOUND_REASONS: readonly GuidanceUnboundReason[] = [
  "commit_first",
  "missing_identification_file",
  "unknown_application",
  "unavailable",
];

/**
 * True when `value` is a {@link GuidanceIdentityResult}: exactly one of
 * `bound`, `unbound` or `refused` with the fields each variant carries.
 * Never throws.
 */
export function isGuidanceIdentityResult(value: unknown): value is GuidanceIdentityResult {
  if (!isRecord(value)) return false;
  switch (value["kind"]) {
    case "bound": {
      const mismatch = value["advisoryMismatch"];
      const mismatchOk =
        mismatch === null ||
        (isRecord(mismatch) &&
          typeof mismatch["presentedProjectId"] === "string" &&
          mismatch["presentedProjectId"] !== "" &&
          typeof mismatch["bundleProjectId"] === "string" &&
          mismatch["bundleProjectId"] !== "");
      return (
        isUuidV7(value["applicationId"]) &&
        isUuidV7(value["projectId"]) &&
        typeof value["bundleHash"] === "string" &&
        value["bundleHash"] !== "" &&
        mismatchOk
      );
    }
    case "unbound":
      return (
        typeof value["reason"] === "string" &&
        (UNBOUND_REASONS as readonly string[]).includes(value["reason"]) &&
        typeof value["sentence"] === "string" &&
        value["sentence"] !== ""
      );
    case "refused":
      return (
        typeof value["sentence"] === "string" &&
        value["sentence"] !== "" &&
        typeof value["presentedFingerprint"] === "string" &&
        value["presentedFingerprint"] !== "" &&
        typeof value["boundFingerprint"] === "string" &&
        value["boundFingerprint"] !== ""
      );
    default:
      return false;
  }
}
