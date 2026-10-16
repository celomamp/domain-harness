import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import {
  ACCEPTED_DEVIATION_ALERT_API_PATHS,
  ACCEPTED_DEVIATION_API_PATHS,
  APPLICATION_API_PATHS,
  BUNDLE_API_PATHS,
  APPLICATION_NOT_FOUND,
  BOILERPLATE_CONFLICT,
  BUILD_GRANT_DENIED,
  CATALOG_UNREAD,
  CHILD_PERMISSION_DENIED,
  COMPILATION_API_PATHS,
  GUIDANCE_ACCESS_API_PATHS,
  GUIDANCE_ENDPOINT_PATH,
  GUIDANCE_ENDPOINT_UNSET,
  INVENTORY_API_PATHS,
  isEmailAddress,
  LOCKED_RULE_CONFLICT,
  MODULE_API_PATHS,
  MODULE_HAS_NO_OWNER,
  MODULE_NAME_TAKEN,
  MODULE_NOT_FOUND,
  NOT_MODULE_OWNER,
  PLAN_REFUSED,
  PROJECT_API_PATHS,
  PROJECT_CYCLE,
  PROJECT_NOT_FOUND,
  REGISTRY_API_PATHS,
  ROLE_DENIED,
  ROOT_PROJECT_FIXED,
  SESSION_INVALID,
  SIGN_IN_LINK_INVALID,
  SLOT_CONFLICT,
  STANDARD_API_PATHS,
  STANDARD_NOT_FOUND,
  UNSUPPORTED_ECOSYSTEM,
} from "@domain-harness/contract";
import type { ErrorEnvelope, SessionInfo } from "@domain-harness/contract";
import { isEnvelopeError } from "../errors.ts";
import { assertBuyer } from "../modules/service.ts";
import type { ApplicationService } from "../applications/service.ts";
import type { BundleService } from "../bundles/service.ts";
import { assertBundleSettingsBuyer } from "../bundles/service.ts";
import { assertApplicationBuyer } from "../applications/service.ts";
import type { CompilationsService } from "../compilations/service.ts";
import { assertCompilationBuyer } from "../compilations/service.ts";
import type { BoilerplateService } from "../boilerplate/service.ts";
import { assertAcceptedDeviationBuyer } from "../accepted-deviations/service.ts";
import type { AcceptedDeviationsService } from "../accepted-deviations/service.ts";
import { assertAcceptedDeviationAlertBuyer } from "../accepted-deviation-alerts/service.ts";
import type { AcceptedDeviationAlertsService } from "../accepted-deviation-alerts/service.ts";
import type { BuildGrantService } from "../build-grants/service.ts";
import type { ChildPermissionService } from "../child-permissions/service.ts";
import { assertGuidanceEndpointBuyer } from "../guidance-endpoint/service.ts";
import type { GuidanceEndpointService } from "../guidance-endpoint/service.ts";
import { assertGuidanceAccessBuyer } from "../guidance-access/service.ts";
import type { GuidanceAccessService } from "../guidance-access/service.ts";
import type { LockedRuleService } from "../locked-rules/service.ts";
import type { ModuleService } from "../modules/service.ts";
import type { ProjectService } from "../projects/service.ts";
import type { SignInService } from "../sign-in/service.ts";
import type { StandardService } from "../standards/service.ts";

/**
 * Request bodies larger than this are refused with 413. 64 KiB holds the
 * longest valid design-system component (50 token names of 200 characters
 * each, plus its usage rule and Correction instruction) in four-byte UTF-8.
 */
export const MAX_BODY_BYTES = 64 * 1024;

/** One structured log line: ids, codes, statuses and counts only, never emails, tokens or links. */
export type LogEvent = Readonly<Record<string, string | number>>;
export type Logger = (event: LogEvent) => void;

/** Writes each event as one JSON line to stdout. */
export const stdoutLogger: Logger = (event) => {
  process.stdout.write(`${JSON.stringify(event)}\n`);
};

const STATUS_BY_CODE: Readonly<Record<string, number>> = {
  invalid_input: 400,
  [SIGN_IN_LINK_INVALID]: 401,
  [SESSION_INVALID]: 401,
  [ROLE_DENIED]: 403,
  [NOT_MODULE_OWNER]: 403,
  [CHILD_PERMISSION_DENIED]: 403,
  [BUILD_GRANT_DENIED]: 403,
  [PLAN_REFUSED]: 403,
  [CATALOG_UNREAD]: 403,
  not_found: 404,
  [MODULE_NOT_FOUND]: 404,
  [STANDARD_NOT_FOUND]: 404,
  [PROJECT_NOT_FOUND]: 404,
  [APPLICATION_NOT_FOUND]: 404,
  method_not_allowed: 405,
  [MODULE_NAME_TAKEN]: 409,
  [MODULE_HAS_NO_OWNER]: 409,
  [SLOT_CONFLICT]: 409,
  [PROJECT_CYCLE]: 409,
  [ROOT_PROJECT_FIXED]: 409,
  [LOCKED_RULE_CONFLICT]: 409,
  [GUIDANCE_ENDPOINT_UNSET]: 409,
  [UNSUPPORTED_ECOSYSTEM]: 409,
  [BOILERPLATE_CONFLICT]: 409,
  payload_too_large: 413,
  unsupported_media_type: 415,
  bundle_build_failed: 500,
};

