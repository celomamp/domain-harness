import { afterEach, describe, expect, it, vi } from "vitest";
import { createSession, getSession, registryBaseUrl, requestSignInLink } from "./registry.server.ts";

const TENANT = "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e5f6";
const ACCOUNT = "01928c7e-5b2a-7c3d-9e4f-a1b2c3d4e5f7";
const session = { accountId: ACCOUNT, tenantId: TENANT, role: "Buyer" };

function respond(status: number, body: unknown) {
  return vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("registry client", () => {
  it("defaults to the local registry and honours PANEL_REGISTRY_URL", () => {
    expect(registryBaseUrl({})).toBe("http://127.0.0.1:4100");
    expect(registryBaseUrl({ PANEL_REGISTRY_URL: "http://registry.internal:9000/" })).toBe("http://registry.internal:9000");
  });

  it("posts the email to /v1/sign-in-links and accepts 202 {}", async () => {
    vi.stubEnv("PANEL_REGISTRY_URL", "http://registry.test");
    const fetch = respond(202, {});
    vi.stubGlobal("fetch", fetch);
    expect(await requestSignInLink("bea@acme.io")).toEqual({ kind: "ok", value: {} });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://registry.test/v1/sign-in-links");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ email: "bea@acme.io" }));
  });

  it("returns the session for a valid link token and validates it with the contract guard", async () => {
    const created = { sessionToken: `${TENANT}.x`, expiresAt: "2026-10-10T12:00:00.000Z", session };
    vi.stubGlobal("fetch", respond(201, created));
    expect(await createSession("t")).toEqual({ kind: "ok", value: created });
  });

  it("reports a refusal envelope", async () => {
    const envelope = { code: "sign_in_link_invalid", message: "m", subject: "token" };
    vi.stubGlobal("fetch", respond(401, envelope));
    expect(await createSession("t")).toEqual({ kind: "refused", error: envelope });
  });

  it("sends the session token as a bearer token", async () => {
    const fetch = respond(200, session);
    vi.stubGlobal("fetch", fetch);
    expect(await getSession("abc")).toEqual({ kind: "ok", value: session });
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer abc");
  });

  it.each([
    ["a network failure", vi.fn(() => Promise.reject(new TypeError("fetch failed")))],
    ["a 500 envelope", respond(500, { code: "internal_error", message: "m", subject: "s" })],
    ["a malformed success body", respond(200, { role: "Admin" })],
    ["a non-JSON body", vi.fn(() => Promise.resolve(new Response("<html>", { status: 200 })))],
  ])("reports %s as unavailable without throwing", async (_label, fetch) => {
    vi.stubGlobal("fetch", fetch);
    expect(await getSession("abc")).toEqual({ kind: "unavailable" });
  });
});
