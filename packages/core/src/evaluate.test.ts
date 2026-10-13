/**
 * Behaviour tests for the Deviation evaluator: every I/O matrix row and the
 * story's acceptance criteria, over hand-built fixtures of the wire forms.
 */
import { describe, expect, it } from "vitest";
import { evaluateDeviations, satisfiesVersionConstraint } from "./index.ts";
import type {
  AcceptedDeviation,
  CodeStackCategory,
  CodeStackEntry,
  CodeStackStatus,
  DesignSystemEntry,
  EffectiveStandard,
  EffectiveStandardSet,
  ModuleKind,
  ProjectRef,
  RevisionFacts,
  StandardEntry,
  StandardInfo,
  UuidV7,
} from "@domain-harness/contract";

const APPLICATION_ID = "018f3d2a-7000-7000-8000-000000000001" as UuidV7;
const PROJECT_ID = "018f3d2a-7000-7000-8000-000000000002" as UuidV7;
const NOW = "2026-06-15T12:00:00.000Z";

const projectRef: ProjectRef = { id: PROJECT_ID, name: "Root" };

let sequence = 0;
const nextId = (): UuidV7 => `01900000-0000-7000-8000-${String(++sequence).padStart(12, "0")}` as UuidV7;

const codeStackEntry = (
  category: CodeStackCategory,
  name: string,
  status: CodeStackStatus,
  extra: { readonly versionConstraint?: string | null; readonly correctionInstruction?: string | null } = {},
): CodeStackEntry => ({
  category,
  name,
  versionConstraint: extra.versionConstraint ?? null,
  status,
  correctionInstruction: extra.correctionInstruction ?? null,
});

const standardInfo = (id: UuidV7, version: number, moduleKind: ModuleKind, entry: StandardEntry): StandardInfo => ({
  id,
  version,
  module: { id: nextId(), kind: moduleKind, name: moduleKind === "code-stack" ? "Stack" : "Design" },
  project: projectRef,
  entry,
  publishedAt: "2026-01-01T00:00:00.000Z",
  publishedBy: { accountId: nextId(), name: "Owner" },
});

const codeStackStandard = (id: UuidV7, version: number, entry: CodeStackEntry): EffectiveStandard => ({
  slot: { moduleKind: "code-stack", slotKind: entry.category, name: entry.name },
  status: entry.status,
  standard: standardInfo(id, version, "code-stack", entry),
  sourceProject: projectRef,
  locked: false,
});

const designStandard = (id: UuidV7, version: number, entry: DesignSystemEntry): EffectiveStandard => ({
  slot: { moduleKind: "design-system", slotKind: entry.kind, name: entry.kind === "import" ? entry.specifier : entry.name },
  status: entry.kind === "component" ? null : entry.status,
  standard: standardInfo(id, version, "design-system", entry),
  sourceProject: projectRef,
  locked: false,
});

const dep = (name: string, version: string): RevisionFacts["dependencies"][number] => ({ name, version });
const imp = (specifier: string): RevisionFacts["imports"][number] => ({ specifier });
const tok = (name: string): RevisionFacts["tokens"][number] => ({ name });

const baseFacts: RevisionFacts = {
  extractorVersion: "1.0.0",
  schemaVersion: "1.0.0",
  schemaMajor: 1,
  dependencies: [],
  imports: [],
  tokens: [],
  unreadable: [],
};

const effectiveSet = (standards: readonly EffectiveStandard[]): EffectiveStandardSet => ({
  project: projectRef,
  standards,
});

const evaluate = (
  standards: readonly EffectiveStandard[],
  factOverrides: Partial<RevisionFacts> = {},
  accepted: readonly AcceptedDeviation[] = [],
  now: string = NOW,
) =>
  evaluateDeviations({
    applicationId: APPLICATION_ID,
    facts: { ...baseFacts, ...factOverrides },
    effectiveSet: effectiveSet(standards),
    accepted,
    now,
  });

