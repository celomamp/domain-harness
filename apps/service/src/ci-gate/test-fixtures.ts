import type {
  CodeStackEntry,
  EffectiveStandard,
  EffectiveStandardSet,
  ProjectRef,
  RevisionFacts,
  UuidV7,
} from "@domain-harness/contract";
import type { ActiveBundleSnapshot } from "./bundle.ts";

export const FIXTURE_APP_ID = "018f3d2a-7000-7000-8000-000000000001" as UuidV7;
export const FIXTURE_OTHER_APP_ID = "018f3d2a-7000-7000-8000-000000000099" as UuidV7;
export const FIXTURE_PROJECT_ID = "018f3d2a-7000-7000-8000-000000000002" as UuidV7;
export const FIXTURE_MODULE_ID = "018f3d2a-7000-7000-8000-000000000003" as UuidV7;
export const FIXTURE_ACCOUNT_ID = "018f3d2a-7000-7000-8000-000000000004" as UuidV7;
export const FIXTURE_STD_PROHIBITED_ID = "018f3d2a-7000-7000-8000-000000000010" as UuidV7;
export const FIXTURE_STD_APPROVED_ID = "018f3d2a-7000-7000-8000-000000000011" as UuidV7;

export const FIXTURE_NOW = "2026-10-14T12:00:00.000Z";
export const FIXTURE_ISSUED_AT = "2026-10-14T10:00:00.000Z";
export const FIXTURE_PINNED_HASH = "sha256:pinned-bundle-001";

export const fixtureProjectRef: ProjectRef = { id: FIXTURE_PROJECT_ID, name: "Platform" };

export function buildCodeStackStandard(id: UuidV7, entry: CodeStackEntry): EffectiveStandard {
  return {
    slot: { moduleKind: "code-stack", slotKind: entry.category, name: entry.name },
    status: entry.status,
    standard: {
      id,
      version: 1,
      module: { id: FIXTURE_MODULE_ID, kind: "code-stack", name: "Code Stack" },
      project: fixtureProjectRef,
      entry,
      publishedAt: "2026-10-01T00:00:00.000Z",
      publishedBy: { accountId: FIXTURE_ACCOUNT_ID, name: "Sam Owner" },
    },
    sourceProject: fixtureProjectRef,
    locked: false,
  };
}

export const prohibitedLodashStandard: EffectiveStandard = buildCodeStackStandard(FIXTURE_STD_PROHIBITED_ID, {
  category: "library",
  name: "lodash",
  versionConstraint: null,
  status: "prohibited",
  correctionInstruction: null,
});

export const approvedRemedaStandard: EffectiveStandard = buildCodeStackStandard(FIXTURE_STD_APPROVED_ID, {
  category: "library",
  name: "remeda",
  versionConstraint: "^2.0.0",
  status: "approved",
  correctionInstruction: null,
});

export const validEffectiveSetFixture: EffectiveStandardSet = {
  project: fixtureProjectRef,
  standards: [prohibitedLodashStandard, approvedRemedaStandard],
};

export function makeFactsFixture(overrides: Partial<RevisionFacts> = {}): RevisionFacts {
  return {
    extractorVersion: "1.0.0",
    schemaVersion: "1.0.0",
    schemaMajor: 1,
    dependencies: [],
    imports: [],
    tokens: [],
    unreadable: [],
    ...overrides,
  };
}

export function makeSnapshotFixture(overrides: Partial<ActiveBundleSnapshot> = {}): ActiveBundleSnapshot {
  return {
    hash: FIXTURE_PINNED_HASH,
    issuedAt: FIXTURE_ISSUED_AT,
    applications: [FIXTURE_APP_ID],
    effectiveSet: validEffectiveSetFixture,
    accepted: [],
    stalenessBoundHours: 24,
    frozenUntil: null,
    ...overrides,
  };
}
