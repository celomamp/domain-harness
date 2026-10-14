import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

export type RepositoryFingerprintOutcome =
  | { readonly ok: true; readonly kind: "fingerprint"; readonly fingerprint: string; readonly rootCommitSha: string }
  | { readonly ok: false; readonly kind: "unbound"; readonly reason: string; readonly fingerprint: undefined };

export function computeRepositoryFingerprint(root: string): RepositoryFingerprintOutcome {
  try {
    const output = execFileSync("git", ["rev-list", "--max-parents=0", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const sha = output.trim().split(/\r?\n/)[0]?.trim() ?? "";
    if (sha === "") {
      return { ok: false, kind: "unbound", reason: "no root commit", fingerprint: undefined };
    }
    const fingerprint = createHash("sha256").update(sha).digest("hex");
    return { ok: true, kind: "fingerprint", fingerprint, rootCommitSha: sha };
  } catch {
    return { ok: false, kind: "unbound", reason: "no root commit", fingerprint: undefined };
  }
}
