// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
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
    <>
      <PanelChrome role="Buyer" />
      <main>
        <Outlet />
      </main>
    </>
  );
  const Stub = createRoutesStub([
    {
      Component: Layout,
      children: [
        { path: "/inventory", Component: Inventory },
        { path: "/standards", Component: Standards },
      ],
    },
  ]);
  render(<Stub initialEntries={[url]} />);
}

describe("panel-chrome", () => {
  it("shows the wordmark, the role as text and a nav listing only Inventory and Standards", async () => {
    renderPanel("/inventory");
    expect(await screen.findByText("Domain Harness")).toBeTruthy();
    expect(screen.getByText("Buyer")).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: "Management panel" });
    const links = [...nav.querySelectorAll("a")];
    expect(links.map((a) => a.textContent)).toEqual(["Inventory", "Standards"]);
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/inventory", "/standards"]);
  });

  it("marks Inventory as the current destination on /inventory, with the empty state", async () => {
    renderPanel("/inventory");
    const current = await screen.findByRole("link", { current: "page" });
    expect(current.textContent).toBe("Inventory");
    expect(screen.getByRole("link", { name: "Standards" }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Inventory");
    expect(screen.getByText("No Application yet.").className).toBe("type-display");
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
    expect(focusables.map((el) => el.textContent)).toEqual(["Inventory", "Standards"]);
    expect(document.querySelectorAll("[tabindex]").length).toBe(0);
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
