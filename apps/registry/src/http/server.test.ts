import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { isErrorEnvelope, isSessionCreated, isSessionInfo } from "@domain-harness/contract";
import type { SessionCreated, SessionInfo } from "@domain-harness/contract";
import { EnvelopeError } from "../errors.ts";
import { mintUuidV7 } from "../ids.ts";
import type { SignInLinkReport, SignInService } from "../sign-in/service.ts";
import { createRegistryServer, MAX_BODY_BYTES } from "./server.ts";
import type { LogEvent } from "./server.ts";

const tenantId = mintUuidV7();
const session: SessionInfo = { accountId: mintUuidV7(), tenantId, role: "Buyer" };
const GOOD_LINK = `${tenantId}.${"L".repeat(43)}`;
const GOOD_SESSION = `${tenantId}.${"S".repeat(43)}`;

/** A fake service: one known email, one valid link token, one valid session token. */
class FakeService implements SignInService {
  requested: string[] = [];
  requestSignInLinks(email: string): Promise<SignInLinkReport> {
    this.requested.push(email);
    const known = email.trim().toLowerCase() === "bea@acme.io";
    return Promise.resolve({ links: known ? 1 : 0, sent: known ? 1 : 0, failed: 0 });
  }
  createSession(token: string): Promise<SessionCreated> {
    if (token === "boom") return Promise.reject(new Error("driver said bea@acme.io"));
    if (token !== GOOD_LINK) {
      return Promise.reject(new EnvelopeError({ code: "sign_in_link_invalid", message: "invalid", subject: "token" }));
    }
    return Promise.resolve({ sessionToken: GOOD_SESSION, expiresAt: "2026-10-10T12:00:00.000Z", session });
  }
  getSession(token: string): Promise<SessionInfo> {
    if (token !== GOOD_SESSION) {
      return Promise.reject(new EnvelopeError({ code: "session_invalid", message: "invalid", subject: "session" }));
    }
    return Promise.resolve(session);
  }
}

