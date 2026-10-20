/**
 * Spawn-style suite for the stdio bridge (Story 4.3): the child runs the
 * bridge entry inside a temporary git repository against a local `node:http`
 * stub that captures every forwarded request's headers and body and serves
 * canned JSON-RPC responses. The suite pins the call-time identity
 * vocabulary (each header sent exactly when its value was computable,
 * recomputed per message with no caching), the one-envelope start-up
 * failure, the JSON-RPC error on transport failure while the bridge keeps
 * running, and the executed package name against the contract constant.
 */
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { Server, IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, afterAll, describe, expect, it } from "vitest";
import {
  formatIdentificationFile,
  GUIDANCE_IDENTITY_HEADERS,
  IDENTIFICATION_FILE_NAME,
  MCP_BRIDGE_PACKAGE,
} from "@domain-harness/contract";
import type { UuidV7 } from "@domain-harness/contract";
import { endpointUrlFromArgv } from "./configuration.ts";

const BRIDGE_PATH = join(import.meta.dirname, "bridge.ts");
const tempDirs: string[] = [];
const appId = "018f3d2a-7000-7000-8000-000000000001" as UuidV7;
const projectId = "018f3d2a-7000-7000-8000-000000000002" as UuidV7;
const otherProjectId = "018f3d2a-7000-7000-8000-000000000003" as UuidV7;

// node:http lowercases header names.
const HEADER_KEYS = {
  applicationId: GUIDANCE_IDENTITY_HEADERS.applicationId.toLowerCase(),
  advisoryProjectId: GUIDANCE_IDENTITY_HEADERS.advisoryProjectId.toLowerCase(),
  repoFingerprint: GUIDANCE_IDENTITY_HEADERS.repoFingerprint.toLowerCase(),
};

interface CapturedRequest {
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string;
}

function makeStubServer(): { server: Server; requests: CapturedRequest[]; url: Promise<string> } {
  const requests: CapturedRequest[] = [];
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      requests.push({ method: request.method ?? "", headers: request.headers as Record<string, string>, body });
      if (request.method === "GET") {
        // No standalone SSE stream: 405 is the transport's expected "none".
        response.writeHead(405).end();
        return;
      }
      let parsed: { id?: unknown } = {};
      try {
        parsed = JSON.parse(body) as { id?: unknown };
      } catch {
        // Anything else still answers generically below.
      }
      if (typeof parsed.id === "number" || typeof parsed.id === "string") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ jsonrpc: "2.0", id: parsed.id, result: {} }));
        return;
      }
      response.writeHead(202).end();
    });
  });
  const url = new Promise<string>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address !== null && typeof address === "object" ? address.port : 0;
      resolve(`http://127.0.0.1:${String(port)}/v1/guidance`);
    });
  });
  return { server, requests, url };
}

function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

function createScratchDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "dh-bridge-")));
  tempDirs.push(dir);
  return dir;
}

function repoWithCommit(dir: string): string {
  git(dir, ["init", "-q"]);
  git(dir, ["config", "user.email", "builder@acme.test"]);
  git(dir, ["config", "user.name", "Builder"]);
  writeFileSync(join(dir, "README.md"), "# bridge suite\n");
  git(dir, ["add", "README.md"]);
  git(dir, ["commit", "-q", "-m", "initial commit"]);
  return git(dir, ["rev-list", "--max-parents=0", "HEAD"]);
}

interface BridgeSession {
  readonly child: ReturnType<typeof spawn>;
  stdout(): string;
  stderr(): string;
  send(json: unknown): void;
  endStdin(): void;
  waitResponse(id: number, timeoutMs?: number): Promise<string | null>;
  exitCode(): Promise<number | null>;
}

