/**
 * Shared account vocabulary: the three roles an account can hold and the plan
 * attribute of a tenant. The registry stores these exact strings and the panel
 * displays them, so they are spelled once, here.
 */

/** Every account holds exactly one of these roles. */
export const ROLES = ["Buyer", "Standard owner", "Builder"] as const;
export type Role = (typeof ROLES)[number];

/** Every tenant has exactly one of these plans. */
export const PLANS = ["Community", "Team", "Business", "Enterprise"] as const;
export type Plan = (typeof PLANS)[number];

/** The pilot default plan. */
export const DEFAULT_PLAN: Plan = "Team";

/** True when `value` is exactly one of {@link ROLES}. Never throws. */
export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** True when `value` is exactly one of {@link PLANS}. Never throws. */
export function isPlan(value: unknown): value is Plan {
  return typeof value === "string" && (PLANS as readonly string[]).includes(value);
}
