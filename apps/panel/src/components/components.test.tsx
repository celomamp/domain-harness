// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRoutesStub, Outlet } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import Inventory from "../routes/inventory.tsx";
import Standards from "../routes/standards.tsx";
import { Button } from "./button.tsx";
import { PanelChrome } from "./panel-chrome.tsx";
import { Status } from "./status.tsx";

afterEach(() => {
  cleanup();
});

function renderPanel(url: string) {
  const Layout = () => (
    <PanelChrome role="Buyer">
      <Outlet />
    </PanelChrome>
  );
  const Stub = createRoutesStub([
    {
      Component: Layout,
      children: [
        {
          path: "/inventory",
          Component: Inventory,
          loader: () => ({
            applications: Promise.resolve({ kind: "ok", value: { applications: [] } }),
            projects: Promise.resolve({ kind: "ok", value: { rootId: "r", projects: [], lockedRules: [] } }),
            evidence: Promise.resolve({ kind: "ok", value: { applications: [] } }),
          }),
        },
        { path: "/standards", Component: Standards, loader: () => ({ list: { modules: [], standardOwners: [] } }) },
      ],
    },
  ]);
  render(<Stub initialEntries={[url]} />);
}

describe("panel-chrome", () => {
  it("shows the wordmark and the signed-in role as text, grouped under Monitor, Govern and Operate", async () => {
    renderPanel("/inventory");
    expect((await screen.findAllByText("Domain Harness")).length).toBeGreaterThan(0);
    expect(screen.getByText("Buyer")).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: "Management panel" });
    expect(nav.textContent).toContain("Monitor");
    expect(nav.textContent).toContain("Govern");
    expect(nav.textContent).toContain("Operate");
  });

  it("groups the seven destinations and marks the current page", async () => {
    renderPanel("/inventory");
    const nav = await screen.findByRole("navigation", { name: "Management panel" });
    expect(nav.textContent).toContain("Monitor");
    expect(nav.textContent).toContain("Govern");
    expect(nav.textContent).toContain("Operate");
    expect([...nav.querySelectorAll("a")].map((a) => a.textContent)).toEqual([
      "Inventory", "Compilations", "Standards", "Project tree", "Guidance access",
      "New-application flow", "Accepted deviation",
    ]);
    expect(screen.getByRole("link", { current: "page" }).textContent).toBe("Inventory");
  });

  it("offers a sign-out form in the account block", async () => {
    renderPanel("/inventory");
    const signOut = await screen.findByRole("button", { name: "Sign out" });
    expect(signOut.closest("form")?.getAttribute("action")).toBe("/sign-out");
    expect(signOut.closest("form")?.getAttribute("method")).toBe("post");
  });

  it("opens and closes the mobile drawer with the keyboard", async () => {
    renderPanel("/inventory");
    const menu = await screen.findByRole("button", { name: "Menu" });
    fireEvent.click(menu);
    expect(menu.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(menu.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(menu);
  });

  it("offers a skip link to the content", async () => {
    renderPanel("/inventory");
    const skip = await screen.findByRole("link", { name: "Skip to content" });
    expect(skip.getAttribute("href")).toBe("#main");
    expect(document.querySelector("#main")).not.toBeNull();
  });

  it("marks Inventory as the current destination on /inventory, with the empty state", async () => {
    renderPanel("/inventory");
    const current = await screen.findByRole("link", { current: "page" });
    expect(current.textContent).toBe("Inventory");
    expect(screen.getByRole("link", { name: "Standards" }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Inventory");
    expect((await screen.findByText("No Application yet.")).className).toBe("type-display");
  });

  it("marks Standards as current on /standards", async () => {
    renderPanel("/standards");
    expect((await screen.findByRole("link", { current: "page" })).textContent).toBe("Standards");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Standards");
  });

  it("keeps tab order equal to reading order with no positive tabindex", async () => {
    renderPanel("/inventory");
    await screen.findByRole("navigation");
    const focusables = [...document.querySelectorAll<HTMLElement>("a[href], button, input")];
    expect(focusables.map((el) => el.textContent)).toEqual([
      "Skip to content",
      "Inventory",
      "Compilations",
      "Standards",
      "Project tree",
      "Guidance access",
      "New-application flow",
      "Accepted deviation",
      "Sign out",
      "Menu",
    ]);
    expect(document.querySelectorAll(".shell__rail [tabindex]").length).toBe(0);
  });
});

describe("buttons", () => {
  it("render button-primary and button-inverse", () => {
    render(
      <>
        <Button variant="primary">Go</Button>
        <Button variant="inverse">Keep</Button>
      </>,
    );
    expect(screen.getByRole("button", { name: "Go" }).className).toBe("button-primary");
    expect(screen.getByRole("button", { name: "Keep" }).className).toBe("button-inverse");
    expect(screen.getByRole("button", { name: "Keep" }).getAttribute("type")).toBe("button");
  });
});

describe("status", () => {
  it("is always a status region and uses the denial component for a denial", () => {
    const { rerender } = render(<Status tone="notice" message={undefined} />);
    expect(screen.getByRole("status").textContent).toBe("");
    rerender(<Status tone="denial" message="Refused." />);
    expect(screen.getByRole("status").querySelector("p.denial")?.textContent).toBe("Refused.");
  });
});
