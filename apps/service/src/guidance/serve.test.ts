/**
 * Unit suite for the Guidance serving unit (Stories 4.4 + 4.5): every
 * I/O-matrix row pinned against the InMemory twins and synthetic bundles —
 * identity precedes everything, staleness flags every response, the Effective
 * Standard set is resolved only through core, matching is the contract's
 * deterministic rule, a failing read never throws, and every bound `hit` /
 * `miss` appends exactly one Guidance event (a `miss` is the gap).
 */
import { describe, expect, it } from "vitest";
import { canonicalJson, isGuidanceEvent, isGuidanceToolResult } from "@domain-harness/contract";
import type { BundleApplication, GuidanceToolResult, ProjectTree, StandardBundlePayload, StandardInfo, UuidV7 } from "@domain-harness/contract";
import {
  EFFECTIVE_STANDARD_SET_COULD_NOT_BE_READ,
  MISSING_IDENTIFICATION_FILE,
  RUN_DID_NOT_COMPLETE,
  BUNDLE_STALE,
  DUPLICATE_APPLICATION_ID,
  UNBOUND,
} from "@domain-harness/gate";
import { COMMIT_ONCE } from "./identity.ts";
import type { PinnedActiveBundle } from "./identity.ts";
import { serveGuidanceCall } from "./serve.ts";
import type { ServeGuidanceCallInput } from "./serve.ts";
import { createInMemoryGuidanceIdentityStore } from "./store.ts";
import type { GuidanceIdentityStore } from "./store.ts";
import { createInMemoryGuidanceEventStore } from "./events.ts";
import type { GuidanceEventStore } from "./events.ts";
import { bundledState } from "../bundles/puller.ts";
import { createInMemoryBundleRecordStore } from "../bundles/store.ts";
import { bundleHashOf } from "../bundles/verify.ts";
import type { BundleRecordStore } from "../bundles/store.ts";
import { makeBundlePayload, makeSigningKey, signPayload } from "../bundles/test-fixtures.ts";

const TENANT = "018f3d2a-7000-7000-8000-000000000100" as UuidV7;
const APPLICATION_ID = "018f3d2a-7000-7000-8000-000000000001" as UuidV7;
const ROOT = "018f3d2a-7000-7000-8000-000000000110" as UuidV7;
const WEB = "018f3d2a-7000-7000-8000-000000000112" as UuidV7;
const DATA = "018f3d2a-7000-7000-8000-000000000113" as UuidV7;
const FP_1 = "1".repeat(64);

const NOW = "2026-10-14T12:00:00.000Z";
const ISSUED = "2026-10-14T06:00:00.000Z";

let nextStandardId = 131;
function standardId(): UuidV7 {
  nextStandardId += 1;
  return `018f3d2a-7000-7000-8000-0000000${String(nextStandardId).padStart(5, "0")}` as UuidV7;
}

const PUBLISHER = { accountId: "018f3d2a-7000-7000-8000-000000000140" as UuidV7, name: "Bea" };
const CODE_MODULE = { id: "018f3d2a-7000-7000-8000-000000000120" as UuidV7, kind: "code-stack" as const, name: "Backend" };
const WEB_MODULE = { id: "018f3d2a-7000-7000-8000-000000000121" as UuidV7, kind: "design-system" as const, name: "Web" };

function codeStackStandard(project: UuidV7, name: string, overrides: { category?: "language" | "framework" | "library"; versionConstraint?: string | null; status?: "approved" | "required" | "prohibited"; correctionInstruction?: string | null } = {}): StandardInfo {
  return {
    id: standardId(),
    version: 2,
    module: CODE_MODULE,
    project: { id: project, name: "Scope" },
    entry: {
      category: overrides.category ?? "library",
      name,
      versionConstraint: overrides.versionConstraint ?? null,
      status: overrides.status ?? "approved",
      correctionInstruction: overrides.correctionInstruction ?? null,
    },
    publishedAt: ISSUED,
    publishedBy: PUBLISHER,
  };
}

