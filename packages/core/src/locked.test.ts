import { describe, expect, it } from "vitest";
import { resolveEffectiveSet, validateBundleInput, validateLockedRules } from "./index.ts";
import type { BundleInput, ConflictSlot, SlotHolder, TreeNode } from "./index.ts";

const node = (id: string, parentId: string | null): TreeNode => ({ id, parentId });
const library = (name: string): ConflictSlot => ({ moduleKind: "code-stack", slotKind: "library", name });
const token = (name: string): ConflictSlot => ({ moduleKind: "design-system", slotKind: "token", name });
const holder = (standardId: string, slot: ConflictSlot, projectId: string): SlotHolder => ({ standardId, projectId, slot });

// p ─┬─ c ── g
//    ├─ s1
//    └─ s2
//    q (child of p, moved around by the change tests)
const tree = [node("p", null), node("c", "p"), node("g", "c"), node("s1", "p"), node("s2", "p"), node("q", "s1")];

const sAtP = holder("std-s", library("X"), "p");
const tAtG = holder("std-t", library("x"), "g");

function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let state = seed;
  for (let i = out.length - 1; i > 0; i -= 1) {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

describe("validateLockedRules", () => {
  it("passes when only one holder of the slot is locked", () => {
    const input = { projects: tree, standards: [sAtP, tAtG], lockedStandardIds: ["std-s"] };
    expect(validateLockedRules(input)).toEqual({ ok: true });
    expect(validateBundleInput(input)).toEqual({ ok: true });
  });

  it("refuses a descendant Locked rule under an ancestor's, naming both, subject = the ancestor's Standard", () => {
    const result = validateBundleInput({ projects: tree, standards: [sAtP, tAtG], lockedStandardIds: ["std-s", "std-t"] });
    expect(result).toMatchObject({ ok: false, error: { code: "locked_rule_conflict", subject: "std-s" } });
    const message = result.ok ? "" : result.error.message;
    for (const part of ["std-s", "std-t", "Project p", "Project g", '(code stack, library, "X")']) {
      expect(message).toContain(part);
    }
  });

  it("names the other Standard as subject when the proposal is the descendant", () => {
    const input = { projects: tree, standards: [sAtP, tAtG], lockedStandardIds: ["std-s", "std-t"], lockProposal: "std-t" };
    expect(validateBundleInput(input)).toMatchObject({ ok: false, error: { code: "locked_rule_conflict", subject: "std-s" } });
  });

  it("names the other Standard as subject when the proposal is the ancestor", () => {
    const input = { projects: tree, standards: [sAtP, tAtG], lockedStandardIds: ["std-s", "std-t"], lockProposal: "std-s" };
    expect(validateBundleInput(input)).toMatchObject({ ok: false, error: { code: "locked_rule_conflict", subject: "std-t" } });
  });

  it("reports a pair involving the proposal before any other pair", () => {
    // An older contradiction (a at p, b at c), and the proposal z at g contradicting y at c.
    const a = holder("std-a", library("A"), "p");
    const b = holder("std-b", library("a"), "c");
    const y = holder("std-y", token("primary"), "c");
    const z = holder("std-z", token("Primary"), "g");
    const withoutProposal = { projects: tree, standards: [a, b, y, z], lockedStandardIds: ["std-a", "std-b", "std-y", "std-z"] };
    expect(validateBundleInput({ ...withoutProposal, lockProposal: "std-z" })).toMatchObject({
      ok: false,
      error: { subject: "std-y" },
    });
    expect(validateBundleInput(withoutProposal)).toMatchObject({ ok: false, error: { subject: "std-a" } });
  });

  it("accepts Locked rules in one slot on sibling Projects", () => {
    const input = {
      projects: tree,
      standards: [holder("std-1", library("X"), "s1"), holder("std-2", library("X"), "s2")],
      lockedStandardIds: ["std-1", "std-2"],
    };
    expect(validateBundleInput(input)).toEqual({ ok: true });
  });

  it("accepts Locked rules in different slots on one path", () => {
    const input = {
      projects: tree,
      standards: [sAtP, holder("std-t", token("X"), "g")],
      lockedStandardIds: ["std-s", "std-t"],
    };
    expect(validateBundleInput(input)).toEqual({ ok: true });
  });

  it("refuses a change that puts a Locked rule under a contradicting ancestor Locked rule", () => {
    const q = holder("std-q", library("x"), "q");
    const base = { projects: tree, standards: [holder("std-c", library("X"), "c"), q], lockedStandardIds: ["std-c", "std-q"] };
    expect(validateBundleInput(base)).toEqual({ ok: true });
    expect(validateBundleInput({ ...base, change: { projectId: "q", parentId: "g" } })).toMatchObject({
      ok: false,
      error: { code: "locked_rule_conflict", subject: "std-c" },
    });
  });

  it("ignores locked ids that match no holder", () => {
    const input = { projects: tree, standards: [sAtP, tAtG], lockedStandardIds: ["std-s", "std-unknown"] };
    expect(validateBundleInput(input)).toEqual({ ok: true });
  });

  it("checks the tree and the slot rule first", () => {
    const tie = [sAtP, holder("std-u", library("X"), "p")];
    expect(validateBundleInput({ projects: tree, standards: tie, lockedStandardIds: ["std-s", "std-u"] })).toMatchObject({
      ok: false,
      error: { code: "slot_conflict" },
    });
    expect(
      validateBundleInput({ projects: tree, standards: [sAtP, tAtG], lockedStandardIds: ["std-s", "std-t"], change: { projectId: "c", parentId: "g" } }),
    ).toMatchObject({ ok: false, error: { code: "project_cycle" } });
  });

  it("gives the identical answer for shuffled input", () => {
    const standards = [
      sAtP,
      tAtG,
      holder("std-1", library("X"), "s1"),
      holder("std-2", token("t"), "c"),
      holder("std-3", token("T"), "g"),
    ];
    const locked = standards.map((h) => h.standardId);
    const expected = JSON.stringify(validateBundleInput({ projects: tree, standards, lockedStandardIds: locked }));
    expect(expected).toContain("locked_rule_conflict");
    for (let seed = 1; seed <= 20; seed += 1) {
      const input: BundleInput = {
        projects: shuffled(tree, seed),
        standards: shuffled(standards, seed + 100),
        lockedStandardIds: shuffled(locked, seed + 200),
      };
      expect(JSON.stringify(validateBundleInput(input))).toBe(expected);
    }
  });
});

describe("a Locked rule in the Effective Standard set", () => {
  it("beats a closer Standard, and the closer one wins again once unmarked", () => {
    const allowed = { ...holder("std-c", library("x"), "c") };
    const locked = resolveEffectiveSet({ projects: tree, standards: [sAtP, allowed], lockedStandardIds: ["std-s"], projectId: "c" });
    expect(locked).toEqual({
      ok: true,
      set: [{ standardId: "std-s", slot: library("X"), sourceProjectId: "p", locked: true }],
    });
    const unmarked = resolveEffectiveSet({ projects: tree, standards: [sAtP, allowed], lockedStandardIds: [], projectId: "c" });
    expect(unmarked).toEqual({
      ok: true,
      set: [{ standardId: "std-c", slot: library("x"), sourceProjectId: "c", locked: false }],
    });
  });
});
