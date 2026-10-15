import { afterEach, describe, expect, it, vi } from "vitest";
import { isUuidV7 } from "@domain-harness/contract";
import { encodeUuidV7, mintUuidV7 } from "./ids.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("encodeUuidV7", () => {
  it("encodes a canonical UUIDv7 deterministically from its inputs", () => {
    expect(encodeUuidV7(0, 0n)).toBe("00000000-0000-7000-8000-000000000000");
    expect(encodeUuidV7(0, 0n)).toBe(encodeUuidV7(0, 0n));
    expect(isUuidV7(encodeUuidV7(1_700_000_000_000, 1n))).toBe(true);
  });

  it("rejects an out-of-range timestamp or random field with a RangeError", () => {
    for (const input of [
      [-1, 0n],
      [1.5, 0n],
      [2 ** 48, 0n],
      [0, -1n],
      [0, 1n << 74n],
    ] as const) {
      expect(() => encodeUuidV7(input[0], input[1])).toThrow(RangeError);
    }
  });
});

describe("mintUuidV7", () => {
  it("mints canonical UUIDv7 keys", () => {
    expect(isUuidV7(mintUuidV7())).toBe(true);
  });

  it("increments monotonically within the same millisecond", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const first = mintUuidV7();
    const second = mintUuidV7();
    const third = mintUuidV7();
    expect(new Set([first, second, third]).size).toBe(3);
    expect(second > first).toBe(true);
    expect(third > second).toBe(true);
    expect(isUuidV7(first)).toBe(true);
    expect(isUuidV7(second)).toBe(true);
    expect(isUuidV7(third)).toBe(true);
  });
});
