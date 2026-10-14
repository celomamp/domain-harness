/**
 * Unit suite for the bridge's call-time identity helpers (Story 4.3): the
 * repository fingerprint pins the first-line rule of
 * `git rev-list --max-parents=0 HEAD` — the same rule the CI-Gate mirror
 * computes — including a multi-root repository that emits two root SHAs
 * (two unrelated histories merged into one).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { computeBridgeFingerprint } from "./identity.ts";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createScratchDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "dh-bridge-fp-")));
  tempDirs.push(dir);
  return dir;
}

function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
}

/** A repository with two roots: an unrelated history merged into one head. */
function repoWithTwoRoots(dir: string): void {
  git(dir, ["init", "-q", "--initial-branch=main"]);
  git(dir, ["config", "user.email", "builder@acme.test"]);
  git(dir, ["config", "user.name", "Builder"]);
  writeFileSync(join(dir, "first.txt"), "first\n");
  git(dir, ["add", "first.txt"]);
  git(dir, ["commit", "-q", "-m", "first root"]);

  git(dir, ["checkout", "-q", "--orphan", "other"]);
  writeFileSync(join(dir, "second.txt"), "second\n");
  git(dir, ["add", "second.txt"]);
  git(dir, ["commit", "-q", "-m", "second root"]);

  git(dir, ["checkout", "-q", "main"]);
  git(dir, ["merge", "-q", "--allow-unrelated-histories", "other", "-m", "octopus merge"]);
}

describe("computeBridgeFingerprint", () => {
  it("hashes the first emitted root SHA when the rev-list prints several roots", () => {
    const repo = createScratchDir();
    repoWithTwoRoots(repo);

    // Two unrelated histories merged into one head: two root SHAs, exactly
    // as the CI-Gate mirror sees them.
    const emitted = git(repo, ["rev-list", "--max-parents=0", "HEAD"])
      .split(/\r?\n/)
      .filter((line) => line.trim() !== "");
    expect(emitted.length).toBeGreaterThanOrEqual(2);

    const firstLine = emitted[0]?.trim() ?? "";
    expect(computeBridgeFingerprint(repo)).toBe(createHash("sha256").update(firstLine).digest("hex"));
  });

  it("yields undefined for a non-git directory without throwing", () => {
    expect(computeBridgeFingerprint(createScratchDir())).toBeUndefined();
  });
});
