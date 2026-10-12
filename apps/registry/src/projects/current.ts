import { desc, eq } from "drizzle-orm";
import type { UuidV7 } from "@domain-harness/contract";
import type { TreeNode } from "@domain-harness/core";
import type { RegistryTx } from "../db/client.ts";
import { projectParentChanges, projects } from "../db/schema.ts";

export type ProjectRow = typeof projects.$inferSelect;

/** One Project row with its current parent (the latest change row's parent; the root's stays NULL). */
export interface CurrentProject {
  readonly row: ProjectRow;
  readonly parentId: string | null;
}

/**
 * Every Project of the tenant with its current parent, by id. The current
 * parent of a non-root Project is the `parent_id` of its highest-sequence
 * change row (DISTINCT ON keeps the first row per Project, ordered by
 * sequence descending), overlaid on `projects`.
 */
export async function currentProjects(tx: RegistryTx, tenantId: UuidV7): Promise<Map<string, CurrentProject>> {
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

/** The current tree as core sees it. */
export const treeNodes = (current: ReadonlyMap<string, CurrentProject>): TreeNode[] =>
  [...current.values()].map((project) => ({ id: project.row.id, parentId: project.parentId }));
