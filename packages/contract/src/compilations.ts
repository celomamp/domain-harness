/**
 * The Compilation catalog (Story 6.1): the closed, versioned set of
 * Compilations the Buyer audits before the Collector may send anything
 * (FR-26, AD-20, UX-DR21).
 *
 * The catalog is closed: exactly the six type names in
 * {@link COMPILATION_TYPE_NAMES}. Every Compilation carries the envelope
 * (`type`, per-type `schemaVersion`, the catalog version, a UUIDv7
 * `idempotencyKey`, `applicationId`, `agentToolName`, a UTC ISO-8601
 * `occurredAt` and a per-Application `sequence`). A Guidance subject crosses
 * only as a slot-name token or a tenant-keyed hash (a discriminated union,
 * never raw text). A consumer rejects an unknown major schema version and
 * reports its own catalog version (AD-20).
 *
 * Any added type or field needs a schema version bump: the semver-bump guard
 * test in `compilations.test.ts` pins the exact sorted key list per type plus
 * the six type names against {@link COMPILATION_CATALOG_VERSION} and fails
 * otherwise.
 */
import { isRecord, isUtcIso } from "./guards.ts";
import { isUuidV7 } from "./ids.ts";
import type { UuidV7 } from "./ids.ts";
import { isEffectiveSlot } from "./effective.ts";
import type { EffectiveSlot } from "./effective.ts";
import { DEVIATION_STATUSES, isDeviation } from "./deviations.ts";
import type { Deviation, DeviationStatus } from "./deviations.ts";
import { isGuidanceToolName } from "./guidance-tools.ts";
import type { GuidanceToolName } from "./guidance-tools.ts";
import type { GuidanceUnboundReason } from "./guidance-identity.ts";
import { isCodeStackCategory, isDesignSystemEntryKind } from "./standards.ts";
import { isModuleKind } from "./modules.ts";
import type { AccountRef } from "./modules.ts";

/** The version of the published Compilation catalog. */
export const COMPILATION_CATALOG_VERSION = "1.0.0";

/** The only major schema version of the catalog that this contract recognises. */
export const COMPILATION_CATALOG_MAJOR = 1;

/** The closed catalog: exactly these six Compilation type names, in reader order. */
export const COMPILATION_TYPE_NAMES = [
  "guidance",
  "gate_run",
  "deviation",
  "binding_refusal",
  "bundle_status",
  "collector_health",
] as const;

/** One Compilation type name. */
export type CompilationTypeName = (typeof COMPILATION_TYPE_NAMES)[number];

/** True when `value` is exactly one of {@link COMPILATION_TYPE_NAMES}. Never throws. */
export function isCompilationTypeName(value: unknown): value is CompilationTypeName {
  return typeof value === "string" && (COMPILATION_TYPE_NAMES as readonly string[]).includes(value);
}

/** Registry HTTP API paths for Compilations. */
export const COMPILATION_API_PATHS = {
  /** `POST` one Compilation (tenant-credentialed; refused while the catalog is unread). */
  compilations: "/v1/compilations",
  /** `GET` (every role) and `POST` (the Buyer only) of the tenant's catalog-read record. */
  catalogReads: "/v1/compilation-catalog/reads",
} as const;

/** Ingestion is refused while the tenant recorded no read of the current catalog version (subject `catalog`). */
export const CATALOG_UNREAD = "catalog_unread";

/**
 * True when `value` is a semver string whose major is
 * {@link COMPILATION_CATALOG_MAJOR}. Never throws. An unknown major is
 * rejected by consumers (AD-20).
 */
export function isSupportedCompilationSchemaVersion(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (match?.[1] === undefined) return false;
  return Number(match[1]) === COMPILATION_CATALOG_MAJOR;
}

/** The per-type schema version of a Guidance Compilation. */
export const GUIDANCE_COMPILATION_SCHEMA_VERSION = "1.0.0";
/** The per-type schema version of a Gate-run Compilation. */
export const GATE_RUN_COMPILATION_SCHEMA_VERSION = "1.0.0";
/** The per-type schema version of a Deviation Compilation. */
export const DEVIATION_COMPILATION_SCHEMA_VERSION = "1.0.0";
/** The per-type schema version of a Binding-refusal Compilation. */
export const BINDING_REFUSAL_COMPILATION_SCHEMA_VERSION = "1.0.0";
/** The per-type schema version of a Bundle-status Compilation. */
export const BUNDLE_STATUS_COMPILATION_SCHEMA_VERSION = "1.0.0";
/** The per-type schema version of a Collector-health Compilation. */
export const COLLECTOR_HEALTH_COMPILATION_SCHEMA_VERSION = "1.0.0";