function componentStandard(project: UuidV7, name: string, usageRule: string, tokens: readonly string[] = [], correctionInstruction: string | null = null): StandardInfo {
  return {
    id: standardId(),
    version: 1,
    module: WEB_MODULE,
    project: { id: project, name: "Scope" },
    entry: { kind: "component", name, usageRule, tokens: [...tokens], correctionInstruction },
    publishedAt: ISSUED,
    publishedBy: PUBLISHER,
  };
}

function tokenStandard(project: UuidV7, name: string): StandardInfo {
  return {
    id: standardId(),
    version: 1,
    module: WEB_MODULE,
    project: { id: project, name: "Scope" },
    entry: { kind: "token", name, status: "required" },
    publishedAt: ISSUED,
    publishedBy: PUBLISHER,
  };
}

function importStandard(project: UuidV7, specifier: string, status: "required" | "prohibited" = "prohibited"): StandardInfo {
  return {
    id: standardId(),
    version: 1,
    module: WEB_MODULE,
    project: { id: project, name: "Scope" },
    entry: { kind: "import", specifier, status },
    publishedAt: ISSUED,
    publishedBy: PUBLISHER,
  };
}

interface BundleSpec {
  readonly standards?: readonly StandardInfo[];
  readonly applications?: readonly BundleApplication[];
  readonly treeOverride?: ProjectTree;
  readonly issuedAt?: string;
  readonly stalenessHours?: number;
  readonly frozen?: boolean;
  /** Build an invalid payload (the runtime guard must reject it) by dropping one key. */
  readonly payloadDropKey?: string;
}

function payloadOf(spec: BundleSpec = {}): StandardBundlePayload {
  const base = makeBundlePayload({ keyId: "serve-test-key", sequence: 1, issuedAt: spec.issuedAt ?? ISSUED });
  const tree: ProjectTree = spec.treeOverride ?? {
    rootId: ROOT,
    projects: [
      { id: ROOT, name: "Root", levelName: null, parentId: null, createdAt: ISSUED },
      { id: WEB, name: "Web", levelName: null, parentId: ROOT, createdAt: ISSUED },
      { id: DATA, name: "Data", levelName: null, parentId: ROOT, createdAt: ISSUED },
    ],
    lockedRules: [],
  };
  const payload: StandardBundlePayload = {
    ...base,
    frozen: spec.frozen ?? false,
    stalenessHours: spec.stalenessHours ?? base.stalenessHours,
    standards: spec.standards ?? [],
    tree,
    applications: spec.applications ?? [{ id: APPLICATION_ID, projectId: WEB, fromFlow: true, agentTool: null }],
    acceptedDeviations: [],
  };
  if (spec.payloadDropKey === undefined) return payload;
  const dropped = { ...payload } as Record<string, unknown>;
  const omit = (record: Record<string, unknown>, key: string): Record<string, unknown> =>
    Object.fromEntries(Object.entries(record).filter(([entryKey]) => entryKey !== key));
  return omit(dropped, spec.payloadDropKey) as unknown as StandardBundlePayload;
}

interface ServingFixture {
  readonly call: (overrides: Partial<ServeGuidanceCallInput>) => Promise<GuidanceToolResult>;
  readonly hash: string;
  readonly identityStore: GuidanceIdentityStore;
  readonly bundleStore: BundleRecordStore;
  readonly eventStore: GuidanceEventStore;
}

/** A serving fixture over the InMemory twins and one synthetic bundle. */
async function setup(spec: BundleSpec = {}): Promise<ServingFixture> {
  const payload = payloadOf(spec);
  const signed = signPayload(payload, makeSigningKey("serve-test-key"));
  const hash = bundleHashOf(signed);
  const bundleStore = createInMemoryBundleRecordStore();
  await bundleStore.activate(signed, hash, TENANT);
  const identityStore = createInMemoryGuidanceIdentityStore();
  const eventStore = createInMemoryGuidanceEventStore();
  const pinned: PinnedActiveBundle = { payload, hash };
  return {
    call: (overrides: Partial<ServeGuidanceCallInput>): Promise<GuidanceToolResult> =>
      serveGuidanceCall({
        headers: { applicationId: APPLICATION_ID, advisoryProjectId: WEB, repoFingerprint: FP_1, ...overrides.headers },
        tool: overrides.tool ?? "code_stack_rule",
        subject: overrides.subject ?? "react",
        tenantId: TENANT,
        now: overrides.now ?? NOW,
        identityStore: overrides.identityStore ?? identityStore,
        eventStore: overrides.eventStore ?? eventStore,
        onRecordError: overrides.onRecordError,
        getPinnedBundle: overrides.getPinnedBundle ?? (() => Promise.resolve(pinned)),
        getBundledState: overrides.getBundledState ?? ((now) => bundledState(bundleStore, TENANT, now)),
      }),
    hash,
    identityStore,
    bundleStore,
    eventStore,
  };
}

