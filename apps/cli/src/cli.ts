#!/usr/bin/env node
/**
 * Offline CLI entry (Stories 8.1, 8.2): `domain-harness bundle verify` and
 * `domain-harness gate`.
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
 *
 * The gate path (`domain-harness gate ...`) reuses the verifier, adapts the
 * wire bundle through `core` exactly as the service does, and evaluates via
 * the shared `runGateDirect` adapter; its usage defects fail closed with
 * `run did not complete`.
 *
 * The one networked path is the hosted Gate (`domain-harness gate
 * --endpoint <url>`, see `gate-remote.ts`): it sends the revision's facts to
 * the Guidance server, which evaluates and records the run. Every other
 * command stays offline.
 */
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { BUNDLE_VERIFICATION_FAILED, RUN_DID_NOT_COMPLETE } from "@domain-harness/gate";
import { loadBundleFile } from "./bundle-file.ts";
import { runGateCommand } from "./gate.ts";
import { isRemoteGateArgs, runRemoteGateCommand } from "./gate-remote.ts";
import { formatHelpLine, formatVersionLine, isHelpArgs, isVersionArgs } from "./version.ts";

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
    if (ENTRY_FILE.test(argv1)) return true;
    // An installed `domain-harness` bin is a symlink to dist/cli.js.
    return ENTRY_FILE.test(realpathSync(argv1));
  } catch {
    return false;
  }
}

const ENTRY_FILE = /(^|[/\\])cli\.(js|ts)$/;

/** The dispatched CLI result: one line per printed row. */
export interface CliDispatchResult {
  readonly exitCode: number;
  readonly lines: readonly string[];
  /** Lines for stderr (the hosted Gate's transport diagnostics); absent for every other command. */
  readonly diagnostics?: readonly string[];
}

/**
 * Dispatch argv words to the version/help screens or the verify/gate
 * commands. Exact `--version`/`--help` answer exit 0 with no side effects;
 * the verify path is untouched (sync, one line); `gate ...` runs the offline
 * Gate — or, with `--endpoint`, the hosted Gate — and returns its sentence
 * plus one line per open Deviation. Never throws.
 */
export async function runCli(argv: readonly string[]): Promise<CliDispatchResult> {
  try {
    if (isVersionArgs(argv)) {
      return { exitCode: 0, lines: [formatVersionLine()] };
    }
    if (isHelpArgs(argv)) {
      return { exitCode: 0, lines: [formatHelpLine()] };
    }
    if (isRemoteGateArgs(argv)) {
      const gate = await runRemoteGateCommand(argv);
      return { exitCode: gate.exitCode, lines: [...gate.lines], ...(gate.diagnostics === undefined ? {} : { diagnostics: [...gate.diagnostics] }) };
    }
    if (argv.length >= 1 && argv[0] === "gate") {
      const gate = await runGateCommand(argv);
      return { exitCode: gate.exitCode, lines: [...gate.lines] };
    }
    const result = run(argv);
    return { exitCode: result.exitCode, lines: [result.line] };
  } catch {
    try {
      if (argv.length >= 1 && argv[0] === "gate") {
        return { exitCode: 1, lines: [RUN_DID_NOT_COMPLETE] };
      }
    } catch {
      // Ignore inspection failures on the way out.
    }
    return { exitCode: 1, lines: [BUNDLE_VERIFICATION_FAILED] };
  }
}

function main(): void {
  const argv = process.argv.slice(2);
  const gate = argv.length >= 1 && argv[0] === "gate";
  const fallback = gate ? RUN_DID_NOT_COMPLETE : BUNDLE_VERIFICATION_FAILED;
  // Routing and sentence mapping live in `runCli`; `main` only writes the
  // lines and exits. `runCli` never rejects, so the rejection handler is the
  // last-resort envelope keyed to the dispatched command.
  runCli(argv).then(
    (result) => {
      try {
        for (const line of result.lines) process.stdout.write(`${line}\n`);
        for (const line of result.diagnostics ?? []) process.stderr.write(`${line}\n`);
      } catch {
        // Ignore stdout failures on the way out.
      }
      process.exit(result.exitCode);
    },
    () => {
      try {
        process.stdout.write(`${fallback}\n`);
      } catch {
        // Ignore stdout failures on the way out.
      }
      process.exit(1);
    },
  );
}

if (isCliEntryPoint(process.argv[1])) {
  main();
}
