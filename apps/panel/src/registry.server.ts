/**
 * The panel's only way to the registry: its JSON HTTP API. Every response is
 * checked against the contract guards; anything else (network failure,
 * timeout, unexpected status or body) is reported as `unavailable`, never
 * thrown, so a registry outage cannot break a page.
 */
import {
  ACCEPTED_DEVIATION_API_PATHS,
  APPLICATION_API_PATHS,
  applicationBoilerplatePath,
  buildGrantsPath,
  childPermissionsPath,
  effectiveStandardsPath,
  GUIDANCE_ENDPOINT_PATH,
  isAcceptedDeviationRecord,
  isAcceptedDeviationRecordList,
  isApplicationInfo,
  isApplicationList,
  isBoilerplateResult,
  isBuildGrantList,
  isBuildGrantState,
  isChildPermissionList,
  isChildPermissionState,
  isEffectiveStandardSet,
  isErrorEnvelope,
  isGuidanceEndpointState,
  isIdentificationFileRendering,
  isLockedRuleState,
  isModuleInfo,
  isModuleList,
  isProjectInfo,
  isProjectTree,
  isRecord,
  isSessionCreated,
  isSessionInfo,
  isStandardInfo,
  isStandardList,
  isStandardVersionList,
  lockedRulePath,
  MODULE_API_PATHS,
  moduleOwnerPath,
  moduleStandardsPath,
  PROJECT_API_PATHS,
  projectParentPath,
  REGISTRY_API_PATHS,
  standardVersionsPath,
} from "@domain-harness/contract";
import type {
  AcceptedDeviationRecord,
  ApplicationCreateRequest,
  ApplicationInfo,
  ApplicationList,
  BoilerplateRequest,
  BoilerplateResult,
  BuildGrantList,
  BuildGrantRequest,
  BuildGrantState,
  ChildPermissionList,
  ChildPermissionRequest,
  ChildPermissionState,
  EffectiveStandardSet,
  ErrorEnvelope,
  GuidanceEndpointRequest,
  GuidanceEndpointState,
  IdentificationFileRendering,
  LockedRuleRequest,
  LockedRuleState,
  ModuleInfo,
  ModuleList,
  ProjectInfo,
  ProjectTree,
  SessionCreated,
  SessionInfo,
  StandardInfo,
  StandardList,
  StandardPublishRequest,
  StandardVersionList,
} from "@domain-harness/contract";

export const DEFAULT_REGISTRY_URL = "http://127.0.0.1:4100";
const TIMEOUT_MS = 5_000;

export type RegistryResult<T> =
  | { readonly kind: "ok"; readonly value: T }
  | { readonly kind: "refused"; readonly error: ErrorEnvelope }
  | { readonly kind: "unavailable" };

/** `PANEL_REGISTRY_URL`, or the local default; without a trailing slash. */
export function registryBaseUrl(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const value = env["PANEL_REGISTRY_URL"]?.trim();
  return (value === undefined || value === "" ? DEFAULT_REGISTRY_URL : value).replace(/\/+$/, "");
}

async function call<T>(
  path: string,
  init: RequestInit,
  okStatus: number,
  guard: (value: unknown) => value is T,
): Promise<RegistryResult<T>> {
  let response: Response;
  try {
    response = await fetch(`${registryBaseUrl()}${path}`, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    return { kind: "unavailable" };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { kind: "unavailable" };
  }
  if (response.status === okStatus && guard(body)) return { kind: "ok", value: body };
  if (response.status >= 400 && response.status < 500 && isErrorEnvelope(body)) return { kind: "refused", error: body };
  return { kind: "unavailable" };
}

const json = (body: unknown, headers: Record<string, string> = {}): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json", ...headers },
  body: JSON.stringify(body),
});

const bearer = (sessionToken: string): Record<string, string> => ({ authorization: `Bearer ${sessionToken}` });

const isEmptyObject = (value: unknown): value is Record<string, never> =>
  typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length === 0;

