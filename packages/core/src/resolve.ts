/**
 * The Effective Standard set resolver (FR-6, AD-1).
 *
 * Given the Project tree, every live Standard (as a {@link SlotHolder}), the
 * Locked rules and one Project, it returns the Standards that Project
 * actually receives. Walking from the Project up to the root:
 * - only Standards scoped to the Project or one of its ancestors count;
 * - two of them in one Conflict slot at one scope are an error, never a guess;
 * - per slot, a Locked rule is never replaced, so the locked holder nearest
 *   the root wins; otherwise the holder nearest the Project wins;
 * - different slots never compete.
 *
 * Pure: no I/O, no clock, no network. The answer depends only on the set of
 * inputs, never on their order, and adapters never re-sort, filter or cache it.
 */
import { PROJECT_NOT_FOUND, SLOT_CONFLICT } from "@domain-harness/contract";
import type { ErrorEnvelope } from "@domain-harness/contract";
import { formatSlot, normalizeSlotName, sameSlot } from "./slots.ts";
import type { ConflictSlot, SlotHolder } from "./slots.ts";
import { validateProjectTree } from "./tree.ts";
import type { TreeNode } from "./tree.ts";

/** What {@link resolveEffectiveSet} needs. */
export interface ResolveInput {
  readonly projects: readonly TreeNode[];
  /** Every live Standard of the Company, at every Project scope. */
  readonly standards: readonly SlotHolder[];
  /** The ids of the Standards marked as Locked rules. */
  readonly lockedStandardIds: readonly string[];
  /** The Project whose Effective Standard set is resolved. */
  readonly projectId: string;
}

/** One Standard of the Effective Standard set: the winner of its Conflict slot. */
export interface EffectiveEntry {
  readonly standardId: string;
  readonly slot: ConflictSlot;
  /** The Project scope of the winning Standard: the Project itself or one of its ancestors. */
  readonly sourceProjectId: string;
  /** True when the winner is a Locked rule. */
  readonly locked: boolean;
}

export type ResolveResult =
  | { readonly ok: true; readonly set: readonly EffectiveEntry[] }
  | { readonly ok: false; readonly error: ErrorEnvelope };

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The deterministic order of the set: Module kind, slot kind, normalised slot name, then Standard id. */
function byEntry(a: EffectiveEntry, b: EffectiveEntry): number {
  return (
    compare(a.slot.moduleKind, b.slot.moduleKind) ||
    compare(a.slot.slotKind, b.slot.slotKind) ||
    compare(normalizeSlotName(a.slot.name), normalizeSlotName(b.slot.name)) ||
    compare(a.standardId, b.standardId)
  );
}

const slotKey = (slot: ConflictSlot): string =>
  JSON.stringify([slot.moduleKind, slot.slotKind, normalizeSlotName(slot.name)]);

/**
 * Resolve the Effective Standard set of `projectId`. Returns the set in its
 * deterministic order, or the first error, checked in this order:
 * - the tree is valid ({@link validateProjectTree}'s error);
 * - the Project is in the tree (`project_not_found`, subject `projectId`);
 * - no two considered Standards share a Conflict slot at one scope
 *   (`slot_conflict` naming both, subject = the smaller Standard id).
 */
export function resolveEffectiveSet(input: ResolveInput): ResolveResult {
  const tree = validateProjectTree(input.projects);
  if (!tree.ok) return tree;

  const parents = new Map(input.projects.map((node) => [node.id, node.parentId]));
  if (!parents.has(input.projectId)) {
    return {
      ok: false,
      error: {
        code: PROJECT_NOT_FOUND,
        message: `Project ${input.projectId} is not in the Project tree`,
        subject: "projectId",
      },
    };
  }

  // Distance from the Project: 0 for the Project itself, rising toward the root.
  const depth = new Map<string, number>();
  for (let current: string | null = input.projectId, d = 0; current !== null; d += 1) {
    depth.set(current, d);
    current = parents.get(current) ?? null;
  }

  const considered = input.standards
    .filter((holder) => depth.has(holder.projectId))
    .sort((a, b) => compare(a.standardId, b.standardId) || compare(a.projectId, b.projectId));

  for (let i = 0; i < considered.length; i += 1) {
    for (let j = i + 1; j < considered.length; j += 1) {
      const a = considered[i];
      const b = considered[j];
      if (
        a !== undefined &&
        b !== undefined &&
        a.standardId !== b.standardId &&
        a.projectId === b.projectId &&
        sameSlot(a.slot, b.slot)
      ) {
        return {
          ok: false,
          error: {
            code: SLOT_CONFLICT,
            message:
              `Standard ${a.standardId} and Standard ${b.standardId} both hold the Conflict slot ` +
              `${formatSlot(a.slot)} at Project ${a.projectId}, so the Effective Standard set cannot be resolved`,
            subject: a.standardId,
          },
        };
      }
    }
  }

  const locked = new Set(input.lockedStandardIds);
  const winners = new Map<string, { holder: SlotHolder; depth: number; locked: boolean }>();
  for (const holder of considered) {
    const key = slotKey(holder.slot);
    const candidate = { holder, depth: depth.get(holder.projectId) ?? 0, locked: locked.has(holder.standardId) };
    const best = winners.get(key);
    // A locked holder beats any unlocked one; among locked, nearest the root wins;
    // among unlocked, nearest the Project wins. Depths are unique per slot (rule 4).
    if (
      best === undefined ||
      (candidate.locked && !best.locked) ||
      (candidate.locked && best.locked && candidate.depth > best.depth) ||
      (!candidate.locked && !best.locked && candidate.depth < best.depth)
    ) {
      winners.set(key, candidate);
    }
  }

  const set = [...winners.values()]
    .map(
      ({ holder, locked: isLocked }): EffectiveEntry => ({
        standardId: holder.standardId,
        slot: holder.slot,
        sourceProjectId: holder.projectId,
        locked: isLocked,
      }),
    )
    .sort(byEntry);
  return { ok: true, set };
}
