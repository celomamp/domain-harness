import { describe, expect, it } from "vitest";
import {
  BUNDLE_API_PATHS,
  BUNDLE_FORMAT_VERSION,
  BUNDLE_TYPE,
  canonicalJson,
  DEFAULT_STALENESS_HOURS,
  isBundleApplication,
  isBundleFormat,
  isSignedStandardBundle,
  isStandardBundlePayload,
  standardBundleLatestPath,
} from "./index.ts";
import type {
  AcceptedDeviation,
  BundleApplication,
  ProjectTree,
  SignedStandardBundle,
  StandardBundlePayload,
  StandardInfo,
  UuidV7,
} from "./index.ts";

const TENANT_ID = "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e5f0" as UuidV7;
const ROOT_ID = "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e5f1" as UuidV7;
const CHILD_ID = "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e5f2" as UuidV7;
const MODULE_ID = "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e5f3" as UuidV7;
const STANDARD_ID = "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e5f4" as UuidV7;
const APP_ID = "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e5f5" as UuidV7;
const ACCOUNT_ID = "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e5f6" as UuidV7;
const AT = "2026-10-13T10:00:00.000Z";

const validStandard: StandardInfo = {
  id: STANDARD_ID,
  version: 1,
  module: { id: MODULE_ID, kind: "code-stack", name: "Code stack" },
  project: { id: ROOT_ID, name: "Acme" },
  entry: {
    category: "library",
    name: "React",
    versionConstraint: "^18",
    status: "approved",
    correctionInstruction: null,
  },
  publishedAt: AT,
  publishedBy: { accountId: ACCOUNT_ID, name: "Sam Owner" },
};

const validTree: ProjectTree = {
  rootId: ROOT_ID,
  projects: [
    { id: ROOT_ID, name: "Acme", levelName: null, parentId: null, createdAt: AT },
    { id: CHILD_ID, name: "Web", levelName: "Product line", parentId: ROOT_ID, createdAt: AT },
  ],
  lockedRules: [
    {
      standardId: STANDARD_ID,
      projectId: ROOT_ID,
      markedAt: AT,
      markedBy: { accountId: ACCOUNT_ID, name: "Bea Buyer" },
    },
  ],
};

const validApplication: BundleApplication = {
  id: APP_ID,
  projectId: CHILD_ID,
  fromFlow: true,
};

const validAcceptedDeviation: AcceptedDeviation = {
  applicationId: APP_ID,
  standardId: STANDARD_ID,
  standardVersion: 1,
  slot: { moduleKind: "code-stack", slotKind: "library", name: "React" },
  subject: "react",
  start: "2026-01-01T00:00:00.000Z",
  end: "2026-12-31T23:59:59.000Z",
};

const validPayload: StandardBundlePayload = {
  format: { type: BUNDLE_TYPE, version: BUNDLE_FORMAT_VERSION },
  tenantId: TENANT_ID,
  sequence: 1,
  keyId: "key-2026-10",
  issuedAt: AT,
  stalenessHours: DEFAULT_STALENESS_HOURS,
  frozen: false,
  standards: [validStandard],
  tree: validTree,
  applications: [validApplication],
  acceptedDeviations: [validAcceptedDeviation],
};

const validSigned: SignedStandardBundle = {
  payload: validPayload,
  keyId: "key-2026-10",
  signature: "dGVzdC1zaWduYXR1cmU=",
};

