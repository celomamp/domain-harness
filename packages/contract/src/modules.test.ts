import { describe, expect, it } from "vitest";
import {
  isModuleInfo,
  isModuleKind,
  isModuleList,
  isModuleName,
  MODULE_API_PATHS,
  MODULE_KIND_LABELS,
  MODULE_KINDS,
  MODULE_NAME_MAX,
  MODULE_NAME_TAKEN,
  MODULE_NOT_FOUND,
  moduleOwnerPath,
  normalizeModuleName,
  ROLE_DENIED,
} from "./index.ts";

const MODULE = "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e5f6";
const OWNER = "01928c7e-5b2a-7c3d-9e4f-a1b2c3d4e5f7";
const BUYER = "01928c7e-5b2a-7c3d-ae4f-a1b2c3d4e5f8";
const AT = "2026-10-11T09:00:00.000Z";

const unowned = { id: MODULE, kind: "code-stack", name: "Code stack", owner: null, createdAt: AT };
const owned = {
  ...unowned,
  owner: { accountId: OWNER, name: "Sam", assignedAt: AT, assignedBy: { accountId: BUYER, name: "Bea" } },
};

describe("Module wire contract", () => {
  it("offers exactly the two kinds, with lowercase labels", () => {
    expect(MODULE_KINDS).toEqual(["code-stack", "design-system"]);
    expect(MODULE_KIND_LABELS).toEqual({ "code-stack": "code stack", "design-system": "design system" });
  });

  it("names the paths and error codes once", () => {
    expect(MODULE_API_PATHS).toEqual({ modules: "/v1/modules" });
    expect(moduleOwnerPath(MODULE)).toBe(`/v1/modules/${MODULE}/owner`);
    expect(moduleOwnerPath("a/b")).toBe("/v1/modules/a%2Fb/owner");
    expect([ROLE_DENIED, MODULE_NOT_FOUND, MODULE_NAME_TAKEN]).toEqual([
      "role_denied",
      "module_not_found",
      "module_name_taken",
    ]);
  });

  it.each([["code-stack"], ["design-system"]])("accepts the kind %j", (kind) => {
    expect(isModuleKind(kind)).toBe(true);
  });

  it.each([["brand"], ["Code-stack"], ["code stack"], [""], [undefined], [1]])("rejects the kind %j", (kind) => {
    expect(isModuleKind(kind)).toBe(false);
  });

  it("accepts a name of 1 to 120 characters once trimmed", () => {
    expect(MODULE_NAME_MAX).toBe(120);
    expect(isModuleName(" Code stack ")).toBe(true);
    expect(isModuleName("x")).toBe(true);
    expect(isModuleName("x".repeat(120))).toBe(true);
    expect(isModuleName(` ${"x".repeat(120)} `)).toBe(true);
    expect(normalizeModuleName(" Code stack ")).toBe("Code stack");
  });

  it.each([[""], ["   "], ["x".repeat(121)], [undefined], [null], [7]])("rejects the name %j", (name) => {
    expect(isModuleName(name)).toBe(false);
  });

  it("accepts an ownerless and an owned Module", () => {
    expect(isModuleInfo(unowned)).toBe(true);
    expect(isModuleInfo(owned)).toBe(true);
  });

  it.each([
    ["a non-v7 id", { ...unowned, id: "3f2b8c1e-9d4a-4b6e-8f7a-1c2d3e4f5a6b" }],
    ["an unknown kind", { ...unowned, kind: "brand" }],
    ["a missing owner", { id: MODULE, kind: "code-stack", name: "x", createdAt: AT }],
    ["a non-UTC timestamp", { ...unowned, createdAt: "2026-10-11T09:00:00+02:00" }],
    ["an owner without assignedBy", { ...unowned, owner: { accountId: OWNER, name: "Sam", assignedAt: AT } }],
    ["null", null],
  ])("rejects a Module with %s", (_label, value) => {
    expect(isModuleInfo(value)).toBe(false);
  });

  it("accepts a list and rejects a malformed one", () => {
    expect(isModuleList({ modules: [unowned, owned], standardOwners: [{ accountId: OWNER, name: "Sam" }] })).toBe(true);
    expect(isModuleList({ modules: [], standardOwners: [] })).toBe(true);
    expect(isModuleList({ modules: [{ ...unowned, kind: "x" }], standardOwners: [] })).toBe(false);
    expect(isModuleList({ modules: [] })).toBe(false);
    expect(isModuleList({ modules: [], standardOwners: [{ accountId: "x", name: "Sam" }] })).toBe(false);
  });
});
