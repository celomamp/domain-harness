/**
 * The optional Bearer gate on `/mcp`: when the Guidance endpoint is exposed
 * outside the Company network (the pilot's hosted endpoint), every MCP
 * request carries `Authorization: Bearer <SERVICE_GUIDANCE_ACCESS_TOKEN>`.
 * Unset, the endpoint stays open as inside the Company network. Constant-time
 * compare and one indistinguishable refusal for missing, malformed or wrong
 * tokens (the Read API precedent).
 */
import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { ErrorEnvelope } from "@domain-harness/contract";
import { SESSION_INVALID } from "@domain-harness/contract";

/** Whether `request` may reach the MCP handler; always `true` when no token is configured. */
export function mcpAccessGranted(request: IncomingMessage, accessToken: string | null): boolean {
  if (accessToken === null) return true;
  const match = /^Bearer +(\S+)$/i.exec(request.headers.authorization ?? "");
  const provided = match?.[1];
  if (provided === undefined) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(accessToken, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The one refusal answered with 401 when {@link mcpAccessGranted} is `false`. */
export function mcpAccessDenied(): ErrorEnvelope {
  return { code: SESSION_INVALID, message: "the Guidance access token is not valid", subject: "session" };
}
