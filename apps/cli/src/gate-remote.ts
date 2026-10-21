/**
 * Hosted Gate command (pilot "option A"): `domain-harness gate --endpoint <url>`.
 *
 * For a Builder whose CI cannot reach the Company record store: the same
 * revision collection as the offline Gate (identification file, fingerprint,
 * tracked files), the same extractor, then ONE request to the Guidance
 * server's `POST /v1/gate-runs` carrying the revision SHA, the extracted
 * facts and the bridge's identity headers. The server evaluates against its
 * pinned active bundle, records the run (so it reaches the panel as
 * Application evidence) and answers the Gate's result, which is printed
 * exactly as the offline Gate and the CI step print it.
 *
 * What leaves the machine: the revision SHA, the Application id, the
 * advisory Project id, the repository fingerprint, and the facts —
 * dependency names and versions, import specifiers, design-token names.
 * Never file contents, never file paths: any unreadable file refuses
 * locally with `run did not complete` before anything is sent.
 *
 * The access token comes only from `DH_GUIDANCE_TOKEN` (the bridge's
 * variable), never argv, and is never printed. The endpoint must be HTTPS
 * unless it is loopback. Transport failures print `run did not complete`
 * on stdout and one diagnostic on stderr. The working tree and HEAD are
 * never modified; nothing is written locally. Never throws.
 */
import { execFileSync } from "node:child_process";
import {
  GATE_RUN_PATH,
  GUIDANCE_IDENTITY_HEADERS,
  isErrorEnvelope,
  isGateRunResult,
} from "@domain-harness/contract";
import type { GateRunRequest } from "@domain-harness/contract";
import { extractRevisionFacts } from "@domain-harness/extractor";
import { RUN_DID_NOT_COMPLETE } from "@domain-harness/gate";
import { collectRevisionFiles } from "./gate.ts";
import type { CollectRevisionOutcome, GateCommandResult } from "./gate.ts";

/** The Builder's Guidance access token variable (the bridge's own). */
export const GUIDANCE_TOKEN_ENV = "DH_GUIDANCE_TOKEN";

/** How long one hosted Gate run may take end to end. */
export const REMOTE_GATE_TIMEOUT_MS = 60_000;

/** Options of `domain-harness gate --endpoint`. */
export interface RemoteGateOptions {
  /** The Gate-run URL derived from the Guidance endpoint's origin. */
  readonly url: URL;
  /** Revision root; defaults to the current directory. */
  readonly root: string;
}

/** Optional seams for tests. */
export interface RemoteGateDeps {
  readonly collectRevisionFiles?: (root: string) => CollectRevisionOutcome;
  readonly readRevision?: (root: string) => string | null;
  readonly fetch?: typeof fetch;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly timeoutMs?: number;
}

/** True when `gate` argv selects the hosted mode (an `--endpoint` flag in any form). Never throws. */
export function isRemoteGateArgs(argv: readonly string[]): boolean {
  try {
    return argv[0] === "gate" && argv.slice(1).some((arg) => arg === "--endpoint" || arg.startsWith("--endpoint="));
  } catch {
    return false;
  }
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/**
 * The Gate-run URL of a Guidance endpoint (`https://host/mcp` or just
 * `https://host`): the endpoint's origin plus {@link GATE_RUN_PATH}. `null`
 * when it is not an HTTPS URL, or plain HTTP to a non-loopback host (the
 * token would travel in clear).
 */
export function gateRunUrlOf(endpoint: string): URL | null {
  try {
    const parsed = new URL(endpoint);
    if (parsed.username !== "" || parsed.password !== "") return null;
    if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLoopback(parsed.hostname))) return null;
    return new URL(GATE_RUN_PATH, parsed.origin);
  } catch {
    return null;
  }
}

/**
 * Parse `gate --endpoint <url> [--root <dir>]`. The offline flags
 * (`--bundle`, `--trust-keys`, `--tenant`, `--binding`, `--state`, `--now`)
 * are usage defects here: the server's bundle and clock are authoritative.
 * Returns null on any defect. Never throws.
 */
