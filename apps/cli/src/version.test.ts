import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  BUNDLE_FORMAT_VERSION,
  EXTRACTOR_VERSION,
  FACT_SCHEMA_VERSION,
} from "@domain-harness/contract";
import { runCli } from "./cli.ts";
import {
  CLI_VERSION,
  formatHelpLine,
  formatVersionLine,
  isHelpArgs,
  isVersionArgs,
} from "./version.ts";

function cliManifest(): { version: string; private?: boolean; publishConfig?: { access?: string }; files?: string[]; bin?: Record<string, string> } {
  return JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
  };
}

function cliManifestVersion(): string {
  return cliManifest().version;
}

describe("cli distribution surface", () => {
  it("mirrors the package manifest version", () => {
    expect(CLI_VERSION).toBe(cliManifestVersion());
    expect(CLI_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("ships publishable one-command-install metadata", () => {
    const manifest = cliManifest();
    expect(manifest.private).toBeUndefined();
    expect(manifest.publishConfig?.access).toBe("public");
    expect(manifest.files).toContain("dist");
    expect(manifest.files).toContain("README.md");
    expect(manifest.bin?.["domain-harness"]).toBe("./dist/cli.js");
  });

  it("prints one version line carrying all four versions", () => {
    const expected =
      `domain-harness ${CLI_VERSION} (extractor ${EXTRACTOR_VERSION}, fact-schema ${FACT_SCHEMA_VERSION}, contract ${String(BUNDLE_FORMAT_VERSION)})`;
    expect(formatVersionLine()).toBe(expected);
    expect(formatVersionLine()).toContain(`domain-harness ${CLI_VERSION}`);
    expect(formatVersionLine()).toContain(`extractor ${EXTRACTOR_VERSION}`);
    expect(formatVersionLine()).toContain(`fact-schema ${FACT_SCHEMA_VERSION}`);
    expect(formatVersionLine()).toContain(`contract ${String(BUNDLE_FORMAT_VERSION)}`);
  });

  it("answers exact --version with exit 0 and no side effects", async () => {
    const result = await runCli(["--version"]);
    expect(result.exitCode).toBe(0);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toBe(formatVersionLine());
  });

  it("answers exact --help with exit 0 naming the commands", async () => {
    const result = await runCli(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toContain("bundle verify");
    expect(result.lines[0]).toContain("gate");
    expect(result.lines[0]).toContain("--version");
    expect(result.lines[0]).toBe(formatHelpLine());
  });

  it("matches only the exact single-flag shapes", () => {
    expect(isVersionArgs(["--version"])).toBe(true);
    expect(isVersionArgs(["--version", "extra"])).toBe(false);
    expect(isVersionArgs(["gate", "--version"])).toBe(false);
    expect(isVersionArgs([])).toBe(false);
    expect(isHelpArgs(["--help"])).toBe(true);
    expect(isHelpArgs(["--help", "extra"])).toBe(false);
    expect(isHelpArgs([])).toBe(false);
  });

  it("does not treat gate --version as a version answer", async () => {
    const result = await runCli(["gate", "--version"]);
    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual(["run did not complete"]);
  });

  it("does not treat --version with extra args as a version answer", async () => {
    const result = await runCli(["--version", "extra"]);
    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual(["bundle verification failed"]);
  });
});
