import { describe, expect, it } from "vitest";
import {
  CODE_STACK_CATEGORIES,
  CODE_STACK_ENTRY_FIELDS,
  CODE_STACK_STATUSES,
  CORRECTION_INSTRUCTION_MAX,
  isCodeStackCategory,
  isCodeStackEntry,
  isCodeStackStatus,
  isStandardInfo,
  isStandardList,
  isStandardVersionList,
  MODULE_HAS_NO_OWNER,
  moduleStandardsPath,
  NOT_MODULE_OWNER,
  SLOT_CONFLICT,
  STANDARD_API_PATHS,
  STANDARD_NAME_MAX,
  STANDARD_NOT_FOUND,
  standardVersionsPath,
  VERSION_CONSTRAINT_MAX,
} from "./index.ts";

const STANDARD = "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e5f6";
const MODULE = "01928c7e-5b2a-7c3d-9e4f-a1b2c3d4e5f7";
const PROJECT = "01928c7e-5b2a-7c3d-ae4f-a1b2c3d4e5f8";
const OWNER = "01928c7e-5b2a-7c3d-be4f-a1b2c3d4e5f9";
const AT = "2026-10-11T09:00:00.000Z";

const entry = {
  category: "library",
  name: "React",
  versionConstraint: "^18",
  status: "approved",
  correctionInstruction: null,
};
const info = {
  id: STANDARD,
  version: 1,
  module: { id: MODULE, kind: "code-stack", name: "Code stack" },
  project: { id: PROJECT, name: "Acme" },
  entry,
  publishedAt: AT,
  publishedBy: { accountId: OWNER, name: "Sam Owner" },
};
const moduleInfo = { id: MODULE, kind: "code-stack", name: "Code stack", owner: null, createdAt: AT };

describe("Standards wire contract", () => {
  it("names the vocabulary and limits once", () => {
    expect(CODE_STACK_CATEGORIES).toEqual(["language", "framework", "library"]);
    expect(CODE_STACK_STATUSES).toEqual(["approved", "prohibited", "required"]);
    expect(CODE_STACK_ENTRY_FIELDS).toEqual(["category", "name", "versionConstraint", "status", "correctionInstruction"]);
    expect([STANDARD_NAME_MAX, VERSION_CONSTRAINT_MAX, CORRECTION_INSTRUCTION_MAX]).toEqual([200, 100, 1000]);
  });

  it("names the paths and error codes once", () => {
    expect(STANDARD_API_PATHS).toEqual({ standards: "/v1/standards" });
    expect(moduleStandardsPath(MODULE)).toBe(`/v1/modules/${MODULE}/standards`);
    expect(standardVersionsPath(STANDARD)).toBe(`/v1/standards/${STANDARD}/versions`);
    expect(standardVersionsPath("a/b")).toBe("/v1/standards/a%2Fb/versions");
    expect([STANDARD_NOT_FOUND, MODULE_HAS_NO_OWNER, NOT_MODULE_OWNER, SLOT_CONFLICT]).toEqual([
      "standard_not_found",
      "module_has_no_owner",
      "not_module_owner",
      "slot_conflict",
    ]);
  });

  it("guards categories and statuses exactly", () => {
    expect(CODE_STACK_CATEGORIES.every(isCodeStackCategory)).toBe(true);
    expect(CODE_STACK_STATUSES.every(isCodeStackStatus)).toBe(true);
    for (const bad of ["Library", "tool", "", undefined, 1]) {
      expect(isCodeStackCategory(bad)).toBe(false);
      expect(isCodeStackStatus(bad)).toBe(false);
    }
  });

  it("accepts a normalised entry and a Standard version", () => {
    expect(isCodeStackEntry(entry)).toBe(true);
    expect(isCodeStackEntry({ ...entry, versionConstraint: null, correctionInstruction: "Use React 18." })).toBe(true);
    expect(isStandardInfo(info)).toBe(true);
  });

  it.each([
    ["an extra key", { ...entry, owner: "x" }],
    ["a missing optional key", { category: "library", name: "React", status: "approved", correctionInstruction: null }],
    ["a bad category", { ...entry, category: "tool" }],
    ["a bad status", { ...entry, status: "allowed" }],
    ["a numeric constraint", { ...entry, versionConstraint: 18 }],
  ])("rejects an entry with %s", (_label, value) => {
    expect(isCodeStackEntry(value)).toBe(false);
  });

  it.each([
    ["version 0", { ...info, version: 0 }],
    ["a fractional version", { ...info, version: 1.5 }],
    ["a bad module kind", { ...info, module: { ...info.module, kind: "brand" } }],
    ["a non-UTC time", { ...info, publishedAt: "2026-10-11T09:00:00+02:00" }],
    ["a missing project", { ...info, project: undefined }],
    ["a bad publisher", { ...info, publishedBy: { accountId: "x", name: "Sam" } }],
  ])("rejects a Standard with %s", (_label, value) => {
    expect(isStandardInfo(value)).toBe(false);
  });

  it("guards the list and the version list", () => {
    expect(isStandardList({ module: moduleInfo, standards: [info] })).toBe(true);
    expect(isStandardList({ module: moduleInfo, standards: [] })).toBe(true);
    expect(isStandardList({ standards: [] })).toBe(false);
    expect(isStandardList({ module: moduleInfo, standards: [{ ...info, version: 0 }] })).toBe(false);
    expect(isStandardVersionList({ standardId: STANDARD, versions: [info, { ...info, version: 2 }] })).toBe(true);
    expect(isStandardVersionList({ standardId: "x", versions: [] })).toBe(false);
  });
});
