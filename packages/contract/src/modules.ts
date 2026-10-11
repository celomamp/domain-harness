/**
 * The registry's Module wire contract (Story 1.4): the two Module kinds, the
 * HTTP paths, request and response bodies, error codes and runtime guards
 * shared by the registry (which serves them) and the panel (which calls them
 * over HTTP with the session as a Bearer token).
 */
import { isRecord, isUtcIso } from "./guards.ts";
import { isUuidV7 } from "./ids.ts";
import type { UuidV7 } from "./ids.ts";

/** The first cut offers exactly these two Module kinds. */
export const MODULE_KINDS = ["code-stack", "design-system"] as const;
export type ModuleKind = (typeof MODULE_KINDS)[number];

/** How each kind is written in the management panel (glossary spelling, lowercase). */
export const MODULE_KIND_LABELS: Readonly<Record<ModuleKind, string>> = {
  "code-stack": "code stack",
  "design-system": "design system",
};

/** True when `value` is exactly one of {@link MODULE_KINDS}. Never throws. */
export function isModuleKind(value: unknown): value is ModuleKind {
  return typeof value === "string" && (MODULE_KINDS as readonly string[]).includes(value);
}

/** A Module name is trimmed and 1 to this many characters long. */
export const MODULE_NAME_MAX = 120;

/** The stored and compared form of a Module name: trimmed. */
export function normalizeModuleName(name: string): string {
  return name.trim();
}

/** True when `value` is a string whose trimmed form is 1 to {@link MODULE_NAME_MAX} characters. Never throws. */
export function isModuleName(value: unknown): value is string {
  if (typeof value !== "string") return false;
  // Counted in code points, as PostgreSQL char_length counts characters.
  const length = Array.from(normalizeModuleName(value)).length;
  return length >= 1 && length <= MODULE_NAME_MAX;
}

/** Registry HTTP API paths for Modules. Every call carries `Authorization: Bearer <session token>`. */
export const MODULE_API_PATHS = {
  /** `GET`: 200 {@link ModuleList}. `POST` a {@link ModuleCreateRequest}: 201 {@link ModuleInfo} (Buyer only). */
  modules: "/v1/modules",
} as const;

/** `POST` a {@link ModuleOwnerAssignRequest} here: 200 {@link ModuleInfo} (Buyer only). */
export function moduleOwnerPath(moduleId: string): string {
  return `${MODULE_API_PATHS.modules}/${encodeURIComponent(moduleId)}/owner`;
}

/** The session's role may not perform the action (subject `role`). */
export const ROLE_DENIED = "role_denied";
/** The Module id is malformed, unknown or another tenant's (subject `moduleId`). */
export const MODULE_NOT_FOUND = "module_not_found";
/** Another Module of the tenant already has this name, compared case-insensitively (subject `name`). */
export const MODULE_NAME_TAKEN = "module_name_taken";

/** Body of `POST /v1/modules`. */
export interface ModuleCreateRequest {
  readonly kind: ModuleKind;
  readonly name: string;
}

/** Body of `POST /v1/modules/{id}/owner`. */
export interface ModuleOwnerAssignRequest {
  readonly accountId: UuidV7;
}

/** An account as the Modules surface shows it: id and name, never email. */
export interface AccountRef {
  readonly accountId: UuidV7;
  readonly name: string;
}

/** A Module's current Standard owner: the latest assignment. */
export interface ModuleOwner extends AccountRef {
  /** UTC ISO-8601. */
  readonly assignedAt: string;
  /** The Buyer who made the assignment. */
  readonly assignedBy: AccountRef;
}

/** One Module. */
export interface ModuleInfo {
  readonly id: UuidV7;
  readonly kind: ModuleKind;
  readonly name: string;
  /** `null` until the Buyer assigns a Standard owner. */
  readonly owner: ModuleOwner | null;
  /** UTC ISO-8601. */
  readonly createdAt: string;
}

/** Response of `GET /v1/modules`. */
export interface ModuleList {
  readonly modules: readonly ModuleInfo[];
  /** The accounts eligible to own a Module: the tenant's `Standard owner` accounts. */
  readonly standardOwners: readonly AccountRef[];
}

function isAccountRef(value: unknown): value is AccountRef {
  return isRecord(value) && isUuidV7(value["accountId"]) && typeof value["name"] === "string";
}

function isModuleOwner(value: unknown): value is ModuleOwner {
  return isRecord(value) && isAccountRef(value) && isUtcIso(value["assignedAt"]) && isAccountRef(value["assignedBy"]);
}

/** True when `value` is a {@link ModuleInfo}. Never throws. */
export function isModuleInfo(value: unknown): value is ModuleInfo {
  return (
    isRecord(value) &&
    isUuidV7(value["id"]) &&
    isModuleKind(value["kind"]) &&
    typeof value["name"] === "string" &&
    (value["owner"] === null || isModuleOwner(value["owner"])) &&
    isUtcIso(value["createdAt"])
  );
}

/** True when `value` is a {@link ModuleList}. Never throws. */
export function isModuleList(value: unknown): value is ModuleList {
  return (
    isRecord(value) &&
    Array.isArray(value["modules"]) &&
    value["modules"].every(isModuleInfo) &&
    Array.isArray(value["standardOwners"]) &&
    value["standardOwners"].every(isAccountRef)
  );
}
