// The Company Standards service Guidance MCP server (Story 4.4). Run from
// the repository root with
// `node --conditions=@domain-harness/source apps/service/src/guidance/server-cli.ts`.
// Configuration comes only from the environment:
//   SERVICE_TENANT_ID             this Company's tenant id (UUIDv7)
//   SERVICE_RECORD_DATABASE_URL   connection string of the record store (shared with the bundles and CI Gate stores)
//   SERVICE_GUIDANCE_PORT         optional inbound port; default 8080
//
// The server serves the four Guidance tools over Streamable HTTP at `/mcp`,
// without authentication: it is reachable only inside the Company network
// (the container publishes no other inbound port; authentication is a
// deployment concern the network edge handles). Start-up is one envelope:
// the record store is opened and migrated, then the MCP server binds. Every
// request is logged as one id-and-code event that never carries subject
// text; each tool call answers exactly one typed result, with nothing
// cached about identity across requests. Any start-up error prints exactly
// one { code, message, subject } envelope to stderr and exits 1.
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ErrorEnvelope, UuidV7 } from "@domain-harness/contract";
import type { Pool } from "pg";
import { migrate } from "../db/migrate.ts";
import { createPool, createPostgresBundleRecordStore } from "../bundles/store.ts";
import { bundledState } from "../bundles/puller.ts";
import { guidanceServiceConfigFromEnv } from "./config.ts";
import type { GuidanceServiceConfig } from "./config.ts";
import { createPostgresGuidanceIdentityStore } from "./store.ts";
import { createPostgresGuidanceEventStore } from "./events.ts";
import { createGuidanceMcpHandler, GUIDANCE_MCP_PATH } from "./mcp.ts";
import type { PinnedActiveBundle } from "./identity.ts";

const RECORD_DATABASE_URL = "SERVICE_RECORD_DATABASE_URL";

/** One structured log line: ids, codes, statuses and counts only, never subject text. */
export type LogEvent = Readonly<Record<string, string | number>>;
export type Logger = (event: LogEvent) => void;

/** Writes each event as one JSON line to stdout (the registry's house pattern). */
export const stdoutLogger: Logger = (event) => {
  process.stdout.write(`${JSON.stringify(event)}\n`);
};

function envelopeOf(error: unknown, fallback: ErrorEnvelope): ErrorEnvelope {
  if (
    typeof error === "object" &&
    error !== null &&
    typeof (error as Record<string, unknown>)["code"] === "string" &&
    typeof (error as Record<string, unknown>)["subject"] === "string" &&
    typeof (error as Record<string, unknown>)["message"] === "string"
  ) {
    const record = error as Record<string, unknown>;
    return { code: String(record["code"]), message: String(record["message"]), subject: String(record["subject"]) };
  }
  return fallback;
}

class GuidanceStartError extends Error implements ErrorEnvelope {
  readonly code: string;
  readonly subject: string;
  readonly envelope: ErrorEnvelope;

  constructor(envelope: ErrorEnvelope) {
    super(envelope.message);
    this.name = "GuidanceStartError";
    this.code = envelope.code;
    this.subject = envelope.subject;
    this.envelope = envelope;
  }
}

/**
 * The tenant's pinned active bundle through the bundles unit: the
 * active-bundle pointer, then the hash-keyed bundle row. This is the shape
 * both the identity unit and the serving unit read the bundle through.
 */
export async function pinnedActiveBundle(
  store: ReturnType<typeof createPostgresBundleRecordStore>,
  tenantId: UuidV7,
): Promise<PinnedActiveBundle | null> {
  const pointer = await store.getPointer(tenantId);
  if (pointer === null) return null;
  const pinned = await store.pinnedBundle(pointer.hash);
  if (pinned === null) return null;
  return { payload: pinned.payload, hash: pointer.hash };
}

/**
 * The guidance HTTP server for a started record store: the bundle and
 * guidance identity stores over one pool, the MCP handler at `/mcp`, and
 * id-and-code logging. Every request answers exactly one response; a
 * request that is not the endpoint answers 404, never a hang.
 */
export function createGuidanceHttpServer(config: GuidanceServiceConfig, pool: Pool, log: Logger = stdoutLogger): Server {
  const bundleStore = createPostgresBundleRecordStore(pool);
  const identityStore = createPostgresGuidanceIdentityStore(pool);
  const eventStore = createPostgresGuidanceEventStore(pool);
  const handler = createGuidanceMcpHandler({
    tenantId: config.tenantId,
    identityStore,
    eventStore,
    // A record failure never changes the typed answer; the hook carries ids
    // and the tool only — never subject text (NFR-9).
    onRecordError: ({ applicationId, tool }) => {
      log({ event: "guidance_record_error", code: "record_failed", applicationId, tool });
    },
    getPinnedBundle: (tenantId) => pinnedActiveBundle(bundleStore, tenantId),
    getBundledState: (now) => bundledState(bundleStore, config.tenantId, now),
  });

  return createServer((request: IncomingMessage, response: ServerResponse) => {
    const started = performance.now();
    const path = endpointPath(request.url);
    const handled =
      path === GUIDANCE_MCP_PATH
        ? handler(request, response)
        : notFound(response, path);
    handled.catch(() => {
      // Unexpected failure outside the MCP layer: one envelope, codes only.
      log({ event: "internal_error", code: "unexpected" });
      if (!response.headersSent) {
        respondEnvelope(response, 500, {
          code: "guidance_failed",
          message: "the guidance server could not complete the request",
          subject: "request",
        });
        return;
      }
      response.destroy();
    });
    response.on("finish", () => {
      log({
        event: "http_request",
        method: request.method ?? "",
        route: path === GUIDANCE_MCP_PATH ? "guidance_mcp" : "unmatched",
        status: response.statusCode,
        ms: Math.round(performance.now() - started),
      });
    });
  });
}

