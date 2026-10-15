/**
 * The Company Read API handler (Story 4.6): the credentialed, read-only HTTP
 * surface served from the pinned active bundle through the shared derivation
 * Guidance uses (`joinEffectiveSet` — never a second resolver).
 *
 * Check order per route, first failure wins: credential (401) → bundle
 * presence (404 `not_found`, subject `bundle`) → payload guard (500
 * `bundle_unreadable`, subject `bundle`) → project/core (malformed or unknown
 * id → 404 `project_not_found` subject `projectId`; core's error as is, e.g.
 * 409 `slot_conflict`; a missing join target → 500 `bundle_unreadable`).
 * Method is orthogonal: any non-GET to a Read API path answers 405
 * `method_not_allowed` and the router holds no write handler. The credential
 * check runs before anything is parsed (registry compilations-route
 * precedent): `Authorization: Bearer <SERVICE_READ_CREDENTIAL>` (scheme
 * case-insensitive, registry `bearerToken` precedent), constant-time compare
 * (`timingSafeEqual`, registry `authenticateCredential` precedent), one
 * indistinguishable 401 envelope for missing, malformed or wrong credentials.
 */
import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  BUNDLE_UNREADABLE,
  READ_API_PATHS,
  SESSION_INVALID,
  effectiveStandardsPath,
  isStandardBundlePayload,
  isUuidV7,
} from "@domain-harness/contract";
import type { ErrorEnvelope, UuidV7 } from "@domain-harness/contract";
import { respondEnvelope } from "../guidance/mcp.ts";
import type { PinnedActiveBundle } from "../guidance/identity.ts";
import { joinEffectiveSet } from "./effective.ts";

/** The dependencies one Read API handler serves. */
export interface ReadApiDeps {
  /** The single tenant, from `SERVICE_TENANT_ID`. */
  readonly tenantId: UuidV7;
  /** The opaque shared secret, from required `SERVICE_READ_CREDENTIAL` (never logged). */
  readonly readCredential: string;
  /** The pinned active bundle through the bundles unit (pointer → hash-keyed row). */
  readonly getPinnedBundle: (tenantId: UuidV7) => Promise<PinnedActiveBundle | null>;
}

/** The per-request route label for ids/codes-only logs (never subject text). */
export type ReadRouteLabel = "read_standards" | "read_effective_standards";

const EFFECTIVE_PATTERN = /^\/v1\/projects\/([^/]+)\/effective-standards$/;

const STATUS_BY_CODE: Readonly<Record<string, number>> = {
  invalid_input: 400,
  [SESSION_INVALID]: 401,
  not_found: 404,
  project_not_found: 404,
  method_not_allowed: 405,
  slot_conflict: 409,
  project_cycle: 409,
  locked_rule_conflict: 409,
  [BUNDLE_UNREADABLE]: 500,
};

/** The one indistinguishable credential refusal (registry `credentialInvalid` verbatim). */
function credentialInvalid(): ErrorEnvelope {
  return { code: SESSION_INVALID, message: "the service credential is not valid", subject: "session" };
}

function statusOf(envelope: ErrorEnvelope): number {
  return STATUS_BY_CODE[envelope.code] ?? 500;
}

/** True when `path` is either Read API route (the Effective set via its registry spelling). */
export function isReadApiPath(path: string): boolean {
  return readRouteOf(path) !== null;
}

/** The read route of `path`, or `null` when it is not a Read API path. */
export function readRouteOf(path: string): ReadRouteLabel | null {
  if (path === READ_API_PATHS.standards) return "read_standards";
  // The Effective set reuses the registry spelling (`effectiveStandardsPath`):
  // same truth, different host. A decode failure is still a read path — the
  // handler answers 404 `project_not_found`, never the generic 404.
  const segment = EFFECTIVE_PATTERN.exec(path)?.[1];
  if (segment === undefined) return null;
  let id: string;
  try {
    id = decodeURIComponent(segment);
  } catch {
    return "read_effective_standards";
  }
  return path === effectiveStandardsPath(id) ? "read_effective_standards" : null;
}

/** The raw `{id}` segment of an Effective set path, decoded, or "" when it cannot be decoded. */
function effectiveProjectId(path: string): string {
  const segment = EFFECTIVE_PATTERN.exec(path)?.[1] ?? "";
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** The Bearer token of an `Authorization: Bearer <token>` header (scheme in any case), or undefined. */
function bearerToken(request: IncomingMessage): string | undefined {
  const header = request.headers.authorization ?? "";
  const match = /^Bearer +(\S+)$/i.exec(header);
  return match?.[1];
}

/** Constant-time credential compare (registry `authenticateCredential` precedent). */
function credentialsEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function projectNotFound(): ErrorEnvelope {
  return {
    code: "project_not_found",
    message: "no such Project in this Company; nothing was changed",
    subject: "projectId",
  };
}

/**
 * Handle one Read API request. Returns `true` when `path` is a Read API path
 * (the response was sent); `false` otherwise, so the caller keeps its
 * existing 404. Never throws to the caller beyond the store's own transport
 * errors, which are answered as `bundle_unreadable`.
 */
export async function handleReadRequest(
  deps: ReadApiDeps,
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
): Promise<boolean> {
  const route = readRouteOf(path);
  if (route === null) return false;

  // Method is orthogonal: no write handler exists for any Read API path.
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    respondEnvelope(response, 405, {
      code: "method_not_allowed",
      message: "use GET for the Company Read API",
      subject: path,
    });
    return true;
  }

  // Credential before anything is parsed: missing, malformed or wrong share one envelope.
  const token = bearerToken(request);
  if (token === undefined || !credentialsEqual(token, deps.readCredential)) {
    respondEnvelope(response, 401, credentialInvalid());
    return true;
  }

  let pinned: PinnedActiveBundle | null;
  try {
    pinned = await deps.getPinnedBundle(deps.tenantId);
  } catch {
    respondEnvelope(response, 500, {
      code: BUNDLE_UNREADABLE,
      message: "the active bundle could not be read",
      subject: "bundle",
    });
    return true;
  }
  if (pinned === null) {
    respondEnvelope(response, 404, {
      code: "not_found",
      message: "no bundle exists for this tenant yet",
      subject: "bundle",
    });
    return true;
  }
  if (!isStandardBundlePayload(pinned.payload)) {
    respondEnvelope(response, 500, {
      code: BUNDLE_UNREADABLE,
      message: "the active bundle could not be read",
      subject: "bundle",
    });
    return true;
  }

  if (route === "read_standards") {
    sendJson(response, 200, { bundleHash: pinned.hash, standards: pinned.payload.standards });
    return true;
  }

  const projectId = effectiveProjectId(path);
  if (!isUuidV7(projectId)) {
    const envelope = projectNotFound();
    respondEnvelope(response, statusOf(envelope), envelope);
    return true;
  }
  const joined = joinEffectiveSet(pinned.payload, projectId);
  if (!joined.ok) {
    // Unknown project is `project_not_found`; core's error otherwise as is.
    if (joined.error.code === "project_not_found") {
      const envelope = projectNotFound();
      respondEnvelope(response, statusOf(envelope), envelope);
      return true;
    }
    respondEnvelope(response, statusOf(joined.error), joined.error);
    return true;
  }
  sendJson(response, 200, { bundleHash: pinned.hash, project: joined.set.project, standards: joined.set.standards });
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
