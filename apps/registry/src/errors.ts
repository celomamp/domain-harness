import type { ErrorEnvelope } from "@domain-harness/contract";

/**
 * A thrown error that is also the shared envelope: `code`, `message` and
 * `subject` are own fields, so `catch (e)` sees `{ code, message, subject }`.
 * Messages carry field names, ids and counts only, never names or emails.
 */
export class EnvelopeError extends Error implements ErrorEnvelope {
  readonly code: string;
  readonly subject: string;

  constructor(envelope: ErrorEnvelope, options?: ErrorOptions) {
    super(envelope.message, options);
    this.name = "EnvelopeError";
    this.code = envelope.code;
    this.subject = envelope.subject;
  }

  /** The plain envelope, for JSON output. */
  toEnvelope(): ErrorEnvelope {
    return { code: this.code, message: this.message, subject: this.subject };
  }
}

/** True when `value` is an {@link EnvelopeError}. */
export function isEnvelopeError(value: unknown): value is EnvelopeError {
  return value instanceof EnvelopeError;
}
