/**
 * The deterministic fixture suite (Story 5.4): plain transferred data — a
 * record of revision file contents, an identity, a snapshot-shaped bundle
 * and a clock input — covering every Deviation kind, acceptance before,
 * within and after the acceptance window, and every refusal both compared
 * adapters share. Each fixture isolates exactly one cause, so parity is
 * decided by the one cause it carries.
 *
 * Everything is data: no database, no environment variables, no I/O. The
 * whole suite runs in-process anywhere, including a fresh clone before
 * anything is built. Story 5.3's first-cut `ActiveBundleSnapshot` field
 * shapes and the bundle source's outcome variants (`verify-failed`,
 * `missing-set`) are reproduced as data, not invented anew.
 *
 * Epic 8's CLI Gate reuses this suite unchanged (no-cross-app-imports keeps
 * apps from importing apps; this package is the shared home).
 */
import type {
  AcceptedDeviation,
  CodeStackEntry,
  DesignSystemEntry,
  EffectiveStandard,
  EffectiveStandardSet,
  ProjectRef,
  UuidV7,
} from "@domain-harness/contract";
import { DEVIATION_KINDS } from "@domain-harness/contract";
import type { GateOutcome, GateRefusalReason } from "./result.ts";
import { REFUSAL_SENTENCE_BY_REASON } from "./result.ts";

/** Dedicated fixture ids, minted-upfront so no fixture mints anything at run time. */
export const GATE_APP_ID = "018f3d2a-7000-7000-8000-000000000001" as UuidV7;
export const GATE_OTHER_APP_ID = "018f3d2a-7000-7000-8000-0000000000e1" as UuidV7;
export const GATE_PROJECT_ID = "018f3d2a-7000-7000-8000-000000000002" as UuidV7;
export const GATE_CODE_STACK_MODULE_ID = "018f3d2a-7000-7000-8000-000000000003" as UuidV7;
export const GATE_DESIGN_SYSTEM_MODULE_ID = "018f3d2a-7000-7000-8000-000000000004" as UuidV7;
export const GATE_ACCOUNT_ID = "018f3d2a-7000-7000-8000-000000000005" as UuidV7;

export const GATE_STD_PROHIBITED_LIBRARY_ID = "018f3d2a-7000-7000-8000-000000000011" as UuidV7;
export const GATE_STD_REQUIRED_LIBRARY_ID = "018f3d2a-7000-7000-8000-000000000012" as UuidV7;
export const GATE_STD_APPROVED_LIBRARY_ID = "018f3d2a-7000-7000-8000-000000000013" as UuidV7;
export const GATE_STD_PROHIBITED_TOKEN_ID = "018f3d2a-7000-7000-8000-000000000021" as UuidV7;
export const GATE_STD_REQUIRED_TOKEN_ID = "018f3d2a-7000-7000-8000-000000000022" as UuidV7;
export const GATE_STD_PROHIBITED_IMPORT_ID = "018f3d2a-7000-7000-8000-000000000023" as UuidV7;
export const GATE_STD_REQUIRED_IMPORT_ID = "018f3d2a-7000-7000-8000-000000000024" as UuidV7;
export const GATE_STD_ALLOW_LIST_COMPONENT_ID = "018f3d2a-7000-7000-8000-000000000025" as UuidV7;
export const GATE_STD_SLOT_CONFLICT_A_ID = "018f3d2a-7000-7000-8000-000000000031" as UuidV7;
export const GATE_STD_SLOT_CONFLICT_B_ID = "018f3d2a-7000-7000-8000-000000000032" as UuidV7;

export const GATE_NOW = "2026-10-14T12:00:00.000Z";
export const GATE_PINNED_HASH = "sha256:gate-fixture-bundle-001";
export const GATE_FINGERPRINT_A = "a".repeat(64);
export const GATE_FINGERPRINT_B = "b".repeat(64);
export const GATE_EMPTY_FINGERPRINT = "";

export const GATE_STALENESS_BOUND_HOURS = 24;

/** A snapshot's released time as a UTC ISO string a number of hours before `now`. */
function issuedAtHoursBefore(now: string, hours: number): string {
  return new Date(Date.parse(now) - hours * 60 * 60 * 1000).toISOString();
}

export const gateProjectRef: ProjectRef = { id: GATE_PROJECT_ID, name: "Platform" };