/** The logged names of the parameterised routes. */
const MODULE_OWNER_ROUTE = `${MODULE_API_PATHS.modules}/{id}/owner`;
const MODULE_STANDARDS_ROUTE = `${MODULE_API_PATHS.modules}/{id}/standards`;
const STANDARD_VERSIONS_ROUTE = `${STANDARD_API_PATHS.standards}/{id}/versions`;
const STANDARD_LOCKED_RULE_ROUTE = `${STANDARD_API_PATHS.standards}/{id}/locked-rule`;
const PROJECT_ROUTE = `${PROJECT_API_PATHS.projects}/{id}`;
const PROJECT_PARENT_ROUTE = `${PROJECT_API_PATHS.projects}/{id}/parent`;
const PROJECT_EFFECTIVE_ROUTE = `${PROJECT_API_PATHS.projects}/{id}/effective-standards`;
const PROJECT_CHILD_PERMISSIONS_ROUTE = `${PROJECT_API_PATHS.projects}/{id}/child-permissions`;
const PROJECT_BUILD_GRANTS_ROUTE = `${PROJECT_API_PATHS.projects}/{id}/build-grants`;
const APPLICATION_IDENTIFICATION_FILE_ROUTE = `${APPLICATION_API_PATHS.applications}/{id}/identification-file`;
const APPLICATION_BOILERPLATE_ROUTE = `${APPLICATION_API_PATHS.applications}/{id}/boilerplate`;
const BUNDLE_LATEST_ROUTE = "/v1/standard-bundles/{id}";
const ACCEPTED_DEVIATION_ALERT_DISMISSAL_ROUTE = `${ACCEPTED_DEVIATION_ALERT_API_PATHS.alerts}/{id}/dismissal`;

/** Each parameterised route and the pattern capturing its raw `{id}` segment. */
const PARAM_ROUTES: readonly (readonly [string, RegExp])[] = [
  [MODULE_OWNER_ROUTE, /^\/v1\/modules\/([^/]+)\/owner$/],
  [MODULE_STANDARDS_ROUTE, /^\/v1\/modules\/([^/]+)\/standards$/],
  [STANDARD_VERSIONS_ROUTE, /^\/v1\/standards\/([^/]+)\/versions$/],
  [STANDARD_LOCKED_RULE_ROUTE, /^\/v1\/standards\/([^/]+)\/locked-rule$/],
  [PROJECT_ROUTE, /^\/v1\/projects\/([^/]+)$/],
  [PROJECT_PARENT_ROUTE, /^\/v1\/projects\/([^/]+)\/parent$/],
  [PROJECT_EFFECTIVE_ROUTE, /^\/v1\/projects\/([^/]+)\/effective-standards$/],
  [PROJECT_CHILD_PERMISSIONS_ROUTE, /^\/v1\/projects\/([^/]+)\/child-permissions$/],
  [PROJECT_BUILD_GRANTS_ROUTE, /^\/v1\/projects\/([^/]+)\/build-grants$/],
  [APPLICATION_IDENTIFICATION_FILE_ROUTE, /^\/v1\/applications\/([^/]+)\/identification-file$/],
  [APPLICATION_BOILERPLATE_ROUTE, /^\/v1\/applications\/([^/]+)\/boilerplate$/],
  [BUNDLE_LATEST_ROUTE, /^\/v1\/standard-bundles\/([^/]+)$/],
  [ACCEPTED_DEVIATION_ALERT_DISMISSAL_ROUTE, /^\/v1\/accepted-deviation-alerts\/([^/]+)\/dismissal$/],
];

