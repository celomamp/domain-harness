// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
  agentTool: "claude-code",
  createdAt: "2026-10-13T23:30:00.000Z",
};
const cursorApp = {
  id: "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e603",
  description: "Intake form",
  project: { id: WEB, name: "Web" },
  fromFlow: true,
  agentTool: "cursor",
  createdAt: "2026-10-13T23:31:00.000Z",
};
const registered = {
  id: "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e602",
  description: "Legacy billing",
  project: { id: ROOT, name: "Acme" },
  fromFlow: false,
  agentTool: null,
  createdAt: "2026-10-14T08:00:00.000Z",
};

const EMPTY = "01928c7e-5b2a-7c3d-ae4f-a1b2c3d4e5fa";

const tree = {
  rootId: ROOT,
  projects: [
    { id: ROOT, name: "Acme", levelName: null, parentId: null, createdAt: "2026-10-13T23:00:00.000Z" },
    { id: WEB, name: "Web", levelName: "team", parentId: ROOT, createdAt: "2026-10-13T23:01:00.000Z" },
    { id: EMPTY, name: "Empty", levelName: "team", parentId: ROOT, createdAt: "2026-10-13T23:02:00.000Z" },
  ],
  lockedRules: [],
};

const evidence = {
  applications: [{ applicationId: flow.id, agentTools: ["cursor", "claude-code"] }],
};

interface StubReads {
  readonly applications: Promise<unknown>;
  readonly projects?: Promise<unknown>;
  readonly evidence?: Promise<unknown>;
}

function renderInventory(reads: StubReads) {
  const Stub = createRoutesStub([
    {
      path: "/inventory",
      Component: Inventory,
      loader: () => ({
        applications: reads.applications,
        projects: reads.projects ?? Promise.resolve({ kind: "ok", value: tree }),
        evidence: reads.evidence ?? Promise.resolve({ kind: "ok", value: evidence }),
      }),
    },
  ]);
  render(<Stub initialEntries={["/inventory"]} />);
}

