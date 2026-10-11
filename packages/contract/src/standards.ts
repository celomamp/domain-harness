/**
 * The registry's Standards wire contract (Story 1.5): the code-stack entry
 * shape (kept stable for the Epic 5 Gate checks), the HTTP paths, request and
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

/**
 * Body of `POST /v1/modules/{id}/standards` and `POST /v1/standards/{id}/versions`.
 * The registry trims the text; `versionConstraint` and `correctionInstruction`
 * may be missing, `null` or `""` (stored as `null`).
 */
export interface StandardPublishRequest {
  readonly entry: {
    readonly category: string;
    readonly name: string;
    readonly versionConstraint?: string | null;
    readonly status: string;
    readonly correctionInstruction?: string | null;
  };
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
  /** The Project scope: the tenant's root Project in this release. */
  readonly project: ProjectRef;
  readonly entry: CodeStackEntry;
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
    isCodeStackEntry(value["entry"]) &&
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
