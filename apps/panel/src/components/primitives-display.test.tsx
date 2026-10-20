// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { Badge } from "./badge.tsx";
import { Breadcrumbs } from "./breadcrumbs.tsx";
import { PageHeader } from "./page-header.tsx";
import { SectionCard } from "./section-card.tsx";
import { Stat } from "./stat.tsx";

describe("display primitives", () => {
  it("Badge always renders its word and an icon, and exposes its tone", () => {
    const { container } = render(
      <Badge tone="solid" icon="alert">
        fail
      </Badge>,
    );
    expect(screen.getByText("fail")).toBeTruthy();
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.firstElementChild?.getAttribute("data-tone")).toBe("solid");
  });

  it("PageHeader renders eyebrow, h1, description, actions and meta", () => {
    render(
      <PageHeader
        eyebrow="Monitor"
        title="Inventory"
        description="Every Application."
        actions={<button>New</button>}
        meta="3 Projects"
      />,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Inventory");
    expect(screen.getByText("Monitor")).toBeTruthy();
    expect(screen.getByText("Every Application.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "New" })).toBeTruthy();
    expect(screen.getByText("3 Projects")).toBeTruthy();
  });

  it("Breadcrumbs render prior items as links and the current page as text", () => {
    render(
      <MemoryRouter>
        <Breadcrumbs items={[{ label: "Inventory", to: "/inventory" }, { label: "Checkout" }]} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "Inventory" }).getAttribute("href")).toBe("/inventory");
    expect(screen.queryByRole("link", { name: "Checkout" })).toBeNull();
    expect(screen.getByText("Checkout").getAttribute("aria-current")).toBe("page");
  });

  it("Stat renders a labelled group with a value and a hint", () => {
    render(<Stat label="Applications" value="12" hint="3 Projects" />);
    const group = screen.getByRole("group", { name: "Applications" });
    expect(within(group).getByText("12")).toBeTruthy();
    expect(within(group).getByText("3 Projects")).toBeTruthy();
  });

  it("SectionCard renders its header and action", () => {
    render(
      <SectionCard title="Deviations" description="3 open" action={<button>Accept</button>}>
        body
      </SectionCard>,
    );
    expect(screen.getByRole("heading", { name: "Deviations" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Accept" })).toBeTruthy();
    expect(screen.getByText("body")).toBeTruthy();
  });
});
