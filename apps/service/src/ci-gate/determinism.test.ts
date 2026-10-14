import { describe, expect, it } from "vitest";
import type { RevisionFacts } from "@domain-harness/contract";
import { DEVIATION_KINDS } from "@domain-harness/contract";
import { extractRevisionFacts } from "@domain-harness/extractor";
import type { BindingLedger, GateOutcome, GateRefusalReason } from "@domain-harness/gate";
import {
  REFUSAL_REASON_BY_SENTENCE,
  REFUSAL_SENTENCE_BY_REASON,
  canonicalGateBytes,
  createInMemoryBindingLedger,
  runGateDirect,
  gateFixtures,
  isFixtureCoverageComplete,
} from "@domain-harness/gate";
import { runGate } from "./runner.ts";
import { createInMemoryGateRecordStore } from "./store.ts";

const REVISION = "1111111111111111111111111111111111111111";

/** The BundleSource shape expressing one fixture's bundle variant on the service path. */
function serviceBundleSource(fixture: (typeof gateFixtures)[number]): { source: Parameters<typeof runGate>[0]["source"] } {
  const bundle = fixture.bundle;
  if (bundle.variant === "verify-failed") {
    return {
      source: async () => {
        await Promise.resolve();
        return { ok: false, reason: "verify-failed" };
      },
    };
  }
  if (bundle.variant === "missing-set") {
    return {
      source: async () => {
        await Promise.resolve();
        return { ok: false, reason: "missing-set" };
      },
    };
  }
  const snapshot = bundle.snapshot;
  return {
    source: async () => {
      await Promise.resolve();
      return snapshot;
    },
  };
}

/** Run the service path for one fixture on a fresh in-memory store, and prove its classification first. */
async function runServiceGate(fixture: (typeof gateFixtures)[number]): Promise<GateOutcome> {
  const { source } = serviceBundleSource(fixture);
  const store = createInMemoryGateRecordStore();
  if (fixture.boundFingerprint !== null) {
    await store.bindApplication(fixture.applicationId, fixture.boundFingerprint);
  }
  const facts: RevisionFacts = extractRevisionFacts({ ...fixture.files });
  const outcome = await runGate({
    applicationId: fixture.applicationId,
    repoFingerprint: fixture.repoFingerprint,
    facts,
    revision: REVISION,
    now: fixture.now,
    source,
    store,
  });
  // Prove the service run's own classification from the fixture expectation,
  // so byte-equality cannot pass vacuously against a wrong service outcome.
  expect(outcome.kind, `service kind of ${fixture.name}`).toBe(fixture.expectation.kind);
  if (fixture.expectation.refusalReason === null) {
    expect(outcome.exitCode, `service exit of ${fixture.name}`).toBe(fixture.expectation.kind === "pass" ? 0 : 1);
  } else {
    expect(REFUSAL_REASON_BY_SENTENCE.get(outcome.sentence), `service reason of ${fixture.name}`).toBe(
      fixture.expectation.refusalReason,
    );
  }
  return {
    kind: outcome.kind,
    exitCode: outcome.exitCode,
    sentence: outcome.sentence,
    deviationLines: outcome.deviationLines,
    deviations: outcome.deviations,
    checked: outcome.checked,
    open: outcome.open,
    adherence: outcome.adherence,
    pinnedHash: outcome.pinnedHash,
    refusalReason: REFUSAL_REASON_BY_SENTENCE.get(outcome.sentence) ?? null,
  };
}

/** Run the direct adapter path for one fixture on a fresh in-memory ledger. */
function runDirectGate(fixture: (typeof gateFixtures)[number]): Promise<GateOutcome> {
  return runGateDirect({
    applicationId: fixture.applicationId,
    repoFingerprint: fixture.repoFingerprint,
    files: { ...fixture.files },
    bundle: fixture.bundle,
    ledger: createInMemoryBindingLedger(
      fixture.boundFingerprint === null
        ? []
        : [{ applicationId: fixture.applicationId, fingerprint: fixture.boundFingerprint }],
    ),
    now: fixture.now,
  });
}

