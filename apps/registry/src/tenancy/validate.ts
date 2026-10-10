import { DEFAULT_PLAN, isPlan, isRole, PLANS, ROLES } from "@domain-harness/contract";
import type { ErrorEnvelope, Plan, Role } from "@domain-harness/contract";

/** One account to provision, normalized. */
export interface AccountRequest {
  readonly name: string;
  /** Trimmed and lower-cased. */
  readonly email: string;
  readonly role: Role;
}

/** A validated, normalized request to provision one Company. */
export interface ProvisionRequest {
  readonly company: string;
  readonly plan: Plan;
  readonly accounts: readonly AccountRequest[];
}

export type ValidationResult =
  | { readonly ok: true; readonly value: ProvisionRequest }
  | { readonly ok: false; readonly error: ErrorEnvelope };

const TOP_LEVEL_KEYS = new Set(["company", "plan", "accounts"]);
const ACCOUNT_KEYS = new Set(["name", "email", "role"]);
// Deliberately loose: one "@", no whitespace, a dot in the domain.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trim and lower-case an email; the stored and compared form. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Validate the whole operator input before anything is written. Pure: no I/O.
 * Messages name fields and indexes only, never names or emails. Unknown keys
 * are rejected, so a client cannot smuggle in ids.
 */
export function validateProvisionInput(raw: unknown): ValidationResult {
  if (!isPlainObject(raw)) {
    return fail("invalid_input", "input must be a JSON object with company, plan and accounts", "input");
  }
  const unknownKey = Object.keys(raw).find((key) => !TOP_LEVEL_KEYS.has(key));
  if (unknownKey !== undefined) {
    return fail("invalid_input", "input has an unsupported field", unknownKey);
  }

  const company = raw["company"];
  if (typeof company !== "string" || company.trim() === "") {
    return fail("invalid_input", "company must be a non-empty string", "company");
  }

  const rawPlan = raw["plan"];
  let plan: Plan = DEFAULT_PLAN;
  if (rawPlan !== undefined) {
    if (!isPlan(rawPlan)) {
      return fail("invalid_plan", `plan must be one of ${PLANS.join(", ")}`, "plan");
    }
    plan = rawPlan;
  }

  const rawAccounts = raw["accounts"];
  if (!Array.isArray(rawAccounts) || rawAccounts.length === 0) {
    return fail("invalid_input", "accounts must be a non-empty array", "accounts");
  }

  const accounts: AccountRequest[] = [];
  const seenEmails = new Set<string>();
  for (const [i, entry] of (rawAccounts as unknown[]).entries()) {
    const at = `accounts[${String(i)}]`;
    if (!isPlainObject(entry)) {
      return fail("invalid_input", `${at} must be an object with name, email and role`, at);
    }
    const unknownField = Object.keys(entry).find((key) => !ACCOUNT_KEYS.has(key));
    if (unknownField !== undefined) {
      return fail("invalid_input", `${at} has an unsupported field`, `${at}.${unknownField}`);
    }

    const name = entry["name"];
    if (typeof name !== "string" || name.trim() === "") {
      return fail("invalid_input", `${at}.name must be a non-empty string`, `${at}.name`);
    }

    const rawEmail = entry["email"];
    if (typeof rawEmail !== "string" || !EMAIL.test(normalizeEmail(rawEmail))) {
      return fail("invalid_input", `${at}.email must be a non-empty email address`, `${at}.email`);
    }
    const email = normalizeEmail(rawEmail);

    const role = entry["role"];
    if (!isRole(role)) {
      return fail("invalid_role", `${at}.role must be one of ${ROLES.join(", ")}`, `${at}.role`);
    }

    if (seenEmails.has(email)) {
      return fail("duplicate_email", `${at}.email repeats an earlier account's email`, `${at}.email`);
    }
    seenEmails.add(email);
    accounts.push({ name: name.trim(), email, role });
  }

  return { ok: true, value: { company: company.trim(), plan, accounts } };
}

function fail(code: string, message: string, subject: string): ValidationResult {
  return { ok: false, error: { code, message, subject } };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
