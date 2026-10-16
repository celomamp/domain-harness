// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import GuidanceAccess, { action, GUIDANCE_ACCESS_COPY, loader } from "./guidance-access.tsx";
import type { GuidanceAccessActionData } from "./guidance-access.tsx";

const TENANT = "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e5f6";
const SESSION_TOKEN = `${TENANT}.${"S".repeat(43)}`;
const COOKIE = { cookie: `dh_session=${SESSION_TOKEN}` };

const state = {
  grantedRoles: ["Standard owner"],
  retentionDays: 30,
  updatedAt: "2026-10-16T12:00:00.000Z",
};

function renderAccess(access: Promise<unknown>) {
  const Stub = createRoutesStub([{ path: "/guidance-access", Component: GuidanceAccess, loader: () => ({ access }) }]);
  render(<Stub initialEntries={["/guidance-access"]} />);
}

function loaderArgs(headers: Record<string, string> = COOKIE): LoaderFunctionArgs {
  return { request: new Request("http://x/guidance-access", { headers }), params: {}, context: {} } as unknown as LoaderFunctionArgs;
}

function actionArgs(pairs: [string, string][], headers: Record<string, string> = COOKIE): ActionFunctionArgs {
  const body = new URLSearchParams();
  for (const [name, value] of pairs) body.append(name, value);
  return {
    request: new Request("http://x/guidance-access", { method: "POST", body, headers }),
    params: {},
    context: {},
  } as unknown as ActionFunctionArgs;
}

function registryAnswers(...answers: [number, unknown][]) {
  const queue = [...answers];
  const fetch = vi.fn(() => {
    const [status, body] = queue.shift() ?? [500, {}];
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

interface DataResult {
  readonly data: GuidanceAccessActionData;
  readonly init: { status?: number } | null;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Guidance access", () => {
  it("states the grant per role with the Buyer always granted, plus the current retention", async () => {
    renderAccess(Promise.resolve({ kind: "ok", value: state }));
    expect(await screen.findByText("Buyer: always granted.")).toBeTruthy();
    expect(screen.getByText("Standard owner: granted.")).toBeTruthy();
    expect(screen.getByText("Builder: not granted.")).toBeTruthy();
    expect(screen.getByText("Currently keeping Guidance events for 30 days.")).toBeTruthy();
  });

  it("shows the structure with an unavailable notice when the registry is down", async () => {
    renderAccess(Promise.resolve({ kind: "unavailable" }));
    expect(await screen.findByText(GUIDANCE_ACCESS_COPY.grant.unavailable)).toBeTruthy();
  });

  it("shows the session-ended message with a sign-in link when the session lapsed", async () => {
    renderAccess(
      Promise.resolve({ kind: "refused", error: { code: "session_invalid", message: "m", subject: "session" } }),
    );
    expect(await screen.findByText(GUIDANCE_ACCESS_COPY.sessionEnded)).toBeTruthy();
    expect(screen.getByRole("link", { name: GUIDANCE_ACCESS_COPY.signInAgain })).toBeTruthy();
  });

  it("redirects to sign-in without a session cookie", async () => {
    expect(loader(loaderArgs({}))).toEqual(expect.objectContaining({ status: 302 }));
    const result = await action(actionArgs([["intent", "save"]], {}));
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).headers.get("location")).toBe("/sign-in");
  });

  it("saves the grant and retention as the Buyer with a success notice", async () => {
    const fetch = registryAnswers([200, { ...state, grantedRoles: ["Standard owner", "Builder"], retentionDays: 45 }]);
    const result = (await action(
      actionArgs([
        ["intent", "save"],
        ["grants", "Standard owner"],
        ["grants", "Builder"],
        ["retentionDays", "45"],
      ]),
    )) as unknown as DataResult;
    expect(result.data.status).toEqual({ tone: "notice", message: GUIDANCE_ACCESS_COPY.grant.saved });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/v1\/guidance-access$/);
    expect(init.body).toBe(
      JSON.stringify({ grants: { "Standard owner": true, Builder: true }, retentionDays: 45 }),
    );
  });

  it("answers a denial for a non-Buyer save", async () => {
    registryAnswers([403, { code: "role_denied", message: "m", subject: "role" }]);
    const result = (await action(
      actionArgs([
        ["intent", "save"],
        ["grants", "Builder"],
        ["retentionDays", "30"],
      ]),
    )) as unknown as DataResult;
    expect(result.init).toMatchObject({ status: 403 });
    expect(result.data.status).toEqual({ tone: "denial", message: GUIDANCE_ACCESS_COPY.grant.denial });
  });

  it("reports a non-integer retention in place without calling the registry", async () => {
    const fetch = registryAnswers();
    const result = (await action(actionArgs([["intent", "save"], ["retentionDays", "soon"]]))) as unknown as DataResult;
    expect(result.init).toMatchObject({ status: 400 });
    expect(result.data.fieldErrors).toEqual({ retentionDays: GUIDANCE_ACCESS_COPY.retention.invalid });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("maps a registry retention refusal to the field error", async () => {
    registryAnswers([400, { code: "invalid_input", message: "m", subject: "retentionDays" }]);
    const result = (await action(actionArgs([["intent", "save"], ["retentionDays", "0"]]))) as unknown as DataResult;
    expect(result.init).toMatchObject({ status: 400 });
    expect(result.data.fieldErrors).toEqual({ retentionDays: GUIDANCE_ACCESS_COPY.retention.invalid });
  });

  it("answers unavailable on a save outage", async () => {
    registryAnswers([500, {}]);
    const result = (await action(actionArgs([["intent", "save"], ["retentionDays", "30"]]))) as unknown as DataResult;
    expect(result.init).toMatchObject({ status: 503 });
    expect(result.data.status).toEqual({ tone: "denial", message: GUIDANCE_ACCESS_COPY.actionUnavailable });
  });

  it("mints a token for a granted role and shows it once", async () => {
    const minted = { token: "key.body.sig", role: "Standard owner", expiresAt: "2026-10-16T12:05:00.000Z" };
    registryAnswers([201, minted]);
    const result = (await action(actionArgs([["intent", "mint"]]))) as unknown as DataResult;
    expect(result.data.status).toEqual({ tone: "notice", message: GUIDANCE_ACCESS_COPY.token.minted });
    expect(result.data.token).toEqual(minted);
    renderAccess(Promise.resolve({ kind: "ok", value: state }));
    expect(await screen.findByText("Mint a read token for my role")).toBeTruthy();
  });

  it("answers a denial when the viewer's role holds no grant", async () => {
    registryAnswers([403, { code: "role_denied", message: "m", subject: "role" }]);
    const result = (await action(actionArgs([["intent", "mint"]]))) as unknown as DataResult;
    expect(result.init).toMatchObject({ status: 403 });
    expect(result.data.status).toEqual({ tone: "denial", message: GUIDANCE_ACCESS_COPY.token.denial });
  });

  it("redirects to sign-in on a lapsed mint session", async () => {
    registryAnswers([401, { code: "session_invalid", message: "m", subject: "session" }]);
    const result = await action(actionArgs([["intent", "mint"]]));
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).headers.get("location")).toBe("/sign-in");
  });

  it("never fetches the service read endpoint and never renders Guidance content", () => {
    const source = readFileSync(resolve(import.meta.dirname, "./guidance-access.tsx"), "utf8");
    expect(source).not.toContain("/v1/guidance-events");
    expect(source).not.toContain("GuidanceEvent");
    expect(source).not.toContain("listGuidance");
    expect(source).not.toContain("fetch(");
  });
});
