import type { ErrorEnvelope } from "@domain-harness/contract";
import { isEnvelopeError } from "../errors.ts";

/**
 * Write exactly one envelope as JSON to stderr and set exit code 1.
 * An unexpected error is reported as `fallback` only: driver messages can echo
 * row values (names, emails), and operator output carries ids and counts only.
 */
export function reportFailure(error: unknown, fallback: ErrorEnvelope): void {
  const envelope: ErrorEnvelope = isEnvelopeError(error) ? error.toEnvelope() : fallback;
  process.stderr.write(`${JSON.stringify(envelope)}\n`);
  process.exitCode = 1;
}
