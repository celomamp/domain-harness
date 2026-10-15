import { afterEach, describe, expect, it, vi } from "vitest";
import type { LoaderFunctionArgs } from "react-router";
import type { Role } from "@domain-harness/contract";
import { loader as home } from "./home.tsx";
import { headers as panelHeaders, loader as panelLayout } from "./panel-layout.tsx";
import { loader as verify } from "./sign-in-verify.ts";

const TENANT = "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e5f6";
const ACCOUNT = "01928c7e-5b2a-7c3d-9e4f-a1b2c3d4e5f7";
const SESSION_TOKEN = `${TENANT}.${"S".repeat(43)}`;
const session = { accountId: ACCOUNT, tenantId: TENANT, role: "Standard owner" };

function args(url: string, headers: Record<string, string> = {}): LoaderFunctionArgs {
  return { request: new Request(url, { headers }), params: {}, context: {} } as unknown as LoaderFunctionArgs;
}

function registryAnswers(status: number, body: unknown) {
  const fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function expectRedirect(response: unknown, location: string): Response {
  expect(response).toBeInstanceOf(Response);
  const res = response as Response;
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe(location);
  return res;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("/", () => {
  it("redirects to Inventory", () => {
    expectRedirect(home(), "/inventory");
  });
});

describe("/sign-in/verify", () => {
  it("consumes a valid link, sets the session cookie and lands on Inventory", async () => {
    const fetch = registryAnswers(201, {
      sessionToken: SESSION_TOKEN,
      expiresAt: new Date(Date.now() + 12 * 3_600_000).toISOString(),
      session,
    });
    const res = expectRedirect(await verify(args("http://localhost:3000/sign-in/verify?token=abc")), "/inventory");
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(new RegExp(`^dh_session=${SESSION_TOKEN.replace(".", "\\.")}; Max-Age=4319\\d; Path=/; HttpOnly; SameSite=Lax$`));
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.body).toBe(JSON.stringify({ token: "abc" }));
  });

  it("marks the cookie Secure on https", async () => {
    registryAnswers(201, { sessionToken: SESSION_TOKEN, expiresAt: "2099-01-01T00:00:00.000Z", session });
    const res = await verify(args("https://panel.example/sign-in/verify?token=abc"));
    expect(res.headers.get("set-cookie")).toMatch(/; Secure$/);
  });

  it.each([
    ["used or expired", 401, { code: "sign_in_link_invalid", message: "m", subject: "token" }],
  ])("returns a %s link to sign-in with a denial and no session", async (_label, status, body) => {
    registryAnswers(status, body);
    const res = expectRedirect(await verify(args("http://x/sign-in/verify?token=used")), "/sign-in?status=link-invalid");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("returns a missing token to sign-in with a denial without calling the registry", async () => {
    const fetch = registryAnswers(500, {});
    expectRedirect(await verify(args("http://x/sign-in/verify")), "/sign-in?status=link-invalid");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("says sign-in is unavailable when the registry cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("fetch failed"))));
    expectRedirect(await verify(args("http://x/sign-in/verify?token=abc")), "/sign-in?status=unavailable");
  });
});

describe("panel layout (/inventory, /standards)", () => {
  it("redirects to sign-in without a session cookie, without calling the registry", async () => {
    const fetch = registryAnswers(200, session);
    expectRedirect(await panelLayout(args("http://x/inventory")), "/sign-in");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("redirects to sign-in and clears the cookie for an invalid or expired session", async () => {
    registryAnswers(401, { code: "session_invalid", message: "m", subject: "session" });
    const res = expectRedirect(
      await panelLayout(args("http://x/standards", { cookie: `dh_session=${SESSION_TOKEN}` })),
      "/sign-in",
    );
    expect(res.headers.get("set-cookie")).toMatch(/^dh_session=; Max-Age=0/);
  });

  it.each([
    ["a 404 from a misrouted registry URL", 404, { code: "not_found", message: "m", subject: "/v1/session" }],
    ["a 405", 405, { code: "method_not_allowed", message: "m", subject: "/v1/session" }],
  ])("keeps the cookie and says sign-in is unavailable for %s", async (_label, status, body) => {
    registryAnswers(status, body);
    const res = expectRedirect(
      await panelLayout(args("http://x/inventory", { cookie: `dh_session=${SESSION_TOKEN}` })),
      "/sign-in?status=unavailable",
    );
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("marks authenticated pages private, no-store", () => {
    const headers = new Headers(panelHeaders({} as Parameters<typeof panelHeaders>[0]));
    expect(headers.get("cache-control")).toBe("private, no-store");
  });

  it("returns the role and streams the alert band's read for a live Buyer session", async () => {
    const buyerSession = { ...session, role: "Buyer" };
    const fetch = vi.fn((input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
      const body = url.includes("/v1/accepted-deviation-alerts") ? { alerts: [] } : buyerSession;
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetch);
    const result = await panelLayout(args("http://x/inventory", { cookie: `dh_session=${SESSION_TOKEN}` }));
    expect(result).not.toBeInstanceOf(Response);
    const data = result as { role: Role; alerts: Promise<unknown> };
    expect(data.role).toBe("Buyer");
    expect(await data.alerts).toEqual({ kind: "ok", value: [] });
    const alertsCall = fetch.mock.calls.find((call: unknown[]) =>
      (call[0] as string).includes("/v1/accepted-deviation-alerts"),
    ) as unknown[] | undefined;
    if (alertsCall === undefined) throw new Error("no alerts call");
    expect(alertsCall[0]).toEqual("http://127.0.0.1:4100/v1/accepted-deviation-alerts");
    expect(new Headers((alertsCall[1] as RequestInit).headers).get("authorization")).toBe(`Bearer ${SESSION_TOKEN}`);
  });

  it("makes no alert read for a non-Buyer session: only the Buyer renders bands", async () => {
    const fetch = registryAnswers(200, session);
    const result = await panelLayout(args("http://x/inventory", { cookie: `dh_session=${SESSION_TOKEN}` }));
    expect(result).not.toBeInstanceOf(Response);
    const data = result as { role: Role; alerts: Promise<unknown> };
    expect(data.role).toBe("Standard owner");
    expect(await data.alerts).toEqual({ kind: "ok", value: [] });
    expect(
      fetch.mock.calls.filter((call: unknown[]) => (call[0] as string).includes("/v1/accepted-deviation-alerts")),
    ).toEqual([]);
  });

  it("sends to sign-in saying it is unavailable when the registry cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("fetch failed"))));
    expectRedirect(
      await panelLayout(args("http://x/inventory", { cookie: `dh_session=${SESSION_TOKEN}` })),
      "/sign-in?status=unavailable",
    );
  });
});
