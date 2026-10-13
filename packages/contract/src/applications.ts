/**
 * The Application wire contract (Story 3.1): the limits, HTTP path, request
 * and response bodies and runtime guards shared by the registry (which mints
 * and stores Applications) and the panel (which places and lists them).
 *
 * An Application is bound to exactly one Project. Its id is a UUIDv7 minted
 * by the registry, never by a client. `fromFlow` records whether the
 * New-application flow created it. The wire never carries who created it.
 */
import { isRecord, isUtcIso } from "./guards.ts";
import { isUuidV7 } from "./ids.ts";
import type { UuidV7 } from "./ids.ts";
import type { ProjectRef } from "./standards.ts";

/** An Application description is trimmed and 1 to this many characters long. */
export const APPLICATION_DESCRIPTION_MAX = 500;

/** One Application. */
export interface ApplicationInfo {
  readonly id: UuidV7;
  /** Stored trimmed. */
  readonly description: string;
  /** The one Project the Application is bound to. */
  readonly project: ProjectRef;
  /** True when the New-application flow created it. */
  readonly fromFlow: boolean;
  /** UTC ISO-8601. */
  readonly createdAt: string;
}

/** Response of `GET /v1/applications`: every Application of the Company, ordered by `createdAt`, then id. */
export interface ApplicationList {
  readonly applications: readonly ApplicationInfo[];
}

/** Body of `POST /v1/applications` (exactly these keys). */
export interface ApplicationCreateRequest {
  readonly description: string;
  readonly projectId: string;
}

/** Registry HTTP API paths for Applications. Every call carries `Authorization: Bearer <session token>`. */
export const APPLICATION_API_PATHS = {
  /**
   * `GET`: 200 {@link ApplicationList} (every role). `POST` an
   * {@link ApplicationCreateRequest}: 201 {@link ApplicationInfo} (the Buyer,
   * or an account with a build grant on the Project).
   */
  applications: "/v1/applications",
} as const;

function isProjectRef(value: unknown): value is ProjectRef {
  return isRecord(value) && isUuidV7(value["id"]) && typeof value["name"] === "string";
}

/** True when `value` is an {@link ApplicationInfo}. Never throws. */
export function isApplicationInfo(value: unknown): value is ApplicationInfo {
  return (
    isRecord(value) &&
    isUuidV7(value["id"]) &&
    typeof value["description"] === "string" &&
    isProjectRef(value["project"]) &&
    typeof value["fromFlow"] === "boolean" &&
    isUtcIso(value["createdAt"])
  );
}

/** True when `value` is an {@link ApplicationList}. Never throws. */
export function isApplicationList(value: unknown): value is ApplicationList {
  return isRecord(value) && Array.isArray(value["applications"]) && value["applications"].every(isApplicationInfo);
}
