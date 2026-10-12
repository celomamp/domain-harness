/**
 * The registry's Project tree wire contract (Story 2.1): the limits, HTTP
 * paths, request and response bodies, error codes and runtime guards shared
 * by the registry (which serves them) and the panel (which calls them over
 * HTTP with the session as a Bearer token).
 *
 * Each Company has exactly one root Project (no parent); every other Project
 * has exactly one parent in the same Company. A level name is free text from
 * the Buyer, stored exactly as typed; Domain Harness never interprets it.
 */
import { isRecord, isUtcIso } from "./guards.ts";
import { isUuidV7 } from "./ids.ts";
import type { UuidV7 } from "./ids.ts";
import type { AccountRef } from "./modules.ts";

/** A Project name is trimmed and 1 to this many characters long. */
export const PROJECT_NAME_MAX = 200;
/** A level name is 1 to this many characters long, as typed, with at least one non-whitespace character. */
export const LEVEL_NAME_MAX = 200;

/** One Project. */
export interface ProjectInfo {
  readonly id: UuidV7;
  readonly name: string;
  /** Exactly as the Buyer typed it; `null` for the root Project until a later story lets the Buyer set it. */
  readonly levelName: string | null;
  /** The current parent; `null` only for the root Project. */
  readonly parentId: UuidV7 | null;
  /** UTC ISO-8601. */
  readonly createdAt: string;
}

/**
 * Response of `GET /v1/projects`: the root id and every Project of the
 * Company in depth-first order from the root, each Project's children ordered
 * by `createdAt`, then id.
 */
export interface ProjectTree {
  readonly rootId: UuidV7;
  readonly projects: readonly ProjectInfo[];
  /**
   * The Standards that are Locked rules now (Story 2.4), each at the Project
   * it is scoped to, ordered by `projectId`, then `standardId`.
   */
  readonly lockedRules: readonly LockedRuleMark[];
}

/**
 * One current Locked rule: a Standard the Buyer marked on the Project it is
 * scoped to. A descendant Project can never replace it.
 */
export interface LockedRuleMark {
  readonly standardId: UuidV7;
  /** The Project the Standard is scoped to. */
  readonly projectId: UuidV7;
  /** UTC ISO-8601: when the current mark was made. */
  readonly markedAt: string;
  /** The Buyer who made the current mark. */
  readonly markedBy: AccountRef;
}

/** Body of `POST /v1/projects` (exactly these keys). */
export interface ProjectCreateRequest {
  readonly name: string;
  readonly levelName: string;
  readonly parentId: string;
}

/** Body of `POST /v1/projects/{id}/parent` (exactly this key). */
export interface ProjectParentRequest {
  readonly parentId: string;
}

/** Registry HTTP API paths for the Project tree. Every call carries `Authorization: Bearer <session token>`. */
export const PROJECT_API_PATHS = {
  /** `GET`: 200 {@link ProjectTree} (every role). `POST` a {@link ProjectCreateRequest}: 201 {@link ProjectInfo} (Buyer only). */
  projects: "/v1/projects",
} as const;

/** `GET`: 200 {@link ProjectInfo} (every role). */
export function projectPath(projectId: string): string {
  return `${PROJECT_API_PATHS.projects}/${encodeURIComponent(projectId)}`;
}

/** `POST` a {@link ProjectParentRequest}: 200 {@link ProjectInfo} with the new parent (Buyer only). */
export function projectParentPath(projectId: string): string {
  return `${projectPath(projectId)}/parent`;
}

/** The Project id is malformed, unknown or another tenant's (subject `projectId` or `parentId`). */
export const PROJECT_NOT_FOUND = "project_not_found";
/** The proposed parent is the Project itself or one of its descendants (subject: that parent's id). */
export const PROJECT_CYCLE = "project_cycle";
/** The root Project's parent cannot be changed (subject `projectId`). */
export const ROOT_PROJECT_FIXED = "root_project_fixed";

/** True when `value` is a {@link ProjectInfo}. Never throws. */
export function isProjectInfo(value: unknown): value is ProjectInfo {
  return (
    isRecord(value) &&
    isUuidV7(value["id"]) &&
    typeof value["name"] === "string" &&
    (value["levelName"] === null || typeof value["levelName"] === "string") &&
    (value["parentId"] === null || isUuidV7(value["parentId"])) &&
    isUtcIso(value["createdAt"])
  );
}

function isAccountRef(value: unknown): value is AccountRef {
  return isRecord(value) && isUuidV7(value["accountId"]) && typeof value["name"] === "string";
}

/** True when `value` is a {@link LockedRuleMark}. Never throws. */
export function isLockedRuleMark(value: unknown): value is LockedRuleMark {
  return (
    isRecord(value) &&
    isUuidV7(value["standardId"]) &&
    isUuidV7(value["projectId"]) &&
    isUtcIso(value["markedAt"]) &&
    isAccountRef(value["markedBy"])
  );
}

/**
 * True when `value` is a {@link ProjectTree} whose root is listed and is the
 * only Project without a parent, and whose every Locked rule sits at a listed
 * Project. Never throws.
 */
export function isProjectTree(value: unknown): value is ProjectTree {
  if (!isRecord(value)) return false;
  const rootId = value["rootId"];
  const projects = value["projects"];
  const lockedRules = value["lockedRules"];
  if (!isUuidV7(rootId) || !Array.isArray(projects) || !projects.every(isProjectInfo)) return false;
  if (!Array.isArray(lockedRules) || !lockedRules.every(isLockedRuleMark)) return false;
  const ids = new Set(projects.map((project) => project.id));
  if (!lockedRules.every((mark) => ids.has(mark.projectId))) return false;
  const roots = projects.filter((project) => project.parentId === null);
  return roots.length === 1 && roots[0]?.id === rootId;
}
