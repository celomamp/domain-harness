import { createHash, randomBytes } from "node:crypto";
import { isUuidV7 } from "@domain-harness/contract";
import type { UuidV7 } from "@domain-harness/contract";

/** Random bytes in every token's secret part. */
export const TOKEN_SECRET_BYTES = 32;

// base64url without padding of 32 bytes is exactly 43 characters.
const SECRET = /^[A-Za-z0-9_-]{43}$/;

/** A parsed token: the tenant whose context every lookup runs in, and the full token text. */
export interface ParsedToken {
  readonly tenantId: UuidV7;
  readonly token: string;
}

/**
 * Mint a link or session token: `<tenantId>.<base64url of 32 random bytes>`.
 * The tenant part only routes the lookup; the secret part is what proves it.
 */
export function mintToken(tenantId: UuidV7): string {
  if (!isUuidV7(tenantId)) {
    throw new TypeError("a token needs a canonical UUIDv7 tenant id");
  }
  return `${tenantId}.${randomBytes(TOKEN_SECRET_BYTES).toString("base64url")}`;
}

/**
 * Parse a token without touching the database. Returns undefined unless it is
 * exactly a canonical UUIDv7, one dot and a 43-character base64url secret.
 */
export function parseToken(value: unknown): ParsedToken | undefined {
  if (typeof value !== "string" || value.length !== 36 + 1 + 43) return undefined;
  const tenantId = value.slice(0, 36);
  if (value[36] !== "." || !isUuidV7(tenantId) || !SECRET.test(value.slice(37))) return undefined;
  return { tenantId, token: value };
}

/**
 * The stored form of a token: SHA-256 of the whole token, lowercase hex.
 * Hashing the tenant part too means a token whose tenant was swapped for
 * another tenant's id never matches anything.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
