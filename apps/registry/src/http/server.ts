import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import {
  isEmailAddress,
  MODULE_API_PATHS,
  MODULE_NAME_TAKEN,
  MODULE_NOT_FOUND,
  REGISTRY_API_PATHS,
  ROLE_DENIED,
  SESSION_INVALID,
  SIGN_IN_LINK_INVALID,
} from "@domain-harness/contract";
import type { ErrorEnvelope, SessionInfo } from "@domain-harness/contract";
import { isEnvelopeError } from "../errors.ts";
import { assertBuyer } from "../modules/service.ts";
import type { ModuleService } from "../modules/service.ts";
import type { SignInService } from "../sign-in/service.ts";

/** Request bodies larger than this are refused with 413. */
export const MAX_BODY_BYTES = 4 * 1024;

/** One structured log line: ids, codes, statuses and counts only, never emails, tokens or links. */
export type LogEvent = Readonly<Record<string, string | number>>;
export type Logger = (event: LogEvent) => void;

/** Writes each event as one JSON line to stdout. */
export const stdoutLogger: Logger = (event) => {
  process.stdout.write(`${JSON.stringify(event)}\n`);
};

const STATUS_BY_CODE: Readonly<Record<string, number>> = {
  invalid_input: 400,
  [SIGN_IN_LINK_INVALID]: 401,
  [SESSION_INVALID]: 401,
  [ROLE_DENIED]: 403,
  not_found: 404,
  [MODULE_NOT_FOUND]: 404,
  method_not_allowed: 405,
  [MODULE_NAME_TAKEN]: 409,
  payload_too_large: 413,
  unsupported_media_type: 415,
};

/** The logged name of the one parameterised route. */
const MODULE_OWNER_ROUTE = `${MODULE_API_PATHS.modules}/{id}/owner`;
const MODULE_OWNER_PATH = /^\/v1\/modules\/([^/]+)\/owner$/;

/** Allowed methods per route. */
const ROUTES: Readonly<Record<string, readonly string[]>> = {
  [REGISTRY_API_PATHS.signInLinks]: ["POST"],
  [REGISTRY_API_PATHS.sessions]: ["POST"],
  [REGISTRY_API_PATHS.session]: ["GET"],
  [MODULE_API_PATHS.modules]: ["GET", "POST"],
  [MODULE_OWNER_ROUTE]: ["POST"],
};

interface RouteMatch {
  /** A key of {@link ROUTES}, or "unmatched". */
  readonly route: string;
  /** The raw `{id}` path segment of the owner route. */
  readonly moduleId?: string;
}

function matchRoute(path: string): RouteMatch {
  if (path in ROUTES) return { route: path };
  const owner = MODULE_OWNER_PATH.exec(path);
  if (owner?.[1] !== undefined) {
    let moduleId: string;
    try {
      moduleId = decodeURIComponent(owner[1]);
    } catch {
      moduleId = owner[1];
    }
    return { route: MODULE_OWNER_ROUTE, moduleId };
  }
  return { route: "unmatched" };
}

/** The services the HTTP API serves. */
export interface RegistryServices {
  readonly signIn: SignInService;
  readonly modules: ModuleService;
}

class HttpFailure extends Error {
  readonly envelope: ErrorEnvelope;
  constructor(envelope: ErrorEnvelope) {
    super(envelope.message);
    this.envelope = envelope;
  }
}

/**
 * The registry's internal JSON API: sign-in and Modules. Every error is one
 * `{ code, message, subject }` envelope. Module calls authenticate with
 * `Authorization: Bearer <session token>`; creating a Module or assigning its
 * owner is refused with `role_denied` for any role but the Buyer, before the
 * body is read.
 *
 * `POST /v1/sign-in-links` answers 202 `{}` for every well-formed email before
 * any lookup happens, then mints and sends links after the response is
 * finished, so neither the status, the body nor the timing reveals whether an
 * account exists.
 */
export function createRegistryServer(services: RegistryServices, log: Logger = stdoutLogger): Server {
  return createServer((req, res) => {
    const started = performance.now();
    const path = requestPath(req.url);
    const match = matchRoute(path);
    res.on("finish", () => {
      log({
        event: "http_request",
        method: req.method ?? "",
        route: match.route,
        status: res.statusCode,
        ms: Math.round(performance.now() - started),
      });
    });
    handle(services, log, req, res, path, match).catch((error: unknown) => {
      if (error instanceof HttpFailure) {
        sendError(res, error.envelope);
        return;
      }
      if (isEnvelopeError(error) && error.code in STATUS_BY_CODE) {
        sendError(res, error.toEnvelope());
        return;
      }
      // Unexpected: report the code only; driver messages can echo row values.
      log({ event: "internal_error", code: isEnvelopeError(error) ? error.code : "unexpected" });
      sendError(res, { code: "internal_error", message: "the registry could not complete the request", subject: "request" });
    });
  });
}

