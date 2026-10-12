import { describe, expect, it } from "vitest";
import { validateCodeStackEntry, validateDesignSystemEntry, validatePublishBody } from "./validate.ts";

const entry = { category: "library", name: " React ", versionConstraint: " ^18 ", status: "approved" };

describe("validateCodeStackEntry", () => {
  it("trims text and stores missing optional fields as null", () => {
    expect(validateCodeStackEntry(entry)).toEqual({
      category: "library",
      name: "React",
      versionConstraint: "^18",
      status: "approved",
      correctionInstruction: null,
    });
  });

  it.each([[""], ["   "], [null], [undefined]])("stores the optional text %j as null", (value) => {
    expect(validateCodeStackEntry({ ...entry, versionConstraint: value, correctionInstruction: value })).toMatchObject({
      versionConstraint: null,
      correctionInstruction: null,
    });
  });

  it("accepts every category and status, and the maximum lengths in characters", () => {
    for (const category of ["language", "framework", "library"]) {
      for (const status of ["approved", "prohibited", "required"]) {
        expect(validateCodeStackEntry({ ...entry, category, status })).toMatchObject({ category, status });
      }
    }
    const max = validateCodeStackEntry({
      ...entry,
      name: "\u{1F600}".repeat(200),
      versionConstraint: "x".repeat(100),
      correctionInstruction: ` ${"y".repeat(1000)} `,
    });
    expect(max.correctionInstruction).toHaveLength(1000);
  });

  it.each([
    ["a missing name", { ...entry, name: undefined }, "name"],
    ["a blank name", { ...entry, name: "   " }, "name"],
    ["a 201-character name", { ...entry, name: "x".repeat(201) }, "name"],
    ["a numeric name", { ...entry, name: 7 }, "name"],
    ["a bad category", { ...entry, category: "tool" }, "category"],
    ["a missing category", { ...entry, category: undefined }, "category"],
    ["a capitalised category", { ...entry, category: "Library" }, "category"],
    ["a bad status", { ...entry, status: "allowed" }, "status"],
    ["a missing status", { ...entry, status: undefined }, "status"],
    ["a 101-character version constraint", { ...entry, versionConstraint: "x".repeat(101) }, "versionConstraint"],
    ["a numeric version constraint", { ...entry, versionConstraint: 18 }, "versionConstraint"],
    ["a 1001-character instruction", { ...entry, correctionInstruction: "x".repeat(1001) }, "correctionInstruction"],
    ["an extra key", { ...entry, id: "x" }, "id"],
    ["an array", [entry], "entry"],
    ["null", null, "entry"],
  ])("refuses %s with invalid_input on that field", (_label, value, subject) => {
    expect(() => validateCodeStackEntry(value)).toThrow(expect.objectContaining({ code: "invalid_input", subject }));
  });

  it("reports an unknown key before any field error", () => {
    expect(() => validateCodeStackEntry({ name: "", extra: 1 })).toThrow(expect.objectContaining({ subject: "extra" }));
  });

  it("checks fields in form order", () => {
    expect(() => validateCodeStackEntry({ category: "x", name: "", status: "x" })).toThrow(
      expect.objectContaining({ subject: "category" }),
    );
    expect(() => validateCodeStackEntry({ category: "library", name: "", status: "x" })).toThrow(
      expect.objectContaining({ subject: "name" }),
    );
  });
});

describe("validatePublishBody", () => {
  it("takes the entry of a body that is exactly { entry }", () => {
    expect(validatePublishBody({ entry }, "code-stack")).toMatchObject({ name: "React" });
    expect(validatePublishBody({ entry: { kind: "token", name: " primary ", status: "required" } }, "design-system")).toEqual(
      { kind: "token", name: "primary", status: "required" },
    );
  });

  it("validates by the Module's kind: a wrong-kind entry is refused on kind", () => {
    expect(() => validatePublishBody({ entry }, "design-system")).toThrow(
      expect.objectContaining({ code: "invalid_input", subject: "kind" }),
    );
    expect(() =>
      validatePublishBody({ entry: { kind: "token", name: "primary", status: "required" } }, "code-stack"),
    ).toThrow(expect.objectContaining({ code: "invalid_input", subject: "kind" }));
  });

  it.each([
    ["a non-object", ["x"], "body"],
    ["an extra key", { entry, standardId: "x" }, "standardId"],
    ["a missing entry", {}, "entry"],
  ])("refuses %s", (_label, body, subject) => {
    expect(() => validatePublishBody(body, "code-stack")).toThrow(expect.objectContaining({ code: "invalid_input", subject }));
  });
});