describe("registry HTTP API", () => {
  const service = new FakeService();
  const events: LogEvent[] = [];
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = createRegistryServer(service, (event) => events.push(event));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    service.requested = [];
    events.length = 0;
  });

  const post = (path: string, body: unknown, init: RequestInit = {}) =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
      ...init,
    });

  async function expectEnvelope(response: Response, status: number, code: string): Promise<void> {
    expect(response.status).toBe(status);
    const body: unknown = await response.json();
    expect(isErrorEnvelope(body)).toBe(true);
    expect(body).toMatchObject({ code });
  }

  describe("POST /v1/sign-in-links", () => {
    it("answers 202 {} identically for a known and an unknown email, then does the work", async () => {
      const known = await post("/v1/sign-in-links", { email: " Bea@Acme.io " });
      const unknown = await post("/v1/sign-in-links", { email: "nobody@else.io" });
      expect([known.status, unknown.status]).toEqual([202, 202]);
      expect(await known.text()).toBe("{}");
      expect(await unknown.text()).toBe("{}");
      expect(known.headers.get("content-type")).toBe(unknown.headers.get("content-type"));
      await expect.poll(() => service.requested).toEqual([" Bea@Acme.io ", "nobody@else.io"]);
    });

    it("logs counts only, never the address", async () => {
      await post("/v1/sign-in-links", { email: "bea@acme.io" });
      await expect.poll(() => events.some((e) => e["event"] === "sign_in_links")).toBe(true);
      expect(JSON.stringify(events)).not.toMatch(/acme/i);
      expect(events).toContainEqual({ event: "sign_in_links", links: 1, sent: 1, failed: 0 });
    });

    it.each([
      ["a malformed email", { email: "not-an-email" }],
      ["an empty email", { email: "" }],
      ["a missing email", {}],
      ["an extra field", { email: "bea@acme.io", tenantId: "x" }],
      ["a non-object", ["bea@acme.io"]],
      ["invalid JSON", "{ nope"],
    ])("answers 400 invalid_input for %s and does nothing", async (_label, body) => {
      await expectEnvelope(await post("/v1/sign-in-links", body), 400, "invalid_input");
      expect(service.requested).toEqual([]);
    });

    it("answers 413 for a body over the limit", async () => {
      const big = JSON.stringify({ email: `${"a".repeat(MAX_BODY_BYTES)}@x.io` });
      await expectEnvelope(await post("/v1/sign-in-links", big), 413, "payload_too_large");
    });
  });

  describe("POST /v1/sessions", () => {
    it("answers 201 SessionCreated for a valid link token", async () => {
      const response = await post("/v1/sessions", { token: GOOD_LINK });
      expect(response.status).toBe(201);
      const body: unknown = await response.json();
      expect(isSessionCreated(body)).toBe(true);
    });

    it("answers 401 sign_in_link_invalid for anything else", async () => {
      await expectEnvelope(await post("/v1/sessions", { token: "garbage" }), 401, "sign_in_link_invalid");
    });

    it("answers 400 for a missing token", async () => {
      await expectEnvelope(await post("/v1/sessions", { token: "" }), 400, "invalid_input");
    });

    it("answers 500 internal_error for an unexpected failure without echoing it", async () => {
      const response = await post("/v1/sessions", { token: "boom" });
      expect(response.status).toBe(500);
      const text = await response.text();
      expect(text).not.toMatch(/acme|driver/i);
      expect(JSON.parse(text)).toMatchObject({ code: "internal_error" });
      expect(JSON.stringify(events)).not.toMatch(/acme|driver/i);
    });
  });

  describe("content type", () => {
    it.each([
      ["text/plain", "text/plain"],
      ["form encoding", "application/x-www-form-urlencoded"],
    ])("answers 415 unsupported_media_type for a %s POST and does nothing", async (_label, type) => {
      const response = await post("/v1/sign-in-links", { email: "bea@acme.io" }, { headers: { "content-type": type } });
      await expectEnvelope(response, 415, "unsupported_media_type");
      expect(service.requested).toEqual([]);
    });

    it("accepts application/json with parameters", async () => {
      const response = await post(
        "/v1/sign-in-links",
        { email: "bea@acme.io" },
        { headers: { "content-type": "Application/JSON; charset=utf-8" } },
      );
      expect(response.status).toBe(202);
    });
  });

  describe("GET /v1/session", () => {
    it("answers 200 SessionInfo for a valid bearer token", async () => {
      const response = await fetch(`${base}/v1/session`, { headers: { authorization: `Bearer ${GOOD_SESSION}` } });
      expect(response.status).toBe(200);
      expect(isSessionInfo(await response.json())).toBe(true);
    });

    it("accepts the bearer scheme in any case", async () => {
      const response = await fetch(`${base}/v1/session`, { headers: { authorization: `bearer ${GOOD_SESSION}` } });
      expect(response.status).toBe(200);
    });

    it.each([
      ["no header", {}],
      ["a non-bearer header", { authorization: `Basic ${GOOD_SESSION}` }],
      ["an unknown token", { authorization: `Bearer ${tenantId}.${"x".repeat(43)}` }],
    ])("answers 401 session_invalid for %s", async (_label, headers) => {
      await expectEnvelope(await fetch(`${base}/v1/session`, { headers }), 401, "session_invalid");
    });
  });

  describe("routing", () => {
    it("answers 404 not_found for an unknown path", async () => {
      await expectEnvelope(await fetch(`${base}/v1/nope`), 404, "not_found");
    });

    it("answers 404 for an unparseable request target without crashing", async () => {
      const { request } = await import("node:http");
      const status = await new Promise<number>((resolve, reject) => {
        const req = request({ host: "127.0.0.1", port: new URL(base).port, path: "http://[", method: "GET" }, (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        });
        req.on("error", reject);
        req.end();
      });
      expect(status).toBe(404);
      expect((await fetch(`${base}/v1/nope`)).status).toBe(404);
    });

    it("answers 405 method_not_allowed with Allow for a wrong method", async () => {
      const response = await fetch(`${base}/v1/sign-in-links`);
      expect(response.headers.get("allow")).toBe("POST");
      await expectEnvelope(response, 405, "method_not_allowed");
      await expectEnvelope(await post("/v1/session", {}), 405, "method_not_allowed");
    });

    it("logs the route and status of every request without query strings", async () => {
      await fetch(`${base}/v1/session?token=secret`, { headers: { authorization: `Bearer ${GOOD_SESSION}` } });
      await expect.poll(() => events.find((e) => e["event"] === "http_request")).toMatchObject({
        method: "GET",
        route: "/v1/session",
        status: 200,
      });
      expect(JSON.stringify(events)).not.toContain("secret");
    });
  });
});
