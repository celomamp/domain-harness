/**
 * The registry's Standards wire contract (Stories 1.5 and 1.6): the
 * code-stack and design-system entry shapes (kept stable for the Epic 5 Gate
 * checks), the HTTP paths, request and
 * response bodies, error codes and runtime guards shared by the registry
 * (which serves them) and the panel (which calls them over HTTP with the
 * session as a Bearer token).
 *
 * A Standard is one entry in one Module at one Project scope. Its id stays the
 * same across versions; every publish appends a new immutable version.
 */
import { isRecord, isUtcIso } from "./guards.ts";
import { isUuidV7 } from "./ids.ts";
import type { UuidV7 } from "./ids.ts";
import { isModuleInfo, isModuleKind, MODULE_API_PATHS } from "./modules.ts";
import type { AccountRef, ModuleInfo, ModuleKind } from "./modules.ts";

/** The slot kind of a code-stack entry. */
export const CODE_STACK_CATEGORIES = ["language", "framework", "library"] as const;
export type CodeStackCategory = (typeof CODE_STACK_CATEGORIES)[number];

/** What a code-stack Standard says about its entry. */
export const CODE_STACK_STATUSES = ["approved", "prohibited", "required"] as const;
export type CodeStackStatus = (typeof CODE_STACK_STATUSES)[number];

/** A Standard name (the Conflict slot name) is trimmed and 1 to this many characters long. */
export const STANDARD_NAME_MAX = 200;
/** An optional version constraint is trimmed and at most this many characters long. */
export const VERSION_CONSTRAINT_MAX = 100;
/** An optional Correction instruction is trimmed and at most this many characters long. */
export const CORRECTION_INSTRUCTION_MAX = 1000;

/** The keys a code-stack entry may carry; any other key is refused. */
export const CODE_STACK_ENTRY_FIELDS = [
  "category",
  "name",
  "versionConstraint",
  "status",
  "correctionInstruction",
] as const;
export type CodeStackEntryField = (typeof CODE_STACK_ENTRY_FIELDS)[number];

/** True when `value` is exactly one of {@link CODE_STACK_CATEGORIES}. Never throws. */
export function isCodeStackCategory(value: unknown): value is CodeStackCategory {
  return typeof value === "string" && (CODE_STACK_CATEGORIES as readonly string[]).includes(value);
}

/** True when `value` is exactly one of {@link CODE_STACK_STATUSES}. Never throws. */
export function isCodeStackStatus(value: unknown): value is CodeStackStatus {
  return typeof value === "string" && (CODE_STACK_STATUSES as readonly string[]).includes(value);
}

/** A code-stack entry as stored and served: normalised (trimmed; empty optional text is `null`). */
export interface CodeStackEntry {
  readonly category: CodeStackCategory;
  /** The Conflict slot name, in the Standard owner's spelling. */
  readonly name: string;
  readonly versionConstraint: string | null;
  readonly status: CodeStackStatus;
  readonly correctionInstruction: string | null;
}

/** The entry kinds of a design-system Module; the entry kind is its slot kind. */
export const DESIGN_SYSTEM_ENTRY_KINDS = ["component", "token", "import"] as const;
export type DesignSystemEntryKind = (typeof DESIGN_SYSTEM_ENTRY_KINDS)[number];

/** What a design-system token or import Standard says about its entry. */
export const DESIGN_SYSTEM_STATUSES = ["required", "prohibited"] as const;
export type DesignSystemStatus = (typeof DESIGN_SYSTEM_STATUSES)[number];

/** A component's usage rule is trimmed and 1 to this many characters long. */
export const USAGE_RULE_MAX = 1000;
/** A component depends on at most this many tokens (each 1 to {@link STANDARD_NAME_MAX} characters). */
export const COMPONENT_TOKENS_MAX = 50;

/** The keys a component entry may carry, in form order; any other key is refused. */
export const COMPONENT_ENTRY_FIELDS = ["kind", "name", "usageRule", "tokens", "correctionInstruction"] as const;
/** The keys a token entry may carry, in form order. */
export const TOKEN_ENTRY_FIELDS = ["kind", "name", "status"] as const;
/** The keys an import entry may carry, in form order. */
export const IMPORT_ENTRY_FIELDS = ["kind", "specifier", "status"] as const;
export type DesignSystemEntryField =
  | (typeof COMPONENT_ENTRY_FIELDS)[number]
  | (typeof TOKEN_ENTRY_FIELDS)[number]
  | (typeof IMPORT_ENTRY_FIELDS)[number];

/** The allowed keys of each design-system entry kind, in form order. */
export const DESIGN_SYSTEM_ENTRY_FIELDS: Readonly<Record<DesignSystemEntryKind, readonly DesignSystemEntryField[]>> = {
  component: COMPONENT_ENTRY_FIELDS,
  token: TOKEN_ENTRY_FIELDS,
  import: IMPORT_ENTRY_FIELDS,
};

