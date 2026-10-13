import { describe, expect, it } from "vitest";
import { validateBundleInput, validateProjectTree } from "./index.ts";
import type { ConflictSlot, SlotHolder, TreeNode } from "./index.ts";

const node = (id: string, parentId: string | null): TreeNode => ({ id, parentId });
const library = (name: string): ConflictSlot => ({ moduleKind: "code-stack", slotKind: "library", name });
const holder = (standardId: string, slot: ConflictSlot, projectId = "root"): SlotHolder => ({ standardId, projectId, slot });

// root ─┬─ a ── b ── c
//       └─ d
const deep = [node("root", null), node("a", "root"), node("b", "a"), node("c", "b"), node("d", "root")];

/** A deterministic shuffle (a fixed permutation per seed), so the test does not read a random source. */
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

describe("validateProjectTree", () => {
  it("passes a lone root and a valid deep tree", () => {
    expect(validateProjectTree([node("root", null)])).toEqual({ ok: true });
    expect(validateProjectTree(deep)).toEqual({ ok: true });
  });

  it("passes a valid re-parent and applies it idempotently", () => {
    expect(validateProjectTree(deep, { projectId: "c", parentId: "d" })).toEqual({ ok: true });
    const applied = deep.map((n) => (n.id === "c" ? node("c", "d") : n));
    expect(validateProjectTree(applied, { projectId: "c", parentId: "d" })).toEqual({ ok: true });
  });

  it("refuses a Project as its own parent, naming it", () => {
    const result = validateProjectTree(deep, { projectId: "a", parentId: "a" });
    expect(result).toMatchObject({ ok: false, error: { code: "project_cycle", subject: "a" } });
    expect(result.ok ? "" : result.error.message).toContain("Project a is that Project itself");
  });

  it("refuses a 2-node cycle, naming the parent that closes it", () => {
    // b is a child of a; setting a's parent to b closes the cycle at b.
    const result = validateProjectTree(deep, { projectId: "a", parentId: "b" });
    expect(result).toMatchObject({ ok: false, error: { code: "project_cycle", subject: "b" } });
    expect(result.ok ? "" : result.error.message).toContain("Project b is a descendant of Project a");
  });

  it("refuses a 3-node cycle, naming the parent that closes it", () => {
    const result = validateProjectTree(deep, { projectId: "a", parentId: "c" });
    expect(result).toMatchObject({ ok: false, error: { code: "project_cycle", subject: "c" } });
  });

  it("refuses a cycle already in the input, order-independently", () => {
    const looped = [node("root", null), node("x", "y"), node("y", "x")];
    const expected = { ok: false, error: { code: "project_cycle", subject: "y" } };
    expect(validateProjectTree(looped)).toMatchObject(expected);
    expect(validateProjectTree([...looped].reverse())).toMatchObject(expected);
  });

  it("refuses no root and two roots", () => {
    expect(validateProjectTree([node("a", "b"), node("b", "a")])).toMatchObject({
      ok: false,
      error: { code: "invalid_input", subject: "parentId" },
    });
    expect(validateProjectTree([node("root", null), node("other", null)])).toMatchObject({
      ok: false,
      error: { code: "invalid_input", subject: "parentId" },
    });
    expect(validateProjectTree([])).toMatchObject({ ok: false, error: { code: "invalid_input" } });
  });

  it("refuses an unknown parent and an unknown changed Project", () => {
    expect(validateProjectTree(deep, { projectId: "c", parentId: "nowhere" })).toMatchObject({
      ok: false,
      error: { code: "project_not_found", subject: "parentId" },
    });
    expect(validateProjectTree([node("root", null), node("a", "ghost")])).toMatchObject({
      ok: false,
      error: { code: "project_not_found", subject: "parentId" },
    });
    expect(validateProjectTree(deep, { projectId: "ghost", parentId: "root" })).toMatchObject({
      ok: false,
      error: { code: "project_not_found", subject: "projectId" },
    });
  });

  it("refuses a duplicated id", () => {
    expect(validateProjectTree([node("root", null), node("a", "root"), node("a", "root")])).toMatchObject({
      ok: false,
      error: { code: "invalid_input" },
    });
  });
});