const acceptance = (
  standard: EffectiveStandard,
  subject: string,
  start: string,
  end: string,
): AcceptedDeviation => ({
  applicationId: APPLICATION_ID,
  standardId: standard.standard.id,
  standardVersion: standard.standard.version,
  slot: standard.slot,
  subject,
  start,
  end,
});

describe("satisfiesVersionConstraint", () => {
  it("honours the whole grammar, failing closed", () => {
    expect(satisfiesVersionConstraint("18.2.0", "*")).toBe(true);
    expect(satisfiesVersionConstraint("18.2.0", "18.2.0")).toBe(true);
    expect(satisfiesVersionConstraint("18.2.0", "=18.2.0")).toBe(true);
    expect(satisfiesVersionConstraint("18.2.0", "18.2.1")).toBe(false);
    expect(satisfiesVersionConstraint("18.2.0", "^18")).toBe(true);
    expect(satisfiesVersionConstraint("16.8.0", "^18")).toBe(false);
    expect(satisfiesVersionConstraint("18.2.0", "^18.2")).toBe(true);
    expect(satisfiesVersionConstraint("19.0.0", "^18.2")).toBe(false);
    expect(satisfiesVersionConstraint("0.2.5", "^0.2.3")).toBe(true);
    expect(satisfiesVersionConstraint("0.3.0", "^0.2.3")).toBe(false);
    expect(satisfiesVersionConstraint("0.0.4", "^0.0.3")).toBe(false);
    expect(satisfiesVersionConstraint("18.2.5", "~18.2")).toBe(true);
    expect(satisfiesVersionConstraint("18.3.0", "~18.2")).toBe(false);
    // Missing tilde parts are wild at the upper bound.
    expect(satisfiesVersionConstraint("18.0.5", "~18")).toBe(true);
    expect(satisfiesVersionConstraint("18.9.9", "~18")).toBe(true);
    expect(satisfiesVersionConstraint("19.0.0", "~18")).toBe(false);
    expect(satisfiesVersionConstraint("18.2.9", "~18.2")).toBe(true);
    expect(satisfiesVersionConstraint("18.2.0", ">=16 <19")).toBe(true);
    expect(satisfiesVersionConstraint("19.0.0", ">=16 <19")).toBe(false);
    expect(satisfiesVersionConstraint("17.0.0", "^16.0.0 || ^17.0.0")).toBe(true);
    expect(satisfiesVersionConstraint("18.0.0", "^16.0.0 || ^17.0.0")).toBe(false);
    expect(satisfiesVersionConstraint("18.2.0", ">=18.0.0")).toBe(true);
    expect(satisfiesVersionConstraint("18.2.0", "<=18.0.0")).toBe(false);
    expect(satisfiesVersionConstraint("18.2.0", ">18.0.0")).toBe(true);
    // Prerelease and build tags are ignored; ranges and junk never resolve.
    expect(satisfiesVersionConstraint("18.2.0-beta.1+build", "^18")).toBe(true);
    expect(satisfiesVersionConstraint("^18.0.0", "^18")).toBe(false);
    expect(satisfiesVersionConstraint("latest", "*")).toBe(false);
    expect(satisfiesVersionConstraint("18.2.0", "nonsense")).toBe(false);
  });
});

