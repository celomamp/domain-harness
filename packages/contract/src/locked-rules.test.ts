import { describe, expect, it } from "vitest";
import { isLockedRuleMark, isLockedRuleState, LOCKED_RULE_CONFLICT, lockedRulePath } from "./index.ts";

const STANDARD = "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e5f6";
const MODULE = "01928c7e-5b2a-7c3d-9e4f-a1b2c3d4e5f7";
const PROJECT = "01928c7e-5b2a-7c3d-ae4f-a1b2c3d4e5f8";
const OWNER = "01928c7e-5b2a-7c3d-be4f-a1b2c3d4e5f9";
const BUYER = "01928c7e-5b2a-7c3d-be4f-a1b2c3d4e5fa";
const AT = "2026-10-12T09:00:00.000Z";

const standard = {
  id: STANDARD,
  version: 1,
  module: { id: MODULE, kind: "code-stack", name: "Code stack" },
  project: { id: PROJECT, name: "Acme" },
  entry: { category: "library", name: "X", versionConstraint: null, status: "prohibited", correctionInstruction: null },
  publishedAt: AT,
  publishedBy: { accountId: OWNER, name: "Sam Owner" },
};
const buyer = { accountId: BUYER, name: "Bea Buyer" };
const mark = { standardId: STANDARD, projectId: PROJECT, markedAt: AT, markedBy: buyer };

describe("Locked rule wire contract", () => {
  it("names the path and error code once", () => {
    expect(lockedRulePath(STANDARD)).toBe(`/v1/standards/${STANDARD}/locked-rule`);
    expect(lockedRulePath("a/b")).toBe("/v1/standards/a%2Fb/locked-rule");
    expect(LOCKED_RULE_CONFLICT).toBe("locked_rule_conflict");
  });

  it("accepts a mark", () => {
    expect(isLockedRuleMark(mark)).toBe(true);
  });

  it.each([
    ["a malformed Standard id", { ...mark, standardId: "s" }],
    ["a malformed Project id", { ...mark, projectId: "p" }],
    ["a non-UTC time", { ...mark, markedAt: "2026-10-12T09:00:00+02:00" }],
    ["a missing marker", { standardId: STANDARD, projectId: PROJECT, markedAt: AT }],
    ["null", null],
  ])("rejects a mark with %s", (_label, value) => {
    expect(isLockedRuleMark(value)).toBe(false);
  });

  it("accepts a marked, an unmarked and a never-marked state", () => {
    expect(isLockedRuleState({ standard, locked: true, changedAt: AT, changedBy: buyer })).toBe(true);
    expect(isLockedRuleState({ standard, locked: false, changedAt: AT, changedBy: buyer })).toBe(true);
    expect(isLockedRuleState({ standard, locked: false, changedAt: null, changedBy: null })).toBe(true);
  });

  it.each([
    ["a locked state with no row", { standard, locked: true, changedAt: null, changedBy: null }],
    ["a time without a Buyer", { standard, locked: true, changedAt: AT, changedBy: null }],
    ["a string flag", { standard, locked: "yes", changedAt: AT, changedBy: buyer }],
    ["a bad Standard", { standard: { ...standard, version: 0 }, locked: true, changedAt: AT, changedBy: buyer }],
    ["an array", []],
  ])("rejects a state with %s", (_label, value) => {
    expect(isLockedRuleState(value)).toBe(false);
  });
});
