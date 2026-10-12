import { desc, eq, max } from "drizzle-orm";
import {
  entrySlotKind,
  entrySlotName,
  isUuidV7,
  PROJECT_NOT_FOUND,
  ROLE_DENIED,
  ROOT_PROJECT_FIXED,
} from "@domain-harness/contract";
import type {
  EffectiveStandard,
  EffectiveStandardSet,
  ProjectInfo,
  ProjectTree,
  SessionInfo,
  UuidV7,
} from "@domain-harness/contract";
import { resolveEffectiveSet, validateBundleInput } from "@domain-harness/core";
import type { ParentChange, SlotHolder, TreeNode } from "@domain-harness/core";
import { EnvelopeError } from "../errors.ts";
import { mintUuidV7 } from "../ids.ts";
import type { RegistryDb, RegistryTx } from "../db/client.ts";
import { projectParentChanges, projects } from "../db/schema.ts";
import { withTenant } from "../db/tenant-scope.ts";
import { toId } from "../modules/service.ts";
import { liveSet, liveStandardInfos, lockBundle } from "../standards/service.ts";
import { validateCreateBody, validateParentBody } from "./validate.ts";

type ProjectRow = typeof projects.$inferSelect;

/** One Project row with its current parent (the latest change row's parent; the root's stays NULL). */
interface CurrentProject {
  readonly row: ProjectRow;
  readonly parentId: string | null;
}

const projectNotFound = (subject: "projectId" | "parentId"): EnvelopeError =>
  new EnvelopeError({
    code: PROJECT_NOT_FOUND,
    message:
      subject === "projectId"
        ? "no such Project in this Company; nothing was changed"
        : "the parent must be a Project of this Company; nothing was changed",
    subject,
  });

/** Throw `role_denied` unless the session is the Buyer's: only the Buyer changes the Project tree. */
export function assertTreeBuyer(session: SessionInfo): void {
  if (session.role !== "Buyer") {
    throw new EnvelopeError({
      code: ROLE_DENIED,
      message: "only the Buyer can change the Project tree; nothing was changed",
      subject: "role",
    });
  }
}

/**
 * Every Project of the tenant with its current parent, by id. The current
 * parent of a non-root Project is the `parent_id` of its highest-sequence
 * change row (DISTINCT ON keeps the first row per Project, ordered by
 * sequence descending), overlaid on `projects`.
 */
async function currentProjects(tx: RegistryTx, tenantId: UuidV7): Promise<Map<string, CurrentProject>> {
  const rows = await tx.select().from(projects).where(eq(projects.tenantId, tenantId));
  const latest = await tx
    .selectDistinctOn([projectParentChanges.projectId], {
      projectId: projectParentChanges.projectId,
      parentId: projectParentChanges.parentId,
    })
    .from(projectParentChanges)
    .where(eq(projectParentChanges.tenantId, tenantId))
    .orderBy(projectParentChanges.projectId, desc(projectParentChanges.sequence));
  const parents = new Map(latest.map((row) => [row.projectId, row.parentId]));
  return new Map(
    rows.map((row) => [
      row.id,
      { row, parentId: row.parentId === null ? null : (parents.get(row.id) ?? row.parentId) },
    ]),
  );
}

function toProjectInfo(project: CurrentProject): ProjectInfo {
  return {
    id: toId(project.row.id),
    name: project.row.name,
    levelName: project.row.levelName,
    parentId: project.parentId === null ? null : toId(project.parentId),
    createdAt: project.row.createdAt.toISOString(),
  };
}

const byCreation = (a: CurrentProject, b: CurrentProject): number =>
  a.row.createdAt.getTime() - b.row.createdAt.getTime() || (a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0);

/** The tree in depth-first order from the root, each Project's children by creation time, then id. */
function toTree(current: ReadonlyMap<string, CurrentProject>): ProjectTree {
  const children = new Map<string, CurrentProject[]>();
  let root: CurrentProject | undefined;
  for (const project of current.values()) {
    if (project.parentId === null) {
      root = project;
      continue;
    }
    const siblings = children.get(project.parentId) ?? [];
    siblings.push(project);
    children.set(project.parentId, siblings);
  }
  if (root === undefined) throw new Error("the tenant has no root Project");
  const ordered: ProjectInfo[] = [];
  const visit = (project: CurrentProject): void => {
    ordered.push(toProjectInfo(project));
    for (const child of (children.get(project.row.id) ?? []).sort(byCreation)) visit(child);
  };
  visit(root);
  return { rootId: toId(root.row.id), projects: ordered };
}

