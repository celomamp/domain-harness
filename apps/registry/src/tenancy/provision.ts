import type { Plan, Role, UuidV7 } from "@domain-harness/contract";
import { EnvelopeError } from "../errors.ts";
import { mintUuidV7 } from "../ids.ts";
import type { RegistryDb } from "../db/client.ts";
import { accounts, projects, tenants } from "../db/schema.ts";
import { isUniqueViolation } from "../db/pg-errors.ts";
import { withTenant } from "../db/tenant-scope.ts";
import { validateProvisionInput } from "./validate.ts";
import type { ProvisionRequest } from "./validate.ts";

/** What provisioning reports: ids, the plan and roles. Never names or emails. */
export interface ProvisionResult {
  readonly tenantId: UuidV7;
  readonly rootProjectId: UuidV7;
  readonly plan: Plan;
  readonly accounts: readonly { readonly id: UuidV7; readonly role: Role }[];
}

const ACCOUNT_EMAIL_UNIQUE = "accounts_tenant_id_email_key";

/**
 * Provision one Company: a tenant, its root Project (named after the Company,
 * no parent) and its role-named accounts.
 *
 * The whole input is validated before any write and an invalid one throws its
 * envelope. The write is one transaction in the new tenant's context, so any
 * failure rolls everything back: nothing is written.
 */
export async function provisionCompany(db: RegistryDb, input: unknown): Promise<ProvisionResult> {
  const validation = validateProvisionInput(input);
  if (!validation.ok) {
    throw new EnvelopeError(validation.error);
  }
  return writeCompany(db, validation.value);
}

/**
 * The write half of {@link provisionCompany}, for an already validated request.
 * Exported for tests that prove the database-level duplicate guard.
 */
export async function writeCompany(db: RegistryDb, request: ProvisionRequest): Promise<ProvisionResult> {
  const tenantId = mintUuidV7();
  const rootProjectId = mintUuidV7();
  const minted = request.accounts.map((account) => ({ ...account, id: mintUuidV7() }));

  await withTenant(db, tenantId, async (tx) => {
    await tx.insert(tenants).values({ id: tenantId, name: request.company, plan: request.plan });
    await tx.insert(projects).values({ id: rootProjectId, tenantId, parentId: null, name: request.company });
    // One insert per account so a unique violation names the offending entry.
    for (const [j, account] of minted.entries()) {
      try {
        await tx.insert(accounts).values({
          id: account.id,
          tenantId,
          name: account.name,
          email: account.email,
          role: account.role,
        });
      } catch (error) {
        if (isUniqueViolation(error, ACCOUNT_EMAIL_UNIQUE)) {
          throw new EnvelopeError(
            {
              code: "duplicate_email",
              message: `accounts[${String(j)}].email repeats an earlier account's email; nothing was written`,
              subject: `accounts[${String(j)}].email`,
            },
            { cause: error },
          );
        }
        throw error;
      }
    }
  });

  return {
    tenantId,
    rootProjectId,
    plan: request.plan,
    accounts: minted.map(({ id, role }) => ({ id, role })),
  };
}