/** One code-stack Standard of one fixture's Effective Standard set. */
export function gateCodeStackStandard(id: UuidV7, entry: CodeStackEntry): EffectiveStandard {
  return {
    slot: { moduleKind: "code-stack", slotKind: entry.category, name: entry.name },
    status: entry.status,
    standard: {
      id,
      version: 1,
      module: { id: GATE_CODE_STACK_MODULE_ID, kind: "code-stack", name: "Code Stack" },
      project: gateProjectRef,
      entry,
      publishedAt: "2026-10-01T00:00:00.000Z",
      publishedBy: { accountId: GATE_ACCOUNT_ID, name: "Sam Owner" },
    },
    sourceProject: gateProjectRef,
    locked: false,
  };
}

/** One design-system Standard of one fixture's Effective Standard set (a component has no status). */
export function gateDesignSystemStandard(id: UuidV7, entry: DesignSystemEntry): EffectiveStandard {
  const slotName = entry.kind === "import" ? entry.specifier : entry.name;
  return {
    slot: { moduleKind: "design-system", slotKind: entry.kind, name: slotName },
    status: entry.kind === "component" ? null : entry.status,
    standard: {
      id,
      version: 1,
      module: { id: GATE_DESIGN_SYSTEM_MODULE_ID, kind: "design-system", name: "Design System" },
      project: gateProjectRef,
      entry,
      publishedAt: "2026-10-01T00:00:00.000Z",
      publishedBy: { accountId: GATE_ACCOUNT_ID, name: "Sam Owner" },
    },
    sourceProject: gateProjectRef,
    locked: false,
  };
}

/**
 * The first-cut `ActiveBundleSnapshot` field shapes from story 5.3: exactly
 * the fields the compared paths consume, no invented bundle format.
 */
export interface GateBundleSnapshot {
  readonly hash: string;
  readonly issuedAt: string;
  readonly applications: readonly string[];
  readonly effectiveSet: EffectiveStandardSet;
  readonly accepted: readonly AcceptedDeviation[];
  readonly stalenessBoundHours?: number | null | undefined;
  readonly frozenUntil?: string | null | undefined;
}

/** The bundle the fixture presents to each adapter: a snapshot, or one of the source's refusal variants. */
export type GateBundle =
  | { readonly variant: "snapshot"; readonly snapshot: GateBundleSnapshot }
  | { readonly variant: "verify-failed" }
  | { readonly variant: "missing-set" };

/** What a fixture expects both adapters to produce: the classification only. */
export interface GateFixtureExpectation {
  readonly kind: GateOutcome["kind"];
  /** The exact refusal reason; `null` for pass and fail outcomes. */
  readonly refusalReason: GateRefusalReason | null;
}

/** One deterministic fixture: one cause, plain data, no I/O. */
export interface GateFixture {
  readonly name: string;
  readonly applicationId: UuidV7;
  readonly repoFingerprint: string;
  readonly files: Readonly<Record<string, string>>;
  readonly bundle: GateBundle;
  readonly now: string;
  /** The binding a pre-bound ledger holds; `null` plays first use. */
  readonly boundFingerprint: string | null;
  readonly expectation: GateFixtureExpectation;
}

const VALID_EMPTY_SET: EffectiveStandardSet = { project: gateProjectRef, standards: [] };

function fixtureSnapshot(now: string, overrides: Partial<GateBundleSnapshot> = {}): GateBundleSnapshot {
  return {
    hash: GATE_PINNED_HASH,
    issuedAt: issuedAtHoursBefore(now, 2),
    applications: [GATE_APP_ID],
    effectiveSet: VALID_EMPTY_SET,
    accepted: [],
    stalenessBoundHours: GATE_STALENESS_BOUND_HOURS,
    frozenUntil: null,
    ...overrides,
  };
}

/** The acceptance key the acceptance fixtures share (live from Oct 1 to, but not including, Nov 1). */
export function gateLodashAcceptance(): AcceptedDeviation {
  return {
    applicationId: GATE_APP_ID,
    standardId: GATE_STD_PROHIBITED_LIBRARY_ID,
    standardVersion: 1,
    slot: { moduleKind: "code-stack", slotKind: "library", name: "lodash" },
    subject: "lodash",
    start: "2026-10-01T00:00:00.000Z",
    end: "2026-11-01T00:00:00.000Z",
  };
}

