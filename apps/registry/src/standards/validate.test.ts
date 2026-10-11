import { describe, expect, it } from "vitest";
import { validateCodeStackEntry, validatePublishBody } from "./validate.ts";

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
    expect(validatePublishBody({ entry }).name).toBe("React");
  });

  it.each([
    ["a non-object", ["x"], "body"],
    ["an extra key", { entry, standardId: "x" }, "standardId"],
    ["a missing entry", {}, "entry"],
  ])("refuses %s", (_label, body, subject) => {
    expect(() => validatePublishBody(body)).toThrow(expect.objectContaining({ code: "invalid_input", subject }));
  });
});
