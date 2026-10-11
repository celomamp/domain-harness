/**
 * The session cookie: the registry's opaque session token, HttpOnly,
 * SameSite=Lax, Path=/, Secure unless the panel is plainly local http, and
 * expiring with the registry session.
 */
export const SESSION_COOKIE = "dh_session";

// Tokens are "<uuidv7>.<base64url>"; anything else in the cookie is ignored.
const COOKIE_VALUE = /^[0-9a-f-]{36}\.[A-Za-z0-9_-]+$/;

/** The session token from the request's Cookie header, if present and well-formed. */
export function readSessionToken(request: Request): string | undefined {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) {
      const value = rest.join("=");
      return COOKIE_VALUE.test(value) ? value : undefined;
    }
  }
  return undefined;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Secure on https, behind a TLS-terminating proxy (`X-Forwarded-Proto: https`),
 * and on any host other than localhost; omitted only for local http development.
 */
function secure(request: Request): string {
  const url = new URL(request.url);
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  const isSecure = url.protocol === "https:" || forwarded === "https" || !LOCAL_HOSTS.has(url.hostname);
  return isSecure ? "; Secure" : "";
}

/** `Set-Cookie` for a new session that expires at `expiresAt` (UTC ISO-8601). */
export function sessionCookie(request: Request, token: string, expiresAt: string, now: number = Date.now()): string {
  const maxAge = Math.max(0, Math.floor((Date.parse(expiresAt) - now) / 1000));
  return `${SESSION_COOKIE}=${token}; Max-Age=${String(maxAge)}; Path=/; HttpOnly; SameSite=Lax${secure(request)}`;
}

/** `Set-Cookie` that removes the session cookie. */
export function clearSessionCookie(request: Request): string {
  return `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secure(request)}`;
}