/** Ask the registry to email sign-in links for `email` (202 `{}` whether or not an account exists). */
export function requestSignInLink(email: string): Promise<RegistryResult<Record<string, never>>> {
  return call(REGISTRY_API_PATHS.signInLinks, json({ email }), 202, isEmptyObject);
}

/** Exchange an emailed link token for a session. */
export function createSession(token: string): Promise<RegistryResult<SessionCreated>> {
  return call(REGISTRY_API_PATHS.sessions, json({ token }), 201, isSessionCreated);
}

/** Who the session token belongs to. */
export function getSession(sessionToken: string): Promise<RegistryResult<SessionInfo>> {
  return call(
    REGISTRY_API_PATHS.session,
    { method: "GET", headers: { ...bearer(sessionToken), accept: "application/json" } },
    200,
    isSessionInfo,
  );
}

/** The Company's Modules with their current Standard owners, and the accounts eligible to own one. */
export function listModules(sessionToken: string): Promise<RegistryResult<ModuleList>> {
  return call(
    MODULE_API_PATHS.modules,
    { method: "GET", headers: { ...bearer(sessionToken), accept: "application/json" } },
    200,
    isModuleList,
  );
}

/**
 * Create a Module (the registry allows only the Buyer). `kind` and `name` are
 * passed as submitted; the registry validates them and answers field errors.
 */
export function createModule(sessionToken: string, kind: string, name: string): Promise<RegistryResult<ModuleInfo>> {
  return call(MODULE_API_PATHS.modules, json({ kind, name }, bearer(sessionToken)), 201, isModuleInfo);
}

/** Assign a Module's Standard owner (the registry allows only the Buyer). */
export function assignModuleOwner(
  sessionToken: string,
  moduleId: string,
  accountId: string,
): Promise<RegistryResult<ModuleInfo>> {
  return call(moduleOwnerPath(moduleId), json({ accountId }, bearer(sessionToken)), 200, isModuleInfo);
}

const getJson = (sessionToken: string): RequestInit => ({
  method: "GET",
  headers: { ...bearer(sessionToken), accept: "application/json" },
});

/** The live version of every Standard in a Module, with the Module itself (every role may read). */
export function listStandards(sessionToken: string, moduleId: string): Promise<RegistryResult<StandardList>> {
  return call(moduleStandardsPath(moduleId), getJson(sessionToken), 200, isStandardList);
}

/** Every version of one Standard, oldest first (every role may read). */
export function getStandardVersions(
  sessionToken: string,
  standardId: string,
): Promise<RegistryResult<StandardVersionList>> {
  return call(standardVersionsPath(standardId), getJson(sessionToken), 200, isStandardVersionList);
}

/**
 * Publish version 1 of a new Standard into a Module (the registry allows only
 * the Module's Standard owner). The entry is passed as submitted; the registry
 * trims, validates and answers field errors. `projectId` is the Standard's
 * Project scope, sent only when defined (the registry defaults to the root
 * Project); it is fixed for the Standard's life.
 */
export function publishStandard(
  sessionToken: string,
  moduleId: string,
  entry: StandardPublishRequest["entry"],
  projectId?: string,
): Promise<RegistryResult<StandardInfo>> {
  const body: StandardPublishRequest = projectId === undefined ? { entry } : { entry, projectId };
  return call(moduleStandardsPath(moduleId), json(body, bearer(sessionToken)), 201, isStandardInfo);
}

/** Publish the next version of an existing Standard (its Module's Standard owner only). */
export function publishStandardVersion(
  sessionToken: string,
  standardId: string,
  entry: StandardPublishRequest["entry"],
): Promise<RegistryResult<StandardInfo>> {
  return call(standardVersionsPath(standardId), json({ entry }, bearer(sessionToken)), 201, isStandardInfo);
}

/** The Company's Project tree, depth-first from the root (every role may read). */
export function getProjectTree(sessionToken: string): Promise<RegistryResult<ProjectTree>> {
  return call(PROJECT_API_PATHS.projects, getJson(sessionToken), 200, isProjectTree);
}

/**
 * A Project's Effective Standard set, resolved by the registry's core (every
 * role may read). Served in core's order; the panel never re-sorts it.
 */
