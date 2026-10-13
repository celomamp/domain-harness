import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { tar, tarGz, untarGz } from "./archive.ts";

const entries = [
  { path: ".domain-harness.json", content: "{}\n" },
  { path: "CLAUDE.md", content: `# Title\n${"é".repeat(600)}\n` },
  { path: ".claude/skills/domain-harness-guidance/SKILL.md", content: "" },
];

describe("tarGz", () => {
  it("round-trips through gunzip and a ustar parse, in order, with fixed headers", () => {
    const read = untarGz(tarGz(entries));
    expect(read.map((e) => ({ path: e.path, content: e.content }))).toEqual(entries);
    for (const entry of read) {
      expect(entry).toMatchObject({ mode: 0o644, uid: 0, gid: 0, mtime: 0, typeflag: "0", magic: "ustar" });
    }
  });

  it("gives identical bytes for equal inputs", () => {
    expect(tarGz(entries).equals(tarGz(entries.map((e) => ({ ...e }))))).toBe(true);
    expect(tarGz(entries).equals(tarGz([...entries].reverse()))).toBe(false);
  });

  it("pads to 512-byte blocks and ends with two zero blocks", () => {
    const raw = tar(entries);
    expect(raw.length % 512).toBe(0);
    expect(raw.subarray(raw.length - 1024).every((b) => b === 0)).toBe(true);
  });

  it("refuses to read an entry whose size runs past the data", () => {
    const raw = tar([{ path: "a.txt", content: "x".repeat(600) }]);
    expect(() => untarGz(gzipSync(raw.subarray(0, 512 + 100)))).toThrow("runs past");
  });

  it("refuses absolute, parent and over-long paths", () => {
    for (const path of ["/etc/x", "../x", "a/../../x", "x".repeat(101), ""]) {
      expect(() => tar([{ path, content: "" }])).toThrow();
    }
  });

  it("is read by the system tar when one is installed", () => {
    let hasTar = true;
    try {
      execFileSync("tar", ["--version"], { stdio: "ignore" });
    } catch {
      hasTar = false;
    }
    if (!hasTar) return;
    const dir = mkdtempSync(join(tmpdir(), "dh-tar-"));
    try {
      writeFileSync(join(dir, "a.tar.gz"), tarGz(entries));
      execFileSync("tar", ["-xzf", "a.tar.gz"], { cwd: dir });
      expect(readFileSync(join(dir, "CLAUDE.md"), "utf8")).toBe(entries[1]?.content);
      expect(readFileSync(join(dir, ".claude/skills/domain-harness-guidance/SKILL.md"), "utf8")).toBe("");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