const treeNodes = (current: ReadonlyMap<string, CurrentProject>): TreeNode[] =>
  [...current.values()].map((project) => ({ id: project.row.id, parentId: project.parentId }));

/**
 * Validate the whole proposed bundle input (the tree with `change` applied,
 * plus every live Standard at every scope) through core; throw its error.
 */
async function assertBundleValid(
  tx: RegistryTx,
  tenantId: UuidV7,
  nodes: readonly TreeNode[],
  change: ParentChange,
): Promise<void> {
  const verdict = validateBundleInput({ projects: nodes, standards: await liveSet(tx, tenantId), change });
  if (!verdict.ok) throw new EnvelopeError(verdict.error);
}

/** The next per-tenant change sequence: max + 1, read under the bundle lock. */
async function nextSequence(tx: RegistryTx, tenantId: UuidV7): Promise<number> {
  const [row] = await tx
    .select({ sequence: max(projectParentChanges.sequence) })
    .from(projectParentChanges)
    .where(eq(projectParentChanges.tenantId, tenantId));
  return (row?.sequence ?? 0) + 1;
}

/** The tenant's Project tree. Open to every role. */
export async function getTree(db: RegistryDb, session: SessionInfo): Promise<ProjectTree> {
  const { tenantId } = session;
  return withTenant(db, tenantId, async (tx) => toTree(await currentProjects(tx, tenantId)));
}

/** One Project of the tenant with its current parent. Open to every role; anything else is `project_not_found`. */
export async function getProject(db: RegistryDb, session: SessionInfo, projectId: unknown): Promise<ProjectInfo> {
  if (!isUuidV7(projectId)) throw projectNotFound("projectId");
  const { tenantId } = session;
  return withTenant(db, tenantId, async (tx) => {
    const project = (await currentProjects(tx, tenantId)).get(projectId);
    if (project === undefined) throw projectNotFound("projectId");
    return toProjectInfo(project);
  });
}

/**
 * The Effective Standard set of one Project, resolved by core. Open to every
 * role. Checks, first failure wins: the Project is the tenant's (404
 * `project_not_found`, subject `projectId`) → core resolution over the
 * current tree and the live Standards of every scope (its error as is, e.g.
 * 409 `slot_conflict`). Each entry of core's answer is joined to the
 * Standard's live `StandardInfo` and its source Project's name; the order
 * and membership are core's, never changed. No Locked rules are stored yet
 * (Story 2.4), so none are passed. Every read runs in one tenant transaction
 * under the tenant's bundle lock, so no publish or tree change commits between
 * the reads.
 */
export async function getEffectiveSet(
  db: RegistryDb,
  session: SessionInfo,
  projectId: unknown,
): Promise<EffectiveStandardSet> {
  if (!isUuidV7(projectId)) throw projectNotFound("projectId");
  const { tenantId } = session;
  return withTenant(db, tenantId, async (tx) => {
    // The bundle lock (as publishes and tree changes take it) keeps every
    // read below on one consistent state of the tree and the Standards.
    await lockBundle(tx, tenantId);
    const current = await currentProjects(tx, tenantId);
    const project = current.get(projectId);
    if (project === undefined) throw projectNotFound("projectId");
    // The live set of every scope and its served form come from one read, so
    // the slots core resolves and the Standards joined to them always agree.
    const infos = await liveStandardInfos(tx, tenantId);
    const standards: SlotHolder[] = [...infos.values()].map((info) => ({
      standardId: info.id,
      projectId: info.project.id,
      slot: { moduleKind: info.module.kind, slotKind: entrySlotKind(info.entry), name: entrySlotName(info.entry) },
    }));
    const resolved = resolveEffectiveSet({ projects: treeNodes(current), standards, lockedStandardIds: [], projectId });
    if (!resolved.ok) throw new EnvelopeError(resolved.error);

    return {
      project: { id: toId(project.row.id), name: project.row.name },
      standards: resolved.set.map((entry): EffectiveStandard => {
        const standard = infos.get(entry.standardId);
        const source = current.get(entry.sourceProjectId);
        if (standard === undefined || source === undefined) throw new Error("a resolved Standard is missing");
        return {
          slot: { moduleKind: entry.slot.moduleKind, slotKind: entry.slot.slotKind, name: entry.slot.name },
          status: "status" in standard.entry ? standard.entry.status : null,
          standard,
          sourceProject: { id: toId(source.row.id), name: source.row.name },
          locked: entry.locked,
        };
      }),
    };
  });
}