export function getEffectiveStandards(
  sessionToken: string,
  projectId: string,
): Promise<RegistryResult<EffectiveStandardSet>> {
  return call(effectiveStandardsPath(projectId), getJson(sessionToken), 200, isEffectiveStandardSet);
}

/**
 * Create a Project under a parent (the registry allows the Buyer anywhere, and
 * any other account under a Project on which it holds the child-Project
 * permission). The
 * values are passed as submitted; the registry trims the name, keeps the
 * level name exactly as typed, validates and answers field errors.
 */
export function createProject(
  sessionToken: string,
  input: { readonly name: string; readonly levelName: string; readonly parentId: string },
): Promise<RegistryResult<ProjectInfo>> {
  const body = { name: input.name, levelName: input.levelName, parentId: input.parentId };
  return call(PROJECT_API_PATHS.projects, json(body, bearer(sessionToken)), 201, isProjectInfo);
}

/** Change a Project's parent (the registry allows only the Buyer and refuses a cycle). */
export function changeProjectParent(
  sessionToken: string,
  projectId: string,
  parentId: string,
): Promise<RegistryResult<ProjectInfo>> {
  return call(projectParentPath(projectId), json({ parentId }, bearer(sessionToken)), 200, isProjectInfo);
}

/** Mark (`locked: true`) or remove (`locked: false`) a Standard's Locked rule (the registry allows only the Buyer). */
export function setLockedRule(
  sessionToken: string,
  standardId: string,
  locked: boolean,
): Promise<RegistryResult<LockedRuleState>> {
  const body: LockedRuleRequest = { locked };
  return call(lockedRulePath(standardId), json(body, bearer(sessionToken)), 200, isLockedRuleState);
}

/** A Project's current child-Project permission grants and the accounts that can hold one (every role may read). */
export function getChildPermissions(
  sessionToken: string,
  projectId: string,
): Promise<RegistryResult<ChildPermissionList>> {
  return call(childPermissionsPath(projectId), getJson(sessionToken), 200, isChildPermissionList);
}

/**
 * Grant (`granted: true`) or revoke (`granted: false`) one account's
 * permission to create child Projects under a Project (the registry allows
 * only the Buyer).
 */
export function setChildPermission(
  sessionToken: string,
  projectId: string,
  accountId: string,
  granted: boolean,
): Promise<RegistryResult<ChildPermissionState>> {
  const body: ChildPermissionRequest = { accountId, granted };
  return call(childPermissionsPath(projectId), json(body, bearer(sessionToken)), 200, isChildPermissionState);
}

/** A Project's current build grants and the accounts that can hold one (every role may read). */
export function getBuildGrants(sessionToken: string, projectId: string): Promise<RegistryResult<BuildGrantList>> {
  return call(buildGrantsPath(projectId), getJson(sessionToken), 200, isBuildGrantList);
}

/**
 * Grant (`granted: true`) or revoke (`granted: false`) one account's build
 * grant on a Project (the registry allows only the Buyer).
 */
export function setBuildGrant(
  sessionToken: string,
  projectId: string,
  accountId: string,
  granted: boolean,
): Promise<RegistryResult<BuildGrantState>> {
  const body: BuildGrantRequest = { accountId, granted };
  return call(buildGrantsPath(projectId), json(body, bearer(sessionToken)), 200, isBuildGrantState);
}

/** Every Application of the Company, ordered by creation time (every role may read). */
export function getApplications(sessionToken: string): Promise<RegistryResult<ApplicationList>> {
  return call(APPLICATION_API_PATHS.applications, getJson(sessionToken), 200, isApplicationList);
}

/**
 * Place a new Application on a Project through the New-application flow (the
 * registry allows the Buyer anywhere, and any other account on a Project on
 * which it holds a build grant). The values are passed as submitted; the
 * registry trims the description, validates and answers field errors.
 */