/** Allowed methods per route. */
const ROUTES: Readonly<Record<string, readonly string[]>> = {
  [REGISTRY_API_PATHS.signInLinks]: ["POST"],
  [REGISTRY_API_PATHS.sessions]: ["POST"],
  [REGISTRY_API_PATHS.session]: ["GET"],
  [MODULE_API_PATHS.modules]: ["GET", "POST"],
  [MODULE_OWNER_ROUTE]: ["POST"],
  [MODULE_STANDARDS_ROUTE]: ["GET", "POST"],
  [STANDARD_VERSIONS_ROUTE]: ["GET", "POST"],
  [STANDARD_LOCKED_RULE_ROUTE]: ["POST"],
  [PROJECT_API_PATHS.projects]: ["GET", "POST"],
  [PROJECT_ROUTE]: ["GET"],
  [PROJECT_PARENT_ROUTE]: ["POST"],
  [PROJECT_EFFECTIVE_ROUTE]: ["GET"],
  [PROJECT_CHILD_PERMISSIONS_ROUTE]: ["GET", "POST"],
  [PROJECT_BUILD_GRANTS_ROUTE]: ["GET", "POST"],
  [APPLICATION_API_PATHS.applications]: ["GET", "POST"],
  [APPLICATION_API_PATHS.registered]: ["POST"],
  [APPLICATION_IDENTIFICATION_FILE_ROUTE]: ["GET"],
  [APPLICATION_BOILERPLATE_ROUTE]: ["POST"],
  [GUIDANCE_ENDPOINT_PATH]: ["GET", "POST"],
  [ACCEPTED_DEVIATION_API_PATHS.acceptedDeviations]: ["GET", "POST"],
  [ACCEPTED_DEVIATION_ALERT_API_PATHS.alerts]: ["GET"],
  [ACCEPTED_DEVIATION_ALERT_DISMISSAL_ROUTE]: ["POST"],
  [BUNDLE_API_PATHS.staleness]: ["POST"],
  [BUNDLE_API_PATHS.freeze]: ["POST"],
  [BUNDLE_LATEST_ROUTE]: ["GET"],
  [COMPILATION_API_PATHS.compilations]: ["POST"],
  [COMPILATION_API_PATHS.catalogReads]: ["GET", "POST"],
  [COMPILATION_API_PATHS.bundleStatus]: ["GET"],
  [COMPILATION_API_PATHS.collectorHealth]: ["GET"],
  [INVENTORY_API_PATHS.inventory]: ["GET"],
  [GUIDANCE_ACCESS_API_PATHS.access]: ["GET", "POST"],
  [GUIDANCE_ACCESS_API_PATHS.tokens]: ["POST"],
  [GUIDANCE_ACCESS_API_PATHS.retention]: ["GET"],
};

interface RouteMatch {
  /** A key of {@link ROUTES}, or "unmatched". */
  readonly route: string;
  /** The decoded `{id}` path segment of a parameterised route ("" otherwise). */
  readonly id: string;
}

function matchRoute(path: string): RouteMatch {
  if (path in ROUTES) return { route: path, id: "" };
  for (const [route, pattern] of PARAM_ROUTES) {
    const segment = pattern.exec(path)?.[1];
    if (segment === undefined) continue;
    let id: string;
    try {
      id = decodeURIComponent(segment);
    } catch {
      id = segment;
    }
    return { route, id };
  }
  return { route: "unmatched", id: "" };
}

/** The services the HTTP API serves. */
export interface RegistryServices {
  readonly signIn: SignInService;
  readonly modules: ModuleService;
  readonly standards: StandardService;
  readonly projects: ProjectService;
  readonly lockedRules: LockedRuleService;
  readonly childPermissions: ChildPermissionService;
  readonly buildGrants: BuildGrantService;
  readonly applications: ApplicationService;
  readonly guidanceEndpoint: GuidanceEndpointService;
  readonly acceptedDeviations: AcceptedDeviationsService;
  readonly acceptedDeviationAlerts: AcceptedDeviationAlertsService;
  readonly boilerplate: BoilerplateService;
  readonly bundles?: BundleService;
  readonly compilations: CompilationsService;
  readonly guidanceAccess: GuidanceAccessService;
}

class HttpFailure extends Error {
  readonly envelope: ErrorEnvelope;
  constructor(envelope: ErrorEnvelope) {
    super(envelope.message);
    this.envelope = envelope;
  }
}

