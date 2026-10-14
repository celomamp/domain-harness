/**
 * Unit suite for the Guidance identity decision (Story 4.3): every
 * decision-table row pinned against the InMemory store and a stub
 * active-bundle source, in fixed precedence and never throwing.
 */
import { describe, expect, it } from "vitest";
import type { StandardBundlePayload, UuidV7 } from "@domain-harness/contract";
import {
  MISSING_IDENTIFICATION_FILE,
  RUN_DID_NOT_COMPLETE,
  DUPLICATE_APPLICATION_ID,
  UNBOUND,
} from "@domain-harness/gate";
import { COMMIT_ONCE, resolveGuidanceIdentity } from "./identity.ts";
import type { PinnedActiveBundle, ResolveGuidanceIdentityInput } from "./identity.ts";
import { createInMemoryGuidanceIdentityStore } from "./store.ts";
import type { GuidanceIdentityStore } from "./store.ts";
import { makeBundlePayload } from "../bundles/test-fixtures.ts";

const TENANT = "018f3d2a-7000-7000-8000-000000000100" as UuidV7;
const OTHER_TENANT = "018f3d2a-7000-7000-8000-000000000101" as UuidV7;
const APPLICATION_ID = "018f3d2a-7000-7000-8000-000000000001" as UuidV7;
const PROJECT_ID = "018f3d2a-7000-7000-8000-000000000002" as UuidV7;
const OTHER_PROJECT_ID = "018f3d2a-7000-7000-8000-000000000003" as UuidV7;
const UNKNOWN_APPLICATION_ID = "018f3d2a-7000-7000-8000-000000000004" as UuidV7;
const BUNDLE_HASH = "a".repeat(64);
const FP_1 = "1".repeat(64);
const FP_2 = "2".repeat(64);

function bundleWithApplications(applications: readonly { id: UuidV7; projectId: UuidV7; fromFlow: boolean }[]): PinnedActiveBundle {
  const payload: StandardBundlePayload = {
    ...makeBundlePayload({ keyId: "identity-test-key", sequence: 1, issuedAt: "2026-10-14T12:00:00.000Z" }),
    applications,
  };
  return { payload, hash: BUNDLE_HASH };
}

function inputOf(overrides: Partial<ResolveGuidanceIdentityInput> = {}): ResolveGuidanceIdentityInput {
  return {
    headers: {
      applicationId: APPLICATION_ID,
      advisoryProjectId: PROJECT_ID,
      repoFingerprint: FP_1,
      ...overrides.headers,
    },
    tenantId: overrides.tenantId ?? TENANT,
    store: overrides.store ?? createInMemoryGuidanceIdentityStore(),
    getPinnedBundle: overrides.getPinnedBundle ?? (() => Promise.resolve(bundleWithApplications([{ id: APPLICATION_ID, projectId: PROJECT_ID, fromFlow: false }]))),
  };
}

