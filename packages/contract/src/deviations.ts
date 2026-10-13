/**
 * The Deviation contract (Story 5.2): what the core evaluator emits when a
 * revision's facts do not satisfy the Effective Standard set, and the key an
 * Accepted deviation carries so the evaluator can mark the matching finding
 * accepted while it is live.
 *
 * A Deviation is keyed to (Standard id, Standard version, Conflict slot,
 * subject) and carries a Correction instruction: the authored instruction
 * verbatim when the entry has one, otherwise the evaluator's generated
 * sentence. Accepted deviations carry only the key plus the live window; the
 * justification, alert interval and Buyer belong to the registry's
 * acceptance store (story 5.5).
 */
import { isRecord, isUtcIso } from "./guards.ts";
import { isUuidV7 } from "./ids.ts";
import type { UuidV7 } from "./ids.ts";
import { isEffectiveSlot } from "./effective.ts";
import type { EffectiveSlot } from "./effective.ts";

/** Why a Deviation was emitted: one kind per check the evaluator runs. */
export const DEVIATION_KINDS = [
  "prohibited",
  "missing-required",
  "version-constraint",
  "prohibited-token",
  "missing-required-token",
  "prohibited-import",
  "missing-required-import",
  "component-outside-allow-list",
] as const;
export type DeviationKind = (typeof DEVIATION_KINDS)[number];

/** Whether the finding still fails the Gate or is covered by an acceptance. */
export const DEVIATION_STATUSES = ["open", "accepted"] as const;
export type DeviationStatus = (typeof DEVIATION_STATUSES)[number];

/** One finding of the evaluator: a fact that does not satisfy the Effective Standard set. */
export interface Deviation {
  /** The id of the Standard whose entry produced the finding. */
  readonly standardId: UuidV7;
  /** The live version of that Standard when the finding was emitted. */
  readonly standardVersion: number;
  /** The Conflict slot of that Standard. */
  readonly slot: EffectiveSlot;
  /** What the finding is about: the entry's name (or an import's specifier) as it matched. */
  readonly subject: string;
  readonly kind: DeviationKind;
  /** `accepted` only while a matching Accepted deviation is live; `open` otherwise. */
  readonly status: DeviationStatus;
  /** The one Correction instruction: authored verbatim, or the generated sentence. */
  readonly correction: string;
}

/** The Buyer's accepted exception, keyed to the finding it lets through. */
export interface AcceptedDeviation {
  /** The Application the acceptance is bound to; the evaluator matches on exact equality. */
  readonly applicationId: UuidV7;
  readonly standardId: UuidV7;
  readonly standardVersion: number;
  readonly slot: EffectiveSlot;
  /** The exact subject string of the finding the acceptance lets through. */
  readonly subject: string;
  /** UTC ISO-8601; the acceptance is live from this instant (inclusive). */
  readonly start: string;
  /** UTC ISO-8601 and exclusive: at this instant the finding is open again. */
  readonly end: string;
}

const DEVIATION_KEYS = new Set([
  "standardId",
  "standardVersion",
  "slot",
  "subject",
  "kind",
  "status",
  "correction",
]);

const ACCEPTED_DEVIATION_KEYS = new Set([
  "applicationId",
  "standardId",
  "standardVersion",
  "slot",
  "subject",
  "start",
  "end",
]);

const isStandardVersion = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 1;

/** True when `value` is a complete {@link Deviation} object. Never throws. */
export function isDeviation(value: unknown): value is Deviation {
  if (!isRecord(value)) return false;

  for (const key of Object.keys(value)) {
    if (!DEVIATION_KEYS.has(key)) return false;
  }

  return (
    isUuidV7(value["standardId"]) &&
    isStandardVersion(value["standardVersion"]) &&
    isEffectiveSlot(value["slot"]) &&
    typeof value["subject"] === "string" &&
    typeof value["kind"] === "string" &&
    (DEVIATION_KINDS as readonly string[]).includes(value["kind"]) &&
    typeof value["status"] === "string" &&
    (DEVIATION_STATUSES as readonly string[]).includes(value["status"]) &&
    typeof value["correction"] === "string"
  );
}

/** True when `value` is a complete {@link AcceptedDeviation} object. Never throws. */
export function isAcceptedDeviation(value: unknown): value is AcceptedDeviation {
  if (!isRecord(value)) return false;

  for (const key of Object.keys(value)) {
    if (!ACCEPTED_DEVIATION_KEYS.has(key)) return false;
  }

  return (
    isUuidV7(value["applicationId"]) &&
    isUuidV7(value["standardId"]) &&
    isStandardVersion(value["standardVersion"]) &&
    isEffectiveSlot(value["slot"]) &&
    typeof value["subject"] === "string" &&
    isUtcIso(value["start"]) &&
    isUtcIso(value["end"])
  );
}
