import { describe, expect, it } from "vitest";
import { canonicalJson } from "./bundles.ts";
import { GUIDANCE_TOOL_NAMES, GUIDANCE_TOOL_SUBJECT_MAX, GUIDANCE_TOOLS, isGuidanceToolName, isGuidanceToolResult } from "./index.ts";
import type { GuidanceToolName, GuidanceToolResult } from "./index.ts";

const TOOL_NAMES: readonly GuidanceToolName[] = ["code_stack_rule", "design_component", "design_token", "design_import"];

const BUNDLE_HASH = "a".repeat(64);

const hit: GuidanceToolResult = {
  kind: "hit",
  tool: "code_stack_rule",
  subject: "react",
  standardId: "018f3d2a-7000-7000-8000-000000000001",
  version: 3,
  content: "The library React is approved.\nCorrection: prefer the Company wrapper.",
  bundleHash: BUNDLE_HASH,
  stale: false,
};

const miss: GuidanceToolResult = {
  kind: "miss",
  tool: "design_token",
  subject: "primary-color",
  sentence: "the active bundle holds no design token named primary-color",
  bundleHash: BUNDLE_HASH,
  stale: false,
};

const unbound: GuidanceToolResult = {
  kind: "unbound",
  reason: "unknown_application",
  sentence: "unbound Application",
};

describe("GUIDANCE_TOOLS", () => {
  it("is exactly the four versioned tools, in registration order", () => {
    expect(GUIDANCE_TOOL_NAMES).toEqual(["code_stack_rule", "design_component", "design_token", "design_import"]);
    expect(GUIDANCE_TOOLS.map((tool) => tool.name)).toEqual([...TOOL_NAMES]);
  });

  it("gives every tool one required subject string of 1..1000 characters and no other parameter", () => {
    for (const tool of GUIDANCE_TOOLS) {
      expect(tool.inputSchema).toEqual({
        type: "object",
        properties: {
          subject: {
            type: "string",
            minLength: 1,
            maxLength: GUIDANCE_TOOL_SUBJECT_MAX,
            description: expect.any(String) as string,
          },
        },
        required: ["subject"],
        additionalProperties: false,
      });
      expect(GUIDANCE_TOOL_SUBJECT_MAX).toBe(1000);
    }
  });

  it("states each tool's decision and input as product copy (UX-DR30)", () => {
    for (const tool of GUIDANCE_TOOLS) {
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.description.endsWith(".")).toBe(true);
    }
    expect(GUIDANCE_TOOLS[0]?.description).toContain("language, framework or library name");
    expect(GUIDANCE_TOOLS[1]?.description).toContain("component");
    expect(GUIDANCE_TOOLS[2]?.description).toContain("token");
    expect(GUIDANCE_TOOLS[3]?.description).toContain("module specifier");
  });
});

describe("isGuidanceToolName", () => {
  it("accepts exactly the four names and nothing else, never throwing", () => {
    for (const name of TOOL_NAMES) expect(isGuidanceToolName(name)).toBe(true);
    expect(isGuidanceToolName("code__stack_rule")).toBe(false);
    expect(isGuidanceToolName("")).toBe(false);
    expect(isGuidanceToolName(undefined)).toBe(false);
    expect(isGuidanceToolName(null)).toBe(false);
    expect(isGuidanceToolName(1)).toBe(false);
  });
});

describe("isGuidanceToolResult", () => {
  it("accepts a complete hit", () => {
    expect(isGuidanceToolResult(hit)).toBe(true);
  });

  it("accepts a complete miss", () => {
    expect(isGuidanceToolResult(miss)).toBe(true);
  });

  it("accepts an unbound result with every serving and identity reason", () => {
    for (const reason of [
      "commit_first",
      "missing_identification_file",
      "unknown_application",
      "unavailable",
      "refused",
      "set_unreadable",
    ] as const) {
      expect(isGuidanceToolResult({ kind: "unbound", reason, sentence: "s" })).toBe(true);
    }
  });

  it("rejects non-results, unknown kinds, unknown tools, empty fields and non-integer versions without throwing", () => {
    expect(isGuidanceToolResult(undefined)).toBe(false);
    expect(isGuidanceToolResult(null)).toBe(false);
    expect(isGuidanceToolResult("hit")).toBe(false);
    expect(isGuidanceToolResult({ kind: "hit", tool: "code_stack_rule" })).toBe(false);
    expect(isGuidanceToolResult({ ...hit, tool: "code__stack_rule" })).toBe(false);
    expect(isGuidanceToolResult({ ...hit, subject: "" })).toBe(false);
    expect(isGuidanceToolResult({ ...hit, subject: "x".repeat(1001) })).toBe(false);
    expect(isGuidanceToolResult({ ...hit, standardId: "" })).toBe(false);
    expect(isGuidanceToolResult({ ...hit, version: 1.5 })).toBe(false);
    expect(isGuidanceToolResult({ ...hit, version: 0 })).toBe(false);
    expect(isGuidanceToolResult({ ...hit, content: "" })).toBe(false);
    expect(isGuidanceToolResult({ ...hit, bundleHash: "" })).toBe(false);
    expect(isGuidanceToolResult({ ...hit, bundleHash: "A".repeat(64) }), "uppercase hex is not the served form").toBe(false);
    expect(isGuidanceToolResult({ ...hit, bundleHash: "a".repeat(63) })).toBe(false);
    expect(isGuidanceToolResult({ ...hit, stale: "yes" })).toBe(false);
    expect(isGuidanceToolResult({ ...miss, subject: "" })).toBe(false);
    expect(isGuidanceToolResult({ ...miss, bundleHash: "g".repeat(64) })).toBe(false);
    expect(isGuidanceToolResult({ ...miss, sentence: "  " })).toBe(false);
    expect(isGuidanceToolResult({ kind: "unbound", reason: "other", sentence: "s" })).toBe(false);
    expect(isGuidanceToolResult({ kind: "unbound", reason: "commit_first", sentence: "" })).toBe(false);
    expect(isGuidanceToolResult({ ...unbound, kind: "grant" })).toBe(false);
  });

  it("accepts a whitespace-only subject: the length rule, not trim-nonempty, governs the field", () => {
    const whitespaceMiss: GuidanceToolResult = { ...miss, subject: "   " };
    expect(isGuidanceToolResult(whitespaceMiss)).toBe(true);
    const whitespaceHit: GuidanceToolResult = { ...hit, subject: " \n\t" };
    expect(isGuidanceToolResult(whitespaceHit)).toBe(true);
  });

  it("bounds the subject at 1000 code points, not UTF-16 units", () => {
    // One astral character is two UTF-16 units: 500 of them are 1000 code
    // points inside the bound but 2000 UTF-16 units beyond it.
    expect(isGuidanceToolResult({ ...hit, subject: "🦋".repeat(500) })).toBe(true);
    expect(isGuidanceToolResult({ ...hit, subject: "🦋".repeat(1001) })).toBe(false);
  });
});

describe("the serialized result", () => {
  it("serializes deterministically through canonicalJson, the same serializer the bundles use", () => {
    const first = canonicalJson(hit);
    expect(first).toBe(canonicalJson({ ...hit }));
    expect(JSON.parse(first) as unknown).toEqual(hit);
  });
});
