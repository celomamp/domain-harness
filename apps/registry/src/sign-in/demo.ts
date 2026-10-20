// Demo sign-in, a feature toggle for staging and pilot testing: one account
// per role whose address signs in at once, with no emailed link. Off unless
// the registry runs with REGISTRY_DEMO_SIGN_IN=1. The addresses come from the
// REGISTRY_DEMO_ACCOUNTS secret when it is set, otherwise from the defaults
// below. Never enable it where real Companies sign in.
import { isEmailAddress, isRole, normalizeEmail, ROLES } from "@domain-harness/contract";
import type { Role } from "@domain-harness/contract";
import { EnvelopeError } from "../errors.ts";
import type { RegistryDb } from "../db/client.ts";
import { provisionCompany } from "../tenancy/provision.ts";
import { lookupAccounts } from "./service.ts";

export const DEMO_SIGN_IN_ENV = "REGISTRY_DEMO_SIGN_IN";
export const DEMO_ACCOUNTS_ENV = "REGISTRY_DEMO_ACCOUNTS";

/** The Company the demo accounts belong to. */
export const DEMO_COMPANY = "Demo Pilot";

export interface DemoAccount {
  readonly name: string;
  /** Normalized (trimmed, lower-case). */
  readonly email: string;
  readonly role: Role;
}

/** The addresses used when REGISTRY_DEMO_ACCOUNTS is not set. */
export const DEFAULT_DEMO_ACCOUNTS: readonly DemoAccount[] = [
  { name: "Demo Buyer", email: "buyer@demo.domainharness.test", role: "Buyer" },
  { name: "Demo Standard owner", email: "owner@demo.domainharness.test", role: "Standard owner" },
  { name: "Demo Builder", email: "builder@demo.domainharness.test", role: "Builder" },
];

const invalid = (message: string): EnvelopeError =>
  new EnvelopeError({ code: "invalid_configuration", message, subject: DEMO_ACCOUNTS_ENV });

/**
 * The demo accounts, or `undefined` when demo sign-in is off (the toggle is
 * on only for the exact value "1"). REGISTRY_DEMO_ACCOUNTS, when set, lists
 * exactly one address per role as `Role=email` pairs separated by `;`:
 *
 *   Buyer=ana@acme.com;Standard owner=rui@acme.com;Builder=lia@acme.com
 *
 * Anything else refuses the start with `invalid_configuration`, so a typo
 * never silently falls back to the defaults.
 */
export function demoAccountsFromEnv(env: NodeJS.ProcessEnv): readonly DemoAccount[] | undefined {
  if (env[DEMO_SIGN_IN_ENV]?.trim() !== "1") return undefined;
  const raw = env[DEMO_ACCOUNTS_ENV]?.trim();
  if (raw === undefined || raw === "") return DEFAULT_DEMO_ACCOUNTS;

  const byRole = new Map<Role, DemoAccount>();
  for (const pair of raw.split(";").map((part) => part.trim()).filter((part) => part !== "")) {
    const at = pair.indexOf("=");
    const role = pair.slice(0, at).trim();
    const email = pair.slice(at + 1);
    if (at < 0 || !isRole(role)) throw invalid(`each entry must be Role=email with a role among ${ROLES.join(", ")}`);
    if (!isEmailAddress(email)) throw invalid(`the ${role} entry must name an email address`);
    if (byRole.has(role)) throw invalid(`the ${role} role is listed twice`);
    byRole.set(role, { name: `Demo ${role}`, email: normalizeEmail(email), role });
  }
  const accounts = ROLES.map((role) => byRole.get(role));
  if (accounts.some((account) => account === undefined)) throw invalid(`list one email for each role: ${ROLES.join(", ")}`);
  const list = accounts.filter((account): account is DemoAccount => account !== undefined);
  if (new Set(list.map((account) => account.email)).size !== list.length) throw invalid("each role needs its own email");
  return list;
}

/**
 * Provision the demo Company (plan Team) unless its accounts already exist.
 * Idempotent across restarts: "present" when every demo address already has
 * an account, "provisioned" when none had one and the Company was created,
 * "partial" when only some exist (nothing is written; an operator fixes it).
 */
export async function ensureDemoCompany(
  db: RegistryDb,
  accounts: readonly DemoAccount[],
): Promise<"present" | "provisioned" | "partial"> {
  const held = await Promise.all(accounts.map(async (account) => (await lookupAccounts(db, account.email)).length > 0));
  if (held.every(Boolean)) return "present";
  if (held.some(Boolean)) return "partial";
  await provisionCompany(db, {
    company: DEMO_COMPANY,
    plan: "Team",
    accounts: accounts.map(({ name, email, role }) => ({ name, email, role })),
  });
  return "provisioned";
}
