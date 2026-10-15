import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  ACCEPTED_DEVIATION_ALERT_API_PATHS,
  ACCEPTED_DEVIATION_API_PATHS,
  acceptedDeviationAlertDismissalPath,
  APPLICATION_NOT_FOUND,
  applicationBoilerplatePath,
  applicationIdentificationFilePath,
  CATALOG_UNREAD,
  COMPILATION_CATALOG_VERSION,
  GUIDANCE_ENDPOINT_PATH,
  GUIDANCE_ENDPOINT_UNSET,
  isAcceptedDeviationAlerts,
  isAcceptedDeviationRecord,
  isAlertDismissedResult,
  isBoilerplateResult,
  isGuidanceEndpointState,
  entrySlotName,
  formatIdentificationFile,
  IDENTIFICATION_FILE_NAME,
  isApplicationInfo,
  isApplicationList,
  isBuildGrantList,
  isBuildGrantState,
  isChildPermissionList,
  isChildPermissionState,
  isEffectiveStandardSet,
  isErrorEnvelope,
  isIdentificationFileRendering,
  isLockedRuleState,
  isModuleInfo,
  isModuleList,
  isProjectInfo,
  isProjectTree,
  isSessionCreated,
  isSessionInfo,
  isStandardInfo,
  isStandardList,
  isStandardVersionList,
  isUuidV7,
} from "@domain-harness/contract";
import type {
  AcceptedDeviationAlert,
  AcceptedDeviationRecord,
  ApplicationInfo,
  ApplicationList,
  BoilerplateResult,
  BuildGrantList,
  BuildGrantState,
  ChildPermissionList,
  ChildPermissionState,
  Compilation,
  CompilationCatalogRead,
  CompilationCatalogReadState,
  EffectiveStandardSet,
  GuidanceEndpointState,
  IdentificationFileRendering,
  LockedRuleState,
  ModuleInfo,
  ModuleList,
  ProjectInfo,
  ProjectTree,
  SessionCreated,
  SessionInfo,
  StandardInfo,
  StandardList,
  StandardVersionList,
} from "@domain-harness/contract";
import type { UuidV7 } from "@domain-harness/contract";
import type { ApplicationService } from "../applications/service.ts";
import { assertApplicationBuyer } from "../applications/service.ts";
import { validateApplicationBody } from "../applications/validate.ts";
import { validateBoilerplateBody } from "../boilerplate/service.ts";
import type { BoilerplateService } from "../boilerplate/service.ts";
import { validateBuildGrantBody } from "../build-grants/service.ts";
import type { BuildGrantService } from "../build-grants/service.ts";
import { validateChildPermissionBody } from "../child-permissions/service.ts";
import type { ChildPermissionService } from "../child-permissions/service.ts";
import { EnvelopeError } from "../errors.ts";
import { assertAcceptedDeviationBuyer } from "../accepted-deviations/service.ts";
import type { AcceptedDeviationsService } from "../accepted-deviations/service.ts";
import { validateAcceptedDeviationBody } from "../accepted-deviations/validate.ts";
import { assertAcceptedDeviationAlertBuyer } from "../accepted-deviation-alerts/service.ts";
import type { AcceptedDeviationAlertsService } from "../accepted-deviation-alerts/service.ts";
import { assertGuidanceEndpointBuyer } from "../guidance-endpoint/service.ts";
import type { GuidanceEndpointService } from "../guidance-endpoint/service.ts";
import { validateGuidanceEndpointBody } from "../guidance-endpoint/validate.ts";
import { assertCompilationBuyer } from "../compilations/service.ts";
import type { CompilationsService } from "../compilations/service.ts";
import { validateCatalogReadBody, validateCompilationBody } from "../compilations/validate.ts";
import { mintUuidV7 } from "../ids.ts";
import { validateLockedRuleBody } from "../locked-rules/service.ts";
import type { LockedRuleService } from "../locked-rules/service.ts";
import { assertBuyer } from "../modules/service.ts";
import type { ModuleCreateInput, ModuleOwnerAssignInput, ModuleService } from "../modules/service.ts";
import { assertTreeBuyer } from "../projects/service.ts";
import type { ProjectService } from "../projects/service.ts";
import { validateCreateBody, validateParentBody } from "../projects/validate.ts";
import type { SignInLinkReport, SignInService } from "../sign-in/service.ts";
import type { StandardService } from "../standards/service.ts";
import { validatePublishBody } from "../standards/validate.ts";
import { createRegistryServer, MAX_BODY_BYTES } from "./server.ts";
import type { LogEvent } from "./server.ts";

const tenantId = mintUuidV7();
const session: SessionInfo = { accountId: mintUuidV7(), tenantId, role: "Buyer" };
const GOOD_LINK = `${tenantId}.${"L".repeat(43)}`;
const GOOD_SESSION = `${tenantId}.${"S".repeat(43)}`;
const BUILDER_SESSION = `${tenantId}.${"B".repeat(43)}`;
const builder: SessionInfo = { accountId: mintUuidV7(), tenantId, role: "Builder" };
const MODULE_ID = mintUuidV7();
const OWNER_ID = mintUuidV7();
const moduleInfo: ModuleInfo = {
  id: MODULE_ID,
  kind: "code-stack",
  name: "Code stack",
  owner: null,
  createdAt: "2026-10-11T09:00:00.000Z",
};

const STANDARD_ID = mintUuidV7();
const standardInfo: StandardInfo = {
  id: STANDARD_ID,
  version: 1,
  module: { id: MODULE_ID, kind: "code-stack", name: "Code stack" },
  project: { id: mintUuidV7(), name: "Acme" },
  entry: { category: "library", name: "React", versionConstraint: "^18", status: "approved", correctionInstruction: null },
  publishedAt: "2026-10-11T09:00:00.000Z",
  publishedBy: { accountId: OWNER_ID, name: "Sam" },
};

/** A fake service: one known email, one valid link token, one valid session token. */
class FakeService implements SignInService {
  requested: string[] = [];
  requestSignInLinks(email: string): Promise<SignInLinkReport> {
    this.requested.push(email);
    const known = email.trim().toLowerCase() === "bea@acme.io";
    return Promise.resolve({ links: known ? 1 : 0, sent: known ? 1 : 0, failed: 0 });
  }
  createSession(token: string): Promise<SessionCreated> {
    if (token === "boom") return Promise.reject(new Error("driver said bea@acme.io"));
    if (token !== GOOD_LINK) {
      return Promise.reject(new EnvelopeError({ code: "sign_in_link_invalid", message: "invalid", subject: "token" }));
    }
    return Promise.resolve({ sessionToken: GOOD_SESSION, expiresAt: "2026-10-10T12:00:00.000Z", session });
  }
  getSession(token: string): Promise<SessionInfo> {
    if (token === BUILDER_SESSION) return Promise.resolve(builder);
    if (token !== GOOD_SESSION) {
      return Promise.reject(new EnvelopeError({ code: "session_invalid", message: "invalid", subject: "session" }));
    }
    return Promise.resolve(session);
  }
}

/** A fake Module service that records what reached it and enforces the Buyer rule like the real one. */
class FakeModules implements ModuleService {
  calls: unknown[] = [];
  listModules(caller: SessionInfo): Promise<ModuleList> {
    this.calls.push(["list", caller.role]);
    return Promise.resolve({ modules: [moduleInfo], standardOwners: [{ accountId: OWNER_ID, name: "Sam" }] });
  }
  createModule(caller: SessionInfo, input: ModuleCreateInput): Promise<ModuleInfo> {
    this.calls.push(["create", input]);
    assertBuyer(caller);
    if (input.name === "Taken") {
      return Promise.reject(new EnvelopeError({ code: "module_name_taken", message: "m", subject: "name" }));
    }
    if (input.kind !== "code-stack" && input.kind !== "design-system") {
      return Promise.reject(new EnvelopeError({ code: "invalid_input", message: "m", subject: "kind" }));
    }
    return Promise.resolve(moduleInfo);
  }
  assignModuleOwner(caller: SessionInfo, moduleId: string, input: ModuleOwnerAssignInput): Promise<ModuleInfo> {
    this.calls.push(["assign", moduleId, input]);
    assertBuyer(caller);
    if (moduleId !== MODULE_ID) {
      return Promise.reject(new EnvelopeError({ code: "module_not_found", message: "m", subject: "moduleId" }));
    }
    const owner = {
      accountId: OWNER_ID,
      name: "Sam",
      assignedAt: "2026-10-11T09:00:00.000Z",
      assignedBy: { accountId: session.accountId, name: "Bea" },
    };
    return Promise.resolve({ ...moduleInfo, owner });
  }
}

/**
 * A fake Standards service that records what reached it. One Module and one
 * Standard exist; the Buyer session publishes as the owner, the Builder is
 * refused; entry names pick a refusal.
 */
class FakeStandards implements StandardService {
  calls: unknown[] = [];
  listStandards(caller: SessionInfo, moduleId: string): Promise<StandardList> {
    this.calls.push(["list", caller.role, moduleId]);
    if (moduleId !== MODULE_ID) return Promise.reject(notFound("module_not_found", "moduleId"));
    return Promise.resolve({ module: moduleInfo, standards: [standardInfo] });
  }
  listStandardVersions(caller: SessionInfo, standardId: string): Promise<StandardVersionList> {
    this.calls.push(["versions", caller.role, standardId]);
    if (standardId !== STANDARD_ID) return Promise.reject(notFound("standard_not_found", "standardId"));
    return Promise.resolve({ standardId: STANDARD_ID, versions: [standardInfo, { ...standardInfo, version: 2 }] });
  }
  publishStandard(caller: SessionInfo, moduleId: string, body: unknown): Promise<StandardInfo> {
    this.calls.push(["publish", moduleId, body]);
    if (moduleId !== MODULE_ID) return Promise.reject(notFound("module_not_found", "moduleId"));
    return this.publishAs(caller, body, 1);
  }
  publishStandardVersion(caller: SessionInfo, standardId: string, body: unknown): Promise<StandardInfo> {
    this.calls.push(["republish", standardId, body]);
    if (standardId !== STANDARD_ID) return Promise.reject(notFound("standard_not_found", "standardId"));
    return this.publishAs(caller, body, 2);
  }
  private publishAs(caller: SessionInfo, body: unknown, version: number): Promise<StandardInfo> {
    return Promise.resolve().then(() => {
      if (caller.role !== "Buyer") throw new EnvelopeError({ code: "not_module_owner", message: "m", subject: "role" });
      const designSystem = isRecord(body) && isRecord(body["entry"]) && "kind" in body["entry"];
      const { entry } = validatePublishBody(body, designSystem ? "design-system" : "code-stack", {
        allowProjectId: version === 1,
      });
      const name = entrySlotName(entry);
      if (name === "Ownerless") {
        throw new EnvelopeError({ code: "module_has_no_owner", message: "m", subject: "moduleId" });
      }
      if (name === "Taken") throw new EnvelopeError({ code: "slot_conflict", message: "m", subject: STANDARD_ID });
      return { ...standardInfo, version, entry };
    });
  }
}

const ROOT_ID = mintUuidV7();
const CHILD_ID = mintUuidV7();
const rootInfo: ProjectInfo = { id: ROOT_ID, name: "Acme", levelName: null, parentId: null, createdAt: "2026-10-12T09:00:00.000Z" };
const childInfo: ProjectInfo = { ...rootInfo, id: CHILD_ID, name: "Web", levelName: "Product line", parentId: ROOT_ID };
const tree: ProjectTree = {
  rootId: ROOT_ID,
  projects: [rootInfo, childInfo],
  lockedRules: [
    {
      standardId: STANDARD_ID,
      projectId: CHILD_ID,
      markedAt: "2026-10-12T09:00:00.000Z",
      markedBy: { accountId: session.accountId, name: "Bea" },
    },
  ],
};