function spawnBridge(args: readonly string[], cwd: string, env: NodeJS.ProcessEnv = process.env): BridgeSession {
  const child = spawn(process.execPath, [BRIDGE_PATH, ...args], { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const session: BridgeSession = {
    child,
    stdout: () => stdout,
    stderr: () => stderr,
    send(json: unknown): void {
      child.stdin.write(`${JSON.stringify(json)}\n`);
    },
    endStdin(): void {
      child.stdin.end();
    },
    async waitResponse(id: number, timeoutMs = 15_000): Promise<string | null> {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        const found = stdout
          .split("\n")
          .find((line) => line.trim() !== "" && line.includes(`"id":${String(id)}`));
        if (found !== undefined) return found;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return null;
    },
    exitCode(): Promise<number | null> {
      return new Promise((resolve) => {
        child.on("exit", (code) => {
          resolve(code);
        });
      });
    },
  };
  return session;
}

describe("endpointUrlFromArgv", () => {
  it("fails with one envelope for a missing, unparsable or non-http endpoint", () => {
    expect(() => endpointUrlFromArgv(["node", "bridge.ts"])).toThrow(/endpoint URL is required/);
    expect(() => endpointUrlFromArgv(["node", "bridge.ts", "not a url"])).toThrow(/must be a URL/);
    expect(() => endpointUrlFromArgv(["node", "bridge.ts", "ftp://example/v1"])).toThrow(/http or https/);
  });
});

const stub = makeStubServer();

beforeAll(async () => {
  await stub.url;
}, 30_000);

afterAll(() => {
  stub.server.close();
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("the executed package name", () => {
  it("matches MCP_BRIDGE_PACKAGE so the Epic 3 boilerplates need no regeneration", async () => {
    const readManifest = await import("../package.json");
    const manifest = (readManifest as { default: { name: string } }).default;
    expect(manifest.name).toBe(MCP_BRIDGE_PACKAGE);
  });
});

describe("the npx bin entry", () => {
  it("resolves the command the Boilerplates declare to the compiled bridge entry", async () => {
    const readManifest = await import("../package.json");
    const manifest = (readManifest as { default: { bin: Record<string, string> | undefined } }).default;
    // The Boilerplates declare `npx -y @domain-harness/mcp-bridge <url>`:
    // npx resolves that command to the bin target ./dist/bridge.js — the
    // compiled bridge.ts, whose import.meta.url then matches the file's
    // entry guard. The source of the pinned target exists here in layout
    // terms; dist is never executed in tests.
    expect(manifest.bin?.["mcp-bridge"]).toBe("./dist/bridge.js");
    expect(existsSync(join(import.meta.dirname, "bridge.ts"))).toBe(true);
  });
});

describe("bridge start-up without a usable URL", () => {
  it("prints exactly one stderr envelope, exits 1 and keeps stdout clean (no argv)", async () => {
    const session = spawnBridge([], createScratchDir());
    const code = await session.exitCode();
    expect(code).toBe(1);
    const lines = session.stderr().split("\n").filter((line) => line.trim() !== "");
    expect(lines).toHaveLength(1);
    const envelope = JSON.parse(lines[0] ?? "{}") as { code?: unknown; message?: unknown; subject?: unknown };
    expect(envelope.code).toBe("missing_configuration");
    expect(envelope.subject).toBe("endpoint");
    expect(typeof envelope.message).toBe("string");
    expect(session.stdout()).toBe("");
  }, 30_000);

  it("prints exactly one stderr envelope, exits 1 and keeps stdout clean (non-http argv)", async () => {
    const session = spawnBridge(["not-a-url"], createScratchDir());
    const code = await session.exitCode();
    expect(code).toBe(1);
    const lines = session.stderr().split("\n").filter((line) => line.trim() !== "");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({ code: "invalid_configuration", subject: "endpoint" });
    expect(session.stdout()).toBe("");
  }, 30_000);
});

describe("every forwarded call carries call-time identity headers", () => {
  it("sends all three headers when the file parses and the repository has a root commit, recomputed per call", async () => {
    const repo = createScratchDir();
    const rootSha = repoWithCommit(repo);
    writeFileSync(join(repo, IDENTIFICATION_FILE_NAME), formatIdentificationFile(appId, projectId));
    const stubUrl = await stub.url;
    stub.requests.length = 0;

    const session = spawnBridge([stubUrl], repo);
    session.send({ jsonrpc: "2.0", id: 1, method: "ping" });
    const first = await session.waitResponse(1);
    expect(first).not.toBeNull();
    expect(JSON.parse(first ?? "{}")).toEqual({ jsonrpc: "2.0", id: 1, result: {} });

    const expectedFingerprint = createHash("sha256").update(rootSha).digest("hex");
    const forwarded = stub.requests.find((request) => request.body.includes('"id":1'));
    expect(forwarded?.headers[HEADER_KEYS.applicationId]).toBe(appId);
    expect(forwarded?.headers[HEADER_KEYS.advisoryProjectId]).toBe(projectId);
    expect(forwarded?.headers[HEADER_KEYS.repoFingerprint]).toBe(expectedFingerprint);

    // A second call recomputes the same identity: no caching across calls.
    stub.requests.length = 0;
    session.send({ jsonrpc: "2.0", id: 2, method: "ping" });
    expect(await session.waitResponse(2)).not.toBeNull();
    const secondForwarded = stub.requests.find((request) => request.body.includes('"id":2'));
    expect(secondForwarded?.headers[HEADER_KEYS.applicationId]).toBe(appId);
    expect(secondForwarded?.headers[HEADER_KEYS.advisoryProjectId]).toBe(projectId);
    expect(secondForwarded?.headers[HEADER_KEYS.repoFingerprint]).toBe(expectedFingerprint);

    // The file is rewritten AND the root commit is amended between calls:
    // the next forwarded call carries the newly read identity and the NEW
    // fingerprint. An amendment is essential — with a fingerprint that never
    // changes mid-session this test could not tell a recomputing bridge from
    // a caching one.
    stub.requests.length = 0;
    writeFileSync(join(repo, IDENTIFICATION_FILE_NAME), formatIdentificationFile(appId, otherProjectId));
    git(repo, ["commit", "--amend", "-m", "reworked initial commit"]);
    const amendedRootSha = git(repo, ["rev-list", "--max-parents=0", "HEAD"]);
    const amendedFingerprint = createHash("sha256").update(amendedRootSha).digest("hex");
    expect(amendedFingerprint).not.toBe(expectedFingerprint);
    session.send({ jsonrpc: "2.0", id: 3, method: "ping" });
    expect(await session.waitResponse(3)).not.toBeNull();
    const thirdForwarded = stub.requests.find((request) => request.body.includes('"id":3'));
    expect(thirdForwarded?.headers[HEADER_KEYS.applicationId]).toBe(appId);
    expect(thirdForwarded?.headers[HEADER_KEYS.advisoryProjectId]).toBe(otherProjectId);
    expect(thirdForwarded?.headers[HEADER_KEYS.repoFingerprint]).toBe(amendedFingerprint);

    session.endStdin();
    expect(await session.exitCode()).toBe(0);
    expect(session.stderr()).toBe("");
  }, 60_000);

  it("sends no identification headers without the file and no fingerprint header without a commit", async () => {
    const repo = createScratchDir();
    const stubUrl = await stub.url;
    stub.requests.length = 0;

    const session = spawnBridge([stubUrl], repo);
    session.send({ jsonrpc: "2.0", id: 1, method: "ping" });
    expect(await session.waitResponse(1)).not.toBeNull();

    const forwarded = stub.requests.find((request) => request.body.includes('"id":1'));
    expect(forwarded?.headers[HEADER_KEYS.applicationId]).toBeUndefined();
    expect(forwarded?.headers[HEADER_KEYS.advisoryProjectId]).toBeUndefined();
    expect(forwarded?.headers[HEADER_KEYS.repoFingerprint]).toBeUndefined();

    session.endStdin();
    expect(await session.exitCode()).toBe(0);
  }, 60_000);

  it("sends only the fingerprint header when the file is missing but a root commit exists", async () => {
    const repo = createScratchDir();
    repoWithCommit(repo);
    const stubUrl = await stub.url;
    stub.requests.length = 0;

    const session = spawnBridge([stubUrl], repo);
    session.send({ jsonrpc: "2.0", id: 1, method: "ping" });
    expect(await session.waitResponse(1)).not.toBeNull();

    const forwarded = stub.requests.find((request) => request.body.includes('"id":1'));
    expect(forwarded?.headers[HEADER_KEYS.applicationId]).toBeUndefined();
    expect(forwarded?.headers[HEADER_KEYS.advisoryProjectId]).toBeUndefined();
    expect(forwarded?.headers[HEADER_KEYS.repoFingerprint]).toEqual(expect.any(String));
    expect(forwarded?.headers[HEADER_KEYS.repoFingerprint]).toHaveLength(64);

    session.endStdin();
    expect(await session.exitCode()).toBe(0);
  }, 60_000);
});

describe("the Guidance access token", () => {
  it("is sent as a Bearer header on every request when DH_GUIDANCE_TOKEN is set, and absent otherwise", async () => {
    const repo = createScratchDir();
    const stubUrl = await stub.url;
    const token = "pilot-token-0123456789abcdef0123456789";

    stub.requests.length = 0;
    const withToken = spawnBridge([stubUrl], repo, { ...process.env, DH_GUIDANCE_TOKEN: ` ${token} ` });
    withToken.send({ jsonrpc: "2.0", id: 1, method: "ping" });
    expect(await withToken.waitResponse(1)).not.toBeNull();
    const sent = stub.requests.find((request) => request.body.includes('"id":1'));
    expect(sent?.headers["authorization"]).toBe(`Bearer ${token}`);
    withToken.endStdin();
    expect(await withToken.exitCode()).toBe(0);
    expect(withToken.stderr()).not.toContain(token);

    stub.requests.length = 0;
    const withoutToken = spawnBridge([stubUrl], repo, { ...process.env, DH_GUIDANCE_TOKEN: "  " });
    withoutToken.send({ jsonrpc: "2.0", id: 2, method: "ping" });
    expect(await withoutToken.waitResponse(2)).not.toBeNull();
    const unsent = stub.requests.find((request) => request.body.includes('"id":2'));
    expect(unsent?.headers["authorization"]).toBeUndefined();
    withoutToken.endStdin();
    expect(await withoutToken.exitCode()).toBe(0);
  }, 60_000);
});

describe("transport failure", () => {
  it("answers the stdio client with a JSON-RPC error and keeps running", async () => {
    const repo = createScratchDir();
    repoWithCommit(repo);
    // Nothing listens there: every forward fails.
    const session = spawnBridge(["http://127.0.0.1:1/v1/guidance"], repo);

    session.send({ jsonrpc: "2.0", id: 1, method: "ping" });
    const first = await session.waitResponse(1, 30_000);
    expect(first).not.toBeNull();
    const firstFailure = JSON.parse(first ?? "{}") as { error?: { code?: unknown; message?: unknown } };
    expect(typeof firstFailure.error?.code).toBe("number");
    expect(typeof firstFailure.error?.message).toBe("string");

    // The bridge keeps running: a second call gets its own JSON-RPC error.
    session.send({ jsonrpc: "2.0", id: 2, method: "ping" });
    expect(await session.waitResponse(2, 30_000)).not.toBeNull();

    // stdout stays the MCP stream, and transport failures write NO stderr
    // at all: startup envelopes are fail-fast only, so the accumulated
    // stderr must be exactly empty — weaker "not contain" pins could pass
    // with subject text flowing.
    expect(session.stdout()).not.toContain("domain-harness.json");
    expect(session.stderr()).toBe("");

    session.child.kill("SIGKILL");
  }, 60_000);
});
