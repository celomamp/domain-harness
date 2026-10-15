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
  isSupportedCompilationSchemaVersion,
  isUtcIso,
  isUuidV7,
} from "@domain-harness/contract";
import type { Compilation, CompilationTypeName } from "@domain-harness/contract";
import { EnvelopeError } from "../errors.ts";

const invalid = (subject: string, message: string): EnvelopeError =>
  new EnvelopeError({ code: "invalid_input", message: `${message}; nothing was stored`, subject });

/**
 * The instant a UTC ISO-8601 text names, or throws `invalid_input` naming its
 * own field. `isUtcIso` is regex-only, so a calendar-invalid text (February
 * 30; a non-calendar text making `Date.parse` yield NaN too) must not pass
 * as a rolled-over or NaN instant: the date must round-trip back to what was
 * submitted.
 */
function utcInstant(value: string, subject: string): Date {
  const at = Date.parse(value);
  const iso = Number.isFinite(at) ? new Date(at).toISOString() : null;
  if (iso === null || (iso !== value && iso.replace(".000Z", "Z") !== value)) {
    throw invalid(subject, `${subject} must be a UTC ISO-8601 timestamp for a real calendar instant`);
  }
  return new Date(at);
}

const HEX_64 = /^[0-9a-f]{64}$/;

/** The `sequence` column is an int4: larger values would escape as a 500 from the insert instead of a 400. */
const SEQUENCE_MAX = 2_147_483_647;

function checkEnvelope(fields: Record<string, unknown>): void {
  const idempotencyKey = fields["idempotencyKey"];
  if (typeof idempotencyKey !== "string" || !isUuidV7(idempotencyKey)) {
    throw invalid("idempotencyKey", "idempotencyKey must be a canonical lowercase UUIDv7");
  }
  const applicationId = fields["applicationId"];
  if (typeof applicationId !== "string" || !isUuidV7(applicationId)) {
    throw invalid("applicationId", "applicationId must be a canonical lowercase UUIDv7");
  }
  const agentToolName = fields["agentToolName"];
  if (typeof agentToolName !== "string" || agentToolName.trim() === "") {
    throw invalid("agentToolName", "agentToolName must be 1 or more characters after trimming");
  }
  const occurredAt = fields["occurredAt"];
  if (!isUtcIso(occurredAt)) {
    throw invalid("occurredAt", "occurredAt must be a UTC ISO-8601 timestamp");
  }
  utcInstant(occurredAt, "occurredAt");
  const sequence = fields["sequence"];
  if (typeof sequence !== "number" || !Number.isInteger(sequence) || sequence < 1 || sequence > SEQUENCE_MAX) {
    throw invalid("sequence", `sequence must be an integer from 1 to ${String(SEQUENCE_MAX)}`);
  }
}

function checkNonNegativeInteger(value: unknown, subject: string, what: string): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw invalid(subject, `${what} must be an integer of 0 or more`);
  }
}

function checkGateRunDeviations(value: unknown): void {
  if (!Array.isArray(value)) {
    throw invalid("deviations", "deviations must be an array of match keys with a status");
  }
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw invalid("deviations", "deviations must be an array of match keys with a status");
    }
    const candidate = entry as Record<string, unknown>;
    if (
      !isUuidV7(candidate["standardId"]) ||
      !isEffectiveSlot(candidate["slot"]) ||
      typeof candidate["subject"] !== "string" ||
      candidate["subject"] === "" ||
      (candidate["status"] !== "open" && candidate["status"] !== "accepted")
    ) {
      throw invalid("deviations", "deviations must be an array of match keys with a status");
    }
  }
}