const approvedRemeda = gateCodeStackStandard(GATE_STD_APPROVED_LIBRARY_ID, {
  category: "library",
  name: "remeda",
  versionConstraint: "^2.0.0",
  status: "approved",
  correctionInstruction: null,
});
const prohibitedLodash = gateCodeStackStandard(GATE_STD_PROHIBITED_LIBRARY_ID, {
  category: "library",
  name: "lodash",
  versionConstraint: null,
  status: "prohibited",
  correctionInstruction: null,
});
const requiredRemeda = gateCodeStackStandard(GATE_STD_REQUIRED_LIBRARY_ID, {
  category: "library",
  name: "remeda",
  versionConstraint: null,
  status: "required",
  correctionInstruction: null,
});
const prohibitedToken = gateDesignSystemStandard(GATE_STD_PROHIBITED_TOKEN_ID, {
  kind: "token",
  name: "--legacy-blue",
  status: "prohibited",
});
const requiredToken = gateDesignSystemStandard(GATE_STD_REQUIRED_TOKEN_ID, {
  kind: "token",
  name: "--brand-accent",
  status: "required",
});
const prohibitedImport = gateDesignSystemStandard(GATE_STD_PROHIBITED_IMPORT_ID, {
  kind: "import",
  specifier: "legacy-util",
  status: "prohibited",
});
const requiredImport = gateDesignSystemStandard(GATE_STD_REQUIRED_IMPORT_ID, {
  kind: "import",
  specifier: "@org/design-system",
  status: "required",
});
const allowListComponent = gateDesignSystemStandard(GATE_STD_ALLOW_LIST_COMPONENT_ID, {
  kind: "component",
  name: "Button",
  usageRule: "Use the listed components only.",
  tokens: [],
  correctionInstruction: null,
});
const slotConflictA = gateCodeStackStandard(GATE_STD_SLOT_CONFLICT_A_ID, {
  category: "library",
  name: "lodash",
  versionConstraint: null,
  status: "prohibited",
  correctionInstruction: null,
});
const slotConflictB = gateCodeStackStandard(GATE_STD_SLOT_CONFLICT_B_ID, {
  category: "library",
  name: "lodash",
  versionConstraint: null,
  status: "prohibited",
  correctionInstruction: null,
});

/**
 * The fixture suite. Every refusal turns up in both adapters with its exact
 * UX-DR29 sentence (via {@link REFUSAL_SENTENCE_BY_REASON}) and exit 1; a
 * fail carries the fail sentence and one line per open Deviation; a pass
 * exits 0 — identical on both paths.
 */