describe("evaluateDeviations — the I/O matrix", () => {
  it("emits one open prohibited Deviation for a prohibited dependency present", () => {
    const lodash = codeStackStandard(nextId(), 2, codeStackEntry("library", "lodash", "prohibited"));
    const result = evaluate([lodash], { dependencies: [dep("lodash", "4.17.21")] });
    expect(result).toMatchObject({ ok: true, checked: 1, open: 1, adherence: 0 });
    if (!result.ok) return;
    expect(result.deviations).toEqual([
      {
        standardId: lodash.standard.id,
        standardVersion: 2,
        slot: { moduleKind: "code-stack", slotKind: "library", name: "lodash" },
        subject: "lodash",
        kind: "prohibited",
        status: "open",
        correction: `The Standard ${lodash.standard.id} prohibits lodash.`,
      },
    ]);
  });

  it("emits one open missing-required Deviation for a required token with no matching fact", () => {
    const color = designStandard(nextId(), 4, { kind: "token", name: "--color-bg", status: "required" });
    const result = evaluate([color]);
    expect(result).toMatchObject({ ok: true, checked: 1, open: 1 });
    if (!result.ok) return;
    expect(result.deviations).toEqual([
      {
        standardId: color.standard.id,
        standardVersion: 4,
        slot: { moduleKind: "design-system", slotKind: "token", name: "--color-bg" },
        subject: "--color-bg",
        kind: "missing-required-token",
        status: "open",
        correction: `The Standard ${color.standard.id} requires the token --color-bg.`,
      },
    ]);
  });

  it("emits one open version-constraint Deviation when a fact version fails the constraint", () => {
    const react = codeStackStandard(nextId(), 1, codeStackEntry("library", "react", "approved", { versionConstraint: "^18" }));
    const result = evaluate([react], { dependencies: [dep("react", "16.8.0")] });
    if (!result.ok) return;
    expect(result.deviations).toEqual([
      {
        standardId: react.standard.id,
        standardVersion: 1,
        slot: { moduleKind: "code-stack", slotKind: "library", name: "react" },
        subject: "react",
        kind: "version-constraint",
        status: "open",
        correction: `The Standard ${react.standard.id} requires react to satisfy ^18; found 16.8.0.`,
      },
    ]);
  });

  it("marks a finding accepted while the acceptance is live, and keeps it out of the open count", () => {
    const lodash = codeStackStandard(nextId(), 2, codeStackEntry("library", "lodash", "prohibited"));
    const accepted = [acceptance(lodash, "lodash", "2026-01-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z")];
    const result = evaluate([lodash], { dependencies: [dep("lodash", "4.17.21")] }, accepted);
    expect(result).toMatchObject({ ok: true, open: 0, adherence: 1 });
    if (!result.ok) return;
    expect(result.deviations[0]?.status).toBe("accepted");
  });

  it("returns an expired finding to open, byte-identical to a run with no acceptance", () => {
    const lodash = codeStackStandard(nextId(), 2, codeStackEntry("library", "lodash", "prohibited"));
    const accepted = [acceptance(lodash, "lodash", "2026-01-01T00:00:00.000Z", "2026-06-01T00:00:00.000Z")];
    const expired = evaluate([lodash], { dependencies: [dep("lodash", "4.17.21")] }, accepted);
    const without = evaluate([lodash], { dependencies: [dep("lodash", "4.17.21")] });
    expect(JSON.stringify(expired)).toBe(JSON.stringify(without));
    if (!expired.ok) return;
    expect(expired.deviations[0]?.status).toBe("open");
    expect(expired.open).toBe(1);
  });

  it("keeps a finding open when only the acceptance's subject differs", () => {
    const lodash = codeStackStandard(nextId(), 2, codeStackEntry("library", "lodash", "prohibited"));
    const accepted = [acceptance(lodash, "ramda", "2026-01-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z")];
    const result = evaluate([lodash], { dependencies: [dep("lodash", "4.17.21")] }, accepted);
    if (!result.ok) return;
    expect(result.deviations[0]?.status).toBe("open");
    expect(result.open).toBe(1);
  });

  it("refuses a duplicate Conflict slot in the set, with no deviations", () => {
    const a = codeStackStandard(nextId(), 1, codeStackEntry("library", "Lodash", "prohibited"));
    const b = codeStackStandard(nextId(), 1, codeStackEntry("library", " lodash ", "approved"));
    const result = evaluate([a, b], { dependencies: [dep("Lodash", "4.17.21")] });
    expect(result).toMatchObject({ ok: false, error: { code: "slot_conflict", subject: a.standard.id } });
    if (result.ok) return;
    expect(result.error.message).toContain(a.standard.id);
    expect(result.error.message).toContain(b.standard.id);
  });

  it("generates the one-sentence instruction with the approved entry of the same slot kind", () => {
    const lodash = codeStackStandard(nextId(), 1, codeStackEntry("library", "lodash", "prohibited"));
    const ramda = codeStackStandard(nextId(), 1, codeStackEntry("library", "ramda", "approved"));
    const result = evaluate([lodash, ramda], { dependencies: [dep("lodash", "4.17.21")] });
    if (!result.ok) return;
    expect(result.deviations[0]?.correction).toBe(
      `The Standard ${lodash.standard.id} prohibits lodash; use the approved library ramda instead.`,
    );

    // An authored instruction that is the empty string counts as absent.
    const leftPad = codeStackStandard(nextId(), 1, codeStackEntry("library", "left-pad", "prohibited", { correctionInstruction: "" }));
    const dateFns = codeStackStandard(nextId(), 1, codeStackEntry("library", "date-fns", "approved"));
    const empty = evaluate([leftPad, dateFns], { dependencies: [dep("left-pad", "1.0.0")] });
    if (!empty.ok) return;
    expect(empty.deviations[0]?.correction).toBe(
      `The Standard ${leftPad.standard.id} prohibits left-pad; use the approved library date-fns instead.`,
    );

    // With no approved entry in the slot kind, the clause is dropped.
    const alone = evaluate([lodash], { dependencies: [dep("lodash", "4.17.21")] });
    if (!alone.ok) return;
    expect(alone.deviations[0]?.correction).toBe(`The Standard ${lodash.standard.id} prohibits lodash.`);
  });

  it("returns an invalid-input envelope and no deviations for malformed facts or set", () => {
    const lodash = codeStackStandard(nextId(), 1, codeStackEntry("library", "lodash", "prohibited"));
    const malformedFacts = evaluateDeviations({
      applicationId: APPLICATION_ID,
      facts: { ...baseFacts, dependencies: [{ name: "lodash" }] } as unknown as RevisionFacts,
      effectiveSet: effectiveSet([lodash]),
      accepted: [],
      now: NOW,
    });
    expect(malformedFacts).toMatchObject({ ok: false, error: { code: "invalid_input", subject: "facts" } });

    const malformedSet = evaluateDeviations({
      applicationId: APPLICATION_ID,
      facts: baseFacts,
      effectiveSet: { project: projectRef, standards: [{ slot: lodash.slot, status: null, standard: lodash.standard, sourceProject: projectRef }] } as unknown as EffectiveStandardSet,
      accepted: [],
      now: NOW,
    });
    expect(malformedSet).toMatchObject({ ok: false, error: { code: "invalid_input", subject: "effectiveSet" } });
  });
});

