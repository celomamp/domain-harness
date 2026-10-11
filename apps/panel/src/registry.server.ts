/**
 * The panel's only way to the registry: its JSON HTTP API. Every response is
 * checked against the contract guards; anything else (network failure,
 * timeout, unexpected status or body) is reported as `unavailable`, never
 * thrown, so a registry outage cannot break a page.
 */
import { isErrorEnvelope, isSessionCreated, isSessionInfo, REGISTRY_API_PATHS } from "@domain-harness/contract";
import type { ErrorEnvelope, SessionCreated, SessionInfo } from "@domain-harness/contract";

export const DEFAULT_REGISTRY_URL = "http://127.0.0.1:4100";
const TIMEOUT_MS = 5_000;

export type RegistryResult<T> =
  | { readonly kind: "ok"; readonly value: T }
  | { readonly kind: "refused"; readonly error: ErrorEnvelope }
  | { readonly kind: "unavailable" };

/** `PANEL_REGISTRY_URL`, or the local default; without a trailing slash. */
export function registryBaseUrl(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const value = env["PANEL_REGISTRY_URL"]?.trim();
  return (value === undefined || value === "" ? DEFAULT_REGISTRY_URL : value).replace(/\/+$/, "");
}

async function call<T>(
  path: string,
  init: RequestInit,
  okStatus: number,
  guard: (value: unknown) => value is T,
): Promise<RegistryResult<T>> {
  let response: Response;
  try {
    response = await fetch(`${registryBaseUrl()}${path}`, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    return { kind: "unavailable" };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { kind: "unavailable" };
  }
  if (response.status === okStatus && guard(body)) return { kind: "ok", value: body };
  if (response.status >= 400 && response.status < 500 && isErrorEnvelope(body)) return { kind: "refused", error: body };
  return { kind: "unavailable" };
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json" },
  body: JSON.stringify(body),
});

const isEmptyObject = (value: unknown): value is Record<string, never> =>
  typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length === 0;

/** Ask the registry to email sign-in links for `email` (202 `{}` whether or not an account exists). */
export function requestSignInLink(email: string): Promise<RegistryResult<Record<string, never>>> {
  return call(REGISTRY_API_PATHS.signInLinks, json({ email }), 202, isEmptyObject);
}

/** Exchange an emailed link token for a session. */
export function createSession(token: string): Promise<RegistryResult<SessionCreated>> {
  return call(REGISTRY_API_PATHS.sessions, json({ token }), 201, isSessionCreated);
}

/** Who the session token belongs to. */
export function getSession(sessionToken: string): Promise<RegistryResult<SessionInfo>> {
  return call(
    REGISTRY_API_PATHS.session,
    { method: "GET", headers: { authorization: `Bearer ${sessionToken}`, accept: "application/json" } },
    200,
    isSessionInfo,
  );
}
