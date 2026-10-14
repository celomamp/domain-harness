import { describe, expect, it } from "vitest";
import {
  GUIDANCE_IDENTITY_HEADERS,
  isGuidanceIdentityResult,
  MCP_BRIDGE_PACKAGE,
  REPOSITORY_FINGERPRINT_ALGORITHM_VERSION,
} from "./index.ts";
import type { GuidanceIdentityResult, UuidV7 } from "./index.ts";

const APPLICATION_ID = "018f3d2a-7000-7000-8000-000000000001" as UuidV7;
const PROJECT_ID = "018f3d2a-7000-7000-8000-000000000002" as UuidV7;
const OTHER_PROJECT_ID = "018f3d2a-7000-7000-8000-000000000003";

describe("GUIDANCE_IDENTITY_HEADERS", () => {
  it("carries the three versioned header names", () => {
    expect(GUIDANCE_IDENTITY_HEADERS).toEqual({
      applicationId: "X-DH-Application-Id",
      advisoryProjectId: "X-DH-Advisory-Project-Id",
      repoFingerprint: "X-DH-Repo-Fingerprint",
    });
  });

  it("versions the fingerprint algorithm as 1: lowercase SHA-256 hex of the root commit SHA", () => {
    expect(REPOSITORY_FINGERPRINT_ALGORITHM_VERSION).toBe(1);
  });
});

describe("isGuidanceIdentityResult", () => {
  const bound: GuidanceIdentityResult = {
    kind: "bound",
    applicationId: APPLICATION_ID,
    projectId: PROJECT_ID,
    bundleHash: "a".repeat(64),
    advisoryMismatch: null,
  };

  it("accepts a complete bound result without an advisory mismatch", () => {
    expect(isGuidanceIdentityResult(bound)).toBe(true);
  });

  it("accepts a bound result carrying an advisory mismatch", () => {
    expect(
      isGuidanceIdentityResult({
        ...bound,
        advisoryMismatch: { presentedProjectId: OTHER_PROJECT_ID, bundleProjectId: PROJECT_ID },
      }),
    ).toBe(true);
  });

  it("accepts an unbound result with a known reason and a sentence", () => {
    for (const reason of ["commit_first", "missing_identification_file", "unknown_application"] as const) {
      expect(isGuidanceIdentityResult({ kind: "unbound", reason, sentence: "sentence" })).toBe(true);
    }
  });

  it("accepts a refused result with the presented and bound fingerprints", () => {
    expect(
      isGuidanceIdentityResult({
        kind: "refused",
        sentence: "duplicate Application id",
        presentedFingerprint: "1".repeat(64),
        boundFingerprint: "2".repeat(64),
      }),
    ).toBe(true);
  });

  it("rejects non-results, unknown kinds, empty fields and unknown reasons without throwing", () => {
    expect(isGuidanceIdentityResult(undefined)).toBe(false);
    expect(isGuidanceIdentityResult(null)).toBe(false);
    expect(isGuidanceIdentityResult("bound")).toBe(false);
    expect(isGuidanceIdentityResult({ kind: "bound", applicationId: APPLICATION_ID })).toBe(false);
    expect(isGuidanceIdentityResult({ ...bound, applicationId: "not-a-uuid" })).toBe(false);
    expect(isGuidanceIdentityResult({ ...bound, projectId: "not-a-uuid" })).toBe(false);
    expect(isGuidanceIdentityResult({ ...bound, bundleHash: "" })).toBe(false);
    expect(isGuidanceIdentityResult({ ...bound, advisoryMismatch: {} })).toBe(false);
    expect(isGuidanceIdentityResult({ ...bound, advisoryMismatch: { presentedProjectId: "p" } })).toBe(false);
    expect(isGuidanceIdentityResult({ kind: "unbound", reason: "other", sentence: "sentence" })).toBe(false);
    expect(isGuidanceIdentityResult({ kind: "unbound", reason: "commit_first", sentence: "" })).toBe(false);
    expect(
      isGuidanceIdentityResult({
        kind: "refused",
        sentence: "s",
        presentedFingerprint: "1".repeat(64),
        boundFingerprint: "",
      }),
    ).toBe(false);
  });
});

describe("the bridge package name", () => {
  it("is pinned by the contract constant the Boilerplates already declare", () => {
    expect(MCP_BRIDGE_PACKAGE).toBe("@domain-harness/mcp-bridge");
  });
});