describe("evaluateDeviations — inputs and clock", () => {
  const lodash = codeStackStandard(nextId(), 1, codeStackEntry("library", "lodash", "prohibited"));
  const factsWithLodash: Partial<RevisionFacts> = { dependencies: [dep("lodash", "4.17.21")] };

  it("refuses a malformed Application id, accepted list or clock input", () => {
    expect(
      evaluateDeviations({
        applicationId: "not-a-uuid" as UuidV7,
        facts: baseFacts,
        effectiveSet: effectiveSet([]),
        accepted: [],
        now: NOW,
      }),
    ).toMatchObject({ ok: false, error: { subject: "applicationId" } });

    expect(
      evaluateDeviations({
        applicationId: APPLICATION_ID,
        facts: baseFacts,
        effectiveSet: effectiveSet([]),
        accepted: [{ ...acceptance(lodash, "lodash", NOW, NOW), start: "yesterday" }],
        now: NOW,
      }),
    ).toMatchObject({ ok: false, error: { subject: "accepted" } });

    expect(
      evaluateDeviations({
        applicationId: APPLICATION_ID,
        facts: baseFacts,
        effectiveSet: effectiveSet([]),
        accepted: [],
        now: "2026-06-15 12:00:00",
      }),
    ).toMatchObject({ ok: false, error: { subject: "now" } });
  });

  it("honours the acceptance window: start inclusive, end exclusive", () => {
    const accepted = [acceptance(lodash, "lodash", "2026-06-15T12:00:00.000Z", "2026-06-16T12:00:00.000Z")];
    const atStart = evaluate([lodash], factsWithLodash, accepted, "2026-06-15T12:00:00.000Z");
    if (atStart.ok) expect(atStart.deviations[0]?.status).toBe("accepted");

    const justBeforeEnd = evaluate([lodash], factsWithLodash, accepted, "2026-06-16T11:59:59.999Z");
    if (justBeforeEnd.ok) expect(justBeforeEnd.deviations[0]?.status).toBe("accepted");

    const atEnd = evaluate([lodash], factsWithLodash, accepted, "2026-06-16T12:00:00.000Z");
    if (atEnd.ok) expect(atEnd.deviations[0]?.status).toBe("open");

    const beforeStart = evaluate([lodash], factsWithLodash, accepted, "2026-06-15T11:59:59.999Z");
    if (beforeStart.ok) expect(beforeStart.deviations[0]?.status).toBe("open");
  });

  it("never marks a finding accepted over an unparseable acceptance date", () => {
    const accepted = [acceptance(lodash, "lodash", "not-a-date", "2027-01-01T00:00:00.000Z")];
    const result = evaluate([lodash], factsWithLodash, accepted);
    if (!result.ok) return;
    expect(result.deviations[0]?.status).toBe("open");
  });

  it("keeps a finding open when only the Application id or Standard version differs", () => {
    const otherApplication = "01940000-0000-7000-8000-0000000000aa" as UuidV7;
    const base = acceptance(lodash, "lodash", "2026-01-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z");
    const differing: readonly AcceptedDeviation[] = [
      { ...base, applicationId: otherApplication },
      { ...base, standardVersion: base.standardVersion + 1 },
      { ...base, slot: { ...base.slot, name: "ramda" } },
    ];
    for (const [index, differingAcceptance] of differing.entries()) {
      const result = evaluate([lodash], factsWithLodash, [differingAcceptance]);
      expect(result, `case ${String(index)}`).toMatchObject({ ok: true, open: 1 });
      if (!result.ok) continue;
      expect(result.deviations[0]?.status, `case ${String(index)}`).toBe("open");
      expect(result.adherence, `case ${String(index)}`).toBe(0);
    }
  });

  it("matches a slot name spelled differently but normalizing equal", () => {
    const base = acceptance(lodash, "lodash", "2026-01-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z");
    const differentlySpelled: AcceptedDeviation = { ...base, slot: { ...base.slot, name: " lodash " } };
    const result = evaluate([lodash], factsWithLodash, [differentlySpelled]);
    expect(result).toMatchObject({ ok: true, open: 0, adherence: 1 });
    if (!result.ok) return;
    expect(result.deviations[0]?.status).toBe("accepted");
  });

  it("keeps the answer open when the clock input is a well-formed but invalid date", () => {
    const accepted = [acceptance(lodash, "lodash", "2026-01-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z")];
    const result = evaluate([lodash], factsWithLodash, accepted, "2026-13-45T12:00:00.000Z");
    if (!result.ok) return;
    expect(result.deviations[0]?.status).toBe("open");
  });
});

