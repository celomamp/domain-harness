import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BUNDLE_FORMAT_VERSION,
  BUNDLE_TYPE,
  isSignedStandardBundle,
} from "@domain-harness/contract";
import type {
  CodeStackEntry,
  SignedStandardBundle,
  StandardBundlePayload,
  StandardInfo,
  UuidV7,
} from "@domain-harness/contract";
import {
  EFFECTIVE_STANDARD_SET_COULD_NOT_BE_READ,
  UNBOUND,
  createInMemoryBindingLedger,
  runGateDirect,
} from "@domain-harness/gate";
import { bundleHashOf } from "./bundle-file.ts";
import { adaptWireBundleToSnapshot } from "./gate-snapshot.ts";

const TENANT = "018f3d2a-7000-7000-8000-000000000100" as UuidV7;
const ROOT_PROJECT = "018f3d2a-7000-7000-8000-000000000110" as UuidV7;
const OTHER_PROJECT = "018f3d2a-7000-7000-8000-000000000111" as UuidV7;
const OFF_TREE_PROJECT = "018f3d2a-7000-7000-8000-000000000112" as UuidV7;
const MODULE_ID = "018f3d2a-7000-7000-8000-000000000120" as UuidV7;
const STD_A = "018f3d2a-7000-7000-8000-000000000130" as UuidV7;
const STD_B = "018f3d2a-7000-7000-8000-000000000131" as UuidV7;
const ACCOUNT_ID = "018f3d2a-7000-7000-8000-000000000140" as UuidV7;
const APP_ID = "018f3d2a-7000-7000-8000-000000000150" as UuidV7;
const UNKNOWN_APP = "018f3d2a-7000-7000-8000-000000000151" as UuidV7;

const NOW = "2026-10-14T12:00:00.000Z";
const FRESH_ISSUED = "2026-10-14T10:00:00.000Z";

function codeStackStandard(
  id: UuidV7,
  projectId: UuidV7,
  projectName: string,
  entry: CodeStackEntry,
): StandardInfo {
  return {
    id,
    version: 1,
    module: { id: MODULE_ID, kind: "code-stack", name: "Backend" },
    project: { id: projectId, name: projectName },
    entry,
    publishedAt: "2026-10-01T00:00:00.000Z",
    publishedBy: { accountId: ACCOUNT_ID, name: "Bea" },
  };
}

const lodashProhibited = (projectId: UuidV7, name: string): StandardInfo =>
  codeStackStandard(projectId === ROOT_PROJECT ? STD_A : STD_B, projectId, name, {
    category: "library",
    name: "lodash",
    versionConstraint: null,
    status: "prohibited",
    correctionInstruction: null,
  });

function makePayload(overrides: Partial<StandardBundlePayload> & { keyId: string }): StandardBundlePayload {
  const { keyId, ...rest } = overrides;
  return {
    format: { type: BUNDLE_TYPE, version: BUNDLE_FORMAT_VERSION },
    tenantId: TENANT,
    sequence: 1,
    keyId,
    issuedAt: FRESH_ISSUED,
    stalenessHours: 24,
    frozen: false,
    standards: [lodashProhibited(ROOT_PROJECT, "Root")],
    tree: {
      rootId: ROOT_PROJECT,
      projects: [
        { id: ROOT_PROJECT, name: "Root", levelName: null, parentId: null, createdAt: "2026-10-14T00:00:00.000Z" },
      ],
      lockedRules: [],
    },
    applications: [{ id: APP_ID, projectId: ROOT_PROJECT, fromFlow: false, agentTool: null }],
    acceptedDeviations: [],
    ...rest,
  };
}

function adaptOf(payload: StandardBundlePayload, applicationId: string = APP_ID, now: string = NOW) {
  const signed = { payload, keyId: payload.keyId, signature: "test-signature" } as SignedStandardBundle;
  const hash = bundleHashOf(signed);
  return { signed, hash, outcome: adaptWireBundleToSnapshot({ signed, hash, applicationId, now }) };
}