/**
 * The registry's internal JSON API: sign-in, Modules and Standards. Every error is one
 * `{ code, message, subject }` envelope. Module calls authenticate with
 * `Authorization: Bearer <session token>`; creating a Module or assigning its
 * owner is refused with `role_denied` for any role but the Buyer, before the
 * body is read. Standards calls authenticate the same way; reading is open to
 * every role and only a Module's current Standard owner may publish into it.
 * Project tree calls authenticate the same way; reading is open to every
 * role; the Buyer may create a Project anywhere, any other account only
 * directly under a Project on which the Buyer granted it the child-Project
 * permission, and only the Buyer may change a Project's parent. The
 * Effective Standard set of a Project is open to every role. Only the Buyer
 * may mark or remove a Locked rule, or grant or revoke the child-Project
 * permission, or the build grant; the grants on a Project are open to every
 * role. The Applications are open to every role; the Buyer may place one on
 * any Project, any other account only on a Project on which it holds a
 * current build grant. An Application's Project identification file is open
 * to every role. The Company Guidance endpoint is open to every role and only
 * the Buyer may set it (`role_denied` before the body is read). The Accepted
 * deviations' records are open to every role, but only the Buyer may record
 * The Accepted deviations' records are open to every role, but only the
 * Buyer may record an acceptance (`role_denied` before the body is read);
 * reading (and, a fortiori, recording) is refused with `plan_refused` on a
 * plan without the capability, and the application that records an
 * acceptance joins the post-mutation list building one Standard bundle. The
 * Accepted-deviation alerts are the raised intervals of those acceptances:
 * reading them is open to every role with no plan check (a Community tenant
 * can hold no acceptance, hence no alert, so the read is simply empty), and
 * a dismissal is the Buyer's alone (`role_denied` before the body is read;
 * the body is then `{ alertId }`, and an unknown alert is `not_found`).
 * Neither alert surface writes anything that enters a bundle.
 * Generating an
 * Application's Boilerplate is open to every role. Only the Buyer may register
 * an existing Application (`role_denied` before the body is read); the answer
 * is only its Project identification file, and no Boilerplate is generated.
 * The Compilation catalog's read record is open to every role, but only the
 * Buyer may record reading it (`role_denied` before the body is read); a
 * re-read of the same catalog version answers the existing record. Ingesting
 * a Compilation authenticates with the bundle service's service credential
 * (the tenant comes from the credential, never from the path or body), then
 * refuses with `catalog_unread` while the tenant recorded no read of the
 * current catalog version, then validates the body, then stores the
 * Compilation exactly once per idempotency key (a replay answers the stored
 * Compilation).
 * The tenant's Guidance access state (which roles may read stored Guidance
 * events, and the retention days) is open to every role, but only the Buyer
 * may set it (`role_denied` before the body is read); an identical state
 * answers the current state with nothing written. Any role may mint a
 * short-lived tenant-scoped role token for its own role (the Buyer always
 * holds the grant); a role without the grant is refused with `role_denied`.
 * The service's retention sweep reads the retention days with the tenant's
 * service credential (the tenant comes from the credential).
 *
 * `POST /v1/sign-in-links` answers 202 `{}` for every well-formed email before
 * any lookup happens, then mints and sends links after the response is
 * finished, so neither the status, the body nor the timing reveals whether an
 * account exists.
 */
async function buildBundleAfterMutation(services: RegistryServices, log: Logger, session: SessionInfo): Promise<void> {
  if (services.bundles === undefined) return;
  try {
    await services.bundles.buildAndSign(session.tenantId);
  } catch (error) {
    if (isEnvelopeError(error)) throw error;
    log({ event: "bundle_build_failed", tenantId: session.tenantId, code: "unexpected" });
    throw new HttpFailure({ code: "bundle_build_failed", message: "the registry could not build the Standard bundle", subject: "bundle" });
  }
}

function requireBundles(services: RegistryServices): BundleService {
  if (services.bundles === undefined) {
    throw new HttpFailure({ code: "service_unavailable", message: "bundles unavailable", subject: "bundles" });
  }
  return services.bundles;
}

export function createRegistryServer(services: RegistryServices, log: Logger = stdoutLogger): Server {
  return createServer((req, res) => {
    const started = performance.now();
    const path = requestPath(req.url);
    const match = matchRoute(path);
    res.on("finish", () => {
      log({
        event: "http_request",
        method: req.method ?? "",
        route: match.route,
        status: res.statusCode,
        ms: Math.round(performance.now() - started),
      });
    });
    handle(services, log, req, res, path, match).catch((error: unknown) => {
      if (error instanceof HttpFailure) {
        sendError(res, error.envelope);
        return;
      }
      if (isEnvelopeError(error) && error.code in STATUS_BY_CODE) {
        sendError(res, error.toEnvelope());
        return;
      }
      // Unexpected: report the code only; driver messages can echo row values.
      log({ event: "internal_error", code: isEnvelopeError(error) ? error.code : "unexpected" });
      sendError(res, { code: "internal_error", message: "the registry could not complete the request", subject: "request" });
    });
  });
}

