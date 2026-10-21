/**
 * Offline Gate command (Story 8.2): `domain-harness gate`.
 *
 * Reuses 8.1's verifier on the bundle file, adapts the verified wire bundle
 * into a Gate snapshot (resolving the Effective Standard set through `core`
 * exactly as the service does), reads the identification file, computes the
 * repository fingerprint, collects tracked revision files, runs the shared
 * `runGateDirect` adapter from `@domain-harness/gate` against a local
 * binding file, prints the sentence plus one line per open Deviation, and
 * exits like the CI step.
 *
 * Order: usage parse → verify (8.1 guards stay in front) → ident →
 * fingerprint → tracked files → adapt → `runGateDirect` with the
 * unreadable-override rule (disk-unreadable rows override pass/fail only;
 * earlier refusals keep CI precedence). The working tree and HEAD are never
 * modified; state writes go to explicit paths defaulting under the user
 * cache dir, never the revision. No network calls. Never throws.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import {
  IDENTIFICATION_FILE_NAME,
  parseIdentificationFile,
} from "@domain-harness/contract";
import {
  MISSING_IDENTIFICATION_FILE,
  RUN_DID_NOT_COMPLETE,
  UNBOUND,
  runGateDirect,
} from "@domain-harness/gate";
import type { BindingLedger } from "@domain-harness/gate";
import { loadBundleFile } from "./bundle-file.ts";
import { createFileBindingLedger } from "./binding-file.ts";
import { adaptWireBundleToSnapshot } from "./gate-snapshot.ts";

/** Options of `domain-harness gate`. */
export interface GateCommandOptions {
  readonly bundlePath: string;
  readonly trustKeysPath: string;
  readonly tenantId: string;
  /** Revision root; defaults to the current directory. */
  readonly root: string;
  readonly bindingPath: string;
  readonly statePath: string;
  /** Run-clock ISO string. */
  readonly now: string;
}

/** The command result: the sentence first, then one line per open Deviation. */
export interface GateCommandResult {
  readonly exitCode: number;
  readonly lines: readonly string[];
  /** Hosted mode only: one stderr line saying why a run did not complete (never a secret). */
  readonly diagnostics?: readonly string[];
}

/** Optional seams for tests (a failing git is otherwise hard to stage). */
export interface GateCommandDeps {
  readonly collectRevisionFiles?: (
    root: string,
  ) => CollectRevisionOutcome;
  readonly createLedger?: (bindingPath: string) => BindingLedger;
}

/** Outcome of {@link collectRevisionFiles}. Never throws. */
export type CollectRevisionOutcome =
  | {
      readonly ok: true;
      readonly applicationId: string;
      /** The identification file's advisory Project id (the hosted Gate sends it like the bridge). */
      readonly advisoryProjectId?: string;
      readonly fingerprint: string;
      readonly files: Record<string, string>;
      readonly unreadable: ReadonlyArray<{ path: string; reason: string }>;
    }
  | {
      readonly ok: false;
      readonly sentence: string;
      readonly exitCode: 1;
    };

/** Default last-seen state under the user cache dir (never the working tree). */
export function defaultGateStatePath(): string {
  try {
    const xdg = process.env["XDG_CACHE_HOME"]?.trim();
    if (xdg !== undefined && xdg !== "" && isAbsolute(xdg)) {
      return join(xdg, "domain-harness", "bundle-state.json");
    }
    if (process.platform === "darwin") {
      return join(
        homedir(),
        "Library",
        "Caches",
        "domain-harness",
        "bundle-state.json",
      );
    }
    if (process.platform === "win32") {
      const local = process.env["LOCALAPPDATA"]?.trim();
      if (local !== undefined && local !== "")
        return join(local, "domain-harness", "bundle-state.json");
    }
    return join(homedir(), ".cache", "domain-harness", "bundle-state.json");
  } catch {
    return join(homedir(), ".cache", "domain-harness", "bundle-state.json");
  }
}