describe("serveGuidanceCall: identity first", () => {
  it("answers the commit-once sentence before resolving anything, for a caller without a fingerprint", async () => {
    const { call } = await setup({ standards: [codeStackStandard(ROOT, "React")] });
    const result = await call({ headers: { applicationId: APPLICATION_ID, advisoryProjectId: WEB, repoFingerprint: undefined } });
    expect(result).toEqual({ kind: "unbound", reason: "commit_first", sentence: COMMIT_ONCE });
  });

  it("answers the identification-file sentence when the id header is missing, and binds nothing", async () => {
    const { call, identityStore } = await setup({ standards: [codeStackStandard(ROOT, "React")] });
    const result = await call({ headers: { applicationId: undefined, advisoryProjectId: undefined, repoFingerprint: FP_1 } });
    expect(result).toEqual({ kind: "unbound", reason: "missing_identification_file", sentence: MISSING_IDENTIFICATION_FILE });
    expect(await identityStore.getBinding(APPLICATION_ID)).toBeNull();
  });

  it("answers unbound Application for an id the bundle does not carry, serving no Project's Standards", async () => {
    const { call } = await setup({ standards: [codeStackStandard(ROOT, "React")] });
    const result = await call({
      headers: { applicationId: "018f3d2a-7000-7000-8000-000000000999", advisoryProjectId: WEB, repoFingerprint: FP_1 },
      subject: "react",
    });
    expect(result).toEqual({ kind: "unbound", reason: "unknown_application", sentence: UNBOUND });
    expect("bundleHash" in result).toBe(false);
  });

  it("answers unbound with the duplicate-Application sentence for a copied fingerprint, on top of the identity unit's refusal row", async () => {
    const { call, identityStore } = await setup({ standards: [codeStackStandard(ROOT, "React")] });
    await identityStore.bindApplication(APPLICATION_ID, "9".repeat(64));
    const result = await call({ headers: { applicationId: APPLICATION_ID, advisoryProjectId: WEB, repoFingerprint: FP_1 } });
    expect(result).toEqual({ kind: "unbound", reason: "refused", sentence: DUPLICATE_APPLICATION_ID });
    const refusals = await identityStore.listBindingRefusals(APPLICATION_ID);
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatchObject({ presentedFingerprint: FP_1, boundFingerprint: "9".repeat(64) });
  });
});