describe("evaluateDeviations — code-stack checks", () => {
  it("uses the authored instruction verbatim when the entry carries one", () => {
    const authored = "Swap the helper onto our shared math module before the next release.";
    const lodash = codeStackStandard(nextId(), 3, codeStackEntry("library", "lodash", "prohibited", { correctionInstruction: authored }));
    const result = evaluate([lodash], { dependencies: [dep("lodash", "4.17.21")] });
    if (!result.ok) return;
    expect(result.deviations[0]?.correction).toBe(authored);

    // The authored instruction also wins when a generated one would name an
    // approved alternative in the "; use the approved …" clause.
    const ramda = codeStackStandard(nextId(), 1, codeStackEntry("library", "ramda", "approved"));
    const withAlternative = evaluate([lodash, ramda], { dependencies: [dep("lodash", "4.17.21")] });
    if (!withAlternative.ok) return;
    expect(withAlternative.deviations[0]?.correction).toBe(authored);
    expect(withAlternative.deviations[0]?.correction).not.toContain("use the approved");
  });

  it("emits a missing-required Deviation for a required entry with no fact, and none when present", () => {
    const typescript = codeStackStandard(nextId(), 1, codeStackEntry("language", "typescript", "required"));
    expect(evaluate([typescript])).toMatchObject({ ok: true, open: 1 });
    expect(evaluate([typescript], { dependencies: [dep("typescript", "5.1.6")] })).toMatchObject({
      ok: true,
      open: 0,
    });
  });

  it("emits nothing for an approved entry with no fact, and none for an absent prohibited entry", () => {
    const ramda = codeStackStandard(nextId(), 1, codeStackEntry("library", "ramda", "approved"));
    const jquery = codeStackStandard(nextId(), 1, codeStackEntry("framework", "jquery", "prohibited"));
    const result = evaluate([ramda, jquery]);
    expect(result).toMatchObject({ ok: true, deviations: [], checked: 2, open: 0, adherence: 1 });
  });

  it("fails closed: an unresolvable fact version under a constraint is a violation", () => {
    const alpha = codeStackStandard(nextId(), 1, codeStackEntry("library", "alpha", "approved", { versionConstraint: "^1.0.0" }));
    const result = evaluate([alpha], { dependencies: [dep("alpha", "^1.0.0")] });
    if (!result.ok) return;
    expect(result.deviations).toHaveLength(1);
    expect(result.deviations[0]).toMatchObject({ kind: "version-constraint", subject: "alpha" });
    expect(result.deviations[0]?.correction).toContain("found ^1.0.0");
  });

  it("does not check a version when the entry carries no constraint", () => {
    const react = codeStackStandard(nextId(), 1, codeStackEntry("library", "react", "approved"));
    const result = evaluate([react], { dependencies: [dep("react", "^18.0.0")] });
    expect(result).toMatchObject({ ok: true, deviations: [] });
  });

  it("emits exactly one Deviation for a prohibited entry that also carries a constraint", () => {
    const oldReact = codeStackStandard(nextId(), 1, codeStackEntry("library", "react", "prohibited", { versionConstraint: "^18.2.0" }));
    const result = evaluate([oldReact], { dependencies: [dep("react", "16.8.0")] });
    expect(result).toMatchObject({ ok: true, open: 1 });
    if (!result.ok) return;
    expect(result.deviations).toHaveLength(1);
    expect(result.deviations[0]?.kind).toBe("prohibited");
  });

  it("picks the failing fact deterministically when facts repeat a name", () => {
    const react = codeStackStandard(nextId(), 1, codeStackEntry("library", "react", "approved", { versionConstraint: "^18" }));
    const shuffled = evaluate([react], { dependencies: [dep("react", "16.8.0"), dep("react", "18.2.0")] });
    const reordered = evaluate([react], { dependencies: [dep("react", "18.2.0"), dep("react", "16.8.0")] });
    expect(JSON.stringify(shuffled)).toBe(JSON.stringify(reordered));
    if (!shuffled.ok) return;
    expect(shuffled.deviations[0]?.kind).toBe("version-constraint");
  });
});