/** Default binding file beside the state default (never the revision). */
export function defaultBindingPath(): string {
  try {
    return join(dirname(defaultGateStatePath()), "binding.json");
  } catch {
    return join(homedir(), ".cache", "domain-harness", "binding.json");
  }
}

function takeValue(args: readonly string[], index: number): string | null {
  try {
    const value = args[index];
    if (value === undefined || value === "") return null;
    if (value.startsWith("-")) return null;
    return value;
  } catch {
    return null;
  }
}

/**
 * Parse `gate` argv (the words after the binary name). Returns the resolved
 * options with defaults applied, or null on any usage defect. Never throws.
 * Same style as `parseVerifyArgs`: last-wins, `=` forms, `Date.parse` clock
 * check.
 */
export function parseGateArgs(
  argv: readonly string[],
): GateCommandOptions | null {
  try {
    if (argv.length < 1) return null;
    if (argv[0] !== "gate") return null;
    const rest = argv.slice(1);
    let bundlePath: string | null = null;
    let trustKeysPath: string | null = null;
    let tenantId: string | null = null;
    let root: string | null = null;
    let bindingPath: string | null = null;
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
      } else if (flag === "--root") {
        const value = next();
        if (value === null) return null;
        root = value;
        if (inline === null) i += 1;
      } else if (flag === "--binding") {
        const value = next();
        if (value === null) return null;
        bindingPath = value;
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
    if (bundlePath === null || trustKeysPath === null || tenantId === null) {
      return null;
    }
    const clock = now ?? new Date().toISOString();
    if (!Number.isFinite(Date.parse(clock))) return null;
    let resolvedRoot: string;
    try {
      resolvedRoot = root ?? process.cwd();
    } catch {
      return null;
    }
    if (typeof resolvedRoot !== "string" || resolvedRoot === "") return null;
    return {
      bundlePath,
      trustKeysPath,
      tenantId,
      root: resolvedRoot,
      bindingPath: bindingPath ?? defaultBindingPath(),
      statePath: statePath ?? defaultGateStatePath(),
      now: clock,
    };
  } catch {
    return null;
  }
}

/**
 * Repository fingerprint: SHA-256 hex of the root-commit SHA (one git call).
 * No commit (or any git failure) is unbound. Never throws. Re-implements
 * the service fingerprint locally; cross-app imports are forbidden.
 */
