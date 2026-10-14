import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { computeRepositoryFingerprint } from "./fingerprint.ts";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createScratchDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "dh-fp-")));
  tempDirs.push(dir);
  return dir;
}

function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

describe("computeRepositoryFingerprint (AD-19)", () => {
  it("computes the SHA-256 of the root commit SHA for a repository with commits", () => {
    const repo = createScratchDir();
    git(repo, ["init", "-q"]);
    git(repo, ["config", "user.email", "builder@acme.test"]);
    git(repo, ["config", "user.name", "Builder"]);
    writeFileSync(join(repo, "README.md"), "# first\n");
    git(repo, ["add", "README.md"]);
    git(repo, ["commit", "-q", "-m", "initial commit"]);

    const rootSha = git(repo, ["rev-list", "--max-parents=0", "HEAD"]);
    const expected = createHash("sha256").update(rootSha).digest("hex");

    const first = computeRepositoryFingerprint(repo);
    expect(first).toEqual({
      ok: true,
      kind: "fingerprint",
      fingerprint: expected,
      rootCommitSha: rootSha,
    });

    // Adding a second commit keeps the root commit and fingerprint identical.
    writeFileSync(join(repo, "README.md"), "# second\n");
    git(repo, ["add", "README.md"]);
    git(repo, ["commit", "-q", "-m", "second commit"]);

    const second = computeRepositoryFingerprint(repo);
    expect(second).toEqual({
      ok: true,
      kind: "fingerprint",
      fingerprint: expected,
      rootCommitSha: rootSha,
    });
  });

  it("returns the unbound outcome without throwing for a freshly initialized repository with no commit", () => {
    const repo = createScratchDir();
    git(repo, ["init", "-q"]);

    const outcome = computeRepositoryFingerprint(repo);
    expect(outcome.ok).toBe(false);
    expect(outcome.kind).toBe("unbound");
    expect(outcome.fingerprint).toBeUndefined();
  });

  it("returns the unbound outcome without throwing for a non-git directory", () => {
    const dir = createScratchDir();
    const outcome = computeRepositoryFingerprint(dir);
    expect(outcome.ok).toBe(false);
    expect(outcome.kind).toBe("unbound");
    expect(outcome.fingerprint).toBeUndefined();
  });
});
