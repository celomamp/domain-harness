import { describe, expect, it } from "vitest";
import type { UuidV7 } from "@domain-harness/contract";
import { DEVIATION_KINDS } from "@domain-harness/contract";
import type { BindingLedger } from "./binding.ts";
import { createInMemoryBindingLedger } from "./binding.ts";
import { runGateDirect } from "./direct.ts";
import type { GateBundle, GateBundleSnapshot, GateFixture } from "./fixtures.ts";
import { GATE_APP_ID, GATE_NOW, gateFixtures, gateLodashAcceptance } from "./fixtures.ts";
import {
  FAIL,
  PASS,
} from "./sentences.ts";
import { formatDeviationLine, REFUSAL_SENTENCE_BY_REASON } from "./result.ts";

function fixtureByName(name: string): GateFixture {
  const fixture = gateFixtures.find((candidate) => candidate.name === name);
  expect(fixture, `fixture ${name} exists`).toBeDefined();
  if (fixture === undefined) throw new Error(`fixture ${name} is missing from the suite`);
  return fixture;
}

function runFixtureDirect(fixture: GateFixture): ReturnType<typeof runGateDirect> {
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

describe("runGateDirect (adapter semantics)", () => {
  it("never throws, whatever the inputs are", async () => {
    const junkLedger = createInMemoryBindingLedger();
    const junkSnapshot = {} as unknown as GateBundleSnapshot;
    await expect(
      runGateDirect({
        applicationId: GATE_APP_ID,
        repoFingerprint: "f".repeat(64),
        files: { "package.json": "not-json" },
        bundle: { variant: "snapshot", snapshot: junkSnapshot },
        ledger: junkLedger,
        now: GATE_NOW,
      }),
    ).resolves.toBeDefined();
    await expect(
      runGateDirect({
        applicationId: GATE_APP_ID,
        repoFingerprint: "",
        files: {},
        bundle: { variant: "verify-failed" },
        ledger: junkLedger,
        now: "nonsense",
      }),
    ).resolves.toBeDefined();
    // A snapshot-less bundle and a null bundle are malformed bundles: the
    // adapter returns a GateOutcome (bundle verification failed) and never
    // throws.
    const snapshotless = await runGateDirect({
      applicationId: GATE_APP_ID,
      repoFingerprint: "f".repeat(64),
      files: {},
      bundle: { variant: "snapshot", snapshot: undefined as unknown as GateBundleSnapshot },
      ledger: junkLedger,
      now: GATE_NOW,
    });
    expect(snapshotless.kind).toBe("refusal");
    const nullBundle = await runGateDirect({
      applicationId: GATE_APP_ID,
      repoFingerprint: "f".repeat(64),
      files: {},
      bundle: null as unknown as GateBundle,
      ledger: junkLedger,
      now: GATE_NOW,
    });
    expect(nullBundle.kind).toBe("refusal");
  });

  it("fail-closed: a broken binding ledger surfaces as 'run did not complete', exit 1 (never throws)", async () => {
    // getBinding rejects before any binding decision:
    const readBrokenLedger: BindingLedger = {
      getBinding: () => Promise.reject(new Error("ledger read failed")),
      bindApplication: (applicationId, fingerprint) => Promise.resolve({ applicationId, fingerprint }),
      recordBindingRefusal: (input) => Promise.resolve(input),
    };
    const firstUse = fixtureByName("first-use-binds");
    const readFailure = await runGateDirect({
      applicationId: firstUse.applicationId,
      repoFingerprint: firstUse.repoFingerprint,
      files: firstUse.files,
      bundle: firstUse.bundle,
      ledger: readBrokenLedger,
      now: firstUse.now,
    });
    expect(readFailure.kind).toBe("refusal");
    expect(readFailure.sentence).toBe("run did not complete");
    expect(readFailure.exitCode).toBe(1);

    // recordBindingRefusal rejects on a fingerprint mismatch (the mirror of
    // runner.test.ts's store-failure coverage):
    const duplicate = fixtureByName("duplicate-bound-to-other-fingerprint");
    const writeBrokenLedger: BindingLedger = {
      getBinding: (applicationId) =>
        Promise.resolve({ applicationId, fingerprint: duplicate.boundFingerprint ?? "" }),
      bindApplication: (applicationId, fingerprint) => Promise.resolve({ applicationId, fingerprint }),
      recordBindingRefusal: () => Promise.reject(new Error("ledger write failed")),
    };
    const writeFailure = await runGateDirect({
      applicationId: duplicate.applicationId,
      repoFingerprint: duplicate.repoFingerprint,
      files: duplicate.files,
      bundle: duplicate.bundle,
      ledger: writeBrokenLedger,
      now: duplicate.now,
    });
    expect(writeFailure.kind).toBe("refusal");
    expect(writeFailure.sentence).toBe("run did not complete");
    expect(writeFailure.exitCode).toBe(1);
  });

  it("refusals print their exact UX-DR29 sentence, exit 1 and are never a pass", async () => {
    for (const [reason, sentence] of Object.entries(REFUSAL_SENTENCE_BY_REASON)) {
      const fixture = gateFixtures.find((candidate) => candidate.expectation.refusalReason === reason);
      expect(fixture, `a fixture covers the ${reason} refusal`).toBeDefined();
      if (fixture === undefined) continue;
      const outcome = await runFixtureDirect(fixture);
      expect(outcome.kind).toBe("refusal");
      expect(outcome.exitCode).toBe(1);
      expect(outcome.sentence).toBe(sentence);
      expect(outcome.deviationLines).toEqual([]);
      expect(outcome.deviations).toEqual([]);
      expect(outcome.pinnedHash).toBeNull();
    }
  });

  it("a fail exits 1 with the fail sentence and exactly one line per open Deviation", async () => {
    for (const kind of DEVIATION_KINDS) {
      const fixture = fixtureByName(`fail-${kind}`);
      const outcome = await runFixtureDirect(fixture);
      expect(outcome.kind).toBe("fail");
      expect(outcome.exitCode).toBe(1);
      expect(outcome.sentence).toBe(FAIL);
      expect(outcome.refusalReason).toBeNull();
      expect(outcome.deviations).toHaveLength(1);
      expect(outcome.deviations[0]?.kind).toBe(kind);
      expect(outcome.deviations[0]?.status).toBe("open");
      expect(outcome.deviationLines).toEqual(outcome.deviations.filter((d) => d.status === "open").map(formatDeviationLine));
    }
  });

  it("a pass exits 0 with the pass sentence and no open Deviation", async () => {
    for (const name of ["pass", "accepted-live", "first-use-binds", "bundle-frozen"]) {
      const fixture = fixtureByName(name);
      const outcome = await runFixtureDirect(fixture);
      expect(outcome.kind).toBe("pass");
      expect(outcome.exitCode).toBe(0);
      expect(outcome.sentence).toBe(PASS);
      expect(outcome.deviationLines).toEqual([]);
      expect(outcome.pinnedHash).not.toBeNull();
    }
  });

  it("the acceptance window matches the core's contract: live while start <= now < end, open again at end", async () => {
    const acceptance = gateLodashAcceptance();
    expect(acceptance.start).toBe("2026-10-01T00:00:00.000Z");
    expect(acceptance.end).toBe("2026-11-01T00:00:00.000Z");

    const live = await runFixtureDirect(fixtureByName("accepted-live"));
    expect(live.kind).toBe("pass");

    const before = await runFixtureDirect(fixtureByName("accepted-before-start"));
    expect(before.kind).toBe("fail");
    expect(before.deviations[0]?.status).toBe("open");

    const atEnd = await runFixtureDirect(fixtureByName("accepted-at-end"));
    expect(atEnd.kind).toBe("fail");
    expect(atEnd.deviations[0]?.status).toBe("open");
  });

  it("the run-did-not-complete refusals come from the paths the table names: unreadable rows and a slot conflict", async () => {
    const unreadable = await runFixtureDirect(fixtureByName("run-did-not-complete-unreadable-rows"));
    expect(unreadable.kind).toBe("refusal");
    expect(unreadable.sentence).toBe("run did not complete");

    const conflict = await runFixtureDirect(fixtureByName("run-did-not-complete-slot-conflict"));
    expect(conflict.kind).toBe("refusal");
    expect(conflict.sentence).toBe("run did not complete");
  });

  it("records a binding refusal and refuses the duplicate id without depending on ledger mutation order", async () => {
    const refusals: unknown[] = [];
    const fixture = fixtureByName("duplicate-bound-to-other-fingerprint");
    const ledger = {
      getBinding(applicationId: UuidV7) {
        return Promise.resolve({ applicationId, fingerprint: fixture.boundFingerprint ?? "" });
      },
      bindApplication(applicationId: UuidV7, fingerprint: string) {
        return Promise.resolve({ applicationId, fingerprint });
      },
      recordBindingRefusal(input: { applicationId: UuidV7; presentedFingerprint: string; boundFingerprint: string }) {
        refusals.push(input);
        return Promise.resolve(input);
      },
    };
    const outcome = await runGateDirect({
      applicationId: fixture.applicationId,
      repoFingerprint: fixture.repoFingerprint,
      files: fixture.files,
      bundle: fixture.bundle,
      ledger,
      now: fixture.now,
    });
    expect(outcome.sentence).toBe("duplicate Application id");
    expect(refusals).toHaveLength(1);
  });
});