export function computeLocalFingerprint(
  root: string,
): { readonly ok: true; readonly fingerprint: string } | { readonly ok: false } {
  try {
    const output = execFileSync("git", ["rev-list", "--max-parents=0", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const sha = output.trim().split(/\r?\n/)[0]?.trim() ?? "";
    if (sha === "") return { ok: false };
    const fingerprint = createHash("sha256").update(sha).digest("hex");
    if (typeof fingerprint !== "string" || fingerprint === "") {
      return { ok: false };
    }
    return { ok: true, fingerprint };
  } catch {
    return { ok: false };
  }
}

/**
 * Collect the revision under `root`: identification file, fingerprint,
 * `git ls-files -z` tracked files read as UTF-8 (unreadable files become
 * `{ path, reason }` rows). Never throws. A `git` failure that is not the
 * no-commit case yields `run did not complete`; the no-commit case yields
 * `unbound Application` (CI entry order).
 */
export function collectRevisionFiles(root: string): CollectRevisionOutcome {
  try {
    if (typeof root !== "string" || root === "") {
      return { ok: false, sentence: RUN_DID_NOT_COMPLETE, exitCode: 1 };
    }

    const identPath = join(root, IDENTIFICATION_FILE_NAME);
    let content: string | null;
    if (!existsSync(identPath)) {
      content = null;
    } else {
      try {
        content = readFileSync(identPath, "utf8");
      } catch {
        return {
          ok: false,
          sentence: MISSING_IDENTIFICATION_FILE,
          exitCode: 1,
        };
      }
    }
    const parsed = parseIdentificationFile(content);
    if (parsed.kind === "missing" || parsed.kind === "unreadable") {
      return { ok: false, sentence: MISSING_IDENTIFICATION_FILE, exitCode: 1 };
    }
    const applicationId = parsed.file.applicationId;

    const fp = computeLocalFingerprint(root);
    if (!fp.ok) {
      return { ok: false, sentence: UNBOUND, exitCode: 1 };
    }

    let tracked: string[];
    try {
      tracked = execFileSync("git", ["ls-files", "-z"], {
        cwd: root,
        encoding: "utf8",
      })
        .split("\0")
        .filter((p) => p !== "");
    } catch {
      return { ok: false, sentence: RUN_DID_NOT_COMPLETE, exitCode: 1 };
    }

    const files: Record<string, string> = {};
    const unreadable: Array<{ path: string; reason: string }> = [];
    for (const relative of tracked) {
      const absolute = join(root, relative);
      try {
        files[relative] = readFileSync(absolute, "utf8");
      } catch {
        unreadable.push({ path: relative, reason: "could not read file" });
      }
    }
    return {
      ok: true,
      applicationId: String(applicationId),
      advisoryProjectId: String(parsed.file.projectId),
      fingerprint: fp.fingerprint,
      files,
      unreadable,
    };
  } catch {
    return { ok: false, sentence: RUN_DID_NOT_COMPLETE, exitCode: 1 };
  }
}

/**
 * Run the gate command against argv words. Never throws. Usage defects fail
 * closed with `run did not complete` and write nothing; verification
 * failures print the 8.1 sentence; every other refusal prints its shared
 * sentence; pass/fail prints the sentence then one line per open Deviation.
 */
export async function runGateCommand(
  argv: readonly string[],
  deps?: GateCommandDeps,
): Promise<GateCommandResult> {
  try {
    const options = parseGateArgs(argv);
    if (options === null) {
      return { exitCode: 1, lines: [RUN_DID_NOT_COMPLETE] };
    }

    const verified = loadBundleFile({
      bundlePath: options.bundlePath,
      trustKeysPath: options.trustKeysPath,
      tenantId: options.tenantId,
      statePath: options.statePath,
      now: options.now,
    });
    if (!verified.ok) {
      return { exitCode: verified.exitCode, lines: [verified.sentence] };
    }

    const collect = deps?.collectRevisionFiles ?? collectRevisionFiles;
    let collected: CollectRevisionOutcome;
    try {
      collected = collect(options.root);
    } catch {
      return { exitCode: 1, lines: [RUN_DID_NOT_COMPLETE] };
    }
    if (!collected.ok) {
      return { exitCode: collected.exitCode, lines: [collected.sentence] };
    }

    const adapted = adaptWireBundleToSnapshot({
      signed: verified.signed,
      hash: verified.hash,
      applicationId: collected.applicationId,
      now: options.now,
    });
    if (!adapted.ok) {
      return { exitCode: adapted.exitCode, lines: [adapted.sentence] };
    }

    let ledger: BindingLedger;
    try {
      ledger = deps?.createLedger
        ? deps.createLedger(options.bindingPath)
        : createFileBindingLedger(options.bindingPath);
    } catch {
      return { exitCode: 1, lines: [RUN_DID_NOT_COMPLETE] };
    }

    let outcome: Awaited<ReturnType<typeof runGateDirect>>;
    try {
      outcome = await runGateDirect({
        applicationId: collected.applicationId,
        repoFingerprint: collected.fingerprint,
        files: { ...collected.files },
        bundle: { variant: "snapshot", snapshot: adapted.snapshot },
        ledger,
        now: options.now,
      });
    } catch {
      return { exitCode: 1, lines: [RUN_DID_NOT_COMPLETE] };
    }

    if (
      collected.unreadable.length > 0 &&
      (outcome.kind === "pass" || outcome.kind === "fail")
    ) {
      return { exitCode: 1, lines: [RUN_DID_NOT_COMPLETE] };
    }
    return { exitCode: outcome.exitCode, lines: [outcome.sentence, ...outcome.deviationLines] };
  } catch {
    return { exitCode: 1, lines: [RUN_DID_NOT_COMPLETE] };
  }
}
