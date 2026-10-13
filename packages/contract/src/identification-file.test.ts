import { describe, expect, it } from "vitest";
import {
  APPLICATION_NOT_FOUND,
  applicationIdentificationFilePath,
  formatIdentificationFile,
  IDENTIFICATION_FILE_MAJOR,
  IDENTIFICATION_FILE_NAME,
  IDENTIFICATION_FILE_UNREADABLE,
  IDENTIFICATION_FILE_VERSION,
  isIdentificationFileRendering,
  isUuidV7,
  parseIdentificationFile,
} from "./index.ts";
import type { UuidV7 } from "./index.ts";

function id(value: string): UuidV7 {
  if (!isUuidV7(value)) throw new Error("not a UUIDv7");
  return value;
}

const APP = id("01928c7e-5b2a-7c3d-ae4f-a1b2c3d4e5f7");
const PROJECT = id("01928c7e-5b2a-7c3d-ae4f-a1b2c3d4e5f8");
const V4 = "0f8e2a4c-1b3d-4e5f-9a6b-7c8d9e0f1a2b";

const text = (value: unknown): string => JSON.stringify(value);
const valid = { version: "1.0.0", applicationId: APP, projectId: PROJECT };

function unreadableSubject(content: string): string {
  const result = parseIdentificationFile(content);
  if (result.kind !== "unreadable") throw new Error(`expected unreadable, got ${result.kind}`);
  expect(result.error.code).toBe(IDENTIFICATION_FILE_UNREADABLE);
  return result.error.subject;
}

describe("Project identification file contract", () => {
  it("names the file, versions, codes and path once", () => {
    expect(IDENTIFICATION_FILE_NAME).toBe(".domain-harness.json");
    expect(IDENTIFICATION_FILE_VERSION).toBe("1.0.0");
    expect(IDENTIFICATION_FILE_MAJOR).toBe(1);
    expect(IDENTIFICATION_FILE_UNREADABLE).toBe("identification_file_unreadable");
    expect(APPLICATION_NOT_FOUND).toBe("application_not_found");
    expect(applicationIdentificationFilePath(APP)).toBe(`/v1/applications/${APP}/identification-file`);
    expect(applicationIdentificationFilePath("a/b")).toBe("/v1/applications/a%2Fb/identification-file");
  });

  it("formats with a fixed key order, two-space indent and a trailing newline", () => {
    const content = formatIdentificationFile(APP, PROJECT);
    expect(content).toBe(`{\n  "version": "1.0.0",\n  "applicationId": "${APP}",\n  "projectId": "${PROJECT}"\n}\n`);
    expect(formatIdentificationFile(APP, PROJECT)).toBe(content);
    expect(content.endsWith("\n")).toBe(true);
  });

  it("round-trips through the parser", () => {
    expect(parseIdentificationFile(formatIdentificationFile(APP, PROJECT))).toEqual({
      kind: "parsed",
      file: { version: "1.0.0", applicationId: APP, projectId: PROJECT },
    });
  });

  it("parses a file saved with one leading UTF-8 BOM, but not two", () => {
    expect(parseIdentificationFile(`\uFEFF${formatIdentificationFile(APP, PROJECT)}`)).toEqual({
      kind: "parsed",
      file: { version: "1.0.0", applicationId: APP, projectId: PROJECT },
    });
    expect(unreadableSubject(`\uFEFF\uFEFF${formatIdentificationFile(APP, PROJECT)}`)).toBe("file");
  });

  it("answers missing for no file", () => {
    expect(parseIdentificationFile(null)).toEqual({ kind: "missing" });
  });

  it.each(["", "{", "[]", "null", "42", '"text"', "true"])("is unreadable (subject file) for %j", (content) => {
    expect(unreadableSubject(content)).toBe("file");
  });

  it.each([
    ["missing", { applicationId: APP, projectId: PROJECT }],
    ["a number", { ...valid, version: 1 }],
    ["two parts", { ...valid, version: "1.0" }],
    ["a leading zero", { ...valid, version: "01.0.0" }],
    ["a pre-release", { ...valid, version: "1.0.0-beta" }],
    ["build metadata", { ...valid, version: "1.0.0+build" }],
    ["a v prefix", { ...valid, version: "v1.0.0" }],
  ])("is unreadable (subject version) for a version that is %s", (_label, value) => {
    expect(unreadableSubject(text(value))).toBe("version");
  });

  it.each(["2.0.0", "0.9.0", "10.0.0"])("is unreadable for the unknown major of %s", (version) => {
    const result = parseIdentificationFile(text({ ...valid, version }));
    expect(result.kind).toBe("unreadable");
    if (result.kind !== "unreadable") return;
    expect(result.error).toEqual({
      code: IDENTIFICATION_FILE_UNREADABLE,
      subject: "version",
      message: `major version ${version.split(".")[0] ?? ""} is not supported; this reader supports major version 1`,
    });
  });

  it("parses a newer minor and patch of major 1 and drops extra keys", () => {
    expect(parseIdentificationFile(text({ ...valid, version: "1.3.7", tool: "cursor" }))).toEqual({
      kind: "parsed",
      file: { version: "1.3.7", applicationId: APP, projectId: PROJECT },
    });
  });

  it.each([
    ["applicationId", "missing", { version: "1.0.0", projectId: PROJECT }],
    ["applicationId", "uppercase", { ...valid, applicationId: APP.toUpperCase() }],
    ["applicationId", "a UUIDv4", { ...valid, applicationId: V4 }],
    ["projectId", "missing", { version: "1.0.0", applicationId: APP }],
    ["projectId", "not a string", { ...valid, projectId: 42 }],
    ["projectId", "a UUIDv4", { ...valid, projectId: V4 }],
  ])("is unreadable (subject %s) when it is %s", (subject, _label, value) => {
    expect(unreadableSubject(text(value))).toBe(subject);
  });

  it("checks the version before the ids, and the Application id before the Project id", () => {
    expect(unreadableSubject(text({ version: "2.0.0" }))).toBe("version");
    expect(unreadableSubject(text({ version: "1.0.0" }))).toBe("applicationId");
  });

  it("never echoes the file's content in a message", () => {
    const secret = "sk-secret-value";
    for (const content of [secret, text({ version: secret }), text({ ...valid, applicationId: secret })]) {
      const result = parseIdentificationFile(content);
      expect(result.kind).toBe("unreadable");
      if (result.kind === "unreadable") expect(result.error.message).not.toContain(secret);
    }
  });

  it("guards the rendering", () => {
    expect(isIdentificationFileRendering({ fileName: IDENTIFICATION_FILE_NAME, content: "{}\n" })).toBe(true);
    expect(isIdentificationFileRendering({ fileName: IDENTIFICATION_FILE_NAME })).toBe(false);
    expect(isIdentificationFileRendering({ fileName: 1, content: "" })).toBe(false);
    expect(isIdentificationFileRendering({ fileName: "package.json", content: "{}\n" })).toBe(false);
    expect(isIdentificationFileRendering(null)).toBe(false);
    expect(isIdentificationFileRendering([])).toBe(false);
  });
});
