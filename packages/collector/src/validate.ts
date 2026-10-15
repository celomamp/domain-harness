/**
 * Whole-payload validation for send (Story 6.2): a Compilation that fails its
 * schema is dropped whole — no partial value is ever returned — and the drop
 * is counted by reason in a {@link DropLedger} feeding collector health.
 * Mirrors the strict checks of `apps/registry/src/compilations/validate.ts`
 * (unknown-major rejection, catalog-version pin, calendar-real instants, int4
 * sequence cap, first-failure-wins ordering); read-only reference, never
 * imported. Contract guards are reused, never duplicated.
 */
import {
  COMPILATION_CATALOG_MAJOR,
  COMPILATION_CATALOG_VERSION,
  COMPILATION_KEYS,
  COMPILATION_TYPE_NAMES,
  isCompilation,
  isDeviation,
  isEffectiveSlot,
  isGuidanceCompilationSubject,
  isGuidanceToolName,
  isRecord,
  isSupportedCompilationSchemaVersion,
  isUtcIso,
  isUuidV7,
} from "@domain-harness/contract";
import type { Compilation, CompilationTypeName } from "@domain-harness/contract";

/** The closed drop-reason vocabulary: exactly `schema_failed` (6.3 extends it with transport reasons). */
export const DROP_REASONS = ["schema_failed"] as const;

/** One countable reason a payload was dropped whole. */
export type DropReason = (typeof DROP_REASONS)[number];

/** The outcome of validating one payload for send: the Compilation, or a whole-payload drop naming its reason. */
export type ValidateForSendResult =
  | { readonly ok: true; readonly compilation: Compilation }
  | {
      readonly ok: false;
      readonly dropped: true;
      readonly reason: DropReason;
      /** The field (or key) whose check failed first. */
      readonly subject: string;
      readonly message: string;
    };

/** The `sequence` column is an int4: larger values would escape as a 500 from the insert instead of a 400. */
const SEQUENCE_MAX = 2_147_483_647;

const HEX_64 = /^[0-9a-f]{64}$/;

function drop(subject: string, message: string): ValidateForSendResult {
  return { ok: false, dropped: true, reason: "schema_failed", subject, message };
}

/**
 * The UTC ISO-8601 text names a real calendar instant: `isUtcIso` is
 * regex-only, so a calendar-invalid text (February 30) must not pass as a
 * rolled-over instant — the date must round-trip back to what was submitted.
 */
function isCalendarRealInstant(value: string): boolean {
  if (!isUtcIso(value)) return false;
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return false;
  const iso = new Date(at).toISOString();
  return iso === value || iso.replace(".000Z", "Z") === value;
}

function checkEnvelope(fields: Record<string, unknown>): ValidateForSendResult | null {
  if (!isUuidV7(fields["idempotencyKey"])) {
    return drop("idempotencyKey", "idempotencyKey must be a canonical lowercase UUIDv7");
  }
  if (!isUuidV7(fields["applicationId"])) {
    return drop("applicationId", "applicationId must be a canonical lowercase UUIDv7");
  }
  const agentToolName = fields["agentToolName"];
  if (typeof agentToolName !== "string" || agentToolName.trim() === "") {
    return drop("agentToolName", "agentToolName must be 1 or more characters after trimming");
  }
  const occurredAt = fields["occurredAt"];
  if (!isUtcIso(occurredAt)) {
    return drop("occurredAt", "occurredAt must be a UTC ISO-8601 timestamp");
  }
  if (!isCalendarRealInstant(occurredAt)) {
    return drop("occurredAt", "occurredAt must be a UTC ISO-8601 timestamp for a real calendar instant");
  }
  const sequence = fields["sequence"];
  if (
    typeof sequence !== "number" ||
    !Number.isInteger(sequence) ||
    sequence < 1 ||
    sequence > SEQUENCE_MAX
  ) {
    return drop("sequence", `sequence must be an integer from 1 to ${String(SEQUENCE_MAX)}`);
  }
  return null;
}

function checkNonNegativeInteger(value: unknown, subject: string, what: string): ValidateForSendResult | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return drop(subject, `${what} must be an integer of 0 or more`);
  }
  return null;
}

function checkGateRunDeviations(value: unknown): ValidateForSendResult | null {
  if (!Array.isArray(value)) {
    return drop("deviations", "deviations must be an array of match keys with a status");
  }
  for (const entry of value) {
    if (!isRecord(entry)) {
      return drop("deviations", "deviations must be an array of match keys with a status");
    }
    if (
      !isUuidV7(entry["standardId"]) ||
      !isEffectiveSlot(entry["slot"]) ||
      typeof entry["subject"] !== "string" ||
      entry["subject"] === "" ||
      (entry["status"] !== "open" && entry["status"] !== "accepted")
    ) {
      return drop("deviations", "deviations must be an array of match keys with a status");
    }
  }
  return null;
}

