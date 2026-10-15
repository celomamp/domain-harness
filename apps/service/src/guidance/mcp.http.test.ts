/**
 * HTTP suite for the Guidance MCP adapter (Story 4.4): an in-process
 * `node:http` server (no database — the InMemory twins) with a real SDK
 * client over Streamable HTTP. Pins tools/list (exactly the four contract
 * tools), a hit, a miss, an unbound flow, the stale flag, the per-request
 * identity headers, and the protocol-layer refusal of a subject the contract
 * schema rejects.
 */
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { createServer } from "node:http";
import type { Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { canonicalJson, GUIDANCE_TOOLS, GUIDANCE_IDENTITY_HEADERS } from "@domain-harness/contract";
import type { GuidanceToolResult, StandardBundlePayload, UuidV7 } from "@domain-harness/contract";
import { createGuidanceMcpHandler } from "./mcp.ts";
import type { GuidanceMcpDeps } from "./mcp.ts";
import { createInMemoryGuidanceIdentityStore } from "./store.ts";
import { bundledState } from "../bundles/puller.ts";
import { createInMemoryBundleRecordStore } from "../bundles/store.ts";
import { bundleHashOf } from "../bundles/verify.ts";
import { makeBundlePayload, makeSigningKey, signPayload } from "../bundles/test-fixtures.ts";

const TENANT = "018f3d2a-7000-7000-8000-000000000100" as UuidV7;
const APPLICATION_ID = "018f3d2a-7000-7000-8000-000000000001" as UuidV7;
const ROOT = "018f3d2a-7000-7000-8000-000000000110" as UuidV7;
const WEB = "018f3d2a-7000-7000-8000-000000000112" as UuidV7;
const FP_1 = "1".repeat(64);

const NOW = "2026-10-14T12:00:00.000Z";
const ISSUED = "2026-10-14T06:00:00.000Z";

// node:http lowercases header names.
const HEADER_KEYS = {
  applicationId: GUIDANCE_IDENTITY_HEADERS.applicationId.toLowerCase(),
  advisoryProjectId: GUIDANCE_IDENTITY_HEADERS.advisoryProjectId.toLowerCase(),
  repoFingerprint: GUIDANCE_IDENTITY_HEADERS.repoFingerprint.toLowerCase(),
};

/** The identity headers of a bound Application. */
const BOUND_HEADERS = {
  [HEADER_KEYS.repoFingerprint]: FP_1,
  [HEADER_KEYS.applicationId]: APPLICATION_ID,
  [HEADER_KEYS.advisoryProjectId]: WEB,
};

let nextId = 300;
function standardId(): UuidV7 {
  nextId += 1;
  return `018f3d2a-7000-7000-8000-0000000${String(nextId).padStart(5, "0")}` as UuidV7;
}

const PUBLISHER = { accountId: "018f3d2a-7000-7000-8000-000000000140" as UuidV7, name: "Bea" };

function standard(project: UuidV7, entry: StandardBundlePayload["standards"][number]["entry"]): StandardBundlePayload["standards"][number] {
  return {
    id: standardId(),
    version: 1,
    module: { id: "018f3d2a-7000-7000-8000-000000000120" as UuidV7, kind: "code-stack", name: "Backend" },
    project: { id: project, name: "Scope" },
    entry,
    publishedAt: ISSUED,
    publishedBy: PUBLISHER,
  };
}

function payloadOf(issuedAt: string = ISSUED): StandardBundlePayload {
  return {
    ...makeBundlePayload({ keyId: "mcp-http-key", sequence: 1, issuedAt }),
    frozen: false,
    standards: [
      standard(ROOT, { category: "library", name: "React", versionConstraint: null, status: "approved", correctionInstruction: null }),
      standard(WEB, { kind: "component", name: "Button", usageRule: "Use a Button for every clickable action.", tokens: [], correctionInstruction: null }),
      standard(WEB, { kind: "token", name: "AccentBorder", status: "required" }),
    ],
    tree: {
      rootId: ROOT,
      projects: [
        { id: ROOT, name: "Root", levelName: null, parentId: null, createdAt: ISSUED },
        { id: WEB, name: "Web", levelName: null, parentId: ROOT, createdAt: ISSUED },
      ],
      lockedRules: [],
    },
    applications: [{ id: APPLICATION_ID, projectId: WEB, fromFlow: true }],
  };
}

interface Fixture {
  readonly serverUrl: string;
  readonly httpServer: HttpServer;
}

/** One in-process guidance server (no DB): the InMemory twins behind the real MCP handler at `/mcp`. */
async function setup(issuedAt: string = ISSUED): Promise<Fixture> {
  const payload = payloadOf(issuedAt);
  const signed = signPayload(payload, makeSigningKey("mcp-http-key"));
  const hash = bundleHashOf(signed);
  const bundleStore = createInMemoryBundleRecordStore();
  await bundleStore.activate(signed, hash, TENANT);
  const deps: GuidanceMcpDeps = {
    tenantId: TENANT,
    identityStore: createInMemoryGuidanceIdentityStore(),
    getPinnedBundle: () => Promise.resolve({ payload, hash }),
    getBundledState: (now) => bundledState(bundleStore, TENANT, now),
    now: () => NOW,
  };
  const httpServer = createServer((request, response) => {
    void createGuidanceMcpHandler(deps)(request, response);
  });
  await new Promise<void>((resolve) => {
    httpServer.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });
  const address = httpServer.address() as AddressInfo;
  return { serverUrl: `http://127.0.0.1:${String(address.port)}/mcp`, httpServer };
}

/** A connected SDK client whose every HTTP request carries `headers` (identity is re-read per request server-side). */
async function connectedClient(url: string, headers: Record<string, string>): Promise<Client> {
  const client = new Client({ name: "http-suite-client", version: "0.0.0" }, { capabilities: {} });
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } }) as unknown as Transport);
  return client;
}

