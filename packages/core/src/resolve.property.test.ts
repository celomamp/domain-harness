/**
 * Property test for the Effective Standard set (NFR-1): over seeded random
 * Project trees and Standards, the resolver's answer does not depend on the
 * input order, is identical on every call, and matches a brute-force oracle
 * built differently from the implementation. No random source is read: a
 * small seeded PRNG (mulberry32) drives every case.
 */
import { describe, expect, it } from "vitest";
import { normalizeSlotName, resolveEffectiveSet } from "./index.ts";
import type { ConflictSlot, EffectiveEntry, ResolveInput, SlotHolder, TreeNode } from "./index.ts";

type Random = () => number;

function mulberry32(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const int = (random: Random, max: number): number => Math.floor(random() * max);
const pick = <T>(random: Random, items: readonly T[]): T => items[int(random, items.length)] as T;

function shuffle<T>(random: Random, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = int(random, i + 1);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/** A small pool of slots, each with spellings that normalise equal. */
const SLOT_POOL: readonly (readonly ConflictSlot[])[] = [
  [
    { moduleKind: "code-stack", slotKind: "library", name: "React" },
    { moduleKind: "code-stack", slotKind: "library", name: " react " },
  ],
  [{ moduleKind: "code-stack", slotKind: "library", name: "Vue" }],
  [
    { moduleKind: "code-stack", slotKind: "framework", name: "React" },
    { moduleKind: "code-stack", slotKind: "framework", name: "REACT" },
  ],
  [{ moduleKind: "code-stack", slotKind: "language", name: "TypeScript" }],
  [
    { moduleKind: "design-system", slotKind: "token", name: "primary" },
    { moduleKind: "design-system", slotKind: "token", name: "Primary" },
  ],
  [{ moduleKind: "design-system", slotKind: "component", name: "Button" }],
  [{ moduleKind: "design-system", slotKind: "import", name: "@acme/ui" }],
];

/** An id that is not ordered like creation, so no accidental order is relied on. */
const randomId = (random: Random, prefix: string, used: Set<string>): string => {
  for (;;) {
    const id = `${prefix}-${int(random, 1_000_000).toString(36)}`;
    if (!used.has(id)) {
      used.add(id);
      return id;
    }
  }
};

interface Case {
  readonly input: ResolveInput;
  readonly random: Random;
}

function randomCase(seed: number): Case {
  const random = mulberry32(seed);
  const used = new Set<string>();
  const size = 1 + int(random, 12);
  const projects: TreeNode[] = [];
  for (let i = 0; i < size; i += 1) {
    const id = randomId(random, "p", used);
    projects.push({ id, parentId: i === 0 ? null : (pick(random, projects).id) });
  }
  const standards: SlotHolder[] = [];
  const lockedStandardIds: string[] = [];
  for (const project of projects) {
    for (const spellings of SLOT_POOL) {
      if (random() < 0.35) {
        const standardId = randomId(random, "s", used);
        standards.push({ standardId, projectId: project.id, slot: pick(random, spellings) });
        if (random() < 0.2) lockedStandardIds.push(standardId);
      }
    }
  }
  return { input: { projects, standards, lockedStandardIds, projectId: pick(random, projects).id }, random };
}

const shuffled = (random: Random, input: ResolveInput): ResolveInput => ({
  projects: shuffle(random, input.projects),
  standards: shuffle(random, input.standards),
  lockedStandardIds: shuffle(random, input.lockedStandardIds),
  projectId: input.projectId,
});

/** The ancestors of `projectId`, from the Project itself to the root. */
function pathToRoot(projects: readonly TreeNode[], projectId: string): string[] {
  const path: string[] = [];
  let current: string | null | undefined = projectId;
  while (current !== null && current !== undefined) {
    path.push(current);
    current = projects.find((node) => node.id === current)?.parentId;
  }
  return path;
}

/**
 * The oracle: for each slot key, list the holders on the path from the
 * Project to the root; the answer is the last locked holder when there is
 * one, otherwise the first holder.
 */
function oracle(input: ResolveInput): EffectiveEntry[] {
  const path = pathToRoot(input.projects, input.projectId);
  const keyOf = (slot: ConflictSlot): string => [slot.moduleKind, slot.slotKind, normalizeSlotName(slot.name)].join("\u0000");
  const keys = [...new Set(input.standards.map((h) => keyOf(h.slot)))];
  const out: EffectiveEntry[] = [];
  for (const key of keys) {
    const along: SlotHolder[] = [];
    for (const projectId of path) {
      along.push(...input.standards.filter((h) => h.projectId === projectId && keyOf(h.slot) === key));
    }
    const locked = along.filter((h) => input.lockedStandardIds.includes(h.standardId));
    const winner = locked.length > 0 ? locked[locked.length - 1] : along[0];
    if (winner !== undefined) {
      out.push({
        standardId: winner.standardId,
        slot: winner.slot,
        sourceProjectId: winner.projectId,
        locked: locked.length > 0,
      });
    }
  }
  const tuple = (e: EffectiveEntry): string[] => [e.slot.moduleKind, e.slot.slotKind, normalizeSlotName(e.slot.name), e.standardId];
  return out.sort((a, b) => {
    const [x, y] = [tuple(a), tuple(b)];
    for (let i = 0; i < x.length; i += 1) {
      const [p, q] = [x[i] ?? "", y[i] ?? ""];
      if (p !== q) return p < q ? -1 : 1;
    }
    return 0;
  });
}

describe("resolveEffectiveSet property", () => {
  it("is order-independent, repeatable and matches the oracle over 300 random trees", () => {
    let entries = 0;
    let lockedWins = 0;
    let inherited = 0;
    for (let seed = 1; seed <= 300; seed += 1) {
      const { input, random } = randomCase(seed);
      const result = resolveEffectiveSet(input);
      const text = JSON.stringify(result);
      expect(JSON.stringify(resolveEffectiveSet(input)), `seed ${String(seed)}`).toBe(text);
      expect(JSON.stringify(resolveEffectiveSet(shuffled(random, input))), `seed ${String(seed)}`).toBe(text);
      expect(result, `seed ${String(seed)}`).toEqual({ ok: true, set: oracle(input) });
      const set = result.ok ? result.set : [];
      entries += set.length;
      lockedWins += set.filter((e) => e.locked).length;
      inherited += set.filter((e) => e.sourceProjectId !== input.projectId).length;
    }
    // The generator exercises every rule, not only empty sets.
    expect(entries).toBeGreaterThan(300);
    expect(lockedWins).toBeGreaterThan(0);
    expect(inherited).toBeGreaterThan(0);
  });

  it("refuses a same-scope duplicate on the path with a stable slot_conflict", () => {
    for (let seed = 1001; seed <= 1300; seed += 1) {
      const { input, random } = randomCase(seed);
      const path = pathToRoot(input.projects, input.projectId);
      const scope = pick(random, path);
      const spellings = pick(random, SLOT_POOL);
      const used = new Set(input.standards.map((h) => h.standardId));
      const extra = [
        { standardId: randomId(random, "d", used), projectId: scope, slot: pick(random, spellings) },
        { standardId: randomId(random, "d", used), projectId: scope, slot: pick(random, spellings) },
      ];
      // Drop any holder already at that scope in that slot, so exactly one pair conflicts.
      const key = normalizeSlotName(spellings[0]?.name ?? "");
      const base = input.standards.filter(
        (h) =>
          !(
            h.projectId === scope &&
            h.slot.moduleKind === spellings[0]?.moduleKind &&
            h.slot.slotKind === spellings[0].slotKind &&
            normalizeSlotName(h.slot.name) === key
          ),
      );
      const withDuplicate: ResolveInput = { ...input, standards: [...base, ...extra] };
      const result = resolveEffectiveSet(withDuplicate);
      const ids = extra.map((h) => h.standardId).sort();
      expect(result, `seed ${String(seed)}`).toMatchObject({ ok: false, error: { code: "slot_conflict", subject: ids[0] } });
      const message = result.ok ? "" : result.error.message;
      for (const id of ids) expect(message).toContain(id);
      expect(JSON.stringify(resolveEffectiveSet(shuffled(random, withDuplicate)))).toBe(JSON.stringify(result));
    }
  });
});
