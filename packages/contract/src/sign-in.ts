/**
 * The registry's sign-in wire contract (Story 1.3): the HTTP paths, request
 * and response bodies, error codes and runtime guards shared by the registry
 * (which serves them) and the panel (which calls them over HTTP).
 */
import { isRole } from "./accounts.ts";
import type { Role } from "./accounts.ts";
import { isRecord, isUtcIso } from "./guards.ts";
import { isUuidV7 } from "./ids.ts";
import type { UuidV7 } from "./ids.ts";

/** Registry HTTP API paths. */
export const REGISTRY_API_PATHS = {
  /** `POST` a {@link SignInLinkRequest}: 202 `{}` for every well-formed email. */
  signInLinks: "/v1/sign-in-links",
  /** `POST` a {@link SessionCreateRequest}: 201 {@link SessionCreated}, or 401 `sign_in_link_invalid`. */
  sessions: "/v1/sessions",
  /** `GET` with `Authorization: Bearer <session token>`: 200 {@link SessionInfo}, or 401 `session_invalid`. */
  session: "/v1/session",
  /**
   * `POST` a {@link SignInLinkRequest} naming one of the {@link DEMO_ACCOUNTS}:
   * 201 {@link SessionCreated} with no emailed link. Served only when the
   * registry runs with `REGISTRY_DEMO_SIGN_IN=1` (staging); 404 otherwise.
   */
  demoSessions: "/v1/demo-sessions",
} as const;

/**
 * The demo Company for staging and pilot testing: three accounts, one per
 * role, that sign in without an emailed link. Never active in production: the
 * registry provisions and serves them only with `REGISTRY_DEMO_SIGN_IN=1`, and
 * the panel offers them only with `PANEL_DEMO_SIGN_IN=1` (both set only in the
 * `fly.*-staging.toml` files).
 */
export const DEMO_COMPANY = "Demo Pilot";

export const DEMO_ACCOUNTS: readonly { readonly name: string; readonly email: string; readonly role: Role }[] = [
  { name: "Demo Buyer", email: "buyer@demo.domainharness.test", role: "Buyer" },
  { name: "Demo Standard Owner", email: "owner@demo.domainharness.test", role: "Standard owner" },
  { name: "Demo Builder", email: "builder@demo.domainharness.test", role: "Builder" },
];

/** True when `email` (in any case or padding) is one of the {@link DEMO_ACCOUNTS}. */
export function isDemoEmail(email: string): boolean {
  const address = normalizeEmail(email);
  return DEMO_ACCOUNTS.some((account) => account.email === address);
}

/** The link was malformed, unknown, already used or expired. One code for all, so none is distinguishable. */
export const SIGN_IN_LINK_INVALID = "sign_in_link_invalid";
/** The session token was missing, malformed, unknown or expired. */
export const SESSION_INVALID = "session_invalid";

/** A sign-in link stays valid for this many minutes, and works once. */
export const SIGN_IN_LINK_TTL_MINUTES = 15;
/** A session lasts this many hours. */
export const SESSION_TTL_HOURS = 12;

/** Body of `POST /v1/sign-in-links`. */
export interface SignInLinkRequest {
  readonly email: string;
}

/** Body of `POST /v1/sessions`: the token from the emailed link. */
export interface SessionCreateRequest {
  readonly token: string;
}

/** Who a session belongs to. */
export interface SessionInfo {
  readonly accountId: UuidV7;
  readonly tenantId: UuidV7;
  readonly role: Role;
}

/** Response of `POST /v1/sessions`. */
export interface SessionCreated {
  /** Opaque bearer token for `GET /v1/session`; the panel keeps it in an HttpOnly cookie. */
  readonly sessionToken: string;
  /** UTC ISO-8601. */
  readonly expiresAt: string;
  readonly session: SessionInfo;
}

// Deliberately loose: one "@", no whitespace, a dot in the domain.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trim and lower-case an email; the stored and compared form. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** True when `value` is a string that is a well-formed email once normalized. Never throws. */
export function isEmailAddress(value: unknown): value is string {
  return typeof value === "string" && EMAIL.test(normalizeEmail(value));
}

/** True when `value` is a {@link SessionInfo}. Never throws. */
export function isSessionInfo(value: unknown): value is SessionInfo {
  return (
    isRecord(value) && isUuidV7(value["accountId"]) && isUuidV7(value["tenantId"]) && isRole(value["role"])
  );
}

/** True when `value` is a {@link SessionCreated}. Never throws. */
export function isSessionCreated(value: unknown): value is SessionCreated {
  return (
    isRecord(value) &&
    typeof value["sessionToken"] === "string" &&
    value["sessionToken"] !== "" &&
    isUtcIso(value["expiresAt"]) &&
    isSessionInfo(value["session"])
  );
}