describe("resolveGuidanceIdentity: the unbound rows", () => {
  it("answers commit-first before anything else when the fingerprint is absent or empty", async () => {
    for (const repoFingerprint of [undefined, "", "   "]) {
      const result = await resolveGuidanceIdentity(inputOf({ headers: { applicationId: APPLICATION_ID, advisoryProjectId: PROJECT_ID, repoFingerprint } }));
      expect(result).toEqual({ kind: "unbound", reason: "commit_first", sentence: COMMIT_ONCE });
    }
  });

  it("answers the identification-file sentence when the id header is absent, binding and recording nothing", async () => {
    const store = createInMemoryGuidanceIdentityStore();
    for (const applicationId of [undefined, "", "   "] as const) {
      const result = await resolveGuidanceIdentity(
        inputOf({ store, headers: { applicationId, advisoryProjectId: undefined, repoFingerprint: FP_1 } }),
      );
      expect(result).toEqual({ kind: "unbound", reason: "missing_identification_file", sentence: MISSING_IDENTIFICATION_FILE });
    }
    expect(await store.getBinding(APPLICATION_ID)).toBeNull();
    expect(await store.listBindingRefusals()).toEqual([]);
    expect(await store.listProjectMismatches()).toEqual([]);
  });

  it("answers the unbound-Application sentence when the id is not in the active bundle, leaving the binding untouched", async () => {
    const store = createInMemoryGuidanceIdentityStore();
    await store.bindApplication(APPLICATION_ID, FP_1);
    const unknown = await resolveGuidanceIdentity(inputOf({ headers: { applicationId: UNKNOWN_APPLICATION_ID, advisoryProjectId: PROJECT_ID, repoFingerprint: FP_2 } }));
    expect(unknown).toEqual({ kind: "unbound", reason: "unknown_application", sentence: UNBOUND });
    expect("projectId" in unknown).toBe(false);
    // The precedent binding of the known id is untouched and nothing was recorded.
    expect(await store.getBinding(APPLICATION_ID)).toEqual({ applicationId: APPLICATION_ID, fingerprint: FP_1, createdAt: expect.any(String) as string });
    expect(await store.listBindingRefusals()).toEqual([]);
    expect(await store.listProjectMismatches()).toEqual([]);
  });

  it("answers the unbound-Application sentence when no bundle is active", async () => {
    const result = await resolveGuidanceIdentity(inputOf({ getPinnedBundle: () => Promise.resolve(null) }));
    expect(result).toEqual({ kind: "unbound", reason: "unknown_application", sentence: UNBOUND });
  });

  it("answers the unbound-Application sentence when the active bundle belongs to another tenant", async () => {
    const result = await resolveGuidanceIdentity(
      inputOf({ tenantId: OTHER_TENANT, getPinnedBundle: (tenantId) => Promise.resolve(tenantId === TENANT ? bundleWithApplications([{ id: APPLICATION_ID, projectId: PROJECT_ID, fromFlow: false }]) : null) }),
    );
    expect(result).toEqual({ kind: "unbound", reason: "unknown_application", sentence: UNBOUND });
  });
});

describe("resolveGuidanceIdentity: trust on first use", () => {
  it("binds a first-seen id from the bundle once and answers bound with the bundle's Project id and hash", async () => {
    const store = createInMemoryGuidanceIdentityStore();
    const result = await resolveGuidanceIdentity(inputOf({ store }));
    expect(result).toEqual({
      kind: "bound",
      applicationId: APPLICATION_ID,
      projectId: PROJECT_ID,
      bundleHash: BUNDLE_HASH,
      advisoryMismatch: null,
    });
    expect(await store.getBinding(APPLICATION_ID)).toEqual({ applicationId: APPLICATION_ID, fingerprint: FP_1, createdAt: expect.any(String) as string });
    expect(await store.listBindingRefusals()).toEqual([]);
    expect(await store.listProjectMismatches()).toEqual([]);
  });

  it("answers bound with the bundle's Project id even when the advisory Project id disagrees, and records the mismatch", async () => {
    const store = createInMemoryGuidanceIdentityStore();
    const result = await resolveGuidanceIdentity(
      inputOf({ store, headers: { applicationId: APPLICATION_ID, advisoryProjectId: OTHER_PROJECT_ID, repoFingerprint: FP_1 } }),
    );
    expect(result).toEqual({
      kind: "bound",
      applicationId: APPLICATION_ID,
      projectId: PROJECT_ID,
      bundleHash: BUNDLE_HASH,
      advisoryMismatch: { presentedProjectId: OTHER_PROJECT_ID, bundleProjectId: PROJECT_ID },
    });
    expect(await store.getBinding(APPLICATION_ID)).toEqual({ applicationId: APPLICATION_ID, fingerprint: FP_1, createdAt: expect.any(String) as string });
    expect(await store.listProjectMismatches(APPLICATION_ID)).toEqual([
      {
        id: expect.any(String) as string,
        applicationId: APPLICATION_ID,
        presentedProjectId: OTHER_PROJECT_ID,
        bundleProjectId: PROJECT_ID,
        bundleHash: BUNDLE_HASH,
        createdAt: expect.any(String) as string,
      },
    ]);
  });

  it("reports no mismatch when the advisory Project id agrees or is absent", async () => {
    const store = createInMemoryGuidanceIdentityStore();
    const agree = await resolveGuidanceIdentity(inputOf({ store, headers: { applicationId: APPLICATION_ID, advisoryProjectId: PROJECT_ID, repoFingerprint: FP_1 } }));
    expect(agree.kind).toBe("bound");
    if (agree.kind === "bound") expect(agree.advisoryMismatch).toBeNull();
    const absent = await resolveGuidanceIdentity(inputOf({ store, headers: { applicationId: APPLICATION_ID, advisoryProjectId: undefined, repoFingerprint: FP_1 } }));
    expect(absent.kind).toBe("bound");
    if (absent.kind === "bound") expect(absent.advisoryMismatch).toBeNull();
    expect(await store.listProjectMismatches()).toEqual([]);
  });
});

