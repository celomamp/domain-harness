/**
 * Property test for the Deviation evaluator: over seeded random Effective
 * Standard sets, facts and accepted deviations, the answer does not depend on
 * the order of the inputs' arrays, is identical on every call, and carries a
 * consistent set of keys, counts and acceptance statuses. No random source is
 * read: a small seeded PRNG (mulberry32) drives every case.
 */
import { describe, expect, it } from "vitest";
import { evaluateDeviations } from "./index.ts";
import type {
  AcceptedDeviation,
  CodeStackEntry,
  Deviation,
  DesignSystemEntry,
  EffectiveStandard,
  EffectiveStandardSet,
  ProjectRef,
  RevisionFacts,
  UuidV7,
} from "@domain-harness/contract";

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

const APPLICATION_ID = "018f3d2a-7000-7000-8000-000000000001" as UuidV7;
const PROJECT_ID = "018f3d2a-7000-7000-8000-000000000002" as UuidV7;
const NOW = "2026-06-15T12:00:00.000Z";
const projectRef: ProjectRef = { id: PROJECT_ID, name: "Root" };

/** Sequential ids within one case; the shuffle, not the id, carries the order independence. */
let counter = 0;
const nextId = (): UuidV7 => {
  counter += 1;
  return `01940000-0000-7000-8000-${String(counter).padStart(12, "0")}` as UuidV7;
};

// Spellings that normalise equal, and names that never collide.
const LIBRARY_SLOTS: readonly (readonly string[])[] = [
  ["React", " react "],
  ["REACT"],
  ["Lodash"],
];
const FRAMEWORK_SLOTS: readonly (readonly string[])[] = [["Vue"]];
const LANGUAGE_SLOTS: readonly (readonly string[])[] = [["TypeScript"]];
const TOKEN_SLOTS: readonly (readonly string[])[] = [["--color-primary"], ["--color-bg"]];
const IMPORT_SLOTS: readonly (readonly string[])[] = [["@acme/ui"], ["@acme/legacy"]];
const COMPONENT_SLOTS: readonly (readonly string[])[] = [["Button"], ["button"], ["Card"]];

const DEPENDENCY_VERSIONS = ["18.2.0", "16.8.0", "^18.0.0", "1.2.3-beta.1+build", "latest", "18.2"];
const CONSTRAINTS: readonly (string | null)[] = [null, "*", "^18.0.0", ">=16", "2.0.0", "bogus", "^1.0.0 || ^2.0.0"];
const INSTRUCTIONS: readonly (string | null)[] = [null, "", "Use the shared helper instead."];
const SPECIFIERS = ["button", "Button", "@acme/ui/Button", "@acme/ui/DatePicker", "./helpers", "react"];
const TOKEN_NAMES = ["--color-primary", "--color-bg"];

function randomCodeStackEntry(random: Random): CodeStackEntry {
  const kind = pick(random, ["library", "framework", "language"] as const);
  const spellings = kind === "library" ? pick(random, LIBRARY_SLOTS) : kind === "framework" ? FRAMEWORK_SLOTS[0] : LANGUAGE_SLOTS[0];
  return {
    category: kind,
    name: pick(random, spellings ?? ["X"]),
    versionConstraint: pick(random, CONSTRAINTS),
    status: pick(random, ["approved", "prohibited", "required"] as const),
    correctionInstruction: pick(random, INSTRUCTIONS),
  };
}

function randomDesignEntry(random: Random): DesignSystemEntry {
  const kind = pick(random, ["token", "import", "component"] as const);
  if (kind === "token") {
    return { kind, name: pick(random, TOKEN_SLOTS.flat()), status: pick(random, ["required", "prohibited"] as const) };
  }
  if (kind === "import") {
    return { kind, specifier: pick(random, IMPORT_SLOTS.flat()), status: pick(random, ["required", "prohibited"] as const) };
  }
  return {
    kind,
    name: pick(random, COMPONENT_SLOTS.flat()),
    usageRule: "Use the shared component.",
    tokens: [],
    correctionInstruction: pick(random, INSTRUCTIONS),
  };
}

