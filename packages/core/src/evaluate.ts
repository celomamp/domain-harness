/**
 * The Deviation evaluator (Story 5.2): compares a revision's facts with the
 * Effective Standard set (wire form) and returns every Deviation, keyed to
 * (Standard id, Standard version, Conflict slot, subject), with its Correction
 * instruction, plus the checked/open counts and the Adherence fraction.
 *
 * Code-stack entries map onto dependency facts by casefold name (trimmed,
 * Unicode NFC, lowercase — the slot and Guidance rule, so a "TypeScript"
 * entry governs the `typescript` package): a prohibited
 * entry whose fact is present, a required entry whose fact is missing, and an
 * approved or required entry whose fact fails a non-empty version constraint —
 * or whose version cannot be resolved to a concrete version — each yield one
 * Deviation, failing closed. Design-system token and import entries map token
 * and import facts by exact name. Component usage is detected only from
 * design-system import specifiers: a specifier under the specifier of a
 * required design-system import entry (`<root>/…`) uses the component named
 * by its last path segment, case-insensitively, and any detected component
 * outside the allow-list — the union of component-entry names — is a
 * Deviation. npm libraries, relative paths and the package root itself never
 * count as component uses; with no required import entry in the set, nothing
 * is detected.
 *
 * Pure: no I/O, no clock, no network. Identical inputs produce a byte-identical
 * result whatever the order of the inputs' arrays.
 */
import {
  isAcceptedDeviation,
  isCodeStackEntry,
  isDesignSystemEntry,
  isEffectiveStandardSet,
  isRevisionFacts,
  isUtcIso,
  isUuidV7,
  SLOT_CONFLICT,
} from "@domain-harness/contract";
import type {
  AcceptedDeviation,
  ComponentEntry,
  Deviation,
  DeviationKind,
  EffectiveSlot,
  EffectiveStandard,
  EffectiveStandardSet,
  ErrorEnvelope,
  ModuleKind,
  RevisionFacts,
  UuidV7,
} from "@domain-harness/contract";
import { formatSlot, normalizeSlotName, sameSlot } from "./slots.ts";

/** What {@link evaluateDeviations} needs; the adapter, never the core, supplies the clock. */
export interface EvaluateInput {
  /** The Application the run is evaluated for; acceptances match on it exactly. */
  readonly applicationId: UuidV7;
  /** The revision's facts, as the extractor produced them. */
  readonly facts: RevisionFacts;
  /** The Effective Standard set in its wire form. */
  readonly effectiveSet: EffectiveStandardSet;
  /** The Buyer's accepted deviations, in any order. */
  readonly accepted: readonly AcceptedDeviation[];
  /** The run time as a UTC ISO-8601 string; the core never reads a clock. */
  readonly now: string;
}

export type EvaluateResult =
  | {
      readonly ok: true;
      /** Every Deviation, sorted by (Standard id, slot, subject, kind) and deduplicated. */
      readonly deviations: readonly Deviation[];
      /** Distinct Standards evaluated from the effective set. */
      readonly checked: number;
      /** Distinct Standards carrying at least one unaccepted Deviation. */
      readonly open: number;
      /** `(checked - open) / checked`; `0` when `checked` is `0`. */
      readonly adherence: number;
    }
  | { readonly ok: false; readonly error: ErrorEnvelope };

/** One finding before acceptance matching: everything a Deviation needs but its status. */
interface Finding {
  readonly standardId: UuidV7;
  readonly standardVersion: number;
  readonly slot: EffectiveSlot;
  readonly subject: string;
  readonly kind: DeviationKind;
  readonly correction: string;
}