describe("Gate determinism across adapters (Story 5.4)", () => {
  it("the fixture suite covers every Deviation kind, both acceptance sides and every runner refusal", () => {
    const coverage = isFixtureCoverageComplete();
    expect(coverage.missing).toEqual([]);
    expect(coverage.complete).toBe(true);
  });

  it("every fixture produces byte-identical canonical Gate results through both paths", async () => {
    let compared = 0;
    for (const fixture of gateFixtures) {
      const serviceOutcome = await runServiceGate(fixture);
      const directOutcome = await runDirectGate(fixture);

      expect(
        canonicalGateBytes(directOutcome),
        `fixture ${fixture.name}: direct vs service`,
      ).toBe(canonicalGateBytes(serviceOutcome));

      expect(directOutcome.kind, `kind of ${fixture.name}`).toBe(fixture.expectation.kind);
      expect(directOutcome.refusalReason, `refusal reason of ${fixture.name}`).toBe(
        fixture.expectation.refusalReason,
      );
      // Semantic pins so a wrong-but-equal pair cannot ship green: a pass
      // carries the fixture snapshot's pinned hash on both paths.
      if (fixture.expectation.kind === "pass" && fixture.bundle.variant === "snapshot") {
        expect(directOutcome.pinnedHash, `pinnedHash of ${fixture.name}`).toBe(fixture.bundle.snapshot.hash);
        expect(serviceOutcome.pinnedHash, `service pinnedHash of ${fixture.name}`).toBe(fixture.bundle.snapshot.hash);
      }
      // One representative pass fixture pins the counts too.
      if (fixture.name === "pass") {
        expect(directOutcome.checked, `checked of ${fixture.name}`).toBe(1);
        expect(directOutcome.open, `open of ${fixture.name}`).toBe(0);
        expect(directOutcome.adherence, `adherence of ${fixture.name}`).toBe(1);
      }
      compared += 1;
    }
    expect(compared).toBe(gateFixtures.length);
  });

  it("the service path's refusal sentence maps to exactly the fixture's refusal reason", async () => {
    const refusalFixtures = gateFixtures.filter((fixture) => fixture.expectation.kind === "refusal");
    expect(refusalFixtures.length).toBeGreaterThan(0);
    for (const fixture of refusalFixtures) {
      const serviceOutcome = await runServiceGate(fixture);
      const directOutcome = await runDirectGate(fixture);
      const reason = REFUSAL_REASON_BY_SENTENCE.get(serviceOutcome.sentence);
      expect(reason, `sentence of ${fixture.name} names its reason`).toBe(fixture.expectation.refusalReason);
      expect(directOutcome.refusalReason).toBe(fixture.expectation.refusalReason);
      expect(serviceOutcome.exitCode).toBe(1);
      expect(directOutcome.exitCode).toBe(1);
    }
  });

  it("every runner refusal reason has a fixture, by enumeration", () => {
    const covered = new Set(
      gateFixtures
        .map((fixture) => fixture.expectation.refusalReason)
        .filter((reason): reason is GateRefusalReason => reason !== null),
    );
    const allReasons: readonly string[] = Object.keys(REFUSAL_SENTENCE_BY_REASON);
    expect([...covered].sort()).toEqual([...allReasons].sort());
  });

  it("each fail fixture isolates exactly one Deviation of exactly one expected kind", async () => {
    for (const kind of DEVIATION_KINDS) {
      const fixture = gateFixtures.find((candidate) => candidate.name === `fail-${kind}`);
      expect(fixture, `a fixture covers Deviation kind ${kind}`).toBeDefined();
      if (fixture === undefined) continue;
      const directOutcome = await runDirectGate(fixture);
      expect(directOutcome.kind).toBe("fail");
      expect(directOutcome.deviationLines).toHaveLength(1);
      expect(directOutcome.deviations[0]?.kind).toBe(kind);
      expect(directOutcome.open).toBe(1);
    }
  });

  it("the acceptance window edges behave identically on both paths (start <= now < end, open again at end)", async () => {
    for (const name of ["accepted-live", "accepted-before-start", "accepted-at-end"]) {
      const fixture = gateFixtures.find((candidate) => candidate.name === name);
      expect(fixture, `fixture ${name} exists`).toBeDefined();
      if (fixture === undefined) continue;
      const serviceOutcome = await runServiceGate(fixture);
      const directOutcome = await runDirectGate(fixture);
      expect(canonicalGateBytes(directOutcome)).toBe(canonicalGateBytes(serviceOutcome));
      expect(serviceOutcome.kind).toBe(fixture.expectation.kind);
      expect(directOutcome.kind).toBe(fixture.expectation.kind);
    }
  });

  it("binding parity: the duplicate id is refused and recorded on both paths; first use binds on both", async () => {
    const duplicate = gateFixtures.find((candidate) => candidate.name === "duplicate-bound-to-other-fingerprint");
    expect(duplicate).toBeDefined();
    if (duplicate === undefined) return;
    if (duplicate.boundFingerprint === null) {
      throw new Error("the duplicate fixture must seed a bound fingerprint");
    }

    const serviceRefusals: unknown[] = [];
    const directRefusals: unknown[] = [];

    // Service path with a refusal-recording store:
    const serviceStore = createInMemoryGateRecordStore();
    await serviceStore.bindApplication(duplicate.applicationId, duplicate.boundFingerprint);
    const originalRecord = serviceStore.recordBindingRefusal.bind(serviceStore);
    serviceStore.recordBindingRefusal = async (input) => {
      serviceRefusals.push(input);
      return await originalRecord(input);
    };
    const { source } = serviceBundleSource(duplicate);
    const serviceOutcome = await runGate({
      applicationId: duplicate.applicationId,
      repoFingerprint: duplicate.repoFingerprint,
      facts: extractRevisionFacts({ ...duplicate.files }),
      revision: REVISION,
      now: duplicate.now,
      source,
      store: serviceStore,
    });
    expect(serviceRefusals).toHaveLength(1);

    // Direct path with a refusal-recording ledger:
    const directLedger = createInMemoryBindingLedger([
      { applicationId: duplicate.applicationId, fingerprint: duplicate.boundFingerprint },
    ]);
    const spyLedger: BindingLedger = {
      getBinding: (applicationId) => directLedger.getBinding(applicationId),
      bindApplication: (applicationId, fingerprint) => directLedger.bindApplication(applicationId, fingerprint),
      recordBindingRefusal: async (input) => {
        directRefusals.push(input);
        return await directLedger.recordBindingRefusal(input);
      },
    };
    const directOutcome = await runGateDirect({
      applicationId: duplicate.applicationId,
      repoFingerprint: duplicate.repoFingerprint,
      files: { ...duplicate.files },
      bundle: duplicate.bundle,
      ledger: spyLedger,
      now: duplicate.now,
    });

    expect(serviceOutcome.sentence).toBe(directOutcome.sentence);
    expect(directRefusals).toHaveLength(1);
    expect(serviceOutcome.bindingRefusal).toEqual({
      applicationId: duplicate.applicationId,
      presentedFingerprint: duplicate.repoFingerprint,
      boundFingerprint: duplicate.boundFingerprint,
    });
    expect(directRefusals[0]).toEqual(serviceOutcome.bindingRefusal);

    // First use binds on both paths, and the binding actually exists afterwards:
    const firstUse = gateFixtures.find((candidate) => candidate.name === "first-use-binds");
    expect(firstUse).toBeDefined();
    if (firstUse === undefined) return;

    const firstUseStore = createInMemoryGateRecordStore();
    const firstUseServiceSource = serviceBundleSource(firstUse);
    const firstUseService = await runGate({
      applicationId: firstUse.applicationId,
      repoFingerprint: firstUse.repoFingerprint,
      facts: extractRevisionFacts({ ...firstUse.files }),
      revision: REVISION,
      now: firstUse.now,
      source: firstUseServiceSource.source,
      store: firstUseStore,
    });
    expect((await firstUseStore.getBinding(firstUse.applicationId))?.fingerprint).toBe(firstUse.repoFingerprint);

    const firstUseLedger = createInMemoryBindingLedger();
    const firstUseDirect = await runGateDirect({
      applicationId: firstUse.applicationId,
      repoFingerprint: firstUse.repoFingerprint,
      files: { ...firstUse.files },
      bundle: firstUse.bundle,
      ledger: firstUseLedger,
      now: firstUse.now,
    });
    expect((await firstUseLedger.getBinding(firstUse.applicationId))?.fingerprint).toBe(firstUse.repoFingerprint);

    expect(canonicalGateBytes(firstUseDirect)).toBe(canonicalGateBytes(firstUseService));
    expect(firstUseService.kind).toBe("pass");
    expect(firstUseDirect.kind).toBe("pass");
  });

  it("a multi-element reordered set produces byte-identical canonical results on both paths", async () => {
    // Compose a genuinely multi-element snapshot from the existing
    // single-standards fixtures: prohibited + approved standards and one
    // live acceptance (the prohibited finding is accepted — one cause).
    const snapshotBundle = (fixture: (typeof gateFixtures)[number], name: string) => {
      if (fixture.bundle.variant !== "snapshot") throw new Error(`${name} must carry a snapshot bundle`);
      return fixture.bundle;
    };
    const prohibitedFixture = gateFixtures.find((candidate) => candidate.name === "fail-prohibited");
    const approvedFixture = gateFixtures.find((candidate) => candidate.name === "pass");
    const acceptanceFixture = gateFixtures.find((candidate) => candidate.name === "accepted-live");
    if (prohibitedFixture === undefined || approvedFixture === undefined || acceptanceFixture === undefined) {
      throw new Error("the composed case needs the prohibited, pass and accepted-live fixtures");
    }
    const prohibitedEntry = snapshotBundle(prohibitedFixture, "fail-prohibited").snapshot.effectiveSet.standards[0];
    const approvedEntry = snapshotBundle(approvedFixture, "pass").snapshot.effectiveSet.standards[0];
    const accepted = snapshotBundle(acceptanceFixture, "accepted-live").snapshot.accepted[0];
    if (prohibitedEntry === undefined || approvedEntry === undefined || accepted === undefined) {
      throw new Error("the composed set needs one standard from each source fixture and one acceptance");
    }
    const composedSnapshot = {
      ...snapshotBundle(prohibitedFixture, "fail-prohibited").snapshot,
      effectiveSet: {
        ...snapshotBundle(prohibitedFixture, "fail-prohibited").snapshot.effectiveSet,
        standards: [prohibitedEntry, approvedEntry],
      },
      accepted: [accepted],
    };
    const files: Record<string, string> = { "package.json": '{"dependencies":{"lodash":"4.17.21"}}' };
    const composedFixture: (typeof gateFixtures)[number] = {
      name: "composed-multi-element",
      applicationId: prohibitedFixture.applicationId,
      repoFingerprint: prohibitedFixture.repoFingerprint,
      files,
      bundle: { variant: "snapshot", snapshot: composedSnapshot },
      now: acceptanceFixture.now,
      boundFingerprint: null,
      expectation: { kind: "pass", refusalReason: null },
    };
    const reorderedFiles: Record<string, string> = {};
    for (const path of Object.keys(files).reverse()) {
      reorderedFiles[path] = files[path] ?? "";
    }
    const reorderedFixture: (typeof gateFixtures)[number] = {
      ...composedFixture,
      files: reorderedFiles,
      bundle: {
        variant: "snapshot",
        snapshot: {
          ...composedSnapshot,
          effectiveSet: {
            ...composedSnapshot.effectiveSet,
            standards: [...composedSnapshot.effectiveSet.standards].reverse(),
          },
          accepted: [...composedSnapshot.accepted].reverse(),
        },
      },
    };

    for (const fixture of [composedFixture, reorderedFixture]) {
      const serviceOutcome = await runServiceGate(fixture);
      const directOutcome = await runDirectGate(fixture);
      expect(canonicalGateBytes(directOutcome)).toBe(canonicalGateBytes(serviceOutcome));
      expect(serviceOutcome.kind).toBe("pass");
      expect(directOutcome.kind).toBe("pass");
    }
    // The reorder was non-trivial: the standards array genuinely flipped.
    const reorderedBundle = reorderedFixture.bundle;
    if (reorderedBundle.variant !== "snapshot") throw new Error("the reordered fixture carries a snapshot bundle");
    expect(reorderedBundle.snapshot.effectiveSet.standards[0]?.standard.id).toBe(
      approvedEntry.standard.id,
    );
  });
});