const fullReads = (): StubReads => ({
  applications: Promise.resolve({ kind: "ok", value: { applications: [flow, cursorApp, registered] } }),
  projects: Promise.resolve({ kind: "ok", value: tree }),
  evidence: Promise.resolve({ kind: "ok", value: evidence }),
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Inventory", () => {
  it("groups application-rows under the Compilation-observed agent-tool heading, with header cells and no Builder name", async () => {
    renderInventory(fullReads());
    // The evidence puts Checkout service under cursor (latest first) even
    // though its registry Boilerplate target is claude-code.
    const cursor = await screen.findByRole("table", { name: "Applications — cursor" });
    expect(within(cursor).getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Application",
      "Project",
      "Agent tool",
      "Status",
      "Added",
    ]);
    expect(within(cursor).getByRole("link", { name: "Checkout service" })).toBeTruthy();
    expect(within(cursor).getByRole("link", { name: "Intake form" })).toBeTruthy();
    // Status is read-presence: Checkout service has evidence, Intake form does not.
    expect(within(cursor).getByText("Evidence received")).toBeTruthy();
    expect(within(cursor).getByText("No Compilation yet")).toBeTruthy();
    expect(screen.getByRole("heading", { name: /cursor/ })).toBeTruthy();
    expect(screen.queryByRole("table", { name: "Applications — claude-code" })).toBeNull();
    const none = screen.getByRole("table", { name: "Applications — No Compilation yet" });
    expect(within(none).getByRole("link", { name: "Legacy billing" })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Builder/);
  });

  it("filters by Project: selecting Web shows only Web's Applications, and an empty Project shows its empty state", async () => {
    renderInventory(fullReads());
    await screen.findByRole("table", { name: "Applications — cursor" });
    const filter = screen.getByLabelText("Project");
    expect([...filter.querySelectorAll("option")].map((option) => option.textContent)).toEqual([
      "All Projects",
      "Acme",
      "Web",
      "Empty",
    ]);
    fireEvent.change(filter, { target: { value: WEB } });
    expect(screen.queryByRole("table", { name: "Applications — No Compilation yet" })).toBeNull();
    expect(screen.getByRole("table", { name: "Applications — cursor" })).toBeTruthy();
    fireEvent.change(filter, { target: { value: ROOT } });
    expect(screen.queryByRole("table", { name: "Applications — cursor" })).toBeNull();
    expect(screen.getByRole("table", { name: "Applications — No Compilation yet" })).toBeTruthy();
    fireEvent.change(filter, { target: { value: EMPTY } });
    expect(await screen.findByText("No Application in this Project yet.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clear filter" })).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("falls back to the registry Boilerplate target and says so when the Compilation evidence does not arrive", async () => {
    const reads = fullReads();
    renderInventory({ ...reads, evidence: Promise.resolve({ kind: "unavailable" }) });
    expect(
      await screen.findByText(
        "The Compilation evidence did not arrive, so the agent-tool groups use the latest Boilerplate target.",
      ),
    ).toBeTruthy();
    // Checkout service groups under its registry target now, and the
    // structure (filter, tables, rows) stays.
    expect(screen.getByRole("table", { name: "Applications — claude-code" })).toBeTruthy();
    expect(screen.getByRole("table", { name: "Applications — cursor" })).toBeTruthy();
    expect(screen.getByRole("table", { name: "Applications — No Compilation yet" })).toBeTruthy();
    expect(screen.getByLabelText("Project")).toBeTruthy();
  });

  it("shows the full list with a note when the Project list is unavailable", async () => {
    const reads = fullReads();
    renderInventory({ ...reads, projects: Promise.resolve({ kind: "unavailable" }) });
    expect(await screen.findByText("The Project list is unavailable right now. The full list is shown.")).toBeTruthy();
    expect(screen.getByRole("table", { name: "Applications — cursor" })).toBeTruthy();
    expect(screen.queryByLabelText("Project")).toBeNull();
  });

  it("links each row to that Application's evidence surface for pointer and keyboard activation", async () => {
    renderInventory(fullReads());
    await screen.findByRole("table", { name: "Applications — cursor" });
    const links = screen.getAllByRole("link");
    const hrefs = new Map(links.map((link) => [link.textContent, link.getAttribute("href")]));
    expect(hrefs.get("Checkout service")).toBe(`/applications/${flow.id}`);
    expect(hrefs.get("Intake form")).toBe(`/applications/${cursorApp.id}`);
    expect(hrefs.get("Legacy billing")).toBe(`/applications/${registered.id}`);
  });

  it("shows the empty state when there is no Application", async () => {
    renderInventory({ applications: Promise.resolve({ kind: "ok", value: { applications: [] } }) });
    expect(await screen.findByText("No Application yet.")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "New application" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("is busy while the Applications load, with the heading already there", async () => {
    renderInventory({ applications: new Promise(() => undefined) });
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe("Inventory");
    expect(screen.getByRole("region", { name: "Applications" }).getAttribute("aria-busy")).toBe("true");
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
    renderInventory({ applications: answer() });
    expect(await screen.findByText("The Inventory is unavailable right now. Try again in a few minutes.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows a summary derived from the reads", async () => {
    renderInventory(fullReads());
    const applications = await screen.findByRole("group", { name: "Applications" });
    expect(within(applications).getByText("3")).toBeTruthy();
    const projects = screen.getByRole("group", { name: "Projects" });
    expect(within(projects).getByText("3")).toBeTruthy();
    const agentTools = screen.getByRole("group", { name: "Agent tools" });
    expect(within(agentTools).getByText("1")).toBeTruthy();
    const notCompiled = screen.getByRole("group", { name: "Not yet compiled" });
    expect(within(notCompiled).getByText("2")).toBeTruthy();
  });

  it("searches by description or Project and reports the result count", async () => {
    renderInventory(fullReads());
    await screen.findByRole("table", { name: "Applications — cursor" });
    fireEvent.change(screen.getByLabelText("Search applications"), { target: { value: "intake" } });
    expect(screen.getByText("Intake form")).toBeTruthy();
    expect(screen.queryByText("Checkout service")).toBeNull();
    expect(screen.getByText("1 Application")).toBeTruthy();
  });

  it("handles 60 applications without dropping rows", async () => {
    const many = Array.from({ length: 60 }, (_, index) => ({ ...flow, id: `${flow.id}-${String(index)}`, description: `Application ${String(index)}` }));
    renderInventory({ applications: Promise.resolve({ kind: "ok", value: { applications: many } }) });
    await screen.findByRole("table", { name: /Applications/ });
    expect(screen.getAllByRole("row")).toHaveLength(61);
    expect(screen.getByText("60 Applications")).toBeTruthy();
  });

  it("keeps a 500-character description visible and wrapped", async () => {
    const long = { ...flow, description: "A".repeat(500) };
    renderInventory({ applications: Promise.resolve({ kind: "ok", value: { applications: [long] } }) });
    const link = await screen.findByRole("link", { name: "A".repeat(500) });
    expect(link.className).toContain("application-name");
  });
});

describe("/inventory loader", () => {
  it("defers the Applications, the Project tree and the evidence with the session, and redirects to sign-in without a cookie", async () => {
    const fetch = vi.fn(
      (url: string) =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              url.endsWith("/v1/applications")
                ? { applications: [flow] }
                : url.endsWith("/v1/projects")
                  ? tree
                  : { applications: [] },
            ),
            { status: 200 },
          ),
        ),
    );
    vi.stubGlobal("fetch", fetch);
    const result = loader({ request: new Request("http://x/inventory", { headers: { cookie: COOKIE } }) } as LoaderFunctionArgs);
    if (result instanceof Response) throw new Error("expected data");
    expect(result.applications).toBeInstanceOf(Promise);
    expect(result.projects).toBeInstanceOf(Promise);
    expect(result.evidence).toBeInstanceOf(Promise);
    expect(await result.applications).toEqual({ kind: "ok", value: { applications: [flow] } });
    expect(await result.projects).toEqual({ kind: "ok", value: tree });
    expect(await result.evidence).toEqual({ kind: "ok", value: { applications: [] } });
    const urls = fetch.mock.calls.map((call) => String((call as unknown[])[0]));
    expect(urls).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/\/v1\/applications$/),
        expect.stringMatching(/\/v1\/projects$/),
        expect.stringMatching(/\/v1\/inventory$/),
      ]),
    );
    for (const call of fetch.mock.calls) {
      expect(new Headers(((call as unknown[])[1] as RequestInit).headers).get("authorization")).toBe(
        `Bearer ${TENANT}.${"S".repeat(43)}`,
      );
    }
    const away = loader({ request: new Request("http://x/inventory") } as LoaderFunctionArgs);
    expect((away as Response).headers.get("location")).toBe("/sign-in");
  });
});