interface VersionTriple {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The effective set's own deterministic order: Module kind, slot kind, normalised slot name, then Standard id. */
function byStandard(a: EffectiveStandard, b: EffectiveStandard): number {
  return (
    compare(a.slot.moduleKind, b.slot.moduleKind) ||
    compare(a.slot.slotKind, b.slot.slotKind) ||
    compare(normalizeSlotName(a.slot.name), normalizeSlotName(b.slot.name)) ||
    compare(a.standard.id, b.standard.id)
  );
}

const bySpecifier = (a: { readonly specifier: string }, b: { readonly specifier: string }): number =>
  compare(a.specifier, b.specifier);
const byFactVersion = (a: { readonly version: string }, b: { readonly version: string }): number =>
  compare(a.version, b.version);

/**
 * Strip the prerelease and build tags from a fact version and resolve it to a
 * concrete version triple, or `null` when it is not one: a range version such
 * as `^18.0.0` (a manifest seen without a lockfile) never resolves, so under
 * any constraint the Gate fails closed.
 */
export function parseConcreteVersion(version: string): VersionTriple | null {
  const trimmed = version.trim();
  const withoutBuild = trimmed.includes("+") ? trimmed.slice(0, trimmed.indexOf("+")) : trimmed;
  const withoutPrerelease = withoutBuild.includes("-") ? withoutBuild.slice(0, withoutBuild.indexOf("-")) : withoutBuild;
  const parts = withoutPrerelease.split(".");
  if (parts.length !== 3) return null;
  const numbers = parts.map((part) => (/^\d+$/.test(part) ? Number(part) : Number.NaN));
  if (numbers.some((n) => !Number.isInteger(n) || n < 0)) return null;
  return { major: numbers[0] ?? Number.NaN, minor: numbers[1] ?? Number.NaN, patch: numbers[2] ?? Number.NaN };
}

function parseConstraintTriple(text: string): (VersionTriple & { readonly given: 1 | 2 | 3 }) | null {
  const parts = text.split(".");
  if (parts.length === 0 || parts.length > 3) return null;
  const given = parts.length as 1 | 2 | 3;
  const numbers: number[] = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    numbers.push(Number(part));
  }
  while (numbers.length < 3) numbers.push(0);
  const [major, minor, patch] = numbers as [number, number, number];
  return { major, minor, patch, given };
}

const compareTriple = (a: VersionTriple, b: VersionTriple): number =>
  a.major - b.major || a.minor - b.minor || a.patch - b.patch;

/** One term of one alternative: an optional operator (`^`, `~`, `=`, `>`, `>=`, `<`, `<=`, or `*`) and a version. */
function termSatisfies(version: VersionTriple, term: string): boolean {
  const trimmed = term.trim();
  if (trimmed === "" || trimmed === "*") return true;
  const match = /^(>=|<=|=|\^|~|>|<)?\s*(.*)$/.exec(trimmed);
  const operator = match?.[1] ?? "";
  const text = (match?.[2] ?? "").trim();
  if (operator !== "" && text === "") return false;
  const constraint = parseConstraintTriple(text);
  if (constraint === null) return false; // a constraint that cannot be parsed never passes
  const order = compareTriple(version, constraint);
  switch (operator) {
    case "":
    case "=":
      return order === 0;
    case "^":
      // From the constraint up to, but not including, the next breaking
      // version: ^1.2.3 → [1.2.3, 2.0.0); ^0.2.3 → [0.2.3, 0.3.0);
      // ^0.0.3 → [0.0.3, 0.0.4).
      if (order < 0) return false;
      if (constraint.major > 0) return version.major === constraint.major;
      if (version.major !== 0) return false;
      if (constraint.minor > 0) return version.minor === constraint.minor;
      return version.minor === 0 && version.patch === constraint.patch;
    case "~":
      // Tilde patches and minors are wild: ~1.2.3 → [1.2.3, 1.3.0), ~1.2 →
      // [1.2.0, 1.3.0), ~1 → [1.0.0, 2.0.0). The lower bound is the order
      // check above; the missing parts bound only within their field.
      if (order < 0) return false;
      if (constraint.given === 1) return version.major === constraint.major;
      return version.major === constraint.major && version.minor === constraint.minor;
    case ">":
      return order > 0;
    case ">=":
      return order >= 0;
    case "<":
      return order < 0;
    case "<=":
      return order <= 0;
    default:
      return false;
  }
}

/**
 * The pure version-constraint comparator: `*`, an exact `MAJOR.MINOR.PATCH`
 * (with or without `=`), `^`, `~`, `>`, `>=`, `<`, `<=`, space-separated
 * conjunctions and `||` alternatives. Missing parts read as `0` at the lower
 * bound and as wild at the upper one (so `^18` is `>=18.0.0 <19.0.0` and
 * `~18.2` is `>=18.2.0 <18.3.0`); prerelease and build tags are ignored.
 * An unresolvable fact version or an unparseable term never satisfies.
 */
export function satisfiesVersionConstraint(version: string, constraint: string): boolean {
  const concrete = parseConcreteVersion(version);
  if (concrete === null) return false;
  return constraint
    .split("||")
    .some((alternative) => {
      const terms = alternative.trim().split(/\s+/).filter((term) => term !== "");
      return terms.length > 0 && terms.every((term) => termSatisfies(concrete, term));
    });
}

