import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import type {
  BundleApplication,
  LockedRuleMark,
  ProjectTree,
  StandardBundlePayload,
  StandardInfo,
  UuidV7,
} from "@domain-harness/contract";
import {
  BUNDLE_FORMAT_VERSION,
  BUNDLE_TYPE,
  DEFAULT_STALENESS_HOURS,
} from "@domain-harness/contract";
import type { BundleInput } from "@domain-harness/core";
import type { RegistryTx } from "../db/client.ts";
import { applications, bundleSettingChanges } from "../db/schema.ts";
import { currentLockedIds, currentLockedMarks } from "../locked-rules/current.ts";
import type { LockedRuleRow } from "../locked-rules/current.ts";
import { accountNames, accountRef, toId } from "../modules/service.ts";
import { currentProjects, treeNodes } from "../projects/current.ts";
import type { CurrentProject } from "../projects/current.ts";
import { liveSet, liveStandardInfos } from "../standards/service.ts";

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function depthFirst(current: ReadonlyMap<string, CurrentProject>): CurrentProject[] {
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
  const ordered: CurrentProject[] = [];
  const visit = (project: CurrentProject): void => {
    ordered.push(project);
    for (const child of (children.get(project.row.id) ?? []).sort((a, b) =>
      a.row.createdAt.getTime() - b.row.createdAt.getTime() || compare(a.row.id, b.row.id),
    )) {
      visit(child);
    }
  };
  visit(root);
  return ordered;
}

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

export async function currentStalenessHours(tx: RegistryTx, tenantId: UuidV7): Promise<number> {
  const [row] = await tx
    .select({ value: bundleSettingChanges.stalenessHours })
    .from(bundleSettingChanges)
    .where(and(eq(bundleSettingChanges.tenantId, tenantId), isNotNull(bundleSettingChanges.stalenessHours)))
    .orderBy(desc(bundleSettingChanges.sequence))
    .limit(1);
  return row?.value ?? DEFAULT_STALENESS_HOURS;
}

export async function currentFrozen(tx: RegistryTx, tenantId: UuidV7): Promise<boolean> {
  const [row] = await tx
    .select({ value: bundleSettingChanges.frozen })
    .from(bundleSettingChanges)
    .where(and(eq(bundleSettingChanges.tenantId, tenantId), isNotNull(bundleSettingChanges.frozen)))
    .orderBy(desc(bundleSettingChanges.sequence))
    .limit(1);
  return row?.value ?? false;
}

export interface CompiledBundle {
  readonly payload: StandardBundlePayload;
  readonly input: BundleInput;
}

export async function compileBundle(
  tx: RegistryTx,
  tenantId: UuidV7,
  sequence: number,
  keyId: string,
  issuedAt: string = new Date().toISOString(),
): Promise<CompiledBundle> {
  const current = await currentProjects(tx, tenantId);
  const names = await accountNames(tx, tenantId);

  const infos = await liveStandardInfos(tx, tenantId);
  const standardsArray: StandardInfo[] = [...infos.values()].sort((a, b) => compare(a.id, b.id));

  const orderedProjects = depthFirst(current);

  const marks = await currentLockedMarks(tx, tenantId);
  const lockedRules = toLockedRuleMarks(marks, names);

  const root = [...current.values()].find((p) => p.parentId === null);
  if (root === undefined) throw new Error("the tenant has no root Project");

  const projectTree: ProjectTree = {
    rootId: toId(root.row.id),
    projects: orderedProjects.map((p) => ({
      id: toId(p.row.id),
      name: p.row.name,
      levelName: p.row.levelName,
      parentId: p.parentId === null ? null : toId(p.parentId),
      createdAt: p.row.createdAt.toISOString(),
    })),
    lockedRules,
  };

  const appRows = await tx
    .select()
    .from(applications)
    .where(eq(applications.tenantId, tenantId))
    .orderBy(asc(applications.createdAt), asc(applications.id));

  const applicationsPayload: BundleApplication[] = [...appRows]
    .sort((a, b) => compare(a.id, b.id))
    .map((row) => ({
      id: toId(row.id),
      projectId: toId(row.projectId),
      fromFlow: row.fromFlow,
    }));

  const payload: StandardBundlePayload = {
    format: { type: BUNDLE_TYPE, version: BUNDLE_FORMAT_VERSION },
    tenantId: toId(tenantId),
    sequence,
    keyId,
    issuedAt,
    stalenessHours: await currentStalenessHours(tx, tenantId),
    frozen: await currentFrozen(tx, tenantId),
    standards: standardsArray,
    tree: projectTree,
    applications: applicationsPayload,
    acceptedDeviations: [],
  };

  const bundleInput: BundleInput = {
    projects: treeNodes(current),
    standards: await liveSet(tx, tenantId),
    lockedStandardIds: await currentLockedIds(tx, tenantId),
    applications: appRows.map((row) => ({ id: row.id, projectId: row.projectId })),
  };

  return { payload, input: bundleInput };
}