export function createApplication(
  sessionToken: string,
  input: { readonly description: string; readonly projectId: string },
): Promise<RegistryResult<ApplicationInfo>> {
  const body: ApplicationCreateRequest = { description: input.description, projectId: input.projectId };
  return call(APPLICATION_API_PATHS.applications, json(body, bearer(sessionToken)), 201, isApplicationInfo);
}

/**
 * Register an existing Application (the registry allows only the Buyer). The
 * values are passed as submitted; the registry trims the description,
 * validates and answers field errors, and answers only the Project
 * identification file to commit — no Boilerplate.
 */
export function registerApplication(
  sessionToken: string,
  input: { readonly description: string; readonly projectId: string },
): Promise<RegistryResult<IdentificationFileRendering>> {
  const body: ApplicationCreateRequest = { description: input.description, projectId: input.projectId };
  return call(APPLICATION_API_PATHS.registered, json(body, bearer(sessionToken)), 201, isIdentificationFileRendering);
}

/** The Company Guidance endpoint (every role may read). */
export function getGuidanceEndpoint(sessionToken: string): Promise<RegistryResult<GuidanceEndpointState>> {
  return call(GUIDANCE_ENDPOINT_PATH, getJson(sessionToken), 200, isGuidanceEndpointState);
}

/**
 * Set the Company Guidance endpoint URL (the registry allows only the
 * Buyer). The URL is passed as submitted; the registry trims and validates it.
 */
export function setGuidanceEndpoint(sessionToken: string, url: string): Promise<RegistryResult<GuidanceEndpointState>> {
  const body: GuidanceEndpointRequest = { url };
  return call(GUIDANCE_ENDPOINT_PATH, json(body, bearer(sessionToken)), 200, isGuidanceEndpointState);
}

/**
 * Generate an Application's Boilerplate for one agent tool (every role). The
 * target is passed as submitted; the registry refuses an unknown one.
 */
export function generateBoilerplate(
  sessionToken: string,
  applicationId: string,
  target: string,
): Promise<RegistryResult<BoilerplateResult>> {
  const body = { target } as BoilerplateRequest;
  return call(applicationBoilerplatePath(applicationId), json(body, bearer(sessionToken)), 200, isBoilerplateResult);
}

/** The Company's stored Accepted-deviation records, newest first (every role may read). */
export async function getAcceptedDeviations(sessionToken: string): Promise<RegistryResult<AcceptedDeviationRecord[]>> {
  // The registry answers `{ records: [...] }`; the guard checks that envelope
  // and the `.records` array is mapped out, keeping the result's value the
  // records themselves.
  const result = await call(
    ACCEPTED_DEVIATION_API_PATHS.acceptedDeviations,
    getJson(sessionToken),
    200,
    (value): value is { readonly records: AcceptedDeviationRecord[] } =>
      isRecord(value) && isAcceptedDeviationRecordList(value["records"]),
  );
  return result.kind === "ok" ? { kind: "ok", value: result.value.records } : result;
}

/**
 * Record an Accepted deviation (the registry allows only the Buyer). Every
 * field is passed as submitted; the registry resolves the Standard version
 * authoritatively and answers field errors.
 */
export function recordAcceptance(
  sessionToken: string,
  input: AcceptedDeviationRecordRequest,
): Promise<RegistryResult<AcceptedDeviationRecord>> {
  return call(
    ACCEPTED_DEVIATION_API_PATHS.acceptedDeviations,
    json(
      {
        applicationId: input.applicationId,
        standardId: input.standardId,
        slot: input.slot,
        subject: input.subject,
        start: input.start,
        end: input.end,
        justification: input.justification,
        alertIntervalHours: input.alertIntervalHours,
      },
      bearer(sessionToken),
    ),
    201,
    isAcceptedDeviationRecord,
  );
}

/** The body `recordAcceptance` submits, exactly the fields the registry validates. */
export interface AcceptedDeviationRecordRequest {
  readonly applicationId: string;
  readonly standardId: string;
  readonly slot: { readonly moduleKind: string; readonly slotKind: string; readonly name: string };
  readonly subject: string;
  readonly start: string;
  readonly end: string;
  readonly justification: string;
  readonly alertIntervalHours: number;
}
