import { describe, expect, it } from "vitest";
import { clearSessionCookie, readSessionToken, sessionCookie } from "./session.server.ts";

const TOKEN = `01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e5f6.${"A".repeat(43)}`;

describe("session cookie", () => {
  it("is HttpOnly, SameSite=Lax, Path=/ and expires with the session", () => {
    const request = new Request("http://localhost:3000/sign-in/verify");
    const now = Date.parse("2026-10-10T00:00:00.000Z");
    expect(sessionCookie(request, TOKEN, "2026-10-10T12:00:00.000Z", now)).toBe(
      `dh_session=${TOKEN}; Max-Age=43200; Path=/; HttpOnly; SameSite=Lax`,
    );
  });

  it("is Secure on https", () => {
    const request = new Request("https://panel.example/sign-in/verify");
    expect(sessionCookie(request, TOKEN, "2026-10-10T12:00:00.000Z")).toMatch(/; Secure$/);
    expect(clearSessionCookie(request)).toBe("dh_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax; Secure");
  });

  it.each([
    ["behind a TLS-terminating proxy", "http://localhost:3000/x", { "x-forwarded-proto": "https" }],
    ["on a non-local host over http", "http://panel.internal:3000/x", {}],
  ])("is Secure %s", (_label, url, headers) => {
    expect(sessionCookie(new Request(url, { headers }), TOKEN, "2099-01-01T00:00:00.000Z")).toMatch(/; Secure$/);
  });

  it.each([["http://localhost:3000/x"], ["http://127.0.0.1:3000/x"], ["http://[::1]:3000/x"]])(
    "is not Secure for local http at %s",
    (url) => {
      expect(sessionCookie(new Request(url), TOKEN, "2099-01-01T00:00:00.000Z")).not.toMatch(/Secure/);
    },
  );

  it("is read back from the Cookie header, ignoring other cookies and malformed values", () => {
    const at = (cookie: string) => readSessionToken(new Request("http://x/", { headers: { cookie } }));
    expect(at(`a=1; dh_session=${TOKEN}; b=2`)).toBe(TOKEN);
    expect(at("dh_session=<script>")).toBeUndefined();
    expect(at("other=1")).toBeUndefined();
    expect(readSessionToken(new Request("http://x/"))).toBeUndefined();
  });
});
