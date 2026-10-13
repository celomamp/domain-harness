import { and, desc, eq } from "drizzle-orm";
import type { UuidV7 } from "@domain-harness/contract";
import type { RegistryTx } from "../db/client.ts";
import { childPermissionChanges } from "../db/schema.ts";

/** The latest child-Project permission row of one (Project, account) pair. */
export interface ChildPermissionRow {
  readonly projectId: string;
  readonly accountId: string;
  readonly granted: boolean;
  readonly changedBy: string;
  readonly changedAt: Date;
}

const columns = {
  projectId: childPermissionChanges.projectId,
  accountId: childPermissionChanges.accountId,
  granted: childPermissionChanges.granted,
  changedBy: childPermissionChanges.changedBy,
  changedAt: childPermissionChanges.changedAt,
};

/**
 * The latest row of every account that has one on `projectId` (DISTINCT ON
 * keeps the highest-sequence row per account). An account with no row is not
 * granted.
 */
export async function latestPermissionRows(
  tx: RegistryTx,
  tenantId: UuidV7,
  projectId: string,
): Promise<ChildPermissionRow[]> {
  return tx
    .selectDistinctOn([childPermissionChanges.accountId], columns)
    .from(childPermissionChanges)
    .where(and(eq(childPermissionChanges.tenantId, tenantId), eq(childPermissionChanges.projectId, projectId)))
    .orderBy(childPermissionChanges.accountId, desc(childPermissionChanges.sequence));
}

/** The latest row of one (Project, account) pair, or undefined when the pair never had one. */
export async function latestPermissionRow(
  tx: RegistryTx,
  tenantId: UuidV7,
  projectId: string,
  accountId: string,
): Promise<ChildPermissionRow | undefined> {
  const [row] = await tx
    .select(columns)
    .from(childPermissionChanges)
    .where(
      and(
        eq(childPermissionChanges.tenantId, tenantId),
        eq(childPermissionChanges.projectId, projectId),
        eq(childPermissionChanges.accountId, accountId),
      ),
    )
    .orderBy(desc(childPermissionChanges.sequence))
    .limit(1);
  return row;
}

/**
 * True when `accountId` holds a current grant to create child Projects
 * directly under `projectId`. A grant is never inherited: only the pair's own
 * latest row counts.
 */
export async function hasChildPermission(
  tx: RegistryTx,
  tenantId: UuidV7,
  projectId: string,
  accountId: string,
): Promise<boolean> {
  return (await latestPermissionRow(tx, tenantId, projectId, accountId))?.granted ?? false;
}
