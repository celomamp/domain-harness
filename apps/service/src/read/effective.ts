/**
 * The shared Effective Standard set derivation (Story 4.6): the one function
 * Guidance and the Read API resolve through by construction.
 *
 * `effectiveSetInputOf` is the `serve.ts` derivation verbatim — holders via
 * core `entrySlot` at the Standard's `project.id`, the tree from
 * `payload.tree.projects`, locked ids deduped by `standardId` in payload
 * order. `joinEffectiveSet` runs core `resolveEffectiveSet`, then the
 * registry `resolveEffectiveStandards` join verbatim (`standard` = live
 * `StandardInfo`, `sourceProject` = `{id, name}` from the payload tree,
 * `status` null for components, `locked` from the entry; core order never
 * re-sorted).
 */
import { entrySlot, resolveEffectiveSet } from "@domain-harness/core";
import type { SlotHolder } from "@domain-harness/core";
import type { EffectiveStandard, EffectiveStandardSet, ErrorEnvelope, StandardBundlePayload } from "@domain-harness/contract";
import { BUNDLE_UNREADABLE } from "@domain-harness/contract";

export type EffectiveJoinResult =
  | { readonly ok: true; readonly set: EffectiveStandardSet }
  | { readonly ok: false; readonly error: ErrorEnvelope };

/** `resolveEffectiveSet`'s inputs, derived only from the bundle payload; the Project is the caller's. */
export function effectiveSetInputOf(payload: StandardBundlePayload, projectId: string) {
  const holders: SlotHolder[] = payload.standards.map((standard) => ({
    standardId: standard.id,
    projectId: standard.project.id,
    slot: entrySlot(standard.entry),
  }));
  return {
    projects: payload.tree.projects.map((project) => ({ id: project.id, parentId: project.parentId })),
    standards: holders,
    // Locked ids deduplicated by `standardId`, in payload order.
    lockedStandardIds: [...new Set(payload.tree.lockedRules.map((mark) => mark.standardId))],
    projectId,
  };
}

/**
 * The Effective Standard set of one Project from a bundle payload: core
 * resolution, then the registry join verbatim against the payload's live
 * Standards and tree names. Core's error passes through as is (e.g. 409
 * `slot_conflict`); a resolved Standard or source Project missing from the
 * payload is `bundle_unreadable`.
 */
export function joinEffectiveSet(payload: StandardBundlePayload, projectId: string): EffectiveJoinResult {
  const resolved = resolveEffectiveSet(effectiveSetInputOf(payload, projectId));
  if (!resolved.ok) return resolved;

  const standardsById = new Map(payload.standards.map((standard) => [standard.id as string, standard]));
  const projectsById = new Map(payload.tree.projects.map((project) => [project.id as string, project]));
  const project = projectsById.get(projectId);
  if (project === undefined) {
    return {
      ok: false,
      error: {
        code: BUNDLE_UNREADABLE,
        message: "the active bundle names no such Project for its Effective Standard set",
        subject: "bundle",
      },
    };
  }

  const standards: EffectiveStandard[] = [];
  for (const entry of resolved.set) {
    const standard = standardsById.get(entry.standardId);
    const source = projectsById.get(entry.sourceProjectId);
    if (standard === undefined || source === undefined) {
      return {
        ok: false,
        error: {
          code: BUNDLE_UNREADABLE,
          message: "the active bundle is missing a resolved Standard or its source Project",
          subject: "bundle",
        },
      };
    }
    standards.push({
      slot: { moduleKind: entry.slot.moduleKind, slotKind: entry.slot.slotKind, name: entry.slot.name },
      status: "status" in standard.entry ? standard.entry.status : null,
      standard,
      sourceProject: { id: source.id, name: source.name },
      locked: entry.locked,
    });
  }

  return {
    ok: true,
    set: { project: { id: project.id, name: project.name }, standards },
  };
}