/**
 * A fake Project service that records what reached it and checks in the real
 * order with the real validators. Create: the plan, the body, the parent, then the
 * child-Project permission (a non-Buyer holds a grant on the child only).
 * Parent change: the Project, the role, the body, the parent, the root, then
 * a cycle (parent = the child itself).
 */
class FakeProjects implements ProjectService {
  calls: unknown[] = [];
  /** When set, the tenant's plan refuses create (before the body) and parent changes (after the role). */
  planRefused = false;
  getTree(caller: SessionInfo): Promise<ProjectTree> {
    this.calls.push(["tree", caller.role]);
    return Promise.resolve(tree);
  }
  getProject(caller: SessionInfo, projectId: string): Promise<ProjectInfo> {
    this.calls.push(["get", caller.role, projectId]);
    const found = tree.projects.find((p) => p.id === projectId);
    return found === undefined ? Promise.reject(notFound("project_not_found", "projectId")) : Promise.resolve(found);
  }
  getEffectiveSet(caller: SessionInfo, projectId: string): Promise<EffectiveStandardSet> {
    this.calls.push(["effective", caller.role, projectId]);
    const found = tree.projects.find((p) => p.id === projectId);
    if (found === undefined) return Promise.reject(notFound("project_not_found", "projectId"));
    if (found.id === ROOT_ID) {
      return Promise.reject(new EnvelopeError({ code: "slot_conflict", message: "m", subject: STANDARD_ID }));
    }
    const status = "status" in standardInfo.entry ? standardInfo.entry.status : null;
    return Promise.resolve({
      project: { id: found.id, name: found.name },
      standards: [
        {
          slot: { moduleKind: "code-stack", slotKind: "library", name: entrySlotName(standardInfo.entry) },
          status,
          standard: standardInfo,
          sourceProject: { id: found.id, name: found.name },
          locked: false,
        },
      ],
    });
  }
  createProject(caller: SessionInfo, body: unknown): Promise<ProjectInfo> {
    this.calls.push(["create", body]);
    return Promise.resolve().then(() => {
      if (this.planRefused) throw new EnvelopeError({ code: "plan_refused", message: "m", subject: "plan" });
      const input = validateCreateBody(body);
      if (!tree.projects.some((p) => p.id === input.parentId)) throw notFound("project_not_found", "parentId");
      if (caller.role !== "Buyer" && input.parentId !== CHILD_ID) {
        throw new EnvelopeError({ code: "child_permission_denied", message: "m", subject: "parentId" });
      }
      return { ...childInfo, id: mintUuidV7(), name: input.name, levelName: input.levelName, parentId: input.parentId };
    });
  }
  changeParent(caller: SessionInfo, projectId: string, body: unknown): Promise<ProjectInfo> {
    this.calls.push(["parent", projectId, body]);
    return Promise.resolve().then(() => {
      const project = tree.projects.find((p) => p.id === projectId);
      if (project === undefined) throw notFound("project_not_found", "projectId");
      assertTreeBuyer(caller);
      if (this.planRefused) throw new EnvelopeError({ code: "plan_refused", message: "m", subject: "plan" });
      const { parentId } = validateParentBody(body);
      if (!tree.projects.some((p) => p.id === parentId)) throw notFound("project_not_found", "parentId");
      if (project.parentId === null) throw new EnvelopeError({ code: "root_project_fixed", message: "m", subject: "projectId" });
      if (parentId === projectId) throw new EnvelopeError({ code: "project_cycle", message: "m", subject: parentId });
      return { ...project, parentId };
    });
  }
}

/**
 * A fake Locked-rule service that records what reached it and checks in the
 * real order with the real validator: the Standard, the role, the body, then
 * a contradiction (unlocked state → locked, for the one known Standard, when
 * `conflict` is set).
 */
class FakeLockedRules implements LockedRuleService {
  calls: unknown[] = [];
  conflict = false;
  /** When set, the tenant's plan refuses a mark (after the body); an unmark stays open. */
  planRefused = false;
  setLockedRule(caller: SessionInfo, standardId: string, body: unknown): Promise<LockedRuleState> {
    this.calls.push(["lock", caller.role, standardId, body]);
    return Promise.resolve().then(() => {
      if (standardId !== STANDARD_ID) throw notFound("standard_not_found", "standardId");
      if (caller.role !== "Buyer") throw new EnvelopeError({ code: "role_denied", message: "m", subject: "role" });
      const { locked } = validateLockedRuleBody(body);
      if (locked && this.planRefused) throw new EnvelopeError({ code: "plan_refused", message: "m", subject: "plan" });
      if (locked && this.conflict) {
        throw new EnvelopeError({ code: "locked_rule_conflict", message: "m", subject: mintUuidV7() });
      }
      return {
        standard: standardInfo,
        locked,
        changedAt: "2026-10-12T09:00:00.000Z",
        changedBy: { accountId: caller.accountId, name: "Bea" },
      };
    });
  }
}

/**
 * A fake child-Project permission service that records what reached it and
 * checks in the real order with the real validator: the Project, the role,
 * the body, then the account (only OWNER_ID is eligible).
 */
class FakeChildPermissions implements ChildPermissionService {
  calls: unknown[] = [];
  listChildPermissions(caller: SessionInfo, projectId: string): Promise<ChildPermissionList> {
    this.calls.push(["list", caller.role, projectId]);
    const found = tree.projects.find((p) => p.id === projectId);
    if (found === undefined) return Promise.reject(notFound("project_not_found", "projectId"));
    const account = { accountId: OWNER_ID, name: "Sam", role: "Standard owner" as const };
    return Promise.resolve({
      project: { id: found.id, name: found.name },
      grants: [{ account, grantedAt: "2026-10-12T09:00:00.000Z", grantedBy: { accountId: session.accountId, name: "Bea" } }],
      eligibleAccounts: [account],
    });
  }
  setChildPermission(caller: SessionInfo, projectId: string, body: unknown): Promise<ChildPermissionState> {
    this.calls.push(["set", caller.role, projectId, body]);
    return Promise.resolve().then(() => {
      const found = tree.projects.find((p) => p.id === projectId);
      if (found === undefined) throw notFound("project_not_found", "projectId");
      if (caller.role !== "Buyer") throw new EnvelopeError({ code: "role_denied", message: "m", subject: "role" });
      const { accountId, granted } = validateChildPermissionBody(body);
      if (accountId !== OWNER_ID) throw new EnvelopeError({ code: "invalid_input", message: "m", subject: "accountId" });
      return {
        project: { id: found.id, name: found.name },
        account: { accountId: OWNER_ID, name: "Sam", role: "Standard owner" },
        granted,
        changedAt: "2026-10-12T09:00:00.000Z",
        changedBy: { accountId: caller.accountId, name: "Bea" },
      };
    });
  }
}

/**
 * A fake build grant service that records what reached it and checks in the
 * real order with the real validator: the Project, the role, the body, then
 * the account (only OWNER_ID is eligible).
 */
class FakeBuildGrants implements BuildGrantService {
  calls: unknown[] = [];
  listBuildGrants(caller: SessionInfo, projectId: string): Promise<BuildGrantList> {
    this.calls.push(["list", caller.role, projectId]);
    const found = tree.projects.find((p) => p.id === projectId);
    if (found === undefined) return Promise.reject(notFound("project_not_found", "projectId"));
    const account = { accountId: OWNER_ID, name: "Sam", role: "Standard owner" as const };
    return Promise.resolve({
      project: { id: found.id, name: found.name },
      grants: [{ account, grantedAt: "2026-10-13T09:00:00.000Z", grantedBy: { accountId: session.accountId, name: "Bea" } }],
      eligibleAccounts: [account],
    });
  }
  setBuildGrant(caller: SessionInfo, projectId: string, body: unknown): Promise<BuildGrantState> {
    this.calls.push(["set", caller.role, projectId, body]);
    return Promise.resolve().then(() => {
      const found = tree.projects.find((p) => p.id === projectId);
      if (found === undefined) throw notFound("project_not_found", "projectId");
      if (caller.role !== "Buyer") throw new EnvelopeError({ code: "role_denied", message: "m", subject: "role" });
      const { accountId, granted } = validateBuildGrantBody(body);
      if (accountId !== OWNER_ID) throw new EnvelopeError({ code: "invalid_input", message: "m", subject: "accountId" });
      return {
        project: { id: found.id, name: found.name },
        account: { accountId: OWNER_ID, name: "Sam", role: "Standard owner" },
        granted,
        changedAt: "2026-10-13T09:00:00.000Z",
        changedBy: { accountId: caller.accountId, name: "Bea" },
      };
    });
  }
}

/**
 * A fake Application service that records what reached it and checks in the
 * real order with the real validator: the body, the Project, then the build
 * grant (a non-Buyer holds one on CHILD_ID only).
 */
class FakeApplications implements ApplicationService {
  /** The one Application the fake knows, placed on CHILD_ID. */
  readonly knownId = mintUuidV7();
  calls: unknown[] = [];
  getIdentificationFile(caller: SessionInfo, applicationId: string): Promise<IdentificationFileRendering> {
    this.calls.push(["file", caller.role, applicationId]);
    return Promise.resolve().then(() => {
      if (applicationId !== this.knownId) throw notFound(APPLICATION_NOT_FOUND, "applicationId");
      return { fileName: IDENTIFICATION_FILE_NAME, content: formatIdentificationFile(this.knownId, CHILD_ID) };
    });
  }
  listApplications(caller: SessionInfo): Promise<ApplicationList> {
    this.calls.push(["list", caller.role]);
    return Promise.resolve({
      applications: [
        {
          id: mintUuidV7(),
          description: "Checkout",
          project: { id: CHILD_ID, name: "Web" },
          fromFlow: true,
          agentTool: "claude-code",
          createdAt: "2026-10-13T09:00:00.000Z",
        },
      ],
    });
  }
  createApplication(caller: SessionInfo, body: unknown): Promise<ApplicationInfo> {
    this.calls.push(["create", caller.role, body]);
    return Promise.resolve().then(() => {
      const input = validateApplicationBody(body);
      const found = tree.projects.find((p) => p.id === input.projectId);
      if (found === undefined) throw notFound("project_not_found", "projectId");
      if (caller.role !== "Buyer" && found.id !== CHILD_ID) {
        throw new EnvelopeError({ code: "build_grant_denied", message: "m", subject: "projectId" });
      }
      return {
        id: mintUuidV7(),
        description: input.description,
        project: { id: found.id, name: found.name },
        fromFlow: true,
        agentTool: null,
        createdAt: "2026-10-13T09:00:00.000Z",
      };
    });
  }
  registerApplication(caller: SessionInfo, body: unknown): Promise<IdentificationFileRendering> {
    this.calls.push(["register", caller.role, body]);
    return Promise.resolve().then(() => {
      assertApplicationBuyer(caller);
      const input = validateApplicationBody(body);
      const found = tree.projects.find((p) => p.id === input.projectId);
      if (found === undefined) throw notFound("project_not_found", "projectId");
      const id = mintUuidV7();
      return { fileName: IDENTIFICATION_FILE_NAME, content: formatIdentificationFile(id, found.id) };
    });
  }
}

/** A fake Guidance endpoint service that records calls and uses the real role check and validator. */
class FakeGuidanceEndpoint implements GuidanceEndpointService {
  calls: unknown[] = [];
  state: GuidanceEndpointState = { url: null, changedAt: null };
  getGuidanceEndpoint(caller: SessionInfo): Promise<GuidanceEndpointState> {
    this.calls.push(["get", caller.role]);
    return Promise.resolve(this.state);
  }
  setGuidanceEndpoint(caller: SessionInfo, body: unknown): Promise<GuidanceEndpointState> {
    this.calls.push(["set", caller.role, body]);
    return Promise.resolve().then(() => {
      assertGuidanceEndpointBuyer(caller);
      this.state = { url: validateGuidanceEndpointBody(body), changedAt: "2026-10-13T09:00:00.000Z" };
      return this.state;
    });
  }
}