describe("evaluateDeviations — design-system checks", () => {
  it("emits prohibited and missing Deviations for token and import entries", () => {
    const legacyToken = designStandard(nextId(), 1, { kind: "token", name: "--legacy-color", status: "prohibited" });
    const requiredToken = designStandard(nextId(), 1, { kind: "token", name: "--color-primary", status: "required" });
    const legacyImport = designStandard(nextId(), 1, { kind: "import", specifier: "@acme/legacy", status: "prohibited" });
    const requiredImport = designStandard(nextId(), 1, { kind: "import", specifier: "@acme/ui", status: "required" });
    const facts: Partial<RevisionFacts> = {
      tokens: [tok("--legacy-color")],
      imports: [imp("@acme/legacy")],
    };
    const result = evaluate([legacyToken, requiredToken, legacyImport, requiredImport], facts);
    expect(result).toMatchObject({ ok: true, checked: 4, open: 4, adherence: 0 });
    if (!result.ok) return;
    // Sorted by the Standards' ids, in the order the fixtures were minted.
    expect(result.deviations.map((d) => [d.kind, d.subject])).toEqual([
      ["prohibited-token", "--legacy-color"],
      ["missing-required-token", "--color-primary"],
      ["prohibited-import", "@acme/legacy"],
      ["missing-required-import", "@acme/ui"],
    ]);
    expect(result.deviations[0]?.correction).toBe(
      `The Standard ${legacyToken.standard.id} prohibits the token --legacy-color.`,
    );
    expect(result.deviations[1]?.correction).toBe(
      `The Standard ${requiredToken.standard.id} requires the token --color-primary.`,
    );
    expect(result.deviations[2]?.correction).toBe(
      `The Standard ${legacyImport.standard.id} prohibits the import @acme/legacy.`,
    );
    expect(result.deviations[3]?.correction).toBe(
      `The Standard ${requiredImport.standard.id} requires the import @acme/ui.`,
    );
  });

  it("emits nothing when required facts are present and prohibited ones are absent", () => {
    const legacyToken = designStandard(nextId(), 1, { kind: "token", name: "--legacy-color", status: "prohibited" });
    const requiredToken = designStandard(nextId(), 1, { kind: "token", name: "--color-primary", status: "required" });
    const requiredImport = designStandard(nextId(), 1, { kind: "import", specifier: "@acme/ui", status: "required" });
    const result = evaluate([legacyToken, requiredToken, requiredImport], {
      tokens: [tok("--color-primary")],
      imports: [imp("@acme/ui")],
    });
    expect(result).toMatchObject({ ok: true, deviations: [], checked: 3, adherence: 1 });
  });

  it("matches component usage from specifiers: equal, or ending with /<name>, case-insensitively", () => {
    const button = designStandard(nextId(), 1, {
      kind: "component",
      name: "Button",
      usageRule: "Use the shared button.",
      tokens: [],
      correctionInstruction: null,
    });
    const facts: Partial<RevisionFacts> = {
      imports: [imp("button"), imp("@acme/ui/button"), imp("DatePicker"), imp("./DatePicker")],
    };
    const result = evaluate([button], facts);
    if (!result.ok) return;
    // "button" (equal) and "@acme/ui/button" (trailing segment) are allow-listed;
    // "DatePicker" and "./DatePicker" are two spellings of one outside component.
    expect(result.deviations).toHaveLength(1);
    expect(result.deviations[0]).toMatchObject({
      standardId: button.standard.id,
      slot: button.slot,
      subject: "DatePicker",
      kind: "component-outside-allow-list",
      correction: `The Standard ${button.standard.id} allows only listed components; DatePicker is not in the allow-list.`,
    });
  });

  it("treats a specifier ending in a slash as naming no component", () => {
    const button = designStandard(nextId(), 1, {
      kind: "component",
      name: "Button",
      usageRule: "Use the shared button.",
      tokens: [],
      correctionInstruction: null,
    });
    // "@acme/ui/" and "./" both yield an empty trailing segment, which must
    // not become a component with an empty subject.
    const result = evaluate([button], { imports: [imp("@acme/ui/"), imp("./")] });
    expect(result).toMatchObject({ ok: true, deviations: [] });
  });

  it("constrains nothing when the set holds no component entry", () => {
    const token = designStandard(nextId(), 1, { kind: "token", name: "--color-primary", status: "required" });
    const result = evaluate([token], {
      tokens: [tok("--color-primary")],
      imports: [imp("react"), imp("./helpers")],
    });
    expect(result).toMatchObject({ ok: true, deviations: [] });
  });

  it("attributes an outside component to the contributor with the lowest Standard id", () => {
    // Minted first, so its id is the lexicographically lowest of the two.
    const first = designStandard(nextId(), 2, {
      kind: "component",
      name: "Card",
      usageRule: "Use the shared card.",
      tokens: [],
      correctionInstruction: "Pick from the shared component list before inventing one.",
    });
    const second = designStandard(nextId(), 1, {
      kind: "component",
      name: "Button",
      usageRule: "Use the shared button.",
      tokens: [],
      correctionInstruction: null,
    });
    const result = evaluate([second, first], { imports: [imp("./DatePicker")] });
    if (!result.ok) return;
    expect(result.deviations).toHaveLength(1);
    expect(result.deviations[0]).toMatchObject({
      standardId: first.standard.id,
      standardVersion: first.standard.version,
      subject: "DatePicker",
    });
    expect(result.deviations[0]?.correction).toBe("Pick from the shared component list before inventing one.");
  });
});