/**
 * The generated Correction instruction for one finding (one sentence, always
 * naming the Standard id). `{alternative}` is the first approved entry with
 * the same Module kind and slot kind in the set's order; that clause is
 * dropped when none exists.
 */
function generatedCorrection(
  standardId: string,
  kind: DeviationKind,
  slotKind: string,
  subject: string,
  alternative: string | null,
  constraint: string | null,
  version: string | null,
): string {
  switch (kind) {
    case "prohibited": {
      const clause = alternative === null ? "" : `; use the approved ${slotKind} ${alternative} instead`;
      return `The Standard ${standardId} prohibits ${subject}${clause}.`;
    }
    case "missing-required":
    case "missing-required-token":
    case "missing-required-import":
      return `The Standard ${standardId} requires the ${slotKind} ${subject}.`;
    case "version-constraint":
      return `The Standard ${standardId} requires ${subject} to satisfy ${constraint ?? ""}; found ${version ?? ""}.`;
    case "prohibited-token":
    case "prohibited-import":
      return `The Standard ${standardId} prohibits the ${slotKind} ${subject}.`;
    case "component-outside-allow-list":
      return `The Standard ${standardId} allows only listed components; ${subject} is not in the allow-list.`;
  }
}

const authoredOr = (authored: string | null, generated: string): string =>
  authored !== null && authored !== "" ? authored : generated;

const isComponentEntry = (entry: unknown): entry is ComponentEntry =>
  isDesignSystemEntry(entry) && entry.kind === "component";

/**
 * The design-system roots: the specifiers of the set's required
 * design-system import entries, trailing slashes dropped. A prohibited import
 * is not the design system and yields its own Deviation instead.
 */
function designSystemRoots(ordered: readonly EffectiveStandard[]): readonly string[] {
  const roots: string[] = [];
  for (const effective of ordered) {
    const entry = effective.standard.entry;
    if (!isDesignSystemEntry(entry) || entry.kind !== "import" || entry.status !== "required") continue;
    const root = entry.specifier.replace(/\/+$/, "");
    if (root !== "") roots.push(root);
  }
  return roots;
}

/** Whether an acceptance lets a finding through: the five key fields equal, and `start <= now < end`. */
function acceptanceCovers(acceptance: AcceptedDeviation, finding: Finding, applicationId: UuidV7, nowMs: number): boolean {
  if (acceptance.applicationId !== applicationId) return false;
  if (acceptance.standardId !== finding.standardId) return false;
  if (acceptance.standardVersion !== finding.standardVersion) return false;
  if (acceptance.subject !== finding.subject) return false;
  // The slot fields compare normalized: a different-but-equivalent spelling
  // of the Conflict slot name is the same slot (" lodash " ≡ "lodash").
  if (!sameSlot(acceptance.slot, finding.slot)) return false;
  // An unparseable boundary never matches: every comparison against NaN is
  // false, so the finding stays open (fail closed).
  const start = Date.parse(acceptance.start);
  const end = Date.parse(acceptance.end);
  return Number.isFinite(start) && Number.isFinite(end) && start <= nowMs && nowMs < end;
}

function rejection(code: string, message: string, subject: string): EvaluateResult {
  return { ok: false, error: { code, message, subject } };
}

/** The first approved code-stack entry with the same Module kind and slot kind, in the set's order. */
function approvedAlternative(
  moduleKind: ModuleKind,
  slotKind: string,
  ordered: readonly EffectiveStandard[],
): string | null {
  for (const effective of ordered) {
    if (effective.slot.moduleKind !== moduleKind || effective.slot.slotKind !== slotKind) continue;
    const entry = effective.standard.entry;
    if (isCodeStackEntry(entry) && entry.status === "approved") return entry.name;
  }
  return null;
}

/**
 * Evaluate the revision's facts against the Effective Standard set. Returns
 * `{ ok: false }` with an ErrorEnvelope and no Deviations when an input is
 * malformed (`invalid_input`, subject naming the input) or when two Standards
 * of the set share a Conflict slot (`slot_conflict`, subject the smaller
 * Standard id); otherwise every Deviation with its Correction instruction and
 * the counts. The answer never depends on the order of the inputs' arrays.
 */
