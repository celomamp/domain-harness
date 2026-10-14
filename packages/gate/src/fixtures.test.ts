import { describe, expect, it } from "vitest";
import { createInMemoryBindingLedger } from "./binding.ts";
import { runGateDirect } from "./direct.ts";
import type { GateFixture } from "./fixtures.ts";
import { isFixtureCoverageComplete, gateFixtures } from "./fixtures.ts";
import { canonicalGateBytes } from "./result.ts";

/** Run one fixture through the direct adapter on a fresh ledger. */
function runFixture(fixture: GateFixture): ReturnType<typeof runGateDirect> {
  return runGateDirect({
    applicationId: fixture.applicationId,
    repoFingerprint: fixture.repoFingerprint,
    files: fixture.files,
    bundle: fixture.bundle,
    ledger: createInMemoryBindingLedger(
      fixture.boundFingerprint === null
        ? []
        : [{ applicationId: fixture.applicationId, fingerprint: fixture.boundFingerprint }],
    ),
    now: fixture.now,
  });
}

describe("direct adapter over the fixture suite (Story 5.4)", () => {
  it("covers every Deviation kind, both acceptance-window sides and every refusal, by enumeration", () => {
    const coverage = isFixtureCoverageComplete();
    expect(coverage.missing).toEqual([]);
    expect(coverage.complete).toBe(true);
  });

  it("each expected kind and refusal reason is actually produced by the direct path (no vacuous parity)", async () => {
    for (const fixture of gateFixtures) {
      const outcome = await runFixture(fixture);
      expect(outcome.kind, `fixture ${fixture.name} kind`).toBe(fixture.expectation.kind);
      expect(outcome.refusalReason, `fixture ${fixture.name} refusalReason`).toBe(fixture.expectation.refusalReason);
    }
  });

  it("the same fixture run twice produces byte-identical canonical results (pure determinism)", async () => {
    for (const fixture of gateFixtures) {
      const first = canonicalGateBytes(await runFixture(fixture));
      const second = canonicalGateBytes(await runFixture(fixture));
      expect(second, `fixture ${fixture.name}`).toBe(first);
    }
  });

  it("re-ordering the inputs (standards array, accepted array, file key order) leaves the bytes unchanged", async () => {
    for (const fixture of gateFixtures) {
      if (fixture.bundle.variant !== "snapshot") continue;
      const standards = fixture.bundle.snapshot.effectiveSet.standards;
      if (!Array.isArray(standards)) continue;

      const reorderedFiles: Record<string, string> = {};
      for (const path of Object.keys(fixture.files).reverse()) {
        reorderedFiles[path] = fixture.files[path] ?? "";
      }

      const reorderedFixture: GateFixture = {
        ...fixture,
        files: reorderedFiles,
        bundle: {
          variant: "snapshot",
          snapshot: {
            ...fixture.bundle.snapshot,
            effectiveSet: { ...fixture.bundle.snapshot.effectiveSet, standards: standards.slice().reverse() },
            accepted: [...fixture.bundle.snapshot.accepted].reverse(),
          },
        },
      };

      const first = canonicalGateBytes(await runFixture(fixture));
      const second = canonicalGateBytes(await runFixture(reorderedFixture));
      expect(second, `fixture ${fixture.name}`).toBe(first);
    }
  });

  it("the whole suite runs deterministically across two whole-suite passes", async () => {
    const pass = async (): Promise<string[]> => {
      const bytes: string[] = [];
      for (const fixture of gateFixtures) {
        bytes.push(await runFixture(fixture).then(canonicalGateBytes));
      }
      return bytes;
    };
    const first = await pass();
    const second = await pass();
    expect(second).toEqual(first);
    expect(first).toHaveLength(gateFixtures.length);
  });
});