function checkBody(type: CompilationTypeName, fields: Record<string, unknown>): ValidateForSendResult | null {
  switch (type) {
    case "guidance": {
      if (!isGuidanceToolName(fields["tool"])) {
        return drop("tool", "tool must be one of the four Guidance tool names");
      }
      const outcome = fields["outcome"];
      if (outcome !== "hit" && outcome !== "miss") {
        return drop("outcome", "outcome must be hit or miss");
      }
      if (!isGuidanceCompilationSubject(fields["subject"])) {
        return drop("subject", "subject must be a slot-name token or a tenant-keyed hash, never raw text");
      }
      return null;
    }
    case "gate_run": {
      if (typeof fields["revision"] !== "string" || fields["revision"] === "") {
        return drop("revision", "revision must be 1 or more characters");
      }
      const verdict = fields["verdict"];
      if (verdict !== "pass" && verdict !== "fail") {
        return drop("verdict", "verdict must be pass or fail");
      }
      const checked = checkNonNegativeInteger(fields["checkedCount"], "checkedCount", "checkedCount");
      if (checked !== null) return checked;
      const open = checkNonNegativeInteger(fields["openCount"], "openCount", "openCount");
      if (open !== null) return open;
      return checkGateRunDeviations(fields["deviations"]);
    }
    case "deviation": {
      if (!isDeviation(fields["deviation"])) {
        return drop("deviation", "deviation must be a complete Deviation");
      }
      return null;
    }
    case "binding_refusal": {
      const reason = fields["reason"];
      if (
        reason !== "commit_first" &&
        reason !== "missing_identification_file" &&
        reason !== "unknown_application" &&
        reason !== "unavailable"
      ) {
        return drop("reason", "reason must be one of the Guidance unbound reasons");
      }
      if (typeof fields["sentence"] !== "string" || fields["sentence"] === "") {
        return drop("sentence", "sentence must be 1 or more characters");
      }
      return null;
    }
    case "bundle_status": {
      if (typeof fields["bundleHash"] !== "string" || !HEX_64.test(fields["bundleHash"])) {
        return drop("bundleHash", "bundleHash must be 64 lowercase hex characters");
      }
      const bundleSequence = fields["bundleSequence"];
      if (typeof bundleSequence !== "number" || !Number.isInteger(bundleSequence) || bundleSequence < 1) {
        return drop("bundleSequence", "bundleSequence must be an integer of 1 or more");
      }
      const issuedAt = fields["issuedAt"];
      if (!isUtcIso(issuedAt)) {
        return drop("issuedAt", "issuedAt must be a UTC ISO-8601 timestamp");
      }
      if (!isCalendarRealInstant(issuedAt)) {
        return drop("issuedAt", "issuedAt must be a UTC ISO-8601 timestamp for a real calendar instant");
      }
      return null;
    }
    case "collector_health": {
      const pending = checkNonNegativeInteger(fields["pendingCount"], "pendingCount", "pendingCount");
      if (pending !== null) return pending;
      const droppedByReason = fields["droppedByReason"];
      if (
        !isRecord(droppedByReason) ||
        !Object.values(droppedByReason).every(
          (count) => typeof count === "number" && Number.isInteger(count) && count >= 0,
        )
      ) {
        return drop("droppedByReason", "droppedByReason must map each reason to an integer of 0 or more");
      }
      return null;
    }
  }
}

/**
 * Validate one payload for send against the published catalog. First failure
 * wins: the type → an extra or missing key → the `schemaVersion` major
 * (reporting the served major and catalog version) → the `catalogVersion` →
 * the envelope fields (each naming itself) → the per-type fields (each naming
 * itself). Returns the Compilation, or a whole-payload drop naming its
 * reason; never a partial value. Never throws.
 */
export function validateForSend(value: unknown): ValidateForSendResult {
  if (!isRecord(value)) {
    return drop("body", "the body must be an object with type, schemaVersion, catalogVersion and its fields");
  }
  const fields = value;
  const type = fields["type"];
  if (typeof type !== "string" || !(COMPILATION_TYPE_NAMES as readonly string[]).includes(type)) {
    return drop("type", `type must be one of ${COMPILATION_TYPE_NAMES.join(", ")}`);
  }
  const name = type as CompilationTypeName;
  const keys = COMPILATION_KEYS[name];
  const extra = Object.keys(fields).find((key) => !keys.includes(key));
  if (extra !== undefined) return drop(extra, "the body has an unsupported field");
  const missing = keys.find((key) => fields[key] === undefined);
  if (missing !== undefined) return drop(missing, "the body is missing a required field");
  if (!isSupportedCompilationSchemaVersion(fields["schemaVersion"])) {
    return drop(
      "schemaVersion",
      `unsupported schema major; this collector serves major ${String(COMPILATION_CATALOG_MAJOR)} of catalog ${COMPILATION_CATALOG_VERSION}`,
    );
  }
  if (fields["catalogVersion"] !== COMPILATION_CATALOG_VERSION) {
    return drop("catalogVersion", `catalogVersion must be ${COMPILATION_CATALOG_VERSION}`);
  }
  const envelopeFailure = checkEnvelope(fields);
  if (envelopeFailure !== null) return envelopeFailure;
  const bodyFailure = checkBody(name, fields);
  if (bodyFailure !== null) return bodyFailure;
  if (!isCompilation(value)) {
    return drop("body", "the body is not a well-formed Compilation");
  }
  return { ok: true, compilation: value };
}

/**
 * The countable whole-payload drops: `record(reason)` counts one drop,
 * `snapshot()` answers the `droppedByReason` map a collector-health
 * Compilation carries.
 */
export class DropLedger {
  private readonly counts = new Map<DropReason, number>();

  /** Count one whole-payload drop under a closed-vocabulary reason. */
  record(reason: DropReason): void {
    if (!(DROP_REASONS as readonly string[]).includes(reason)) {
      throw new Error(`collector: unknown drop reason ${reason}`);
    }
    this.counts.set(reason, (this.counts.get(reason) ?? 0) + 1);
  }

  /** The drops so far, by reason; a fresh ledger answers the empty map. */
  snapshot(): Readonly<Record<string, number>> {
    return Object.fromEntries(this.counts.entries());
  }
}