export const gateFixtures: readonly GateFixture[] = [
  {
    name: "pass",
    applicationId: GATE_APP_ID,
    repoFingerprint: GATE_FINGERPRINT_A,
    files: { "package.json": '{"dependencies":{"remeda":"2.1.0"}}' },
    bundle: { variant: "snapshot", snapshot: fixtureSnapshot(GATE_NOW, { effectiveSet: { project: gateProjectRef, standards: [approvedRemeda] } }) },
    now: GATE_NOW,
    boundFingerprint: null,
    expectation: { kind: "pass", refusalReason: null },
  },
  {
    name: "fail-prohibited",
    applicationId: GATE_APP_ID,
    repoFingerprint: GATE_FINGERPRINT_A,
    files: { "package.json": '{"dependencies":{"lodash":"4.17.21"}}' },
    bundle: { variant: "snapshot", snapshot: fixtureSnapshot(GATE_NOW, { effectiveSet: { project: gateProjectRef, standards: [prohibitedLodash] } }) },
    now: GATE_NOW,
    boundFingerprint: null,
    expectation: { kind: "fail", refusalReason: null },
  },
  {
    name: "fail-missing-required",
    applicationId: GATE_APP_ID,
    repoFingerprint: GATE_FINGERPRINT_A,
    files: {},
    bundle: { variant: "snapshot", snapshot: fixtureSnapshot(GATE_NOW, { effectiveSet: { project: gateProjectRef, standards: [requiredRemeda] } }) },
    now: GATE_NOW,
    boundFingerprint: null,
    expectation: { kind: "fail", refusalReason: null },
  },
  {
    name: "fail-version-constraint",
    applicationId: GATE_APP_ID,
    repoFingerprint: GATE_FINGERPRINT_A,
    files: { "package.json": '{"dependencies":{"remeda":"1.9.9"}}' },
    bundle: { variant: "snapshot", snapshot: fixtureSnapshot(GATE_NOW, { effectiveSet: { project: gateProjectRef, standards: [approvedRemeda] } }) },
    now: GATE_NOW,
    boundFingerprint: null,
    expectation: { kind: "fail", refusalReason: null },
  },
  {
    name: "fail-prohibited-token",
    applicationId: GATE_APP_ID,
    repoFingerprint: GATE_FINGERPRINT_A,
    files: { "src/styles.css": ".page { color: var(--legacy-blue); }" },
    bundle: { variant: "snapshot", snapshot: fixtureSnapshot(GATE_NOW, { effectiveSet: { project: gateProjectRef, standards: [prohibitedToken] } }) },
    now: GATE_NOW,
    boundFingerprint: null,
    expectation: { kind: "fail", refusalReason: null },
  },
  {
    name: "fail-missing-required-token",
    applicationId: GATE_APP_ID,
    repoFingerprint: GATE_FINGERPRINT_A,
    files: {},
    bundle: { variant: "snapshot", snapshot: fixtureSnapshot(GATE_NOW, { effectiveSet: { project: gateProjectRef, standards: [requiredToken] } }) },
    now: GATE_NOW,
    boundFingerprint: null,
    expectation: { kind: "fail", refusalReason: null },
  },
  {
    name: "fail-prohibited-import",
    applicationId: GATE_APP_ID,
    repoFingerprint: GATE_FINGERPRINT_A,
    files: { "src/index.ts": 'import "legacy-util";' },
    bundle: { variant: "snapshot", snapshot: fixtureSnapshot(GATE_NOW, { effectiveSet: { project: gateProjectRef, standards: [prohibitedImport] } }) },
    now: GATE_NOW,
    boundFingerprint: null,
    expectation: { kind: "fail", refusalReason: null },
  },
  {
    name: "fail-missing-required-import",
    applicationId: GATE_APP_ID,
    repoFingerprint: GATE_FINGERPRINT_A,
    files: {},
    bundle: { variant: "snapshot", snapshot: fixtureSnapshot(GATE_NOW, { effectiveSet: { project: gateProjectRef, standards: [requiredImport] } }) },
    now: GATE_NOW,
    boundFingerprint: null,
    expectation: { kind: "fail", refusalReason: null },
  },
  {
    name: "fail-component-outside-allow-list",
    applicationId: GATE_APP_ID,
    repoFingerprint: GATE_FINGERPRINT_A,
    files: { "src/index.ts": 'import "./components/Widget";' },
    bundle: { variant: "snapshot", snapshot: fixtureSnapshot(GATE_NOW, { effectiveSet: { project: gateProjectRef, standards: [allowListComponent] } }) },
    now: GATE_NOW,
    boundFingerprint: null,
    expectation: { kind: "fail", refusalReason: null },
  },
  {
    name: "accepted-live",
    applicationId: GATE_APP_ID,
    repoFingerprint: GATE_FINGERPRINT_A,
    files: { "package.json": '{"dependencies":{"lodash":"4.17.21"}}' },
    bundle: {
      variant: "snapshot",
      snapshot: fixtureSnapshot(GATE_NOW, {
        effectiveSet: { project: gateProjectRef, standards: [prohibitedLodash] },
        accepted: [gateLodashAcceptance()],
      }),
    },
    now: GATE_NOW,
    boundFingerprint: null,
    expectation: { kind: "pass", refusalReason: null },
  },
  {
    name: "accepted-before-start",
    applicationId: GATE_APP_ID,
    repoFingerprint: GATE_FINGERPRINT_A,
    now: "2026-09-30T00:00:00.000Z",
    files: { "package.json": '{"dependencies":{"lodash":"4.17.21"}}' },
    bundle: {
      variant: "snapshot",
      snapshot: fixtureSnapshot("2026-09-30T00:00:00.000Z", {
        effectiveSet: { project: gateProjectRef, standards: [prohibitedLodash] },
        accepted: [gateLodashAcceptance()],
      }),
    },
    boundFingerprint: null,
    expectation: { kind: "fail", refusalReason: null },
  },
  {
    name: "accepted-at-end",
    applicationId: GATE_APP_ID,
    repoFingerprint: GATE_FINGERPRINT_A,
    now: "2026-11-01T00:00:00.000Z",
    files: { "package.json": '{"dependencies":{"lodash":"4.17.21"}}' },
    bundle: {
      variant: "snapshot",
      snapshot: fixtureSnapshot("2026-11-01T00:00:00.000Z", {
        effectiveSet: { project: gateProjectRef, standards: [prohibitedLodash] },
        accepted: [gateLodashAcceptance()],
      }),
    },
    boundFingerprint: null,
    expectation: { kind: "fail", refusalReason: null },
  },
  {
    name: "unbound-unknown-application",
    applicationId: GATE_APP_ID,
    repoFingerprint: GATE_FINGERPRINT_A,
    files: {},
    bundle: { variant: "snapshot", snapshot: fixtureSnapshot(GATE_NOW, { applications: [GATE_OTHER_APP_ID] }) },
    now: GATE_NOW,
    boundFingerprint: null,
    expectation: { kind: "refusal", refusalReason: "unbound" },
  },
  {
    name: "unbound-empty-fingerprint",
    applicationId: GATE_APP_ID,
    repoFingerprint: GATE_EMPTY_FINGERPRINT,
    files: {},
    bundle: { variant: "snapshot", snapshot: fixtureSnapshot(GATE_NOW) },
    now: GATE_NOW,
    boundFingerprint: null,
    expectation: { kind: "refusal", refusalReason: "unbound" },
  },
  {
    name: "duplicate-bound-to-other-fingerprint",
    applicationId: GATE_APP_ID,
    repoFingerprint: GATE_FINGERPRINT_A,
    files: {},
    bundle: { variant: "snapshot", snapshot: fixtureSnapshot(GATE_NOW) },
    now: GATE_NOW,
    boundFingerprint: GATE_FINGERPRINT_B,
    expectation: { kind: "refusal", refusalReason: "duplicate" },
  },
  {
    name: "first-use-binds",
    applicationId: GATE_APP_ID,
    repoFingerprint: GATE_FINGERPRINT_A,
    files: {},
    bundle: { variant: "snapshot", snapshot: fixtureSnapshot(GATE_NOW) },
    now: GATE_NOW,
    boundFingerprint: null,
    expectation: { kind: "pass", refusalReason: null },
  },
  {
    name: "set-unreadable",
    applicationId: GATE_APP_ID,
    repoFingerprint: GATE_FINGERPRINT_A,
    files: {},
    bundle: {
      variant: "snapshot",
      snapshot: {
        ...fixtureSnapshot(GATE_NOW),
        effectiveSet: { project: gateProjectRef, standards: "not-an-array" } as unknown as EffectiveStandardSet,
      },
    },
    now: GATE_NOW,
    boundFingerprint: null,
    expectation: { kind: "refusal", refusalReason: "set-unreadable" },
  },
  {
    name: "bundle-stale",
    applicationId: GATE_APP_ID,
    repoFingerprint: GATE_FINGERPRINT_A,
    files: {},
    bundle: {
      variant: "snapshot",
      snapshot: fixtureSnapshot(GATE_NOW, { issuedAt: issuedAtHoursBefore(GATE_NOW, 48), frozenUntil: null }),
    },
    now: GATE_NOW,
    boundFingerprint: null,
    expectation: { kind: "refusal", refusalReason: "stale" },
  },
  {
    // Pins the mirrored `?? 24` staleness-bound default: the snapshot omits
    // stalenessBoundHours and is 25 hours old, so both adapters must refuse.
    name: "bundle-stale-default-bound",
    applicationId: GATE_APP_ID,
    repoFingerprint: GATE_FINGERPRINT_A,
    files: {},
    bundle: {
      variant: "snapshot",
      snapshot: fixtureSnapshot(GATE_NOW, { issuedAt: issuedAtHoursBefore(GATE_NOW, 25), stalenessBoundHours: undefined, frozenUntil: null }),
    },
    now: GATE_NOW,
    boundFingerprint: null,
    expectation: { kind: "refusal", refusalReason: "stale" },
  },
  {
    // A snapshot dated in the future is unparseable as a fresh bundle: the
    // staleness comparison fails closed on both paths.
    name: "bundle-stale-future-issued-at",
    applicationId: GATE_APP_ID,
    repoFingerprint: GATE_FINGERPRINT_A,
    files: {},
    bundle: {
      variant: "snapshot",
      snapshot: fixtureSnapshot(GATE_NOW, { issuedAt: issuedAtHoursBefore(GATE_NOW, -1), frozenUntil: null }),
    },
    now: GATE_NOW,
    boundFingerprint: null,
    expectation: { kind: "refusal", refusalReason: "stale" },
  },
  {
    // A freeze that has already expired at `now` no longer covers the run.
    name: "bundle-expired-freeze",
    applicationId: GATE_APP_ID,
    repoFingerprint: GATE_FINGERPRINT_A,
    files: {},
    bundle: {
      variant: "snapshot",
      snapshot: fixtureSnapshot(GATE_NOW, { issuedAt: issuedAtHoursBefore(GATE_NOW, 48), frozenUntil: issuedAtHoursBefore(GATE_NOW, 1) }),
    },
    now: GATE_NOW,
    boundFingerprint: null,
    expectation: { kind: "refusal", refusalReason: "stale" },
  },
  {
    name: "bundle-frozen",
    applicationId: GATE_APP_ID,
    repoFingerprint: GATE_FINGERPRINT_A,
    files: {},
    bundle: {
      variant: "snapshot",
      snapshot: fixtureSnapshot(GATE_NOW, { issuedAt: issuedAtHoursBefore(GATE_NOW, 48), frozenUntil: "2026-10-15T00:00:00.000Z" }),
    },
    now: GATE_NOW,
    boundFingerprint: null,
    expectation: { kind: "pass", refusalReason: null },
  },
  {
    name: "bundle-verification-failed",
    applicationId: GATE_APP_ID,
    repoFingerprint: GATE_FINGERPRINT_A,
    files: {},
    bundle: { variant: "verify-failed" },
    now: GATE_NOW,
    boundFingerprint: null,
    expectation: { kind: "refusal", refusalReason: "bundle-verification-failed" },
  },
  {
    name: "bundle-missing-set",
    applicationId: GATE_APP_ID,
    repoFingerprint: GATE_FINGERPRINT_A,
    files: {},
    bundle: { variant: "missing-set" },
    now: GATE_NOW,
    boundFingerprint: null,
    expectation: { kind: "refusal", refusalReason: "set-unreadable" },
  },
  {
    name: "run-did-not-complete-unreadable-rows",
    applicationId: GATE_APP_ID,
    repoFingerprint: GATE_FINGERPRINT_A,
    files: { "pnpm-lock.yaml": "::: not a lockfile" },
    bundle: { variant: "snapshot", snapshot: fixtureSnapshot(GATE_NOW) },
    now: GATE_NOW,
    boundFingerprint: null,
    expectation: { kind: "refusal", refusalReason: "run-did-not-complete" },
  },
  {
    name: "run-did-not-complete-slot-conflict",
    applicationId: GATE_APP_ID,
    repoFingerprint: GATE_FINGERPRINT_A,
    files: { "package.json": '{"dependencies":{"lodash":"4.17.21"}}' },
    bundle: {
      variant: "snapshot",
      snapshot: fixtureSnapshot(GATE_NOW, { effectiveSet: { project: gateProjectRef, standards: [slotConflictA, slotConflictB] } }),
    },
    now: GATE_NOW,
    boundFingerprint: null,
    expectation: { kind: "refusal", refusalReason: "run-did-not-complete" },
  },
];

