/**
 * Call-time identity computation of the stdio bridge (Story 4.3): the
 * identification file is read and parsed and the repository fingerprint is
 * computed when a message is forwarded — never at start-up and never cached
 * across calls. A value that cannot be computed is `undefined`; its header
 * is then simply absent. Both helpers never throw.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { IDENTIFICATION_FILE_NAME, parseIdentificationFile } from "@domain-harness/contract";

/** The identity values one forwarded call carries; `undefined` = absent header. */
export interface CallIdentity {
  /** The Application id of the parsed identification file. */
  readonly applicationId: string | undefined;
  /** The advisory Project id of the parsed identification file. */
  readonly advisoryProjectId: string | undefined;
  /** The lowercase SHA-256 hex of the repository's root commit SHA. */
  readonly repoFingerprint: string | undefined;
}

/** The values the parsed identification file carries, or undefined fields. */
export interface ParsedIdentification {
  readonly applicationId: string | undefined;
  readonly advisoryProjectId: string | undefined;
}

/**
 * Read and parse `<root>/.domain-harness.json` with the contract's parser.
 * Only a parsed file carries values: a missing or unreadable file yields
 * `undefined` for both fields, so the bridge forwards the call without
 * identity and the service answers its fixed sentence. Never throws.
 */
export function readIdentificationFile(root: string): ParsedIdentification {
  let content: string | null;
  try {
    content = readFileSync(join(root, IDENTIFICATION_FILE_NAME), "utf8");
  } catch {
    content = null;
  }
  const parsed = parseIdentificationFile(content);
  if (parsed.kind !== "parsed") {
    return { applicationId: undefined, advisoryProjectId: undefined };
  }
  return { applicationId: parsed.file.applicationId, advisoryProjectId: parsed.file.projectId };
}

/**
 * Compute the repository fingerprint (algorithm version 1): the lowercase
 * SHA-256 hex digest of the root commit SHA of
 * `git rev-list --max-parents=0 HEAD`. A repository with no commit (or no
 * repository at all) yields `undefined`. Never throws; a separate `git`
 * subprocess per call is fine.
 *
 * That `rev-list` may print SEVERAL root commit SHAs (for example two
 * unrelated histories merged into one): the pinned rule is the FIRST line
 * as emitted — exactly what the CI-Gate mirror computes — so both units
 * fingerprint a multi-root repository the same way.
 */
export function computeBridgeFingerprint(root: string): string | undefined {
  try {
    const output = execFileSync("git", ["rev-list", "--max-parents=0", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const sha = output.trim().split(/\r?\n/)[0]?.trim() ?? "";
    if (sha === "") return undefined;
    return createHash("sha256").update(sha).digest("hex");
  } catch {
    return undefined;
  }
}
