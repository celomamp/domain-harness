import { describe, expect, it } from "vitest";
import {
  BUILD_GRANT_DENIED,
  buildGrantsPath,
  isBuildGrant,
  isBuildGrantList,
  isBuildGrantState,
} from "./index.ts";

const PROJECT = "01928c7e-5b2a-7c3d-ae4f-a1b2c3d4e5f8";
const BUILDER = "01928c7e-5b2a-7c3d-be4f-a1b2c3d4e5f9";
const BUYER = "01928c7e-5b2a-7c3d-be4f-a1b2c3d4e5fa";
const AT = "2026-10-12T09:00:00.000Z";

const project = { id: PROJECT, name: "Acme" };
const builder = { accountId: BUILDER, name: "Bo Builder", role: "Builder" };
const buyer = { accountId: BUYER, name: "Bea Buyer" };
const grant = { account: builder, grantedAt: AT, grantedBy: buyer };

describe("build grant wire contract", () => {
  it("names the path and error code once", () => {
    expect(buildGrantsPath(PROJECT)).toBe(`/v1/projects/${PROJECT}/build-grants`);
    expect(buildGrantsPath("a/b")).toBe("/v1/projects/a%2Fb/build-grants");
    expect(BUILD_GRANT_DENIED).toBe("build_grant_denied");
  });

  it("accepts a grant and a list", () => {
    expect(isBuildGrant(grant)).toBe(true);
    expect(isBuildGrantList({ project, grants: [grant], eligibleAccounts: [builder] })).toBe(true);
    expect(isBuildGrantList({ project, grants: [], eligibleAccounts: [] })).toBe(true);
  });

  it.each([
    ["an unknown role", { ...grant, account: { ...builder, role: "Admin" } }],
    ["a missing role", { ...grant, account: buyer }],
    ["a non-UTC time", { ...grant, grantedAt: "2026-10-12T09:00:00+02:00" }],
    ["a missing granter", { account: builder, grantedAt: AT }],
    ["null", null],
  ])("rejects a grant with %s", (_label, value) => {
    expect(isBuildGrant(value)).toBe(false);
  });

  it.each([
    ["a bad Project", { project: { id: "p", name: "Acme" }, grants: [], eligibleAccounts: [] }],
    ["a bad grant", { project, grants: [{}], eligibleAccounts: [] }],
    ["a bad eligible account", { project, grants: [], eligibleAccounts: [buyer] }],
    ["missing lists", { project }],
  ])("rejects a list with %s", (_label, value) => {
    expect(isBuildGrantList(value)).toBe(false);
  });

  it("accepts a granted, a revoked and a never-granted state", () => {
    expect(isBuildGrantState({ project, account: builder, granted: true, changedAt: AT, changedBy: buyer })).toBe(true);
    expect(isBuildGrantState({ project, account: builder, granted: false, changedAt: AT, changedBy: buyer })).toBe(
      true,
    );
    expect(isBuildGrantState({ project, account: builder, granted: false, changedAt: null, changedBy: null })).toBe(
      true,
    );
  });

  it.each([
    ["a granted state with no row", { project, account: builder, granted: true, changedAt: null, changedBy: null }],
    ["a time without a Buyer", { project, account: builder, granted: true, changedAt: AT, changedBy: null }],
    ["a string flag", { project, account: builder, granted: "yes", changedAt: AT, changedBy: buyer }],
    ["an account without a role", { project, account: buyer, granted: true, changedAt: AT, changedBy: buyer }],
    ["an array", []],
  ])("rejects a state with %s", (_label, value) => {
    expect(isBuildGrantState(value)).toBe(false);
  });
});