/**
 * True when the fixture suite covers everything the compared paths share:
 * every Deviation kind has a fail fixture, the acceptance-window sides are
 * all present, every refusal reason turns up, and every outcome class is
 * exercised. A missing scenario fails this guard, so the suite's coverage is
 * proven by enumeration, not assumed.
 */
export function isFixtureCoverageComplete(): { readonly complete: boolean; readonly missing: readonly string[] } {
  const missing: string[] = [];
  const kindOf = (fixture: GateFixture): GateOutcome["kind"] => fixture.expectation.kind;
  const reasonOf = (fixture: GateFixture): GateRefusalReason | null => fixture.expectation.refusalReason;

  const kinds = new Set(gateFixtures.map(kindOf));
  for (const kind of ["pass", "fail", "refusal"] as const) {
    if (!kinds.has(kind)) missing.push(`kind-slice:${kind}`);
  }

  const failNames = new Set(gateFixtures.filter((fixture) => kindOf(fixture) === "fail").map((fixture) => fixture.name));
  for (const kind of DEVIATION_KINDS) {
    if (!failNames.has(`fail-${kind}`)) missing.push(`deviation-kind:${kind}`);
  }

  for (const name of ["accepted-live", "accepted-before-start", "accepted-at-end"]) {
    if (!gateFixtures.some((fixture) => fixture.name === name)) missing.push(`acceptance-slice:${name}`);
  }

  const reasons = new Set(
    gateFixtures.map(reasonOf).filter((reason): reason is GateRefusalReason => reason !== null),
  );
  for (const reason of Object.keys(REFUSAL_SENTENCE_BY_REASON) as GateRefusalReason[]) {
    if (!reasons.has(reason)) missing.push(`refusal-reason:${reason}`);
  }
  for (const reason of reasons) {
    if (!(reason in REFUSAL_SENTENCE_BY_REASON)) missing.push(`unknown-refusal-reason:${reason}`);
  }

  return { complete: missing.length === 0, missing };
}