describe("evaluateDeviations — counts and ordering", () => {
  it("computes checked, open and adherence as (checked - open) / checked", () => {
    const openLodash = codeStackStandard(nextId(), 1, codeStackEntry("library", "lodash", "prohibited"));
    const openToken = designStandard(nextId(), 1, { kind: "token", name: "--color-bg", status: "required" });
    const passRamda = codeStackStandard(nextId(), 1, codeStackEntry("library", "ramda", "approved"));
    const passButton = designStandard(nextId(), 1, {
      kind: "component",
      name: "Button",
      usageRule: "Use the shared button.",
      tokens: [],
      correctionInstruction: null,
    });
    const accepted: AcceptedDeviation[] = [acceptance(openLodash, "lodash", "2026-01-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z")];
    const result = evaluate(
      [openLodash, openToken, passRamda, passButton],
      { dependencies: [dep("lodash", "4.17.21")], imports: [imp("button")] },
      accepted,
    );
    // The lodash finding is accepted and openToken stays open: checked 4, open 1.
    expect(result).toMatchObject({ ok: true, checked: 4, open: 1, adherence: 3 / 4 });
    if (!result.ok) return;
    expect(result.deviations.map((d) => d.status)).toEqual(["accepted", "open"]);
  });

  it("returns adherence 0 when the set evaluates nothing", () => {
    const result = evaluate([]);
    expect(result).toEqual({ ok: true, deviations: [], checked: 0, open: 0, adherence: 0 });
  });

  it("sorts by (standard id, module kind, slot kind, name, subject, kind) and deduplicates", () => {
    const vue = codeStackStandard(nextId(), 1, codeStackEntry("framework", "vue", "prohibited"));
    const lodash = codeStackStandard(nextId(), 1, codeStackEntry("library", "lodash", "prohibited"));
    const button = designStandard(nextId(), 1, {
      kind: "component",
      name: "Button",
      usageRule: "Use the shared button.",
      tokens: [],
      correctionInstruction: null,
    });
    const imports: RevisionFacts["imports"] = [imp("datepicker"), imp("./DatePicker")];
    const result = evaluate([vue, lodash, button], {
      dependencies: [dep("vue", "1.0.0"), dep("lodash", "1.0.0")],
      imports,
    });
    if (!result.ok) return;
    expect(result.deviations).toHaveLength(3);
    // Sorted by Standard id: the id order the fixtures were minted in. The two
    // "DatePicker" spellings are one component, deduplicated.
    expect(
      result.deviations.map((d) => [d.standardId, d.slot.moduleKind, d.slot.slotKind, d.subject, d.kind]),
    ).toEqual([
      [vue.standard.id, "code-stack", "framework", "vue", "prohibited"],
      [lodash.standard.id, "code-stack", "library", "lodash", "prohibited"],
      [button.standard.id, "design-system", "component", "DatePicker", "component-outside-allow-list"],
    ]);
  });

  it("treats different slots that share a name as unrelated findings", () => {
    const lib = codeStackStandard(nextId(), 1, codeStackEntry("library", "ui", "prohibited"));
    const designImport = designStandard(nextId(), 1, { kind: "import", specifier: "ui", status: "prohibited" });
    const result = evaluate([lib, designImport], { dependencies: [dep("ui", "1.0.0")], imports: [imp("ui")] });
    if (!result.ok) return;
    expect(result.deviations).toHaveLength(2);
    expect(result.deviations.map((d) => d.slot.moduleKind).sort()).toEqual(["code-stack", "design-system"]);
  });
});
