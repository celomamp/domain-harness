/** Small runtime-guard helpers shared by the wire-contract modules (not exported from the package). */

/** A plain object (not null, not an array). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// UTC ISO-8601 as produced by Date#toISOString.
const UTC_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

/** True when `value` is a UTC ISO-8601 timestamp string. */
export function isUtcIso(value: unknown): value is string {
  return typeof value === "string" && UTC_ISO.test(value);
}
