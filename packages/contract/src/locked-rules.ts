/**
 * The Locked rule wire contract (Story 2.4): the HTTP path, request and
 * response bodies, error code and runtime guards shared by the registry
 * (which stores the marks) and the panel (which marks and shows them).
 *
 * The Buyer marks a Standard as a Locked rule on the Project it is scoped
 * to. In the Effective Standard set of that Project and every descendant, a
 * Locked rule is never replaced: within its Conflict slot, the locked holder
 * nearest the root wins. Two Locked rules in one Conflict slot on an
 * ancestor/descendant path contradict each other and are refused.
 */
import { isRecord, isUtcIso } from "./guards.ts";
import { isUuidV7 } from "./ids.ts";
import type { AccountRef } from "./modules.ts";
import { isStandardInfo, STANDARD_API_PATHS } from "./standards.ts";
import type { StandardInfo } from "./standards.ts";

export { isLockedRuleMark } from "./projects.ts";
export type { LockedRuleMark } from "./projects.ts";

/** Body of `POST /v1/standards/{id}/locked-rule` (exactly this key). */
export interface LockedRuleRequest {
  readonly locked: boolean;
}

/** Response of `POST /v1/standards/{id}/locked-rule`: the Standard's current Locked-rule state. */
export interface LockedRuleState {
  /** The Standard's live version. */
  readonly standard: StandardInfo;
  readonly locked: boolean;
  /** UTC ISO-8601 of the latest mark or unmark; `null` when the Standard was never marked. */
  readonly changedAt: string | null;
  /** The Buyer who made the latest mark or unmark; `null` when the Standard was never marked. */
  readonly changedBy: AccountRef | null;
}

/** `POST` a {@link LockedRuleRequest}: 200 {@link LockedRuleState} (Buyer only). */
export function lockedRulePath(standardId: string): string {
  return `${STANDARD_API_PATHS.standards}/${encodeURIComponent(standardId)}/locked-rule`;
}

/**
 * The proposed Locked rule contradicts another Locked rule in the same
 * Conflict slot on an ancestor/descendant path (subject: the other Standard's id).
 */
export const LOCKED_RULE_CONFLICT = "locked_rule_conflict";

function isAccountRef(value: unknown): value is AccountRef {
  return isRecord(value) && isUuidV7(value["accountId"]) && typeof value["name"] === "string";
}

/** True when `value` is a {@link LockedRuleState}. Never throws. */
export function isLockedRuleState(value: unknown): value is LockedRuleState {
  if (!isRecord(value)) return false;
  const changedAt = value["changedAt"];
  const changedBy = value["changedBy"];
  const never = changedAt === null && changedBy === null;
  const marked = isUtcIso(changedAt) && isAccountRef(changedBy);
  const locked = value["locked"];
  if (!isStandardInfo(value["standard"]) || typeof locked !== "boolean") return false;
  // No row yet means not locked.
  return never ? !locked : marked;
}