/** What a Guidance Compilation reports: a live Standard answered, or nothing matched. */
export const GUIDANCE_COMPILATION_OUTCOMES = ["hit", "miss"] as const;
export type GuidanceCompilationOutcome = (typeof GUIDANCE_COMPILATION_OUTCOMES)[number];

/** What a Gate-run Compilation reports: no open Deviation remains, or at least one does. */
export const GATE_RUN_VERDICTS = ["pass", "fail"] as const;
export type GateRunVerdict = (typeof GATE_RUN_VERDICTS)[number];

/**
 * A Guidance subject as it may cross to the Buyer: a Conflict-slot name
 * token (`moduleKind/slotKind/name`, the slot grammar of the Standards
 * contract) or a tenant-keyed hash (64 lowercase hex). Never raw text.
 */
export type GuidanceCompilationSubject =
  | { readonly kind: "slot-token"; readonly slotToken: string }
  | { readonly kind: "subject-hash"; readonly hash: string };

/** A tenant-keyed subject hash: 64 lowercase hex characters (SHA-256 hex). */
function isSubjectHash(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

/**
 * A slot-name token: `moduleKind/slotKind/name`, split the way the panel
 * splits a Deviation slot (the Module kind and the slot kind are the first
 * two `/`-separated parts and the slot name is the remainder, so a `/` inside
 * a name, like an import specifier, round-trips). The kind pair must be a real
 * slot of the Standards contract: a code-stack category on a code-stack
 * Module, a design-system entry kind on a design-system Module.
 */
function isSlotToken(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parts = value.split("/");
  const moduleKind = parts[0] ?? "";
  const slotKind = parts[1] ?? "";
  const name = parts.slice(2).join("/");
  if (parts.length < 3 || !isModuleKind(moduleKind) || slotKind === "" || name === "") return false;
  return moduleKind === "code-stack" ? isCodeStackCategory(slotKind) : isDesignSystemEntryKind(slotKind);
}

/** True when `value` is a {@link GuidanceCompilationSubject}. Never throws. */
export function isGuidanceCompilationSubject(value: unknown): value is GuidanceCompilationSubject {
  if (!isRecord(value) || Object.keys(value).length !== 2) return false;
  const kind = value["kind"];
  if (kind === "slot-token") return isSlotToken(value["slotToken"]);
  if (kind === "subject-hash") return isSubjectHash(value["hash"]);
  return false;
}

/**
 * One Guidance record as evidence: which Guidance tool was asked, whether a
 * live Standard answered, and the subject as a slot token or a hash.
 */
export interface GuidanceCompilation {
  readonly type: "guidance";
  /** Always {@link GUIDANCE_COMPILATION_SCHEMA_VERSION}. */
  readonly schemaVersion: string;
  /** Always {@link COMPILATION_CATALOG_VERSION}. */
  readonly catalogVersion: string;
  /** UUIDv7: a resend with the same key stores no duplicate. */
  readonly idempotencyKey: UuidV7;
  /** The Application this Compilation is evidence for. */
  readonly applicationId: UuidV7;
  /** The agent tool that produced the record. */
  readonly agentToolName: string;
  /** UTC ISO-8601: when the record occurred. */
  readonly occurredAt: string;
  /** The per-Application order, starting at 1. */
  readonly sequence: number;
  readonly tool: GuidanceToolName;
  readonly outcome: GuidanceCompilationOutcome;
  readonly subject: GuidanceCompilationSubject;
}

/**
 * One Gate run as evidence: the evaluated revision, the verdict, how many
 * findings were checked and how many Deviations are still open, plus the
 * per-Deviation match key and status so Adherence is derivable.
 */
export interface GateRunCompilation {
  readonly type: "gate_run";
  /** Always {@link GATE_RUN_COMPILATION_SCHEMA_VERSION}. */
  readonly schemaVersion: string;
  /** Always {@link COMPILATION_CATALOG_VERSION}. */
  readonly catalogVersion: string;
  /** UUIDv7: a resend with the same key stores no duplicate. */
  readonly idempotencyKey: UuidV7;
  /** The Application this Compilation is evidence for. */
  readonly applicationId: UuidV7;
  /** The agent tool that produced the record. */
  readonly agentToolName: string;
  /** UTC ISO-8601: when the record occurred. */
  readonly occurredAt: string;
  /** The per-Application order, starting at 1. */
  readonly sequence: number;
  /** The evaluated source revision. */
  readonly revision: string;
  readonly verdict: GateRunVerdict;
  readonly checkedCount: number;
  readonly openCount: number;
  readonly deviations: readonly GateRunDeviationSummary[];
}

/** One Deviation of a Gate run: the match key plus the status. */
export interface GateRunDeviationSummary {
  readonly standardId: UuidV7;
  readonly slot: EffectiveSlot;
  readonly subject: string;
  readonly status: DeviationStatus;
}

/** True when `value` is a {@link GateRunDeviationSummary}. Never throws. */
export function isGateRunDeviationSummary(value: unknown): value is GateRunDeviationSummary {
  if (!isRecord(value)) return false;
  for (const key of Object.keys(value)) {
    if (!GATE_RUN_DEVIATION_SUMMARY_KEYS.has(key)) return false;
  }
  return (
    isUuidV7(value["standardId"]) &&
    isEffectiveSlot(value["slot"]) &&
    typeof value["subject"] === "string" &&
    value["subject"] !== "" &&
    typeof value["status"] === "string" &&
    (DEVIATION_STATUSES as readonly string[]).includes(value["status"])
  );
}

/** One Deviation as evidence: the evaluator's finding, reused inline (no new deviation model). */
export interface DeviationCompilation {
  readonly type: "deviation";
  /** Always {@link DEVIATION_COMPILATION_SCHEMA_VERSION}. */
  readonly schemaVersion: string;
  /** Always {@link COMPILATION_CATALOG_VERSION}. */
  readonly catalogVersion: string;
  /** UUIDv7: a resend with the same key stores no duplicate. */
  readonly idempotencyKey: UuidV7;
  /** The Application this Compilation is evidence for. */
  readonly applicationId: UuidV7;
  /** The agent tool that produced the record. */
  readonly agentToolName: string;
  /** UTC ISO-8601: when the record occurred. */
  readonly occurredAt: string;
  /** The per-Application order, starting at 1. */
  readonly sequence: number;
  readonly deviation: Deviation;
}

/** One binding refusal as evidence: the unbound reason and its fixed sentence (no new reason model). */
export interface BindingRefusalCompilation {
  readonly type: "binding_refusal";
  /** Always {@link BINDING_REFUSAL_COMPILATION_SCHEMA_VERSION}. */
  readonly schemaVersion: string;
  /** Always {@link COMPILATION_CATALOG_VERSION}. */
  readonly catalogVersion: string;
  /** UUIDv7: a resend with the same key stores no duplicate. */
  readonly idempotencyKey: UuidV7;
  /** The Application this Compilation is evidence for. */
  readonly applicationId: UuidV7;
  /** The agent tool that produced the record. */
  readonly agentToolName: string;
  /** UTC ISO-8601: when the record occurred. */
  readonly occurredAt: string;
  /** The per-Application order, starting at 1. */
  readonly sequence: number;
  readonly reason: GuidanceUnboundReason;
  /** The fixed sentence a host prints verbatim. */
  readonly sentence: string;
}

const UNBOUND_REASONS: readonly GuidanceUnboundReason[] = [
  "commit_first",
  "missing_identification_file",
  "unknown_application",
  "unavailable",
];

/** One bundle status as evidence: the active bundle's hash, sequence and issue instant. */
export interface BundleStatusCompilation {
  readonly type: "bundle_status";
  /** Always {@link BUNDLE_STATUS_COMPILATION_SCHEMA_VERSION}. */
  readonly schemaVersion: string;
  /** Always {@link COMPILATION_CATALOG_VERSION}. */
  readonly catalogVersion: string;
  /** UUIDv7: a resend with the same key stores no duplicate. */
  readonly idempotencyKey: UuidV7;
  /** The Application this Compilation is evidence for. */
  readonly applicationId: UuidV7;
  /** The agent tool that produced the record. */
  readonly agentToolName: string;
  /** UTC ISO-8601: when the record occurred. */
  readonly occurredAt: string;
  /** The per-Application order, starting at 1. */
  readonly sequence: number;
  /** SHA-256 hex of the active Standard bundle. */
  readonly bundleHash: string;
  /** The per-tenant sequence of the active bundle. */
  readonly bundleSequence: number;
  /** UTC ISO-8601: when the active bundle was issued. */
  readonly issuedAt: string;
}

/** One Collector-health report as evidence: what is queued and what was dropped, by reason. */
export interface CollectorHealthCompilation {
  readonly type: "collector_health";
  /** Always {@link COLLECTOR_HEALTH_COMPILATION_SCHEMA_VERSION}. */
  readonly schemaVersion: string;
  /** Always {@link COMPILATION_CATALOG_VERSION}. */
  readonly catalogVersion: string;
  /** UUIDv7: a resend with the same key stores no duplicate. */
  readonly idempotencyKey: UuidV7;
  /** The Application this Compilation is evidence for. */
  readonly applicationId: UuidV7;
  /** The agent tool that produced the record. */
  readonly agentToolName: string;
  /** UTC ISO-8601: when the record occurred. */
  readonly occurredAt: string;
  /** The per-Application order, starting at 1. */
  readonly sequence: number;
  /** Compilations queued but not yet sent. */
  readonly pendingCount: number;
  /** Dropped Compilations by reason; a payload is dropped whole, never in part. */
  readonly droppedByReason: Readonly<Record<string, number>>;
}

/** Any one Compilation of the closed catalog. */
export type Compilation =
  | GuidanceCompilation
  | GateRunCompilation
  | DeviationCompilation
  | BindingRefusalCompilation
  | BundleStatusCompilation
  | CollectorHealthCompilation;

// ---------------------------------------------------------------------------
// Guards. Never throw; exact key sets.
// ---------------------------------------------------------------------------

const GUIDANCE_COMPILATION_KEYS = [
  "type",
  "schemaVersion",
  "catalogVersion",
  "idempotencyKey",
  "applicationId",
  "agentToolName",
  "occurredAt",
  "sequence",
  "tool",
  "outcome",
  "subject",
] as const;

const GATE_RUN_COMPILATION_KEYS = [
  "type",
  "schemaVersion",
  "catalogVersion",
  "idempotencyKey",
  "applicationId",
  "agentToolName",
  "occurredAt",
  "sequence",
  "revision",
  "verdict",
  "checkedCount",
  "openCount",
  "deviations",
] as const;

const DEVIATION_COMPILATION_KEYS = [
  "type",
  "schemaVersion",
  "catalogVersion",
  "idempotencyKey",
  "applicationId",
  "agentToolName",
  "occurredAt",
  "sequence",
  "deviation",
] as const;

const BINDING_REFUSAL_COMPILATION_KEYS = [
  "type",
  "schemaVersion",
  "catalogVersion",
  "idempotencyKey",
  "applicationId",
  "agentToolName",
  "occurredAt",
  "sequence",
  "reason",
  "sentence",
] as const;

const BUNDLE_STATUS_COMPILATION_KEYS = [
  "type",
  "schemaVersion",
  "catalogVersion",
  "idempotencyKey",
  "applicationId",
  "agentToolName",
  "occurredAt",
  "sequence",
  "bundleHash",
  "bundleSequence",
  "issuedAt",
] as const;

const COLLECTOR_HEALTH_COMPILATION_KEYS = [
  "type",
  "schemaVersion",
  "catalogVersion",
  "idempotencyKey",
  "applicationId",
  "agentToolName",
  "occurredAt",
  "sequence",
  "pendingCount",
  "droppedByReason",
] as const;

const GATE_RUN_DEVIATION_SUMMARY_KEYS = new Set(["standardId", "slot", "subject", "status"]);

/**
 * The exact sorted key list of each Compilation type. The registry's body
 * validator reads the key set from here, and the semver-bump guard test pins
 * these lists literally: any added type or field without a schema version
 * bump fails there.
 */
export const COMPILATION_KEYS: Readonly<Record<CompilationTypeName, readonly string[]>> = {
  guidance: [...GUIDANCE_COMPILATION_KEYS],
  gate_run: [...GATE_RUN_COMPILATION_KEYS],
  deviation: [...DEVIATION_COMPILATION_KEYS],
  binding_refusal: [...BINDING_REFUSAL_COMPILATION_KEYS],
  bundle_status: [...BUNDLE_STATUS_COMPILATION_KEYS],
  collector_health: [...COLLECTOR_HEALTH_COMPILATION_KEYS],
};

const GUIDANCE_KEYS = new Set<string>(GUIDANCE_COMPILATION_KEYS);
const GATE_RUN_KEYS = new Set<string>(GATE_RUN_COMPILATION_KEYS);
const DEVIATION_KEYS = new Set<string>(DEVIATION_COMPILATION_KEYS);
const BINDING_REFUSAL_KEYS = new Set<string>(BINDING_REFUSAL_COMPILATION_KEYS);
const BUNDLE_STATUS_KEYS = new Set<string>(BUNDLE_STATUS_COMPILATION_KEYS);
const COLLECTOR_HEALTH_KEYS = new Set<string>(COLLECTOR_HEALTH_COMPILATION_KEYS);

/** The envelope every Compilation carries: type, versions, key, Application, tool, instant and order. */
function isEnvelope(value: Record<string, unknown>, type: CompilationTypeName): boolean {
  const sequence = value["sequence"];
  const agentToolName = value["agentToolName"];
  return (
    value["type"] === type &&
    isSupportedCompilationSchemaVersion(value["schemaVersion"]) &&
    value["catalogVersion"] === COMPILATION_CATALOG_VERSION &&
    isUuidV7(value["idempotencyKey"]) &&
    isUuidV7(value["applicationId"]) &&
    typeof agentToolName === "string" &&
    agentToolName.trim() !== "" &&
    isUtcIso(value["occurredAt"]) &&
    typeof sequence === "number" &&
    Number.isInteger(sequence) &&
    sequence >= 1
  );
}

function hasExactKeys(value: Record<string, unknown>, keys: ReadonlySet<string>): boolean {
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) return false;
  }
  return true;
}

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

