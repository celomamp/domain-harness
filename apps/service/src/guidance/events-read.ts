/**
 * The Company Guidance-event read endpoint (Story 6.7): `GET
 * /v1/guidance-events` inside the Company network, gated by a registry-issued
 * role token. The panel never calls this endpoint and never renders what it
 * answers (AD-22).
 *
 * Check order, first failure wins: method (405 `method_not_allowed` with
 * `Allow: GET`; method is orthogonal like the Read API) → token (one
 * indistinguishable 401 `session_invalid`, subject `session`, for a missing,
 * malformed, expired, foreign-tenant or forged token) → filters (400
 * `invalid_input` naming `applicationId` or `gaps`) → the store. Unknown
 * applications answer 200 with an empty list. Every denial carries no
 * content; every request is safe to log as ids and codes.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  GUIDANCE_EVENT_READ_PATH,
  SESSION_INVALID,
  isUuidV7,
} from "@domain-harness/contract";
import type { ErrorEnvelope, UuidV7 } from "@domain-harness/contract";
import { respondEnvelope } from "./mcp.ts";
import type { GuidanceEventStore } from "./events.ts";
import { verifyRoleToken } from "./role-tokens.ts";
import type { BundleTrustSet } from "../bundles/verify.ts";

/** The dependencies one Guidance-event read handler serves. */
export interface GuidanceEventReadDeps {
  /** The single tenant, from `SERVICE_TENANT_ID`. */
  readonly tenantId: UuidV7;
  /** keyId → Ed25519 public key of the vendor registry, from `SERVICE_ROLE_TOKEN_TRUST_KEYS`. */
  readonly trustSet: BundleTrustSet;
  /** The Guidance event store (the Postgres twin in production). */
  readonly eventStore: GuidanceEventStore;
  /** The current time in milliseconds; defaults to `Date.now` (injectable for tests). */
  readonly nowMs?: () => number;
}

/** The per-request route label for ids/codes-only logs (never subject text). */
export type GuidanceEventReadRouteLabel = "read_guidance_events";

/** True when `path` is the Guidance-event read path. */
export function isGuidanceEventReadPath(path: string): boolean {
  return path === GUIDANCE_EVENT_READ_PATH;
}

/** The one indistinguishable token refusal (the Read API `credentialInvalid` verbatim). */
function tokenInvalid(): ErrorEnvelope {
  return { code: SESSION_INVALID, message: "the role token is not valid", subject: "session" };
}

/** The Bearer token of an `Authorization: Bearer <token>` header (scheme in any case), or undefined. */
function bearerToken(request: IncomingMessage): string | undefined {
  const header = request.headers.authorization ?? "";
  const match = /^Bearer +(\S+)$/i.exec(header);
  return match?.[1];
}

function invalidInput(subject: string, message: string): ErrorEnvelope {
  return { code: "invalid_input", message, subject };
}

/**
 * Handle one Guidance-event read request. Returns `true` when `path` is the
 * read path (the response was sent); `false` otherwise, so the caller keeps
 * its existing 404. Never throws to the caller.
 */
export async function handleGuidanceEventRead(
  deps: GuidanceEventReadDeps,
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
): Promise<boolean> {
  if (!isGuidanceEventReadPath(path)) return false;

  // Method is orthogonal: no write handler exists for the read path.
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    respondEnvelope(response, 405, {
      code: "method_not_allowed",
      message: "use GET for Guidance-event reads",
      subject: path,
    });
    return true;
  }

  // Token before anything is parsed: missing, malformed, expired,
  // foreign-tenant or forged share one envelope with no content.
  const token = bearerToken(request);
  const verdict = verifyRoleToken({
    token,
    tenantId: deps.tenantId,
    trustSet: deps.trustSet,
    nowMs: deps.nowMs?.() ?? Date.now(),
  });
  if (!verdict.ok) {
    respondEnvelope(response, 401, tokenInvalid());
    return true;
  }

  let query: URLSearchParams;
  try {
    query = new URL(request.url ?? "/", "http://guidance.invalid").searchParams;
  } catch {
    respondEnvelope(response, 400, invalidInput("query", "the request target could not be parsed"));
    return true;
  }
  const rawApplicationId = query.get("applicationId");
  if (rawApplicationId !== null && !isUuidV7(rawApplicationId)) {
    respondEnvelope(response, 400, invalidInput("applicationId", "applicationId must be a UUIDv7"));
    return true;
  }
  const applicationId = rawApplicationId === null ? undefined : rawApplicationId;
  const rawGaps = query.get("gaps");
  if (rawGaps !== null && rawGaps !== "true" && rawGaps !== "false") {
    respondEnvelope(response, 400, invalidInput("gaps", "gaps must be true or false"));
    return true;
  }

  const events =
    rawGaps === "true"
      ? await deps.eventStore.listGuidanceGaps(applicationId)
      : await deps.eventStore.listGuidanceEvents(applicationId);
  sendJson(response, 200, { events: [...events] });
  return true;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    "Cache-Control": "no-store",
  });
  response.end(text);
}
