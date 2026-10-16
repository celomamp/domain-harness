// Suite for the Guidance access contract (Story 6.7): guards, bounds, the
// token body round-trip, and the no-prompt-text pin over the published
// Compilation catalog.
import { describe, expect, it } from "vitest";
import {
  COMPILATION_SCHEMA_DOCS,
  COMPILATION_TYPE_NAMES,
} from "./compilations.ts";
import {
  decodeRoleTokenBody,
  defaultGuidanceAccessState,
  encodeRoleTokenBody,
  fromBase64Url,
  GRANTABLE_ROLES,
  GUIDANCE_ACCESS_API_PATHS,
  GUIDANCE_EVENT_READ_PATH,
  GUIDANCE_RETENTION_DAYS_MAX,
  GUIDANCE_RETENTION_DAYS_MIN,
  GUIDANCE_ROLE_TOKEN_TTL_MINUTES,
  isGrantableRole,
  isGuidanceAccessState,
  isGuidanceRoleToken,
  isGuidanceRoleTokenPayload,
  isRetentionDays,
  toBase64Url,
} from "./guidance-access.ts";
import type { GuidanceRoleTokenPayload } from "./guidance-access.ts";
import { GUIDANCE_EVENT_RETENTION_DAYS } from "./guidance-events.ts";
import type { UuidV7 } from "./ids.ts";
import { isCompilation } from "./compilations.ts";

const TENANT = "01928c7e-5b2a-7c3d-ae4f-a1b2c3d4e5f0" as UuidV7;

function payload(): GuidanceRoleTokenPayload {
  return {
    tenantId: TENANT,
    role: "Standard owner",
    issuedAt: "2026-10-16T12:00:00.000Z",
    expiresAt: "2026-10-16T12:05:00.000Z",
  };
}

describe("guidance access vocabulary", () => {
  it("versions the registry paths and the service read path", () => {
    expect(GUIDANCE_ACCESS_API_PATHS).toEqual({
      access: "/v1/guidance-access",
      tokens: "/v1/guidance-access/tokens",
      retention: "/v1/guidance-access/retention",
    });
    expect(GUIDANCE_EVENT_READ_PATH).toBe("/v1/guidance-events");
  });

  it("grants only the non-Buyer roles, with a five-minute token lifetime", () => {
    expect([...GRANTABLE_ROLES]).toEqual(["Standard owner", "Builder"]);
    expect(isGrantableRole("Buyer")).toBe(false);
    expect(GUIDANCE_ROLE_TOKEN_TTL_MINUTES).toBe(5);
  });

  it("bounds retention at 1..3650 days around the 90-day default", () => {
    expect([GUIDANCE_RETENTION_DAYS_MIN, GUIDANCE_RETENTION_DAYS_MAX]).toEqual([1, 3650]);
    expect(GUIDANCE_EVENT_RETENTION_DAYS).toBe(90);
    expect(isRetentionDays(1)).toBe(true);
    expect(isRetentionDays(3650)).toBe(true);
    for (const bad of [0, -1, 3651, 1.5, Number.NaN, "90", null, undefined, {}, []]) {
      expect(isRetentionDays(bad)).toBe(false);
    }
  });

  it("starts pristine: no grant, the 90-day default, never changed", () => {
    expect(defaultGuidanceAccessState()).toEqual({ grantedRoles: [], retentionDays: 90, updatedAt: null });
    expect(isGuidanceAccessState(defaultGuidanceAccessState())).toBe(true);
  });

  it("guards the access state with exact keys", () => {
    const good = { grantedRoles: ["Builder"], retentionDays: 30, updatedAt: "2026-10-16T12:00:00.000Z" };
    expect(isGuidanceAccessState(good)).toBe(true);
    expect(isGuidanceAccessState({ ...good, updatedAt: null })).toBe(true);
    expect(isGuidanceAccessState({ ...good, grantedRoles: ["Buyer"] })).toBe(false);
    expect(isGuidanceAccessState({ ...good, grantedRoles: "Builder" })).toBe(false);
    expect(isGuidanceAccessState({ ...good, retentionDays: 0 })).toBe(false);
    expect(isGuidanceAccessState({ ...good, extra: 1 })).toBe(false);
    expect(isGuidanceAccessState({ ...good, updatedAt: "yesterday" })).toBe(false);
    for (const bad of [null, undefined, "x", [], 42]) expect(isGuidanceAccessState(bad)).toBe(false);
  });

  it("guards the token payload and the minted token with exact keys", () => {
    expect(isGuidanceRoleTokenPayload(payload())).toBe(true);
    expect(isGuidanceRoleTokenPayload({ ...payload(), role: "Builder" })).toBe(true);
    expect(isGuidanceRoleTokenPayload({ ...payload(), role: "Admin" })).toBe(false);
    expect(isGuidanceRoleTokenPayload({ ...payload(), tenantId: "nope" })).toBe(false);
    expect(isGuidanceRoleTokenPayload({ ...payload(), extra: 1 })).toBe(false);
    const token = { token: "key.body.sig", role: "Builder", expiresAt: "2026-10-16T12:05:00.000Z" };
    expect(isGuidanceRoleToken(token)).toBe(true);
    expect(isGuidanceRoleToken({ ...token, token: "" })).toBe(false);
    expect(isGuidanceRoleToken({ ...token, extra: 1 })).toBe(false);
  });
});

describe("role token body codec", () => {
  it("round-trips a payload through the signable body", () => {
    const body = encodeRoleTokenBody(payload());
    expect(body).toMatch(/^[A-Za-z0-9_-]+$/);
    const decoded: unknown = decodeRoleTokenBody(body);
    expect(isGuidanceRoleTokenPayload(decoded)).toBe(true);
    expect(decoded).toEqual(payload());
  });

  it("encodes canonically: key order never affects the body", () => {
    const reordered = {
      expiresAt: "2026-10-16T12:05:00.000Z",
      role: "Standard owner",
      issuedAt: "2026-10-16T12:00:00.000Z",
      tenantId: TENANT,
    } as GuidanceRoleTokenPayload;
    expect(encodeRoleTokenBody(reordered)).toBe(encodeRoleTokenBody(payload()));
  });

  it("refuses malformed bodies without throwing", () => {
    for (const bad of [null, undefined, 42, "", "!!!", "bm90LWpzb24"]) {
      expect(decodeRoleTokenBody(bad)).toBe(undefined);
    }
    // Valid base64url of `{}` decodes (the payload guard rejects it later).
    expect(decodeRoleTokenBody("e30")).toEqual({});
  });

  it("converts base64 padding both ways", () => {
    expect(toBase64Url("ab+/==")).toBe("ab-_");
    expect(fromBase64Url("YWI")).toBe("YWI=");
    for (const padded of ["YWI=", "YWI9PQ==", "abcd"]) {
      expect(fromBase64Url(toBase64Url(padded))).toBe(padded);
    }
  });
});

describe("compilation export carries no prompt text", () => {
  it("names no field like prompt text in any catalog schema or its documentation", () => {
    const offenders: string[] = [];
    for (const doc of COMPILATION_SCHEMA_DOCS) {
      for (const field of doc.fields) {
        if (/prompt/i.test(field.name)) offenders.push(`${doc.name}.${field.name}`);
      }
    }
    expect(offenders).toEqual([]);
    // The schema documents cover every catalog type, so the scan is complete.
    expect(COMPILATION_SCHEMA_DOCS.map((doc) => doc.name).sort()).toEqual([...COMPILATION_TYPE_NAMES].sort());
    expect(isCompilation).toBeTypeOf("function");
  });
});
