// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import Inventory, { loader } from "./inventory.tsx";

const TENANT = "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e5f6";
const ROOT = "01928c7e-5b2a-7c3d-9e4f-a1b2c3d4e5f7";
const WEB = "01928c7e-5b2a-7c3d-be4f-a1b2c3d4e5f9";
const COOKIE = `dh_session=${TENANT}.${"S".repeat(43)}`;

const flow = {
  id: "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e601",
  description: "Checkout service",
  project: { id: WEB, name: "Web" },
  fromFlow: true,
  createdAt: "2026-10-13T23:30:00.000Z",
};
const registered = {
  id: "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e602",
  description: "Legacy billing",
  project: { id: ROOT, name: "Acme" },
  fromFlow: false,
  createdAt: "2026-10-14T08:00:00.000Z",
};

function renderInventory(applications: Promise<unknown>) {
  const Stub = createRoutesStub([{ path: "/inventory", Component: Inventory, loader: () => ({ applications }) }]);
  render(<Stub initialEntries={["/inventory"]} />);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Inventory", () => {
  it("lists every Application in a table: description, Project, placement and listed date, with no Builder name", async () => {
    renderInventory(Promise.resolve({ kind: "ok", value: { applications: [flow, registered] } }));
    const table = await screen.findByRole("table", { name: "Applications" });
    expect(within(table).getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Application",
      "Project",
      "Placement",
      "Listed",
    ]);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((row) => [...row.children].map((cell) => cell.textContent))).toEqual([
      ["Checkout service", "Web", "New-application flow", "2026-10-13"],
      ["Legacy billing", "Acme", "Registered", "2026-10-14"],
    ]);
    expect(screen.getByText("Listed before any Gate run. Compilation evidence fills in later.")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Builder/);
  });

  it("shows the empty state when there is no Application", async () => {
    renderInventory(Promise.resolve({ kind: "ok", value: { applications: [] } }));
    expect((await screen.findByText("No Application yet.")).className).toBe("type-display");
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("is busy while the Applications load, with the heading already there", async () => {
    renderInventory(new Promise(() => undefined));
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe("Inventory");
    expect(screen.getByText("Loading the Applications…").closest("[aria-busy]")?.getAttribute("aria-busy")).toBe("true");
  });

  it.each([
    ["an unavailable answer", () => Promise.resolve({ kind: "unavailable" })],
    ["a refusal", () => Promise.resolve({ kind: "refused", error: { code: "session_invalid", message: "m", subject: "s" } })],
    [
      "a failed promise",
      () => {
        const failed = Promise.reject(new Error("down"));
        failed.catch(() => undefined);
        return failed;
      },
    ],
  ])("says the Inventory is unavailable on %s", async (_label, answer: () => Promise<unknown>) => {
    renderInventory(answer());
    expect(await screen.findByText("The Inventory is unavailable right now. Try again in a few minutes.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("/inventory loader", () => {
  it("defers GET /v1/applications with the session, and redirects to sign-in without a cookie", async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ applications: [flow] }), { status: 200 })));
    vi.stubGlobal("fetch", fetch);
    const result = loader({ request: new Request("http://x/inventory", { headers: { cookie: COOKIE } }) } as LoaderFunctionArgs);
    if (result instanceof Response) throw new Error("expected data");
    expect(result.applications).toBeInstanceOf(Promise);
    expect(await result.applications).toEqual({ kind: "ok", value: { applications: [flow] } });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/v1\/applications$/);
    expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${TENANT}.${"S".repeat(43)}`);
    const away = loader({ request: new Request("http://x/inventory") } as LoaderFunctionArgs);
    expect((away as Response).headers.get("location")).toBe("/sign-in");
  });
});
