import { createServer } from "node:http";
import type { AddressInfo, Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { COMPILATION_API_PATHS } from "@domain-harness/contract";
import type { Compilation, UuidV7 } from "@domain-harness/contract";
import { PUSH_TIMEOUT_MS, pushCompilation } from "./push.ts";

const APP = "01928c7e-5b2a-7c3d-9e4f-a1b2c3d4e5f7" as UuidV7;
const KEY = "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e5f6" as UuidV7;
const AT = "2026-10-15T12:00:00.000Z";
const CREDENTIAL = "tenant-service-credential";

function compilation(): Compilation {
  return {
    type: "guidance",
    schemaVersion: "1.0.0",
    catalogVersion: "1.0.0",
    idempotencyKey: KEY,
    applicationId: APP,
    agentToolName: "claude-code",
    occurredAt: AT,
    sequence: 1,
    tool: "code_stack_rule",
    outcome: "hit",
    subject: { kind: "slot-token", slotToken: "code-stack/library/React" },
  };
}

interface Seen {
  readonly method: string | undefined;
  readonly url: string | undefined;
  readonly authorization: string | string[] | undefined;
  readonly contentType: string | string[] | undefined;
  readonly body: string;
}

let servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => {
            resolve();
          });
        }),
    ),
  );
  servers = [];
});

function stub(status: number, options: { delayMs?: number; check?: (seen: Seen) => void } = {}): Promise<{
  baseUrl: string;
  seen: () => Seen;
}> {
  let seen: Seen = { method: undefined, url: undefined, authorization: undefined, contentType: undefined, body: "" };
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    req.on("end", () => {
      seen = {
        method: req.method,
        url: req.url,
        authorization: req.headers.authorization,
        contentType: req.headers["content-type"],
        body,
      };
      const respond = (): void => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify({ status }));
      };
      if (options.delayMs !== undefined && options.delayMs > 0) {
        setTimeout(respond, options.delayMs);
      } else {
        respond();
      }
    });
  });
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        baseUrl: `http://127.0.0.1:${String(port)}`,
        seen: () => {
          if (options.check !== undefined) options.check(seen);
          return seen;
        },
      });
    });
  });
}

describe("pushCompilation", () => {
  it("sends one validated Compilation with the bearer credential (201 and 200)", async () => {
    for (const status of [201, 200]) {
      const { baseUrl, seen } = await stub(status);
      const sent = compilation();
      const result = await pushCompilation({ baseUrl, credential: CREDENTIAL, compilation: sent });
      expect(result).toEqual({ ok: true, sent: true, status });
      const request = seen();
      expect(request.method).toBe("POST");
      expect(request.url).toBe(COMPILATION_API_PATHS.compilations);
      expect(request.authorization).toBe(`Bearer ${CREDENTIAL}`);
      expect(String(request.contentType)).toContain("application/json");
      expect(JSON.parse(request.body) as unknown).toEqual(sent);
    }
  });

  it("types catalog-unread, unauthorized and invalid refusals without throwing", async () => {
    const unread = await stub(403);
    expect(await pushCompilation({ baseUrl: unread.baseUrl, credential: CREDENTIAL, compilation: compilation() })).toEqual({
      ok: false,
      reason: "catalog_unread",
      status: 403,
    });
    const denied = await stub(401);
    expect(await pushCompilation({ baseUrl: denied.baseUrl, credential: CREDENTIAL, compilation: compilation() })).toEqual(
      {
        ok: false,
        reason: "unauthorized",
        status: 401,
      },
    );
    const invalid = await stub(400);
    const refused = await pushCompilation({
      baseUrl: invalid.baseUrl,
      credential: CREDENTIAL,
      compilation: compilation(),
    });
    expect(refused).toEqual({ ok: false, reason: "invalid", status: 400, detail: expect.any(String) as string });
  });

  it("types an unexpected status as a transport failure without throwing", async () => {
    const { baseUrl } = await stub(500);
    const result = await pushCompilation({ baseUrl, credential: CREDENTIAL, compilation: compilation() });
    expect(result).toEqual({ ok: false, reason: "transport_failed", detail: expect.any(String) as string });
  });

  it("types a timeout as a transport failure", async () => {
    const { baseUrl } = await stub(201, { delayMs: 500 });
    const result = await pushCompilation({
      baseUrl,
      credential: CREDENTIAL,
      compilation: compilation(),
      timeoutMs: 50,
    });
    expect(result).toEqual({ ok: false, reason: "transport_failed", detail: expect.any(String) as string });
  });

  it("types an unreachable panel as a transport failure without throwing", async () => {
    const result = await pushCompilation({
      baseUrl: "http://127.0.0.1:1",
      credential: CREDENTIAL,
      compilation: compilation(),
      timeoutMs: 500,
    });
    expect(result).toEqual({ ok: false, reason: "transport_failed", detail: expect.any(String) as string });
  });

  it("bounds the wait by the default timeout", () => {
    expect(PUSH_TIMEOUT_MS).toBe(30_000);
  });
});