async function handle(
  services: RegistryServices,
  log: Logger,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  match: RouteMatch,
): Promise<void> {
  const methods = ROUTES[match.route];
  if (methods === undefined) {
    throw new HttpFailure({ code: "not_found", message: "no such registry endpoint", subject: path });
  }
  if (req.method === undefined || !methods.includes(req.method)) {
    const allowed = methods.join(", ");
    res.setHeader("Allow", allowed);
    throw new HttpFailure({ code: "method_not_allowed", message: `use ${allowed}`, subject: path });
  }
  const service = services.signIn;

  switch (match.route) {
    case REGISTRY_API_PATHS.signInLinks: {
      const body = await readJson(req);
      const email = onlyField(body, "email");
      if (!isEmailAddress(email)) {
        throw new HttpFailure({ code: "invalid_input", message: "email must be an email address", subject: "email" });
      }
      // Answer first, identically for every well-formed address; then start the
      // work, whether or not the client stays connected.
      sendJson(res, 202, {});
      setImmediate(() => {
        service.requestSignInLinks(email).then(
          (report) => {
            log({ event: "sign_in_links", links: report.links, sent: report.sent, failed: report.failed });
          },
          (error: unknown) => {
            log({ event: "sign_in_links_failed", code: isEnvelopeError(error) ? error.code : "unexpected" });
          },
        );
      });
      return;
    }
    case REGISTRY_API_PATHS.sessions: {
      const body = await readJson(req);
      const token = onlyField(body, "token");
      if (typeof token !== "string" || token === "") {
        throw new HttpFailure({ code: "invalid_input", message: "token must be a non-empty string", subject: "token" });
      }
      sendJson(res, 201, await service.createSession(token));
      return;
    }
    case REGISTRY_API_PATHS.session: {
      sendJson(res, 200, await service.getSession(bearerToken(req)));
      return;
    }
    case MODULE_API_PATHS.modules: {
      const session = await service.getSession(bearerToken(req));
      if (req.method === "GET") {
        sendJson(res, 200, await services.modules.listModules(session));
        return;
      }
      requireBuyer(req, session);
      const body = fields(await readJson(req), ["kind", "name"]);
      const created = await services.modules.createModule(session, { kind: body["kind"], name: body["name"] });
      await buildBundleAfterMutation(services, log, session);
      sendJson(res, 201, created);
      return;
    }
    case MODULE_OWNER_ROUTE: {
      const session = await service.getSession(bearerToken(req));
      requireBuyer(req, session);
      const body = fields(await readJson(req), ["accountId"]);
      const module = await services.modules.assignModuleOwner(session, match.id, {
        accountId: body["accountId"],
      });
      await buildBundleAfterMutation(services, log, session);
      sendJson(res, 200, module);
      return;
    }
    case MODULE_STANDARDS_ROUTE: {
      const session = await service.getSession(bearerToken(req));
      if (req.method === "GET") {
        sendJson(res, 200, await services.standards.listStandards(session, match.id));
        return;
      }
      // The body (exactly { entry }) is checked by the service, after the
      // Module, owner and role checks, so the first failure in that order wins.
      const standard = await services.standards.publishStandard(session, match.id, await readJson(req));
      await buildBundleAfterMutation(services, log, session);
      sendJson(res, 201, standard);
      return;
    }
    case PROJECT_API_PATHS.projects: {
      const session = await service.getSession(bearerToken(req));
      if (req.method === "GET") {
        sendJson(res, 200, await services.projects.getTree(session));
        return;
      }
      // Whether the caller may create depends on the parent named in the body,
      // so the service checks the body, then the parent, then the permission.
      const createdProject = await services.projects.createProject(session, await readJson(req));
      await buildBundleAfterMutation(services, log, session);
      sendJson(res, 201, createdProject);
      return;
    }
    case PROJECT_ROUTE: {
      const session = await service.getSession(bearerToken(req));
      sendJson(res, 200, await services.projects.getProject(session, match.id));
      return;
    }
    case PROJECT_EFFECTIVE_ROUTE: {
      const session = await service.getSession(bearerToken(req));
      sendJson(res, 200, await services.projects.getEffectiveSet(session, match.id));
      return;
    }
    case PROJECT_PARENT_ROUTE: {
      const session = await service.getSession(bearerToken(req));
      // The service checks the Project, then the role, then the body and the
      // parent, so the first failure in that order wins.
      const changedProject = await services.projects.changeParent(session, match.id, await readJson(req));
      await buildBundleAfterMutation(services, log, session);
      sendJson(res, 200, changedProject);
      return;
    }
    case PROJECT_CHILD_PERMISSIONS_ROUTE: {
      const session = await service.getSession(bearerToken(req));
      if (req.method === "GET") {
        sendJson(res, 200, await services.childPermissions.listChildPermissions(session, match.id));
        return;
      }
      // The service checks the Project, then the role, then the body and the
      // account, so the first failure in that order wins.
      const childPermission = await services.childPermissions.setChildPermission(session, match.id, await readJson(req));
      await buildBundleAfterMutation(services, log, session);
      sendJson(res, 200, childPermission);
      return;
    }
    case PROJECT_BUILD_GRANTS_ROUTE: {
      const session = await service.getSession(bearerToken(req));
      if (req.method === "GET") {
        sendJson(res, 200, await services.buildGrants.listBuildGrants(session, match.id));
        return;
      }
      // The service checks the Project, then the role, then the body and the
      // account, so the first failure in that order wins.
      const buildGrant = await services.buildGrants.setBuildGrant(session, match.id, await readJson(req));
      await buildBundleAfterMutation(services, log, session);
      sendJson(res, 200, buildGrant);
      return;
    }
    case APPLICATION_API_PATHS.applications: {
      const session = await service.getSession(bearerToken(req));
      if (req.method === "GET") {
        sendJson(res, 200, await services.applications.listApplications(session));
        return;
      }
      // Whether the caller may place it depends on the Project named in the
      // body, so the service checks the body, then the Project, then the grant.
      const createdApplication = await services.applications.createApplication(session, await readJson(req));
      await buildBundleAfterMutation(services, log, session);
      sendJson(res, 201, createdApplication);
      return;
    }
    case APPLICATION_IDENTIFICATION_FILE_ROUTE: {
      const session = await service.getSession(bearerToken(req));
      sendJson(res, 200, await services.applications.getIdentificationFile(session, match.id));
      return;
    }
    case APPLICATION_API_PATHS.registered: {
      const session = await service.getSession(bearerToken(req));
      // Only the Buyer registers, before the body is read (it is drained,
      // never parsed for any other role); then the service checks the body,
      // the Project and the core bundle, so the first failure wins.
      requireBuyer(req, session, assertApplicationBuyer);
      const registeredApplication = await services.applications.registerApplication(session, await readJson(req));
      await buildBundleAfterMutation(services, log, session);
      sendJson(res, 201, registeredApplication);
      return;
    }
    case APPLICATION_BOILERPLATE_ROUTE: {
      const session = await service.getSession(bearerToken(req));
      // The service checks the Application, then the body, then the endpoint,
      // the Standards and the ecosystem, so the first failure in that order wins.
      const result = await services.boilerplate.generateBoilerplate(session, match.id, await readJson(req));
      log({
        event: "boilerplate_generated",
        applicationId: result.applicationId,
        target: result.target,
        files: result.artifacts.length,
      });
      sendJson(res, 200, result);
      return;
    }
    case GUIDANCE_ENDPOINT_PATH: {
      const session = await service.getSession(bearerToken(req));
      if (req.method === "GET") {
        sendJson(res, 200, await services.guidanceEndpoint.getGuidanceEndpoint(session));
        return;
      }
      requireBuyer(req, session, assertGuidanceEndpointBuyer);
      const guidanceEndpoint = await services.guidanceEndpoint.setGuidanceEndpoint(session, await readJson(req));
      await buildBundleAfterMutation(services, log, session);
      sendJson(res, 200, guidanceEndpoint);
      return;
    }
    case ACCEPTED_DEVIATION_API_PATHS.acceptedDeviations: {
      const session = await service.getSession(bearerToken(req));
      if (req.method === "GET") {
        // Reading is open to every role, but the plan check runs in the
        // service, so a Community tenant is refused whatever its role.
        sendJson(res, 200, await services.acceptedDeviations.listAcceptances(session));
        return;
      }
      // The role check happens before the body is read (it is drained, never
      // parsed for any other role); then the service checks the plan, the
      // body, the Application, the Effective set and the window, so the first
      // failure in that order wins. A POST joins the pinned post-mutation
      // hook list: the next bundle carries the new acceptance.
      requireBuyer(req, session, assertAcceptedDeviationBuyer);
      const record = await services.acceptedDeviations.recordAcceptance(session, await readJson(req));
      await buildBundleAfterMutation(services, log, session);
      sendJson(res, 201, record);
      return;
    }
    case ACCEPTED_DEVIATION_ALERT_API_PATHS.alerts: {
      const session = await service.getSession(bearerToken(req));
      // Reading is open to every role with no plan check: a Community tenant
      // can hold no acceptance, hence no alert, and the service answers an
      // empty list; the read is one query under the tenant's scope.
      sendJson(res, 200, await services.acceptedDeviationAlerts.listAlerts(session));
      return;
    }
    case ACCEPTED_DEVIATION_ALERT_DISMISSAL_ROUTE: {
      const session = await service.getSession(bearerToken(req));
      // The role check happens before the body is read (it is drained, never
      // parsed for any other role); then the service checks the body's
      // alertId, the alert's visibility in the tenant, and appends one
      // idempotent dismissal row. Nothing here mutates a bundle, so no
      // post-mutation build runs. Every refusal of the body — malformed JSON
      // included — is reported under the alert id's own name, as the service
      // reports its own body checks.
      requireBuyer(req, session, assertAcceptedDeviationAlertBuyer);
      let body: unknown;
      try {
        body = await readJson(req);
      } catch (error) {
        if (
          error instanceof HttpFailure &&
          error.envelope.code === "invalid_input" &&
          error.envelope.subject === "body"
        ) {
          throw new HttpFailure({ ...error.envelope, subject: "alertId" });
        }
        throw error;
      }
      sendJson(res, 200, await services.acceptedDeviationAlerts.dismissAlert(session, match.id, body));
      return;
    }
    case BUNDLE_API_PATHS.staleness: {
      const session = await service.getSession(bearerToken(req));
      requireBuyer(req, session, assertBundleSettingsBuyer);
      const bundles = requireBundles(services);
      sendJson(res, 200, await bundles.setStaleness(session, await readJson(req)));
      return;
    }
    case BUNDLE_API_PATHS.freeze: {
      const session = await service.getSession(bearerToken(req));
      requireBuyer(req, session, assertBundleSettingsBuyer);
      const bundles = requireBundles(services);
      sendJson(res, 200, await bundles.setFreeze(session, await readJson(req)));
      return;
    }
    case BUNDLE_LATEST_ROUTE: {
      const tenantId = match.id;
      const bundles = requireBundles(services);
      const credentialTenant = await bundles.authenticateCredential(bearerToken(req));
      if (credentialTenant !== tenantId) {
        throw new HttpFailure({
          code: ROLE_DENIED,
          message: "this credential may not pull this tenant's bundle",
          subject: "role",
        });
      }
      const bundle = await bundles.latestFor(credentialTenant);
      if (bundle === undefined) {
        throw new HttpFailure({
          code: "not_found",
          message: "no bundle exists for this tenant yet",
          subject: "bundle",
        });
      }
      sendJson(res, 200, bundle);
      return;
    }
    case COMPILATION_API_PATHS.compilations: {
      // The tenant comes from the service credential, never from the path or
      // body: authentication runs before anything is parsed, so a bad
      // credential is 401 `session_invalid` with nothing else read. The
      // catalog-read gate runs next, still before the body is read (the body
      // is drained, never parsed, on a refusal), so an unread tenant is
      // refused whatever the body holds. Then the service checks the body and
      // the idempotent insert, so the first failure in that order wins.
      const bundles = requireBundles(services);
      const credentialTenant = await bundles.authenticateCredential(bearerToken(req));
      try {
        await services.compilations.assertCatalogRead(credentialTenant);
      } catch (error) {
        req.resume();
        throw error;
      }
      const { compilation, replay } = await services.compilations.ingestCompilation(
        credentialTenant,
        await readJson(req),
      );
      sendJson(res, replay ? 200 : 201, compilation);
      return;
    }
    case COMPILATION_API_PATHS.catalogReads: {
      const session = await service.getSession(bearerToken(req));
      if (req.method === "GET") {
        sendJson(res, 200, await services.compilations.getCatalogRead(session));
        return;
      }
      // The role check happens before the body is read (it is drained, never
      // parsed for any other role); then the service checks the body and
      // appends one idempotent read row. A re-read of the same version answers
      // the existing record.
      requireBuyer(req, session, assertCompilationBuyer);
      const { record, created } = await services.compilations.recordCatalogRead(session, await readJson(req));
      sendJson(res, created ? 201 : 200, record);
      return;
    }
    case COMPILATION_API_PATHS.bundleStatus: {
      // Story 6.4, read-only: the tenant's bundle-status rows (the latest
      // stored `bundle_status` Compilation per Application, with the
      // staleness bound and freeze state). Every role may read, like the
      // catalog-read GET above; the panel derives the age and the "stale"
      // word from the returned `issuedAt`.
      const session = await service.getSession(bearerToken(req));
      sendJson(res, 200, await services.compilations.listBundleStatus(session));
      return;
    }
    case COMPILATION_API_PATHS.collectorHealth: {
      // Story 6.4, read-only: the tenant's Collector-health rows (the latest
      // stored `collector_health` Compilation per Application, carrying the
      // pending count and the dropped-by-reason counts). Every role may read.
      const session = await service.getSession(bearerToken(req));
      sendJson(res, 200, await services.compilations.listCollectorHealth(session));
      return;
    }
    case INVENTORY_API_PATHS.inventory: {
      // The Inventory's agent-tool groups: every role may read the tenant's
      // per-Application Compilation evidence. Read-only, so no bundle
      // rebuild runs and no catalog-read gate applies to the read itself.
      const session = await service.getSession(bearerToken(req));
      sendJson(res, 200, await services.compilations.getInventoryEvidence(session));
      return;
    }
    case GUIDANCE_ACCESS_API_PATHS.access: {
      const session = await service.getSession(bearerToken(req));
      if (req.method === "GET") {
        sendJson(res, 200, await services.guidanceAccess.getGuidanceAccess(session));
        return;
      }
      // The role check happens before the body is read (it is drained, never
      // parsed for any other role); then the service checks the body and
      // appends grant and retention rows. An identical state answers 200 with
      // nothing written. Nothing here enters a bundle, so no rebuild runs.
      requireBuyer(req, session, assertGuidanceAccessBuyer);
      sendJson(res, 200, await services.guidanceAccess.setGuidanceAccess(session, await readJson(req)));
      return;
    }
    case GUIDANCE_ACCESS_API_PATHS.tokens: {
      // Any role may ask, but only for its own role: the service mints when
      // the caller's role holds the grant (the Buyer always does) and refuses
      // with `role_denied` otherwise. The body is exactly `{}`.
      const session = await service.getSession(bearerToken(req));
      const body = await readJson(req);
      if (typeof body !== "object" || body === null || Array.isArray(body) || Object.keys(body).length !== 0) {
        throw new HttpFailure({ code: "invalid_input", message: "the body must be {}", subject: "body" });
      }
      sendJson(res, 201, await services.guidanceAccess.mintRoleToken(session));
      return;
    }
    case GUIDANCE_ACCESS_API_PATHS.retention: {
      // The service's retention sweep reads here with the tenant's service
      // credential (the tenant comes from the credential, never from the path
      // or body): authentication runs before anything else, so a bad
      // credential is 401 `session_invalid`.
      const bundles = requireBundles(services);
      const credentialTenant = await bundles.authenticateCredential(bearerToken(req));
      sendJson(res, 200, await services.guidanceAccess.getRetentionDays(credentialTenant));
      return;
    }
    case STANDARD_LOCKED_RULE_ROUTE: {
      const session = await service.getSession(bearerToken(req));
      // The service checks the Standard, then the role, then the body, so the
      // first failure in that order wins.
      const lockedRule = await services.lockedRules.setLockedRule(session, match.id, await readJson(req));
      await buildBundleAfterMutation(services, log, session);
      sendJson(res, 200, lockedRule);
      return;
    }
    default: {
      // STANDARD_VERSIONS_ROUTE
      const session = await service.getSession(bearerToken(req));
      if (req.method === "GET") {
        sendJson(res, 200, await services.standards.listStandardVersions(session, match.id));
        return;
      }
      const publishedVersion = await services.standards.publishStandardVersion(session, match.id, await readJson(req));
      await buildBundleAfterMutation(services, log, session);
      sendJson(res, 201, publishedVersion);
    }
  }
}

