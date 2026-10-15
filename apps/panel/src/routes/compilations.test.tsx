// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import Compilations, { action, COMPILATIONS_COPY, loader } from "./compilations.tsx";
import type { CompilationsActionData } from "./compilations.tsx";

const TENANT = "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e5f6";
const ACCOUNT = "01928c7e-5b2a-7c3d-9e4f-a1b2c3d4e5f7";
const SESSION_TOKEN = `${TENANT}.${"S".repeat(43)}`;
const COOKIE = { cookie: `dh_session=${SESSION_TOKEN}` };

const record = {
  catalogVersion: "1.0.0",
  readBy: { accountId: ACCOUNT, name: "Bea Buyer" },
  readAt: "2026-10-15T12:00:00.000Z",
};

function renderCompilations(readState: Promise<unknown>) {
  const Stub = createRoutesStub([{ path: "/compilations", Component: Compilations, loader: () => ({ readState }) }]);
  render(<Stub initialEntries={["/compilations"]} />);
}

function loaderArgs(headers: Record<string, string> = COOKIE): LoaderFunctionArgs {
  return { request: new Request("http://x/compilations", { headers }), params: {}, context: {} } as unknown as LoaderFunctionArgs;
}

function actionArgs(fields: Record<string, string>, headers: Record<string, string> = COOKIE): ActionFunctionArgs {
  return {
    request: new Request("http://x/compilations", { method: "POST", body: new URLSearchParams(fields), headers }),
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
  readonly data: CompilationsActionData;
  readonly init: { status?: number } | null;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Compilations", () => {
  it("lists every Compilation type's schema with its version and fields, ink on white", async () => {
    renderCompilations(Promise.resolve({ kind: "unavailable" }));
    const readers = await screen.findAllByText("Schema version 1.0.0.");
    expect(readers).toHaveLength(6);
    for (const name of ["guidance", "gate_run", "deviation", "binding_refusal", "bundle_status", "collector_health"]) {
      expect(screen.getByRole("heading", { name }).textContent).toBe(name);
    }
    expect(document.querySelectorAll(".schema-reader")).toHaveLength(6);
    expect(screen.getAllByText("idempotencyKey")).toHaveLength(6);
  });

  it("states the read state as text: read with the version and date", async () => {
    renderCompilations(
      Promise.resolve({
        kind: "ok",
        value: { catalogVersion: "1.0.0", read: true, readBy: record.readBy, readAt: record.readAt },
      }),
    );
    expect(await screen.findByText("Read catalog 1.0.0 on 2026-10-15.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "I have read catalog 1.0.0" })).toBeTruthy();
  });

  it("states the unread state as text, with the consequence that the Collector cannot send", async () => {
    renderCompilations(
      Promise.resolve({ kind: "ok", value: { catalogVersion: "1.0.0", read: false, readBy: null, readAt: null } }),
    );
    expect(
      await screen.findByText("Not read yet. The Collector cannot send until the Buyer records reading catalog 1.0.0."),
    ).toBeTruthy();
  });

  it("says the session has ended, with a sign-in link, on a session_invalid refusal", async () => {
    renderCompilations(
      Promise.resolve({ kind: "refused", error: { code: "session_invalid", message: "m", subject: "session" } }),
    );
    expect(await screen.findByText(COMPILATIONS_COPY.sessionEnded)).toBeTruthy();
    expect(screen.getByRole("link", { name: COMPILATIONS_COPY.signInAgain }).getAttribute("href")).toBe("/sign-in");
    expect(screen.queryByText(COMPILATIONS_COPY.read.unavailable)).toBeNull();
  });

  it("is busy while the read state loads, with the heading and the schemas already there", async () => {
    renderCompilations(new Promise(() => undefined));
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe("Compilations");
    expect(screen.getByText("Loading the read state…").closest("[aria-busy]")?.getAttribute("aria-busy")).toBe("true");
    expect((await screen.findAllByText("Schema version 1.0.0.")).length).toBe(6);
  });

  it.each([
    ["an unavailable answer", () => Promise.resolve({ kind: "unavailable" })],
    ["a refusal", () => Promise.resolve({ kind: "refused", error: { code: "plan_refused", message: "m", subject: "s" } })],
    [
      "a failed promise",
      () => {
        const failed = Promise.reject(new Error("down"));
        failed.catch(() => undefined);
        return failed;
      },
    ],
  ])("says the read state is unavailable on %s, keeping the schemas", async (_label, answer: () => Promise<unknown>) => {
    renderCompilations(answer());
    expect(await screen.findByText(COMPILATIONS_COPY.read.unavailable)).toBeTruthy();
    expect((await screen.findAllByText("Schema version 1.0.0.")).length).toBe(6);
  });
});

describe("/compilations loader", () => {
  it("defers GET /v1/compilation-catalog/reads with the session, and redirects to sign-in without a cookie", async () => {
    const state = { catalogVersion: "1.0.0", read: true, readBy: record.readBy, readAt: record.readAt };
    const fetch = registryAnswers([200, state]);
    const result = loader(loaderArgs());
    if (result instanceof Response) throw new Error("expected data");
    expect(result.readState).toBeInstanceOf(Promise);
    expect(await result.readState).toEqual({ kind: "ok", value: state });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/v1\/compilation-catalog\/reads$/);
    expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${SESSION_TOKEN}`);
    const away = loader(loaderArgs({}));
    expect((away as Response).headers.get("location")).toBe("/sign-in");
  });
});

describe("/compilations action", () => {
  it("records the read and announces it", async () => {
    const fetch = registryAnswers([201, record]);
    const result = (await action(actionArgs({ intent: "record" }))) as unknown as DataResult;
    expect(result.data).toEqual({
      intent: "record",
      status: { tone: "notice", message: "Recorded reading catalog 1.0.0." },
      recordedAt: record.readAt,
    });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/v1\/compilation-catalog\/reads$/);
    expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${SESSION_TOKEN}`);
    expect(init.body).toBe(JSON.stringify({ catalogVersion: "1.0.0" }));
  });

  it("answers a re-read the same way, from the registry's 200", async () => {
    registryAnswers([200, record]);
    const result = (await action(actionArgs({ intent: "record" }))) as unknown as DataResult;
    expect(result.data.status).toEqual({ tone: "notice", message: "Recorded reading catalog 1.0.0." });
  });

  it("denies a non-Buyer, keeping the page", async () => {
    registryAnswers([403, { code: "role_denied", message: "m", subject: "role" }]);
    const result = (await action(actionArgs({ intent: "record" }))) as unknown as DataResult;
    expect(result.init).toMatchObject({ status: 403 });
    expect(result.data).toEqual({
      intent: "record",
      status: { tone: "denial", message: COMPILATIONS_COPY.record.denial },
    });
  });

  it("redirects to sign-in without a session cookie, without calling the registry", async () => {
    const fetch = registryAnswers([201, record]);
    const result = await action(actionArgs({ intent: "record" }, {}));
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).headers.get("location")).toBe("/sign-in");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("redirects to sign-in on a lapsed session", async () => {
    registryAnswers([401, { code: "session_invalid", message: "m", subject: "session" }]);
    const lapsed = await action(actionArgs({ intent: "record" }));
    expect(lapsed).toBeInstanceOf(Response);
    expect((lapsed as Response).headers.get("location")).toBe("/sign-in");
  });

  it("says the surface is unavailable on an outage", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("down"))));
    const result = (await action(actionArgs({ intent: "record" }))) as unknown as DataResult;
    expect(result.init).toMatchObject({ status: 503 });
    expect(result.data.status).toEqual({ tone: "denial", message: COMPILATIONS_COPY.actionUnavailable });
  });

  it("refuses another intent without calling the registry", async () => {
    const fetch = registryAnswers([201, record]);
    const result = (await action(actionArgs({ intent: "other" }))) as unknown as DataResult;
    expect(result.init).toMatchObject({ status: 400 });
    expect(result.data.status?.tone).toBe("denial");
    expect(fetch).not.toHaveBeenCalled();
  });
});
