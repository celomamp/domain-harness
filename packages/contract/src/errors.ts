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