function toStandard(entry: CodeStackEntry | DesignSystemEntry, version: number): EffectiveStandard {
  const moduleKind = "kind" in entry ? "design-system" : "code-stack";
  return {
    slot: {
      moduleKind,
      slotKind: "kind" in entry ? entry.kind : entry.category,
      name: "kind" in entry && entry.kind === "import" ? entry.specifier : entry.name,
    },
    status: "kind" in entry ? (entry.kind === "component" ? null : entry.status) : entry.status,
    standard: {
      id: nextId(),
      version,
      module: { id: nextId(), kind: moduleKind, name: moduleKind === "code-stack" ? "Stack" : "Design" },
      project: projectRef,
      entry,
      publishedAt: "2026-01-01T00:00:00.000Z",
      publishedBy: { accountId: nextId(), name: "Owner" },
    },
    sourceProject: projectRef,
    locked: false,
  };
}

function randomFacts(random: Random): RevisionFacts {
  const dependencies: { name: string; version: string }[] = [];
  if (random() < 0.8) dependencies.push({ name: "react", version: pick(random, DEPENDENCY_VERSIONS) });
  if (random() < 0.7) dependencies.push({ name: "lodash", version: pick(random, DEPENDENCY_VERSIONS) });
  if (random() < 0.3) dependencies.push({ name: "react", version: pick(random, DEPENDENCY_VERSIONS) });
  const imports = SPECIFIERS.filter(() => random() < 0.4).map((specifier) => ({ specifier }));
  const tokens = TOKEN_NAMES.filter(() => random() < 0.5).map((name) => ({ name }));
  return {
    extractorVersion: "1.0.0",
    schemaVersion: "1.0.0",
    schemaMajor: 1,
    dependencies,
    imports,
    tokens,
    unreadable: [],
  };
}

interface Case {
  readonly input: Parameters<typeof evaluateDeviations>[0];
  readonly random: Random;
}

function randomCase(seed: number): Case {
  counter = 0;
  const random = mulberry32(seed);
  const standards: EffectiveStandard[] = [];
  for (let i = 0; i < int(random, 6); i += 1) standards.push(toStandard(randomCodeStackEntry(random), 1 + int(random, 3)));
  for (let i = 0; i < int(random, 6); i += 1) standards.push(toStandard(randomDesignEntry(random), 1 + int(random, 3)));

  const bare = {
    applicationId: APPLICATION_ID,
    facts: randomFacts(random),
    effectiveSet: { project: projectRef, standards } satisfies EffectiveStandardSet,
    accepted: [] as AcceptedDeviation[],
    now: NOW,
  };
  // Acceptances harvested from a first run, so the live-acceptance path is
  // exercised over every generated shape.
  const first = evaluateDeviations(bare);
  const accepted: AcceptedDeviation[] = (first.ok ? first.deviations : [])
    .slice(0, int(random, 4))
    .map((deviation) => ({
      applicationId: APPLICATION_ID,
      standardId: deviation.standardId,
      standardVersion: deviation.standardVersion,
      slot: deviation.slot,
      subject: deviation.subject,
      start: "2001-01-01T00:00:00.000Z",
      end: "2099-01-01T00:00:00.000Z",
    }));
  return { input: { ...bare, accepted }, random };
}

const shuffledInput = (random: Random, input: Case["input"]): Case["input"] => ({
  ...input,
  facts: {
    ...input.facts,
    dependencies: shuffle(random, [...input.facts.dependencies]),
    imports: shuffle(random, [...input.facts.imports]),
    tokens: shuffle(random, [...input.facts.tokens]),
    unreadable: shuffle(random, [...input.facts.unreadable]),
  },
  effectiveSet: { ...input.effectiveSet, standards: shuffle(random, [...input.effectiveSet.standards]) },
  accepted: shuffle(random, [...input.accepted]),
});

