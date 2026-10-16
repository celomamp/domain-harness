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
import { isBoilerplateTarget } from "./boilerplate.ts";
import type { BoilerplateTarget } from "./boilerplate.ts";
import { isCompilation } from "./compilations.ts";
import type { Compilation } from "./compilations.ts";
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
  /**
   * The agent tool of the Application's latest successful Boilerplate
   * generation, or `null` when none was generated yet.
   */
  readonly agentTool: BoilerplateTarget | null;
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
  /**
   * `POST` an {@link ApplicationCreateRequest}: 201
   * {@link IdentificationFileRendering} — the Project identification file to
   * commit, and nothing else (the Buyer only; any other role `role_denied`).
   * The request reuses {@link ApplicationCreateRequest}; the response is
   * guarded by `isIdentificationFileRendering`.
   */
  registered: "/v1/applications/registered",
} as const;

function isProjectRef(value: unknown): value is ProjectRef {
  return isRecord(value) && isUuidV7(value["id"]) && typeof value["name"] === "string";
}

/** True when `value` is an {@link ApplicationInfo} (its `agentTool` `null` or a known target). Never throws. */
export function isApplicationInfo(value: unknown): value is ApplicationInfo {
  const agentTool = isRecord(value) ? value["agentTool"] : undefined;
  return (
    isRecord(value) &&
    isUuidV7(value["id"]) &&
    typeof value["description"] === "string" &&
    isProjectRef(value["project"]) &&
    typeof value["fromFlow"] === "boolean" &&
    (agentTool === null || isBoilerplateTarget(agentTool)) &&
    isUtcIso(value["createdAt"])
  );
}

/** True when `value` is an {@link ApplicationList}. Never throws. */
export function isApplicationList(value: unknown): value is ApplicationList {
  return isRecord(value) && Array.isArray(value["applications"]) && value["applications"].every(isApplicationInfo);
}

/**
 * One Application's evidence (Story 6.6): the Application itself plus its
 * stored Compilations in per-Application `sequence` order. The panel derives
 * Adherence, deviation rows and Guidance consultation from these rows; the
 * registry derives nothing new.
 */
export interface ApplicationEvidence {
  readonly application: ApplicationInfo;
  readonly compilations: readonly Compilation[];
}

const APPLICATION_EVIDENCE_KEYS = new Set(["application", "compilations"]);

/** True when `value` is a complete {@link ApplicationEvidence}. Never throws. */
export function isApplicationEvidence(value: unknown): value is ApplicationEvidence {
  if (!isRecord(value)) return false;
  for (const key of Object.keys(value)) {
    if (!APPLICATION_EVIDENCE_KEYS.has(key)) return false;
  }
  return (
    isApplicationInfo(value["application"]) &&
    Array.isArray(value["compilations"]) &&
    (value["compilations"] as unknown[]).every(isCompilation)
  );
}

/** `GET` the evidence of one Application: 200 {@link ApplicationEvidence} (every role). */
export function applicationEvidencePath(applicationId: string): string {
  return `/v1/applications/${encodeURIComponent(applicationId)}/evidence`;
}