/** True when `value` is a complete {@link GuidanceCompilation}. Never throws. */
export function isGuidanceCompilation(value: unknown): value is GuidanceCompilation {
  if (!isRecord(value) || !hasExactKeys(value, GUIDANCE_KEYS)) return false;
  return (
    isEnvelope(value, "guidance") &&
    isGuidanceToolName(value["tool"]) &&
    typeof value["outcome"] === "string" &&
    (GUIDANCE_COMPILATION_OUTCOMES as readonly string[]).includes(value["outcome"]) &&
    isGuidanceCompilationSubject(value["subject"])
  );
}

/** True when `value` is a complete {@link GateRunCompilation}. Never throws. */
export function isGateRunCompilation(value: unknown): value is GateRunCompilation {
  if (!isRecord(value) || !hasExactKeys(value, GATE_RUN_KEYS)) return false;
  const deviations = value["deviations"];
  return (
    isEnvelope(value, "gate_run") &&
    typeof value["revision"] === "string" &&
    value["revision"] !== "" &&
    typeof value["verdict"] === "string" &&
    (GATE_RUN_VERDICTS as readonly string[]).includes(value["verdict"]) &&
    isNonNegativeInteger(value["checkedCount"]) &&
    isNonNegativeInteger(value["openCount"]) &&
    Array.isArray(deviations) &&
    deviations.every(isGateRunDeviationSummary)
  );
}

