import { describe, expect, it } from "vitest";
import { isUuidV7 } from "@domain-harness/contract";
import { encodeUuidV7, mintUuidV7, uuidV7Timestamp } from "./ids.ts";

describe("mintUuidV7", () => {
  it("mints canonical UUIDv7 strings", () => {
    for (let i = 0; i < 1000; i += 1) {
      expect(isUuidV7(mintUuidV7())).toBe(true);
    }
  });

  it("mints strictly increasing ids, even within one millisecond", () => {
    const ids = Array.from({ length: 10_000 }, () => mintUuidV7());
    for (let i = 1; i < ids.length; i += 1) {
      expect((ids[i] ?? "") > (ids[i - 1] ?? "")).toBe(true);
    }
  });

  it("embeds the current time", () => {
    const before = Date.now();
    const ms = uuidV7Timestamp(mintUuidV7());
    expect(ms).toBeGreaterThanOrEqual(before);
    expect(ms).toBeLessThanOrEqual(Date.now() + 1);
  });
});

describe("encodeUuidV7", () => {
  it("puts the millisecond timestamp big-endian in the first 48 bits", () => {
    const ms = Date.UTC(2026, 9, 10, 12, 0, 0, 123);
    const id = encodeUuidV7(ms, 0n);
    expect(uuidV7Timestamp(id)).toBe(ms);
    const hex = ms.toString(16).padStart(12, "0");
    expect(id.slice(0, 13)).toBe(`${hex.slice(0, 8)}-${hex.slice(8)}`);
  });

  it("sets version 7 and variant 10 around the random field", () => {
    expect(encodeUuidV7(0, 0n)).toBe("00000000-0000-7000-8000-000000000000");
    expect(encodeUuidV7(0, (1n << 74n) - 1n)).toBe("00000000-0000-7fff-bfff-ffffffffffff");
  });

  it("sorts by timestamp, then by random field", () => {
    expect(encodeUuidV7(1_000, 5n) < encodeUuidV7(2_000, 0n)).toBe(true);
    expect(encodeUuidV7(1_000, 5n) < encodeUuidV7(1_000, 6n)).toBe(true);
  });

  it.each([[-1], [2 ** 48], [1.5], [Number.NaN]])("rejects timestamp %s", (ms) => {
    expect(() => encodeUuidV7(ms, 0n)).toThrow(RangeError);
  });

  it.each([[-1n], [1n << 74n]])("rejects random field %s", (random) => {
    expect(() => encodeUuidV7(0, random)).toThrow(RangeError);
  });
});
