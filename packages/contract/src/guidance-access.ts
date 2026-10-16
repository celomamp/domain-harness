/**
 * Guidance access (Story 6.7): the Buyer's control over who may read stored
 * Guidance events and how long they are kept (FR-28, FR-20, AD-17, AD-22,
 * UX-DR22).
 *
 * The grant names the non-Buyer roles that may read Guidance events; the
 * Buyer is always implicitly granted and can never be revoked. Reads of the
 * access state are open to every role; writes are the Buyer's alone. The
 * retention setting defaults to {@link GUIDANCE_EVENT_RETENTION_DAYS} (90
 * days) and is enforced by the Company service on its own store.
 *
 * Reads of Guidance-event content happen inside the Company network through
 * the service's read endpoint, on a short-lived tenant-scoped role token the
 * registry signs with its bundle key: canonical JSON
 * `{tenantId, role, issuedAt, expiresAt}` (see {@link canonicalJson}),
 * base64url-encoded (see {@link encodeRoleTokenBody}), signed over the
 * encoded bytes, and carried as
 * `${keyId}.${body}.${base64url(signature)}`. The service verifies offline
 * against its trust set. The panel configures the grant and shows the
 * retention setting; it never renders Guidance content.
 */
import { canonicalJson } from "./bundles.ts";
import { isRecord, isUtcIso } from "./guards.ts";
import { isUuidV7 } from "./ids.ts";
import type { UuidV7 } from "./ids.ts";
import { isRole } from "./accounts.ts";
import type { Role } from "./accounts.ts";
import { GUIDANCE_EVENT_RETENTION_DAYS } from "./guidance-events.ts";

/** Registry HTTP API paths for Guidance access. */
export const GUIDANCE_ACCESS_API_PATHS = {
  /** `GET` (every role) and `POST` (the Buyer only) of the tenant's grant and retention setting. */
  access: "/v1/guidance-access",
  /** `POST` (any role, for the caller's own role only) minting one role token. */
  tokens: "/v1/guidance-access/tokens",
  /** `GET` (tenant-credentialed, for the service's retention sweep) of the tenant's retention days. */
  retention: "/v1/guidance-access/retention",
} as const;

/** The Company service's Guidance-event read path: `GET` with a role token, inside the Company network only. */
export const GUIDANCE_EVENT_READ_PATH = "/v1/guidance-events";

/** The roles the Buyer can grant Guidance-event reads to. The Buyer is always implicitly granted. */
export const GRANTABLE_ROLES = ["Standard owner", "Builder"] as const;

/** One grantable role. */
export type GrantableRole = (typeof GRANTABLE_ROLES)[number];

/** True when `value` is exactly one of {@link GRANTABLE_ROLES}. Never throws. */
export function isGrantableRole(value: unknown): value is GrantableRole {
  return typeof value === "string" && (GRANTABLE_ROLES as readonly string[]).includes(value);
}

/** A role token lives this many minutes from `issuedAt` (short-lived, so grant revocation bites quickly). */
export const GUIDANCE_ROLE_TOKEN_TTL_MINUTES = 5;

/** The shortest retention setting the Buyer can choose, in days. */
export const GUIDANCE_RETENTION_DAYS_MIN = 1;

/** The longest retention setting the Buyer can choose, in days. */
export const GUIDANCE_RETENTION_DAYS_MAX = 3650;

/** True when `value` is an integer retention setting of 1..3650 days. Never throws. */
export function isRetentionDays(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= GUIDANCE_RETENTION_DAYS_MIN &&
    value <= GUIDANCE_RETENTION_DAYS_MAX
  );
}

/**
 * The tenant's Guidance access state: the grantable roles currently granted
 * (the Buyer is implied, never listed) and the retention setting in days.
 */
export interface GuidanceAccessState {
  readonly grantedRoles: readonly GrantableRole[];
  readonly retentionDays: number;
  /** The latest grant-or-retention change instant, or `null` when nothing was ever configured. */
  readonly updatedAt: string | null;
}

const GUIDANCE_ACCESS_STATE_KEYS = new Set(["grantedRoles", "retentionDays", "updatedAt"]);

/** True when `value` is a {@link GuidanceAccessState}: exactly its keys, never throws. */
export function isGuidanceAccessState(value: unknown): value is GuidanceAccessState {
  if (!isRecord(value)) return false;
  for (const key of Object.keys(value)) if (!GUIDANCE_ACCESS_STATE_KEYS.has(key)) return false;
  const grantedRoles = value["grantedRoles"];
  if (!Array.isArray(grantedRoles) || !grantedRoles.every(isGrantableRole)) return false;
  if (!isRetentionDays(value["retentionDays"])) return false;
  const updatedAt = value["updatedAt"];
  if (updatedAt !== null && !isUtcIso(updatedAt)) return false;
  return true;
}

/** The pristine access state: no grant configured, the 90-day default retention, never changed. */
export function defaultGuidanceAccessState(): GuidanceAccessState {
  return { grantedRoles: [], retentionDays: GUIDANCE_EVENT_RETENTION_DAYS, updatedAt: null };
}

