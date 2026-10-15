#!/usr/bin/env node
/**
 * Offline CLI entry (Story 8.1): `domain-harness bundle verify`.
 *
 * Reads a bundle file and a trust-keys file from command paths, verifies
 * offline via `loadBundleFile`, prints exactly one line, and exits with the
 * outcome's code. No network calls. Plain argv parsing with no new
 * dependencies.
 *
 * Success line: `bundle verified <hash> <sequence>` (exit 0). Failures print
 * exactly the shared gate sentence (`bundle verification failed` or
 * `bundle stale`, exit 1). Usage defects fail closed with the
 * verification-failed sentence; no plan names ever appear in output.
 */
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { BUNDLE_VERIFICATION_FAILED } from "@domain-harness/gate";
import { loadBundleFile } from "./bundle-file.ts";

export interface VerifyCommandOptions {
  readonly bundlePath: string;
  readonly trustKeysPath: string;
  readonly tenantId: string;
  readonly statePath: string;
  readonly now: string;
}

export interface CliRunResult {
  readonly exitCode: number;
  readonly line: string;
}

/** Success line carrying the verified hash and sequence. */
export function formatSuccessLine(hash: string, sequence: number): string {
  return `bundle verified ${hash} ${String(sequence)}`;
}

/** Default last-seen state under the user cache dir (never the working tree). */
export function defaultStatePath(): string {
  const xdg = process.env["XDG_CACHE_HOME"]?.trim();
  if (xdg !== undefined && xdg !== "" && isAbsolute(xdg)) {
    return join(xdg, "domain-harness", "bundle-state.json");
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Caches", "domain-harness", "bundle-state.json");
  }
  if (process.platform === "win32") {
    const local = process.env["LOCALAPPDATA"]?.trim();
    if (local !== undefined && local !== "") return join(local, "domain-harness", "bundle-state.json");
  }
  return join(homedir(), ".cache", "domain-harness", "bundle-state.json");
}

function takeValue(args: readonly string[], index: number): string | null {
  const value = args[index];
  if (value === undefined || value === "") return null;
  if (value.startsWith("-")) return null;
  return value;
}

/**
 * Parse `bundle verify` argv (the words after the binary name). Returns the
 * resolved options with defaults applied, or null on any usage defect.
 * Never throws.
 */
export function parseVerifyArgs(argv: readonly string[]): VerifyCommandOptions | null {
  try {
    if (argv.length < 2) return null;
    if (argv[0] !== "bundle" || argv[1] !== "verify") return null;
    const rest = argv.slice(2);
    let bundlePath: string | null = null;
    let trustKeysPath: string | null = null;
    let tenantId: string | null = null;
    let statePath: string | null = null;
    let now: string | null = null;
    for (let i = 0; i < rest.length; i += 1) {
      const arg = rest[i];
      if (arg === undefined) return null;
      const eq = arg.indexOf("=");
      const flag = eq === -1 ? arg : arg.slice(0, eq);
      const inline = eq === -1 ? null : arg.slice(eq + 1);
      const next = (): string | null => {
        if (inline !== null) return inline === "" ? null : inline;
        return takeValue(rest, i + 1);
      };
      if (flag === "--bundle") {
        const value = next();
        if (value === null) return null;
        bundlePath = value;
        if (inline === null) i += 1;
      } else if (flag === "--trust-keys") {
        const value = next();
        if (value === null) return null;
        trustKeysPath = value;
        if (inline === null) i += 1;
      } else if (flag === "--tenant") {
        const value = next();
        if (value === null) return null;
        tenantId = value;
        if (inline === null) i += 1;
      } else if (flag === "--state") {
        const value = next();
        if (value === null) return null;
        statePath = value;
        if (inline === null) i += 1;
      } else if (flag === "--now") {
        const value = next();
        if (value === null) return null;
        now = value;
        if (inline === null) i += 1;
      } else {
        return null;
      }
    }
    if (bundlePath === null || trustKeysPath === null || tenantId === null) return null;
    if (now !== null && !Number.isFinite(Date.parse(now))) return null;
    return {
      bundlePath,
      trustKeysPath,
      tenantId,
      statePath: statePath ?? defaultStatePath(),
      now: now ?? new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Run the verify command against argv words. Never throws. Usage defects
 * fail closed with the verification-failed sentence.
 */
export function run(argv: readonly string[]): CliRunResult {
  try {
    const options = parseVerifyArgs(argv);
    if (options === null) {
      return { exitCode: 1, line: BUNDLE_VERIFICATION_FAILED };
    }
    const outcome = loadBundleFile({
      bundlePath: options.bundlePath,
      trustKeysPath: options.trustKeysPath,
      tenantId: options.tenantId,
      statePath: options.statePath,
      now: options.now,
    });
    if (outcome.ok) {
      return { exitCode: 0, line: formatSuccessLine(outcome.hash, outcome.sequence) };
    }
    return { exitCode: outcome.exitCode, line: outcome.sentence };
  } catch {
    return { exitCode: 1, line: BUNDLE_VERIFICATION_FAILED };
  }
}

/**
 * True when the process was invoked as this entry point. Accepts both posix
 * and Windows path separators so the binary never silently exits 0 without
 * verifying. Never throws.
 */
export function isCliEntryPoint(argv1: string | undefined): boolean {
  try {
    if (typeof argv1 !== "string" || argv1 === "") return false;
    return /(^|[/\\])cli\.(js|ts)$/.test(argv1);
  } catch {
    return false;
  }
}

function main(): void {
  try {
    const result = run(process.argv.slice(2));
    process.stdout.write(`${result.line}\n`);
    process.exit(result.exitCode);
  } catch {
    try {
      process.stdout.write(`${BUNDLE_VERIFICATION_FAILED}\n`);
    } catch {
      // Ignore stdout failures on the way out.
    }
    process.exit(1);
  }
}

if (isCliEntryPoint(process.argv[1])) {
  main();
}
