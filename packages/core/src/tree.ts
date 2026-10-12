/**
 * The Project tree rule and whole-bundle validation (AD-13).
 *
 * A Company's Projects form one tree: exactly one root (no parent), every
 * other Project has exactly one parent that exists, and no Project is its
 * own ancestor. Every registry mutation builds the whole proposed bundle
 * input (the tree plus every live Standard) and asks
 * {@link validateBundleInput}; it never re-implements or post-processes the
 * answer.
 *
 * Pure: no I/O, no clock, no network. The answer depends only on the set of
 * inputs, never on their order.
 */
import { PROJECT_CYCLE, PROJECT_NOT_FOUND } from "@domain-harness/contract";
import type { ErrorEnvelope } from "@domain-harness/contract";
import { validateLockedRules } from "./locked.ts";
import { validatePublication } from "./slots.ts";
import type { SlotHolder } from "./slots.ts";

/** One Project as the tree rule sees it. */
export interface TreeNode {
  readonly id: string;
  /** `null` only for the root Project. */
  readonly parentId: string | null;
}

/** A proposed parent for one Project (a create or a parent change). */
export interface ParentChange {
  readonly projectId: string;
  readonly parentId: string;
}

export type TreeResult = { readonly ok: true } | { readonly ok: false; readonly error: ErrorEnvelope };

/** The whole proposed bundle input: every Project with its proposed parent, and every live Standard. */
export interface BundleInput {
  readonly projects: readonly TreeNode[];
  readonly standards: readonly SlotHolder[];
  /**
   * The change being proposed, when there is one. It is applied over
   * `projects` (applying it again to a tree that already holds it changes
   * nothing), and a cycle it closes is reported against its parent.
   */
  readonly change?: ParentChange;
  /** The ids of the Standards that are (or are proposed to be) Locked rules. Ids that match no Standard are ignored. */
  readonly lockedStandardIds?: readonly string[];
  /** The id of the Standard being marked as a Locked rule, when the change is a mark; it is reported first. */
  readonly lockProposal?: string;
}

const fail = (code: string, message: string, subject: string): TreeResult => ({
  ok: false,
  error: { code, message, subject },
});

const byId = (a: TreeNode, b: TreeNode): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Validate the Project tree, with `change` applied when given. Returns
 * `{ ok: true }` or the first error, checked in this order:
 * - the changed Project exists (`project_not_found`, subject `projectId`);
 * - every id is unique and there is exactly one root (`invalid_input`, subject `parentId`);
 * - every parent exists (`project_not_found`, subject `parentId`);
 * - no cycle (`project_cycle`, subject = the parent id that closes it).
 */
export function validateProjectTree(nodes: readonly TreeNode[], change?: ParentChange): TreeResult {
  if (change !== undefined && !nodes.some((node) => node.id === change.projectId)) {
    return fail(PROJECT_NOT_FOUND, `Project ${change.projectId} is not in the tree; nothing was changed`, "projectId");
  }
  const proposed = nodes
    .map((node) => (change !== undefined && node.id === change.projectId ? { id: node.id, parentId: change.parentId } : node))
    .sort(byId);

  const parents = new Map<string, string | null>();
  for (const node of proposed) {
    if (parents.has(node.id)) {
      return fail("invalid_input", `Project ${node.id} appears twice in the tree; nothing was changed`, "parentId");
    }
    parents.set(node.id, node.parentId);
  }

  const roots = proposed.filter((node) => node.parentId === null);
  if (roots.length !== 1) {
    return fail(
      "invalid_input",
      `the Project tree must have exactly one root Project, not ${String(roots.length)}; nothing was changed`,
      "parentId",
    );
  }

  // The changed Project's parent is reported first, then the rest in id order.
  const ordered =
    change === undefined ? proposed : [...proposed.filter((n) => n.id === change.projectId), ...proposed.filter((n) => n.id !== change.projectId)];
  for (const node of ordered) {
    if (node.parentId !== null && !parents.has(node.parentId)) {
      return fail(
        PROJECT_NOT_FOUND,
        `the parent ${node.parentId} of Project ${node.id} is not in the tree; nothing was changed`,
        "parentId",
      );
    }
  }

  if (change !== undefined) {
    // Setting A's parent to P closes a cycle exactly when walking up from P reaches A.
    if (reachesFrom(parents, change.parentId, change.projectId)) return cycle(change.parentId, change.projectId);
  }

  // Any other cycle (an inconsistent input is never passed): reported against
  // the parent of the cycle's smallest id, so the answer is order-independent.
  const settled = new Set<string>();
  for (const node of proposed) {
    const path: string[] = [];
    const onPath = new Set<string>();
    let current: string | null = node.id;
    while (current !== null && !settled.has(current)) {
      if (onPath.has(current)) {
        const loop = path.slice(path.indexOf(current)).sort();
        const smallest = loop[0] ?? current;
        return cycle(parents.get(smallest) ?? smallest, smallest);
      }
      onPath.add(current);
      path.push(current);
      current = parents.get(current) ?? null;
    }
    for (const id of path) settled.add(id);
  }
  return { ok: true };
}

/** True when walking up the parents from `start` (itself included) reaches `target`. */
function reachesFrom(parents: ReadonlyMap<string, string | null>, start: string, target: string): boolean {
  const seen = new Set<string>();
  let current: string | null = start;
  while (current !== null && !seen.has(current)) {
    if (current === target) return true;
    seen.add(current);
    current = parents.get(current) ?? null;
  }
  return false;
}

function cycle(parentId: string, projectId: string): TreeResult {
  const relation = parentId === projectId ? "is that Project itself" : `is a descendant of Project ${projectId}`;
  return fail(
    PROJECT_CYCLE,
    `Project ${parentId} ${relation}, so it cannot be its parent: that would close a cycle; nothing was changed`,
    parentId,
  );
}

/**
 * Validate the whole proposed bundle input: the tree rule first, then the
 * Conflict slot rule ({@link validatePublication} semantics) over every pair
 * of live Standards at the same Project scope, then the Locked rule check
 * ({@link validateLockedRules}). Returns `{ ok: true }` or the first error;
 * the answer does not depend on the order of the input.
 */
export function validateBundleInput(input: BundleInput): TreeResult {
  const tree = validateProjectTree(input.projects, input.change);
  if (!tree.ok) return tree;
  const standards = [...input.standards].sort((a, b) =>
    a.standardId < b.standardId ? -1 : a.standardId > b.standardId ? 1 : 0,
  );
  const [first, ...rest] = standards;
  if (first === undefined) return { ok: true };
  const slots = validatePublication(rest, first);
  if (!slots.ok) return { ok: false, error: slots.error };
  return validateLockedRules(input);
}
