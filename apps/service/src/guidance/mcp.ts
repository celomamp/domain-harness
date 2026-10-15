/**
 * The MCP adapter (Story 4.4): the Guidance server's serving surface. It
 * builds one Server instance per HTTP request (the SDK's stateless Streamable
 * HTTP mode), registering exactly the four contract tools
 * (`@domain-harness/contract`, GUIDANCE_TOOLS) whose descriptors and request
 * schema are versioned there.
 *
 * Serving is stateless per request: the identity headers are read from EVERY
 * HTTP request (GUIDANCE_IDENTITY_HEADERS) and handed to the serving unit
 * together with the call's tool, subject and now — no session, no caching of
 * identity across requests, no prior briefing call, no blocking of the
 * agent's turn. Each tool result is the typed `GuidanceToolResult` serialized
 * deterministically (`canonicalJson`) as the response's single text content.
 *
 * The contract schema (`subject` string, 1..1000) is enforced at the protocol
 * layer: a truly absent or empty subject is one JSON-RPC invalid-params
 * error; a whitespace-only subject still reaches the serving unit and
 * answers `miss`. An unknown tool name is refused the same way. Only POST
 * requests carry MCP calls; the entry answers other methods with 405 — no
 * standalone SSE stream is ever opened, so nothing can block an agent's turn
 * on this server.
 */
import { canonicalJson, GUIDANCE_IDENTITY_HEADERS, GUIDANCE_TOOL_SUBJECT_MAX, GUIDANCE_TOOLS, isGuidanceToolName, isGuidanceToolSubject } from "@domain-harness/contract";
import type { GuidanceToolName, UuidV7 } from "@domain-harness/contract";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from "@modelcontextprotocol/sdk/types.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { serveGuidanceCall } from "./serve.ts";
import type { GuidanceIdentityHeaders, PinnedActiveBundle } from "./identity.ts";
import type { GuidanceIdentityStore } from "./store.ts";
import type { GuidanceEventStore } from "./events.ts";
import type { BundledStateOutcome } from "../bundles/puller.ts";

/** The versioned path the Streamable HTTP endpoint serves. */
export const GUIDANCE_MCP_PATH = "/mcp";

/** The server info the MCP initialization reports (ids and codes only). */
export const GUIDANCE_SERVER_INFO = { name: "domain-harness-guidance", version: "1.0.0" } as const;

/** The dependencies one guidance MCP handler serves. */
export interface GuidanceMcpDeps {
  readonly tenantId: UuidV7;
  /** Story 4.3's identity store: the one binding check every surface shares. */
  readonly identityStore: GuidanceIdentityStore;
  /** Story 4.5's event store: every bound `hit`/`miss` appends one row here. */
  readonly eventStore: GuidanceEventStore;
  /** The ids-only record-error hook, passed through to the serving unit. */
  readonly onRecordError?: ((input: { readonly applicationId: UuidV7; readonly tool: GuidanceToolName; readonly error: unknown }) => void) | undefined;
  /** The pinned active bundle through the bundles unit. */
  readonly getPinnedBundle: (tenantId: UuidV7) => Promise<PinnedActiveBundle | null>;
  /** The staleness view through `bundledState`. */
  readonly getBundledState: (now: string) => Promise<BundledStateOutcome>;
  /** The clock of a call; defaults to the system time. */
  readonly now?: () => string;
}

/** A ready-to-mount Streamable HTTP request listener (the `/mcp` endpoint). */
export type GuidanceMcpHandler = (request: IncomingMessage, response: ServerResponse) => Promise<void>;

/**
 * Build the handler for the `/mcp` endpoint: per HTTP request one stateless
 * transport plus one Server instance registering exactly the four contract
 * tools, then the transport reads and answers the request. Never throws to
 * the caller; a per-request failure is surfaced only as that request's
 * JSON-RPC error.
 */
export function createGuidanceMcpHandler(deps: GuidanceMcpDeps): GuidanceMcpHandler {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    await handleMcpRequest(deps, request, response);
  };
}

