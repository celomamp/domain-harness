/**
 * The Application agent-tool changes (Story 3.4): append-only rows, the same
 * pattern as the Guidance endpoint changes (Story 3.3). A successful Boilerplate
 * generation appends one row unless it generated the Application's current
 * tool; the Application's current tool is its highest-sequence row, and an
 * Application with no row has none (`agentTool: null`). Recording happens
 * inside the generation's own bundle-locked transaction, so a refused
 * generation writes nothing, and reading happens under the Application list's
 * bundle lock, so the tool always belongs to a listed Application.
 */
import { and, desc, eq, max } from "drizzle-orm";
import { isBoilerplateTarget } from "@domain-harness/contract";
import type { BoilerplateTarget, UuidV7 } from "@domain-harness/contract";
import { mintUuidV7 } from "../ids.ts";
import type { RegistryTx } from "../db/client.ts";
import { applicationAgentToolChanges } from "../db/schema.ts";

const toTarget = (agentTool: string): BoilerplateTarget => agentTool as BoilerplateTarget;

/**
 * The current agent tool of every Application of the tenant, by Application
 * id: one query, the latest-sequence row per Application (`DISTINCT ON`
 * keeps the first row per Application, ordered by sequence descending).
 */
export async function currentAgentTools(tx: RegistryTx, tenantId: UuidV7): Promise<Map<string, BoilerplateTarget>> {
  const rows = await tx
    .selectDistinctOn([applicationAgentToolChanges.applicationId], {
      applicationId: applicationAgentToolChanges.applicationId,
      agentTool: applicationAgentToolChanges.agentTool,
    })
    .from(applicationAgentToolChanges)
    .where(eq(applicationAgentToolChanges.tenantId, tenantId))
    .orderBy(applicationAgentToolChanges.applicationId, desc(applicationAgentToolChanges.sequence));
  return new Map(rows.map((row) => [row.applicationId, toTarget(row.agentTool)]));
}

/** The current agent tool of one Application, or `null` when it has no row. */
async function currentAgentTool(tx: RegistryTx, tenantId: UuidV7, applicationId: UuidV7): Promise<BoilerplateTarget | null> {
  const [row] = await tx
    .select({ agentTool: applicationAgentToolChanges.agentTool })
    .from(applicationAgentToolChanges)
    .where(and(eq(applicationAgentToolChanges.tenantId, tenantId), eq(applicationAgentToolChanges.applicationId, applicationId)))
    .orderBy(desc(applicationAgentToolChanges.sequence))
    .limit(1);
  return row === undefined ? null : toTarget(row.agentTool);
}

/** The next per-Application sequence: max + 1, read under the bundle lock. */
async function nextSequence(tx: RegistryTx, tenantId: UuidV7, applicationId: UuidV7): Promise<number> {
  const [row] = await tx
    .select({ sequence: max(applicationAgentToolChanges.sequence) })
    .from(applicationAgentToolChanges)
    .where(and(eq(applicationAgentToolChanges.tenantId, tenantId), eq(applicationAgentToolChanges.applicationId, applicationId)));
  return (row?.sequence ?? 0) + 1;
}

/**
 * Record one Application's agent tool by appending a row: the current tool
 * equals `target` → no row; otherwise append with per-(tenant, Application)
 * sequence max + 1. Called as the last step of a successful generation, inside
 * the generation's own transaction, so a refused generation records nothing.
 */
export async function recordAgentTool(
  tx: RegistryTx,
  tenantId: UuidV7,
  applicationId: UuidV7,
  target: BoilerplateTarget,
  changedBy: UuidV7,
): Promise<void> {
  if (!isBoilerplateTarget(target)) throw new Error("an agent tool must be a Boilerplate target");
  const current = await currentAgentTool(tx, tenantId, applicationId);
  if (current === target) return;
  await tx.insert(applicationAgentToolChanges).values({
    id: mintUuidV7(),
    tenantId,
    applicationId,
    sequence: await nextSequence(tx, tenantId, applicationId),
    agentTool: target,
    changedBy,
  });
}
