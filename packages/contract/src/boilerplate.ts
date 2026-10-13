/**
 * The Boilerplate wire contract (Story 3.3): the Company Guidance endpoint
 * setting and the Boilerplate generation request and result, shared by the
 * registry (which stores the endpoint and renders the archive) and the panel
 * (which sets the endpoint and offers the archive for download).
 *
 * The Buyer sets one Guidance endpoint URL per tenant; changes are recorded
 * append-only. A Boilerplate is a deterministic `.tar.gz` archive of the
 * starter files for one Application and one agent tool, returned base64 in
 * JSON with a text list of its artifacts.
 */
import { APPLICATION_API_PATHS } from "./applications.ts";
import { isRecord, isUtcIso } from "./guards.ts";
import { isUuidV7 } from "./ids.ts";
import type { UuidV7 } from "./ids.ts";

/** `GET`: 200 {@link GuidanceEndpointState} (every role). `POST` a {@link GuidanceEndpointRequest}: 200 (Buyer only). */
export const GUIDANCE_ENDPOINT_PATH = "/v1/guidance-endpoint";

/** The Guidance endpoint URL is trimmed and 1 to this many characters long. */
export const GUIDANCE_ENDPOINT_URL_MAX = 2048;

/** The tenant's current Company Guidance endpoint. */
export interface GuidanceEndpointState {
  /** The current HTTPS URL, or `null` when the Buyer never set one. */
  readonly url: string | null;
  /** UTC ISO-8601 of the latest change, or `null` when never set. */
  readonly changedAt: string | null;
}

/** Body of `POST /v1/guidance-endpoint` (exactly this key). */
export interface GuidanceEndpointRequest {
  readonly url: string;
}

/** The agent tools a Boilerplate can be generated for. */
export const BOILERPLATE_TARGETS = ["claude-code"] as const;
export type BoilerplateTarget = (typeof BOILERPLATE_TARGETS)[number];

/** True when `value` is exactly one of {@link BOILERPLATE_TARGETS}. Never throws. */
export function isBoilerplateTarget(value: unknown): value is BoilerplateTarget {
  return typeof value === "string" && (BOILERPLATE_TARGETS as readonly string[]).includes(value);
}

/** Body of `POST /v1/applications/{id}/boilerplate` (exactly this key). */
export interface BoilerplateRequest {
  readonly target: BoilerplateTarget;
}

/** What each file of a Boilerplate is. */
export const BOILERPLATE_ARTIFACT_KINDS = [
  "identification-file",
  "dependency-pins",
  "design-system-references",
  "mcp-configuration",
  "instructions",
  "skills",
] as const;
export type BoilerplateArtifactKind = (typeof BOILERPLATE_ARTIFACT_KINDS)[number];

/** One file of the archive. */
export interface BoilerplateArtifact {
  readonly kind: BoilerplateArtifactKind;
  /** The path inside the archive, relative to the repository root. */
  readonly path: string;
}

/** Response of `POST /v1/applications/{id}/boilerplate`. */
export interface BoilerplateResult {
  readonly applicationId: UuidV7;
  readonly target: BoilerplateTarget;
  /** `domain-harness-<applicationId>-<target>.tar.gz`. */
  readonly archiveName: string;
  /** The gzip-compressed ustar archive, base64-encoded. */
  readonly archiveBase64: string;
  /** One entry per file, in archive order. */
  readonly artifacts: readonly BoilerplateArtifact[];
}

/** The npm package of the stdio bridge every Boilerplate's MCP configuration declares. */
export const MCP_BRIDGE_PACKAGE = "@domain-harness/mcp-bridge";

/** The tenant has no Guidance endpoint yet (409, subject `guidanceEndpoint`); ask the Buyer to set it. */
export const GUIDANCE_ENDPOINT_UNSET = "guidance_endpoint_unset";
/** The Effective Standard set requires an ecosystem the pilot does not support (409, subject `standards`). */
export const UNSUPPORTED_ECOSYSTEM = "unsupported_ecosystem";
/** A dependency pin would be a prohibited code-stack entry (409, subject `standards`). */
export const BOILERPLATE_CONFLICT = "boilerplate_conflict";

/**
 * `POST` a {@link BoilerplateRequest}: 200 {@link BoilerplateResult} (every
 * role); 404 `application_not_found` for a malformed, unknown or other
 * tenant's id.
 */
export function applicationBoilerplatePath(applicationId: string): string {
  return `${APPLICATION_API_PATHS.applications}/${encodeURIComponent(applicationId)}/boilerplate`;
}

/** The archive name of a Boilerplate. */
export function boilerplateArchiveName(applicationId: string, target: BoilerplateTarget): string {
  return `domain-harness-${applicationId}-${target}.tar.gz`;
}

/** True when `value` is a {@link GuidanceEndpointState}: both fields set or both `null`. Never throws. */
export function isGuidanceEndpointState(value: unknown): value is GuidanceEndpointState {
  if (!isRecord(value)) return false;
  const url = value["url"];
  const changedAt = value["changedAt"];
  if (url === null && changedAt === null) return true;
  return typeof url === "string" && url !== "" && isUtcIso(changedAt);
}

function isBoilerplateArtifact(value: unknown): value is BoilerplateArtifact {
  const kind = isRecord(value) ? value["kind"] : undefined;
  return (
    isRecord(value) &&
    typeof kind === "string" &&
    (BOILERPLATE_ARTIFACT_KINDS as readonly string[]).includes(kind) &&
    typeof value["path"] === "string" &&
    value["path"] !== ""
  );
}

/** True when `value` is a {@link BoilerplateResult}. Never throws. */
export function isBoilerplateResult(value: unknown): value is BoilerplateResult {
  if (!isRecord(value)) return false;
  const artifacts = value["artifacts"];
  return (
    isUuidV7(value["applicationId"]) &&
    isBoilerplateTarget(value["target"]) &&
    typeof value["archiveName"] === "string" &&
    value["archiveName"] !== "" &&
    typeof value["archiveBase64"] === "string" &&
    value["archiveBase64"] !== "" &&
    Array.isArray(artifacts) &&
    artifacts.length > 0 &&
    artifacts.every(isBoilerplateArtifact)
  );
}