/** True when `value` is exactly one of {@link DESIGN_SYSTEM_ENTRY_KINDS}. Never throws. */
export function isDesignSystemEntryKind(value: unknown): value is DesignSystemEntryKind {
  return typeof value === "string" && (DESIGN_SYSTEM_ENTRY_KINDS as readonly string[]).includes(value);
}

/** True when `value` is exactly one of {@link DESIGN_SYSTEM_STATUSES}. Never throws. */
export function isDesignSystemStatus(value: unknown): value is DesignSystemStatus {
  return typeof value === "string" && (DESIGN_SYSTEM_STATUSES as readonly string[]).includes(value);
}

/** A design-system component, as stored and served (normalised). */
export interface ComponentEntry {
  readonly kind: "component";
  /** The Conflict slot name, in the Standard owner's spelling. */
  readonly name: string;
  readonly usageRule: string;
  /** Names of the tokens the component depends on (not checked against token Standards). */
  readonly tokens: readonly string[];
  readonly correctionInstruction: string | null;
}

/** A design-system token, as stored and served (normalised). */
export interface TokenEntry {
  readonly kind: "token";
  /** The Conflict slot name. */
  readonly name: string;
  readonly status: DesignSystemStatus;
}

/** A design-system import, as stored and served (normalised). */
export interface ImportEntry {
  readonly kind: "import";
  /** The module specifier; the Conflict slot name. */
  readonly specifier: string;
  readonly status: DesignSystemStatus;
}

export type DesignSystemEntry = ComponentEntry | TokenEntry | ImportEntry;

/** Any Standard's entry. Code-stack entries carry `category` and never `kind`. */
export type StandardEntry = CodeStackEntry | DesignSystemEntry;

/** The code-stack entry as a client sends it. */
export interface CodeStackEntryRequest {
  readonly category: string;
  readonly name: string;
  readonly versionConstraint?: string | null;
  readonly status: string;
  readonly correctionInstruction?: string | null;
}

/** A design-system entry as a client sends it. */
export type DesignSystemEntryRequest =
  | {
      readonly kind: "component";
      readonly name: string;
      readonly usageRule: string;
      readonly tokens: readonly string[];
      readonly correctionInstruction?: string | null;
    }
  | { readonly kind: "token"; readonly name: string; readonly status: string }
  | { readonly kind: "import"; readonly specifier: string; readonly status: string };

/**
 * Body of `POST /v1/modules/{id}/standards` and `POST /v1/standards/{id}/versions`.
 * The registry trims the text; optional text may be missing, `null` or `""`
 * (stored as `null`). The entry shape must match the Module's kind.
 */
export interface StandardPublishRequest {
  readonly entry: CodeStackEntryRequest | DesignSystemEntryRequest;
  /**
   * The Project scope of a new Standard (`POST /v1/modules/{id}/standards`
   * only): a Project id of this Company's Project tree; missing means the
   * root Project. The scope is fixed for the Standard's life, so a new
   * version (`POST /v1/standards/{id}/versions`) refuses this key
   * (`invalid_input`, subject `projectId`) and keeps the Standard's scope.
   * An unknown, malformed or another Company's id is `project_not_found`.
   */
  readonly projectId?: string;
}

/** A Project as a Standard shows its scope. */
export interface ProjectRef {
  readonly id: UuidV7;
  readonly name: string;
}

/** The Module a Standard belongs to. */
export interface StandardModuleRef {
  readonly id: UuidV7;
  readonly kind: ModuleKind;
  readonly name: string;
}

/** One version of one Standard. */
export interface StandardInfo {
  /** The Standard id: the same for every version. */
  readonly id: UuidV7;
  /** 1, 2, 3, ... per Standard. */
  readonly version: number;
  readonly module: StandardModuleRef;
  /** The Standard's Project scope: chosen at version 1 and fixed for the Standard's life. */
  readonly project: ProjectRef;
  readonly entry: StandardEntry;
  /** UTC ISO-8601. */
  readonly publishedAt: string;
  readonly publishedBy: AccountRef;
}

/** Response of `GET /v1/modules/{id}/standards`: the live version of every Standard in the Module. */
export interface StandardList {
  readonly module: ModuleInfo;
  readonly standards: readonly StandardInfo[];
}

/** Response of `GET /v1/standards/{id}/versions`: every version, oldest first. */
export interface StandardVersionList {
  readonly standardId: UuidV7;
  readonly versions: readonly StandardInfo[];
}

/** Registry HTTP API paths for Standards. Every call carries `Authorization: Bearer <session token>`. */
export const STANDARD_API_PATHS = {
  standards: "/v1/standards",
} as const;

/**
 * `GET`: 200 {@link StandardList} (every role). `POST` a {@link StandardPublishRequest}:
 * 201 {@link StandardInfo}, version 1 of a new Standard (the Module's Standard owner only).
 */
export function moduleStandardsPath(moduleId: string): string {
  return `${MODULE_API_PATHS.modules}/${encodeURIComponent(moduleId)}/standards`;
}