/** A fake Accepted-deviation service that records calls and uses the real role check, validator and plan flag. */
class FakeAcceptedDeviations implements AcceptedDeviationsService {
  calls: unknown[] = [];
  planRefused = false;
  /** The rows the list serves; the record call appends to them like the real store would. */
  records: AcceptedDeviationRecord[] = [];
  listAcceptances(caller: SessionInfo): Promise<{ records: AcceptedDeviationRecord[] }> {
    this.calls.push(["list", caller.role]);
    return Promise.resolve().then(() => {
      if (this.planRefused) {
        throw new EnvelopeError({ code: "plan_refused", message: "m", subject: "plan" });
      }
      return { records: this.records };
    });
  }
  recordAcceptance(caller: SessionInfo, body: unknown): Promise<AcceptedDeviationRecord> {
    this.calls.push(["record", caller.role, body]);
    // A stored record fabricated for the fake (the DB suite pins the real one).
    return Promise.resolve().then(() => {
      assertAcceptedDeviationBuyer(caller);
      const input = validateAcceptedDeviationBody(body);
      const record: AcceptedDeviationRecord = {
        id: mintUuidV7(),
        applicationId: input.applicationId,
        standardId: input.standardId,
        standardVersion: 1,
        slot: input.slot,
        subject: input.subject,
        start: input.start,
        end: input.end,
        buyer: { accountId: caller.accountId, name: "Bea Buyer" },
        justification: input.justification,
        alertIntervalHours: input.alertIntervalHours,
        createdAt: "2026-10-13T09:00:00.000Z",
      };
      this.records = [...this.records, record];
      return record;
    });
  }
}

/** A fake Accepted-deviation-alert service that records calls and uses the real role check and body shape. */
class FakeAcceptedDeviationAlerts implements AcceptedDeviationAlertsService {
  calls: unknown[] = [];
  /** The alert ids "raised"; a dismissal must name one of them. */
  raised: string[] = [];
  raiseDueAlerts(): Promise<{ raised: number; failed: number }> {
    return Promise.resolve({ raised: 0, failed: 0 });
  }
  listAlerts(caller: SessionInfo): Promise<{ alerts: AcceptedDeviationAlert[] }> {
    this.calls.push(["list", caller.role]);
    return Promise.resolve({ alerts: this.alerts });
  }
  dismissAlert(caller: SessionInfo, alertId: string, body: unknown): Promise<{ dismissed: true }> {
    this.calls.push(["dismiss", caller.role, alertId, body]);
    return Promise.resolve().then(() => {
      assertAcceptedDeviationAlertBuyer(caller);
      if (!isUuidV7(alertId)) {
        throw new EnvelopeError({ code: "invalid_input", message: "m", subject: "alertId" });
      }
      const record = typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
      if (
        record === null ||
        Object.keys(record).length !== 1 ||
        record["alertId"] !== alertId
      ) {
        throw new EnvelopeError({ code: "invalid_input", message: "m", subject: "alertId" });
      }
      if (!this.raised.includes(alertId)) throw notFound("not_found", "alertId");
      // The real store answers a repeat POST the same way (the dismissal row
      // is idempotent); the db suite pins the database mechanics.
      return { dismissed: true };
    });
  }
  alerts: AcceptedDeviationAlert[] = [];
}

/** A fake Compilations service that records calls and uses the real role check, validators and read gate. */
class FakeCompilations implements CompilationsService {
  calls: unknown[] = [];
  reads: CompilationCatalogRead[] = [];
  stored: Compilation[] = [];
  assertCatalogRead(tenantId: UuidV7): Promise<void> {
    this.calls.push(["gate", tenantId]);
    return Promise.resolve().then(() => {
      if (!this.reads.some((read) => read.catalogVersion === COMPILATION_CATALOG_VERSION)) {
        throw new EnvelopeError({ code: CATALOG_UNREAD, message: "m", subject: "catalog" });
      }
    });
  }
  recordCatalogRead(
    caller: SessionInfo,
    body: unknown,
  ): Promise<{ record: CompilationCatalogRead; created: boolean }> {
    this.calls.push(["record", caller.role, body]);
    return Promise.resolve().then(() => {
      assertCompilationBuyer(caller);
      const catalogVersion = validateCatalogReadBody(body);
      const existing = this.reads.find((read) => read.catalogVersion === catalogVersion);
      if (existing !== undefined) return { record: existing, created: false };
      const record: CompilationCatalogRead = {
        catalogVersion,
        readBy: { accountId: caller.accountId, name: "Bea Buyer" },
        readAt: "2026-10-15T12:00:00.000Z",
      };
      this.reads = [...this.reads, record];
      return { record, created: true };
    });
  }
  getCatalogRead(caller: SessionInfo): Promise<CompilationCatalogReadState> {
    this.calls.push(["get", caller.role]);
    const read = this.reads.find((entry) => entry.catalogVersion === COMPILATION_CATALOG_VERSION);
    return Promise.resolve(
      read === undefined
        ? { catalogVersion: COMPILATION_CATALOG_VERSION, read: false, readBy: null, readAt: null }
        : { catalogVersion: read.catalogVersion, read: true, readBy: read.readBy, readAt: read.readAt },
    );
  }
  ingestCompilation(tenantId: UuidV7, body: unknown): Promise<{ compilation: Compilation; replay: boolean }> {
    this.calls.push(["ingest", tenantId, body]);
    return Promise.resolve().then(() => {
      if (!this.reads.some((read) => read.catalogVersion === COMPILATION_CATALOG_VERSION)) {
        throw new EnvelopeError({ code: CATALOG_UNREAD, message: "m", subject: "catalog" });
      }
      const compilation = validateCompilationBody(body);
      const existing = this.stored.find((entry) => entry.idempotencyKey === compilation.idempotencyKey);
      if (existing !== undefined) return { compilation: existing, replay: true };
      this.stored = [...this.stored, compilation];
      return { compilation, replay: false };
    });
  }
}

/** A fake Boilerplate service: the known Application, the real body validator, then the endpoint check. */
class FakeBoilerplate implements BoilerplateService {
  private readonly knownId: string;
  private readonly endpoint: FakeGuidanceEndpoint;
  constructor(knownId: string, endpoint: FakeGuidanceEndpoint) {
    this.knownId = knownId;
    this.endpoint = endpoint;
  }
  calls: unknown[] = [];
  generateBoilerplate(caller: SessionInfo, applicationId: string, body: unknown): Promise<BoilerplateResult> {
    this.calls.push(["generate", caller.role, applicationId, body]);
    return Promise.resolve().then(() => {
      if (applicationId !== this.knownId) throw notFound(APPLICATION_NOT_FOUND, "applicationId");
      const target = validateBoilerplateBody(body);
      if (this.endpoint.state.url === null) {
        throw new EnvelopeError({ code: GUIDANCE_ENDPOINT_UNSET, message: "m", subject: "guidanceEndpoint" });
      }
      return {
        applicationId: this.knownId as BoilerplateResult["applicationId"],
        target,
        archiveName: `domain-harness-${this.knownId}-${target}.tar.gz`,
        archiveBase64: "H4sIAAAAAAAAAw==",
        artifacts: [
          { kind: "identification-file", path: ".domain-harness.json" },
          { kind: "dependency-pins", path: "package.json" },
        ],
      };
    });
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const notFound = (code: string, subject: string) => new EnvelopeError({ code, message: "m", subject });

describe("registry HTTP API", () => {
  const service = new FakeService();
  const modules = new FakeModules();
  const standards = new FakeStandards();
  const projects = new FakeProjects();
  const lockedRules = new FakeLockedRules();
  const childPermissions = new FakeChildPermissions();
  const buildGrants = new FakeBuildGrants();
  const applications = new FakeApplications();
  const guidanceEndpoint = new FakeGuidanceEndpoint();
  const acceptedDeviations = new FakeAcceptedDeviations();
  const acceptedDeviationAlerts = new FakeAcceptedDeviationAlerts();
  const boilerplate = new FakeBoilerplate(applications.knownId, guidanceEndpoint);
  const compilations = new FakeCompilations();
  const events: LogEvent[] = [];
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = createRegistryServer(
      {
        signIn: service,
        modules,
        standards,
        projects,
        lockedRules,
        childPermissions,
        buildGrants,
        applications,
        guidanceEndpoint,
        acceptedDeviations,
        acceptedDeviationAlerts,
        boilerplate,
        compilations,
      },
      (event) => events.push(event),
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    service.requested = [];
    modules.calls = [];
    standards.calls = [];
    projects.calls = [];
    lockedRules.calls = [];
    lockedRules.conflict = false;
    lockedRules.planRefused = false;
    projects.planRefused = false;
    childPermissions.calls = [];
    buildGrants.calls = [];
    applications.calls = [];
    guidanceEndpoint.calls = [];
    guidanceEndpoint.state = { url: null, changedAt: null };
    acceptedDeviations.calls = [];
    acceptedDeviations.planRefused = false;
    acceptedDeviations.records = [];
    acceptedDeviationAlerts.calls = [];
    acceptedDeviationAlerts.raised = [];
    acceptedDeviationAlerts.alerts = [];
    boilerplate.calls = [];
    compilations.calls = [];
    compilations.reads = [];
    compilations.stored = [];
    events.length = 0;
  });

  const post = (path: string, body: unknown, init: RequestInit = {}) =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
      ...init,
    });

  async function expectEnvelope(response: Response, status: number, code: string): Promise<void> {
    expect(response.status).toBe(status);
    const body: unknown = await response.json();
    expect(isErrorEnvelope(body)).toBe(true);
    expect(body).toMatchObject({ code });
  }

  describe("POST /v1/sign-in-links", () => {
    it("answers 202 {} identically for a known and an unknown email, then does the work", async () => {
      const known = await post("/v1/sign-in-links", { email: " Bea@Acme.io " });
      const unknown = await post("/v1/sign-in-links", { email: "nobody@else.io" });
      expect([known.status, unknown.status]).toEqual([202, 202]);
      expect(await known.text()).toBe("{}");
      expect(await unknown.text()).toBe("{}");
      expect(known.headers.get("content-type")).toBe(unknown.headers.get("content-type"));
      await expect.poll(() => service.requested).toEqual([" Bea@Acme.io ", "nobody@else.io"]);
    });

    it("logs counts only, never the address", async () => {
      await post("/v1/sign-in-links", { email: "bea@acme.io" });
      await expect.poll(() => events.some((e) => e["event"] === "sign_in_links")).toBe(true);
      expect(JSON.stringify(events)).not.toMatch(/acme/i);
      expect(events).toContainEqual({ event: "sign_in_links", links: 1, sent: 1, failed: 0 });
    });

    it.each([
      ["a malformed email", { email: "not-an-email" }],
      ["an empty email", { email: "" }],
      ["a missing email", {}],
      ["an extra field", { email: "bea@acme.io", tenantId: "x" }],
      ["a non-object", ["bea@acme.io"]],
      ["invalid JSON", "{ nope"],
    ])("answers 400 invalid_input for %s and does nothing", async (_label, body) => {
      await expectEnvelope(await post("/v1/sign-in-links", body), 400, "invalid_input");
      expect(service.requested).toEqual([]);
    });

    it("answers 413 for a body over the limit", async () => {
      const big = JSON.stringify({ email: `${"a".repeat(MAX_BODY_BYTES)}@x.io` });
      await expectEnvelope(await post("/v1/sign-in-links", big), 413, "payload_too_large");
    });
  });

