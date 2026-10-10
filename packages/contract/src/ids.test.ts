import { describe, expect, expectTypeOf, it } from "vitest";
import { isUuidV7 } from "./index.ts";
import type { UuidV7 } from "./index.ts";

const V7 = "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e5f6";
const V4 = "3f2b8c1e-9d4a-4b6e-8f7a-1c2d3e4f5a6b";

describe("isUuidV7", () => {
  it("accepts a UUIDv7 string", () => {
    expect(isUuidV7(V7)).toBe(true);
  });

  it.each([
    ["a UUIDv4", V4],
    ["uppercase (non-canonical) v7", V7.toUpperCase()],
    ["a wrong variant", "01928c7e-5b2a-7c3d-0e4f-a1b2c3d4e5f6"],
    ["the nil UUID", "00000000-0000-0000-0000-000000000000"],
    ["v7 without hyphens", V7.replaceAll("-", "")],
    ["v7 with surrounding whitespace", ` ${V7} `],
    ["garbage", "not-a-uuid"],
    ["an empty string", ""],
  ])("rejects %s", (_label, value) => {
    expect(isUuidV7(value)).toBe(false);
  });

  it.each([[undefined], [null], [42], [{}], [[V7]]])("rejects non-string %j without throwing", (value) => {
    expect(() => isUuidV7(value)).not.toThrow();
    expect(isUuidV7(value)).toBe(false);
  });

  it("narrows to the branded UuidV7 type", () => {
    const value: unknown = V7;
    if (isUuidV7(value)) {
      expectTypeOf(value).toEqualTypeOf<UuidV7>();
    }
    // @ts-expect-error a plain string is not a UuidV7
    const plain: UuidV7 = V7;
    expect(plain).toBe(V7);
  });
});