async function handle(
  services: RegistryServices,
  log: Logger,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  match: RouteMatch,
): Promise<void> {
  const methods = ROUTES[match.route];
  if (methods === undefined) {
    throw new HttpFailure({ code: "not_found", message: "no such registry endpoint", subject: path });
  }
  if (req.method === undefined || !methods.includes(req.method)) {
    const allowed = methods.join(", ");
    res.setHeader("Allow", allowed);
    throw new HttpFailure({ code: "method_not_allowed", message: `use ${allowed}`, subject: path });
  }
  const service = services.signIn;

  switch (match.route) {
    case REGISTRY_API_PATHS.signInLinks: {
      const body = await readJson(req);
      const email = onlyField(body, "email");
      if (!isEmailAddress(email)) {
        throw new HttpFailure({ code: "invalid_input", message: "email must be an email address", subject: "email" });
      }
      // Answer first, identically for every well-formed address; then start the
      // work, whether or not the client stays connected.
      sendJson(res, 202, {});
      setImmediate(() => {
        service.requestSignInLinks(email).then(
          (report) => {
            log({ event: "sign_in_links", links: report.links, sent: report.sent, failed: report.failed });
          },
          (error: unknown) => {
            log({ event: "sign_in_links_failed", code: isEnvelopeError(error) ? error.code : "unexpected" });
          },
        );
      });
      return;
    }
    case REGISTRY_API_PATHS.sessions: {
      const body = await readJson(req);
      const token = onlyField(body, "token");
      if (typeof token !== "string" || token === "") {
        throw new HttpFailure({ code: "invalid_input", message: "token must be a non-empty string", subject: "token" });
      }
      sendJson(res, 201, await service.createSession(token));
      return;
    }
    case REGISTRY_API_PATHS.session: {
      sendJson(res, 200, await service.getSession(bearerToken(req)));
      return;
    }
    case MODULE_API_PATHS.modules: {
      const session = await service.getSession(bearerToken(req));
      if (req.method === "GET") {
        sendJson(res, 200, await services.modules.listModules(session));
        return;
      }
      requireBuyer(req, session);
      const body = fields(await readJson(req), ["kind", "name"]);
      sendJson(res, 201, await services.modules.createModule(session, { kind: body["kind"], name: body["name"] }));
      return;
    }
    default: {
      // MODULE_OWNER_ROUTE
      const session = await service.getSession(bearerToken(req));
      requireBuyer(req, session);
      const body = fields(await readJson(req), ["accountId"]);
      const module = await services.modules.assignModuleOwner(session, match.moduleId ?? "", {
        accountId: body["accountId"],
      });
      sendJson(res, 200, module);
    }
  }
}

/** `role_denied` before the body is read (it is drained, never parsed) unless the session is the Buyer's. */
function requireBuyer(req: IncomingMessage, session: SessionInfo): void {
  try {
    assertBuyer(session);
  } catch (error) {
    req.resume();
    throw error;
  }
}

/** The token of an `Authorization: Bearer <token>` header (scheme in any case), or `session_invalid`. */
function bearerToken(req: IncomingMessage): string {
  const header = req.headers.authorization ?? "";
  const match = /^Bearer +(\S+)$/i.exec(header);
  if (match?.[1] === undefined) {
    req.resume();
    throw new HttpFailure({
      code: SESSION_INVALID,
      message: "the session is not valid or has expired",
      subject: "session",
    });
  }
  return match[1];
}

/** The request path, or "" (an unmatched route) when the target cannot be parsed. */
function requestPath(target: string | undefined): string {
  try {
    return new URL(target ?? "/", "http://registry.invalid").pathname;
  } catch {
    return "";
  }
}

/**
 * Read and parse a JSON body of at most {@link MAX_BODY_BYTES}. The body must be
 * declared `application/json`, so a CORS-simple cross-site POST (text/plain,
 * form encoding) is refused before it is read.
 */
async function readJson(req: IncomingMessage): Promise<unknown> {
  const mediaType = (req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    req.resume();
    throw new HttpFailure({
      code: "unsupported_media_type",
      message: "the request body must be sent as application/json",
      subject: "content-type",
    });
  }
  const declared = Number(req.headers["content-length"] ?? "0");
  if (declared > MAX_BODY_BYTES) {
    req.resume();
    throw tooLarge();
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      req.resume();
      throw tooLarge();
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new HttpFailure({ code: "invalid_input", message: "the request body must be JSON", subject: "body" });
  }
}

function tooLarge(): HttpFailure {
  return new HttpFailure({
    code: "payload_too_large",
    message: `the request body exceeds ${String(MAX_BODY_BYTES)} bytes`,
    subject: "body",
  });
}

/** The value of `field` when `body` is an object with exactly that one key; otherwise `invalid_input`. */
function onlyField(body: unknown, field: string): unknown {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new HttpFailure({ code: "invalid_input", message: `the body must be { "${field}": ... }`, subject: "body" });
  }
  const record = body as Record<string, unknown>;
  const extra = Object.keys(record).find((key) => key !== field);
  if (extra !== undefined) {
    throw new HttpFailure({ code: "invalid_input", message: "the body has an unsupported field", subject: extra });
  }
  return record[field];
}

/**
 * `body` as a record when it is an object whose keys are all among `allowed`;
 * otherwise `invalid_input`. A missing field is left undefined for the
 * service to report under its own name.
 */
function fields(body: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new HttpFailure({
      code: "invalid_input",
      message: `the body must be an object with ${allowed.join(", ")}`,
      subject: "body",
    });
  }
  const record = body as Record<string, unknown>;
  const extra = Object.keys(record).find((key) => !allowed.includes(key));
  if (extra !== undefined) {
    throw new HttpFailure({ code: "invalid_input", message: "the body has an unsupported field", subject: extra });
  }
  return record;
}

function sendError(res: ServerResponse, envelope: ErrorEnvelope): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  sendJson(res, STATUS_BY_CODE[envelope.code] ?? 500, envelope);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    "Cache-Control": "no-store",
  });
  res.end(text);
}
