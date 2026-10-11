/**
 * The Conflict slot rule (AD-13): a slot is the tuple (Module kind, slot kind,
 * name). Two different live Standards holding equal slots at the same Project
 * scope are a conflict, across Modules. Equal names in different kinds never
 * compete.
 *
 * Pure: no I/O, no clock, no network. The registry builds the whole proposed
 * live set and asks {@link validatePublication}; it never re-implements or
 * post-processes the answer.
 */
import { MODULE_KIND_LABELS, SLOT_CONFLICT } from "@domain-harness/contract";
import type { CodeStackEntry, ErrorEnvelope, ModuleKind } from "@domain-harness/contract";

/** The Conflict slot of one Standard. */
export interface ConflictSlot {
  readonly moduleKind: ModuleKind;
  /** For code stack: the entry's category (language, framework or library). */
  readonly slotKind: string;
  /** The slot name in the Standard owner's spelling; compared through {@link normalizeSlotName}. */
  readonly name: string;
}

/** One Standard's live version as the slot rule sees it. */
export interface SlotHolder {
  readonly standardId: string;
  /** The Project scope the Standard is published at. */
  readonly projectId: string;
  readonly slot: ConflictSlot;
}

export type PublicationResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      /** `slot_conflict`; `subject` is the id of the Standard already holding the slot. */
      readonly error: ErrorEnvelope;
      /** [proposed Standard id, Standard already holding the slot]. */
      readonly standards: readonly [string, string];
      readonly slot: ConflictSlot;
    };

/** The compared form of a slot name: trimmed, Unicode NFC, lowercase. */
export function normalizeSlotName(name: string): string {
  return name.trim().normalize("NFC").toLowerCase();
}

/** The Conflict slot of a code-stack entry: (code stack, category, name). */
export function codeStackSlot(entry: Pick<CodeStackEntry, "category" | "name">): ConflictSlot {
  return { moduleKind: "code-stack", slotKind: entry.category, name: entry.name };
}

/** True when both slots have the same Module kind, slot kind and normalised name. */
export function sameSlot(a: ConflictSlot, b: ConflictSlot): boolean {
  return (
    a.moduleKind === b.moduleKind && a.slotKind === b.slotKind && normalizeSlotName(a.name) === normalizeSlotName(b.name)
  );
}

/** A slot as the management panel writes it, for example `(code stack, library, "React")`. */
export function formatSlot(slot: ConflictSlot): string {
  return `(${MODULE_KIND_LABELS[slot.moduleKind]}, ${slot.slotKind}, "${slot.name.trim()}")`;
}

function conflicts(a: SlotHolder, b: SlotHolder): boolean {
  return a.standardId !== b.standardId && a.projectId === b.projectId && sameSlot(a.slot, b.slot);
}

/**
 * Validate the whole proposed live set: `live` is every Standard's current
 * live version; `proposed` is the version about to be published (a new
 * Standard, or a new version that replaces its own Standard's live version).
 *
 * Returns `{ ok: true }`, or a `slot_conflict` naming both Standards and the
 * slot. A conflict involving the proposed version is reported first; the set
 * is otherwise checked pair by pair, so an inconsistent input is never passed.
 * Re-publishing a Standard in its own slot is never a conflict.
 */
export function validatePublication(live: readonly SlotHolder[], proposed: SlotHolder): PublicationResult {
  const others = live.filter((holder) => holder.standardId !== proposed.standardId);
  const clash = others.find((holder) => conflicts(proposed, holder));
  if (clash !== undefined) return conflict(proposed, clash);
  for (let i = 0; i < others.length; i += 1) {
    for (let j = i + 1; j < others.length; j += 1) {
      const a = others[i];
      const b = others[j];
      if (a !== undefined && b !== undefined && conflicts(a, b)) return conflict(b, a);
    }
  }
  return { ok: true };
}

function conflict(proposed: SlotHolder, existing: SlotHolder): PublicationResult {
  const slot = existing.slot;
  return {
    ok: false,
    error: {
      code: SLOT_CONFLICT,
      message:
        `Standard ${proposed.standardId} and Standard ${existing.standardId} would both hold the Conflict slot ` +
        `${formatSlot(slot)} at Project ${existing.projectId}; nothing was published`,
      subject: existing.standardId,
    },
    standards: [proposed.standardId, existing.standardId],
    slot,
  };
}