describe("validateBundleInput", () => {
  const standards = [holder("s1", library("react")), holder("s2", library("vue")), holder("s3", library("react"), "a")];

  it("passes a valid tree with Standards in distinct slots (the same slot at another scope too)", () => {
    expect(validateBundleInput({ projects: deep, standards })).toEqual({ ok: true });
    expect(validateBundleInput({ projects: deep, standards, change: { projectId: "b", parentId: "d" } })).toEqual({
      ok: true,
    });
  });

  it("checks the tree before the Standards", () => {
    const conflicting = [...standards, holder("s4", library("REACT"))];
    expect(
      validateBundleInput({ projects: deep, standards: conflicting, change: { projectId: "a", parentId: "c" } }),
    ).toMatchObject({ ok: false, error: { code: "project_cycle", subject: "c" } });
  });

  it("refuses conflicting Standards in the bundle, naming both", () => {
    const result = validateBundleInput({ projects: deep, standards: [...standards, holder("s4", library(" REACT "))] });
    expect(result).toMatchObject({ ok: false, error: { code: "slot_conflict" } });
    const message = result.ok ? "" : result.error.message;
    expect(message).toContain("s1");
    expect(message).toContain("s4");
  });

  it("is deterministic: the same input in shuffled order gives the same result", () => {
    const conflicting = [...standards, holder("s4", library("react")), holder("s5", library("vue"))];
    const cases = [
      { projects: deep, standards },
      { projects: deep, standards: conflicting },
      { projects: deep, standards, change: { projectId: "a", parentId: "c" } },
      { projects: [...deep, node("e", "f"), node("f", "e")], standards },
    ];
    for (const input of cases) {
      const expected = JSON.stringify(validateBundleInput(input));
      for (let seed = 1; seed <= 25; seed += 1) {
        const again = validateBundleInput({
          ...input,
          projects: shuffled(input.projects, seed),
          standards: shuffled(input.standards, seed * 7),
        });
        expect(JSON.stringify(again)).toBe(expected);
      }
    }
  });
  describe("the Applications rule", () => {
    const app = (id: string, projectId: string) => ({ id, projectId });

    it("passes Applications on Projects of the tree, and no Applications at all", () => {
      expect(validateBundleInput({ projects: deep, standards, applications: [app("x", "a"), app("y", "root")] })).toEqual({
        ok: true,
      });
      expect(validateBundleInput({ projects: deep, standards, applications: [] })).toEqual({ ok: true });
    });

    it("refuses a duplicated Application id", () => {
      expect(
        validateBundleInput({ projects: deep, standards, applications: [app("x", "a"), app("x", "b")] }),
      ).toMatchObject({ ok: false, error: { code: "invalid_input", subject: "applicationId" } });
    });

    it("refuses an Application on a Project that is not in the tree", () => {
      const result = validateBundleInput({ projects: deep, standards, applications: [app("x", "a"), app("y", "zz")] });
      expect(result).toMatchObject({ ok: false, error: { code: "project_not_found", subject: "projectId" } });
      expect(result.ok ? "" : result.error.message).toContain("zz");
    });

    it("checks the tree first, and the Applications before the Standards", () => {
      expect(
        validateBundleInput({
          projects: deep,
          standards,
          change: { projectId: "a", parentId: "c" },
          applications: [app("x", "zz")],
        }),
      ).toMatchObject({ ok: false, error: { code: "project_cycle" } });
      expect(
        validateBundleInput({
          projects: deep,
          standards: [...standards, holder("s4", library("react"))],
          applications: [app("x", "zz")],
        }),
      ).toMatchObject({ ok: false, error: { code: "project_not_found", subject: "projectId" } });
    });

    it("is order-independent", () => {
      const applications = [app("x", "zz"), app("y", "a"), app("z", "yy"), app("y", "b")];
      const expected = JSON.stringify(validateBundleInput({ projects: deep, standards, applications }));
      for (let seed = 1; seed <= 25; seed += 1) {
        const again = validateBundleInput({ projects: shuffled(deep, seed), standards, applications: shuffled(applications, seed * 3) });
        expect(JSON.stringify(again)).toBe(expected);
      }
      const missing = [app("x", "zz"), app("y", "a"), app("z", "yy")];
      const first = JSON.stringify(validateBundleInput({ projects: deep, standards, applications: missing }));
      expect(first).toContain("zz");
      for (let seed = 1; seed <= 25; seed += 1) {
        expect(JSON.stringify(validateBundleInput({ projects: deep, standards, applications: shuffled(missing, seed) }))).toBe(first);
      }
    });
  });
});
