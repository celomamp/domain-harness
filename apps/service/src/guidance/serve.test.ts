/**
 * Unit suite for the Guidance serving unit (Story 4.4): every I/O-matrix row
 * pinned against the InMemory twins and synthetic bundles — identity precedes
 * everything, staleness flags every response, the Effective Standard set is
 * resolved only through core, matching is the contract's deterministic rule,
 * and a failing read never throws. Nothing records here beyond 4.3's own
 * decisions (miss records are Story 4.5).
 */
import { describe, expect, it } from "vitest";
import { canonicalJson, isGuidanceToolResult } from "@domain-harness/contract";
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
    applications: spec.applications ?? [{ id: APPLICATION_ID, projectId: WEB, fromFlow: true }],
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
}

/** A serving fixture over the InMemory twins and one synthetic bundle. */
async function setup(spec: BundleSpec = {}): Promise<ServingFixture> {
  const payload = payloadOf(spec);
  const signed = signPayload(payload, makeSigningKey("serve-test-key"));
  const hash = bundleHashOf(signed);
  const bundleStore = createInMemoryBundleRecordStore();
  await bundleStore.activate(signed, hash, TENANT);
  const identityStore = createInMemoryGuidanceIdentityStore();
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
        getPinnedBundle: overrides.getPinnedBundle ?? (() => Promise.resolve(pinned)),
        getBundledState: overrides.getBundledState ?? ((now) => bundledState(bundleStore, TENANT, now)),
      }),
    hash,
    identityStore,
    bundleStore,
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
      applications: [{ id: APPLICATION_ID, projectId: WEB, fromFlow: true }],
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