/** The match key of a Deviation, with the slot's name normalised. */
const keyOf = (deviation: Deviation): string =>
  JSON.stringify([
    deviation.standardId,
    deviation.standardVersion,
    deviation.slot.moduleKind,
    deviation.slot.slotKind,
    deviation.slot.name.trim().toLowerCase(),
    deviation.subject,
    deviation.kind,
  ]);

describe("evaluateDeviations property", () => {
  it("is order-independent, repeatable and internally consistent over 300 random cases", () => {
    let emitted = 0;
    let acceptedCount = 0;
    let conflicts = 0;
    let componentFindings = 0;
    for (let seed = 1; seed <= 300; seed += 1) {
      const { input, random } = randomCase(seed);
      const result = evaluateDeviations(input);
      const text = JSON.stringify(result);
      expect(JSON.stringify(evaluateDeviations(input)), `seed ${String(seed)}`).toBe(text);
      expect(JSON.stringify(evaluateDeviations(shuffledInput(random, input))), `seed ${String(seed)}`).toBe(text);
      if (!result.ok) {
        conflicts += 1;
        expect(result.error.code, `seed ${String(seed)}`).toBe("slot_conflict");
        continue;
      }

      // The Deviations are sorted by (standard id, module kind, slot kind,
      // name, subject, kind) and deduplicated by the match key plus kind.
      const keys = result.deviations.map((deviation) => [
        deviation.standardId,
        deviation.slot.moduleKind,
        deviation.slot.slotKind,
        deviation.slot.name.trim().toLowerCase(),
        deviation.subject,
        deviation.kind,
      ]);
      expect(keys, `seed ${String(seed)}`).toEqual([...keys].sort((a, b) => (a.join("\u0000") < b.join("\u0000") ? -1 : 1)));
      expect(new Set(result.deviations.map((deviation) => JSON.stringify([keyOf(deviation), deviation.kind]))).size).toBe(
        result.deviations.length,
      );

      // The counts and fraction agree with the emitted Deviations.
      const standards = new Set(input.effectiveSet.standards.map((effective) => effective.standard.id));
      expect(result.checked, `seed ${String(seed)}`).toBe(standards.size);
      const openStandards = new Set(
        result.deviations.filter((deviation) => deviation.status === "open").map((deviation) => deviation.standardId),
      );
      expect(result.open, `seed ${String(seed)}`).toBe(openStandards.size);
      expect(result.adherence, `seed ${String(seed)}`).toBe(
        result.checked === 0 ? 0 : (result.checked - result.open) / result.checked,
      );

      // Every live acceptance marks exactly its matching finding accepted.
      for (const acceptance of input.accepted) {
        const start = Date.parse(acceptance.start);
        const end = Date.parse(acceptance.end);
        const live = start <= Date.parse(input.now) && Date.parse(input.now) < end;
        const found = result.deviations.filter(
          (deviation) =>
            deviation.standardId === acceptance.standardId &&
            deviation.standardVersion === acceptance.standardVersion &&
            deviation.slot.moduleKind === acceptance.slot.moduleKind &&
            deviation.slot.slotKind === acceptance.slot.slotKind &&
            deviation.slot.name.trim().toLowerCase() === acceptance.slot.name.trim().toLowerCase() &&
            deviation.subject === acceptance.subject,
        );
        expect(found.length, `seed ${String(seed)}`).toBeGreaterThan(0);
        for (const deviation of found) {
          expect(deviation.status, `seed ${String(seed)}`).toBe(live ? "accepted" : "open");
        }
      }

      emitted += result.deviations.length;
      acceptedCount += result.deviations.filter((deviation) => deviation.status === "accepted").length;
      componentFindings += result.deviations.filter(
        (deviation) => deviation.kind === "component-outside-allow-list",
      ).length;
    }
    // The generator exercises every rule, not only empty sets: its entries
    // yield at least one Deviation per few seeds, some accepted.
    expect(emitted).toBeGreaterThan(150);
    expect(acceptedCount).toBeGreaterThan(0);
    expect(conflicts).toBeGreaterThan(0);
    expect(componentFindings).toBeGreaterThan(0);
  });
});
