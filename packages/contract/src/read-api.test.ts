import { describe, expect, it } from "vitest";
import {
  BUNDLE_UNREADABLE,
  READ_API_PATHS,
  effectiveStandardsPath,
  isReadEffectiveSetResponse,
  isReadStandardsResponse,
} from "./index.ts";
import type { ReadEffectiveSetResponse, ReadStandardsResponse, UuidV7 } from "./index.ts";

const PROJECT = "01928c7e-5b2a-7c3d-ae4f-a1b2c3d4e5f8" as UuidV7;
const STANDARD = "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e5f6" as UuidV7;
const MODULE = "01928c7e-5b2a-7c3d-9e4f-a1b2c3d4e5f7" as UuidV7;
const OWNER = "01928c7e-5b2a-7c3d-be4f-a1b2c3d4e5f9" as UuidV7;
const HASH = "a".repeat(64);
const AT = "2026-10-12T09:00:00.000Z";

const standard = {
  id: STANDARD,
  version: 2,
  module: { id: MODULE, kind: "code-stack", name: "Code stack" },
  project: { id: PROJECT, name: "Acme" },
  entry: { category: "library", name: "X", versionConstraint: null, status: "prohibited", correctionInstruction: null },
  publishedAt: AT,
  publishedBy: { accountId: OWNER, name: "Sam Owner" },
};

const entry = {
  slot: { moduleKind: "code-stack", slotKind: "library", name: "X" },
  status: "prohibited",
  standard,
  sourceProject: { id: PROJECT, name: "Acme" },
  locked: false,
};

function standardsResponse(overrides: Partial<ReadStandardsResponse> = {}): ReadStandardsResponse {
  return { bundleHash: HASH, standards: [standard], ...overrides } as ReadStandardsResponse;
}

function effectiveResponse(overrides: Partial<ReadEffectiveSetResponse> = {}): ReadEffectiveSetResponse {
  return {
    bundleHash: HASH,
    project: { id: PROJECT, name: "Acme" },
    standards: [entry],
    ...overrides,
  } as ReadEffectiveSetResponse;
}

describe("Company Read API wire contract (Story 4.6)", () => {
  it("versions the Standards path and reuses the registry's Effective set spelling", () => {
    expect(READ_API_PATHS).toEqual({ standards: "/v1/standards" });
    expect(READ_API_PATHS.standards).toBe("/v1/standards");
    expect(effectiveStandardsPath(PROJECT)).toBe(`/v1/projects/${PROJECT}/effective-standards`);
  });

  it("versions the bundle_unreadable code", () => {
    expect(BUNDLE_UNREADABLE).toBe("bundle_unreadable");
  });

  it("round-trips both responses with their quoted hash", () => {
    expect(isReadStandardsResponse(standardsResponse())).toBe(true);
    expect(isReadStandardsResponse({ bundleHash: HASH, standards: [] })).toBe(true);
    expect(isReadEffectiveSetResponse(effectiveResponse())).toBe(true);
    expect(
      isReadEffectiveSetResponse({ bundleHash: HASH, project: { id: PROJECT, name: "Acme" }, standards: [] }),
    ).toBe(true);
  });

  it("enforces the 64-hex hash rule", () => {
    expect(isReadStandardsResponse(standardsResponse({ bundleHash: "abc" }))).toBe(false);
    expect(isReadStandardsResponse(standardsResponse({ bundleHash: "A".repeat(64) }))).toBe(false);
    expect(isReadEffectiveSetResponse(effectiveResponse({ bundleHash: "z".repeat(64) }))).toBe(false);
    expect(isReadEffectiveSetResponse(effectiveResponse({ bundleHash: "" }))).toBe(false);
  });

  it("rejects extra keys on either response", () => {
    expect(isReadStandardsResponse({ ...standardsResponse(), extra: 1 })).toBe(false);
    expect(isReadEffectiveSetResponse({ ...effectiveResponse(), extra: 1 })).toBe(false);
  });

  it("rejects a bad Standard, a bad Effective entry and a bad project", () => {
    expect(isReadStandardsResponse(standardsResponse({ standards: [{ ...standard, version: 0 }] as never }))).toBe(
      false,
    );
    expect(
      isReadEffectiveSetResponse(effectiveResponse({ standards: [{ ...entry, locked: 1 }] as never })),
    ).toBe(false);
    expect(isReadEffectiveSetResponse(effectiveResponse({ project: { id: "p", name: "Acme" } as never }))).toBe(
      false,
    );
  });

  it("rejects missing keys, null and non-objects, never throwing", () => {
    expect(isReadStandardsResponse({ bundleHash: HASH })).toBe(false);
    expect(isReadStandardsResponse(null)).toBe(false);
    expect(isReadEffectiveSetResponse({ bundleHash: HASH, project: { id: PROJECT, name: "Acme" } })).toBe(false);
    expect(isReadEffectiveSetResponse(undefined)).toBe(false);
    expect(() => isReadStandardsResponse({ bundleHash: 1, standards: 2 })).not.toThrow();
    expect(() => isReadEffectiveSetResponse({ bundleHash: 1, project: 2, standards: 3 })).not.toThrow();
  });
});
