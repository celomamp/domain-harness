import { eq } from "drizzle-orm";
import { PLAN_REFUSED } from "@domain-harness/contract";
import type { Plan, UuidV7 } from "@domain-harness/contract";
import { EnvelopeError } from "../errors.ts";
import type { RegistryTx } from "../db/client.ts";
import { tenants } from "../db/schema.ts";

/** The Project-tree capabilities a plan may lack. */
export type TreeCapability = "create" | "parent" | "lock";

/** How each capability is named in a refusal: the capability only, never a plan or a price. */
const CAPABILITY_TEXT: Readonly<Record<TreeCapability, string>> = {
  create: "creating another Project",
  parent: "setting a parent",
  lock: "marking a Locked rule",
};

/** Whether each plan includes the Project-tree capabilities; a new plan is a compile error until decided. */
const TREE_CAPABILITIES: Readonly<Record<Plan, boolean>> = {
  Community: false,
  Team: true,
  Business: true,
  Enterprise: true,
};

/**
 * Throw `plan_refused` (403, subject `plan`) when the tenant's plan does not
 * include `capability`. Reads `tenants.plan` inside the caller's tenant
 * transaction (RLS scopes `tenants`), so the check and the write share one
 * state.
 */
export async function assertTreePlan(tx: RegistryTx, tenantId: UuidV7, capability: TreeCapability): Promise<void> {
  const [row] = await tx.select({ plan: tenants.plan }).from(tenants).where(eq(tenants.id, tenantId));
  if (row === undefined) throw new Error("the tenant is not visible in its own context");
  if (!TREE_CAPABILITIES[row.plan]) {
    throw new EnvelopeError({
      code: PLAN_REFUSED,
      message: `this Company's plan does not include ${CAPABILITY_TEXT[capability]}; nothing was changed`,
      subject: "plan",
    });
  }
}
