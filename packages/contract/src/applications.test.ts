import { describe, expect, it } from "vitest";
import {
  APPLICATION_API_PATHS,
  APPLICATION_DESCRIPTION_MAX,
  applicationEvidencePath,
  COMPILATION_CATALOG_VERSION,
  isApplicationEvidence,
  isApplicationInfo,
  isApplicationList,
} from "./index.ts";

const APP = "01928c7e-5b2a-7c3d-ae4f-a1b2c3d4e5f7";
const PROJECT = "01928c7e-5b2a-7c3d-ae4f-a1b2c3d4e5f8";
const AT = "2026-10-13T09:00:00.000Z";

const app = {
  id: APP,
  description: "Checkout service",
  project: { id: PROJECT, name: "Acme" },
  fromFlow: true,
  agentTool: null,
  createdAt: AT,
};

describe("Application wire contract", () => {
  it("names the paths and the limit once", () => {
    expect(APPLICATION_API_PATHS.applications).toBe("/v1/applications");
    expect(APPLICATION_API_PATHS.registered).toBe("/v1/applications/registered");
    expect(APPLICATION_DESCRIPTION_MAX).toBe(500);
  });

  it("accepts an Application and a list", () => {
    expect(isApplicationInfo(app)).toBe(true);
    expect(isApplicationInfo({ ...app, fromFlow: false })).toBe(true);
    expect(isApplicationInfo({ ...app, agentTool: "cursor" })).toBe(true);
    expect(isApplicationInfo({ ...app, agentTool: "claude-code" })).toBe(true);
    expect(isApplicationList({ applications: [app] })).toBe(true);
    expect(isApplicationList({ applications: [] })).toBe(true);
  });

  it.each([
    ["a bad id", { ...app, id: "a" }],
    ["a missing description", { ...app, description: undefined }],
    ["a bad Project", { ...app, project: { id: "p", name: "Acme" } }],
    ["a string flag", { ...app, fromFlow: "yes" }],
    ["a missing agent tool", { ...app, agentTool: undefined }],
    ["an unknown agent tool", { ...app, agentTool: "windsurf" }],
    ["a non-UTC time", { ...app, createdAt: "2026-10-13T09:00:00+02:00" }],
    ["null", null],
  ])("rejects an Application with %s", (_label, value) => {
    expect(isApplicationInfo(value)).toBe(false);
  });

  it.each([
    ["a bad entry", { applications: [{}] }],
    ["no list", {}],
    ["an array", []],
  ])("rejects a list with %s", (_label, value) => {
    expect(isApplicationList(value)).toBe(false);
  });
});

const KEY = "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e601";

const guidance = {
  type: "guidance",
  schemaVersion: "1.0.0",
  catalogVersion: COMPILATION_CATALOG_VERSION,
  idempotencyKey: KEY,
  applicationId: APP,
  agentToolName: "claude-code",
  occurredAt: AT,
  sequence: 1,
  tool: "code_stack_rule",
  outcome: "hit",
  subject: { kind: "slot-token", slotToken: "code-stack/library/React" },
};

describe("Application evidence wire contract", () => {
  it("names the evidence path for one Application", () => {
    expect(applicationEvidencePath(APP)).toBe(`/v1/applications/${APP}/evidence`);
  });

  it("accepts evidence with the Application and its Compilations", () => {
    expect(isApplicationEvidence({ application: app, compilations: [guidance] })).toBe(true);
    expect(isApplicationEvidence({ application: app, compilations: [] })).toBe(true);
  });

  it.each([
    ["an extra key", { application: app, compilations: [], extra: 1 }],
    ["a missing Application", { compilations: [] }],
    ["a missing list", { application: app }],
    ["a bad Application", { application: {}, compilations: [] }],
    ["a non-Compilation entry", { application: app, compilations: [{}] }],
    ["a non-list", { application: app, compilations: {} }],
    ["null", null],
  ])("rejects evidence with %s", (_label, value) => {
    expect(isApplicationEvidence(value)).toBe(false);
  });
});