async function handleMcpRequest(deps: GuidanceMcpDeps, request: IncomingMessage, response: ServerResponse): Promise<void> {
  // Only POSTs carry MCP calls; every other method is refused before the
  // transport can open a stream that would keep a request — and an agent's
  // turn — waiting.
  if (request.method !== "POST") {
    respondEnvelope(response, 405, {
      code: "method_not_allowed",
      message: "use POST for the Guidance MCP endpoint",
      subject: "method",
    });
    return;
  }
  // The high-level McpServer is held for its lifecycle only: the tool
  // handlers are registered on its inner low-level server, because the tool
  // descriptors and the request schema are versioned JSON in
  // `@domain-harness/contract` — not a zod shape the high level would
  // translate. Nothing else of the high level is used.
  const mcpServer = new McpServer(GUIDANCE_SERVER_INFO, { capabilities: { tools: {} } });
  const server = mcpServer.server;
  // Stateless mode: no `sessionIdGenerator` — every request is served by
  // this fresh transport/server pair, no session state is kept, and the
  // JSON response body (never an SSE stream) answers within the request.
  const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
  // The per-request stateless transport is finished when the response ends;
  // one transport handles exactly one HTTP request.
  response.on("close", () => {
    void server.close().catch(() => undefined);
  });

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: GUIDANCE_TOOLS,
  }));
  server.setRequestHandler(
    CallToolRequestSchema,
    // The SDK's Server converts every error — an McpError with its code —
    // into exactly one JSON-RPC error response for this request.
    async (call) => toolCallResult(deps, request, call.params.name, call.params.arguments),
  );

  try {
    // The SDK's node transport type declares its callbacks optional exactly
    // where the transport interface declares them required; the wire shape
    // is the interface's, so this is one documented cast, not a behavior.
    await server.connect(transport as unknown as Transport);
    await transport.handleRequest(request, response);
  } catch {
    if (!response.headersSent) {
      respondEnvelope(response, 500, {
        code: "guidance_failed",
        message: "the guidance server could not complete the request",
        subject: "request",
      });
      return;
    }
    response.destroy();
  }
}

/** The typed result of one tool call, or the protocol-layer rejection. */
async function toolCallResult(
  deps: GuidanceMcpDeps,
  request: IncomingMessage,
  toolName: unknown,
  args: Record<string, unknown> | undefined,
): Promise<{ readonly content: readonly { readonly type: "text"; readonly text: string }[] }> {
  if (!isGuidanceToolName(toolName)) {
    // The contract schema is the tools/list vocabulary; anything else is not a tool.
    throw new McpError(ErrorCode.InvalidParams, `"${String(toolName)}" is not a Guidance tool`);
  }
  const callArguments = args ?? {};
  // The versioned schema declares `additionalProperties: false`: anything
  // beyond the one `subject` key is invalid params, exactly as published.
  if (Object.keys(callArguments).some((key) => key !== "subject")) {
    throw new McpError(ErrorCode.InvalidParams, "subject is the only accepted argument field");
  }
  const subject = callArguments["subject"];
  // The contract schema's one required `subject` string of 1..1000 code
  // points (JSON Schema's own count, not UTF-16 units), enforced by the
  // same guard the contract's result checks use: a missing, empty or
  // oversized value is invalid params; a whitespace-only subject is a valid
  // string and still reaches the serving unit.
  if (!isGuidanceToolSubject(subject)) {
    throw new McpError(ErrorCode.InvalidParams, `subject must be a string of 1..${String(GUIDANCE_TOOL_SUBJECT_MAX)} characters`);
  }
  const result = await serveGuidanceCall({
    headers: readIdentityHeaders(request),
    tool: toolName,
    subject,
    tenantId: deps.tenantId,
    now: (deps.now ?? defaultNow)(),
    identityStore: deps.identityStore,
    eventStore: deps.eventStore,
    onRecordError: deps.onRecordError,
    getPinnedBundle: deps.getPinnedBundle,
    getBundledState: deps.getBundledState,
  });
  return { content: [{ type: "text", text: canonicalJson(result) }] };
}

function defaultNow(): string {
  return new Date().toISOString();
}

/**
 * The identity headers of THIS HTTP request; presence is the whole wire
 * vocabulary (the bridge sends a header exactly when its value was
 * computable), so a blank value is treated as absent rather than as data.
 */
export function readIdentityHeaders(request: IncomingMessage): GuidanceIdentityHeaders {
  return {
    applicationId: firstHeader(request, GUIDANCE_IDENTITY_HEADERS.applicationId),
    advisoryProjectId: firstHeader(request, GUIDANCE_IDENTITY_HEADERS.advisoryProjectId),
    repoFingerprint: firstHeader(request, GUIDANCE_IDENTITY_HEADERS.repoFingerprint),
  };
}

function firstHeader(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  if (value === undefined) return undefined;
  const first = Array.isArray(value) ? value[0] : value;
  if (first === undefined || first.trim() === "") return undefined;
  return first;
}

/** One house error envelope for requests the MCP layer does not answer. */
export function respondEnvelope(response: ServerResponse, status: number, envelope: { code: string; message: string; subject: string }): void {
  const body = JSON.stringify(envelope);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  response.end(body);
}
