import { and, asc, eq, max } from "drizzle-orm";
import {
  APPLICATION_NOT_FOUND,
  BUILD_GRANT_DENIED,
  ROLE_DENIED,
  formatIdentificationFile,
  IDENTIFICATION_FILE_NAME,
  isUuidV7,
} from "@domain-harness/contract";
import type {
  ApplicationInfo,
  ApplicationList,
  BoilerplateTarget,
  IdentificationFileRendering,
  SessionInfo,
  UuidV7,
} from "@domain-harness/contract";
import { validateBundleInput } from "@domain-harness/core";
import type { ApplicationNode } from "@domain-harness/core";
import { EnvelopeError } from "../errors.ts";
import { mintUuidV7 } from "../ids.ts";
import type { RegistryDb, RegistryTx } from "../db/client.ts";
import { applications } from "../db/schema.ts";
import { withTenant } from "../db/tenant-scope.ts";
import { currentAgentTools } from "./agent-tool.ts";
import { hasBuildGrant } from "../build-grants/current.ts";
import { currentLockedIds } from "../locked-rules/current.ts";
import { toId } from "../modules/service.ts";
import { currentProjects, treeNodes } from "../projects/current.ts";
import type { CurrentProject } from "../projects/current.ts";
import { projectNotFound } from "../projects/service.ts";
import { liveSet, lockBundle } from "../standards/service.ts";
import { validateApplicationBody } from "./validate.ts";

type ApplicationRow = typeof applications.$inferSelect;

/** Every Application row of the tenant, ordered by creation time, then id. */
async function applicationRows(tx: RegistryTx, tenantId: UuidV7): Promise<ApplicationRow[]> {
  return tx
    .select()
    .from(applications)
    .where(eq(applications.tenantId, tenantId))
    .orderBy(asc(applications.createdAt), asc(applications.id));
}

