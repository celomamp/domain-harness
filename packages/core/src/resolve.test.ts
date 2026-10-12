import { describe, expect, it } from "vitest";
import { resolveEffectiveSet } from "./index.ts";
import type { ConflictSlot, ResolveInput, SlotHolder, TreeNode } from "./index.ts";

const node = (id: string, parentId: string | null): TreeNode => ({ id, parentId });
const library = (name: string): ConflictSlot => ({ moduleKind: "code-stack", slotKind: "library", name });
const token = (name: string): ConflictSlot => ({ moduleKind: "design-system", slotKind: "token", name });
const holder = (standardId: string, projectId: string, slot: ConflictSlot): SlotHolder => ({ standardId, projectId, slot });

// p ─┬─ c ── g
//    └─ s
const tree = [node("p", null), node("c", "p"), node("g", "c"), node("s", "p")];

const resolve = (projectId: string, standards: SlotHolder[], lockedStandardIds: string[] = [], projects = tree) =>
  resolveEffectiveSet({ projects, standards, lockedStandardIds, projectId });

describe("resolveEffectiveSet", () => {
  const parentX = holder("std-p", "p", library("X"));
  const childX = holder("std-c", "c", library("x"));

  it("lets the Standard closest to the Project win its Conflict slot", () => {
    expect(resolve("c", [parentX, childX])).toEqual({
      ok: true,
      set: [{ standardId: "std-c", slot: library("x"), sourceProjectId: "c", locked: false }],
    });
    // A grandchild with nothing of its own inherits its parent's winner.
    expect(resolve("g", [parentX, childX])).toEqual({
      ok: true,
      set: [{ standardId: "std-c", slot: library("x"), sourceProjectId: "c", locked: false }],
    });
  });

  it("lets an ancestor's Standard reach the Project, and never a descendant's", () => {
    expect(resolve("p", [parentX, childX])).toEqual({
      ok: true,
      set: [{ standardId: "std-p", slot: library("X"), sourceProjectId: "p", locked: false }],
    });
  });

  it("keeps Standards in different slots side by side, in the deterministic order", () => {
    const result = resolve("c", [holder("lib", "c", library("React")), holder("tok", "p", token("primary"))]);
    expect(result).toEqual({
      ok: true,
      set: [
        { standardId: "lib", slot: library("React"), sourceProjectId: "c", locked: false },
        { standardId: "tok", slot: token("primary"), sourceProjectId: "p", locked: false },
      ],
    });
  });

  it("ignores Standards off the path, even when they would conflict", () => {
    const sibling = [holder("s1", "s", library("X")), holder("s2", "s", library("X"))];
    expect(resolve("c", [parentX, ...sibling])).toEqual({
      ok: true,
      set: [{ standardId: "std-p", slot: library("X"), sourceProjectId: "p", locked: false }],
    });
  });

  it("never replaces an ancestor's Locked rule", () => {
    expect(resolve("c", [parentX, childX], ["std-p"])).toEqual({
      ok: true,
      set: [{ standardId: "std-p", slot: library("X"), sourceProjectId: "p", locked: true }],
    });
    // Among locked holders, the one nearest the root wins.
    expect(resolve("g", [parentX, childX, holder("std-g", "g", library("X"))], ["std-c", "std-p"])).toEqual({
      ok: true,
      set: [{ standardId: "std-p", slot: library("X"), sourceProjectId: "p", locked: true }],
    });
    // A locked Standard at the Project itself still beats an unlocked ancestor.
    expect(resolve("c", [parentX, childX], ["std-c"])).toEqual({
      ok: true,
      set: [{ standardId: "std-c", slot: library("x"), sourceProjectId: "c", locked: true }],
    });
  });

  it("refuses two Standards in one slot at one scope, naming both, for any input order", () => {
    const a = holder("std-b", "c", library("X"));
    const b = holder("std-a", "c", library(" x "));
    const first = resolve("g", [a, b, parentX]);
    const second = resolve("g", [parentX, b, a]);
    expect(first).toEqual(second);
    expect(first).toMatchObject({ ok: false, error: { code: "slot_conflict", subject: "std-a" } });
    const message = first.ok ? "" : first.error.message;
    expect(message).toContain("std-a");
    expect(message).toContain("std-b");
  });

  it("refuses a Project that is not in the tree", () => {
    expect(resolve("nope", [parentX])).toMatchObject({
      ok: false,
      error: { code: "project_not_found", subject: "projectId" },
    });
  });

  it("returns the tree rule's error for an invalid tree", () => {
    const twoRoots = [node("p", null), node("q", null)];
    expect(resolve("p", [], [], twoRoots)).toMatchObject({ ok: false, error: { code: "invalid_input" } });
  });

  it("returns an empty set when no Standard applies", () => {
    expect(resolve("c", [])).toEqual({ ok: true, set: [] });
    expect(resolve("c", [holder("x", "s", library("X"))])).toEqual({ ok: true, set: [] });
  });

  it("does not depend on the input order", () => {
    const standards = [parentX, childX, holder("lib", "c", library("React")), holder("tok", "p", token("primary"))];
    const input: ResolveInput = { projects: tree, standards, lockedStandardIds: ["std-p", "tok"], projectId: "g" };
    const reversed: ResolveInput = {
      projects: [...tree].reverse(),
      standards: [...standards].reverse(),
      lockedStandardIds: ["tok", "std-p"],
      projectId: "g",
    };
    expect(JSON.stringify(resolveEffectiveSet(input))).toBe(JSON.stringify(resolveEffectiveSet(reversed)));
  });
});
