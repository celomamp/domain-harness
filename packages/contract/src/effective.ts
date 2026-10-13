/**
 * The Effective Standard set wire contract (Story 2.3): the HTTP path, the
 * response body and its runtime guard, shared by the registry (which serves
 * the set resolved by `core`) and the panel (which previews it).
 *
 * The set is resolved from the Project up to the root: in each Conflict slot
 * the Standard scoped closest to the Project wins, and an ancestor's Locked
 * rule is never replaced. Standards in different slots never compete. The
 * order of {@link EffectiveStandardSet.standards} is `core`'s order; no
 * adapter re-sorts or filters it.
 */
import { isRecord } from "./guards.ts";
import { isUuidV7 } from "./ids.ts";
import { isModuleKind } from "./modules.ts";
import type { ModuleKind } from "./modules.ts";
import { projectPath } from "./projects.ts";
import { isCodeStackStatus, isDesignSystemStatus, isStandardInfo } from "./standards.ts";
import type { CodeStackStatus, DesignSystemStatus, ProjectRef, StandardInfo } from "./standards.ts";

/** One Conflict slot as the Effective Standard set names it, in the Standard owner's spelling. */
export interface EffectiveSlot {
  readonly moduleKind: ModuleKind;
  /** The code-stack category, or the design-system entry kind. */
  readonly slotKind: string;
  readonly name: string;
}

/** One Standard of the Effective Standard set: the winner of its Conflict slot. */
export interface EffectiveStandard {
  readonly slot: EffectiveSlot;
  /** The entry's status, or `null` for a design-system component (which has none). */
  readonly status: CodeStackStatus | DesignSystemStatus | null;
  /** The Standard's live version. */
  readonly standard: StandardInfo;
  /** The Project the winning Standard is scoped to: the Project itself or one of its ancestors. */
  readonly sourceProject: ProjectRef;
  /** True when the winner is a Locked rule. */
  readonly locked: boolean;
}

/** Response of `GET /v1/projects/{id}/effective-standards`. */
export interface EffectiveStandardSet {
  readonly project: ProjectRef;
  /** In `core`'s deterministic order: Module kind, slot kind, normalised slot name, then Standard id. */
  readonly standards: readonly EffectiveStandard[];
}

/** `GET`: 200 {@link EffectiveStandardSet} (every role). */
export function effectiveStandardsPath(projectId: string): string {
  return `${projectPath(projectId)}/effective-standards`;
}

function isProjectRef(value: unknown): value is ProjectRef {
  return isRecord(value) && isUuidV7(value["id"]) && typeof value["name"] === "string";
}

/** True when `value` is an {@link EffectiveSlot}: a Module kind, slot kind and name. Never throws. */
export function isEffectiveSlot(value: unknown): value is EffectiveSlot {
  return (
    isRecord(value) &&
    isModuleKind(value["moduleKind"]) &&
    typeof value["slotKind"] === "string" &&
    typeof value["name"] === "string"
  );
}

/** True when `value` is an {@link EffectiveStandard}. Never throws. */
export function isEffectiveStandard(value: unknown): value is EffectiveStandard {
  if (!isRecord(value)) return false;
  const status = value["status"];
  return (
    isEffectiveSlot(value["slot"]) &&
    (status === null || isCodeStackStatus(status) || isDesignSystemStatus(status)) &&
    isStandardInfo(value["standard"]) &&
    isProjectRef(value["sourceProject"]) &&
    typeof value["locked"] === "boolean"
  );
}

/** True when `value` is an {@link EffectiveStandardSet}. Never throws. */
export function isEffectiveStandardSet(value: unknown): value is EffectiveStandardSet {
  return (
    isRecord(value) &&
    isProjectRef(value["project"]) &&
    Array.isArray(value["standards"]) &&
    value["standards"].every(isEffectiveStandard)
  );
}