describe("serveGuidanceCall: bound answers", () => {
  it("hits the code-stack rule by the casefold of the subject against the slot name ('react' vs 'React')", async () => {
    const react = codeStackStandard(ROOT, "React", { versionConstraint: ">= 18", correctionInstruction: "use the Company wrapper" });
    const { call, hash } = await setup({ standards: [react] });
    const result = await call({ subject: "react" });
    expect(result).toEqual({
      kind: "hit",
      tool: "code_stack_rule",
      subject: "react",
      standardId: react.id,
      version: 2,
      content: "The library React (version constraint: >= 18) is approved.\nCorrection: use the Company wrapper",
      bundleHash: hash,
      stale: false,
    });
    // The text the MCP client receives is the canonical serialization.
    expect(JSON.parse(canonicalJson(result)) as GuidanceToolResult).toEqual(result);
  });

  it("hits a token, an import and a component by casefold equality", async () => {
    const token = tokenStandard(WEB, "AccentBorder");
    const moduleImport = importStandard(WEB, "~/company/button");
    const component = componentStandard(WEB, "Button", "Use a Button for every clickable action.", ["AccentBorder"]);
    const { call } = await setup({ standards: [token, moduleImport, component] });
    expect(await call({ tool: "design_token", subject: "accentborder" })).toMatchObject({ kind: "hit", standardId: token.id });
    expect(await call({ tool: "design_import", subject: "~/company/button" })).toMatchObject({ kind: "hit", standardId: moduleImport.id });
    expect(await call({ tool: "design_component", subject: "button" })).toMatchObject({ kind: "hit", standardId: component.id });
  });

  it("hits a component when the subject occurs inside its casefolded usage rule", async () => {
    const component = componentStandard(WEB, "Button", "Use a Button for every clickable action; never a raw HTML button.", []);
    const { call, hash } = await setup({ standards: [component] });
    const result = await call({ tool: "design_component", subject: "CLICKABLE ACTION" });
    expect(result).toEqual({
      kind: "hit",
      tool: "design_component",
      subject: "CLICKABLE ACTION",
      standardId: component.id,
      version: 1,
      content: "The component Button is governed by this usage rule: Use a Button for every clickable action; never a raw HTML button.",
      bundleHash: hash,
      stale: false,
    });
  });

  it("serves a miss — one sentence including the subject verbatim — when nothing matches", async () => {
    const { call, hash } = await setup({ standards: [codeStackStandard(ROOT, "React")] });
    const result = await call({ tool: "design_component", subject: "modal" });
    expect(result).toEqual({
      kind: "miss",
      tool: "design_component",
      subject: "modal",
      sentence: "the active bundle holds no design component matching modal",
      bundleHash: hash,
      stale: false,
    });
  });

  it("answers a miss for a whitespace-only subject, which the schema never rejects", async () => {
    const { call } = await setup({ standards: [codeStackStandard(ROOT, "React")] });
    const result = await call({ subject: "   " });
    expect(result).toMatchObject({
      kind: "miss",
      subject: "   ",
      sentence: "the active bundle holds no code stack rule for    ",
    });
  });

  it("answers a miss for a whitespace-only design_component subject: containment of the blank ask matches no usage rule", async () => {
    const component = componentStandard(WEB, "Button", "Use a Button for every clickable action.", []);
    const { call, hash } = await setup({ standards: [component] });
    const result = await call({ tool: "design_component", subject: "\n\t " });
    expect(result).toEqual({
      kind: "miss",
      tool: "design_component",
      subject: "\n\t ",
      sentence: "the active bundle holds no design component matching \n\t ",
      bundleHash: hash,
      stale: false,
    });
  });

  it("serves the BUNDLE project only: a sibling Project's Standards past the caller's ancestry are never answered, and the advisory mismatch is recorded by the identity unit", async () => {
    const webToken = tokenStandard(WEB, "AccentBorder");
    const dataToken = tokenStandard(DATA, "DataToken");
    const { call, identityStore, hash } = await setup({
      standards: [webToken, dataToken],
      applications: [{ id: APPLICATION_ID, projectId: WEB, fromFlow: true, agentTool: null }],
    });
    const result = await call({
      tool: "design_token",
      subject: "datatoken",
      headers: { applicationId: APPLICATION_ID, advisoryProjectId: DATA, repoFingerprint: FP_1 },
    });
    // The bundle's Project (WEB) decides what is served: the DATA Project's
    // token is outside the caller's ancestry, so the subject misses even
    // though the advisory id named DATA.
    expect(result).toEqual({
      kind: "miss",
      tool: "design_token",
      subject: "datatoken",
      sentence: "the active bundle holds no design token named datatoken",
      bundleHash: hash,
      stale: false,
    });
    // The WEB Project's token is still served, quoting the bundle hash.
    expect(await call({ tool: "design_token", subject: "accentborder" })).toEqual({
      kind: "hit",
      tool: "design_token",
      subject: "accentborder",
      standardId: webToken.id,
      version: 1,
      content: "The design token AccentBorder is required.",
      bundleHash: hash,
      stale: false,
    });
    const mismatches = await identityStore.listProjectMismatches(APPLICATION_ID);
    expect(mismatches).toEqual([
      {
        id: expect.any(String) as string,
        applicationId: APPLICATION_ID,
        presentedProjectId: DATA,
        bundleProjectId: WEB,
        bundleHash: hash,
        createdAt: expect.any(String) as string,
      },
    ]);
  });
});

