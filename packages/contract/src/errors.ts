/**
 * The one error envelope every unit returns or raises across a boundary.
 *
 * Never a bare string, never a partial success: an invalid write writes nothing
 * and reports exactly one envelope.
 */
export interface ErrorEnvelope {
  /** Stable machine-readable code, for example "slot_conflict". */
  readonly code: string;
  /** Human-readable explanation. Carries ids and counts, never prompt text. */
  readonly message: string;
  /** What the error is about: an id, a slot name or a field name. */
  readonly subject: string;
}

/** True when `value` carries the envelope's three string fields. Never throws. */
export function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record["code"] === "string" && typeof record["message"] === "string" && typeof record["subject"] === "string"
  );
}