/** True when `value` is a complete {@link DeviationCompilation}. Never throws. */
export function isDeviationCompilation(value: unknown): value is DeviationCompilation {
  if (!isRecord(value) || !hasExactKeys(value, DEVIATION_KEYS)) return false;
  return isEnvelope(value, "deviation") && isDeviation(value["deviation"]);
}

/** True when `value` is a complete {@link BindingRefusalCompilation}. Never throws. */
export function isBindingRefusalCompilation(value: unknown): value is BindingRefusalCompilation {
  if (!isRecord(value) || !hasExactKeys(value, BINDING_REFUSAL_KEYS)) return false;
  return (
    isEnvelope(value, "binding_refusal") &&
    typeof value["reason"] === "string" &&
    (UNBOUND_REASONS as readonly string[]).includes(value["reason"]) &&
    typeof value["sentence"] === "string" &&
    value["sentence"] !== ""
  );
}

/** True when `value` is a complete {@link BundleStatusCompilation}. Never throws. */
export function isBundleStatusCompilation(value: unknown): value is BundleStatusCompilation {
  if (!isRecord(value) || !hasExactKeys(value, BUNDLE_STATUS_KEYS)) return false;
  const bundleSequence = value["bundleSequence"];
  return (
    isEnvelope(value, "bundle_status") &&
    isSubjectHash(value["bundleHash"]) &&
    typeof bundleSequence === "number" &&
    Number.isInteger(bundleSequence) &&
    bundleSequence >= 1 &&
    isUtcIso(value["issuedAt"])
  );
}