describe("resolveGuidanceIdentity: the bound rows", () => {
  it("answers bound with no new row and no refusal when the fingerprint equals the binding", async () => {
    const store = createInMemoryGuidanceIdentityStore();
    await store.bindApplication(APPLICATION_ID, FP_1);
    const result = await resolveGuidanceIdentity(inputOf({ store }));
    expect(result).toEqual({
      kind: "bound",
      applicationId: APPLICATION_ID,
      projectId: PROJECT_ID,
      bundleHash: BUNDLE_HASH,
      advisoryMismatch: null,
    });
    expect(await store.listBindingRefusals()).toEqual([]);
    expect(await store.getBinding(APPLICATION_ID)).toEqual({ applicationId: APPLICATION_ID, fingerprint: FP_1, createdAt: expect.any(String) as string });
  });

  it("refuses a copied identity in the fixed sentence and records one binding refusal row", async () => {
    const store = createInMemoryGuidanceIdentityStore();
    await store.bindApplication(APPLICATION_ID, FP_1);
    const result = await resolveGuidanceIdentity(inputOf({ store, headers: { applicationId: APPLICATION_ID, advisoryProjectId: PROJECT_ID, repoFingerprint: FP_2 } }));
    expect(result).toEqual({
      kind: "refused",
      sentence: DUPLICATE_APPLICATION_ID,
      presentedFingerprint: FP_2,
      boundFingerprint: FP_1,
    });
    const refusals = await store.listBindingRefusals(APPLICATION_ID);
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatchObject({
      applicationId: APPLICATION_ID,
      presentedFingerprint: FP_2,
      boundFingerprint: FP_1,
    });
    const binding = await store.getBinding(APPLICATION_ID);
    expect(binding?.fingerprint).toBe(FP_1);
  });

  it("records NO advisory mismatch for a refused call even when its advisory Project id also disagrees", async () => {
    const store = createInMemoryGuidanceIdentityStore();
    await store.bindApplication(APPLICATION_ID, FP_1);
    const result = await resolveGuidanceIdentity(
      inputOf({ store, headers: { applicationId: APPLICATION_ID, advisoryProjectId: OTHER_PROJECT_ID, repoFingerprint: FP_2 } }),
    );
    expect(result.kind).toBe("refused");
    expect(await store.listProjectMismatches()).toEqual([]);
  });

  it("records one binding refusal row per refused call: a repeat offender appends a second row", async () => {
    const store = createInMemoryGuidanceIdentityStore();
    await store.bindApplication(APPLICATION_ID, FP_1);
    const first = await resolveGuidanceIdentity(
      inputOf({ store, headers: { applicationId: APPLICATION_ID, advisoryProjectId: PROJECT_ID, repoFingerprint: FP_2 } }),
    );
    const second = await resolveGuidanceIdentity(
      inputOf({ store, headers: { applicationId: APPLICATION_ID, advisoryProjectId: PROJECT_ID, repoFingerprint: FP_2 } }),
    );
    expect(first.kind).toBe("refused");
    expect(second.kind).toBe("refused");
    const refusals = await store.listBindingRefusals(APPLICATION_ID);
    expect(refusals).toHaveLength(2);
    for (const refusal of refusals) {
      expect(refusal).toMatchObject({
        applicationId: APPLICATION_ID,
        presentedFingerprint: FP_2,
        boundFingerprint: FP_1,
      });
    }
  });

  it("answers two first calls with different fingerprints exactly once bound (the first presented) once refused", async () => {
    const store = createInMemoryGuidanceIdentityStore();
    const [a, b] = await Promise.all([
      resolveGuidanceIdentity(inputOf({ store, headers: { applicationId: APPLICATION_ID, advisoryProjectId: PROJECT_ID, repoFingerprint: FP_1 } })),
      resolveGuidanceIdentity(inputOf({ store, headers: { applicationId: APPLICATION_ID, advisoryProjectId: PROJECT_ID, repoFingerprint: FP_2 } })),
    ]);
    // Which caller binds is only a microtask-scheduling outcome with the
    // InMemory store, so nothing about the order is pinned — exactly like
    // the Postgres race test: exactly one `bound` and one `refused`, the
    // bound one carrying the bundle's Project id and hash, and the
    // surviving binding being the fingerprint the refused call was told.
    const outcomes = [a, b];
    expect(outcomes.map((outcome) => outcome.kind).sort()).toEqual(["bound", "refused"]);
    const winner = outcomes.find((outcome) => outcome.kind === "bound") as Extract<(typeof outcomes)[number], { kind: "bound" }>;
    const loser = outcomes.find((outcome) => outcome.kind === "refused") as Extract<(typeof outcomes)[number], { kind: "refused" }>;
    expect(winner).toEqual({
      kind: "bound",
      applicationId: APPLICATION_ID,
      projectId: PROJECT_ID,
      bundleHash: BUNDLE_HASH,
      advisoryMismatch: null,
    });
    expect(loser).toEqual({
      kind: "refused",
      sentence: DUPLICATE_APPLICATION_ID,
      presentedFingerprint: expect.any(String) as string,
      boundFingerprint: expect.any(String) as string,
    });
    const binding = await store.getBinding(APPLICATION_ID);
    expect(binding?.fingerprint).toBe(loser.boundFingerprint);
    expect(await store.listBindingRefusals(APPLICATION_ID)).toHaveLength(1);
  });
});

describe("resolveGuidanceIdentity: never throws", () => {
  it("answers the run-did-not-complete sentence when the store fails, recording and binding nothing", async () => {
    const failing: GuidanceIdentityStore = {
      getBinding: () => Promise.reject(new Error("store down")),
      bindApplication: () => Promise.reject(new Error("store down")),
      recordBindingRefusal: () => Promise.reject(new Error("store down")),
      listBindingRefusals: () => Promise.reject(new Error("store down")),
      recordProjectMismatch: () => Promise.reject(new Error("store down")),
      listProjectMismatches: () => Promise.reject(new Error("store down")),
    };
    const result = await resolveGuidanceIdentity(inputOf({ store: failing }));
    expect(result).toEqual({ kind: "unbound", reason: "unavailable", sentence: RUN_DID_NOT_COMPLETE });
  });

  it("answers the run-did-not-complete sentence when the bundle source fails", async () => {
    const result = await resolveGuidanceIdentity(
      inputOf({ getPinnedBundle: () => Promise.reject(new Error("bundle source down")) }),
    );
    expect(result).toEqual({ kind: "unbound", reason: "unavailable", sentence: RUN_DID_NOT_COMPLETE });
  });
});