/** The first text content of a call-tool answer, whatever shape the SDK returns. */
function textOf(answer: unknown): string {
  const content =
    typeof answer === "object" && answer !== null && "content" in answer ? (answer as { content?: unknown }).content : undefined;
  const text = Array.isArray(content) ? (content[0] as { text?: unknown } | undefined)?.text : undefined;
  if (typeof text !== "string") throw new Error("the tool answer carried no text content");
  return text;
}

async function stop(fixture: Fixture, client: Client | null): Promise<void> {
  await client?.close().catch(() => undefined);
  await new Promise<void>((resolve) => {
    fixture.httpServer.close(() => {
      resolve();
    });
  });
}

describe("the Guidance MCP server over Streamable HTTP", () => {
  it("lists exactly the four contract tools with their versioned descriptions and schemas", async () => {
    const fixture = await setup();
    let client: Client | null = null;
    try {
      client = await connectedClient(fixture.serverUrl, BOUND_HEADERS);
      const listing = await client.listTools();
      expect(listing.tools).toHaveLength(4);
      expect(listing.tools.map((tool) => tool.name)).toEqual(GUIDANCE_TOOLS.map((tool) => tool.name));
      for (const tool of listing.tools) {
        const descriptor = GUIDANCE_TOOLS.find((candidate) => candidate.name === tool.name);
        expect(descriptor).toBeDefined();
        expect(tool.description).toBe(descriptor?.description);
        expect(tool.inputSchema).toEqual(descriptor?.inputSchema);
      }
    } finally {
      await stop(fixture, client);
    }
  });

  it("answers a bound call with a hit whose text is the canonical typed result quoting the pinned bundle hash", async () => {
    const fixture = await setup();
    let client: Client | null = null;
    try {
      client = await connectedClient(fixture.serverUrl, BOUND_HEADERS);
      const answer = await client.callTool({ name: "code_stack_rule", arguments: { subject: "react" } });
      const text = textOf(answer);
      const result = JSON.parse(text) as GuidanceToolResult;
      expect(result.kind).toBe("hit");
      if (result.kind === "hit") {
        expect(result.subject).toBe("react");
        expect(result.bundleHash).toMatch(/^[0-9a-f]{64}$/);
        expect(result.stale).toBe(false);
        expect(result.content).toBe("The library React is approved.");
      }
      expect(text).toBe(canonicalJson(result));
    } finally {
      await stop(fixture, client);
    }
  });

  it("answers a component call through its usage rule and a miss with its one sentence, with no prior briefing call", async () => {
    const fixture = await setup();
    let client: Client | null = null;
    try {
      client = await connectedClient(fixture.serverUrl, BOUND_HEADERS);
      const usage = JSON.parse(textOf(await client.callTool({ name: "design_component", arguments: { subject: "clickable action" } }))) as GuidanceToolResult;
      expect(usage.kind).toBe("hit");
      if (usage.kind === "hit") expect(usage.content).toContain("Use a Button for every clickable action.");
      const miss = JSON.parse(textOf(await client.callTool({ name: "design_import", arguments: { subject: "~/acme/unknown" } }))) as GuidanceToolResult;
      expect(miss).toMatchObject({
        kind: "miss",
        subject: "~/acme/unknown",
        sentence: "the active bundle holds no design import covering ~/acme/unknown",
        stale: false,
      });
      const token = JSON.parse(textOf(await client.callTool({ name: "design_token", arguments: { subject: "AccentBorder" } }))) as GuidanceToolResult;
      expect(token).toMatchObject({ kind: "hit", content: "The design token AccentBorder is required." });
    } finally {
      await stop(fixture, client);
    }
  });

  it("answers a caller whose identity names no Application in the bundle with the unbound sentence and no Standards", async () => {
    const fixture = await setup();
    let client: Client | null = null;
    try {
      // The right fingerprint, an id the bundle does not carry.
      const headers = { [HEADER_KEYS.repoFingerprint]: FP_1, [HEADER_KEYS.applicationId]: "018f3d2a-7000-7000-8000-000000000999" as UuidV7 };
      client = await connectedClient(fixture.serverUrl, headers);
      const unbound = JSON.parse(textOf(await client.callTool({ name: "code_stack_rule", arguments: { subject: "react" } }))) as GuidanceToolResult;
      expect(unbound).toEqual({ kind: "unbound", reason: "unknown_application", sentence: "unbound Application" });
      expect("bundleHash" in unbound).toBe(false);
    } finally {
      await stop(fixture, client);
    }
  });

  it("flags staleness on every answer when the active bundle is past its bound and not frozen", async () => {
    const fixture = await setup("2026-10-12T00:00:00.000Z");
    let client: Client | null = null;
    try {
      client = await connectedClient(fixture.serverUrl, BOUND_HEADERS);
      const hit = JSON.parse(textOf(await client.callTool({ name: "code_stack_rule", arguments: { subject: "react" } }))) as GuidanceToolResult;
      expect(hit).toMatchObject({ kind: "hit", stale: true });
      if (hit.kind === "hit") expect(hit.content).toBe("The library React is approved.\nbundle stale");
      const miss = JSON.parse(textOf(await client.callTool({ name: "code_stack_rule", arguments: { subject: "vue" } }))) as GuidanceToolResult;
      expect(miss.kind).toBe("miss");
      if (miss.kind === "miss") {
        expect(miss.stale).toBe(true);
        expect(miss.sentence).toContain("bundle stale");
      }
    } finally {
      await stop(fixture, client);
    }
  });

  it("refuses a missing, empty subject or unknown tool name at the protocol layer and serves a whitespace-only subject as a miss", async () => {
    const fixture = await setup();
    let client: Client | null = null;
    try {
      client = await connectedClient(fixture.serverUrl, BOUND_HEADERS);
      await expect(client.callTool({ name: "code_stack_rule", arguments: {} })).rejects.toMatchObject({ code: -32602 });
      await expect(client.callTool({ name: "code_stack_rule", arguments: { subject: "" } })).rejects.toMatchObject({ code: -32602 });
      await expect(client.callTool({ name: "not_a_tool", arguments: { subject: "react" } })).rejects.toMatchObject({ code: -32602 });
      const blank = JSON.parse(textOf(await client.callTool({ name: "code_stack_rule", arguments: { subject: "   " } }))) as GuidanceToolResult;
      expect(blank).toMatchObject({ kind: "miss", subject: "   " });
    } finally {
      await stop(fixture, client);
    }
  });

  it("enforces the published schema exactly: the 1..1000 code-point bound, and no argument key beyond subject", async () => {
    const fixture = await setup();
    let client: Client | null = null;
    try {
      client = await connectedClient(fixture.serverUrl, BOUND_HEADERS);
      // 1000 code points (one astral character is two UTF-16 units: 2000
      // units) is inside the bound and reaches the serving unit as a miss.
      const atBound = JSON.parse(textOf(await client.callTool({ name: "design_import", arguments: { subject: "🦋".repeat(500) } }))) as GuidanceToolResult;
      expect(atBound).toMatchObject({ kind: "miss", subject: "🦋".repeat(500) });
      // 1001 code points is outside it, however many UTF-16 units.
      await expect(client.callTool({ name: "code_stack_rule", arguments: { subject: "x".repeat(1001) } })).rejects.toMatchObject({ code: -32602 });
      await expect(client.callTool({ name: "code_stack_rule", arguments: { subject: "🦋".repeat(1001) } })).rejects.toMatchObject({ code: -32602 });
      // A schema-valid subject alongside an unknown key is invalid params.
      await expect(
        client.callTool({ name: "code_stack_rule", arguments: { subject: "react", tool: "code_stack_rule" } }),
      ).rejects.toMatchObject({ code: -32602 });
    } finally {
      await stop(fixture, client);
    }
  });

  it("answers requests the MCP protocol does not need identically: GET is refused with 405, never a hanging stream", async () => {
    const fixture = await setup();
    try {
      const response = await fetch(fixture.serverUrl, { headers: { accept: "text/event-stream" } });
      expect(response.status).toBe(405);
      expect(await response.json()).toMatchObject({ code: "method_not_allowed" });
    } finally {
      await stop(fixture, null);
    }
  });
});