export function parseRemoteGateArgs(argv: readonly string[]): RemoteGateOptions | null {
  try {
    if (argv[0] !== "gate") return null;
    const rest = argv.slice(1);
    let endpoint: string | null = null;
    let root: string | null = null;
    for (let i = 0; i < rest.length; i += 1) {
      const arg = rest[i];
      if (arg === undefined) return null;
      const eq = arg.indexOf("=");
      const flag = eq === -1 ? arg : arg.slice(0, eq);
      const inline = eq === -1 ? null : arg.slice(eq + 1);
      let value: string | null;
      if (inline !== null) {
        value = inline === "" ? null : inline;
      } else {
        const next = rest[i + 1];
        value = next === undefined || next === "" || next.startsWith("-") ? null : next;
        i += 1;
      }
      if (value === null) return null;
      if (flag === "--endpoint") endpoint = value;
      else if (flag === "--root") root = value;
      else return null;
    }
    if (endpoint === null) return null;
    const url = gateRunUrlOf(endpoint);
    if (url === null) return null;
    const resolvedRoot = root ?? process.cwd();
    if (resolvedRoot === "") return null;
    return { url, root: resolvedRoot };
  } catch {
    return null;
  }
}

/** The HEAD commit SHA under `root`, or null on any git failure. Never throws. */
export function readHeadRevision(root: string): string | null {
  try {
    const sha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return sha === "" ? null : sha;
  } catch {
    return null;
  }
}

function failed(diagnostic: string): GateCommandResult {
  return { exitCode: 1, lines: [RUN_DID_NOT_COMPLETE], diagnostics: [diagnostic] };
}

/**
 * Run the hosted Gate command against argv words. Never throws. Local
 * refusals (identification file, fingerprint, unreadable files) print their
 * shared sentence without any request; the server's answer is printed as
 * the sentence then one line per open Deviation, with its exit code.
 */
export async function runRemoteGateCommand(argv: readonly string[], deps?: RemoteGateDeps): Promise<GateCommandResult> {
  try {
    const options = parseRemoteGateArgs(argv);
    if (options === null) {
      return failed("usage: domain-harness gate --endpoint <https-url> [--root <dir>]");
    }

    const collect = deps?.collectRevisionFiles ?? collectRevisionFiles;
    const collected = collect(options.root);
    if (!collected.ok) {
      return { exitCode: collected.exitCode, lines: [collected.sentence] };
    }
    const revision = (deps?.readRevision ?? readHeadRevision)(options.root);
    if (revision === null) return { exitCode: 1, lines: [RUN_DID_NOT_COMPLETE] };

    // Paths never leave the machine: an unreadable file (on disk or to the
    // extractor) refuses here, where the offline Gate refuses it too.
    const facts = extractRevisionFacts(collected.files);
    if (collected.unreadable.length > 0 || facts.unreadable.length > 0) {
      return { exitCode: 1, lines: [RUN_DID_NOT_COMPLETE] };
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      [GUIDANCE_IDENTITY_HEADERS.applicationId]: collected.applicationId,
      [GUIDANCE_IDENTITY_HEADERS.repoFingerprint]: collected.fingerprint,
    };
    if (collected.advisoryProjectId !== undefined) {
      headers[GUIDANCE_IDENTITY_HEADERS.advisoryProjectId] = collected.advisoryProjectId;
    }
    const token = (deps?.env ?? process.env)[GUIDANCE_TOKEN_ENV]?.trim();
    if (token !== undefined && token !== "") headers["Authorization"] = `Bearer ${token}`;

    const body: GateRunRequest = { revision, facts };
    let response: Response;
    try {
      response = await (deps?.fetch ?? fetch)(options.url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(deps?.timeoutMs ?? REMOTE_GATE_TIMEOUT_MS),
        redirect: "error",
      });
    } catch {
      return failed(`could not reach the Guidance server at ${options.url.origin}`);
    }

    let answer: unknown;
    try {
      answer = await response.json();
    } catch {
      answer = null;
    }
    if (response.status === 200 && isGateRunResult(answer)) {
      return { exitCode: answer.exitCode, lines: [answer.sentence, ...answer.deviationLines] };
    }
    if (response.status === 401) {
      return failed(`the Guidance server refused the access token; set ${GUIDANCE_TOKEN_ENV}`);
    }
    const code = isErrorEnvelope(answer) ? ` ${answer.code}` : "";
    return failed(`the Guidance server answered ${String(response.status)}${code}`);
  } catch {
    return { exitCode: 1, lines: [RUN_DID_NOT_COMPLETE] };
  }
}
