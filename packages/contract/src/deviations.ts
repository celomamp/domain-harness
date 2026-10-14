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
import { isModuleKind } from "./modules.ts";
import type { AccountRef } from "./modules.ts";
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

// ---------------------------------------------------------------------------
// The acceptance surfaces (Story 5.5): the registry's Accepted-deviation API
// paths, the CI log-line key the panel pastes, and the stored record's wire
// shape. The bundle's `acceptedDeviations` field keeps carrying only
// {@link AcceptedDeviation}; the stored record's extras live outside it.
// ---------------------------------------------------------------------------

/** Registry HTTP API paths for Accepted deviations. */
export const ACCEPTED_DEVIATION_API_PATHS = {
  /** `GET` (every role) and `POST` (the Buyer only) of the tenant's acceptance records. */
  acceptedDeviations: "/v1/accepted-deviations",
} as const;

/**
 * The part of a Deviation the Buyer submits to record an acceptance: the
 * Standard id, the Conflict slot and the subject. The Standard version is
 * resolved by the registry, and the Application id is submitted beside the
 * key, so neither is part of the submitted key.
 */
export interface DeviationMatchKey {
  readonly standardId: UuidV7;
  readonly slot: EffectiveSlot;
  readonly subject: string;
}

/**
 * The inverse of `@domain-harness/gate`'s `formatDeviationLine`: the CI log
 * line `<standardId> <moduleKind>/<slotKind>/<name> <subject>: <correction>`.
 * It lives here (not in gate) because the panel may import only this package.
 * One grammar, two coordinated functions; the gate round-trip test pins them
 * together.
 *
 * Returns the key when `line` is exactly that grammar — the Standard id token,
 * then a slot token whose first `/`-separated part is a known Module kind and
 * second is a non-empty slot kind, the slot name being the remainder (so an
 * import specifier's own `/` separators stay inside the name), then a
 * non-empty subject ending at the first `: ` — and `null` otherwise. Never
 * throws; leading and trailing whitespace is trimmed.
 */
export function parseDeviationLine(line: string): DeviationMatchKey | null {
  const text = typeof line === "string" ? line.trim() : "";
  const idEnd = text.indexOf(" ");
  if (idEnd <= 0) return null;
  const standardId = text.slice(0, idEnd);
  if (!isUuidV7(standardId)) return null;
  const afterId = text.slice(idEnd + 1);
  const slotEnd = afterId.indexOf(" ");
  if (slotEnd === -1) return null;
  const slotToken = afterId.slice(0, slotEnd);
  const remainder = afterId.slice(slotEnd + 1);
  const parts = slotToken.split("/");
  if (parts.length < 3) return null;
  const moduleKind = parts[0];
  const slotKind = parts[1];
  if (moduleKind === undefined || slotKind === undefined) return null;
  const name = parts.slice(2).join("/");
  if (!isModuleKind(moduleKind) || slotKind === "" || name === "") return null;
  const subjectEnd = remainder.indexOf(": ");
  if (subjectEnd === -1) return null;
  const subject = remainder.slice(0, subjectEnd);
  if (subject === "") return null;
  return { standardId, slot: { moduleKind, slotKind, name }, subject };
}

/**
 * One stored acceptance as the registry serves it: the bundle's
 * {@link AcceptedDeviation} key (with the registry-resolved Standard version)
 * plus the stored extras — the Buyer, the justification, the alert interval
 * and the creation time. Append-only: never changed, never deleted.
 */
export interface AcceptedDeviationRecord {
  readonly id: UuidV7;
  readonly applicationId: UuidV7;
  readonly standardId: UuidV7;
  readonly standardVersion: number;
  readonly slot: EffectiveSlot;
  readonly subject: string;
  /** UTC ISO-8601; the acceptance is live from this instant (inclusive). */
  readonly start: string;
  /** UTC ISO-8601 and exclusive: at this instant the finding is open again. */
  readonly end: string;
  /** The Buyer who recorded the acceptance. */
  readonly buyer: AccountRef;
  readonly justification: string;
  /** Integer hours (1–8760); the alert scheduler consumes it (story 5.6). */
  readonly alertIntervalHours: number;
  readonly createdAt: string;
}

const ACCEPTED_DEVIATION_RECORD_KEYS = new Set([
  "id",
  "applicationId",
  "standardId",
  "standardVersion",
  "slot",
  "subject",
  "start",
  "end",
  "buyer",
  "justification",
  "alertIntervalHours",
  "createdAt",
]);

const isAlertIntervalHours = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 8760;

/** True when `value` is a {@link AccountRef} (its module-local guard is not exported). */
function isBuyerRef(value: unknown): boolean {
  return isRecord(value) && isUuidV7(value["accountId"]) && typeof value["name"] === "string";
}

/** True when `value` is a complete {@link AcceptedDeviationRecord} object. Never throws. */
export function isAcceptedDeviationRecord(value: unknown): value is AcceptedDeviationRecord {
  if (!isRecord(value)) return false;

  for (const key of Object.keys(value)) {
    if (!ACCEPTED_DEVIATION_RECORD_KEYS.has(key)) return false;
  }

  const buyer = value["buyer"];
  const slot = value["slot"];
  const subject = value["subject"];
  const justification = value["justification"];
  return (
    isUuidV7(value["id"]) &&
    isUuidV7(value["applicationId"]) &&
    isUuidV7(value["standardId"]) &&
    isStandardVersion(value["standardVersion"]) &&
    isEffectiveSlot(slot) &&
    typeof slot["name"] === "string" &&
    slot["name"].trim() !== "" &&
    typeof subject === "string" &&
    subject.trim() !== "" &&
    isUtcIso(value["start"]) &&
    isUtcIso(value["end"]) &&
    isBuyerRef(buyer) &&
    typeof justification === "string" &&
    justification.trim() !== "" &&
    isAlertIntervalHours(value["alertIntervalHours"]) &&
    isUtcIso(value["createdAt"])
  );
}

/** True when `value` is an array of complete {@link AcceptedDeviationRecord} objects. Never throws. */
export function isAcceptedDeviationRecordList(value: unknown): value is AcceptedDeviationRecord[] {
  return Array.isArray(value) && value.every(isAcceptedDeviationRecord);
}
