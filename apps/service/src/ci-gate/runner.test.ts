import { describe, expect, it } from "vitest";
import { isEffectiveStandardSet } from "@domain-harness/contract";
import type { AcceptedDeviation, EffectiveStandardSet, RevisionFacts, UuidV7 } from "@domain-harness/contract";
import { runGate } from "./runner.ts";
import {
  BUNDLE_STALE,
  BUNDLE_VERIFICATION_FAILED,
  DUPLICATE_APPLICATION_ID,
  EFFECTIVE_STANDARD_SET_COULD_NOT_BE_READ,
  FAIL,
  PASS,
  RUN_DID_NOT_COMPLETE,
  UNBOUND,
} from "./sentences.ts";
import { createInMemoryGateRecordStore } from "./store.ts";
import type { ApplicationBinding } from "./store.ts";
import {
  FIXTURE_APP_ID,
  FIXTURE_NOW,
  FIXTURE_OTHER_APP_ID,
  FIXTURE_PINNED_HASH,
  FIXTURE_STD_PROHIBITED_ID,
  fixtureProjectRef,
  makeFactsFixture,
  makeSnapshotFixture,
  validEffectiveSetFixture,
} from "./test-fixtures.ts";

const FINGERPRINT_A = "a".repeat(64);
const FINGERPRINT_B = "b".repeat(64);
const REVISION = "1111111111111111111111111111111111111111";

