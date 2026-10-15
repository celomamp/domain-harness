// The dismissal action's own pins, driven directly (standards.action.test.ts
// style): an ActionFunctionArgs is constructed by hand and the registry's
// global fetch is stubbed, so no server runs.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionFunctionArgs } from "react-router";
import { acceptedDeviationAlertDismissalPath } from "@domain-harness/contract";
import { action } from "./accepted-deviation-alert-dismiss.ts";

const ALERT = "018f3d2a-7000-7000-8000-00000000000b";
const TENANT = "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e5f6";
const SESSION_TOKEN = `${TENANT}.${"S".repeat(43)}`;
const COOKIE = { cookie: `dh_session=${SESSION_TOKEN}` };

function actionArgs(fields: Record<string, string>, headers: Record<string, string> = COOKIE): ActionFunctionArgs {
  return {
    request: new Request("http://x/session/accepted-deviation-alerts/dismissals", {
      method: "POST",
      body: new URLSearchParams(fields),
      headers,
    }),
    params: {},
    context: {},
  } as unknown as ActionFunctionArgs;
}

function registryAnswers(status: number, body: unknown) {
  const fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Accepted-deviation alert dismissal action", () => {
  it("posts the alertId as submitted over { alertId } to the dismissal path and answers ok", async () => {
    vi.stubEnv("PANEL_REGISTRY_URL", "http://registry.test");
    const fetch = registryAnswers(200, { dismissed: true });
    expect(await action(actionArgs({ alertId: ALERT }))).toEqual({ ok: true });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`http://registry.test${acceptedDeviationAlertDismissalPath(ALERT)}`);
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ alertId: ALERT }));
    expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${SESSION_TOKEN}`);
  });

  it("answers { ok: false } without a session cookie, without calling the registry", async () => {
    const fetch = registryAnswers(200, { dismissed: true });
    expect(await action(actionArgs({ alertId: ALERT }, {}))).toEqual({ ok: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("answers { ok: false } when the body has no usable alertId", async () => {
    const fetch = registryAnswers(200, { dismissed: true });
    expect(await action(actionArgs({}))).toEqual({ ok: false });
    expect(await action(actionArgs({ alertId: "" }))).toEqual({ ok: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("answers { ok: false } when the registry refuses the dismissal", async () => {
    registryAnswers(403, { code: "role_denied", message: "m", subject: "role" });
    expect(await action(actionArgs({ alertId: ALERT }))).toEqual({ ok: false });
  });

  it("answers { ok: false } when the registry cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("fetch failed"))));
    expect(await action(actionArgs({ alertId: ALERT }))).toEqual({ ok: false });
  });
});
