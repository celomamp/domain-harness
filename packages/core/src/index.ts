import type { ErrorEnvelope } from "@domain-harness/contract";

/** Workspace name of this unit. Pure resolver core: no I/O, no clock reads, no network. */
export const packageName = "@domain-harness/core";

/** Errors from this unit use the shared envelope. */
export type CoreError = ErrorEnvelope;

export {
  codeStackSlot,
  designSystemSlot,
  entrySlot,
  formatSlot,
  normalizeSlotName,
  sameSlot,
  validatePublication,
} from "./slots.ts";
export type { ConflictSlot, PublicationResult, SlotHolder } from "./slots.ts";
export { validateBundleInput, validateProjectTree } from "./tree.ts";
export type { BundleInput, ParentChange, TreeNode, TreeResult } from "./tree.ts";
export { validateLockedRules } from "./locked.ts";
export type { LockedRulesInput, LockedRulesResult } from "./locked.ts";
export { resolveEffectiveSet } from "./resolve.ts";
export type { EffectiveEntry, ResolveInput, ResolveResult } from "./resolve.ts";