/**
 * `GET`: 200 {@link StandardVersionList} (every role). `POST` a {@link StandardPublishRequest}:
 * 201 {@link StandardInfo}, the next version of the Standard (its Module's Standard owner only).
 */
export function standardVersionsPath(standardId: string): string {
  return `${STANDARD_API_PATHS.standards}/${encodeURIComponent(standardId)}/versions`;
}

/** The Standard id is malformed, unknown or another tenant's (subject `standardId`). */
export const STANDARD_NOT_FOUND = "standard_not_found";
/** The Module has no Standard owner, so nothing can be published into it (subject `moduleId`). */
export const MODULE_HAS_NO_OWNER = "module_has_no_owner";
/** The session's account is not the Module's current Standard owner (subject `role`). */
export const NOT_MODULE_OWNER = "not_module_owner";
/** Another live Standard already holds the proposed Conflict slot (subject: that Standard's id). */
export const SLOT_CONFLICT = "slot_conflict";

const isNullableString = (value: unknown): value is string | null => value === null || typeof value === "string";

/** True when `value` is a normalised {@link CodeStackEntry} with no other key. Never throws. */
export function isCodeStackEntry(value: unknown): value is CodeStackEntry {
  return (
    isRecord(value) &&
    Object.keys(value).every((key) => (CODE_STACK_ENTRY_FIELDS as readonly string[]).includes(key)) &&
    isCodeStackCategory(value["category"]) &&
    typeof value["name"] === "string" &&
    isNullableString(value["versionConstraint"]) &&
    isCodeStackStatus(value["status"]) &&
    isNullableString(value["correctionInstruction"])
  );
}

/** True when `value` is a normalised {@link DesignSystemEntry} with no other key. Never throws. */
export function isDesignSystemEntry(value: unknown): value is DesignSystemEntry {
  if (!isRecord(value)) return false;
  const kind = value["kind"];
  if (!isDesignSystemEntryKind(kind)) return false;
  const allowed = DESIGN_SYSTEM_ENTRY_FIELDS[kind] as readonly string[];
  if (!Object.keys(value).every((key) => allowed.includes(key))) return false;
  switch (kind) {
    case "component": {
      const tokens = value["tokens"];
      return (
        typeof value["name"] === "string" &&
        typeof value["usageRule"] === "string" &&
        Array.isArray(tokens) &&
        tokens.every((token) => typeof token === "string") &&
        isNullableString(value["correctionInstruction"])
      );
    }
    case "token":
      return typeof value["name"] === "string" && isDesignSystemStatus(value["status"]);
    case "import":
      return typeof value["specifier"] === "string" && isDesignSystemStatus(value["status"]);
  }
}

/** True when `value` is a {@link StandardEntry} of either Module kind. Never throws. */
export function isStandardEntry(value: unknown): value is StandardEntry {
  return isCodeStackEntry(value) || isDesignSystemEntry(value);
}

/** The slot kind of an entry: the code-stack category, or the design-system entry kind. */
export function entrySlotKind(entry: StandardEntry): CodeStackCategory | DesignSystemEntryKind {
  return "kind" in entry ? entry.kind : entry.category;
}

/** The slot name of an entry: its name, or an import's module specifier. */
export function entrySlotName(entry: StandardEntry): string {
  return "kind" in entry && entry.kind === "import" ? entry.specifier : entry.name;
}

function isRef(value: unknown): value is { id: UuidV7; name: string } {
  return isRecord(value) && isUuidV7(value["id"]) && typeof value["name"] === "string";
}

function isAccountRef(value: unknown): value is AccountRef {
  return isRecord(value) && isUuidV7(value["accountId"]) && typeof value["name"] === "string";
}

/** True when `value` is a {@link StandardInfo}. Never throws. */
export function isStandardInfo(value: unknown): value is StandardInfo {
  if (!isRecord(value)) return false;
  const version = value["version"];
  const module = value["module"];
  return (
    isUuidV7(value["id"]) &&
    typeof version === "number" &&
    Number.isInteger(version) &&
    version >= 1 &&
    isRef(module) &&
    isModuleKind((module as Record<string, unknown>)["kind"]) &&
    isRef(value["project"]) &&
    isStandardEntry(value["entry"]) &&
    isUtcIso(value["publishedAt"]) &&
    isAccountRef(value["publishedBy"])
  );
}

/** True when `value` is a {@link StandardList}. Never throws. */
export function isStandardList(value: unknown): value is StandardList {
  return (
    isRecord(value) &&
    isModuleInfo(value["module"]) &&
    Array.isArray(value["standards"]) &&
    value["standards"].every(isStandardInfo)
  );
}

/** True when `value` is a {@link StandardVersionList}. Never throws. */
export function isStandardVersionList(value: unknown): value is StandardVersionList {
  return (
    isRecord(value) &&
    isUuidV7(value["standardId"]) &&
    Array.isArray(value["versions"]) &&
    value["versions"].every(isStandardInfo)
  );
}