describe("Standard bundle wire contract (Story 4.1)", () => {
  it("exposes the format identity, default staleness bound, and HTTP API paths", () => {
    expect(BUNDLE_TYPE).toBe("domain-harness/standard-bundle");
    expect(BUNDLE_FORMAT_VERSION).toBe(1);
    expect(DEFAULT_STALENESS_HOURS).toBe(24);
    expect(BUNDLE_API_PATHS).toEqual({
      staleness: "/v1/standard-bundles/staleness",
      freeze: "/v1/standard-bundles/freeze",
    });
    expect(standardBundleLatestPath(TENANT_ID)).toBe(`/v1/standard-bundles/${TENANT_ID}`);
    expect(standardBundleLatestPath("a/b")).toBe("/v1/standard-bundles/a%2Fb");
  });

  it("round-trips a valid payload and signed bundle through the guards", () => {
    expect(isBundleFormat(validPayload.format)).toBe(true);
    expect(isBundleApplication(validApplication)).toBe(true);
    expect(isStandardBundlePayload(validPayload)).toBe(true);
    expect(isSignedStandardBundle(validSigned)).toBe(true);

    const parsed: unknown = JSON.parse(canonicalJson(validSigned));
    expect(isSignedStandardBundle(parsed)).toBe(true);
  });

  it("rejects malformed bundle formats and applications", () => {
    expect(isBundleFormat(null)).toBe(false);
    expect(isBundleFormat([])).toBe(false);
    expect(isBundleFormat({ type: "other", version: 1 })).toBe(false);
    expect(isBundleFormat({ type: BUNDLE_TYPE, version: 2 })).toBe(false);
    expect(isBundleFormat({ type: BUNDLE_TYPE, version: 1.5 })).toBe(false);
    expect(isBundleFormat({ type: BUNDLE_TYPE, version: 1, extra: true })).toBe(false);

    expect(isBundleApplication(null)).toBe(false);
    expect(isBundleApplication({ ...validApplication, id: "nope" })).toBe(false);
    expect(isBundleApplication({ ...validApplication, projectId: "nope" })).toBe(false);
    expect(isBundleApplication({ ...validApplication, fromFlow: "yes" })).toBe(false);
    expect(isBundleApplication({ ...validApplication, extra: 1 })).toBe(false);
  });

  it.each([
    ["null", null],
    ["an array", []],
    ["an empty object", {}],
    ["an extra key", { ...validPayload, extra: true }],
    [
      "a missing key",
      (() => {
        const copy: Record<string, unknown> = { ...validPayload };
        delete copy["frozen"];
        return copy;
      })(),
    ],
    ["an unknown format major version", { ...validPayload, format: { type: BUNDLE_TYPE, version: 2 } }],
    ["an unknown format type", { ...validPayload, format: { type: "unknown", version: 1 } }],
    ["a bad tenantId", { ...validPayload, tenantId: "not-a-uuid" }],
    ["sequence 0", { ...validPayload, sequence: 0 }],
    ["a fractional sequence", { ...validPayload, sequence: 1.5 }],
    ["an empty keyId", { ...validPayload, keyId: "" }],
    ["a non-string keyId", { ...validPayload, keyId: 123 }],
    ["a non-UTC issuedAt", { ...validPayload, issuedAt: "2026-10-13T10:00:00+02:00" }],
    ["stalenessHours 0", { ...validPayload, stalenessHours: 0 }],
    ["stalenessHours 721", { ...validPayload, stalenessHours: 721 }],
    ["fractional stalenessHours", { ...validPayload, stalenessHours: 12.5 }],
    ["non-boolean frozen", { ...validPayload, frozen: 0 }],
    ["bad standard", { ...validPayload, standards: [{ ...validStandard, version: 0 }] }],
    ["bad tree", { ...validPayload, tree: { ...validTree, projects: [] } }],
    ["bad application", { ...validPayload, applications: [{ ...validApplication, fromFlow: 1 }] }],
    ["bad acceptedDeviation", { ...validPayload, acceptedDeviations: [{}] }],
  ])("rejects a payload with %s", (_label, candidate) => {
    expect(isStandardBundlePayload(candidate)).toBe(false);
  });

  it.each([
    ["null", null],
    ["an array", []],
    ["an extra key", { ...validSigned, hash: "abc" }],
    ["an empty keyId", { ...validSigned, keyId: "" }],
    ["a mismatched keyId", { ...validSigned, keyId: "other-key" }],
    ["a non-string keyId", { ...validSigned, keyId: 1 }],
    ["an empty signature", { ...validSigned, signature: "" }],
    ["a non-string signature", { ...validSigned, signature: null }],
    ["an invalid payload", { ...validSigned, payload: { ...validPayload, sequence: 0 } }],
  ])("rejects a signed bundle with %s", (_label, candidate) => {
    expect(isSignedStandardBundle(candidate)).toBe(false);
  });

  describe("canonicalJson", () => {
    it("recursively sorts object keys in UTF-16 code-unit order and preserves array element order", () => {
      const a = {
        z: 1,
        a: [
          { d: "two", c: "one" },
          { b: false, a: true },
        ],
        m: { "\u00e9": 1, e: 2, "\u{1F600}": 3 },
      };
      const b = {
        m: { "\u{1F600}": 3, "\u00e9": 1, e: 2 },
        a: [
          { c: "one", d: "two" },
          { a: true, b: false },
        ],
        z: 1,
      };
      expect(canonicalJson(a)).toBe(canonicalJson(b));
      expect(canonicalJson(a)).toBe(
        '{"a":[{"c":"one","d":"two"},{"a":true,"b":false}],"m":{"e":2,"\\u00e9":1,"\\ud83d\\ude00":3},"z":1}'
          .replace("\\u00e9", "\u00e9")
          .replace("\\ud83d\\ude00", "\u{1F600}"),
      );
    });

    it("produces byte-identical output for the same bundle regardless of property insertion order", () => {
      const reorderedPayload = {
        acceptedDeviations: validPayload.acceptedDeviations,
        applications: validPayload.applications.map((app) => ({
          fromFlow: app.fromFlow,
          projectId: app.projectId,
          id: app.id,
        })),
        tree: {
          lockedRules: validPayload.tree.lockedRules,
          projects: validPayload.tree.projects,
          rootId: validPayload.tree.rootId,
        },
        standards: validPayload.standards,
        frozen: validPayload.frozen,
        stalenessHours: validPayload.stalenessHours,
        issuedAt: validPayload.issuedAt,
        keyId: validPayload.keyId,
        sequence: validPayload.sequence,
        tenantId: validPayload.tenantId,
        format: { version: BUNDLE_FORMAT_VERSION, type: BUNDLE_TYPE },
      };
      expect(canonicalJson(reorderedPayload)).toBe(canonicalJson(validPayload));
    });

    it("omits object properties whose value is undefined, matching JSON.stringify", () => {
      expect(canonicalJson({ b: 1, a: undefined, c: "ok" })).toBe('{"b":1,"c":"ok"}');
    });

    it("rejects non-finite numbers", () => {
      expect(() => canonicalJson(Number.NaN)).toThrow(TypeError);
      expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow(TypeError);
    });
  });
});