/**
 * Create a Project under a parent (Buyer only). Checks, first failure wins
 * and nothing is written: the role (403 `role_denied`) → the body (400
 * `invalid_input`) → the parent is a Project of the tenant (404
 * `project_not_found`, subject `parentId`) → core validation of the whole
 * proposed bundle input. Records the create as the Project's first parent
 * change. Runs under the tenant's bundle lock.
 */
export async function createProject(db: RegistryDb, session: SessionInfo, body: unknown): Promise<ProjectInfo> {
  assertTreeBuyer(session);
  const input = validateCreateBody(body);
  const { tenantId } = session;
  return withTenant(db, tenantId, async (tx) => {
    await lockBundle(tx, tenantId);
    const current = await currentProjects(tx, tenantId);
    if (!current.has(input.parentId)) throw projectNotFound("parentId");

    const id = mintUuidV7();
    const change = { projectId: id, parentId: input.parentId };
    await assertBundleValid(tx, tenantId, [...treeNodes(current), { id, parentId: input.parentId }], change);

    const [row] = await tx
      .insert(projects)
      .values({
        id,
        tenantId,
        parentId: input.parentId,
        name: input.name,
        levelName: input.levelName,
        createdBy: session.accountId,
      })
      .returning();
    if (row === undefined) throw new Error("insert returned no row");
    await tx.insert(projectParentChanges).values({
      id: mintUuidV7(),
      tenantId,
      projectId: id,
      sequence: await nextSequence(tx, tenantId),
      parentId: input.parentId,
      changedBy: session.accountId,
    });
    return toProjectInfo({ row, parentId: input.parentId });
  });
}

/**
 * Change a Project's parent (Buyer only) by appending a change row; earlier
 * rows are never changed. Checks, first failure wins and nothing is written:
 * the Project exists in the tenant (404, subject `projectId`) → the role
 * (403) → the body (400) → the parent exists in the tenant (404, subject
 * `parentId`) → the Project is not the root (409 `root_project_fixed`) →
 * core validation of the whole proposed bundle input (409 `project_cycle`
 * naming the parent that closes the cycle). Setting the current parent again
 * writes nothing. Runs under the tenant's bundle lock, so two concurrent
 * changes that together would form a cycle cannot both pass.
 */
export async function changeParent(
  db: RegistryDb,
  session: SessionInfo,
  projectId: unknown,
  body: unknown,
): Promise<ProjectInfo> {
  if (!isUuidV7(projectId)) throw projectNotFound("projectId");
  const { tenantId } = session;
  return withTenant(db, tenantId, async (tx) => {
    await lockBundle(tx, tenantId);
    const current = await currentProjects(tx, tenantId);
    const project = current.get(projectId);
    if (project === undefined) throw projectNotFound("projectId");
    assertTreeBuyer(session);
    const { parentId } = validateParentBody(body);
    if (!current.has(parentId)) throw projectNotFound("parentId");
    if (project.parentId === null) {
      throw new EnvelopeError({
        code: ROOT_PROJECT_FIXED,
        message: "the root Project's parent cannot be changed; nothing was changed",
        subject: "projectId",
      });
    }
    if (project.parentId === parentId) return toProjectInfo(project);

    await assertBundleValid(tx, tenantId, treeNodes(current), { projectId, parentId });
    await tx.insert(projectParentChanges).values({
      id: mintUuidV7(),
      tenantId,
      projectId,
      sequence: await nextSequence(tx, tenantId),
      parentId,
      changedBy: session.accountId,
    });
    return toProjectInfo({ row: project.row, parentId });
  });
}

/** The operations the HTTP API needs, bound to one database. */
export interface ProjectService {
  getTree(session: SessionInfo): Promise<ProjectTree>;
  getProject(session: SessionInfo, projectId: string): Promise<ProjectInfo>;
  getEffectiveSet(session: SessionInfo, projectId: string): Promise<EffectiveStandardSet>;
  createProject(session: SessionInfo, body: unknown): Promise<ProjectInfo>;
  changeParent(session: SessionInfo, projectId: string, body: unknown): Promise<ProjectInfo>;
}

export function createProjectService(db: RegistryDb): ProjectService {
  return {
    getTree: (session) => getTree(db, session),
    getProject: (session, projectId) => getProject(db, session, projectId),
    getEffectiveSet: (session, projectId) => getEffectiveSet(db, session, projectId),
    createProject: (session, body) => createProject(db, session, body),
    changeParent: (session, projectId, body) => changeParent(db, session, projectId, body),
  };
}