describe("serveGuidanceCall: staleness", () => {
  it("still answers from the active bundle when it is past its bound, and every response says bundle stale", async () => {
    const react = codeStackStandard(ROOT, "React");
    const { call, hash } = await setup({
      standards: [react],
      issuedAt: "2026-10-12T00:00:00.000Z",
      stalenessHours: 24,
    });
    expect(await call({ subject: "react" })).toEqual({
      kind: "hit",
      tool: "code_stack_rule",
      subject: "react",
      standardId: react.id,
      version: 2,
      content: "The library React is approved.\nbundle stale",
      bundleHash: hash,
      stale: true,
    });
    expect(await call({ subject: "vue" })).toEqual({
      kind: "miss",
      tool: "code_stack_rule",
      subject: "vue",
      sentence: `the active bundle holds no code stack rule for vue (${BUNDLE_STALE})`,
      bundleHash: hash,
      stale: true,
    });
  });

  it("does not flag staleness while a freeze suspends the bound", async () => {
    const react = codeStackStandard(ROOT, "React");
    const { call, hash } = await setup({
      standards: [react],
      issuedAt: "2026-10-12T00:00:00.000Z",
      stalenessHours: 24,
      frozen: true,
    });
    expect(await call({ subject: "react" })).toMatchObject({ kind: "hit", stale: false, bundleHash: hash });
  });

  it("refuses to quote one hash and answer from another: a mid-call activation answers run did not complete", async () => {
    const payload = payloadOf({ standards: [codeStackStandard(ROOT, "React")] });
    const signed = signPayload(payload, makeSigningKey("serve-test-key"));
    const hash = bundleHashOf(signed);
    const result = await serveGuidanceCall({
      headers: { applicationId: APPLICATION_ID, advisoryProjectId: WEB, repoFingerprint: FP_1 },
      tool: "code_stack_rule",
      subject: "react",
      tenantId: TENANT,
      now: NOW,
      identityStore: createInMemoryGuidanceIdentityStore(),
      eventStore: createInMemoryGuidanceEventStore(),
      getPinnedBundle: () => Promise.resolve({ payload, hash }),
      // The staleness read names another bundle than the pinned one.
      getBundledState: () =>
        Promise.resolve({
          ok: true,
          state: { hash: "b".repeat(64), sequence: 2, ageSeconds: 0, stalenessHours: 24, frozen: false, stale: false },
        }),
    });
    expect(result).toEqual({ kind: "unbound", reason: "unavailable", sentence: RUN_DID_NOT_COMPLETE });
  });
});

