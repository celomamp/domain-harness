import { eq, max } from "drizzle-orm";
import {
  CHILD_PERMISSION_DENIED,
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
  LockedRuleMark,
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
import { hasChildPermission } from "../child-permissions/current.ts";
import { assertTreePlan } from "../tenancy/plan.ts";
import { currentLockedIds, currentLockedMarks } from "../locked-rules/current.ts";
import type { LockedRuleRow } from "../locked-rules/current.ts";
import { accountNames, accountRef, toId } from "../modules/service.ts";
import { liveSet, liveStandardInfos, lockBundle } from "../standards/service.ts";
import { currentProjects, treeNodes } from "./current.ts";
import type { CurrentProject } from "./current.ts";
import { validateCreateBody, validateParentBody } from "./validate.ts";

/** `project_not_found` for a Project id (subject `projectId`) or a parent id (subject `parentId`). */
export const projectNotFound = (subject: "projectId" | "parentId"): EnvelopeError =>
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

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The current Locked rules as the tree shows them, ordered by Project id, then Standard id. */
function toLockedRuleMarks(rows: readonly LockedRuleRow[], names: ReadonlyMap<string, string>): LockedRuleMark[] {
  return [...rows]
    .sort((a, b) => compare(a.projectId, b.projectId) || compare(a.standardId, b.standardId))
    .map((row) => ({
      standardId: toId(row.standardId),
      projectId: toId(row.projectId),
      markedAt: row.changedAt.toISOString(),
      markedBy: accountRef(row.changedBy, names),
    }));
}

/**
 * The tree in depth-first order from the root, each Project's children by
 * creation time, then id, with the current Locked rules.
 */
function toTree(current: ReadonlyMap<string, CurrentProject>, lockedRules: readonly LockedRuleMark[]): ProjectTree {
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
  return { rootId: toId(root.row.id), projects: ordered, lockedRules: [...lockedRules] };
}

/**
 * Validate the whole proposed bundle input (the tree with `change` applied,
 * every live Standard at every scope and the current Locked rules) through
 * core; throw its error.
 */
async function assertBundleValid(
  tx: RegistryTx,
  tenantId: UuidV7,
  nodes: readonly TreeNode[],
  change: ParentChange,
): Promise<void> {
  const verdict = validateBundleInput({
    projects: nodes,
    standards: await liveSet(tx, tenantId),
    lockedStandardIds: await currentLockedIds(tx, tenantId),
    change,
  });
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

/** The tenant's Project tree with its current Locked rules. Open to every role. */
export async function getTree(db: RegistryDb, session: SessionInfo): Promise<ProjectTree> {
  const { tenantId } = session;
  return withTenant(db, tenantId, async (tx) => {
    // The bundle lock keeps the tree and the marks on one consistent state, so
    // every mark's Project is in the tree.
    await lockBundle(tx, tenantId);
    const current = await currentProjects(tx, tenantId);
    const marks = await currentLockedMarks(tx, tenantId);
    return toTree(current, toLockedRuleMarks(marks, await accountNames(tx, tenantId)));
  });
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
 * and membership are core's, never changed. The current Locked rules are
 * passed to core, so an ancestor's Locked rule is never replaced. Every read runs in one tenant transaction
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
    const resolved = resolveEffectiveSet({
      projects: treeNodes(current),
      standards,
      lockedStandardIds: await currentLockedIds(tx, tenantId),
      projectId,
    });
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
 * Create a Project under a parent. The Buyer may create anywhere; any other
 * account only directly under a Project on which it holds a current
 * child-Project permission (a grant is never inherited down the tree).
 * Checks, first failure wins and nothing is written: the tenant's plan
 * includes creating Projects (403 `plan_refused`, subject `plan`) → the body
 * (400 `invalid_input`) → the parent is a Project of the tenant (404
 * `project_not_found`, subject `parentId`) → the caller is the Buyer or holds
 * a current grant on the parent (403 `child_permission_denied`, subject
 * `parentId`) → core validation of the whole proposed bundle input. Records
 * the create as the Project's first parent change, made by the caller. Runs
 * under the tenant's bundle lock, so a revoke that commits first wins.
 */
export async function createProject(db: RegistryDb, session: SessionInfo, body: unknown): Promise<ProjectInfo> {
  const { tenantId } = session;
  return withTenant(db, tenantId, async (tx) => {
    await lockBundle(tx, tenantId);
    // The capability may not exist on this plan at all, so the plan comes
    // before the body: field errors would invite a fix that can never succeed.
    await assertTreePlan(tx, tenantId, "create");
    const input = validateCreateBody(body);
    const current = await currentProjects(tx, tenantId);
    if (!current.has(input.parentId)) throw projectNotFound("parentId");
    if (session.role !== "Buyer" && !(await hasChildPermission(tx, tenantId, input.parentId, session.accountId))) {
      throw new EnvelopeError({
        code: CHILD_PERMISSION_DENIED,
        message: "you have no permission to create a child Project under this Project; nothing was created",
        subject: "parentId",
      });
    }

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
 * (403) → the tenant's plan includes setting a parent (403 `plan_refused`,
 * subject `plan`) → the body (400) → the parent exists in the tenant (404, subject
 * `parentId`) → the Project is not the root (409 `root_project_fixed`) →
 * core validation of the whole proposed bundle input (409 `project_cycle`
 * naming the parent that closes the cycle, or 409 `locked_rule_conflict`
 * when the move puts a Locked rule under a contradicting ancestor one). Setting the current parent again
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
    await assertTreePlan(tx, tenantId, "parent");
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
