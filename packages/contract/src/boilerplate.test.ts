import { describe, expect, it } from "vitest";
import {
  applicationBoilerplatePath,
  BOILERPLATE_CONFLICT,
  BOILERPLATE_TARGETS,
  boilerplateArchiveName,
  GUIDANCE_ENDPOINT_PATH,
  GUIDANCE_ENDPOINT_UNSET,
  GUIDANCE_ENDPOINT_URL_MAX,
  isBoilerplateResult,
  isBoilerplateTarget,
  isGuidanceEndpointState,
  MCP_BRIDGE_PACKAGE,
  UNSUPPORTED_ECOSYSTEM,
} from "./index.ts";

const APP = "01928c7e-5b2a-7c3d-ae4f-a1b2c3d4e5f8";
const AT = "2026-10-12T09:00:00.000Z";

const result = {
  applicationId: APP,
  target: "claude-code",
  archiveName: `domain-harness-${APP}-claude-code.tar.gz`,
  archiveBase64: "H4sIAAAAAAAAAw==",
  artifacts: [{ kind: "identification-file", path: ".domain-harness.json" }],
};

describe("Boilerplate wire contract", () => {
  it("names the paths, constants and codes once", () => {
    expect(GUIDANCE_ENDPOINT_PATH).toBe("/v1/guidance-endpoint");
    expect(GUIDANCE_ENDPOINT_URL_MAX).toBe(2048);
    expect(BOILERPLATE_TARGETS).toEqual(["claude-code"]);
    expect(applicationBoilerplatePath(APP)).toBe(`/v1/applications/${APP}/boilerplate`);
    expect(applicationBoilerplatePath("a/b")).toBe("/v1/applications/a%2Fb/boilerplate");
    expect(boilerplateArchiveName(APP, "claude-code")).toBe(`domain-harness-${APP}-claude-code.tar.gz`);
    expect(MCP_BRIDGE_PACKAGE).toBe("@domain-harness/mcp-bridge");
    expect(GUIDANCE_ENDPOINT_UNSET).toBe("guidance_endpoint_unset");
    expect(UNSUPPORTED_ECOSYSTEM).toBe("unsupported_ecosystem");
    expect(BOILERPLATE_CONFLICT).toBe("boilerplate_conflict");
  });

  it("knows the targets", () => {
    expect(isBoilerplateTarget("claude-code")).toBe(true);
    expect(isBoilerplateTarget("cursor")).toBe(false);
    expect(isBoilerplateTarget(null)).toBe(false);
  });

  it("accepts a set and an unset endpoint state", () => {
    expect(isGuidanceEndpointState({ url: "https://g.acme.example/v1", changedAt: AT })).toBe(true);
    expect(isGuidanceEndpointState({ url: null, changedAt: null })).toBe(true);
  });

  it.each([
    ["a URL without a time", { url: "https://g.example", changedAt: null }],
    ["a time without a URL", { url: null, changedAt: AT }],
    ["an empty URL", { url: "", changedAt: AT }],
    ["a non-UTC time", { url: "https://g.example", changedAt: "2026-10-12" }],
    ["null", null],
  ])("rejects an endpoint state with %s", (_label, value) => {
    expect(isGuidanceEndpointState(value)).toBe(false);
  });

  it("accepts a result", () => {
    expect(isBoilerplateResult(result)).toBe(true);
  });

  it.each([
    ["a bad id", { ...result, applicationId: "x" }],
    ["an unknown target", { ...result, target: "cursor" }],
    ["an empty archive", { ...result, archiveBase64: "" }],
    ["no artifacts", { ...result, artifacts: [] }],
    ["an unknown artifact kind", { ...result, artifacts: [{ kind: "hooks", path: "x" }] }],
    ["an artifact without a path", { ...result, artifacts: [{ kind: "skills", path: "" }] }],
    ["an array", []],
  ])("rejects a result with %s", (_label, value) => {
    expect(isBoilerplateResult(value)).toBe(false);
  });
});
