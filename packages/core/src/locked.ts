/**
 * The Locked rule contradiction check (FR-6, AD-13).
 *
 * A Locked rule from an ancestor is never replaced (the locked holder nearest
 * the root wins its Conflict slot), so a descendant Locked rule in the same
 * slot could never take effect: the two contradict each other. This check is
 * symmetric, so the order in which the marks were made does not matter.
 * Locked rules on unrelated branches (siblings, cousins) never contradict.
 *
 * Pure: no I/O, no clock, no network. The answer depends only on the set of
 * inputs, never on their order.
 */
import { LOCKED_RULE_CONFLICT } from "@domain-harness/contract";
import type { ErrorEnvelope } from "@domain-harness/contract";
import { formatSlot, sameSlot } from "./slots.ts";
import type { SlotHolder } from "./slots.ts";

/**
 * What {@link validateLockedRules} reads: the shape of `BundleInput` (`tree.ts`
 * passes its input as is; the types are restated here so the two modules do
 * not import each other).
 */
export interface LockedRulesInput {
  readonly projects: readonly { readonly id: string; readonly parentId: string | null }[];
  readonly standards: readonly SlotHolder[];
  readonly change?: { readonly projectId: string; readonly parentId: string };
  readonly lockedStandardIds?: readonly string[];
  readonly lockProposal?: string;
}

export type LockedRulesResult = { readonly ok: true } | { readonly ok: false; readonly error: ErrorEnvelope };

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** True when `ancestorId` is a strict ancestor of `projectId` in `parents`. */
function isStrictAncestor(parents: ReadonlyMap<string, string | null>, ancestorId: string, projectId: string): boolean {
  const seen = new Set<string>([projectId]);
  let current = parents.get(projectId) ?? null;
  while (current !== null && !seen.has(current)) {
    if (current === ancestorId) return true;
    seen.add(current);
    current = parents.get(current) ?? null;
  }
  return false;
}

/**
 * Validate the Locked rules of the whole proposed bundle input, with its
 * `change` applied. Returns `{ ok: true }`, or `locked_rule_conflict` when two
 * different locked holders share a Conflict slot and one's Project is a
 * strict ancestor of the other's. The message names both Standards, both
 * Projects and the slot.
 *
 * A pair involving `lockProposal` is reported first, with the other Standard
 * as subject; any other pair is reported with the ancestor's Standard as
 * subject. Pairs are checked in Standard-id order. Locked ids that match no
 * holder are ignored.
 */
export function validateLockedRules(input: LockedRulesInput): LockedRulesResult {
  const lockedIds = new Set(input.lockedStandardIds ?? []);
  const locked = input.standards
    .filter((holder) => lockedIds.has(holder.standardId))
    .sort((a, b) => compare(a.standardId, b.standardId));
  if (locked.length < 2) return { ok: true };

  const change = input.change;
  const parents = new Map<string, string | null>(
    input.projects.map((node) => [
      node.id,
      change !== undefined && node.id === change.projectId ? change.parentId : node.parentId,
    ]),
  );

  /** The ancestor of the pair when the two contradict, otherwise `undefined`. */
  const ancestorOf = (a: SlotHolder, b: SlotHolder): SlotHolder | undefined => {
    if (a.standardId === b.standardId || a.projectId === b.projectId || !sameSlot(a.slot, b.slot)) return undefined;
    if (isStrictAncestor(parents, a.projectId, b.projectId)) return a;
    if (isStrictAncestor(parents, b.projectId, a.projectId)) return b;
    return undefined;
  };

  const proposal = input.lockProposal === undefined ? undefined : locked.find((h) => h.standardId === input.lockProposal);
  if (proposal !== undefined) {
    for (const other of locked) {
      if (ancestorOf(proposal, other) !== undefined) return contradiction(proposal, other);
    }
  }
  for (let i = 0; i < locked.length; i += 1) {
    for (let j = i + 1; j < locked.length; j += 1) {
      const a = locked[i];
      const b = locked[j];
      if (a === undefined || b === undefined) continue;
      const ancestor = ancestorOf(a, b);
      if (ancestor !== undefined) return contradiction(ancestor === a ? b : a, ancestor);
    }
  }
  return { ok: true };
}

/** `holder` contradicts the Locked rule `other`; the subject is `other`'s Standard id. */
function contradiction(holder: SlotHolder, other: SlotHolder): LockedRulesResult {
  return {
    ok: false,
    error: {
      code: LOCKED_RULE_CONFLICT,
      message:
        `the Locked rule Standard ${holder.standardId} at Project ${holder.projectId} contradicts the Locked rule ` +
        `Standard ${other.standardId} at Project ${other.projectId} in the Conflict slot ${formatSlot(other.slot)}; ` +
        `nothing was changed`,
      subject: other.standardId,
    },
  };
}