function toInfo(
  row: ApplicationRow,
  current: ReadonlyMap<string, CurrentProject>,
  agentTools: ReadonlyMap<string, BoilerplateTarget>,
): ApplicationInfo {
  const project = current.get(row.projectId);
  if (project === undefined) throw new Error("an Application's Project is missing");
  return {
    id: toId(row.id),
    description: row.description,
    project: { id: toId(project.row.id), name: project.row.name },
    fromFlow: row.fromFlow,
    agentTool: agentTools.get(row.id) ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** The Applications as core's bundle input sees them. */
const applicationNodes = (rows: readonly ApplicationRow[]): ApplicationNode[] =>
  rows.map((row) => ({ id: row.id, projectId: row.projectId }));

/** The next per-tenant Application sequence (the Application-list version): max + 1, read under the bundle lock. */
async function nextSequence(tx: RegistryTx, tenantId: UuidV7): Promise<number> {
  const [row] = await tx
    .select({ sequence: max(applications.sequence) })
    .from(applications)
    .where(eq(applications.tenantId, tenantId));
  return (row?.sequence ?? 0) + 1;
}

/**
 * Every Application of the tenant, ordered by `createdAt`, then id. Open to
 * every role; read under the bundle lock so every Application's Project is
 * in the tree read alongside it, and its agent tool (its latest successful
 * generation's target, `null` when none) comes from the same lock. Never
 * names who created an Application.
 */
export async function listApplications(db: RegistryDb, session: SessionInfo): Promise<ApplicationList> {
  const { tenantId } = session;
  return withTenant(db, tenantId, async (tx) => {
    await lockBundle(tx, tenantId);
    const current = await currentProjects(tx, tenantId);
    const agentTools = await currentAgentTools(tx, tenantId);
    const rows = await applicationRows(tx, tenantId);
    return { applications: rows.map((row) => toInfo(row, current, agentTools)) };
  });
}

/**
 * Place a new Application on one Project through the New-application flow.
 * The Buyer may place one on any Project; any other account only on a
 * Project on which it holds a current build grant (never inherited, and
 * separate from the child-Project permission). Checks run under the tenant's
 * bundle lock, first failure wins and nothing is written: the body (400
 * `invalid_input`, subject `body`, the extra key, `description` or
 * `projectId`) → the Project is the tenant's (404 `project_not_found`,
 * subject `projectId`) → the caller is the Buyer or holds a current build
 * grant on it (403 `build_grant_denied`, subject `projectId`) → core
 * validation of the whole proposed bundle input with every Application plus
 * the new one. The registry mints the id; the Application is flagged as
 * created by the New-application flow and records the caller as its creator.
 */
export async function createApplication(db: RegistryDb, session: SessionInfo, body: unknown): Promise<ApplicationInfo> {
  const { tenantId } = session;
  return withTenant(db, tenantId, async (tx) => {
    await lockBundle(tx, tenantId);
    const input = validateApplicationBody(body);
    const current = await currentProjects(tx, tenantId);
    if (!isUuidV7(input.projectId) || !current.has(input.projectId)) throw projectNotFound("projectId");
    const { projectId } = input;
    if (session.role !== "Buyer" && !(await hasBuildGrant(tx, tenantId, projectId, session.accountId))) {
      throw new EnvelopeError({
        code: BUILD_GRANT_DENIED,
        message: "you have no build grant on this Project; nothing was created",
        subject: "projectId",
      });
    }

    const row = await insertApplication(tx, tenantId, current, {
      projectId,
      description: input.description,
      fromFlow: true,
      createdBy: session.accountId,
    });
    // No Boilerplate was generated for a just-placed Application yet.
    return toInfo(row, current, new Map());
  });
}

/**
 * The mint/validate/insert tail both create paths share, run under the
 * tenant's bundle lock: the registry mints the id, core validates the whole
 * proposed bundle input with every live Application plus the new one, and the
 * row is inserted with the given `fromFlow` and creator. The caller has
 * already validated the body and the Project and holds whatever grant it
 * needs; first failure inside here wins and nothing is written.
 */
async function insertApplication(
  tx: RegistryTx,
  tenantId: UuidV7,
  current: ReadonlyMap<string, CurrentProject>,
  proposed: { readonly projectId: UuidV7; readonly description: string; readonly fromFlow: boolean; readonly createdBy: UuidV7 },
): Promise<ApplicationRow> {
  const id = mintUuidV7();
  const verdict = validateBundleInput({
    projects: treeNodes(current),
    standards: await liveSet(tx, tenantId),
    lockedStandardIds: await currentLockedIds(tx, tenantId),
    applications: [...applicationNodes(await applicationRows(tx, tenantId)), { id, projectId: proposed.projectId }],
  });
  if (!verdict.ok) throw new EnvelopeError(verdict.error);

  const [row] = await tx
    .insert(applications)
    .values({
      id,
      tenantId,
      projectId: proposed.projectId,
      description: proposed.description,
      fromFlow: proposed.fromFlow,
      sequence: await nextSequence(tx, tenantId),
      createdBy: proposed.createdBy,
    })
    .returning();
  if (row === undefined) throw new Error("insert returned no row");
  return row;
}

/** Throw `role_denied` unless the session is the Buyer's: only the Buyer registers an existing Application. */
export function assertApplicationBuyer(session: SessionInfo): void {
  if (session.role !== "Buyer") {
    throw new EnvelopeError({
      code: ROLE_DENIED,
      message: "only the Buyer can register an existing Application; nothing was created",
      subject: "role",
    });
  }
}

/**
 * Register an Application that already exists in the Company's repositories
 * (Buyer only): it is created from the same body as a placement, flagged as
 * not created by the New-application flow, and the answer is only its Project
 * identification file to commit — no Boilerplate, no archive. First failure
 * wins and nothing is written: the role (403 `role_denied`, subject `role`)
 * → the body (400 `invalid_input`, subject `body`, the extra key,
 * `description` or `projectId`) → the Project is the tenant's (404
 * `project_not_found`, subject `projectId`) → core validation of the whole
 * proposed bundle input with every Application plus the new one. Runs under
 * the tenant's bundle lock.
 */
export async function registerApplication(
  db: RegistryDb,
  session: SessionInfo,
  body: unknown,
): Promise<IdentificationFileRendering> {
  assertApplicationBuyer(session);
  const { tenantId } = session;
  return withTenant(db, tenantId, async (tx) => {
    await lockBundle(tx, tenantId);
    const input = validateApplicationBody(body);
    const current = await currentProjects(tx, tenantId);
    if (!isUuidV7(input.projectId) || !current.has(input.projectId)) throw projectNotFound("projectId");
    const row = await insertApplication(tx, tenantId, current, {
      projectId: input.projectId,
      description: input.description,
      fromFlow: false,
      createdBy: session.accountId,
    });
    return { fileName: IDENTIFICATION_FILE_NAME, content: formatIdentificationFile(toId(row.id), toId(row.projectId)) };
  });
}

export const applicationNotFound = (): EnvelopeError =>
  new EnvelopeError({
    code: APPLICATION_NOT_FOUND,
    message: "no such Application in this Company",
    subject: "applicationId",
  });

/**
 * The Project identification file of one Application, rendered through the
 * contract's only serializer with the Application's id and its current
 * Project (its stored `project_id`). Open to every role. A malformed, unknown
 * or other tenant's id is 404 `application_not_found`, subject
 * `applicationId`. One row read under the tenant (RLS) transaction.
 */
export async function getIdentificationFile(
  db: RegistryDb,
  session: SessionInfo,
  applicationId: unknown,
): Promise<IdentificationFileRendering> {
  if (!isUuidV7(applicationId)) throw applicationNotFound();
  const { tenantId } = session;
  return withTenant(db, tenantId, async (tx) => {
    const [row] = await tx
      .select({ id: applications.id, projectId: applications.projectId })
      .from(applications)
      .where(and(eq(applications.tenantId, tenantId), eq(applications.id, applicationId)));
    if (row === undefined) throw applicationNotFound();
    return { fileName: IDENTIFICATION_FILE_NAME, content: formatIdentificationFile(toId(row.id), toId(row.projectId)) };
  });
}

/** The operations the HTTP API needs, bound to one database. */
export interface ApplicationService {
  listApplications(session: SessionInfo): Promise<ApplicationList>;
  createApplication(session: SessionInfo, body: unknown): Promise<ApplicationInfo>;
  registerApplication(session: SessionInfo, body: unknown): Promise<IdentificationFileRendering>;
  getIdentificationFile(session: SessionInfo, applicationId: string): Promise<IdentificationFileRendering>;
}

export function createApplicationService(db: RegistryDb): ApplicationService {
  return {
    listApplications: (session) => listApplications(db, session),
    createApplication: (session, body) => createApplication(db, session, body),
    registerApplication: (session, body) => registerApplication(db, session, body),
    getIdentificationFile: (session, applicationId) => getIdentificationFile(db, session, applicationId),
  };
}
