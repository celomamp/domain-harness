// Staging-only demo sign-in: three accounts (DEMO_ACCOUNTS in the contract)
// that open a session without an emailed link, so pilot testers can enter
// the staging panel when mail only reaches a sandbox. Off unless the registry
// runs with REGISTRY_DEMO_SIGN_IN=1, which only fly.registry-staging.toml sets.
import { DEMO_ACCOUNTS, DEMO_COMPANY, normalizeEmail } from "@domain-harness/contract";
import type { RegistryDb } from "../db/client.ts";
import { provisionCompany } from "../tenancy/provision.ts";
import { lookupAccounts } from "./service.ts";

export const DEMO_SIGN_IN_ENV = "REGISTRY_DEMO_SIGN_IN";

/** Demo sign-in is on only for the exact value "1"; anything else (or unset) is off. */
export function demoSignInEnabled(env: NodeJS.ProcessEnv): boolean {
  return env[DEMO_SIGN_IN_ENV]?.trim() === "1";
}

/**
 * Provision the demo Company (plan Team) unless its accounts already exist.
 * Idempotent across restarts: "present" when every demo address already has
 * an account, "provisioned" when none had one and the Company was created,
 * "partial" when only some exist (nothing is written; an operator fixes it).
 */
export async function ensureDemoCompany(db: RegistryDb): Promise<"present" | "provisioned" | "partial"> {
  const held = await Promise.all(
    DEMO_ACCOUNTS.map(async (account) => (await lookupAccounts(db, normalizeEmail(account.email))).length > 0),
  );
  if (held.every(Boolean)) return "present";
  if (held.some(Boolean)) return "partial";
  await provisionCompany(db, {
    company: DEMO_COMPANY,
    plan: "Team",
    accounts: DEMO_ACCOUNTS.map(({ name, email, role }) => ({ name, email, role })),
  });
  return "provisioned";
}
