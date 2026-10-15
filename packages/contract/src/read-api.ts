/**
 * The Company Read API wire contract (Story 4.6): the credentialed,
 * read-only HTTP surface the Company service serves from its pinned active
 * bundle. A Company system that never runs the Gate fetches the published
 * Standards or one Project's Effective Standard set from the same source of
 * truth Guidance resolves from.
 *
 * `READ_API_PATHS` versions the Standards path; the Effective Standard set
 * path is `effectiveStandardsPath(projectId)` (the same spelling as the
 * registry — same truth, different host). Every response quotes the
 * active-pointer bundle hash alongside its payload, so hash and set are
 * consistent by construction. No write method exists on any Read API path.
 */
import { isEffectiveStandard } from "./effective.ts";
import type { EffectiveStandard } from "./effective.ts";
import { isStandardInfo } from "./standards.ts";
import type { ProjectRef, StandardInfo } from "./standards.ts";
import { isRecord } from "./guards.ts";
import { isUuidV7 } from "./ids.ts";

/** The Read API's versioned paths (the Effective set reuses `effectiveStandardsPath`). */
export const READ_API_PATHS = {
  standards: "/v1/standards",
} as const;

/** The bundle payload could not be read: guard failure or a missing join target (subject `bundle`). */
export const BUNDLE_UNREADABLE = "bundle_unreadable";

/** Response of `GET /v1/standards`: the pinned bundle's standards plus its hash. */
export interface ReadStandardsResponse {
  readonly bundleHash: string;
  readonly standards: readonly StandardInfo[];
}

/**
 * Response of `GET /v1/projects/{id}/effective-standards`: the pinned
 * bundle's Effective Standard set for the Project plus its hash. The
 * `{project, standards}` half is the `EffectiveStandardSet` shape.
 */
export interface ReadEffectiveSetResponse {
  readonly bundleHash: string;
  readonly project: ProjectRef;
  readonly standards: readonly EffectiveStandard[];
}

const READ_STANDARDS_RESPONSE_KEYS = new Set(["bundleHash", "standards"]);
const READ_EFFECTIVE_SET_RESPONSE_KEYS = new Set(["bundleHash", "project", "standards"]);

/** The bundle hash a read response quotes: 64 lowercase hex characters (`guidance-tools.ts` precedent). */
function isBundleHash(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function isProjectRef(value: unknown): value is ProjectRef {
  return isRecord(value) && isUuidV7(value["id"]) && typeof value["name"] === "string";
}

/** True when `value` is a {@link ReadStandardsResponse}: exactly its keys, never throws. */
export function isReadStandardsResponse(value: unknown): value is ReadStandardsResponse {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== READ_STANDARDS_RESPONSE_KEYS.size) return false;
  for (const key of keys) {
    if (!READ_STANDARDS_RESPONSE_KEYS.has(key)) return false;
  }
  const standards = value["standards"];
  return isBundleHash(value["bundleHash"]) && Array.isArray(standards) && standards.every(isStandardInfo);
}

/** True when `value` is a {@link ReadEffectiveSetResponse}: exactly its keys, never throws. */
export function isReadEffectiveSetResponse(value: unknown): value is ReadEffectiveSetResponse {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== READ_EFFECTIVE_SET_RESPONSE_KEYS.size) return false;
  for (const key of keys) {
    if (!READ_EFFECTIVE_SET_RESPONSE_KEYS.has(key)) return false;
  }
  const standards = value["standards"];
  return (
    isBundleHash(value["bundleHash"]) &&
    isProjectRef(value["project"]) &&
    Array.isArray(standards) &&
    standards.every(isEffectiveStandard)
  );
}