describe("validateDesignSystemEntry", () => {
  const component = { kind: "component", name: " Button ", usageRule: " Use for primary actions ", tokens: [" primary ", "spacing-4"] };
  const token = { kind: "token", name: " primary ", status: "prohibited" };
  const importEntry = { kind: "import", specifier: " @mui/material ", status: "required" };

  it("trims and normalises a component, a token and an import", () => {
    expect(validateDesignSystemEntry(component)).toEqual({
      kind: "component",
      name: "Button",
      usageRule: "Use for primary actions",
      tokens: ["primary", "spacing-4"],
      correctionInstruction: null,
    });
    expect(validateDesignSystemEntry(token)).toEqual({ kind: "token", name: "primary", status: "prohibited" });
    expect(validateDesignSystemEntry(importEntry)).toEqual({
      kind: "import",
      specifier: "@mui/material",
      status: "required",
    });
  });

  it.each([[""], ["   "], [null], [undefined]])("stores the optional Correction instruction %j as null", (value) => {
    expect(validateDesignSystemEntry({ ...component, correctionInstruction: value })).toMatchObject({
      correctionInstruction: null,
    });
  });

  it("accepts no tokens, 50 tokens and the maximum lengths", () => {
    expect(validateDesignSystemEntry({ ...component, tokens: [] })).toMatchObject({ tokens: [] });
    const fifty = Array.from({ length: 50 }, (_, i) => `t${String(i)}`);
    expect(validateDesignSystemEntry({ ...component, tokens: fifty })).toMatchObject({ tokens: fifty });
    const max = validateDesignSystemEntry({
      ...component,
      name: "x".repeat(200),
      usageRule: "u".repeat(1000),
      tokens: ["t".repeat(200)],
      correctionInstruction: "c".repeat(1000),
    });
    expect(max).toMatchObject({ correctionInstruction: "c".repeat(1000) });
    expect(validateDesignSystemEntry({ ...importEntry, specifier: "s".repeat(200) })).toMatchObject({
      specifier: "s".repeat(200),
    });
  });

  it.each([
    ["a missing kind", { name: "Button", usageRule: "x", tokens: [] }, "kind"],
    ["a bad kind", { ...token, kind: "brand" }, "kind"],
    ["a code-stack entry", { category: "library", name: "React", status: "approved" }, "kind"],
    ["a blank component name", { ...component, name: "  " }, "name"],
    ["a 201-character component name", { ...component, name: "x".repeat(201) }, "name"],
    ["a blank usage rule", { ...component, usageRule: " " }, "usageRule"],
    ["a 1001-character usage rule", { ...component, usageRule: "x".repeat(1001) }, "usageRule"],
    ["51 tokens", { ...component, tokens: Array.from({ length: 51 }, (_, i) => `t${String(i)}`) }, "tokens"],
    ["a blank token", { ...component, tokens: ["primary", " "] }, "tokens"],
    ["a 201-character token", { ...component, tokens: ["x".repeat(201)] }, "tokens"],
    ["duplicate tokens", { ...component, tokens: ["a", " A "] }, "tokens"],
    ["tokens not an array", { ...component, tokens: "primary" }, "tokens"],
    ["a numeric token", { ...component, tokens: [1] }, "tokens"],
    ["missing tokens", { kind: "component", name: "Button", usageRule: "x" }, "tokens"],
    ["a 1001-character instruction", { ...component, correctionInstruction: "x".repeat(1001) }, "correctionInstruction"],
    ["versionConstraint on a component", { ...component, versionConstraint: "^1" }, "versionConstraint"],
    ["status on a component", { ...component, status: "required" }, "status"],
    ["a blank token name", { ...token, name: "" }, "name"],
    ["a token with status approved", { ...token, status: "approved" }, "status"],
    ["a token with a missing status", { kind: "token", name: "primary" }, "status"],
    ["a token with a usage rule", { ...token, usageRule: "x" }, "usageRule"],
    ["a blank specifier", { ...importEntry, specifier: " " }, "specifier"],
    ["a 201-character specifier", { ...importEntry, specifier: "x".repeat(201) }, "specifier"],
    ["an import with a name", { ...importEntry, name: "x" }, "name"],
    ["an import with status approved", { ...importEntry, status: "approved" }, "status"],
    ["an array", [token], "entry"],
    ["null", null, "entry"],
  ])("refuses %s with invalid_input on that field", (_label, value, subject) => {
    expect(() => validateDesignSystemEntry(value)).toThrow(expect.objectContaining({ code: "invalid_input", subject }));
  });

  it("checks kind, then unknown keys, then fields in form order", () => {
    expect(() => validateDesignSystemEntry({ kind: "x", extra: 1, name: "" })).toThrow(
      expect.objectContaining({ subject: "kind" }),
    );
    expect(() => validateDesignSystemEntry({ kind: "component", extra: 1, name: "" })).toThrow(
      expect.objectContaining({ subject: "extra" }),
    );
    expect(() => validateDesignSystemEntry({ kind: "component", name: "", usageRule: "", tokens: "x" })).toThrow(
      expect.objectContaining({ subject: "name" }),
    );
    expect(() => validateDesignSystemEntry({ kind: "component", name: "B", usageRule: "", tokens: "x" })).toThrow(
      expect.objectContaining({ subject: "usageRule" }),
    );
  });
});
