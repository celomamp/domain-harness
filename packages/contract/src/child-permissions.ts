/**
 * The child-Project permission wire contract (Story 2.5): the HTTP path,
 * request and response bodies, error code and runtime guards shared by the
 * registry (which stores the grants) and the panel (which grants, revokes and
 * shows them).
 *
 * The Buyer grants or revokes, per account and per Project, the permission to
 * create child Projects directly under that Project. A grant on a Project
 * covers its direct children only and is not inherited down the tree. The
 * Buyer never needs a grant.
 */
import { isRole } from "./accounts.ts";
import type { Role } from "./accounts.ts";
import { isRecord, isUtcIso } from "./guards.ts";
import { isUuidV7 } from "./ids.ts";
import type { AccountRef } from "./modules.ts";
import { projectPath } from "./projects.ts";
import type { ProjectRef } from "./standards.ts";

/** An account with its role. */
export interface RoledAccountRef extends AccountRef {
  readonly role: Role;
}

/** One current grant of the permission to create child Projects under a Project. */
export interface ChildPermission {
  readonly account: RoledAccountRef;
  /** UTC ISO-8601 of the grant. */
  readonly grantedAt: string;
  /** The Buyer who made the grant. */
  readonly grantedBy: AccountRef;
}

/** Response of `GET /v1/projects/{id}/child-permissions`. */
export interface ChildPermissionList {
  readonly project: ProjectRef;
  /** The current grants only, ordered by account name, then account id. */
  readonly grants: readonly ChildPermission[];
  /** Every account of the Company that is not the Buyer, ordered by name, then id. */
  readonly eligibleAccounts: readonly RoledAccountRef[];
}

/** Body of `POST /v1/projects/{id}/child-permissions` (exactly these keys). */
export interface ChildPermissionRequest {
  readonly accountId: string;
  readonly granted: boolean;
}

/** Response of `POST /v1/projects/{id}/child-permissions`: the pair's current state. */
export interface ChildPermissionState {
  readonly project: ProjectRef;
  readonly account: RoledAccountRef;
  readonly granted: boolean;
  /** UTC ISO-8601 of the latest grant or revoke; `null` when the pair never had one. */
  readonly changedAt: string | null;
  /** The Buyer who made the latest grant or revoke; `null` when the pair never had one. */
  readonly changedBy: AccountRef | null;
}

/**
 * `GET`: 200 {@link ChildPermissionList} (every role). `POST` a
 * {@link ChildPermissionRequest}: 200 {@link ChildPermissionState} (Buyer only).
 */
export function childPermissionsPath(projectId: string): string {
  return `${projectPath(projectId)}/child-permissions`;
}

/** The caller may not create a child Project under this parent (subject `parentId`); ask the Buyer. */
export const CHILD_PERMISSION_DENIED = "child_permission_denied";

function isAccountRef(value: unknown): value is AccountRef {
  return isRecord(value) && isUuidV7(value["accountId"]) && typeof value["name"] === "string";
}

function isRoledAccountRef(value: unknown): value is RoledAccountRef {
  return isRecord(value) && isAccountRef(value) && isRole(value["role"]);
}

function isProjectRef(value: unknown): value is ProjectRef {
  return isRecord(value) && isUuidV7(value["id"]) && typeof value["name"] === "string";
}

/** True when `value` is a {@link ChildPermission}. Never throws. */
export function isChildPermission(value: unknown): value is ChildPermission {
  return (
    isRecord(value) &&
    isRoledAccountRef(value["account"]) &&
    isUtcIso(value["grantedAt"]) &&
    isAccountRef(value["grantedBy"])
  );
}

/** True when `value` is a {@link ChildPermissionList}. Never throws. */
export function isChildPermissionList(value: unknown): value is ChildPermissionList {
  return (
    isRecord(value) &&
    isProjectRef(value["project"]) &&
    Array.isArray(value["grants"]) &&
    value["grants"].every(isChildPermission) &&
    Array.isArray(value["eligibleAccounts"]) &&
    value["eligibleAccounts"].every(isRoledAccountRef)
  );
}

/** True when `value` is a {@link ChildPermissionState}. Never throws. */
export function isChildPermissionState(value: unknown): value is ChildPermissionState {
  if (!isRecord(value)) return false;
  const granted = value["granted"];
  if (!isProjectRef(value["project"]) || !isRoledAccountRef(value["account"]) || typeof granted !== "boolean") {
    return false;
  }
  const changedAt = value["changedAt"];
  const changedBy = value["changedBy"];
  // No row yet means not granted.
  if (changedAt === null && changedBy === null) return !granted;
  return isUtcIso(changedAt) && isAccountRef(changedBy);
}