  describe("POST /v1/sessions", () => {
    it("answers 201 SessionCreated for a valid link token", async () => {
      const response = await post("/v1/sessions", { token: GOOD_LINK });
      expect(response.status).toBe(201);
      const body: unknown = await response.json();
      expect(isSessionCreated(body)).toBe(true);
    });

    it("answers 401 sign_in_link_invalid for anything else", async () => {
      await expectEnvelope(await post("/v1/sessions", { token: "garbage" }), 401, "sign_in_link_invalid");
    });

    it("answers 400 for a missing token", async () => {
      await expectEnvelope(await post("/v1/sessions", { token: "" }), 400, "invalid_input");
    });

    it("answers 500 internal_error for an unexpected failure without echoing it", async () => {
      const response = await post("/v1/sessions", { token: "boom" });
      expect(response.status).toBe(500);
      const text = await response.text();
      expect(text).not.toMatch(/acme|driver/i);
      expect(JSON.parse(text)).toMatchObject({ code: "internal_error" });
      expect(JSON.stringify(events)).not.toMatch(/acme|driver/i);
    });
  });

  describe("content type", () => {
    it.each([
      ["text/plain", "text/plain"],
      ["form encoding", "application/x-www-form-urlencoded"],
    ])("answers 415 unsupported_media_type for a %s POST and does nothing", async (_label, type) => {
      const response = await post("/v1/sign-in-links", { email: "bea@acme.io" }, { headers: { "content-type": type } });
      await expectEnvelope(response, 415, "unsupported_media_type");
      expect(service.requested).toEqual([]);
    });

    it("accepts application/json with parameters", async () => {
      const response = await post(
        "/v1/sign-in-links",
        { email: "bea@acme.io" },
        { headers: { "content-type": "Application/JSON; charset=utf-8" } },
      );
      expect(response.status).toBe(202);
    });
  });

  describe("GET /v1/session", () => {
    it("answers 200 SessionInfo for a valid bearer token", async () => {
      const response = await fetch(`${base}/v1/session`, { headers: { authorization: `Bearer ${GOOD_SESSION}` } });
      expect(response.status).toBe(200);
      expect(isSessionInfo(await response.json())).toBe(true);
    });

    it("accepts the bearer scheme in any case", async () => {
      const response = await fetch(`${base}/v1/session`, { headers: { authorization: `bearer ${GOOD_SESSION}` } });
      expect(response.status).toBe(200);
    });

    it.each([
      ["no header", {}],
      ["a non-bearer header", { authorization: `Basic ${GOOD_SESSION}` }],
      ["an unknown token", { authorization: `Bearer ${tenantId}.${"x".repeat(43)}` }],
    ])("answers 401 session_invalid for %s", async (_label, headers) => {
      await expectEnvelope(await fetch(`${base}/v1/session`, { headers }), 401, "session_invalid");
    });
  });

  describe("Modules", () => {
    const buyer = { authorization: `Bearer ${GOOD_SESSION}` };
    const builderAuth = { authorization: `Bearer ${BUILDER_SESSION}` };
    const ownerPath = `/v1/modules/${MODULE_ID}/owner`;

    it("GET /v1/modules answers 200 ModuleList for any role", async () => {
      const response = await fetch(`${base}/v1/modules`, { headers: builderAuth });
      expect(response.status).toBe(200);
      expect(isModuleList(await response.json())).toBe(true);
    });

    it("POST /v1/modules answers 201 ModuleInfo for the Buyer and passes kind and name through", async () => {
      const response = await post("/v1/modules", { kind: "code-stack", name: " Code stack " }, { headers: { ...buyer, "content-type": "application/json" } });
      expect(response.status).toBe(201);
      expect(isModuleInfo(await response.json())).toBe(true);
      expect(modules.calls).toEqual([["create", { kind: "code-stack", name: " Code stack " }]]);
    });

    it("POST /v1/modules/{id}/owner answers 200 with the owner", async () => {
      const response = await post(ownerPath, { accountId: OWNER_ID }, { headers: { ...buyer, "content-type": "application/json" } });
      expect(response.status).toBe(200);
      const body: unknown = await response.json();
      expect(isModuleInfo(body)).toBe(true);
      expect(modules.calls).toEqual([["assign", MODULE_ID, { accountId: OWNER_ID }]]);
    });

    it.each([
      ["create", "/v1/modules", { kind: "code-stack", name: "x" }],
      ["create with a junk body", "/v1/modules", { nope: 1 }],
      ["assign", `/v1/modules/${MODULE_ID}/owner`, { accountId: OWNER_ID }],
      ["assign on a malformed id with a junk body", "/v1/modules/nope/owner", ["x"]],
    ])("answers 403 role_denied to a Builder (%s) before reading the body", async (_label, path, body) => {
      const response = await post(path, body, { headers: { ...builderAuth, "content-type": "application/json" } });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "role_denied", subject: "role" });
      expect(modules.calls).toEqual([]);
    });

