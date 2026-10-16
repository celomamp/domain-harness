// Suite for offline role-token verification (Story 6.7): every denial class
// plus the granted-role happy path. Tokens are minted here the way the
// registry mints them (canonical body, Ed25519 over the body bytes).
import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { encodeRoleTokenBody, toBase64Url } from "@domain-harness/contract";
import type { GuidanceRoleTokenPayload, UuidV7 } from "@domain-harness/contract";
import { verifyRoleToken } from "./role-tokens.ts";

const TENANT = "018f3d2a-7000-7000-8000-000000000100" as UuidV7;
const OTHER_TENANT = "018f3d2a-7000-7000-8000-000000000200" as UuidV7;
const NOW = Date.parse("2026-10-16T12:00:00.000Z");
const KEY_ID = "registry-key-2026-10";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const trustSet = new Map([[KEY_ID, publicKey]]);

function mint(payload: GuidanceRoleTokenPayload, key: typeof privateKey = privateKey, keyId: string = KEY_ID): string {
  const body = encodeRoleTokenBody(payload);
  const signature = sign(null, Buffer.from(body, "utf8"), key);
  return `${keyId}.${body}.${toBase64Url(signature.toString("base64"))}`;
}

function payloadOf(overrides: Partial<GuidanceRoleTokenPayload> = {}): GuidanceRoleTokenPayload {
  return {
    tenantId: TENANT,
    role: "Standard owner",
    issuedAt: "2026-10-16T12:00:00.000Z",
    expiresAt: "2026-10-16T12:05:00.000Z",
    ...overrides,
  };
}

describe("verifyRoleToken", () => {
  it("accepts a fresh token with its granted role", () => {
    expect(verifyRoleToken({ token: mint(payloadOf()), tenantId: TENANT, trustSet, nowMs: NOW })).toEqual({
      ok: true,
      role: "Standard owner",
    });
  });

  it("denies malformed tokens as shape without throwing", () => {
    for (const token of [null, undefined, 42, "", "a.b", "a.b.c.d", ".b.c", "a..c", "a.b.", "not-a-token"]) {
      expect(verifyRoleToken({ token, tenantId: TENANT, trustSet, nowMs: NOW })).toEqual({ ok: false, reason: "shape" });
    }
    // A well-formed token whose body is not a guarded payload.
    const forged = `${KEY_ID}.${Buffer.from('{"nope":1}', "utf8").toString("base64url")}.c2ln`;
    expect(verifyRoleToken({ token: forged, tenantId: TENANT, trustSet, nowMs: NOW })).toEqual({
      ok: false,
      reason: "shape",
    });
  });

  it("denies a foreign tenant's token", () => {
    const token = mint(payloadOf({ tenantId: OTHER_TENANT }));
    expect(verifyRoleToken({ token, tenantId: TENANT, trustSet, nowMs: NOW })).toEqual({
      ok: false,
      reason: "tenant_mismatch",
    });
  });

  it("denies expired tokens and unusable windows", () => {
    const expired = mint(payloadOf({ issuedAt: "2026-10-16T11:50:00.000Z", expiresAt: "2026-10-16T11:55:00.000Z" }));
    expect(verifyRoleToken({ token: expired, tenantId: TENANT, trustSet, nowMs: NOW })).toEqual({
      ok: false,
      reason: "expired",
    });
    // The expiry instant itself is already expired.
    const boundary = mint(payloadOf({ issuedAt: "2026-10-16T11:55:00.000Z", expiresAt: "2026-10-16T12:00:00.000Z" }));
    expect(verifyRoleToken({ token: boundary, tenantId: TENANT, trustSet, nowMs: NOW })).toEqual({
      ok: false,
      reason: "expired",
    });
    // An issuance far in the future is not usable either: the lifetime would exceed the TTL.
    const future = mint(payloadOf({ issuedAt: "2026-10-16T13:00:00.000Z", expiresAt: "2026-10-16T13:05:00.000Z" }));
    expect(verifyRoleToken({ token: future, tenantId: TENANT, trustSet, nowMs: NOW })).toEqual({
      ok: false,
      reason: "expired",
    });
    // A token living longer than the TTL is not usable, even before expiry.
    const longLived = mint(payloadOf({ expiresAt: "2026-10-16T13:00:00.000Z" }));
    expect(verifyRoleToken({ token: longLived, tenantId: TENANT, trustSet, nowMs: NOW })).toEqual({
      ok: false,
      reason: "expired",
    });
    // Zero and negative windows are not usable either.
    for (const window of ["2026-10-16T12:00:00.000Z", "2026-10-16T11:59:00.000Z"]) {
      const broken = mint(payloadOf({ expiresAt: window }));
      expect(verifyRoleToken({ token: broken, tenantId: TENANT, trustSet, nowMs: NOW })).toEqual({
        ok: false,
        reason: "expired",
      });
    }
  });

  it("denies an unknown key id before doing signature work", () => {
    const token = mint(payloadOf(), privateKey, "next-key");
    expect(verifyRoleToken({ token, tenantId: TENANT, trustSet, nowMs: NOW })).toEqual({
      ok: false,
      reason: "unknown_key",
    });
  });

  it("denies a token signed by another key", () => {
    const { privateKey: rogue } = generateKeyPairSync("ed25519");
    const forged = mint(payloadOf(), rogue);
    expect(verifyRoleToken({ token: forged, tenantId: TENANT, trustSet, nowMs: NOW })).toEqual({
      ok: false,
      reason: "signature_failed",
    });
  });

  it("denies a token whose signature was swapped", () => {
    const [keyId, body] = mint(payloadOf()).split(".") as [string, string];
    const other = mint(payloadOf({ role: "Builder" })).split(".")[2] ?? "";
    expect(verifyRoleToken({ token: `${keyId}.${body}.${other}`, tenantId: TENANT, trustSet, nowMs: NOW })).toEqual({
      ok: false,
      reason: "signature_failed",
    });
  });
});