/** `role_denied` before the body is read (it is drained, never parsed) unless the session is the Buyer's. */
function requireBuyer(
  req: IncomingMessage,
  session: SessionInfo,
  assert: (session: SessionInfo) => void = assertBuyer,
): void {
  try {
    assert(session);
  } catch (error) {
    req.resume();
    throw error;
  }
}

/** The token of an `Authorization: Bearer <token>` header (scheme in any case), or `session_invalid`. */
function bearerToken(req: IncomingMessage): string {
  const header = req.headers.authorization ?? "";
  const match = /^Bearer +(\S+)$/i.exec(header);
  if (match?.[1] === undefined) {
    req.resume();
    throw new HttpFailure({
      code: SESSION_INVALID,
      message: "the session is not valid or has expired",
      subject: "session",
    });
  }
  return match[1];
}

/** The request path, or "" (an unmatched route) when the target cannot be parsed. */
function requestPath(target: string | undefined): string {
  try {
    return new URL(target ?? "/", "http://registry.invalid").pathname;
  } catch {
    return "";
  }
}

/**
 * Read and parse a JSON body of at most {@link MAX_BODY_BYTES}. The body must be
 * declared `application/json`, so a CORS-simple cross-site POST (text/plain,
 * form encoding) is refused before it is read.
 */
