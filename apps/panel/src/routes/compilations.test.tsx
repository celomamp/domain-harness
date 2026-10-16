// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import Compilations, {
  action,
  bundleAgeHours,
  COMPILATIONS_COPY,
  dropAnnouncement,
  isBundleStale,
  loader,
} from "./compilations.tsx";
import type { CompilationsActionData } from "./compilations.tsx";

const TENANT = "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e5f6";
const ACCOUNT = "01928c7e-5b2a-7c3d-9e4f-a1b2c3d4e5f7";
const APP = "01928c7e-5b2a-7c3d-ae4f-a1b2c3d4e5f8";
const SESSION_TOKEN = `${TENANT}.${"S".repeat(43)}`;
const COOKIE = { cookie: `dh_session=${SESSION_TOKEN}` };

const record = {
  catalogVersion: "1.0.0",
  readBy: { accountId: ACCOUNT, name: "Bea Buyer" },
  readAt: "2026-10-15T12:00:00.000Z",
};

function renderCompilations(
  readState: Promise<unknown>,
  bundleStatus: Promise<unknown> = Promise.resolve({ kind: "ok", value: [] }),
  collectorHealth: Promise<unknown> = Promise.resolve({ kind: "ok", value: [] }),
) {
  const Stub = createRoutesStub([
    {
      path: "/compilations",
      Component: Compilations,
      loader: () => ({ readState, bundleStatus, collectorHealth }),
    },
  ]);
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

  it("defers the bundle-status and Collector-health reads beside the read state", async () => {
    const statuses = [
      {
        applicationId: APP,
        agentToolName: "claude-code",
        bundleHash: "a".repeat(64),
        bundleSequence: 4,
        issuedAt: "2026-10-16T10:00:00.000Z",
        stalenessBoundHours: 24,
        frozen: false,
      },
    ];
    const reports = [
      {
        applicationId: APP,
        agentToolName: "claude-code",
        occurredAt: "2026-10-16T12:00:00.000Z",
        pendingCount: 2,
        droppedByReason: { schema_failed: 1 },
      },
    ];
    registryAnswers(
      [200, { catalogVersion: "1.0.0", read: true, readBy: record.readBy, readAt: record.readAt }],
      [200, { statuses }],
      [200, { reports }],
    );
    const result = loader(loaderArgs());
    if (result instanceof Response) throw new Error("expected data");
    expect(await result.bundleStatus).toEqual({ kind: "ok", value: statuses });
    expect(await result.collectorHealth).toEqual({ kind: "ok", value: reports });
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

describe("/compilations bundle status (Story 6.4)", () => {
  const NOW = Date.parse("2026-10-16T12:00:00.000Z");
  const row = {
    applicationId: APP,
    agentToolName: "claude-code",
    bundleHash: "a".repeat(64),
    bundleSequence: 4,
    issuedAt: "2026-10-10T12:00:00.000Z",
    stalenessBoundHours: 24,
    frozen: false,
  };

  function renderStatus(status: unknown, health: unknown = { kind: "ok", value: [] }) {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    renderCompilations(
      Promise.resolve({ kind: "ok", value: { catalogVersion: "1.0.0", read: false, readBy: null, readAt: null } }),
      Promise.resolve(status),
      Promise.resolve(health),
    );
  }

  it("shows the active hash, sequence, age against the bound, freeze state and the word stale when past the bound", async () => {
    renderStatus({ kind: "ok", value: [row] });
    expect(await screen.findByText("a".repeat(64))).toBeTruthy();
    expect(screen.getByText("Age 144h of 24h bound.")).toBeTruthy();
    expect(screen.getByText("not frozen")).toBeTruthy();
    expect(screen.getByText("stale")).toBeTruthy();
  });

  it("shows no stale word and the frozen state when within the bound", async () => {
    renderStatus({ kind: "ok", value: [{ ...row, issuedAt: "2026-10-16T11:00:00.000Z", frozen: true }] });
    expect(await screen.findByText("Age 1h of 24h bound.")).toBeTruthy();
    expect(screen.getByText("frozen")).toBeTruthy();
    expect(screen.queryByText("stale")).toBeNull();
  });

  it("shows the Collector pending and dropped counts by reason", async () => {
    renderStatus(
      { kind: "ok", value: [] },
      {
        kind: "ok",
        value: [
          {
            applicationId: APP,
            agentToolName: "claude-code",
            occurredAt: "2026-10-16T12:00:00.000Z",
            pendingCount: 2,
            droppedByReason: { schema_failed: 1, queue_gap: 3 },
          },
        ],
      },
    );
    expect(await screen.findByText("Pending 2.")).toBeTruthy();
    expect(screen.getByText("Dropped schema_failed: 1.")).toBeTruthy();
    expect(screen.getByText("Dropped queue_gap: 3.")).toBeTruthy();
  });

  it("announces a drop as status text, stating the schema failed and no partial payload was stored", async () => {
    renderStatus(
      { kind: "ok", value: [] },
      {
        kind: "ok",
        value: [
          {
            applicationId: APP,
            agentToolName: "claude-code",
            occurredAt: "2026-10-16T12:00:00.000Z",
            pendingCount: 0,
            droppedByReason: { schema_failed: 2 },
          },
        ],
      },
    );
    const announcement = await screen.findByText(/the schema failed and no partial payload was stored/);
    expect(announcement.textContent).toMatch(/schema_failed/);
    expect(announcement.textContent).toMatch(/count 2/);
  });

  it("announces a queue gap without blaming the schema", async () => {
    renderStatus(
      { kind: "ok", value: [] },
      {
        kind: "ok",
        value: [
          {
            applicationId: APP,
            agentToolName: "claude-code",
            occurredAt: "2026-10-16T12:00:00.000Z",
            pendingCount: 0,
            droppedByReason: { queue_gap: 1 },
          },
        ],
      },
    );
    const announcement = await screen.findByText(/those sequences never arrived/);
    expect(announcement.textContent).toMatch(/queue_gap/);
  });

  it("keeps the schema-reader in the empty state, with no-drop text", async () => {
    renderCompilations(Promise.resolve({ kind: "unavailable" }));
    expect(await screen.findByText("No bundle status yet. Nothing has arrived from the Collector.")).toBeTruthy();
    expect(screen.getByText("No Collector health yet. Nothing has arrived from the Collector.")).toBeTruthy();
    expect(screen.getByText("No compilation drops reported.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Compilation schemas" })).toBeTruthy();
    expect(document.querySelectorAll(".schema-reader")).toHaveLength(6);
  });

  it("shows unavailable, never throwing, on a registry outage", async () => {
    renderStatus({ kind: "unavailable" }, { kind: "unavailable" });
    expect(await screen.findByText("The bundle status is unavailable right now. Try again in a few minutes.")).toBeTruthy();
    expect(screen.getByText("The Collector health is unavailable right now. Try again in a few minutes.")).toBeTruthy();
  });

  it("derives the age in whole hours, clamped at zero, with stale past the bound", () => {
    expect(bundleAgeHours("2026-10-16T11:00:00.000Z", NOW)).toBe(1);
    expect(bundleAgeHours("2026-10-16T12:00:00.000Z", NOW)).toBe(0);
    expect(bundleAgeHours("2026-10-17T12:00:00.000Z", NOW)).toBe(0);
    expect(isBundleStale(25, 24)).toBe(true);
    expect(isBundleStale(24, 24)).toBe(false);
    expect(dropAnnouncement("schema_failed", 1)).toMatch(/the schema failed and no partial payload was stored/);
    expect(dropAnnouncement("mystery", 2)).toMatch(/no partial payload was stored/);
  });
});
