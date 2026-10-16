/**
 * Role-token verification (Story 6.7): the offline check behind the
 * Company service's Guidance-event read endpoint. A token is
 * `${keyId}.${body}.${base64url(signature)}` where `body` is the base64url
 * canonical-JSON payload the registry signed over (see
 * `packages/contract/src/guidance-access.ts`).
 *
 * Verification order is fixed and every outcome is a value, never a throw:
 * `shape` (three parts, decodable guarded payload) → `tenant_mismatch` →
 * `expired` (including an unusable window: `expiresAt - issuedAt` must fit
 * the token TTL) → `unknown_key` → `signature_failed`. The caller maps every
 * denial to one indistinguishable 401.
 */
import { verify as cryptoVerify } from "node:crypto";
import {
  decodeRoleTokenBody,
  fromBase64Url,
  GUIDANCE_ROLE_TOKEN_TTL_MINUTES,
  isGuidanceRoleTokenPayload,
} from "@domain-harness/contract";
import type { Role, UuidV7 } from "@domain-harness/contract";
import type { BundleTrustSet } from "../bundles/verify.ts";

/** The fixed denial reason codes, in verification order. */
export const ROLE_TOKEN_DENIAL_REASONS = [
  "shape",
  "tenant_mismatch",
  "expired",
  "unknown_key",
  "signature_failed",
] as const;

/** One denial reason of {@link verifyRoleToken}. */
export type RoleTokenDenialReason = (typeof ROLE_TOKEN_DENIAL_REASONS)[number];

/** The outcome of {@link verifyRoleToken}: the granted role, or one denial reason. */
export type RoleTokenVerdict = { readonly ok: true; readonly role: Role } | { readonly ok: false; readonly reason: RoleTokenDenialReason };

/** The inputs of {@link verifyRoleToken}. */
export interface VerifyRoleTokenInput {
  /** The raw Bearer token. */
  readonly token: unknown;
  /** The configured tenant id; the payload's must equal it. */
  readonly tenantId: UuidV7;
  /** keyId → Ed25519 public key of the vendor registry. */
  readonly trustSet: BundleTrustSet;
  /** The current time in milliseconds since the epoch. */
  readonly nowMs: number;
}

const TTL_MS = GUIDANCE_ROLE_TOKEN_TTL_MINUTES * 60 * 1000;

/** Clock-skew leeway for the issuance instant: a token minted moments in the future still verifies. */
export const ROLE_TOKEN_ISSUED_SKEW_MS = 60_000;

const denied = (reason: RoleTokenDenialReason): RoleTokenVerdict => ({ ok: false, reason });

/**
 * Verify one role token offline. Returns the granted role, or one denial
 * reason. Never throws on any input.
 */
export function verifyRoleToken(input: VerifyRoleTokenInput): RoleTokenVerdict {
  const { token, tenantId, trustSet, nowMs } = input;
  if (typeof token !== "string") return denied("shape");
  const parts = token.split(".");
  if (parts.length !== 3) return denied("shape");
  const [keyId, body, signature] = parts as [string, string, string];
  if (keyId === "" || body === "" || signature === "") return denied("shape");
  const payload: unknown = decodeRoleTokenBody(body);
  if (!isGuidanceRoleTokenPayload(payload)) return denied("shape");
  if (payload.tenantId !== tenantId) return denied("tenant_mismatch");
  const issuedMs = Date.parse(payload.issuedAt);
  const expiresMs = Date.parse(payload.expiresAt);
  if (!Number.isFinite(issuedMs) || !Number.isFinite(expiresMs)) return denied("expired");
  const windowMs = expiresMs - issuedMs;
  if (windowMs <= 0 || windowMs > TTL_MS || issuedMs > nowMs + ROLE_TOKEN_ISSUED_SKEW_MS || nowMs >= expiresMs) {
    return denied("expired");
  }
  const trusted = trustSet.get(keyId);
  if (trusted === undefined) return denied("unknown_key");
  let signatureOk: boolean;
  try {
    signatureOk = cryptoVerify(null, Buffer.from(body, "utf8"), trusted, Buffer.from(fromBase64Url(signature), "base64"));
  } catch {
    signatureOk = false;
  }
  if (!signatureOk) return denied("signature_failed");
  return { ok: true, role: payload.role };
}