    it.each([
      ["GET /v1/modules", "GET", "/v1/modules"],
      ["POST /v1/modules", "POST", "/v1/modules"],
      ["POST owner", "POST", `/v1/modules/${MODULE_ID}/owner`],
    ])("answers 401 session_invalid without a bearer token (%s)", async (_label, method, path) => {
      const init: RequestInit = method === "GET" ? {} : { method, headers: { "content-type": "application/json" }, body: "{}" };
      await expectEnvelope(await fetch(`${base}${path}`, init), 401, "session_invalid");
      await expectEnvelope(
        await fetch(`${base}${path}`, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), authorization: `Bearer ${tenantId}.unknown` } }),
        401,
        "session_invalid",
      );
      expect(modules.calls).toEqual([]);
    });

    it.each([
      ["an extra field", "/v1/modules", { kind: "code-stack", name: "x", id: MODULE_ID }, "id"],
      ["a non-object", "/v1/modules", ["code-stack"], "body"],
      ["an extra owner field", `/v1/modules/${MODULE_ID}/owner`, { accountId: OWNER_ID, assignedBy: OWNER_ID }, "assignedBy"],
    ])("answers 400 invalid_input for %s and calls no service", async (_label, path, body, subject) => {
      const response = await post(path, body, { headers: { ...buyer, "content-type": "application/json" } });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "invalid_input", subject });
      expect(modules.calls).toEqual([]);
    });

    it("maps the service's envelopes: 400 kind, 409 module_name_taken, 404 module_not_found", async () => {
      const headers = { ...buyer, "content-type": "application/json" };
      const badKind = await post("/v1/modules", { kind: "brand", name: "x" }, { headers });
      expect([badKind.status, await badKind.json()]).toMatchObject([400, { code: "invalid_input", subject: "kind" }]);
      const missing = await post("/v1/modules", { name: "x" }, { headers });
      expect([missing.status, await missing.json()]).toMatchObject([400, { subject: "kind" }]);
      const taken = await post("/v1/modules", { kind: "code-stack", name: "Taken" }, { headers });
      expect([taken.status, await taken.json()]).toMatchObject([409, { code: "module_name_taken", subject: "name" }]);
      const unknown = await post(`/v1/modules/${mintUuidV7()}/owner`, { accountId: OWNER_ID }, { headers });
      expect([unknown.status, await unknown.json()]).toMatchObject([404, { code: "module_not_found" }]);
    });

    it("answers 405 with both methods in Allow for PUT /v1/modules, and POST only for the owner route", async () => {
      const modulesPut = await fetch(`${base}/v1/modules`, { method: "PUT", headers: buyer });
      expect(modulesPut.headers.get("allow")).toBe("GET, POST");
      await expectEnvelope(modulesPut, 405, "method_not_allowed");
      const ownerGet = await fetch(`${base}${ownerPath}`, { headers: buyer });
      expect(ownerGet.headers.get("allow")).toBe("POST");
      await expectEnvelope(ownerGet, 405, "method_not_allowed");
    });

    it("logs the owner route by its pattern", async () => {
      await post(ownerPath, { accountId: OWNER_ID }, { headers: { ...buyer, "content-type": "application/json" } });
      await expect.poll(() => events.find((e) => e["event"] === "http_request")).toMatchObject({
        route: "/v1/modules/{id}/owner",
        status: 200,
      });
    });

    it("answers 404 not_found for a path beyond the owner route", async () => {
      await expectEnvelope(await fetch(`${base}/v1/modules/${MODULE_ID}/owner/x`, { headers: buyer }), 404, "not_found");
    });
  });

  describe("Standards", () => {
    const owner = { authorization: `Bearer ${GOOD_SESSION}`, "content-type": "application/json" };
    const builderAuth = { authorization: `Bearer ${BUILDER_SESSION}`, "content-type": "application/json" };
    const listPath = `/v1/modules/${MODULE_ID}/standards`;
    const versionsPath = `/v1/standards/${STANDARD_ID}/versions`;
    const entry = { category: "library", name: " React ", versionConstraint: "^18", status: "approved" };

    it("GET /v1/modules/{id}/standards answers 200 StandardList for any role", async () => {
      const response = await fetch(`${base}${listPath}`, { headers: builderAuth });
      expect(response.status).toBe(200);
      expect(isStandardList(await response.json())).toBe(true);
      expect(standards.calls).toEqual([["list", "Builder", MODULE_ID]]);
    });

    it("GET /v1/standards/{id}/versions answers 200 StandardVersionList for any role", async () => {
      const response = await fetch(`${base}${versionsPath}`, { headers: builderAuth });
      expect(response.status).toBe(200);
      const body: unknown = await response.json();
      expect(isStandardVersionList(body)).toBe(true);
      expect(standards.calls).toEqual([["versions", "Builder", STANDARD_ID]]);
    });

    it("POST /v1/modules/{id}/standards answers 201 StandardInfo and passes the body through", async () => {
      const response = await post(listPath, { entry }, { headers: owner });
      expect(response.status).toBe(201);
      const body: unknown = await response.json();
      expect(isStandardInfo(body)).toBe(true);
      expect(body).toMatchObject({ version: 1, entry: { name: "React", correctionInstruction: null } });
      expect(standards.calls).toEqual([["publish", MODULE_ID, { entry }]]);
    });

    it("POST /v1/standards/{id}/versions answers 201 with the next version", async () => {
      const response = await post(versionsPath, { entry: { ...entry, status: "required" } }, { headers: owner });
      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({ id: STANDARD_ID, version: 2, entry: { status: "required" } });
    });

    it.each([
      ["GET list", "GET", listPath],
      ["POST publish", "POST", listPath],
      ["GET versions", "GET", versionsPath],
      ["POST republish", "POST", versionsPath],
    ])("answers 401 session_invalid without a bearer token (%s) and calls no service", async (_label, method, path) => {
      const init: RequestInit =
        method === "GET" ? {} : { method, headers: { "content-type": "application/json" }, body: JSON.stringify({ entry }) };
      await expectEnvelope(await fetch(`${base}${path}`, init), 401, "session_invalid");
      expect(standards.calls).toEqual([]);
    });

    it("maps the service's envelopes to 403, 404, 409 and 400", async () => {
      const cases: [string, unknown, RequestInit, number, Record<string, string>][] = [
        [listPath, { entry }, { headers: builderAuth }, 403, { code: "not_module_owner", subject: "role" }],
        [`/v1/modules/${mintUuidV7()}/standards`, { entry }, { headers: owner }, 404, { code: "module_not_found" }],
        ["/v1/modules/nope/standards", { entry }, { headers: owner }, 404, { code: "module_not_found" }],
        [`/v1/standards/${mintUuidV7()}/versions`, { entry }, { headers: owner }, 404, { code: "standard_not_found" }],
        [listPath, { entry: { ...entry, name: "Ownerless" } }, { headers: owner }, 409, { code: "module_has_no_owner" }],
        [listPath, { entry: { ...entry, name: "Taken" } }, { headers: owner }, 409, { code: "slot_conflict", subject: STANDARD_ID }],
        [listPath, { entry: { ...entry, name: "" } }, { headers: owner }, 400, { code: "invalid_input", subject: "name" }],
        [listPath, { entry, id: STANDARD_ID }, { headers: owner }, 400, { code: "invalid_input", subject: "id" }],
        [listPath, { entry: { ...entry, owner: "x" } }, { headers: owner }, 400, { code: "invalid_input", subject: "owner" }],
      ];
      for (const [path, body, init, status, expected] of cases) {
        const response = await post(path, body, init);
        expect([path, response.status, await response.json()]).toMatchObject([path, status, expected]);
      }
    });

    it("answers 404 for an unknown Module or Standard on GET", async () => {
      await expectEnvelope(await fetch(`${base}/v1/modules/${mintUuidV7()}/standards`, { headers: owner }), 404, "module_not_found");
      await expectEnvelope(await fetch(`${base}/v1/standards/nope/versions`, { headers: owner }), 404, "standard_not_found");
    });

    it("accepts the longest valid design-system component in four-byte characters", async () => {
      const wide = "\u{1F600}";
      const component = {
        entry: {
          kind: "component",
          name: wide.repeat(200),
          usageRule: wide.repeat(1000),
          tokens: Array.from({ length: 50 }, (_, i) => `${String(i).padStart(2, "0")}${wide.repeat(198)}`),
          correctionInstruction: wide.repeat(1000),
        },
      };
      expect(Buffer.byteLength(JSON.stringify(component))).toBeGreaterThan(16 * 1024);
      expect(Buffer.byteLength(JSON.stringify(component))).toBeLessThan(MAX_BODY_BYTES);
      const response = await post(listPath, component, { headers: owner });
      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({ entry: { kind: "component" } });
    });

    it("accepts a body above the old 4 KiB limit (Correction instructions) and refuses one over 64 KiB", async () => {
      expect(MAX_BODY_BYTES).toBe(64 * 1024);
      // The longest valid entry, in four-byte characters, is over 4 KiB of UTF-8.
      const long = {
        entry: { ...entry, name: "\u{1F600}".repeat(200), correctionInstruction: "\u{1F600}".repeat(1000), versionConstraint: "x".repeat(100) },
      };
      expect(Buffer.byteLength(JSON.stringify(long))).toBeGreaterThan(4 * 1024);
      expect((await post(listPath, long, { headers: owner })).status).toBe(201);
      const huge = JSON.stringify({ entry: { ...entry, correctionInstruction: "x".repeat(MAX_BODY_BYTES) } });
      await expectEnvelope(await post(listPath, huge, { headers: owner }), 413, "payload_too_large");
    });

    it("answers 405 with GET, POST in Allow for PUT on both routes", async () => {
      for (const path of [listPath, versionsPath]) {
        const response = await fetch(`${base}${path}`, { method: "PUT", headers: owner });
        expect(response.headers.get("allow")).toBe("GET, POST");
        await expectEnvelope(response, 405, "method_not_allowed");
      }
    });

    it("logs the routes by their patterns, never the ids", async () => {
      await fetch(`${base}${listPath}`, { headers: owner });
      await fetch(`${base}${versionsPath}`, { headers: owner });
      await expect
        .poll(() => events.filter((e) => e["event"] === "http_request").map((e) => e["route"]))
        .toEqual(["/v1/modules/{id}/standards", "/v1/standards/{id}/versions"]);
      expect(JSON.stringify(events)).not.toContain(STANDARD_ID);
    });
  });

  describe("Project tree", () => {
    const json = { "content-type": "application/json" };
    const buyerAuth = { ...json, authorization: `Bearer ${GOOD_SESSION}` };
    const builderAuth = { ...json, authorization: `Bearer ${BUILDER_SESSION}` };
    const create = { name: " Web ", levelName: "  Product line ", parentId: ROOT_ID };

    it("serves the tree and one Project to every role", async () => {
      const response = await fetch(`${base}/v1/projects`, { headers: builderAuth });
      expect(response.status).toBe(200);
      expect(isProjectTree(await response.json())).toBe(true);
      const one = await fetch(`${base}/v1/projects/${CHILD_ID}`, { headers: builderAuth });
      expect(one.status).toBe(200);
      expect(isProjectInfo(await one.json())).toBe(true);
    });

    it("serves a Project's Effective Standard set to every role", async () => {
      for (const headers of [buyerAuth, builderAuth]) {
        const response = await fetch(`${base}/v1/projects/${CHILD_ID}/effective-standards`, { headers });
        expect(response.status).toBe(200);
        expect(isEffectiveStandardSet(await response.json())).toBe(true);
      }
      expect(projects.calls).toEqual([
        ["effective", "Buyer", CHILD_ID],
        ["effective", "Builder", CHILD_ID],
      ]);
    });

    it("maps the Effective Standard set refusals to 401, 404 and 409", async () => {
      const path = (id: string) => `${base}/v1/projects/${id}/effective-standards`;
      await expectEnvelope(await fetch(path(CHILD_ID)), 401, "session_invalid");
      expect(projects.calls).toEqual([]);
      const unknown = await fetch(path(mintUuidV7()), { headers: builderAuth });
      expect(unknown.status).toBe(404);
      expect(await unknown.json()).toMatchObject({ code: "project_not_found", subject: "projectId" });
      await expectEnvelope(await fetch(path("nope"), { headers: builderAuth }), 404, "project_not_found");
      await expectEnvelope(await fetch(path(ROOT_ID), { headers: builderAuth }), 409, "slot_conflict");
    });

    it("answers 201 on create, keeping the level name exactly as typed", async () => {
      const response = await post("/v1/projects", create, { headers: buyerAuth });
      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({ name: "Web", levelName: "  Product line ", parentId: ROOT_ID });
    });

    it("answers 200 on a parent change", async () => {
      const response = await post(`/v1/projects/${CHILD_ID}/parent`, { parentId: ROOT_ID }, { headers: buyerAuth });
      expect(response.status).toBe(200);
      expect(isProjectInfo(await response.json())).toBe(true);
    });

    it.each([
      ["GET tree", "GET", "/v1/projects"],
      ["GET one", "GET", `/v1/projects/${CHILD_ID}`],
      ["GET effective", "GET", `/v1/projects/${CHILD_ID}/effective-standards`],
      ["POST create", "POST", "/v1/projects"],
      ["POST parent", "POST", `/v1/projects/${CHILD_ID}/parent`],
    ])("answers 401 session_invalid without a bearer token (%s) and calls no service", async (_label, method, path) => {
      const init: RequestInit =
        method === "GET" ? {} : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(create) };
      await expectEnvelope(await fetch(`${base}${path}`, init), 401, "session_invalid");
      expect(projects.calls).toEqual([]);
    });

    it("reads a non-Buyer's create body first: 400 for a malformed one, 403 child_permission_denied without a grant", async () => {
      await expectEnvelope(await post("/v1/projects", "{ not json", { headers: builderAuth }), 400, "invalid_input");
      expect(projects.calls).toEqual([]);
      const bad = await post("/v1/projects", { ...create, name: "" }, { headers: builderAuth });
      expect(bad.status).toBe(400);
      expect(await bad.json()).toMatchObject({ code: "invalid_input", subject: "name" });
      const denied = await post("/v1/projects", create, { headers: builderAuth });
      expect(denied.status).toBe(403);
      expect(await denied.json()).toMatchObject({ code: "child_permission_denied", subject: "parentId" });
      const unknown = await post("/v1/projects", { ...create, parentId: mintUuidV7() }, { headers: builderAuth });
      expect(unknown.status).toBe(404);
      expect(await unknown.json()).toMatchObject({ code: "project_not_found", subject: "parentId" });
    });

    it("answers 201 to a non-Buyer's create under a Project it holds a grant on", async () => {
      const response = await post("/v1/projects", { ...create, parentId: CHILD_ID }, { headers: builderAuth });
      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({ parentId: CHILD_ID });
    });

    it("maps the refusals in the check order to 404, 403, 400 and 409", async () => {
      const unknown = mintUuidV7();
      const cases: [string, unknown, Record<string, string>, number, Record<string, string>][] = [
        [`/v1/projects/${unknown}/parent`, { parentId: ROOT_ID }, builderAuth, 404, { code: "project_not_found", subject: "projectId" }],
        ["/v1/projects/nope/parent", { parentId: ROOT_ID }, buyerAuth, 404, { code: "project_not_found", subject: "projectId" }],
        [`/v1/projects/${CHILD_ID}/parent`, { parentId: ROOT_ID }, builderAuth, 403, { code: "role_denied", subject: "role" }],
        [`/v1/projects/${CHILD_ID}/parent`, { parentId: null }, buyerAuth, 400, { code: "invalid_input", subject: "parentId" }],
        [`/v1/projects/${CHILD_ID}/parent`, { parentId: ROOT_ID, name: "x" }, buyerAuth, 400, { code: "invalid_input", subject: "name" }],
        [`/v1/projects/${CHILD_ID}/parent`, { parentId: unknown }, buyerAuth, 404, { code: "project_not_found", subject: "parentId" }],
        [`/v1/projects/${ROOT_ID}/parent`, { parentId: CHILD_ID }, buyerAuth, 409, { code: "root_project_fixed", subject: "projectId" }],
        [`/v1/projects/${CHILD_ID}/parent`, { parentId: CHILD_ID }, buyerAuth, 409, { code: "project_cycle", subject: CHILD_ID }],
        ["/v1/projects", { ...create, name: "" }, buyerAuth, 400, { code: "invalid_input", subject: "name" }],
        ["/v1/projects", { ...create, levelName: "   " }, buyerAuth, 400, { code: "invalid_input", subject: "levelName" }],
        ["/v1/projects", { ...create, extra: 1 }, buyerAuth, 400, { code: "invalid_input", subject: "extra" }],
        ["/v1/projects", { ...create, parentId: unknown }, buyerAuth, 404, { code: "project_not_found", subject: "parentId" }],
      ];
      for (const [path, body, headers, status, expected] of cases) {
        const response = await post(path, body, { headers });
        expect([path, response.status, await response.json()]).toMatchObject([path, status, expected]);
      }
    });

    it("maps plan_refused to 403: create before the body, a parent change after the role", async () => {
      projects.planRefused = true;
      const cases: [string, unknown, Record<string, string>, number, Record<string, string>][] = [
        ["/v1/projects", create, buyerAuth, 403, { code: "plan_refused", subject: "plan" }],
        ["/v1/projects", { ...create, name: "" }, buyerAuth, 403, { code: "plan_refused", subject: "plan" }],
        ["/v1/projects", create, builderAuth, 403, { code: "plan_refused", subject: "plan" }],
        [`/v1/projects/${CHILD_ID}/parent`, { parentId: ROOT_ID }, buyerAuth, 403, { code: "plan_refused", subject: "plan" }],
        [`/v1/projects/${CHILD_ID}/parent`, { parentId: null }, buyerAuth, 403, { code: "plan_refused", subject: "plan" }],
        [`/v1/projects/${CHILD_ID}/parent`, { parentId: ROOT_ID }, builderAuth, 403, { code: "role_denied", subject: "role" }],
      ];
      for (const [path, body, headers, status, expected] of cases) {
        const response = await post(path, body, { headers });
        expect([path, response.status, await response.json()]).toMatchObject([path, status, expected]);
      }
    });

    it("answers 404 for an unknown or malformed id on GET", async () => {
      await expectEnvelope(await fetch(`${base}/v1/projects/${mintUuidV7()}`, { headers: buyerAuth }), 404, "project_not_found");
      await expectEnvelope(await fetch(`${base}/v1/projects/nope`, { headers: buyerAuth }), 404, "project_not_found");
    });

    it("answers 405 with Allow for a wrong method on each route", async () => {
      for (const [path, method, allow] of [
        ["/v1/projects", "PUT", "GET, POST"],
        [`/v1/projects/${CHILD_ID}`, "POST", "GET"],
        [`/v1/projects/${CHILD_ID}/parent`, "GET", "POST"],
        [`/v1/projects/${CHILD_ID}/effective-standards`, "POST", "GET"],
      ] as const) {
        const response = await fetch(`${base}${path}`, { method, headers: buyerAuth });
        expect(response.headers.get("allow")).toBe(allow);
        await expectEnvelope(response, 405, "method_not_allowed");
      }
    });

    it("logs the routes by their patterns, never the ids", async () => {
      await fetch(`${base}/v1/projects`, { headers: buyerAuth });
      await fetch(`${base}/v1/projects/${CHILD_ID}`, { headers: buyerAuth });
      await post(`/v1/projects/${CHILD_ID}/parent`, { parentId: ROOT_ID }, { headers: buyerAuth });
      await fetch(`${base}/v1/projects/${CHILD_ID}/effective-standards`, { headers: buyerAuth });
      await expect
        .poll(() => events.filter((e) => e["event"] === "http_request").map((e) => e["route"]))
        .toEqual([
          "/v1/projects",
          "/v1/projects/{id}",
          "/v1/projects/{id}/parent",
          "/v1/projects/{id}/effective-standards",
        ]);
      expect(JSON.stringify(events)).not.toContain(CHILD_ID);
    });
  });

  describe("Locked rules", () => {
    const json = { "content-type": "application/json" };
    const buyerAuth = { ...json, authorization: `Bearer ${GOOD_SESSION}` };
    const builderAuth = { ...json, authorization: `Bearer ${BUILDER_SESSION}` };
    const path = (id: string) => `/v1/standards/${id}/locked-rule`;

    it("answers 200 with the Locked-rule state on a mark and an unmark", async () => {
      for (const locked of [true, false]) {
        const response = await post(path(STANDARD_ID), { locked }, { headers: buyerAuth });
        expect(response.status).toBe(200);
        const body: unknown = await response.json();
        expect(isLockedRuleState(body)).toBe(true);
        expect(body).toMatchObject({ locked });
      }
      expect(lockedRules.calls).toEqual([
        ["lock", "Buyer", STANDARD_ID, { locked: true }],
        ["lock", "Buyer", STANDARD_ID, { locked: false }],
      ]);
    });

    it("answers 401 session_invalid without a bearer token and calls no service", async () => {
      await expectEnvelope(await post(path(STANDARD_ID), { locked: true }), 401, "session_invalid");
      expect(lockedRules.calls).toEqual([]);
    });

    it("maps the refusals in the check order to 404, 403, 400 and 409", async () => {
      lockedRules.conflict = true;
      const cases: [string, unknown, Record<string, string>, number, Record<string, string>][] = [
        [path(mintUuidV7()), { locked: true }, builderAuth, 404, { code: "standard_not_found", subject: "standardId" }],
        [path("nope"), { locked: true }, buyerAuth, 404, { code: "standard_not_found", subject: "standardId" }],
        [path(STANDARD_ID), { locked: true }, builderAuth, 403, { code: "role_denied", subject: "role" }],
        [path(STANDARD_ID), {}, buyerAuth, 400, { code: "invalid_input", subject: "locked" }],
        [path(STANDARD_ID), { locked: "yes" }, buyerAuth, 400, { code: "invalid_input", subject: "locked" }],
        [path(STANDARD_ID), { locked: true, note: 1 }, buyerAuth, 400, { code: "invalid_input", subject: "note" }],
        [path(STANDARD_ID), { locked: true }, buyerAuth, 409, { code: "locked_rule_conflict" }],
      ];
      for (const [target, body, headers, status, expected] of cases) {
        const response = await post(target, body, { headers });
        expect([target, response.status, await response.json()]).toMatchObject([target, status, expected]);
      }
    });

    it("maps plan_refused on a mark to 403 after the role and the body; an unmark still answers 200", async () => {
      lockedRules.planRefused = true;
      const refused = await post(path(STANDARD_ID), { locked: true }, { headers: buyerAuth });
      expect(refused.status).toBe(403);
      expect(await refused.json()).toMatchObject({ code: "plan_refused", subject: "plan" });
      await expectEnvelope(await post(path(STANDARD_ID), { locked: true }, { headers: builderAuth }), 403, "role_denied");
      await expectEnvelope(await post(path(STANDARD_ID), { locked: "yes" }, { headers: buyerAuth }), 400, "invalid_input");
      expect((await post(path(STANDARD_ID), { locked: false }, { headers: buyerAuth })).status).toBe(200);
    });

    it("answers 405 with Allow for a wrong method and logs the route by its pattern", async () => {
      const response = await fetch(`${base}${path(STANDARD_ID)}`, { headers: buyerAuth });
      expect(response.headers.get("allow")).toBe("POST");
      await expectEnvelope(response, 405, "method_not_allowed");
      await expect
        .poll(() => events.filter((e) => e["event"] === "http_request").map((e) => e["route"]))
        .toEqual(["/v1/standards/{id}/locked-rule"]);
      expect(JSON.stringify(events)).not.toContain(STANDARD_ID);
    });
  });

  describe("child-Project permission", () => {
    const json = { "content-type": "application/json" };
    const buyerAuth = { ...json, authorization: `Bearer ${GOOD_SESSION}` };
    const builderAuth = { ...json, authorization: `Bearer ${BUILDER_SESSION}` };
    const path = (id: string) => `/v1/projects/${id}/child-permissions`;

    it("serves a Project's grants to every role", async () => {
      for (const headers of [buyerAuth, builderAuth]) {
        const response = await fetch(`${base}${path(CHILD_ID)}`, { headers });
        expect(response.status).toBe(200);
        expect(isChildPermissionList(await response.json())).toBe(true);
      }
      expect(childPermissions.calls).toEqual([
        ["list", "Buyer", CHILD_ID],
        ["list", "Builder", CHILD_ID],
      ]);
    });

    it("answers 200 with the pair's state on a grant and a revoke", async () => {
      for (const granted of [true, false]) {
        const response = await post(path(CHILD_ID), { accountId: OWNER_ID, granted }, { headers: buyerAuth });
        expect(response.status).toBe(200);
        const body: unknown = await response.json();
        expect(isChildPermissionState(body)).toBe(true);
        expect(body).toMatchObject({ granted });
      }
    });

    it("answers 401 session_invalid without a bearer token and calls no service", async () => {
      await expectEnvelope(await fetch(`${base}${path(CHILD_ID)}`), 401, "session_invalid");
      await expectEnvelope(await post(path(CHILD_ID), { accountId: OWNER_ID, granted: true }), 401, "session_invalid");
      expect(childPermissions.calls).toEqual([]);
    });

    it("maps the refusals in the check order to 404, 403 and 400", async () => {
      await expectEnvelope(await fetch(`${base}${path("nope")}`, { headers: builderAuth }), 404, "project_not_found");
      const grant = { accountId: OWNER_ID, granted: true };
      const cases: [string, unknown, Record<string, string>, number, Record<string, string>][] = [
        [path(mintUuidV7()), grant, builderAuth, 404, { code: "project_not_found", subject: "projectId" }],
        [path("nope"), grant, buyerAuth, 404, { code: "project_not_found", subject: "projectId" }],
        [path(CHILD_ID), grant, builderAuth, 403, { code: "role_denied", subject: "role" }],
        [path(CHILD_ID), { granted: true }, buyerAuth, 400, { code: "invalid_input", subject: "accountId" }],
        [path(CHILD_ID), { accountId: OWNER_ID, granted: "yes" }, buyerAuth, 400, { code: "invalid_input", subject: "granted" }],
        [path(CHILD_ID), { ...grant, note: 1 }, buyerAuth, 400, { code: "invalid_input", subject: "note" }],
        [path(CHILD_ID), { ...grant, accountId: mintUuidV7() }, buyerAuth, 400, { code: "invalid_input", subject: "accountId" }],
      ];
      for (const [target, body, headers, status, expected] of cases) {
        const response = await post(target, body, { headers });
        expect([target, response.status, await response.json()]).toMatchObject([target, status, expected]);
      }
    });

    it("answers 405 with Allow for a wrong method and logs the route by its pattern", async () => {
      const response = await fetch(`${base}${path(CHILD_ID)}`, { method: "PUT", headers: buyerAuth });
      expect(response.headers.get("allow")).toBe("GET, POST");
      await expectEnvelope(response, 405, "method_not_allowed");
      await expect
        .poll(() => events.filter((e) => e["event"] === "http_request").map((e) => e["route"]))
        .toEqual(["/v1/projects/{id}/child-permissions"]);
      expect(JSON.stringify(events)).not.toContain(CHILD_ID);
    });
  });

  describe("build grant", () => {
    const json = { "content-type": "application/json" };
    const buyerAuth = { ...json, authorization: `Bearer ${GOOD_SESSION}` };
    const builderAuth = { ...json, authorization: `Bearer ${BUILDER_SESSION}` };
    const path = (id: string) => `/v1/projects/${id}/build-grants`;

    it("serves a Project's build grants to every role", async () => {
      for (const headers of [buyerAuth, builderAuth]) {
        const response = await fetch(`${base}${path(CHILD_ID)}`, { headers });
        expect(response.status).toBe(200);
        expect(isBuildGrantList(await response.json())).toBe(true);
      }
      expect(buildGrants.calls).toEqual([
        ["list", "Buyer", CHILD_ID],
        ["list", "Builder", CHILD_ID],
      ]);
      expect(childPermissions.calls).toEqual([]);
    });

    it("answers 200 with the pair's state on a grant and a revoke", async () => {
      for (const granted of [true, false]) {
        const response = await post(path(CHILD_ID), { accountId: OWNER_ID, granted }, { headers: buyerAuth });
        expect(response.status).toBe(200);
        const body: unknown = await response.json();
        expect(isBuildGrantState(body)).toBe(true);
        expect(body).toMatchObject({ granted });
      }
    });

    it("answers 401 session_invalid without a bearer token and calls no service", async () => {
      await expectEnvelope(await fetch(`${base}${path(CHILD_ID)}`), 401, "session_invalid");
      await expectEnvelope(await post(path(CHILD_ID), { accountId: OWNER_ID, granted: true }), 401, "session_invalid");
      expect(buildGrants.calls).toEqual([]);
    });

    it("maps the refusals in the check order to 404, 403 and 400", async () => {
      await expectEnvelope(await fetch(`${base}${path("nope")}`, { headers: builderAuth }), 404, "project_not_found");
      const grant = { accountId: OWNER_ID, granted: true };
      const cases: [string, unknown, Record<string, string>, number, Record<string, string>][] = [
        [path(mintUuidV7()), grant, builderAuth, 404, { code: "project_not_found", subject: "projectId" }],
        [path("nope"), grant, buyerAuth, 404, { code: "project_not_found", subject: "projectId" }],
        [path(CHILD_ID), grant, builderAuth, 403, { code: "role_denied", subject: "role" }],
        [path(CHILD_ID), { granted: true }, buyerAuth, 400, { code: "invalid_input", subject: "accountId" }],
        [path(CHILD_ID), { accountId: OWNER_ID, granted: "yes" }, buyerAuth, 400, { code: "invalid_input", subject: "granted" }],
        [path(CHILD_ID), { ...grant, note: 1 }, buyerAuth, 400, { code: "invalid_input", subject: "note" }],
        [path(CHILD_ID), { ...grant, accountId: mintUuidV7() }, buyerAuth, 400, { code: "invalid_input", subject: "accountId" }],
      ];
      for (const [target, body, headers, status, expected] of cases) {
        const response = await post(target, body, { headers });
        expect([target, response.status, await response.json()]).toMatchObject([target, status, expected]);
      }
    });

    it("answers 405 with Allow for a wrong method and logs the route by its pattern", async () => {
      const response = await fetch(`${base}${path(CHILD_ID)}`, { method: "PUT", headers: buyerAuth });
      expect(response.headers.get("allow")).toBe("GET, POST");
      await expectEnvelope(response, 405, "method_not_allowed");
      await expect
        .poll(() => events.filter((e) => e["event"] === "http_request").map((e) => e["route"]))
        .toEqual(["/v1/projects/{id}/build-grants"]);
      expect(JSON.stringify(events)).not.toContain(CHILD_ID);
    });
  });

  describe("Applications", () => {
    const json = { "content-type": "application/json" };
    const buyerAuth = { ...json, authorization: `Bearer ${GOOD_SESSION}` };
    const builderAuth = { ...json, authorization: `Bearer ${BUILDER_SESSION}` };
    const path = "/v1/applications";

    it("serves the Applications to every role, with no creator on the wire", async () => {
      for (const headers of [buyerAuth, builderAuth]) {
        const response = await fetch(`${base}${path}`, { headers });
        expect(response.status).toBe(200);
        const body: unknown = await response.json();
        expect(isApplicationList(body)).toBe(true);
        expect(JSON.stringify(body)).not.toContain("createdBy");
      }
      expect(applications.calls).toEqual([["list", "Buyer"], ["list", "Builder"]]);
    });

    it("answers 201 ApplicationInfo for the Buyer anywhere and a Builder on a granted Project", async () => {
      for (const [headers, projectId] of [
        [buyerAuth, ROOT_ID],
        [builderAuth, CHILD_ID],
      ] as const) {
        const response = await post(path, { description: " Checkout ", projectId }, { headers });
        expect(response.status).toBe(201);
        const body: unknown = await response.json();
        expect(isApplicationInfo(body)).toBe(true);
        expect(body).toMatchObject({ description: "Checkout", project: { id: projectId }, fromFlow: true });
      }
    });

    it("answers 401 session_invalid without a bearer token and calls no service", async () => {
      await expectEnvelope(await fetch(`${base}${path}`), 401, "session_invalid");
      await expectEnvelope(await post(path, { description: "x", projectId: CHILD_ID }), 401, "session_invalid");
      expect(applications.calls).toEqual([]);
    });

    it("maps the refusals in the check order to 400, 404 and 403", async () => {
      const cases: [unknown, Record<string, string>, number, Record<string, string>][] = [
        [[], builderAuth, 400, { code: "invalid_input", subject: "body" }],
        [{ description: "x", projectId: ROOT_ID, note: 1 }, builderAuth, 400, { code: "invalid_input", subject: "note" }],
        [{ projectId: "nope" }, builderAuth, 400, { code: "invalid_input", subject: "description" }],
        [{ description: "  ", projectId: ROOT_ID }, buyerAuth, 400, { code: "invalid_input", subject: "description" }],
        [{ description: "x".repeat(501), projectId: ROOT_ID }, buyerAuth, 400, { code: "invalid_input", subject: "description" }],
        [{ description: "x" }, builderAuth, 400, { code: "invalid_input", subject: "projectId" }],
        [{ description: "x", projectId: "" }, buyerAuth, 400, { code: "invalid_input", subject: "projectId" }],
        [{ description: "x", projectId: "nope" }, builderAuth, 404, { code: "project_not_found", subject: "projectId" }],
        [{ description: "x", projectId: mintUuidV7() }, buyerAuth, 404, { code: "project_not_found", subject: "projectId" }],
        [{ description: "x", projectId: ROOT_ID }, builderAuth, 403, { code: "build_grant_denied", subject: "projectId" }],
      ];
      for (const [body, headers, status, expected] of cases) {
        const response = await post(path, body, { headers });
        expect([body, response.status, await response.json()]).toMatchObject([body, status, expected]);
      }
    });

    it("answers 405 with Allow for a wrong method and logs the route", async () => {
      const response = await fetch(`${base}${path}`, { method: "PUT", headers: buyerAuth });
      expect(response.headers.get("allow")).toBe("GET, POST");
      await expectEnvelope(response, 405, "method_not_allowed");
      await expect
        .poll(() => events.filter((e) => e["event"] === "http_request").map((e) => e["route"]))
        .toEqual(["/v1/applications"]);
    });
  });

  describe("Application registration", () => {
    const json = { "content-type": "application/json" };
    const buyerAuth = { ...json, authorization: `Bearer ${GOOD_SESSION}` };
    const builderAuth = { ...json, authorization: `Bearer ${BUILDER_SESSION}` };
    const path = "/v1/applications/registered";

    it("answers 201 with the identification file of the minted Application, for the Buyer only", async () => {
      const response = await post(path, { description: " Existing ", projectId: CHILD_ID }, { headers: buyerAuth });
      expect(response.status).toBe(201);
      const body: unknown = await response.json();
      expect(isIdentificationFileRendering(body)).toBe(true);
      expect(body).toMatchObject({ fileName: ".domain-harness.json" });
      expect(applications.calls).toEqual([["register", "Buyer", { description: " Existing ", projectId: CHILD_ID }]]);
    });

    it("refuses a non-Buyer with 403 role_denied before the body is read", async () => {
      const response = await post(path, "{not json", { headers: builderAuth });
      await expectEnvelope(response, 403, "role_denied");
      expect(applications.calls).toEqual([]);
      await expect
        .poll(() => events.filter((e) => e["event"] === "http_request").map((e) => e["route"]))
        .toEqual(["/v1/applications/registered"]);
    });

    it("answers 401 session_invalid without a bearer token and calls no service", async () => {
      await expectEnvelope(
        await post(path, { description: "x", projectId: CHILD_ID }, { headers: { ...json } }),
        401,
        "session_invalid",
      );
      expect(applications.calls).toEqual([]);
    });

    it("maps the service's refusals in the check order", async () => {
      const cases: [unknown, Record<string, string>, number, Record<string, string>][] = [
        [[], buyerAuth, 400, { code: "invalid_input", subject: "body" }],
        [{ description: "x", projectId: CHILD_ID, note: 1 }, buyerAuth, 400, { code: "invalid_input", subject: "note" }],
        [{ description: "  ", projectId: CHILD_ID }, buyerAuth, 400, { code: "invalid_input", subject: "description" }],
        [{ description: "x" }, buyerAuth, 400, { code: "invalid_input", subject: "projectId" }],
        [{ description: "x", projectId: "nope" }, buyerAuth, 404, { code: "project_not_found", subject: "projectId" }],
      ];
      for (const [body, headers, status, expected] of cases) {
        const response = await post(path, body, { headers });
        expect([body, response.status, await response.json()]).toMatchObject([body, status, expected]);
      }
    });

    it("answers 405 with the Allow: POST header for a wrong method", async () => {
      for (const method of ["GET", "PUT"]) {
        const response = await fetch(`${base}${path}`, { method, headers: buyerAuth });
        expect(response.headers.get("allow")).toBe("POST");
        await expectEnvelope(response, 405, "method_not_allowed");
      }
      expect(applications.calls).toEqual([]);
    });
  });

  describe("Application identification file", () => {
    const buyerAuth = { authorization: `Bearer ${GOOD_SESSION}` };
    const builderAuth = { authorization: `Bearer ${BUILDER_SESSION}` };
    const path = applicationIdentificationFilePath;

    it("serves the rendering to every role, with the decoded id reaching the service", async () => {
      for (const headers of [buyerAuth, builderAuth]) {
        const response = await fetch(`${base}${path(applications.knownId)}`, { headers });
        expect(response.status).toBe(200);
        const body: unknown = await response.json();
        expect(isIdentificationFileRendering(body)).toBe(true);
        expect(body).toEqual({
          fileName: ".domain-harness.json",
          content: formatIdentificationFile(applications.knownId, CHILD_ID),
        });
      }
      expect(applications.calls).toEqual([
        ["file", "Buyer", applications.knownId],
        ["file", "Builder", applications.knownId],
      ]);
    });

    it("maps an unknown or malformed id to 404 application_not_found, subject applicationId", async () => {
      for (const id of [mintUuidV7(), "nope", "a b"]) {
        const response = await fetch(`${base}${path(id)}`, { headers: buyerAuth });
        expect(response.status).toBe(404);
        expect(await response.json()).toMatchObject({ code: "application_not_found", subject: "applicationId" });
      }
    });

    it("answers 401 session_invalid without a bearer token and calls no service", async () => {
      await expectEnvelope(await fetch(`${base}${path(applications.knownId)}`), 401, "session_invalid");
      expect(applications.calls).toEqual([]);
    });

    it("answers 405 with Allow for any method but GET and logs the route by its pattern", async () => {
      for (const method of ["POST", "PUT", "DELETE"]) {
        const response = await fetch(`${base}${path(applications.knownId)}`, { method, headers: buyerAuth });
        expect(response.headers.get("allow")).toBe("GET");
        await expectEnvelope(response, 405, "method_not_allowed");
      }
      expect(applications.calls).toEqual([]);
      await expect
        .poll(() => events.filter((e) => e["event"] === "http_request").map((e) => e["route"]))
        .toEqual(Array(3).fill("/v1/applications/{id}/identification-file"));
      expect(JSON.stringify(events)).not.toContain(applications.knownId);
    });
  });

  describe("Company Guidance endpoint", () => {
    const buyerAuth = { authorization: `Bearer ${GOOD_SESSION}` };
    const builderAuth = { authorization: `Bearer ${BUILDER_SESSION}` };

    it("serves the state to every role", async () => {
      for (const headers of [buyerAuth, builderAuth]) {
        const response = await fetch(`${base}${GUIDANCE_ENDPOINT_PATH}`, { headers });
        expect(response.status).toBe(200);
        const body: unknown = await response.json();
        expect(isGuidanceEndpointState(body)).toBe(true);
        expect(body).toEqual({ url: null, changedAt: null });
      }
    });

    it("lets the Buyer set it: 200 with the trimmed URL", async () => {
      const response = await post(GUIDANCE_ENDPOINT_PATH, { url: " https://g.acme.example/v1 " }, { headers: { ...buyerAuth, "content-type": "application/json" } });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ url: "https://g.acme.example/v1", changedAt: "2026-10-13T09:00:00.000Z" });
    });

    it("refuses a non-Buyer with 403 role_denied before the body is read", async () => {
      const response = await post(GUIDANCE_ENDPOINT_PATH, "{not json", {
        headers: { ...builderAuth, "content-type": "application/json" },
      });
      await expectEnvelope(response, 403, "role_denied");
      expect(guidanceEndpoint.calls).toEqual([]);
    });

    it.each([
      ["http", { url: "http://g.example" }, "url"],
      ["an extra key", { url: "https://g.example", x: 1 }, "x"],
    ])("answers 400 invalid_input for %s", async (_label, body, subject) => {
      const response = await post(GUIDANCE_ENDPOINT_PATH, body, {
        headers: { ...buyerAuth, "content-type": "application/json" },
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "invalid_input", subject });
    });

    it("answers 401 without a session and 405 for other methods", async () => {
      await expectEnvelope(await fetch(`${base}${GUIDANCE_ENDPOINT_PATH}`), 401, "session_invalid");
      const response = await fetch(`${base}${GUIDANCE_ENDPOINT_PATH}`, { method: "PUT", headers: buyerAuth });
      expect(response.headers.get("allow")).toBe("GET, POST");
      await expectEnvelope(response, 405, "method_not_allowed");
      expect(guidanceEndpoint.calls).toEqual([]);
    });

    describe("Accepted deviations", () => {
      const path = ACCEPTED_DEVIATION_API_PATHS.acceptedDeviations;
      const buyerAuth = { authorization: `Bearer ${GOOD_SESSION}`, "content-type": "application/json" };
      const builderAuth = { authorization: `Bearer ${BUILDER_SESSION}`, "content-type": "application/json" };
      const body = {
        applicationId: mintUuidV7(),
        standardId: mintUuidV7(),
        slot: { moduleKind: "code-stack", slotKind: "library", name: "Lodash" },
        subject: "lodash",
        start: "2026-10-01T00:00:00.000Z",
        end: "2026-11-01T00:00:00.000Z",
        justification: "known exception",
        alertIntervalHours: 168,
      };

      it("serves GET to two roles after the plan check, refusing a Community tenant", async () => {
        acceptedDeviations.planRefused = true;
        await expectEnvelope(
          await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${GOOD_SESSION}` } }),
          403,
          "plan_refused",
        );
        await expectEnvelope(
          await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${BUILDER_SESSION}` } }),
          403,
          "plan_refused",
        );
        acceptedDeviations.planRefused = false;
        acceptedDeviations.calls = [];
        const builderResponse = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${BUILDER_SESSION}` } });
        expect(builderResponse.status).toBe(200);
        expect(await builderResponse.json()).toEqual({ records: [] });
        expect(acceptedDeviations.calls.map((call: unknown) => [(call as unknown[])[0], (call as unknown[])[1]])).toEqual([
          ["list", "Builder"],
        ]);
      });

      it("answers 201 with the stored record for the Buyer", async () => {
        const response = await post(path, body, { headers: buyerAuth });
        expect(response.status).toBe(201);
        const record: unknown = await response.json();
        expect(isAcceptedDeviationRecord(record)).toBe(true);
        expect(record).toMatchObject({
          standardId: body["standardId"],
          subject: "lodash",
          buyer: { accountId: session["accountId"] },
          justification: "known exception",
          alertIntervalHours: 168,
        });
      });

      it("refuses a non-Buyer's POST with 403 role_denied before the body is read", async () => {
        const response = await post(path, "{not json", { headers: builderAuth });
        await expectEnvelope(response, 403, "role_denied");
        // The body was drained, never read, and the service was never called.
        expect(acceptedDeviations.calls).toEqual([]);
      });

      it.each([
        ["a bad interval", { ...body, alertIntervalHours: 0 }, "alertIntervalHours"],
        ["an extra key", { ...body, extra: 1 }, "extra"],
        ["a non-ISO start", { ...body, start: "2026-10-01" }, "start"],
      ])("answers 400 invalid_input for %s", async (_label, invalid, subject) => {
        const response = await post(path, invalid, { headers: buyerAuth });
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ code: "invalid_input", subject });
      });

      it("answers 401 without a session and 405 for other methods", async () => {
        await expectEnvelope(await fetch(`${base}${path}`), 401, "session_invalid");
        const response = await fetch(`${base}${path}`, {
          method: "PUT",
          headers: { authorization: `Bearer ${GOOD_SESSION}` },
        });
        expect(response.headers.get("allow")).toBe("GET, POST");
        await expectEnvelope(response, 405, "method_not_allowed");
        expect(acceptedDeviations.calls).toEqual([]);
      });
    });

    describe("Accepted-deviation alerts", () => {
      const alertsPath = ACCEPTED_DEVIATION_ALERT_API_PATHS.alerts;
      const dismissPath = acceptedDeviationAlertDismissalPath;
      const buyerAuth = { authorization: `Bearer ${GOOD_SESSION}`, "content-type": "application/json" };
      const builderAuth = { authorization: `Bearer ${BUILDER_SESSION}` };

      it("serves the live list to every role as the guarded { alerts } envelope", async () => {
        for (const headers of [buyerAuth, builderAuth]) {
          const response = await fetch(`${base}${alertsPath}`, { headers });
          expect(response.status).toBe(200);
          const body: unknown = await response.json();
          expect(isAcceptedDeviationAlerts(body)).toBe(true);
          expect(body).toEqual({ alerts: [] });
        }
        expect(acceptedDeviationAlerts.calls).toEqual([
          ["list", "Buyer"],
          ["list", "Builder"],
        ]);
      });

      it("answers the Buyer's dismissal with 200 { dismissed: true }, again on a repeat", async () => {
        const id = mintUuidV7();
        acceptedDeviationAlerts.raised = [id];
        for (let i = 0; i < 2; i += 1) {
          const response = await post(dismissPath(id), { alertId: id }, { headers: buyerAuth });
          expect(response.status).toBe(200);
          const body: unknown = await response.json();
          expect(isAlertDismissedResult(body)).toBe(true);
          expect(body).toEqual({ dismissed: true });
        }
        expect(acceptedDeviationAlerts.calls.map((call: unknown) => (call as unknown[])[0])).toEqual([
          "dismiss",
          "dismiss",
        ]);
      });

      it("refuses a non-Buyer's dismissal with 403 role_denied before the body is read", async () => {
        const response = await post(dismissPath(mintUuidV7()), "{not json", { headers: builderAuth });
        await expectEnvelope(response, 403, "role_denied");
        expect(acceptedDeviationAlerts.calls).toEqual([]);
      });

      it("answers 404 for a dismissal of an unknown or foreign alert", async () => {
        const raised = mintUuidV7();
        const unknown = mintUuidV7();
        acceptedDeviationAlerts.raised = [raised];
        const response = await post(dismissPath(unknown), { alertId: unknown }, { headers: buyerAuth });
        expect(response.status).toBe(404);
        expect(await response.json()).toMatchObject({ code: "not_found", subject: "alertId" });
      });

      it("answers 400 for a body that is not exactly a known { alertId }", async () => {
        const id = mintUuidV7();
        acceptedDeviationAlerts.raised = [id];
        for (const invalid of [{}, { other: id }, { alertId: "nope" }, { alertId: id, extra: 1 }]) {
          const response = await post(dismissPath(id), invalid, { headers: buyerAuth });
          expect(response.status).toBe(400);
          expect(await response.json()).toMatchObject({ code: "invalid_input", subject: "alertId" });
        }
        expect(acceptedDeviationAlerts.calls.length).toBe(4);
        // Malformed JSON is the body's failure too, reported under the alert
        // id's own name — not the generic `body` subject.
        const malformed = await post(dismissPath(id), "{not json", { headers: buyerAuth });
        expect(malformed.status).toBe(400);
        expect(await malformed.json()).toMatchObject({ code: "invalid_input", subject: "alertId" });
        expect(acceptedDeviationAlerts.calls.length).toBe(4);
      });

      it("answers 401 without a session and 405 for a method other than GET/POST", async () => {
        await expectEnvelope(await fetch(`${base}${alertsPath}`), 401, "session_invalid");
        const response = await fetch(`${base}${alertsPath}`, { method: "POST", headers: buyerAuth });
        expect(response.headers.get("allow")).toBe("GET");
        await expectEnvelope(response, 405, "method_not_allowed");
        expect(acceptedDeviationAlerts.calls).toEqual([]);
        const genericPost = await fetch(`${base}/v1/accepted-deviation-alerts/x/dismissal`, { method: "GET" });
        await expectEnvelope(genericPost, 405, "method_not_allowed");
      });
    });
  });

  describe("Boilerplate", () => {
    const buyerAuth = { authorization: `Bearer ${GOOD_SESSION}`, "content-type": "application/json" };
    const builderAuth = { authorization: `Bearer ${BUILDER_SESSION}`, "content-type": "application/json" };
    const path = applicationBoilerplatePath;

    it("answers 409 guidance_endpoint_unset when no endpoint is set", async () => {
      const response = await post(path(applications.knownId), { target: "claude-code" }, { headers: builderAuth });
      await expectEnvelope(response, 409, "guidance_endpoint_unset");
    });

    it("serves the result to every role and logs ids, target and file count only", async () => {
      guidanceEndpoint.state = { url: "https://g.acme.example/v1", changedAt: "2026-10-13T09:00:00.000Z" };
      for (const headers of [buyerAuth, builderAuth]) {
        const response = await post(path(applications.knownId), { target: "claude-code" }, { headers });
        expect(response.status).toBe(200);
        expect(isBoilerplateResult(await response.json())).toBe(true);
      }
      expect(boilerplate.calls).toEqual([
        ["generate", "Buyer", applications.knownId, { target: "claude-code" }],
        ["generate", "Builder", applications.knownId, { target: "claude-code" }],
      ]);
      const logged = events.filter((e) => e["event"] === "boilerplate_generated");
      expect(logged).toEqual(
        Array(2).fill({ event: "boilerplate_generated", applicationId: applications.knownId, target: "claude-code", files: 2 }),
      );
      expect(JSON.stringify(events)).not.toContain("g.acme.example");
    });

    it("answers 400 subject target for an unknown target and 404 for an unknown or malformed Application", async () => {
      guidanceEndpoint.state = { url: "https://g.acme.example/v1", changedAt: "2026-10-13T09:00:00.000Z" };
      const bad = await post(path(applications.knownId), { target: "windsurf" }, { headers: buyerAuth });
      expect(bad.status).toBe(400);
      expect(await bad.json()).toMatchObject({ code: "invalid_input", subject: "target" });
      for (const id of [mintUuidV7(), "nope"]) {
        const response = await post(path(id), { target: "claude-code" }, { headers: buyerAuth });
        expect(response.status).toBe(404);
        expect(await response.json()).toMatchObject({ code: "application_not_found", subject: "applicationId" });
      }
    });

    it("answers 401 without a session and 405 for any method but POST", async () => {
      await expectEnvelope(await post(path(applications.knownId), { target: "claude-code" }), 401, "session_invalid");
      for (const method of ["GET", "PUT"]) {
        const response = await fetch(`${base}${path(applications.knownId)}`, {
          method,
          headers: { authorization: `Bearer ${GOOD_SESSION}` },
        });
        expect(response.headers.get("allow")).toBe("POST");
        await expectEnvelope(response, 405, "method_not_allowed");
      }
      expect(boilerplate.calls).toEqual([]);
      await expect
        .poll(() => events.filter((e) => e["event"] === "http_request").map((e) => e["route"]))
        .toEqual(Array(3).fill("/v1/applications/{id}/boilerplate"));
    });
  });

  describe("routing", () => {
    it("answers 404 not_found for an unknown path", async () => {
      await expectEnvelope(await fetch(`${base}/v1/nope`), 404, "not_found");
    });

    it("answers 404 for an unparseable request target without crashing", async () => {
      const { request } = await import("node:http");
      const status = await new Promise<number>((resolve, reject) => {
        const req = request({ host: "127.0.0.1", port: new URL(base).port, path: "http://[", method: "GET" }, (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        });
        req.on("error", reject);
        req.end();
      });
      expect(status).toBe(404);
      expect((await fetch(`${base}/v1/nope`)).status).toBe(404);
    });

    it("answers 405 method_not_allowed with Allow for a wrong method", async () => {
      const response = await fetch(`${base}/v1/sign-in-links`);
      expect(response.headers.get("allow")).toBe("POST");
      await expectEnvelope(response, 405, "method_not_allowed");
      await expectEnvelope(await post("/v1/session", {}), 405, "method_not_allowed");
    });

    it("logs the route and status of every request without query strings", async () => {
      await fetch(`${base}/v1/session?token=secret`, { headers: { authorization: `Bearer ${GOOD_SESSION}` } });
      await expect.poll(() => events.find((e) => e["event"] === "http_request")).toMatchObject({
        method: "GET",
        route: "/v1/session",
        status: 200,
      });
      expect(JSON.stringify(events)).not.toContain("secret");
    });
  });
});