export function evaluateDeviations(input: EvaluateInput): EvaluateResult {
  if (!isUuidV7(input.applicationId)) {
    return rejection("invalid_input", "the Application id must be a canonical lowercase UUIDv7", "applicationId");
  }
  if (!isRevisionFacts(input.facts)) {
    return rejection("invalid_input", "the revision facts are not a valid fact-schema object", "facts");
  }
  if (!isEffectiveStandardSet(input.effectiveSet)) {
    return rejection("invalid_input", "the Effective Standard set is not a valid set object", "effectiveSet");
  }
  if (!Array.isArray(input.accepted) || !input.accepted.every(isAcceptedDeviation)) {
    return rejection(
      "invalid_input",
      "every accepted deviation must carry the acceptance key and its UTC window",
      "accepted",
    );
  }
  if (!isUtcIso(input.now)) {
    return rejection("invalid_input", "the clock input must be a UTC ISO-8601 timestamp", "now");
  }

  // Sorted first, so no answer depends on the order the set arrived in.
  const ordered = [...input.effectiveSet.standards].sort(byStandard);

  for (let i = 0; i < ordered.length; i += 1) {
    for (let j = i + 1; j < ordered.length; j += 1) {
      const a = ordered[i];
      const b = ordered[j];
      if (a !== undefined && b !== undefined && sameSlot(a.slot, b.slot)) {
        const [first] = [a.standard.id, b.standard.id].sort();
        return rejection(
          SLOT_CONFLICT,
          `Standard ${a.standard.id} and Standard ${b.standard.id} both hold the Conflict slot ${formatSlot(a.slot)} ` +
            "in the Effective Standard set, so the Deviations cannot be evaluated",
          first ?? "",
        );
      }
    }
  }

  const findings: Finding[] = [];

  for (const effective of ordered) {
    const id = effective.standard.id;
    const version = effective.standard.version;
    const entry = effective.standard.entry;

    if (isCodeStackEntry(entry)) {
      const name = entry.name;
      const base = { standardId: id, standardVersion: version, slot: effective.slot, subject: name };
      const key = normalizeSlotName(name);
      const matching = input.facts.dependencies.filter((fact) => normalizeSlotName(fact.name) === key).sort(byFactVersion);
      const hasConstraint = entry.versionConstraint !== null && entry.versionConstraint !== "";

      if (entry.status === "prohibited" && matching.length > 0) {
        const generated = generatedCorrection(
          id,
          "prohibited",
          entry.category,
          name,
          approvedAlternative(effective.slot.moduleKind, effective.slot.slotKind, ordered),
          null,
          null,
        );
        findings.push({ ...base, kind: "prohibited", correction: authoredOr(entry.correctionInstruction, generated) });
      }

      if (entry.status === "required" && matching.length === 0) {
        const generated = generatedCorrection(id, "missing-required", entry.category, name, null, null, null);
        findings.push({
          ...base,
          kind: "missing-required",
          correction: authoredOr(entry.correctionInstruction, generated),
        });
      }

      // The version check is scoped to approved and required entries (AD: the
      // Gate only verifies a version against an entry whose status allows the
      // fact to be there at all); a prohibited entry yields one finding.
      if ((entry.status === "approved" || entry.status === "required") && hasConstraint && matching.length > 0) {
        const constraint: string = entry.versionConstraint;
        const failing = matching.find((fact) => !satisfiesVersionConstraint(fact.version, constraint));
        if (failing !== undefined) {
          const generated = generatedCorrection(id, "version-constraint", entry.category, name, null, constraint, failing.version);
          findings.push({
            ...base,
            kind: "version-constraint",
            correction: authoredOr(entry.correctionInstruction, generated),
          });
        }
      }
      continue;
    }

    if (entry.kind === "token") {
      const present = input.facts.tokens.some((fact) => fact.name === entry.name);
      if (entry.status === "prohibited" && present) {
        findings.push({
          standardId: id,
          standardVersion: version,
          slot: effective.slot,
          subject: entry.name,
          kind: "prohibited-token",
          correction: generatedCorrection(id, "prohibited-token", "token", entry.name, null, null, null),
        });
      }
      if (entry.status === "required" && !present) {
        findings.push({
          standardId: id,
          standardVersion: version,
          slot: effective.slot,
          subject: entry.name,
          kind: "missing-required-token",
          correction: generatedCorrection(id, "missing-required-token", "token", entry.name, null, null, null),
        });
      }
      continue;
    }

    if (entry.kind === "import") {
      const present = input.facts.imports.some((fact) => fact.specifier === entry.specifier);
      if (entry.status === "prohibited" && present) {
        findings.push({
          standardId: id,
          standardVersion: version,
          slot: effective.slot,
          subject: entry.specifier,
          kind: "prohibited-import",
          correction: generatedCorrection(id, "prohibited-import", "import", entry.specifier, null, null, null),
        });
      }
      if (entry.status === "required" && !present) {
        findings.push({
          standardId: id,
          standardVersion: version,
          slot: effective.slot,
          subject: entry.specifier,
          kind: "missing-required-import",
          correction: generatedCorrection(id, "missing-required-import", "import", entry.specifier, null, null, null),
        });
      }
    }
  }

  // Component allow-list: the union of the component entries' names. With no
  // component entry in the set the allow-list constrains nothing. Component
  // usage is detected only from specifiers that come from the design system:
  // those under a required design-system import entry's specifier (the root,
  // `<root>/<path>`), whose last path segment names the component,
  // case-insensitively. Any other import (`moment`, `react`, `./helpers`, the
  // bare root) is not a component use. Every detected component outside the
  // union is a Deviation, attributed to the contributing Standard with the
  // lowest Standard id.
  const contributors = ordered
    .filter((effective) => isComponentEntry(effective.standard.entry))
    .sort((a, b) => compare(a.standard.id, b.standard.id));
  const attributed = contributors[0];
  if (attributed !== undefined) {
    const componentEntry = isComponentEntry(attributed.standard.entry) ? attributed.standard.entry : undefined;
    if (componentEntry !== undefined) {
      const allowList = new Set(
        contributors.map((contributor) => (isComponentEntry(contributor.standard.entry) ? contributor.standard.entry.name.toLowerCase() : "")),
      );
      // Deduplicated case-insensitively; the subject keeps the spelling from
      // the lexicographically smallest specifier, so no answer depends on the
      // order of the facts.
      const roots = designSystemRoots(ordered);
      const detected = new Map<string, string>();
      for (const fact of [...input.facts.imports].sort(bySpecifier)) {
        if (!roots.some((root) => fact.specifier.startsWith(`${root}/`))) continue;
        const segment = fact.specifier.slice(fact.specifier.lastIndexOf("/") + 1);
        if (segment === "") continue; // a trailing slash names no component
        const key = segment.toLowerCase();
        if (!detected.has(key)) detected.set(key, segment);
      }
      for (const key of [...detected.keys()].sort()) {
        if (allowList.has(key)) continue;
        const subject = detected.get(key) ?? key;
        findings.push({
          standardId: attributed.standard.id,
          standardVersion: attributed.standard.version,
          slot: attributed.slot,
          subject,
          kind: "component-outside-allow-list",
          correction: authoredOr(
            componentEntry.correctionInstruction,
            generatedCorrection(attributed.standard.id, "component-outside-allow-list", "component", subject, null, null, null),
          ),
        });
      }
    }
  }

  // `now` matches the ISO shape; an invalid calendar date (month 13) parses to
  // NaN and no acceptance covers a finding against NaN, failing closed.
  const nowMs = Date.parse(input.now);
  const deviations: Deviation[] = findings.map((finding) => ({
    ...finding,
    status: input.accepted.some((acceptance) => acceptanceCovers(acceptance, finding, input.applicationId, nowMs))
      ? "accepted"
      : "open",
  }));

  deviations.sort((a, b) =>
    compare(a.standardId, b.standardId) ||
    compare(a.slot.moduleKind, b.slot.moduleKind) ||
    compare(a.slot.slotKind, b.slot.slotKind) ||
    compare(normalizeSlotName(a.slot.name), normalizeSlotName(b.slot.name)) ||
    compare(a.subject, b.subject) ||
    compare(a.kind, b.kind),
  );

  // Deduplicated by (match key, kind); the sorted order makes it deterministic.
  const deduplicated: Deviation[] = [];
  let previous: string | null = null;
  for (const deviation of deviations) {
    const key = JSON.stringify([
      deviation.standardId,
      deviation.slot.moduleKind,
      deviation.slot.slotKind,
      normalizeSlotName(deviation.slot.name),
      deviation.subject,
      deviation.kind,
    ]);
    if (key !== previous) deduplicated.push(deviation);
    previous = key;
  }

  const checked = new Set(ordered.map((effective) => effective.standard.id)).size;
  const open = new Set(
    deduplicated.filter((deviation) => deviation.status === "open").map((deviation) => deviation.standardId),
  ).size;
  return {
    ok: true,
    deviations: deduplicated,
    checked,
    open,
    adherence: checked === 0 ? 0 : (checked - open) / checked,
  };
}
