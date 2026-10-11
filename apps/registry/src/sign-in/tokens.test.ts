import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { mintUuidV7 } from "../ids.ts";
import { hashToken, mintToken, parseToken } from "./tokens.ts";

describe("sign-in tokens", () => {
  const tenantId = mintUuidV7();

  it("are <tenantId>.<43-char base64url secret> and differ every time", () => {
    const a = mintToken(tenantId);
    const b = mintToken(tenantId);
    expect(a).toMatch(new RegExp(`^${tenantId}\\.[A-Za-z0-9_-]{43}$`));
    expect(a).not.toBe(b);
  });

  it("parse back to their tenant", () => {
    const token = mintToken(tenantId);
    expect(parseToken(token)).toEqual({ tenantId, token });
  });

  it("refuses to mint without a UUIDv7 tenant", () => {
    expect(() => mintToken("3f2b8c1e-9d4a-4b6e-8f7a-1c2d3e4f5a6b" as never)).toThrow(TypeError);
  });

  const secret = "A".repeat(43);
  it.each([
    ["garbage", "garbage"],
    ["an empty string", ""],
    ["a non-string", 42],
    ["a UUIDv4 tenant", `3f2b8c1e-9d4a-4b6e-8f7a-1c2d3e4f5a6b.${secret}`],
    ["an uppercase tenant", `${tenantId.toUpperCase()}.${secret}`],
    ["a short secret", `${tenantId}.${secret.slice(1)}`],
    ["a long secret", `${tenantId}.${secret}A`],
    ["a padded secret", `${tenantId}.${secret.slice(2)}==`],
    ["a non-base64url secret", `${tenantId}.${secret.slice(1)}+`],
    ["a missing dot", `${tenantId}_${secret}`],
  ])("reject %s", (_label, value) => {
    expect(parseToken(value)).toBeUndefined();
  });

  it("hash to the SHA-256 hex of the whole token", () => {
    const token = mintToken(tenantId);
    const expected = createHash("sha256").update(token).digest("hex");
    expect(hashToken(token)).toBe(expected);
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hash differently when only the tenant part changes", () => {
    const token = mintToken(tenantId);
    const swapped = `${mintUuidV7()}${token.slice(36)}`;
    expect(hashToken(swapped)).not.toBe(hashToken(token));
  });
});
