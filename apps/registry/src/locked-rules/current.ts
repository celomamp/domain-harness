import { and, desc, eq } from "drizzle-orm";
import type { UuidV7 } from "@domain-harness/contract";
import type { RegistryTx } from "../db/client.ts";
import { lockedRuleChanges, standards } from "../db/schema.ts";

/** The latest Locked-rule row of one Standard, with the Project the Standard is scoped to. */
export interface LockedRuleRow {
  readonly standardId: string;
  readonly projectId: string;
  readonly locked: boolean;
  readonly changedBy: string;
  readonly changedAt: Date;
}

/**
 * The latest Locked-rule row of every Standard that has one (DISTINCT ON
 * keeps the highest-sequence row per Standard). A Standard with no row is not
 * locked.
 */
async function latestRows(tx: RegistryTx, tenantId: UuidV7): Promise<LockedRuleRow[]> {
  return tx
    .selectDistinctOn([lockedRuleChanges.standardId], {
      standardId: lockedRuleChanges.standardId,
      projectId: standards.projectId,
      locked: lockedRuleChanges.locked,
      changedBy: lockedRuleChanges.changedBy,
      changedAt: lockedRuleChanges.changedAt,
    })
    .from(lockedRuleChanges)
    .innerJoin(
      standards,
      and(eq(standards.tenantId, lockedRuleChanges.tenantId), eq(standards.id, lockedRuleChanges.standardId)),
    )
    .where(eq(lockedRuleChanges.tenantId, tenantId))
    .orderBy(lockedRuleChanges.standardId, desc(lockedRuleChanges.sequence));
}

/** The current marking row of every Standard that is a Locked rule now. */
export async function currentLockedMarks(tx: RegistryTx, tenantId: UuidV7): Promise<LockedRuleRow[]> {
  return (await latestRows(tx, tenantId)).filter((row) => row.locked);
}

/** The ids of the Standards that are Locked rules now (the Locked-rule part of the whole bundle input). */
export async function currentLockedIds(tx: RegistryTx, tenantId: UuidV7): Promise<string[]> {
  return (await currentLockedMarks(tx, tenantId)).map((row) => row.standardId);
}

/** The latest Locked-rule row of one Standard, or undefined when it was never marked. */
export async function latestLockedRuleRow(
  tx: RegistryTx,
  tenantId: UuidV7,
  standardId: string,
): Promise<LockedRuleRow | undefined> {
  const [row] = await tx
    .select({
      standardId: lockedRuleChanges.standardId,
      projectId: standards.projectId,
      locked: lockedRuleChanges.locked,
      changedBy: lockedRuleChanges.changedBy,
      changedAt: lockedRuleChanges.changedAt,
    })
    .from(lockedRuleChanges)
    .innerJoin(
      standards,
      and(eq(standards.tenantId, lockedRuleChanges.tenantId), eq(standards.id, lockedRuleChanges.standardId)),
    )
    .where(and(eq(lockedRuleChanges.tenantId, tenantId), eq(lockedRuleChanges.standardId, standardId)))
    .orderBy(desc(lockedRuleChanges.sequence))
    .limit(1);
  return row;
}