function respondEnvelope(response: ServerResponse, status: number, envelope: ErrorEnvelope): void {
  if (response.headersSent) {
    response.destroy();
    return;
  }
  const body = JSON.stringify(envelope);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  response.end(body);
}

/** Every path but the MCP endpoint answers 404 exactly once. */
function notFound(response: ServerResponse, path: string): Promise<void> {
  respondEnvelope(response, 404, { code: "not_found", message: "only the Guidance MCP endpoint is served", subject: path });
  return Promise.resolve();
}

/** The request path, or "" (an unmatched request) when the target cannot be parsed. */
function endpointPath(target: string | undefined): string {
  try {
    return new URL(target ?? "/", "http://guidance.invalid").pathname;
  } catch {
    return "";
  }
}

/**
 * Open and migrate the record store; a connection failure throws the
 * one-envelope start error for `main` to print and exit on. The pool is
 * shared by the bundle and guidance identity stores.
 */
export async function openRecordStore(config: GuidanceServiceConfig): Promise<Pool> {
  const pool = createPool(config.recordDatabaseUrl);
  let client;
  try {
    client = await pool.connect();
  } catch (cause) {
    await endQuietly(pool);
    throw new GuidanceStartError(
      envelopeOf(cause, {
        code: "database_unavailable",
        message: "could not connect to the record store",
        subject: RECORD_DATABASE_URL,
      }),
    );
  }
  // A reachable database that fails its migrations is a different defect
  // from an unreachable one: its own envelope, so diagnosis is not misdirected.
  try {
    await migrate(client);
  } catch (cause) {
    await endQuietly(pool);
    throw new GuidanceStartError(
      envelopeOf(cause, {
        code: "migration_failed",
        message: "could not migrate the record store",
        subject: RECORD_DATABASE_URL,
      }),
    );
  } finally {
    client.release();
  }
  return pool;
}

/** End the pool, swallowing a shutdown failure while another error propagates. */
async function endQuietly(pool: Pool): Promise<void> {
  try {
    await pool.end();
  } catch {
    // The connection or migration failure is the one reported.
  }
}

async function main(): Promise<void> {
  const config = guidanceServiceConfigFromEnv(process.env);
  const pool = await openRecordStore(config);
  const server = createGuidanceHttpServer(config, pool);

  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => {
      resolve();
    });
    server.once("error", (error: Error) => {
      reject(
        new GuidanceStartError(
          envelopeOf(error, {
            code: "invalid_configuration",
            message: "the guidance server could not bind its port",
            subject: "SERVICE_GUIDANCE_PORT",
          }),
        ),
      );
    });
    server.listen(config.port);
  });

  const stopping = new Promise<void>((resolve) => {
    process.once("SIGINT", () => {
      resolve();
    });
    process.once("SIGTERM", () => {
      resolve();
    });
  });

  stdoutLogger({ event: "guidance_started", port: config.port, tenantId: config.tenantId, endpoint: GUIDANCE_MCP_PATH });

  await stopping;
  server.close();
  // A keep-alive client holding an idle connection must not keep the
  // process alive past `guidance_stopped`; Node < 18.2 does not carry the
  // method, so the call is feature-detected.
  if (typeof server.closeIdleConnections === "function") {
    server.closeIdleConnections();
  }
  try {
    await pool.end();
  } catch {
    // The process is exiting regardless.
  }
  stdoutLogger({ event: "guidance_stopped" });
}

/** Run the entry only when this file is the process's main module (bridge.ts precedent: keeps the module importable in tests). */
function isDirectEntry(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return pathToFileURL(resolve(entry)).href === import.meta.url;
  } catch {
    return false;
  }
}

if (isDirectEntry()) {
  main().catch((error: unknown) => {
    const envelope = envelopeOf(error, {
      code: "guidance_start_failed",
      message: "the guidance server could not start",
      subject: "guidance",
    });
    // Exit only once the flush completes, so piped stderr cannot lose the one
    // required envelope.
    process.stderr.write(`${JSON.stringify(envelope)}\n`, () => {
      process.exit(1);
    });
  });
}
