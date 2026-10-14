import { isEffectiveSlot, isUtcIso, isUuidV7 } from "@domain-harness/contract";
import type { EffectiveSlot, UuidV7 } from "@domain-harness/contract";
import { EnvelopeError } from "../errors.ts";

const invalid = (subject: string, message: string): EnvelopeError =>
  new EnvelopeError({ code: "invalid_input", message: `${message}; nothing was changed`, subject });

/** The validated body of `POST /v1/accepted-deviations`, every string trimmed. */
export interface AcceptedDeviationBody {
  readonly applicationId: UuidV7;
  readonly standardId: UuidV7;
  readonly slot: EffectiveSlot;
  readonly subject: string;
  readonly start: string;
  readonly end: string;
  readonly justification: string;
  readonly alertIntervalHours: number;
}

const BODY_KEYS = new Set([
  "applicationId",
  "standardId",
  "slot",
  "subject",
  "start",
  "end",
  "justification",
  "alertIntervalHours",
]);

const INTERVAL_RULE = "alertIntervalHours must be an integer from 1 to 8760";
const TIMESTAMP_RULE = "start and end must be UTC ISO-8601 timestamps";

/**
 * Validate the body (exactly these fields; registered as registry-internal
 * like `validateLockedRuleBody`/`validateGuidanceEndpointBody`): the
 * `applicationId` and `standardId` are canonical lowercase UUIDv7s; the
 * `slot` passes `isEffectiveSlot`; the `subject` and `justification` are
 * 1-plus characters after trimming (except the slot, compared by the
 * registry through the slot rule, so its spelling is kept); `start` and
 * `end` pass `isUtcIso`; `alertIntervalHours` is an integer 1–8760. The
 * `end > start` window check is the service's, so it reports `end` alone.
 * Throws `invalid_input` naming `body`, the extra key, or the field.
 */
export function validateAcceptedDeviationBody(body: unknown): AcceptedDeviationBody {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw invalid("body", "the body must be an object with applicationId, standardId, slot, subject, start, end, justification and alertIntervalHours");
  }
  const fields = body as Record<string, unknown>;
  const extra = Object.keys(fields).find((key) => !BODY_KEYS.has(key));
  if (extra !== undefined) throw invalid(extra, "the body has an unsupported field");
  const missing = [...BODY_KEYS].find((key) => fields[key] === undefined);
  if (missing !== undefined) throw invalid(missing, "the body is missing a required field");

  const applicationId = fields["applicationId"];
  if (typeof applicationId !== "string" || !isUuidV7(applicationId)) {
    throw invalid("applicationId", "applicationId must be a canonical lowercase UUIDv7");
  }
  const standardId = fields["standardId"];
  if (typeof standardId !== "string" || !isUuidV7(standardId)) {
    throw invalid("standardId", "standardId must be a canonical lowercase UUIDv7");
  }
  const slot = fields["slot"];
  if (!isEffectiveSlot(slot)) {
    throw invalid("slot", "slot must be an object with moduleKind, slotKind and name");
  }
  const subject = fields["subject"];
  if (typeof subject !== "string" || subject.trim() === "") {
    throw invalid("subject", "subject must be 1 or more characters after trimming");
  }
  const justification = fields["justification"];
  if (typeof justification !== "string" || justification.trim() === "") {
    throw invalid("justification", "justification must be 1 or more characters after trimming");
  }
  const start = fields["start"];
  if (!isUtcIso(start)) throw invalid("start", TIMESTAMP_RULE);
  const end = fields["end"];
  if (!isUtcIso(end)) throw invalid("end", TIMESTAMP_RULE);
  const alertIntervalHours = fields["alertIntervalHours"];
  if (typeof alertIntervalHours !== "number" || !Number.isInteger(alertIntervalHours) || alertIntervalHours < 1 || alertIntervalHours > 8760) {
    throw invalid("alertIntervalHours", INTERVAL_RULE);
  }
  return {
    applicationId,
    standardId,
    slot: { moduleKind: slot.moduleKind, slotKind: slot.slotKind, name: slot.name },
    subject: subject.trim(),
    start,
    end,
    justification: justification.trim(),
    alertIntervalHours,
  };
}