function checkBody(type: CompilationTypeName, fields: Record<string, unknown>): void {
  switch (type) {
    case "guidance": {
      if (!isGuidanceToolName(fields["tool"])) {
        throw invalid("tool", "tool must be one of the four Guidance tool names");
      }
      const outcome = fields["outcome"];
      if (outcome !== "hit" && outcome !== "miss") {
        throw invalid("outcome", "outcome must be hit or miss");
      }
      if (!isGuidanceCompilationSubject(fields["subject"])) {
        throw invalid("subject", "subject must be a slot-name token or a tenant-keyed hash, never raw text");
      }
      return;
    }
    case "gate_run": {
      if (typeof fields["revision"] !== "string" || fields["revision"] === "") {
        throw invalid("revision", "revision must be 1 or more characters");
      }
      const verdict = fields["verdict"];
      if (verdict !== "pass" && verdict !== "fail") {
        throw invalid("verdict", "verdict must be pass or fail");
      }
      checkNonNegativeInteger(fields["checkedCount"], "checkedCount", "checkedCount");
      checkNonNegativeInteger(fields["openCount"], "openCount", "openCount");
      checkGateRunDeviations(fields["deviations"]);
      return;
    }
    case "deviation": {
      if (!isDeviation(fields["deviation"])) {
        throw invalid("deviation", "deviation must be a complete Deviation");
      }
      return;
    }
    case "binding_refusal": {
      const reason = fields["reason"];
      if (
        reason !== "commit_first" &&
        reason !== "missing_identification_file" &&
        reason !== "unknown_application" &&
        reason !== "unavailable"
      ) {
        throw invalid("reason", "reason must be one of the Guidance unbound reasons");
      }
      if (typeof fields["sentence"] !== "string" || fields["sentence"] === "") {
        throw invalid("sentence", "sentence must be 1 or more characters");
      }
      return;
    }
    case "bundle_status": {
      if (typeof fields["bundleHash"] !== "string" || !HEX_64.test(fields["bundleHash"])) {
        throw invalid("bundleHash", "bundleHash must be 64 lowercase hex characters");
      }
      const bundleSequence = fields["bundleSequence"];
      if (typeof bundleSequence !== "number" || !Number.isInteger(bundleSequence) || bundleSequence < 1) {
        throw invalid("bundleSequence", "bundleSequence must be an integer of 1 or more");
      }
      const issuedAt = fields["issuedAt"];
      if (!isUtcIso(issuedAt)) {
        throw invalid("issuedAt", "issuedAt must be a UTC ISO-8601 timestamp");
      }
      utcInstant(issuedAt, "issuedAt");
      return;
    }
    case "collector_health": {
      checkNonNegativeInteger(fields["pendingCount"], "pendingCount", "pendingCount");
      const droppedByReason = fields["droppedByReason"];
      if (
        typeof droppedByReason !== "object" ||
        droppedByReason === null ||
        Array.isArray(droppedByReason) ||
        !Object.values(droppedByReason as Record<string, unknown>).every(
          (count) => typeof count === "number" && Number.isInteger(count) && count >= 0,
        )
      ) {
        throw invalid("droppedByReason", "droppedByReason must map each reason to an integer of 0 or more");
      }
      return;
    }
  }
}

/**
 * Validate a `POST /v1/compilations` body and return it as a
 * {@link Compilation}. First failure wins: the type (400 `invalid_input`,
 * subject `type`) → an extra or missing key (naming it) → the `schemaVersion`
 * major (reporting the served major and catalog version, subject
 * `schemaVersion`) → the `catalogVersion` (subject `catalogVersion`) → the
 * envelope fields (each naming itself) → the per-type fields (each naming
 * itself). Throws `invalid_input`; never returns a partial Compilation.
 */
export function validateCompilationBody(body: unknown): Compilation {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw invalid("body", "the body must be an object with type, schemaVersion, catalogVersion and its fields");
  }
  const fields = body as Record<string, unknown>;
  const type = fields["type"];
  if (typeof type !== "string" || !(COMPILATION_TYPE_NAMES as readonly string[]).includes(type)) {
    throw invalid("type", `type must be one of ${COMPILATION_TYPE_NAMES.join(", ")}`);
  }
  const name = type as CompilationTypeName;
  const keys = COMPILATION_KEYS[name];
  const extra = Object.keys(fields).find((key) => !keys.includes(key));
  if (extra !== undefined) throw invalid(extra, "the body has an unsupported field");
  const missing = keys.find((key) => fields[key] === undefined);
  if (missing !== undefined) throw invalid(missing, "the body is missing a required field");
  if (!isSupportedCompilationSchemaVersion(fields["schemaVersion"])) {
    throw invalid(
      "schemaVersion",
      `unsupported schema major; this endpoint serves major ${String(COMPILATION_CATALOG_MAJOR)} of catalog ${COMPILATION_CATALOG_VERSION}`,
    );
  }
  if (fields["catalogVersion"] !== COMPILATION_CATALOG_VERSION) {
    throw invalid("catalogVersion", `catalogVersion must be ${COMPILATION_CATALOG_VERSION}`);
  }
  checkEnvelope(fields);
  checkBody(name, fields);
  if (!isCompilation(body)) {
    throw invalid("body", "the body is not a well-formed Compilation");
  }
  return body;
}

/**
 * Validate a `POST /v1/compilation-catalog/reads` body and return the catalog
 * version the Buyer read. The body is exactly `{ catalogVersion }` carrying
 * the current {@link COMPILATION_CATALOG_VERSION}: recording version X never
 * satisfies the gate for version Y. Throws `invalid_input` naming `body`, the
 * extra key or `catalogVersion`.
 */
export function validateCatalogReadBody(body: unknown): string {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw invalid("body", "the body must be an object with catalogVersion");
  }
  const fields = body as Record<string, unknown>;
  const extra = Object.keys(fields).find((key) => key !== "catalogVersion");
  if (extra !== undefined) throw invalid(extra, "the body has an unsupported field");
  if (fields["catalogVersion"] !== COMPILATION_CATALOG_VERSION) {
    throw invalid("catalogVersion", `catalogVersion must be ${COMPILATION_CATALOG_VERSION}`);
  }
  return COMPILATION_CATALOG_VERSION;
}