async function readJson(req: IncomingMessage): Promise<unknown> {
  const mediaType = (req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    req.resume();
    throw new HttpFailure({
      code: "unsupported_media_type",
      message: "the request body must be sent as application/json",
      subject: "content-type",
    });
  }
  const declared = Number(req.headers["content-length"] ?? "0");
  if (declared > MAX_BODY_BYTES) {
    req.resume();
    throw tooLarge();
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      req.resume();
      throw tooLarge();
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new HttpFailure({ code: "invalid_input", message: "the request body must be JSON", subject: "body" });
  }
}

function tooLarge(): HttpFailure {
  return new HttpFailure({
    code: "payload_too_large",
    message: `the request body exceeds ${String(MAX_BODY_BYTES)} bytes`,
    subject: "body",
  });
}

/** The value of `field` when `body` is an object with exactly that one key; otherwise `invalid_input`. */
function onlyField(body: unknown, field: string): unknown {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new HttpFailure({ code: "invalid_input", message: `the body must be { "${field}": ... }`, subject: "body" });
  }
  const record = body as Record<string, unknown>;
  const extra = Object.keys(record).find((key) => key !== field);
  if (extra !== undefined) {
    throw new HttpFailure({ code: "invalid_input", message: "the body has an unsupported field", subject: extra });
  }
  return record[field];
}

/**
 * `body` as a record when it is an object whose keys are all among `allowed`;
 * otherwise `invalid_input`. A missing field is left undefined for the
 * service to report under its own name.
 */
function fields(body: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new HttpFailure({
      code: "invalid_input",
      message: `the body must be an object with ${allowed.join(", ")}`,
      subject: "body",
    });
  }
  const record = body as Record<string, unknown>;
  const extra = Object.keys(record).find((key) => !allowed.includes(key));
  if (extra !== undefined) {
    throw new HttpFailure({ code: "invalid_input", message: "the body has an unsupported field", subject: extra });
  }
  return record;
}

function sendError(res: ServerResponse, envelope: ErrorEnvelope): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  sendJson(res, STATUS_BY_CODE[envelope.code] ?? 500, envelope);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    "Cache-Control": "no-store",
  });
  res.end(text);
}