/** True when every `droppedByReason` entry is a non-negative integer count. Never throws. */
function isDroppedByReason(value: unknown): value is Readonly<Record<string, number>> {
  return isRecord(value) && Object.values(value).every(isNonNegativeInteger);
}

/** True when `value` is a complete {@link CollectorHealthCompilation}. Never throws. */
export function isCollectorHealthCompilation(value: unknown): value is CollectorHealthCompilation {
  if (!isRecord(value) || !hasExactKeys(value, COLLECTOR_HEALTH_KEYS)) return false;
  return (
    isEnvelope(value, "collector_health") &&
    isNonNegativeInteger(value["pendingCount"]) &&
    isDroppedByReason(value["droppedByReason"])
  );
}

/** True when `value` is any one {@link Compilation} of the closed catalog. Never throws. */
export function isCompilation(value: unknown): value is Compilation {
  if (!isRecord(value)) return false;
  switch (value["type"]) {
    case "guidance":
      return isGuidanceCompilation(value);
    case "gate_run":
      return isGateRunCompilation(value);
    case "deviation":
      return isDeviationCompilation(value);
    case "binding_refusal":
      return isBindingRefusalCompilation(value);
    case "bundle_status":
      return isBundleStatusCompilation(value);
    case "collector_health":
      return isCollectorHealthCompilation(value);
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// The schema-reader copy: one entry per Compilation type, rendered verbatim
// by the panel so the surface can never drift from the published schemas.
// ---------------------------------------------------------------------------

/** One documented field: its schema key and its one-line description. */
export interface CompilationSchemaFieldDoc {
  readonly name: string;
  readonly description: string;
}

/** One documented Compilation type: its name, version and fields. */
export interface CompilationSchemaDoc {
  readonly name: CompilationTypeName;
  readonly version: string;
  readonly fields: readonly CompilationSchemaFieldDoc[];
}

/**
 * The schema-reader copy for every Compilation type, in
 * {@link COMPILATION_TYPE_NAMES} order. The panel renders these entries
 * verbatim: the field names always equal the schema's key list (pinned by the
 * semver-bump guard test).
 */
export const COMPILATION_SCHEMA_DOCS: readonly CompilationSchemaDoc[] = [
  {
    name: "guidance",
    version: GUIDANCE_COMPILATION_SCHEMA_VERSION,
    fields: [
      { name: "type", description: "The Compilation type name: guidance." },
      { name: "schemaVersion", description: "The per-type schema version (semver)." },
      { name: "catalogVersion", description: "The catalog version this Compilation was projected against." },
      { name: "idempotencyKey", description: "UUIDv7: a resend with the same key stores no duplicate." },
      { name: "applicationId", description: "The Application this Compilation is evidence for." },
      { name: "agentToolName", description: "The agent tool that produced the record." },
      { name: "occurredAt", description: "UTC ISO-8601 instant the record occurred." },
      { name: "sequence", description: "The per-Application order, starting at 1." },
      { name: "tool", description: "The Guidance tool asked: code_stack_rule, design_component, design_token or design_import." },
      { name: "outcome", description: "hit when a live Standard answered, miss when nothing matched." },
      { name: "subject", description: "Slot-name token or tenant-keyed hash; never raw text." },
    ],
  },
  {
    name: "gate_run",
    version: GATE_RUN_COMPILATION_SCHEMA_VERSION,
    fields: [
      { name: "type", description: "The Compilation type name: gate_run." },
      { name: "schemaVersion", description: "The per-type schema version (semver)." },
      { name: "catalogVersion", description: "The catalog version this Compilation was projected against." },
      { name: "idempotencyKey", description: "UUIDv7: a resend with the same key stores no duplicate." },
      { name: "applicationId", description: "The Application this Compilation is evidence for." },
      { name: "agentToolName", description: "The agent tool that produced the record." },
      { name: "occurredAt", description: "UTC ISO-8601 instant the record occurred." },
      { name: "sequence", description: "The per-Application order, starting at 1." },
      { name: "revision", description: "The evaluated source revision." },
      { name: "verdict", description: "pass when no open Deviation remains, fail otherwise." },
      { name: "checkedCount", description: "Findings checked in this run." },
      { name: "openCount", description: "Deviations still open after this run." },
      { name: "deviations", description: "Per-Deviation match key plus status, so Adherence is derivable." },
    ],
  },
  {
    name: "deviation",
    version: DEVIATION_COMPILATION_SCHEMA_VERSION,
    fields: [
      { name: "type", description: "The Compilation type name: deviation." },
      { name: "schemaVersion", description: "The per-type schema version (semver)." },
      { name: "catalogVersion", description: "The catalog version this Compilation was projected against." },
      { name: "idempotencyKey", description: "UUIDv7: a resend with the same key stores no duplicate." },
      { name: "applicationId", description: "The Application this Compilation is evidence for." },
      { name: "agentToolName", description: "The agent tool that produced the record." },
      { name: "occurredAt", description: "UTC ISO-8601 instant the record occurred." },
      { name: "sequence", description: "The per-Application order, starting at 1." },
      { name: "deviation", description: "The evaluator's finding: Standard id, version, slot, subject, kind, status and Correction." },
    ],
  },
  {
    name: "binding_refusal",
    version: BINDING_REFUSAL_COMPILATION_SCHEMA_VERSION,
    fields: [
      { name: "type", description: "The Compilation type name: binding_refusal." },
      { name: "schemaVersion", description: "The per-type schema version (semver)." },
      { name: "catalogVersion", description: "The catalog version this Compilation was projected against." },
      { name: "idempotencyKey", description: "UUIDv7: a resend with the same key stores no duplicate." },
      { name: "applicationId", description: "The Application this Compilation is evidence for." },
      { name: "agentToolName", description: "The agent tool that produced the record." },
      { name: "occurredAt", description: "UTC ISO-8601 instant the record occurred." },
      { name: "sequence", description: "The per-Application order, starting at 1." },
      { name: "reason", description: "Why the call was not bound: commit_first, missing_identification_file, unknown_application or unavailable." },
      { name: "sentence", description: "The fixed sentence a host prints verbatim." },
    ],
  },
  {
    name: "bundle_status",
    version: BUNDLE_STATUS_COMPILATION_SCHEMA_VERSION,
    fields: [
      { name: "type", description: "The Compilation type name: bundle_status." },
      { name: "schemaVersion", description: "The per-type schema version (semver)." },
      { name: "catalogVersion", description: "The catalog version this Compilation was projected against." },
      { name: "idempotencyKey", description: "UUIDv7: a resend with the same key stores no duplicate." },
      { name: "applicationId", description: "The Application this Compilation is evidence for." },
      { name: "agentToolName", description: "The agent tool that produced the record." },
      { name: "occurredAt", description: "UTC ISO-8601 instant the record occurred." },
      { name: "sequence", description: "The per-Application order, starting at 1." },
      { name: "bundleHash", description: "SHA-256 hex of the active Standard bundle." },
      { name: "bundleSequence", description: "The per-tenant sequence of the active bundle." },
      { name: "issuedAt", description: "UTC ISO-8601 instant the active bundle was issued." },
    ],
  },
  {
    name: "collector_health",
    version: COLLECTOR_HEALTH_COMPILATION_SCHEMA_VERSION,
    fields: [
      { name: "type", description: "The Compilation type name: collector_health." },
      { name: "schemaVersion", description: "The per-type schema version (semver)." },
      { name: "catalogVersion", description: "The catalog version this Compilation was projected against." },
      { name: "idempotencyKey", description: "UUIDv7: a resend with the same key stores no duplicate." },
      { name: "applicationId", description: "The Application this Compilation is evidence for." },
      { name: "agentToolName", description: "The agent tool that produced the record." },
      { name: "occurredAt", description: "UTC ISO-8601 instant the record occurred." },
      { name: "sequence", description: "The per-Application order, starting at 1." },
      { name: "pendingCount", description: "Compilations queued but not yet sent." },
      { name: "droppedByReason", description: "Dropped Compilations by reason; a payload is dropped whole, never in part." },
    ],
  },
];

// ---------------------------------------------------------------------------
// The catalog-read record: the Buyer's "I have read catalog X", per tenant
// per catalog version, append-only.
// ---------------------------------------------------------------------------

/** Body of `POST /v1/compilation-catalog/reads`: the catalog version the Buyer read. */
export interface CompilationCatalogReadRequest {
  readonly catalogVersion: string;
}

/** One recorded catalog read: the version, the Buyer who recorded it, and when. */
export interface CompilationCatalogRead {
  readonly catalogVersion: string;
  readonly readBy: AccountRef;
  readonly readAt: string;
}

const CATALOG_READ_KEYS = new Set(["catalogVersion", "readBy", "readAt"]);

function isAccountRef(value: unknown): value is AccountRef {
  return isRecord(value) && isUuidV7(value["accountId"]) && typeof value["name"] === "string";
}

/** True when `value` is a complete {@link CompilationCatalogRead}. Never throws. */
export function isCompilationCatalogRead(value: unknown): value is CompilationCatalogRead {
  if (!isRecord(value)) return false;
  for (const key of Object.keys(value)) {
    if (!CATALOG_READ_KEYS.has(key)) return false;
  }
  return (
    typeof value["catalogVersion"] === "string" &&
    value["catalogVersion"] !== "" &&
    isAccountRef(value["readBy"]) &&
    isUtcIso(value["readAt"])
  );
}

/** The tenant's read state for the current catalog version: whether it was read, by whom, and when. */
export type CompilationCatalogReadState =
  | { readonly catalogVersion: string; readonly read: true; readonly readBy: AccountRef; readonly readAt: string }
  | { readonly catalogVersion: string; readonly read: false; readonly readBy: null; readonly readAt: null };

const CATALOG_READ_STATE_KEYS = new Set(["catalogVersion", "read", "readBy", "readAt"]);

/** True when `value` is a complete {@link CompilationCatalogReadState}. Never throws. */
export function isCompilationCatalogReadState(value: unknown): value is CompilationCatalogReadState {
  if (!isRecord(value)) return false;
  for (const key of Object.keys(value)) {
    if (!CATALOG_READ_STATE_KEYS.has(key)) return false;
  }
  const readBy = value["readBy"];
  const readAt = value["readAt"];
  const read = value["read"];
  if (typeof value["catalogVersion"] !== "string" || value["catalogVersion"] === "") return false;
  if (typeof read !== "boolean") return false;
  if (read) return isAccountRef(readBy) && isUtcIso(readAt);
  return readBy === null && readAt === null;
}

// ---------------------------------------------------------------------------
// The inventory evidence read: per-Application agent tools observed in
// Compilations, so the panel groups the inventory without naming Builders
// (Story 6.5, FR-22/FR-20). Not a Compilation type: the closed catalog above
// is untouched.
// ---------------------------------------------------------------------------

/** Registry HTTP API paths for the inventory evidence read. */
export const INVENTORY_API_PATHS = {
  /** `GET`: 200 {@link InventoryEvidence} (every role). */
  inventory: "/v1/inventory",
} as const;

/**
 * One Application's Compilation evidence: the distinct agent tool names
 * observed in its Compilations, latest first. A row exists only for an
 * Application with at least one Compilation, so `agentTools` is never empty.
 */
export interface InventoryApplicationEvidence {
  readonly applicationId: UuidV7;
  readonly agentTools: readonly string[];
}

/**
 * Response of `GET /v1/inventory`: evidence only for Applications with at
 * least one Compilation, ordered by `applicationId`. An Application with no
 * Compilation yet has no row; the panel lists it from the Applications read.
 */
export interface InventoryEvidence {
  readonly applications: readonly InventoryApplicationEvidence[];
}

const INVENTORY_APPLICATION_KEYS = new Set(["applicationId", "agentTools"]);

/** True when `value` is one {@link InventoryApplicationEvidence} row. Never throws. */
export function isInventoryApplicationEvidence(value: unknown): value is InventoryApplicationEvidence {
  if (!isRecord(value)) return false;
  for (const key of Object.keys(value)) {
    if (!INVENTORY_APPLICATION_KEYS.has(key)) return false;
  }
  const agentTools = value["agentTools"];
  return (
    isUuidV7(value["applicationId"]) &&
    Array.isArray(agentTools) &&
    agentTools.length > 0 &&
    agentTools.every((tool) => typeof tool === "string" && tool.trim() !== "")
  );
}

const INVENTORY_KEYS = new Set(["applications"]);

/** True when `value` is a complete {@link InventoryEvidence}. Never throws. */
export function isInventoryEvidence(value: unknown): value is InventoryEvidence {
  if (!isRecord(value)) return false;
  for (const key of Object.keys(value)) {
    if (!INVENTORY_KEYS.has(key)) return false;
  }
  const applications = value["applications"];
  return Array.isArray(applications) && applications.every(isInventoryApplicationEvidence);
}
