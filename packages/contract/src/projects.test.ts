import { describe, expect, it } from "vitest";
import {
  isProjectInfo,
  isProjectTree,
  LEVEL_NAME_MAX,
  PROJECT_API_PATHS,
  PROJECT_CYCLE,
  PROJECT_NAME_MAX,
  PROJECT_NOT_FOUND,
  projectParentPath,
  projectPath,
  ROOT_PROJECT_FIXED,
} from "./index.ts";

const ROOT = "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e5f6";
const CHILD = "01928c7e-5b2a-7c3d-9e4f-a1b2c3d4e5f7";
const AT = "2026-10-12T09:00:00.000Z";

const root = { id: ROOT, name: "Acme", levelName: null, parentId: null, createdAt: AT };
const child = { id: CHILD, name: "Web", levelName: "  Product line ", parentId: ROOT, createdAt: AT };

describe("Project tree wire contract", () => {
  it("names the limits, paths and error codes once", () => {
    expect([PROJECT_NAME_MAX, LEVEL_NAME_MAX]).toEqual([200, 200]);
    expect(PROJECT_API_PATHS).toEqual({ projects: "/v1/projects" });
    expect(projectPath(ROOT)).toBe(`/v1/projects/${ROOT}`);
    expect(projectParentPath(ROOT)).toBe(`/v1/projects/${ROOT}/parent`);
    expect(projectParentPath("a/b")).toBe("/v1/projects/a%2Fb/parent");
    expect([PROJECT_NOT_FOUND, PROJECT_CYCLE, ROOT_PROJECT_FIXED]).toEqual([
      "project_not_found",
      "project_cycle",
      "root_project_fixed",
    ]);
  });

  it("accepts the root and a child Project, the level name as typed", () => {
    expect(isProjectInfo(root)).toBe(true);
    expect(isProjectInfo(child)).toBe(true);
  });

  it.each([
    ["a non-v7 id", { ...child, id: "3f2b8c1e-9d4a-4b6e-8f7a-1c2d3e4f5a6b" }],
    ["a missing level name", { id: CHILD, name: "Web", parentId: ROOT, createdAt: AT }],
    ["a numeric level name", { ...child, levelName: 7 }],
    ["a malformed parent", { ...child, parentId: "root" }],
    ["a non-UTC time", { ...child, createdAt: "2026-10-12T09:00:00+02:00" }],
    ["null", null],
  ])("rejects a Project with %s", (_label, value) => {
    expect(isProjectInfo(value)).toBe(false);
  });

  it("accepts a tree whose listed root is the only parentless Project", () => {
    expect(isProjectTree({ rootId: ROOT, projects: [root, child] })).toBe(true);
  });

  it.each([
    ["no root listed", { rootId: ROOT, projects: [child] }],
    ["another root id", { rootId: CHILD, projects: [root, child] }],
    ["two roots", { rootId: ROOT, projects: [root, { ...child, parentId: null }] }],
    ["a bad Project", { rootId: ROOT, projects: [root, { ...child, name: 1 }] }],
    ["no projects array", { rootId: ROOT }],
  ])("rejects a tree with %s", (_label, value) => {
    expect(isProjectTree(value)).toBe(false);
  });
});
