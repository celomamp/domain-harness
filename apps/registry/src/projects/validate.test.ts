import { describe, expect, it } from "vitest";
import { mintUuidV7 } from "../ids.ts";
import { validateCreateBody, validateParentBody } from "./validate.ts";

const PARENT = mintUuidV7();
const good = { name: " Web ", levelName: "  Product line ", parentId: PARENT };

describe("validateCreateBody", () => {
  it("trims the name and keeps the level name exactly as typed", () => {
    expect(validateCreateBody(good)).toEqual({ name: "Web", levelName: "  Product line ", parentId: PARENT });
    expect(validateCreateBody({ ...good, levelName: "Équipe" }).levelName).toBe("Équipe");
  });

  it("accepts 200 characters (code points) for both texts", () => {
    const wide = "\u{1F600}".repeat(200);
    expect(validateCreateBody({ ...good, name: ` ${wide} `, levelName: wide })).toMatchObject({ name: wide, levelName: wide });
  });

  it.each([
    ["a non-object body", ["x"], "body"],
    ["null", null, "body"],
    ["an extra key", { ...good, id: "x" }, "id"],
    ["a missing name", { levelName: "x", parentId: PARENT }, "name"],
    ["a blank name", { ...good, name: "   " }, "name"],
    ["a 201-character name", { ...good, name: "x".repeat(201) }, "name"],
    ["a numeric name", { ...good, name: 7 }, "name"],
    ["a missing level name", { name: "Web", parentId: PARENT }, "levelName"],
    ["a blank level name", { ...good, levelName: "" }, "levelName"],
    ["a whitespace-only level name", { ...good, levelName: " \t " }, "levelName"],
    ["a 201-character level name", { ...good, levelName: "x".repeat(201) }, "levelName"],
    ["a null level name", { ...good, levelName: null }, "levelName"],
    ["a missing parent", { name: "Web", levelName: "x" }, "parentId"],
    ["a null parent", { ...good, parentId: null }, "parentId"],
    ["a malformed parent", { ...good, parentId: "root" }, "parentId"],
  ])("refuses %s with invalid_input naming the field", (_label, body, subject) => {
    expect(() => validateCreateBody(body)).toThrow(expect.objectContaining({ code: "invalid_input", subject }));
  });

  it("checks fields in order: an extra key, then name, then levelName, then parentId", () => {
    expect(() => validateCreateBody({ name: "", levelName: "", parentId: null, x: 1 })).toThrow(
      expect.objectContaining({ subject: "x" }),
    );
    expect(() => validateCreateBody({ name: "", levelName: "", parentId: null })).toThrow(
      expect.objectContaining({ subject: "name" }),
    );
    expect(() => validateCreateBody({ name: "a", levelName: "", parentId: null })).toThrow(
      expect.objectContaining({ subject: "levelName" }),
    );
  });
});

describe("validateParentBody", () => {
  it("accepts exactly { parentId }", () => {
    expect(validateParentBody({ parentId: PARENT })).toEqual({ parentId: PARENT });
  });

  it.each([
    ["a missing parent", {}, "parentId"],
    ["a null parent", { parentId: null }, "parentId"],
    ["a malformed parent", { parentId: "nope" }, "parentId"],
    ["an extra key", { parentId: PARENT, name: "x" }, "name"],
    ["a non-object", "x", "body"],
  ])("refuses %s", (_label, body, subject) => {
    expect(() => validateParentBody(body)).toThrow(expect.objectContaining({ code: "invalid_input", subject }));
  });
});