describe("serveGuidanceCall: unreadable set and failing reads", () => {
  it("answers the set-could-not-be-read sentence when two Standards conflict in one slot", async () => {
    const a = codeStackStandard(WEB, "React");
    const b = codeStackStandard(WEB, "react", { status: "prohibited" });
    const { call } = await setup({ standards: [a, b] });
    const result = await call({ subject: "react" });
    expect(result).toEqual({ kind: "unbound", reason: "set_unreadable", sentence: EFFECTIVE_STANDARD_SET_COULD_NOT_BE_READ });
  });

  it("answers the set-could-not-be-read sentence when the bundle payload is invalid", async () => {
    const { call } = await setup({ standards: [codeStackStandard(ROOT, "React")], payloadDropKey: "acceptedDeviations" });
    const result = await call({ subject: "react" });
    expect(result).toEqual({ kind: "unbound", reason: "set_unreadable", sentence: EFFECTIVE_STANDARD_SET_COULD_NOT_BE_READ });
  });

  it("answers the set-could-not-be-read sentence when the caller's Project is not in the tree", async () => {
    const { call } = await setup({
      standards: [codeStackStandard(ROOT, "React")],
      treeOverride: {
        rootId: ROOT,
        projects: [{ id: ROOT, name: "Root", levelName: null, parentId: null, createdAt: ISSUED }],
        lockedRules: [],
      },
    });
    const result = await call({ subject: "react" });
    expect(result).toEqual({ kind: "unbound", reason: "set_unreadable", sentence: EFFECTIVE_STANDARD_SET_COULD_NOT_BE_READ });
  });

  it("answers the set-could-not-be-read sentence when the tree itself is invalid", async () => {
    const { call } = await setup({
      standards: [codeStackStandard(ROOT, "React")],
      treeOverride: {
        rootId: ROOT,
        projects: [
          { id: ROOT, name: "Root", levelName: null, parentId: null, createdAt: ISSUED },
          { id: WEB, name: "Web", levelName: null, parentId: null, createdAt: ISSUED },
        ],
        lockedRules: [],
      },
    });
    const result = await call({ subject: "react" });
    expect(result).toEqual({ kind: "unbound", reason: "set_unreadable", sentence: EFFECTIVE_STANDARD_SET_COULD_NOT_BE_READ });
  });

  it("answers the run-did-not-complete sentence when the identity or staleness reads fail", async () => {
    const failingStore: GuidanceIdentityStore = {
      getBinding: () => Promise.reject(new Error("store down")),
      bindApplication: () => Promise.reject(new Error("store down")),
      recordBindingRefusal: () => Promise.reject(new Error("store down")),
      listBindingRefusals: () => Promise.reject(new Error("store down")),
      recordProjectMismatch: () => Promise.reject(new Error("store down")),
      listProjectMismatches: () => Promise.reject(new Error("store down")),
    };
    const { call } = await setup({ standards: [codeStackStandard(ROOT, "React")] });
    expect(await call({ getBundledState: () => Promise.resolve({ ok: false, reason: "no_active_bundle" }) })).toEqual({
      kind: "unbound",
      reason: "unavailable",
      sentence: RUN_DID_NOT_COMPLETE,
    });
    expect(await call({ identityStore: failingStore })).toEqual({ kind: "unbound", reason: "unavailable", sentence: RUN_DID_NOT_COMPLETE });
  });

  it("answers the run-did-not-complete sentence when the bundle source fails", async () => {
    const { call } = await setup({ standards: [codeStackStandard(ROOT, "React")] });
    const result = await call({ getPinnedBundle: () => Promise.reject(new Error("bundle source down")) });
    expect(result).toEqual({ kind: "unbound", reason: "unavailable", sentence: RUN_DID_NOT_COMPLETE });
  });
});

describe("serveGuidanceCall: never throws, always typed", () => {
  it("answers every shape with a guarded result that canonicalJson serializes", async () => {
    const { call } = await setup({ standards: [codeStackStandard(ROOT, "React")] });
    const results = await Promise.all([
      call({ headers: { applicationId: undefined, advisoryProjectId: undefined, repoFingerprint: undefined } }),
      call({ subject: "nothing here" }),
      call({ subject: "react" }),
      call({ getPinnedBundle: () => Promise.reject(new Error("down")) }),
    ]);
    for (const result of results) {
      expect(isGuidanceToolResult(result)).toBe(true);
      expect(() => canonicalJson(result)).not.toThrow();
    }
  });
});

