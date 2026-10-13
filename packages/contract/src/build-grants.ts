/**
 * The build grant wire contract (Story 3.1): the HTTP path, request and
 * response bodies, error code and runtime guards shared by the registry (which
 * stores the grants) and the panel (which grants, revokes and shows them).
 *
 * The Buyer grants or revokes, per account and per Project, the build grant:
 * the right to place a new Application on that Project. A grant covers that
 * Project only, is never inherited down the tree, and stays with its Project
 * through a re-parent. It is separate from the child-Project permission. The
 * Buyer never needs one.
 */
import { isRole } from "./accounts.ts";
import type { RoledAccountRef } from "./child-permissions.ts";
import { isRecord, isUtcIso } from "./guards.ts";
import { isUuidV7 } from "./ids.ts";
import type { AccountRef } from "./modules.ts";
import { projectPath } from "./projects.ts";
import type { ProjectRef } from "./standards.ts";

/** One current build grant on a Project. */
export interface BuildGrant {
  readonly account: RoledAccountRef;
  /** UTC ISO-8601 of the grant. */
  readonly grantedAt: string;
  /** The Buyer who made the grant. */
  readonly grantedBy: AccountRef;
}

/** Response of `GET /v1/projects/{id}/build-grants`. */
export interface BuildGrantList {
  readonly project: ProjectRef;
  /** The current grants only, ordered by account name, then account id. */
  readonly grants: readonly BuildGrant[];
  /** Every account of the Company that is not the Buyer, ordered by name, then id. */
  readonly eligibleAccounts: readonly RoledAccountRef[];
}

/** Body of `POST /v1/projects/{id}/build-grants` (exactly these keys). */
export interface BuildGrantRequest {
  readonly accountId: string;
  readonly granted: boolean;
}

/** Response of `POST /v1/projects/{id}/build-grants`: the pair's current state. */
export interface BuildGrantState {
  readonly project: ProjectRef;
  readonly account: RoledAccountRef;
  readonly granted: boolean;
  /** UTC ISO-8601 of the latest grant or revoke; `null` when the pair never had one. */
  readonly changedAt: string | null;
  /** The Buyer who made the latest grant or revoke; `null` when the pair never had one. */
  readonly changedBy: AccountRef | null;
}

/**
 * `GET`: 200 {@link BuildGrantList} (every role). `POST` a
 * {@link BuildGrantRequest}: 200 {@link BuildGrantState} (Buyer only).
 */
export function buildGrantsPath(projectId: string): string {
  return `${projectPath(projectId)}/build-grants`;
}

/** The caller holds no build grant on this Project (subject `projectId`); ask the Buyer. */
export const BUILD_GRANT_DENIED = "build_grant_denied";

function isAccountRef(value: unknown): value is AccountRef {
  return isRecord(value) && isUuidV7(value["accountId"]) && typeof value["name"] === "string";
}

function isRoledAccountRef(value: unknown): value is RoledAccountRef {
  return isRecord(value) && isAccountRef(value) && isRole(value["role"]);
}

function isProjectRef(value: unknown): value is ProjectRef {
  return isRecord(value) && isUuidV7(value["id"]) && typeof value["name"] === "string";
}

/** True when `value` is a {@link BuildGrant}. Never throws. */
export function isBuildGrant(value: unknown): value is BuildGrant {
  return (
    isRecord(value) &&
    isRoledAccountRef(value["account"]) &&
    isUtcIso(value["grantedAt"]) &&
    isAccountRef(value["grantedBy"])
  );
}

/** True when `value` is a {@link BuildGrantList}. Never throws. */
export function isBuildGrantList(value: unknown): value is BuildGrantList {
  return (
    isRecord(value) &&
    isProjectRef(value["project"]) &&
    Array.isArray(value["grants"]) &&
    value["grants"].every(isBuildGrant) &&
    Array.isArray(value["eligibleAccounts"]) &&
    value["eligibleAccounts"].every(isRoledAccountRef)
  );
}

/** True when `value` is a {@link BuildGrantState}. Never throws. */
export function isBuildGrantState(value: unknown): value is BuildGrantState {
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