describe("gate-snapshot adaptation", () => {
  it("hydrates a valid bundle: ids, accepted, bound, and unfrozen", () => {
    const payload = makePayload({
      keyId: "key-1",
      acceptedDeviations: [
        {
          applicationId: APP_ID,
          standardId: STD_A,
          standardVersion: 1,
          slot: { moduleKind: "code-stack", slotKind: "library", name: "lodash" },
          subject: "lodash",
          start: "2026-10-01T00:00:00.000Z",
          end: "2026-11-01T00:00:00.000Z",
        },
      ],
    });
    const { hash, outcome } = adaptOf(payload);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.snapshot.hash).toBe(hash);
    expect(outcome.snapshot.issuedAt).toBe(payload.issuedAt);
    expect([...outcome.snapshot.applications]).toEqual([APP_ID]);
    expect(outcome.snapshot.accepted).toHaveLength(1);
    expect(outcome.snapshot.stalenessBoundHours).toBe(24);
    expect(outcome.snapshot.frozenUntil).toBeNull();
    expect(outcome.snapshot.effectiveSet.project).toEqual({ id: ROOT_PROJECT, name: "Root" });
    expect(outcome.snapshot.effectiveSet.standards).toHaveLength(1);
    const winner = outcome.snapshot.effectiveSet.standards[0];
    expect(winner?.standard.id).toBe(STD_A);
    expect(winner?.slot).toEqual({ moduleKind: "code-stack", slotKind: "library", name: "lodash" });
    expect(winner?.status).toBe("prohibited");
    expect(winner?.sourceProject).toEqual({ id: ROOT_PROJECT, name: "Root" });
    expect(winner?.locked).toBe(false);
  });

  it("maps a component winner status to null and keeps core order", () => {
    const component: StandardInfo = {
      id: STD_B,
      version: 1,
      module: { id: MODULE_ID, kind: "design-system", name: "Design" },
      project: { id: ROOT_PROJECT, name: "Root" },
      entry: { kind: "component", name: "Button", usageRule: "Use Button.", tokens: [], correctionInstruction: null },
      publishedAt: "2026-10-01T00:00:00.000Z",
      publishedBy: { accountId: ACCOUNT_ID, name: "Bea" },
    };
    const payload = makePayload({ keyId: "key-1", standards: [component] });
    const { outcome } = adaptOf(payload);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.snapshot.effectiveSet.standards[0]?.status).toBeNull();
  });

  it("returns unbound for an unknown application id", () => {
    const payload = makePayload({ keyId: "key-1" });
    const { outcome } = adaptOf(payload, UNKNOWN_APP);
    expect(outcome).toMatchObject({ ok: false, reason: "unbound", sentence: UNBOUND, exitCode: 1 });
    expect(UNBOUND).toBe("unbound Application");
  });

  it("returns set-unreadable on a slot conflict", () => {
    const a = lodashProhibited(ROOT_PROJECT, "Root");
    const b: StandardInfo = { ...a, id: STD_B };
    const payload = makePayload({ keyId: "key-1", standards: [a, b] });
    const { outcome } = adaptOf(payload);
    expect(outcome).toMatchObject({
      ok: false,
      reason: "set-unreadable",
      sentence: EFFECTIVE_STANDARD_SET_COULD_NOT_BE_READ,
      exitCode: 1,
    });
  });

  it("returns set-unreadable when the application project is off the tree", () => {
    const payload = makePayload({
      keyId: "key-1",
      applications: [{ id: APP_ID, projectId: OFF_TREE_PROJECT, fromFlow: false, agentTool: null }],
    });
    const { outcome } = adaptOf(payload);
    expect(outcome).toMatchObject({ ok: false, reason: "set-unreadable", exitCode: 1 });
  });

  it("a frozen old bundle adapts with a covering frozenUntil and passes the stale guard", async () => {
    const issued48hAgo = new Date(Date.parse(NOW) - 48 * 60 * 60 * 1000).toISOString();
    const payload = makePayload({ keyId: "key-1", issuedAt: issued48hAgo, frozen: true, standards: [] });
    const { hash, outcome } = adaptOf(payload);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.snapshot.frozenUntil).toBe(NOW);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    const direct = await runGateDirect({
      applicationId: APP_ID,
      repoFingerprint: "f".repeat(64),
      files: {},
      bundle: { variant: "snapshot", snapshot: outcome.snapshot },
      ledger: createInMemoryBindingLedger(),
      now: NOW,
    });
    expect(direct.kind).toBe("pass");
  });

  it("honors a custom stalenessHours bound", async () => {
    const issued25hAgo = new Date(Date.parse(NOW) - 25 * 60 * 60 * 1000).toISOString();
    const loose = makePayload({ keyId: "key-1", issuedAt: issued25hAgo, stalenessHours: 48, standards: [] });
    const adaptedLoose = adaptOf(loose);
    expect(adaptedLoose.outcome.ok).toBe(true);
    if (!adaptedLoose.outcome.ok) return;
    expect(adaptedLoose.outcome.snapshot.stalenessBoundHours).toBe(48);
    const looseRun = await runGateDirect({
      applicationId: APP_ID,
      repoFingerprint: "f".repeat(64),
      files: {},
      bundle: { variant: "snapshot", snapshot: adaptedLoose.outcome.snapshot },
      ledger: createInMemoryBindingLedger(),
      now: NOW,
    });
    expect(looseRun.kind).toBe("pass");

    const tight = makePayload({ keyId: "key-1", issuedAt: issued25hAgo, stalenessHours: 24, standards: [] });
    const adaptedTight = adaptOf(tight);
    expect(adaptedTight.outcome.ok).toBe(true);
    if (!adaptedTight.outcome.ok) return;
    const tightRun = await runGateDirect({
      applicationId: APP_ID,
      repoFingerprint: "f".repeat(64),
      files: {},
      bundle: { variant: "snapshot", snapshot: adaptedTight.outcome.snapshot },
      ledger: createInMemoryBindingLedger(),
      now: NOW,
    });
    expect(tightRun.kind).toBe("refusal");
    expect(tightRun.sentence).toBe("bundle stale");
  });

  it("treats the exact bound as fresh and one millisecond past it as stale", async () => {
    const atBound = new Date(Date.parse(NOW) - 24 * 60 * 60 * 1000).toISOString();
    const pastBound = new Date(Date.parse(NOW) - 24 * 60 * 60 * 1000 - 1).toISOString();
    for (const [issuedAt, expected] of [
      [atBound, "pass"],
      [pastBound, "refusal"],
    ] as const) {
      const payload = makePayload({ keyId: "key-1", issuedAt, standards: [] });
      const { outcome } = adaptOf(payload);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) continue;
      const direct = await runGateDirect({
        applicationId: APP_ID,
        repoFingerprint: "f".repeat(64),
        files: {},
        bundle: { variant: "snapshot", snapshot: outcome.snapshot },
        ledger: createInMemoryBindingLedger(),
        now: NOW,
      });
      expect(direct.kind, issuedAt).toBe(expected);
    }
  });

  it("resolves the child project scope and marks locked winners", () => {
    const childStandard = lodashProhibited(ROOT_PROJECT, "Root");
    const payload = makePayload({
      keyId: "key-1",
      standards: [childStandard],
      tree: {
        rootId: ROOT_PROJECT,
        projects: [
          { id: ROOT_PROJECT, name: "Root", levelName: null, parentId: null, createdAt: "2026-10-14T00:00:00.000Z" },
          { id: OTHER_PROJECT, name: "Child", levelName: null, parentId: ROOT_PROJECT, createdAt: "2026-10-14T00:00:00.000Z" },
        ],
        lockedRules: [{ standardId: STD_A, projectId: ROOT_PROJECT, markedAt: "2026-10-14T00:00:00.000Z", markedBy: { accountId: ACCOUNT_ID, name: "Bea" } }],
      },
      applications: [{ id: APP_ID, projectId: OTHER_PROJECT, fromFlow: false, agentTool: null }],
    });
    const { outcome } = adaptOf(payload);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.snapshot.effectiveSet.project).toEqual({ id: OTHER_PROJECT, name: "Child" });
    expect(outcome.snapshot.effectiveSet.standards[0]?.locked).toBe(true);
  });

  it("accepts the registry golden bundle bytes with its recorded hash", () => {
    const goldenPath = join(import.meta.dirname, "../../service/src/bundles/golden-signed-bundle.json");
    let golden: { publicKeyPem: string; hash: string; signed: unknown };
    try {
      golden = JSON.parse(readFileSync(goldenPath, "utf8")) as {
        publicKeyPem: string;
        hash: string;
        signed: unknown;
      };
    } catch {
      throw new Error(`missing golden fixture at ${goldenPath}`);
    }
    expect(isSignedStandardBundle(golden.signed)).toBe(true);
    const signed = golden.signed as SignedStandardBundle;
    expect(bundleHashOf(signed)).toBe(golden.hash);
    const outcome = adaptWireBundleToSnapshot({
      signed,
      hash: golden.hash,
      applicationId: String(APP_ID),
      now: "2026-10-15T00:00:00.000Z",
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.sentence).toBe(UNBOUND);
  });

  it("never throws on garbage input", () => {
    const dir = mkdtempSync(join(tmpdir(), "dh-snapshot-"));
    writeFileSync(join(dir, "x.txt"), "x");
    expect(
      adaptWireBundleToSnapshot({
        signed: 42 as unknown as SignedStandardBundle,
        hash: "",
        applicationId: "",
        now: "",
      }).ok,
    ).toBe(false);
  });
});
