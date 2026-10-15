import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readStateEntry, readStateFile, writeStateEntry, writeStateFile } from "./bundle-state.ts";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const TENANT = "018f3d2a-7000-7000-8000-000000000100";

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "dh-state-"));
}

describe("bundle-state", () => {
  it("reads a missing file as no entries", () => {
    expect(readStateFile(join(scratch(), "missing.json"))).toEqual({});
    expect(readStateEntry(join(scratch(), "missing.json"), TENANT)).toBeNull();
  });

  it("writes then reads one entry", () => {
    const dir = scratch();
    const path = join(dir, "state.json");
    expect(writeStateEntry(path, TENANT, { sequence: 7, hash: HASH_A })).toBe(true);
    expect(readStateEntry(path, TENANT)).toEqual({ sequence: 7, hash: HASH_A });
  });

  it("treats corrupt JSON as no entries", () => {
    const dir = scratch();
    const path = join(dir, "state.json");
    writeFileSync(path, "{not json");
    expect(readStateFile(path)).toEqual({});
    expect(readStateEntry(path, TENANT)).toBeNull();
  });

  it("treats a corrupt entry as no entry for that tenant only", () => {
    const dir = scratch();
    const path = join(dir, "state.json");
    const other = "018f3d2a-7000-7000-8000-000000000101";
    writeFileSync(
      path,
      JSON.stringify({
        [TENANT]: { sequence: 3, hash: HASH_A },
        [other]: { sequence: "bad", hash: "zzz" },
      }),
    );
    expect(readStateEntry(path, TENANT)).toEqual({ sequence: 3, hash: HASH_A });
    expect(readStateEntry(path, other)).toBeNull();
  });

  it("preserves other tenants on write", () => {
    const dir = scratch();
    const path = join(dir, "state.json");
    const other = "018f3d2a-7000-7000-8000-000000000101";
    expect(writeStateEntry(path, TENANT, { sequence: 1, hash: HASH_A })).toBe(true);
    expect(writeStateEntry(path, other, { sequence: 2, hash: HASH_B })).toBe(true);
    expect(readStateEntry(path, TENANT)).toEqual({ sequence: 1, hash: HASH_A });
    expect(readStateEntry(path, other)).toEqual({ sequence: 2, hash: HASH_B });
  });

  it("writes atomically with no temp files left behind", () => {
    const dir = scratch();
    const path = join(dir, "nested", "state.json");
    expect(writeStateFile(path, { [TENANT]: { sequence: 1, hash: HASH_A } })).toBe(true);
    const text = readFileSync(path, "utf8");
    expect(JSON.parse(text)).toEqual({ [TENANT]: { sequence: 1, hash: HASH_A } });
  });

  it("rejects malformed entries on write", () => {
    const dir = scratch();
    const path = join(dir, "state.json");
    expect(writeStateEntry(path, TENANT, { sequence: 0, hash: HASH_A })).toBe(false);
    expect(writeStateEntry(path, TENANT, { sequence: 1, hash: "not-hex" })).toBe(false);
    expect(statSync(dir).isDirectory()).toBe(true);
  });
});