describe("serveGuidanceCall: recording bound outcomes (Story 4.5)", () => {
  it("records one event row for a bound hit, with every field and a store-assigned per-app sequence", async () => {
    const react = codeStackStandard(ROOT, "React");
    const { call, hash, eventStore } = await setup({
      standards: [react],
      applications: [{ id: APPLICATION_ID, projectId: WEB, fromFlow: true, agentTool: "cursor" }],
    });
    const result = await call({ subject: "react" });
    expect(result.kind).toBe("hit");
    const events = await eventStore.listGuidanceEvents(APPLICATION_ID);
    expect(events).toHaveLength(1);
    const event = events[0];
    if (event === undefined) throw new Error("the bound hit recorded no event");
    expect(isGuidanceEvent(event)).toBe(true);
    expect(event).toMatchObject({
      applicationId: APPLICATION_ID,
      sequence: 1,
      tool: "code_stack_rule",
      subject: "react",
      outcome: { kind: "hit", standardId: react.id, version: 2 },
      agentTool: "cursor",
      bundleHash: hash,
    });
    expect(typeof event.id).toBe("string");
    expect(typeof event.createdAt).toBe("string");
  });

  it("records one event row for a bound miss, and the row is listed as a gap with no second write", async () => {
    const { call, hash, eventStore } = await setup({ standards: [codeStackStandard(ROOT, "React")] });
    const result = await call({ tool: "design_token", subject: "NoSuchToken" });
    expect(result.kind).toBe("miss");
    expect(await eventStore.countGuidanceEvents(APPLICATION_ID)).toBe(1);
    const gaps = await eventStore.listGuidanceGaps(APPLICATION_ID);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({
      applicationId: APPLICATION_ID,
      tool: "design_token",
      subject: "NoSuchToken",
      outcome: { kind: "miss" },
      agentTool: null,
      bundleHash: hash,
    });
  });

  it("persists the record service-side with no agent cooperation: the agent tool comes only from the pinned bundle entry", async () => {
    const { call, eventStore } = await setup({
      standards: [codeStackStandard(ROOT, "React")],
      applications: [{ id: APPLICATION_ID, projectId: WEB, fromFlow: true, agentTool: "claude-code" }],
    });
    // No header carries the agent tool; the pinned entry is the only source.
    await call({ subject: "react", headers: { applicationId: APPLICATION_ID, advisoryProjectId: WEB, repoFingerprint: FP_1 } });
    const events = await eventStore.listGuidanceEvents(APPLICATION_ID);
    expect(events[0]?.agentTool).toBe("claude-code");
  });

  it("records nothing for a copied fingerprint: the refusal ledger row is 4.3's, no event row", async () => {
    const { call, identityStore, eventStore } = await setup({ standards: [codeStackStandard(ROOT, "React")] });
    await identityStore.bindApplication(APPLICATION_ID, "9".repeat(64));
    const result = await call({ headers: { applicationId: APPLICATION_ID, advisoryProjectId: WEB, repoFingerprint: FP_1 } });
    expect(result).toMatchObject({ kind: "unbound", reason: "refused" });
    expect(await eventStore.listGuidanceEvents(APPLICATION_ID)).toEqual([]);
  });

  it("records nothing for unbound callers: missing file, unknown id and failing reads leave no row", async () => {
    const { call, eventStore } = await setup({ standards: [codeStackStandard(ROOT, "React")] });
    await call({ headers: { applicationId: undefined, advisoryProjectId: undefined, repoFingerprint: FP_1 } });
    await call({
      headers: { applicationId: "018f3d2a-7000-7000-8000-000000000999", advisoryProjectId: WEB, repoFingerprint: FP_1 },
    });
    await call({ getPinnedBundle: () => Promise.reject(new Error("bundle source down")) });
    expect(await eventStore.listGuidanceEvents()).toEqual([]);
  });

  it("returns the typed answer unchanged when the record insert throws, and fires the ids-only hook without subject text", async () => {
    const distinctive = "quetzal-distinctive-subject-4-5";
    const distinctiveStandard = codeStackStandard(ROOT, "Quetzal-Distinctive-Subject-4-5");
    const { call, hash } = await setup({ standards: [distinctiveStandard] });
    const failingEvents: GuidanceEventStore = {
      appendGuidanceEvent: () => Promise.reject(new Error("record store down")),
      listGuidanceEvents: () => Promise.resolve([]),
      listGuidanceGaps: () => Promise.resolve([]),
      countGuidanceEvents: () => Promise.resolve(0),
      deleteGuidanceEventsOlderThan: () => Promise.resolve(0),
    };
    const seen: { applicationId: unknown; tool: unknown; error: unknown }[] = [];
    const hit = await call({
      subject: distinctive,
      eventStore: failingEvents,
      onRecordError: (input) => {
        seen.push(input);
      },
    });
    // The typed answer is byte-identical to the no-recording answer: a hit quoting the bundle hash.
    expect(hit).toMatchObject({ kind: "hit", tool: "code_stack_rule", subject: distinctive, bundleHash: hash });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ applicationId: APPLICATION_ID, tool: "code_stack_rule" });
    // Ids only: the hook payload carries no subject text.
    expect(JSON.stringify(seen[0])).not.toContain(distinctive);
  });

  it("serves a pre-4.5 bundle without the agentTool key and records with a null agent tool", async () => {
    const react = codeStackStandard(ROOT, "React");
    const payload = payloadOf({ standards: [react] });
    const oldApplications = [{ id: APPLICATION_ID, projectId: WEB, fromFlow: true }] as unknown as BundleApplication[];
    const oldPayload = { ...payload, applications: oldApplications };
    const signed = signPayload(oldPayload, makeSigningKey("serve-test-key"));
    const hash = bundleHashOf(signed);
    const bundleStore = createInMemoryBundleRecordStore();
    await bundleStore.activate(signed, hash, TENANT);
    const identityStore = createInMemoryGuidanceIdentityStore();
    const eventStore = createInMemoryGuidanceEventStore();
    const pinned: PinnedActiveBundle = { payload: oldPayload, hash };
    const result = await serveGuidanceCall({
      headers: { applicationId: APPLICATION_ID, advisoryProjectId: WEB, repoFingerprint: FP_1 },
      tool: "code_stack_rule",
      subject: "react",
      tenantId: TENANT,
      now: NOW,
      identityStore,
      eventStore,
      getPinnedBundle: () => Promise.resolve(pinned),
      getBundledState: (now) => bundledState(bundleStore, TENANT, now),
    });
    expect(result.kind).toBe("hit");
    const events = await eventStore.listGuidanceEvents(APPLICATION_ID);
    expect(events).toHaveLength(1);
    expect(events[0]?.agentTool).toBeNull();
  });

  it("assigns distinct per-app sequences under N parallel bound calls, and per-app counters stay independent", async () => {
    const { call, eventStore } = await setup({ standards: [codeStackStandard(ROOT, "React")] });
    const otherApp = "018f3d2a-7000-7000-8000-000000000777" as UuidV7;
    const N = 10;
    await Promise.all(
      Array.from({ length: N }, (_unused, index) =>
        call({
          subject: `subject-${String(index)}`,
          headers: { applicationId: APPLICATION_ID, advisoryProjectId: WEB, repoFingerprint: FP_1 },
        }),
      ),
    );
    const sequences = (await eventStore.listGuidanceEvents(APPLICATION_ID)).map((event) => event.sequence).sort((a, b) => a - b);
    expect(sequences).toEqual(Array.from({ length: N }, (_unused, index) => index + 1));
    // A second Application starts its own sequence at 1.
    const { call: callB } = await setup({ standards: [codeStackStandard(ROOT, "React")] });
    await callB({
      subject: "react",
      headers: { applicationId: otherApp, advisoryProjectId: WEB, repoFingerprint: FP_1 },
    });
    expect(await eventStore.countGuidanceEvents(otherApp)).toBe(0);
  });

  it("keeps per-Application counters independent: A (2 rows) then B (0 rows) yields A=3, B=1", async () => {
    const appB = "018f3d2a-7000-7000-8000-000000000888" as UuidV7;
    const { call, eventStore } = await setup({
      standards: [codeStackStandard(ROOT, "React")],
      applications: [
        { id: APPLICATION_ID, projectId: WEB, fromFlow: true, agentTool: null },
        { id: appB, projectId: WEB, fromFlow: false, agentTool: null },
      ],
    });
    await call({ subject: "react" });
    await call({ subject: "vue", tool: "code_stack_rule" });
    await call({ subject: "react" });
    expect((await eventStore.listGuidanceEvents(APPLICATION_ID)).map((event) => event.sequence)).toEqual([1, 2, 3]);
    await call({
      subject: "react",
      headers: { applicationId: appB, advisoryProjectId: WEB, repoFingerprint: FP_1 },
    });
    expect((await eventStore.listGuidanceEvents(appB)).map((event) => event.sequence)).toEqual([1]);
  });

  it("holds only the asked subject term: a distinctive subject appears in the row and the hook carries ids only", async () => {
    const distinctive = "xylophone-distinctive-4-5-privacy";
    const { call, eventStore } = await setup({ standards: [codeStackStandard(ROOT, "React")] });
    await call({ subject: distinctive });
    const events = await eventStore.listGuidanceEvents(APPLICATION_ID);
    expect(events).toHaveLength(1);
    expect(events[0]?.subject).toBe(distinctive);
  });
});
