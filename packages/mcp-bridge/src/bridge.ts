/**
 * The stdio MCP bridge (Story 4.3): a Builder's agent starts
 * `@domain-harness/mcp-bridge <endpoint URL>` in its repository and speaks
 * MCP over stdio; the bridge forwards every message to that endpoint over
 * Streamable HTTP, injecting the versioned identity headers
 * (`@domain-harness/contract`, GUIDANCE_IDENTITY_HEADERS) recomputed per
 * message — the identification file of the current working directory and the
 * repository fingerprint are read at call time, never cached.
 *
 * Identity is never complete for the bridge to judge: a missing value simply
 * means an absent header, and every call is forwarded — the service decides
 * every identity outcome. A forwarding or transport failure surfaces as a
 * JSON-RPC error on stdout (the MCP stream) while the bridge keeps running;
 * stderr carries no subject text, and nothing but the MCP stream is written
 * to stdout. A missing or invalid endpoint URL is a start-up failure: one
 * `{ code, message, subject }` envelope on stderr, exit 1.
 */
import { GUIDANCE_IDENTITY_HEADERS, MCP_BRIDGE_PACKAGE } from "@domain-harness/contract";
import type { ErrorEnvelope } from "@domain-harness/contract";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { endpointUrlFromArgv } from "./configuration.ts";
import { computeBridgeFingerprint, readIdentificationFile } from "./identity.ts";
import { pathToFileURL } from "node:url";
import type { Readable, Writable } from "node:stream";

/** The stdio streams the bridge speaks MCP over. */
export interface BridgeStreams {
  readonly stdin: Readable;
  readonly stdout: Writable;
  /** The directory the identification file and the fingerprint describe. */
  readonly identityRoot: string;
}

/** The transport failure surfaced as one JSON-RPC error (RFC: internal error). */
const TRANSPORT_FAILURE_CODE = -32603;
const TRANSPORT_FAILURE_MESSAGE = "the bridge could not forward the call to the Guidance endpoint";

function isRequestLike(message: JSONRPCMessage): message is Extract<JSONRPCMessage, { id: string | number }> {
  return "method" in message && "id" in message;
}

/**
 * Run the bridge over the given stdio streams until the stdio side closes.
 * Every message received on stdin is forwarded to the endpoint over
 * Streamable HTTP with identity headers recomputed per HTTP request from
 * `identityRoot` (the process working directory); messages arriving from the
 * endpoint are written to stdout. A failed forward answers the local client
 * with one JSON-RPC error for a request and keeps the bridge running.
 */
export async function runBridge(endpoint: URL, streams: BridgeStreams): Promise<void> {
  // Identity is recomputed by this fetch on every HTTP request the transport
  // makes (each forwarded MCP message and each SSE stream): presence is the
  // whole vocabulary, an uncomputable value means an absent header.
  const identityFetch: FetchLike = async (url, init) => {
    const identityRoot = streams.identityRoot;
    const file = readIdentificationFile(identityRoot);
    const fingerprint = computeBridgeFingerprint(identityRoot);
    const headers = new Headers(init?.headers);
    if (file.applicationId !== undefined) headers.set(GUIDANCE_IDENTITY_HEADERS.applicationId, file.applicationId);
    if (file.advisoryProjectId !== undefined) {
      headers.set(GUIDANCE_IDENTITY_HEADERS.advisoryProjectId, file.advisoryProjectId);
    }
    if (fingerprint !== undefined) headers.set(GUIDANCE_IDENTITY_HEADERS.repoFingerprint, fingerprint);
    return await fetch(url, { ...init, headers });
  };

  const stdio = new StdioServerTransport(streams.stdin, streams.stdout);
  const http = new StreamableHTTPClientTransport(endpoint, { fetch: identityFetch });

  let stdioClosed: (() => void) | null = null;
  const closed = new Promise<void>((resolve) => {
    stdioClosed = resolve;
  });

  // Transport-level conditions are not fatal: the bridge keeps running and
  // neither stream carries any subject text.
  http.onerror = () => undefined;
  http.onclose = () => undefined;
  stdio.onerror = () => undefined;

  stdio.onmessage = (message: JSONRPCMessage) => {
    void (async () => {
      try {
        await http.send(message);
      } catch {
        // The forward failed; answer the local client for a request it is
        // waiting on and keep the bridge running.
        if (isRequestLike(message)) {
          const failure: JSONRPCMessage = {
            jsonrpc: "2.0",
            id: message.id,
            error: { code: TRANSPORT_FAILURE_CODE, message: TRANSPORT_FAILURE_MESSAGE },
          };
          await stdio.send(failure).catch(() => undefined);
        }
      }
    })();
  };

  // Every message the endpoint returns is written to the MCP stream on stdout.
  http.onmessage = (message: JSONRPCMessage) => {
    void stdio.send(message).catch(() => undefined);
  };

  stdio.onclose = () => {
    stdioClosed?.();
  };

  // The MCP client closing its stdin ends the session: stop cleanly (the
  // transport's own onclose fires only on close(), not on stream end). A
  // stdin `error` event ends the session the same way — without it the run
  // loop could never resolve and the process would hang.
  streams.stdin.once("end", () => {
    stdioClosed?.();
  });
  streams.stdin.once("error", () => {
    stdioClosed?.();
  });

  // Callbacks are installed; only now start reading stdin.
  await stdio.start();
  await http.start();
  await closed;
  await http.close().catch(() => undefined);
}

async function main(): Promise<void> {
  const endpoint = endpointUrlFromArgv(process.argv);
  await runBridge(endpoint, { stdin: process.stdin, stdout: process.stdout, identityRoot: process.cwd() });
}

/** Run the entry only when this file is the process's main module. */
function isDirectEntry(): boolean {
  return process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isDirectEntry()) {
  main().catch((error: unknown) => {
    const fallback: ErrorEnvelope = {
      code: "bridge_start_failed",
      message: "the bridge could not start",
      subject: MCP_BRIDGE_PACKAGE,
    };
    const record = typeof error === "object" && error !== null ? (error as Record<string, unknown>) : {};
    const envelope: ErrorEnvelope = {
      code: typeof record["code"] === "string" ? record["code"] : fallback.code,
      message: typeof record["message"] === "string" ? record["message"] : fallback.message,
      subject: typeof record["subject"] === "string" ? record["subject"] : fallback.subject,
    };
    // Exit only once the flush completes, so piped stderr cannot lose the one
    // required envelope.
    process.stderr.write(`${JSON.stringify(envelope)}\n`, () => {
      process.exit(1);
    });
  });
}