describe("runGate (I/O & Edge-Case Matrix)", () => {
  it("validates the test fixture effectiveSet with isEffectiveStandardSet", () => {
    expect(isEffectiveStandardSet(validEffectiveSetFixture)).toBe(true);
  });

  it("Pass: valid identity, bound ok, valid set, no open Deviation -> pass sentence, exit 0, record stored with pinned hash and sequence 1", async () => {
    const store = createInMemoryGateRecordStore();
    const snapshot = makeSnapshotFixture();

    const outcome = await runGate({
      applicationId: FIXTURE_APP_ID,
      repoFingerprint: FINGERPRINT_A,
      facts: makeFactsFixture({ dependencies: [{ name: "remeda", version: "2.1.0" }] }),
      revision: REVISION,
      now: FIXTURE_NOW,
      source: async () => {
        await Promise.resolve();
        return snapshot;
      },
      store,
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.kind).toBe("pass");
    expect(outcome.exitCode).toBe(0);
    expect(outcome.sentence).toBe(PASS);
    expect(outcome.deviationLines).toEqual([]);
    expect(outcome.pinnedHash).toBe(FIXTURE_PINNED_HASH);
    expect(outcome.sequence).toBe(1);

    const runs = await store.listGateRuns(FIXTURE_APP_ID);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      sequence: 1,
      applicationId: FIXTURE_APP_ID,
      revision: REVISION,
      bundleHash: FIXTURE_PINNED_HASH,
      extractorVersion: "1.0.0",
      checked: 2,
      open: 0,
      adherence: 1,
      deviations: [],
    });
  });

  it("Fail (open Deviation): returns fail sentence, one log line per open Deviation with Standard id + slot + subject + correction, non-zero exit, and stores record", async () => {
    const store = createInMemoryGateRecordStore();
    const otherSlotAcceptance: AcceptedDeviation = {
      applicationId: FIXTURE_APP_ID,
      standardId: FIXTURE_STD_PROHIBITED_ID,
      standardVersion: 1,
      slot: { moduleKind: "code-stack", slotKind: "library", name: "underscore" },
      subject: "lodash",
      start: "2026-10-01T00:00:00.000Z",
      end: "2026-11-01T00:00:00.000Z",
    };
    const snapshot = makeSnapshotFixture({ accepted: [otherSlotAcceptance] });

    const outcome = await runGate({
      applicationId: FIXTURE_APP_ID,
      repoFingerprint: FINGERPRINT_A,
      facts: makeFactsFixture({ dependencies: [{ name: "lodash", version: "4.17.21" }] }),
      revision: REVISION,
      now: FIXTURE_NOW,
      source: async () => {
        await Promise.resolve();
        return snapshot;
      },
      store,
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.kind).toBe("fail");
    expect(outcome.exitCode).toBe(1);
    expect(outcome.sentence).toBe(FAIL);
    expect(outcome.open).toBe(1);
    expect(outcome.checked).toBe(2);
    expect(outcome.deviationLines).toHaveLength(1);
    expect(outcome.deviationLines[0]).toContain(FIXTURE_STD_PROHIBITED_ID);
    expect(outcome.deviationLines[0]).toContain("code-stack/library/lodash");
    expect(outcome.deviationLines[0]).toContain("lodash");
    expect(outcome.deviationLines[0]).toContain(
      `The Standard ${FIXTURE_STD_PROHIBITED_ID} prohibits lodash; use the approved library remeda instead.`,
    );

    const runs = await store.listGateRuns(FIXTURE_APP_ID);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.open).toBe(1);
    expect(runs[0]?.deviations).toHaveLength(1);
    expect(runs[0]?.deviations[0]?.status).toBe("open");
  });

  it("Accepted only: all findings accepted and unexpired -> pass sentence, exit 0, record stores the accepted statuses", async () => {
    const store = createInMemoryGateRecordStore();
    const liveAcceptance: AcceptedDeviation = {
      applicationId: FIXTURE_APP_ID,
      standardId: FIXTURE_STD_PROHIBITED_ID,
      standardVersion: 1,
      slot: { moduleKind: "code-stack", slotKind: "library", name: "lodash" },
      subject: "lodash",
      start: "2026-10-01T00:00:00.000Z",
      end: "2026-11-01T00:00:00.000Z",
    };
    const snapshot = makeSnapshotFixture({ accepted: [liveAcceptance] });

    const outcome = await runGate({
      applicationId: FIXTURE_APP_ID,
      repoFingerprint: FINGERPRINT_A,
      facts: makeFactsFixture({ dependencies: [{ name: "lodash", version: "4.17.21" }] }),
      revision: REVISION,
      now: FIXTURE_NOW,
      source: async () => {
        await Promise.resolve();
        return snapshot;
      },
      store,
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.kind).toBe("pass");
    expect(outcome.exitCode).toBe(0);
    expect(outcome.sentence).toBe(PASS);
    expect(outcome.deviationLines).toEqual([]);
    expect(outcome.open).toBe(0);

    const runs = await store.listGateRuns(FIXTURE_APP_ID);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.deviations).toHaveLength(1);
    expect(runs[0]?.deviations[0]?.status).toBe("accepted");
  });

  it("Unbound id: Application id absent from pinned snapshot applications -> refusal sentence, exit non-zero, no gate-run record", async () => {
    const store = createInMemoryGateRecordStore();
    const snapshot = makeSnapshotFixture({ applications: [FIXTURE_OTHER_APP_ID] });

    const outcome = await runGate({
      applicationId: FIXTURE_APP_ID,
      repoFingerprint: FINGERPRINT_A,
      facts: makeFactsFixture(),
      revision: REVISION,
      now: FIXTURE_NOW,
      source: async () => {
        await Promise.resolve();
        return snapshot;
      },
      store,
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.kind).toBe("refusal");
    expect(outcome.exitCode).toBe(1);
    expect(outcome.sentence).toBe(UNBOUND);
    expect(await store.listGateRuns(FIXTURE_APP_ID)).toEqual([]);
    expect(await store.getBinding(FIXTURE_APP_ID)).toBeNull();
  });

  it("First use & Duplicate id: creates TOFU binding on first use, and refuses a second fingerprint with a Binding-refusal record", async () => {
    const store = createInMemoryGateRecordStore();
    const snapshot = makeSnapshotFixture();

    const first = await runGate({
      applicationId: FIXTURE_APP_ID,
      repoFingerprint: FINGERPRINT_A,
      facts: makeFactsFixture(),
      revision: REVISION,
      now: FIXTURE_NOW,
      source: async () => {
        await Promise.resolve();
        return snapshot;
      },
      store,
    });

    expect(first.ok).toBe(true);
    expect(first.sentence).toBe(PASS);
    const binding = await store.getBinding(FIXTURE_APP_ID);
    expect(binding?.fingerprint).toBe(FINGERPRINT_A);

    const duplicate = await runGate({
      applicationId: FIXTURE_APP_ID,
      repoFingerprint: FINGERPRINT_B,
      facts: makeFactsFixture(),
      revision: REVISION,
      now: FIXTURE_NOW,
      source: async () => {
        await Promise.resolve();
        return snapshot;
      },
      store,
    });

    expect(duplicate.ok).toBe(false);
    expect(duplicate.kind).toBe("refusal");
    expect(duplicate.exitCode).toBe(1);
    expect(duplicate.sentence).toBe(DUPLICATE_APPLICATION_ID);

    expect(await store.listGateRuns(FIXTURE_APP_ID)).toHaveLength(1);
    const refusals = await store.listBindingRefusals(FIXTURE_APP_ID);
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatchObject({
      applicationId: FIXTURE_APP_ID,
      presentedFingerprint: FINGERPRINT_B,
      boundFingerprint: FINGERPRINT_A,
    });
  });

  it("Concurrent first-use TOFU race: when bindApplication returns an existing binding with a different fingerprint, records a binding refusal and returns DUPLICATE_APPLICATION_ID", async () => {
    const store = createInMemoryGateRecordStore();
    store.getBinding = () => Promise.resolve(null);
    store.bindApplication = (applicationId: UuidV7): Promise<ApplicationBinding> =>
      Promise.resolve({
        applicationId,
        fingerprint: FINGERPRINT_A,
      });

    const snapshot = makeSnapshotFixture();
    const outcome = await runGate({
      applicationId: FIXTURE_APP_ID,
      repoFingerprint: FINGERPRINT_B,
      facts: makeFactsFixture(),
      revision: REVISION,
      now: FIXTURE_NOW,
      source: async () => {
        await Promise.resolve();
        return snapshot;
      },
      store,
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.kind).toBe("refusal");
    expect(outcome.exitCode).toBe(1);
    expect(outcome.sentence).toBe(DUPLICATE_APPLICATION_ID);
    expect(await store.listGateRuns(FIXTURE_APP_ID)).toEqual([]);

    const refusals = await store.listBindingRefusals(FIXTURE_APP_ID);
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatchObject({
      applicationId: FIXTURE_APP_ID,
      presentedFingerprint: FINGERPRINT_B,
      boundFingerprint: FINGERPRINT_A,
    });
  });

  it("Propagates recordBindingRefusal store failures to RUN_DID_NOT_COMPLETE instead of swallowing them", async () => {
    const store = createInMemoryGateRecordStore();
    await store.bindApplication(FIXTURE_APP_ID, FINGERPRINT_A);
    store.recordBindingRefusal = () => Promise.reject(new Error("store write failed"));

    const outcome = await runGate({
      applicationId: FIXTURE_APP_ID,
      repoFingerprint: FINGERPRINT_B,
      facts: makeFactsFixture(),
      revision: REVISION,
      now: FIXTURE_NOW,
      source: async () => {
        await Promise.resolve();
        return makeSnapshotFixture();
      },
      store,
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.kind).toBe("refusal");
    expect(outcome.exitCode).toBe(1);
    expect(outcome.sentence).toBe(RUN_DID_NOT_COMPLETE);
  });

  it("Set unreadable: pinned set failing isEffectiveStandardSet or missing-set source -> refusal sentence, exit non-zero, no gate-run record", async () => {
    const store = createInMemoryGateRecordStore();
    const badSetSnapshot = makeSnapshotFixture({
      effectiveSet: { project: fixtureProjectRef, standards: "not-an-array" } as unknown as EffectiveStandardSet,
    });

    const outcome1 = await runGate({
      applicationId: FIXTURE_APP_ID,
      repoFingerprint: FINGERPRINT_A,
      facts: makeFactsFixture(),
      revision: REVISION,
      now: FIXTURE_NOW,
      source: async () => {
        await Promise.resolve();
        return badSetSnapshot;
      },
      store,
    });

    expect(outcome1.ok).toBe(false);
    expect(outcome1.kind).toBe("refusal");
    expect(outcome1.exitCode).toBe(1);
    expect(outcome1.sentence).toBe(EFFECTIVE_STANDARD_SET_COULD_NOT_BE_READ);
    expect(await store.listGateRuns(FIXTURE_APP_ID)).toEqual([]);

    const outcome2 = await runGate({
      applicationId: FIXTURE_APP_ID,
      repoFingerprint: FINGERPRINT_A,
      facts: makeFactsFixture(),
      revision: REVISION,
      now: FIXTURE_NOW,
      source: async () => {
        await Promise.resolve();
        return { ok: false, reason: "missing-set" as const };
      },
      store,
    });

    expect(outcome2.sentence).toBe(EFFECTIVE_STANDARD_SET_COULD_NOT_BE_READ);
    expect(outcome2.exitCode).toBe(1);
    expect(await store.listGateRuns(FIXTURE_APP_ID)).toEqual([]);
  });

  it("Bundle verification failed: source returning verify-failed refuses with BUNDLE_VERIFICATION_FAILED", async () => {
    const store = createInMemoryGateRecordStore();
    const outcome = await runGate({
      applicationId: FIXTURE_APP_ID,
      repoFingerprint: FINGERPRINT_A,
      facts: makeFactsFixture(),
      revision: REVISION,
      now: FIXTURE_NOW,
      source: async () => {
        await Promise.resolve();
        return { ok: false, reason: "verify-failed" as const };
      },
      store,
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.kind).toBe("refusal");
    expect(outcome.exitCode).toBe(1);
    expect(outcome.sentence).toBe(BUNDLE_VERIFICATION_FAILED);
    expect(await store.listGateRuns(FIXTURE_APP_ID)).toEqual([]);
  });

  it("Stale: snapshot older than its bound with no live freeze -> stale sentence, exit non-zero, no gate-run record", async () => {
    const store = createInMemoryGateRecordStore();
    const staleSnapshot = makeSnapshotFixture({
      issuedAt: "2026-10-12T00:00:00.000Z",
      stalenessBoundHours: 24,
      frozenUntil: null,
    });

    const outcome = await runGate({
      applicationId: FIXTURE_APP_ID,
      repoFingerprint: FINGERPRINT_A,
      facts: makeFactsFixture(),
      revision: REVISION,
      now: FIXTURE_NOW,
      source: async () => {
        await Promise.resolve();
        return staleSnapshot;
      },
      store,
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.kind).toBe("refusal");
    expect(outcome.exitCode).toBe(1);
    expect(outcome.sentence).toBe(BUNDLE_STALE);
    expect(await store.listGateRuns(FIXTURE_APP_ID)).toEqual([]);
  });

  it("Default 24-hour staleness bound (AD-21): applies 24h when stalenessBoundHours is undefined or null", async () => {
    const store = createInMemoryGateRecordStore();

    // 23 hours old with stalenessBoundHours: undefined -> passes
    const withinUndefined = makeSnapshotFixture({
      issuedAt: "2026-10-13T13:00:00.000Z",
      stalenessBoundHours: undefined,
      frozenUntil: null,
    });
    const passUndefined = await runGate({
      applicationId: FIXTURE_APP_ID,
      repoFingerprint: FINGERPRINT_A,
      facts: makeFactsFixture(),
      revision: REVISION,
      now: FIXTURE_NOW,
      source: async () => {
        await Promise.resolve();
        return withinUndefined;
      },
      store,
    });
    expect(passUndefined.ok).toBe(true);
    expect(passUndefined.sentence).toBe(PASS);

    // 25 hours old with stalenessBoundHours: undefined -> refuses BUNDLE_STALE
    const pastUndefined = makeSnapshotFixture({
      issuedAt: "2026-10-13T11:00:00.000Z",
      stalenessBoundHours: undefined,
      frozenUntil: null,
    });
    const staleUndefined = await runGate({
      applicationId: FIXTURE_APP_ID,
      repoFingerprint: FINGERPRINT_A,
      facts: makeFactsFixture(),
      revision: REVISION,
      now: FIXTURE_NOW,
      source: async () => {
        await Promise.resolve();
        return pastUndefined;
      },
      store,
    });
    expect(staleUndefined.ok).toBe(false);
    expect(staleUndefined.sentence).toBe(BUNDLE_STALE);

    // 23 hours old with stalenessBoundHours: null -> passes
    const withinNull = makeSnapshotFixture({
      issuedAt: "2026-10-13T13:00:00.000Z",
      stalenessBoundHours: null,
      frozenUntil: null,
    });
    const passNull = await runGate({
      applicationId: FIXTURE_APP_ID,
      repoFingerprint: FINGERPRINT_A,
      facts: makeFactsFixture(),
      revision: REVISION,
      now: FIXTURE_NOW,
      source: async () => {
        await Promise.resolve();
        return withinNull;
      },
      store,
    });
    expect(passNull.ok).toBe(true);
    expect(passNull.sentence).toBe(PASS);

    // 25 hours old with stalenessBoundHours: null -> refuses BUNDLE_STALE
    const pastNull = makeSnapshotFixture({
      issuedAt: "2026-10-13T11:00:00.000Z",
      stalenessBoundHours: null,
      frozenUntil: null,
    });
    const staleNull = await runGate({
      applicationId: FIXTURE_APP_ID,
      repoFingerprint: FINGERPRINT_A,
      facts: makeFactsFixture(),
      revision: REVISION,
      now: FIXTURE_NOW,
      source: async () => {
        await Promise.resolve();
        return pastNull;
      },
      store,
    });
    expect(staleNull.ok).toBe(false);
    expect(staleNull.sentence).toBe(BUNDLE_STALE);
  });

  it("Frozen: snapshot older than its bound but with a freeze covering now proceeds and passes", async () => {
    const store = createInMemoryGateRecordStore();
    const frozenSnapshot = makeSnapshotFixture({
      issuedAt: "2026-10-10T00:00:00.000Z",
      stalenessBoundHours: 24,
      frozenUntil: "2026-10-15T00:00:00.000Z",
    });

    const outcome = await runGate({
      applicationId: FIXTURE_APP_ID,
      repoFingerprint: FINGERPRINT_A,
      facts: makeFactsFixture(),
      revision: REVISION,
      now: FIXTURE_NOW,
      source: async () => {
        await Promise.resolve();
        return frozenSnapshot;
      },
      store,
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.kind).toBe("pass");
    expect(outcome.exitCode).toBe(0);
    expect(outcome.sentence).toBe(PASS);
    expect(await store.listGateRuns(FIXTURE_APP_ID)).toHaveLength(1);
  });

  it("Mid-run activation: pins the snapshot once at start and records the pinned hash even if the source would return a newer snapshot next", async () => {
    const store = createInMemoryGateRecordStore();
    let calls = 0;
    const pinnedSnapshot = makeSnapshotFixture({ hash: "sha256:pinned-first" });
    const newerSnapshot = makeSnapshotFixture({ hash: "sha256:activated-mid-run" });

    const outcome = await runGate({
      applicationId: FIXTURE_APP_ID,
      repoFingerprint: FINGERPRINT_A,
      facts: makeFactsFixture(),
      revision: REVISION,
      now: FIXTURE_NOW,
      source: async () => {
        await Promise.resolve();
        calls += 1;
        return calls === 1 ? pinnedSnapshot : newerSnapshot;
      },
      store,
    });

    expect(calls).toBe(1);
    expect(outcome.ok).toBe(true);
    expect(outcome.pinnedHash).toBe("sha256:pinned-first");
    const runs = await store.listGateRuns(FIXTURE_APP_ID);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.bundleHash).toBe("sha256:pinned-first");
  });

  it("Run did not complete: refuses and never touches the store when facts are invalid or unreadable, or when appendGateRun throws", async () => {
    const store = createInMemoryGateRecordStore();
    let storeTouched = false;
    const origGetBinding = store.getBinding.bind(store);
    const origBindApp = store.bindApplication.bind(store);
    store.getBinding = (id) => {
      storeTouched = true;
      return origGetBinding(id);
    };
    store.bindApplication = (id, fp) => {
      storeTouched = true;
      return origBindApp(id, fp);
    };
    const snapshot = makeSnapshotFixture();

    const badFactsOutcome = await runGate({
      applicationId: FIXTURE_APP_ID,
      repoFingerprint: FINGERPRINT_A,
      facts: { invalid: true } as unknown as RevisionFacts,
      revision: REVISION,
      now: FIXTURE_NOW,
      source: async () => {
        await Promise.resolve();
        return snapshot;
      },
      store,
    });

    expect(badFactsOutcome.ok).toBe(false);
    expect(badFactsOutcome.kind).toBe("refusal");
    expect(badFactsOutcome.exitCode).toBe(1);
    expect(badFactsOutcome.sentence).toBe(RUN_DID_NOT_COMPLETE);
    expect(storeTouched).toBe(false);
    expect(await store.listGateRuns(FIXTURE_APP_ID)).toEqual([]);

    const unreadableFactsOutcome = await runGate({
      applicationId: FIXTURE_APP_ID,
      repoFingerprint: FINGERPRINT_A,
      facts: makeFactsFixture({ unreadable: [{ path: "package.json", reason: "package.json is not valid JSON" }] }),
      revision: REVISION,
      now: FIXTURE_NOW,
      source: async () => {
        await Promise.resolve();
        return snapshot;
      },
      store,
    });

    expect(unreadableFactsOutcome.ok).toBe(false);
    expect(unreadableFactsOutcome.kind).toBe("refusal");
    expect(unreadableFactsOutcome.exitCode).toBe(1);
    expect(unreadableFactsOutcome.sentence).toBe(RUN_DID_NOT_COMPLETE);
    expect(storeTouched).toBe(false);
    expect(await store.listGateRuns(FIXTURE_APP_ID)).toEqual([]);

    const throwingAppendStore = createInMemoryGateRecordStore();
    throwingAppendStore.appendGateRun = () => Promise.reject(new Error("append failed"));

    const appendFailedOutcome = await runGate({
      applicationId: FIXTURE_APP_ID,
      repoFingerprint: FINGERPRINT_A,
      facts: makeFactsFixture(),
      revision: REVISION,
      now: FIXTURE_NOW,
      source: async () => {
        await Promise.resolve();
        return snapshot;
      },
      store: throwingAppendStore,
    });

    expect(appendFailedOutcome.ok).toBe(false);
    expect(appendFailedOutcome.kind).toBe("refusal");
    expect(appendFailedOutcome.exitCode).toBe(1);
    expect(appendFailedOutcome.sentence).toBe(RUN_DID_NOT_COMPLETE);
  });

  it("Throwing collector: a recordGateRun throw never changes the run outcome (6.3 durable-delivery seam)", async () => {
    const store = createInMemoryGateRecordStore();
    const snapshot = makeSnapshotFixture();

    const outcome = await runGate({
      applicationId: FIXTURE_APP_ID,
      repoFingerprint: FINGERPRINT_A,
      facts: makeFactsFixture({ dependencies: [{ name: "remeda", version: "2.1.0" }] }),
      revision: REVISION,
      now: FIXTURE_NOW,
      source: async () => {
        await Promise.resolve();
        return snapshot;
      },
      store,
      collector: {
        recordGuidance: () => Promise.resolve(),
        recordGateRun: () => Promise.reject(new Error("outbox down")),
      },
      collectorAgentToolName: "cursor",
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.kind).toBe("pass");
    expect(outcome.sentence).toBe(PASS);
    expect(await store.listGateRuns(FIXTURE_APP_ID)).toHaveLength(1);
  });

  it("Step-cannot-run / unreachable store path: refuses without throwing when store.getBinding throws", async () => {
    const brokenStore = createInMemoryGateRecordStore();
    brokenStore.getBinding = () => Promise.reject(new Error("connection refused"));
    const snapshot = makeSnapshotFixture();

    const outcome = await runGate({
      applicationId: FIXTURE_APP_ID,
      repoFingerprint: FINGERPRINT_A,
      facts: makeFactsFixture(),
      revision: REVISION,
      now: FIXTURE_NOW,
      source: async () => {
        await Promise.resolve();
        return snapshot;
      },
      store: brokenStore,
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.kind).toBe("refusal");
    expect(outcome.exitCode).toBe(1);
    expect(outcome.sentence).toBe(RUN_DID_NOT_COMPLETE);
  });
});
