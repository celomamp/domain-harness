import { describe, expect, it } from "vitest";
import { effectiveStandardsPath, isEffectiveStandard, isEffectiveStandardSet } from "./index.ts";

const STANDARD = "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e5f6";
const MODULE = "01928c7e-5b2a-7c3d-9e4f-a1b2c3d4e5f7";
const PROJECT = "01928c7e-5b2a-7c3d-ae4f-a1b2c3d4e5f8";
const OWNER = "01928c7e-5b2a-7c3d-be4f-a1b2c3d4e5f9";
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
const component = {
  ...entry,
  slot: { moduleKind: "design-system", slotKind: "component", name: "Button" },
  status: null,
  standard: {
    ...standard,
    module: { id: MODULE, kind: "design-system", name: "Design" },
    entry: { kind: "component", name: "Button", usageRule: "Use it", tokens: [], correctionInstruction: null },
  },
};

describe("Effective Standard set wire contract", () => {
  it("names the path once", () => {
    expect(effectiveStandardsPath(PROJECT)).toBe(`/v1/projects/${PROJECT}/effective-standards`);
    expect(effectiveStandardsPath("a/b")).toBe("/v1/projects/a%2Fb/effective-standards");
  });

  it("accepts an entry with a status, a component with none, and a set", () => {
    expect(isEffectiveStandard(entry)).toBe(true);
    expect(isEffectiveStandard(component)).toBe(true);
    expect(isEffectiveStandardSet({ project: { id: PROJECT, name: "Acme" }, standards: [entry, component] })).toBe(true);
    expect(isEffectiveStandardSet({ project: { id: PROJECT, name: "Acme" }, standards: [] })).toBe(true);
  });

  it.each([
    ["an unknown Module kind", { ...entry, slot: { ...entry.slot, moduleKind: "x" } }],
    ["an unknown status", { ...entry, status: "maybe" }],
    ["a missing status", { slot: entry.slot, standard, sourceProject: entry.sourceProject, locked: false }],
    ["a bad Standard", { ...entry, standard: { ...standard, version: 0 } }],
    ["a bad source Project", { ...entry, sourceProject: { id: "p", name: "Acme" } }],
    ["a non-boolean lock", { ...entry, locked: "no" }],
    ["null", null],
  ])("rejects an entry with %s", (_label, value) => {
    expect(isEffectiveStandard(value)).toBe(false);
  });

  it.each([
    ["no Project", { standards: [] }],
    ["no standards array", { project: { id: PROJECT, name: "Acme" } }],
    ["a bad entry", { project: { id: PROJECT, name: "Acme" }, standards: [{ ...entry, locked: 1 }] }],
  ])("rejects a set with %s", (_label, value) => {
    expect(isEffectiveStandardSet(value)).toBe(false);
  });
});
