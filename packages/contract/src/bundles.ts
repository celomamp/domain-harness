/**
 * The Standard bundle wire contract (Story 4.1): the immutable, signed,
 * hash-addressed artifact the registry builds from its current state and the
 * service pulls and activates.
 *
 * `BUNDLE_TYPE` plus `BUNDLE_FORMAT_VERSION` are the semver identity of the
 * format; consumers reject an unknown major version. Canonical serialization
 * ({@link canonicalJson}) is part of the contract so every adapter that hashes
 * or signs produces identical bytes.
 */
import { isRecord, isUtcIso } from "./guards.ts";
import { isUuidV7 } from "./ids.ts";
import type { UuidV7 } from "./ids.ts";
import { isStandardInfo } from "./standards.ts";
import type { StandardInfo } from "./standards.ts";
import { isProjectTree } from "./projects.ts";
import type { ProjectTree } from "./projects.ts";
import { isAcceptedDeviation } from "./deviations.ts";
import type { AcceptedDeviation } from "./deviations.ts";

/** The stable type name of a Standard bundle's payload. */
export const BUNDLE_TYPE = "domain-harness/standard-bundle";
/** The integer major format version of a Standard bundle. */
export const BUNDLE_FORMAT_VERSION = 1;
/** The default staleness bound (hours) carried by a bundle. */
export const DEFAULT_STALENESS_HOURS = 24;

/** One Application as compiled into a bundle. */
export interface BundleApplication {
  readonly id: UuidV7;
  readonly projectId: UuidV7;
  readonly fromFlow: boolean;
}

/** The format marker carried by every bundle payload. */
export interface BundleFormat {
  readonly type: string;
  readonly version: number;
}

/** The signed bundle's payload: the whole current Standard state of one tenant. */
export interface StandardBundlePayload {
  readonly format: BundleFormat;
  readonly tenantId: UuidV7;
  readonly sequence: number;
  readonly keyId: string;
  readonly issuedAt: string;
  readonly stalenessHours: number;
  readonly frozen: boolean;
  readonly standards: readonly StandardInfo[];
  readonly tree: ProjectTree;
  readonly applications: readonly BundleApplication[];
  readonly acceptedDeviations: readonly AcceptedDeviation[];
}

/** A signed Standard bundle as served and stored. */
export interface SignedStandardBundle {
  readonly payload: StandardBundlePayload;
  readonly keyId: string;
  readonly signature: string;
}

/** Registry HTTP API paths and helpers for bundles. */
export const BUNDLE_API_PATHS = {
  staleness: "/v1/standard-bundles/staleness",
  freeze: "/v1/standard-bundles/freeze",
} as const;

/** Path of the latest signed bundle for one addressed tenant. */
export function standardBundleLatestPath(tenantId: string): string {
  return `/v1/standard-bundles/${encodeURIComponent(tenantId)}`;
}

// ---------------------------------------------------------------------------
// Guards. Never throw; exact key sets.
// ---------------------------------------------------------------------------

const BUNDLE_APPLICATION_KEYS = new Set(["id", "projectId", "fromFlow"]);
const BUNDLE_FORMAT_KEYS = new Set(["type", "version"]);
const STANDARD_BUNDLE_PAYLOAD_KEYS = new Set([
  "format",
  "tenantId",
  "sequence",
  "keyId",
  "issuedAt",
  "stalenessHours",
  "frozen",
  "standards",
  "tree",
  "applications",
  "acceptedDeviations",
]);
const SIGNED_STANDARD_BUNDLE_KEYS = new Set(["payload", "keyId", "signature"]);

/** True when `value` is a {@link BundleApplication}. Never throws. */
export function isBundleApplication(value: unknown): value is BundleApplication {
  if (!isRecord(value)) return false;
  for (const key of Object.keys(value)) {
    if (!BUNDLE_APPLICATION_KEYS.has(key)) return false;
  }
  return (
    isUuidV7(value["id"]) &&
    isUuidV7(value["projectId"]) &&
    typeof value["fromFlow"] === "boolean"
  );
}

/** True when `value` is a {@link BundleFormat} carrying the current format. Never throws. */
export function isBundleFormat(value: unknown): value is BundleFormat {
  if (!isRecord(value)) return false;
  for (const key of Object.keys(value)) {
    if (!BUNDLE_FORMAT_KEYS.has(key)) return false;
  }
  return (
    value["type"] === BUNDLE_TYPE &&
    typeof value["version"] === "number" &&
    Number.isInteger(value["version"]) &&
    value["version"] === BUNDLE_FORMAT_VERSION
  );
}

/** True when `value` is a complete {@link StandardBundlePayload}. Never throws. */
export function isStandardBundlePayload(value: unknown): value is StandardBundlePayload {
  if (!isRecord(value)) return false;
  for (const key of Object.keys(value)) {
    if (!STANDARD_BUNDLE_PAYLOAD_KEYS.has(key)) return false;
  }
  const sequence = value["sequence"];
  const keyId = value["keyId"];
  const stalenessHours = value["stalenessHours"];
  const standards = value["standards"];
  const applications = value["applications"];
  const acceptedDeviations = value["acceptedDeviations"];
  return (
    isBundleFormat(value["format"]) &&
    isUuidV7(value["tenantId"]) &&
    typeof sequence === "number" &&
    Number.isInteger(sequence) &&
    sequence >= 1 &&
    typeof keyId === "string" &&
    keyId !== "" &&
    isUtcIso(value["issuedAt"]) &&
    typeof stalenessHours === "number" &&
    Number.isInteger(stalenessHours) &&
    stalenessHours >= 1 &&
    stalenessHours <= 720 &&
    typeof value["frozen"] === "boolean" &&
    Array.isArray(standards) &&
    standards.every(isStandardInfo) &&
    isProjectTree(value["tree"]) &&
    Array.isArray(applications) &&
    applications.every(isBundleApplication) &&
    Array.isArray(acceptedDeviations) &&
    acceptedDeviations.every(isAcceptedDeviation)
  );
}

/** True when `value` is a complete {@link SignedStandardBundle}. Never throws. */
export function isSignedStandardBundle(value: unknown): value is SignedStandardBundle {
  if (!isRecord(value)) return false;
  for (const key of Object.keys(value)) {
    if (!SIGNED_STANDARD_BUNDLE_KEYS.has(key)) return false;
  }
  const payload = value["payload"];
  return (
    isStandardBundlePayload(payload) &&
    typeof value["keyId"] === "string" &&
    value["keyId"] !== "" &&
    payload.keyId === value["keyId"] &&
    typeof value["signature"] === "string" &&
    value["signature"] !== ""
  );
}

/**
 * Canonical JSON serialization: recursively sort every object's keys by UTF-16
 * code-unit order, no insignificant whitespace, UTF-8-encodable JSON. Arrays
 * keep their order. Returns a string whose UTF-8 bytes are the canonical form.
 */
export function canonicalJson(value: unknown): string {
  return serialize(value);
}

function serialize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("canonicalJson cannot serialize non-finite numbers");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(serialize).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${serialize(record[key])}`).join(",")}}`;
  }
  // undefined / symbols / functions are not part of the JSON data model.
  return "null";
}