/** The signed body of a role token: who may read, of which tenant, and for how long. */
export interface GuidanceRoleTokenPayload {
  readonly tenantId: UuidV7;
  readonly role: Role;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

const GUIDANCE_ROLE_TOKEN_PAYLOAD_KEYS = new Set(["tenantId", "role", "issuedAt", "expiresAt"]);

/** True when `value` is a {@link GuidanceRoleTokenPayload}: exactly its keys, never throws. */
export function isGuidanceRoleTokenPayload(value: unknown): value is GuidanceRoleTokenPayload {
  if (!isRecord(value)) return false;
  for (const key of Object.keys(value)) if (!GUIDANCE_ROLE_TOKEN_PAYLOAD_KEYS.has(key)) return false;
  return (
    isUuidV7(value["tenantId"]) && isRole(value["role"]) && isUtcIso(value["issuedAt"]) && isUtcIso(value["expiresAt"])
  );
}

/** One minted role token, as the registry answers it. */
export interface GuidanceRoleToken {
  /** `${keyId}.${body}.${base64url(signature)}` for an `Authorization: Bearer` header. */
  readonly token: string;
  readonly role: Role;
  readonly expiresAt: string;
}

const GUIDANCE_ROLE_TOKEN_KEYS = new Set(["token", "role", "expiresAt"]);

/** True when `value` is a {@link GuidanceRoleToken}: exactly its keys, never throws. */
export function isGuidanceRoleToken(value: unknown): value is GuidanceRoleToken {
  if (!isRecord(value)) return false;
  for (const key of Object.keys(value)) if (!GUIDANCE_ROLE_TOKEN_KEYS.has(key)) return false;
  return typeof value["token"] === "string" && value["token"] !== "" && isRole(value["role"]) && isUtcIso(value["expiresAt"]);
}

const BASE64URL = /^[A-Za-z0-9_-]*$/;
const BASE64 = /^[A-Za-z0-9+/=]*$/;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Standard base64 of ASCII bytes, without padding handling on input (callers pad). Never throws on byte arrays. */
function base64Encode(bytes: readonly number[]): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const first = bytes[i] ?? 0;
    const second = i + 1 < bytes.length ? (bytes[i + 1] ?? 0) : 0;
    const third = i + 2 < bytes.length ? (bytes[i + 2] ?? 0) : 0;
    const triple = (first << 16) | (second << 8) | third;
    out += ALPHABET[(triple >> 18) & 63] ?? "";
    out += ALPHABET[(triple >> 12) & 63] ?? "";
    out += i + 1 < bytes.length ? (ALPHABET[(triple >> 6) & 63] ?? "") : "=";
    out += i + 2 < bytes.length ? (ALPHABET[triple & 63] ?? "") : "=";
  }
  return out;
}

/** Decode standard base64 to bytes. Returns `undefined` on any malformed input. Never throws. */
function base64Decode(base64: string): number[] | undefined {
  if (!BASE64.test(base64) || base64.length % 4 !== 0) return undefined;
  const bytes: number[] = [];
  for (let i = 0; i < base64.length; i += 4) {
    const sextets: number[] = [];
    for (let j = 0; j < 4; j += 1) {
      const char = base64[i + j] ?? "";
      if (char === "=") {
        if (i + 4 !== base64.length || j < 2) return undefined;
        sextets.push(0);
      } else {
        const sextet = ALPHABET.indexOf(char);
        if (sextet === -1) return undefined;
        sextets.push(sextet);
      }
    }
    const triple = ((sextets[0] ?? 0) << 18) | ((sextets[1] ?? 0) << 12) | ((sextets[2] ?? 0) << 6) | (sextets[3] ?? 0);
    bytes.push((triple >> 16) & 255);
    if (base64[i + 2] !== "=") bytes.push((triple >> 8) & 255);
    if (base64[i + 3] !== "=") bytes.push(triple & 255);
  }
  return bytes;
}

/**
 * Encode a role-token payload to its signable body: base64url of the
 * canonical JSON UTF-8 bytes. The payload alphabet (UUIDs, role names, ISO
 * instants) is ASCII-only, so the encoder rejects anything above code point
 * 127 rather than guessing an encoding. Never throws on a well-formed
 * payload; throws a `TypeError` on non-ASCII input.
 */
export function encodeRoleTokenBody(payload: GuidanceRoleTokenPayload): string {
  const json = canonicalJson({ tenantId: payload.tenantId, role: payload.role, issuedAt: payload.issuedAt, expiresAt: payload.expiresAt });
  const bytes: number[] = [];
  for (let i = 0; i < json.length; i += 1) {
    const code = json.charCodeAt(i);
    if (code > 127) throw new TypeError("encodeRoleTokenBody needs an ASCII-only payload");
    bytes.push(code);
  }
  return toBase64Url(base64Encode(bytes));
}

/**
 * Decode a role-token body back to its parsed JSON (the caller still guards
 * it with {@link isGuidanceRoleTokenPayload}). Returns `undefined` on any
 * malformed input. Never throws.
 */
export function decodeRoleTokenBody(body: unknown): unknown {
  if (typeof body !== "string" || body === "" || !BASE64URL.test(body)) return undefined;
  const bytes = base64Decode(fromBase64Url(body));
  if (bytes === undefined) return undefined;
  let json = "";
  for (const byte of bytes) json += String.fromCharCode(byte);
  try {
    return JSON.parse(json) as unknown;
  } catch {
    return undefined;
  }
}

/** Standard base64 to base64url (also strips padding). Never throws on strings. */
export function toBase64Url(base64: string): string {
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Base64url to standard base64 (restores padding). Never throws on strings. */
export function fromBase64Url(base64url: string): string {
  const padded = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const remainder = padded.length % 4;
  return remainder === 0 ? padded : padded + "=".repeat(4 - remainder);
}
