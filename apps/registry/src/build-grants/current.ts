import { and, desc, eq } from "drizzle-orm";
import type { UuidV7 } from "@domain-harness/contract";
import type { RegistryTx } from "../db/client.ts";
import { buildGrantChanges } from "../db/schema.ts";

/** The latest build grant row of one (Project, account) pair. */
export interface BuildGrantRow {
  readonly projectId: string;
  readonly accountId: string;
  readonly granted: boolean;
  readonly changedBy: string;
  readonly changedAt: Date;
}

const columns = {
  projectId: buildGrantChanges.projectId,
  accountId: buildGrantChanges.accountId,
  granted: buildGrantChanges.granted,
  changedBy: buildGrantChanges.changedBy,
  changedAt: buildGrantChanges.changedAt,
};

/**
 * The latest row of every account that has one on `projectId` (DISTINCT ON
 * keeps the highest-sequence row per account). An account with no row is not
 * granted.
 */
export async function latestGrantRows(
  tx: RegistryTx,
  tenantId: UuidV7,
  projectId: string,
): Promise<BuildGrantRow[]> {
  return tx
    .selectDistinctOn([buildGrantChanges.accountId], columns)
    .from(buildGrantChanges)
    .where(and(eq(buildGrantChanges.tenantId, tenantId), eq(buildGrantChanges.projectId, projectId)))
    .orderBy(buildGrantChanges.accountId, desc(buildGrantChanges.sequence));
}

/** The latest row of one (Project, account) pair, or undefined when the pair never had one. */
export async function latestGrantRow(
  tx: RegistryTx,
  tenantId: UuidV7,
  projectId: string,
  accountId: string,
): Promise<BuildGrantRow | undefined> {
  const [row] = await tx
    .select(columns)
    .from(buildGrantChanges)
    .where(
      and(
        eq(buildGrantChanges.tenantId, tenantId),
        eq(buildGrantChanges.projectId, projectId),
        eq(buildGrantChanges.accountId, accountId),
      ),
    )
    .orderBy(desc(buildGrantChanges.sequence))
    .limit(1);
  return row;
}

/**
 * True when `accountId` holds a current build grant on `projectId`. A grant
 * is never inherited: only the pair's own latest row counts.
 */
export async function hasBuildGrant(
  tx: RegistryTx,
  tenantId: UuidV7,
  projectId: string,
  accountId: string,
): Promise<boolean> {
  return (await latestGrantRow(tx, tenantId, projectId, accountId))?.granted ?? false;
}
