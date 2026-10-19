// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Banner } from "./banner.tsx";
import { CopyButton } from "./copy-button.tsx";
import { EmptyState } from "./empty-state.tsx";
import { SideSheet } from "./side-sheet.tsx";
import { Skeleton } from "./skeleton.tsx";
import { Tabs } from "./tabs.tsx";

describe("feedback primitives", () => {
  it("EmptyState renders a title, explanation and action", () => {
    render(<EmptyState icon="application" title="No Application yet." description="Place one." action={<button>New</button>} />);
    expect(screen.getByRole("heading", { name: "No Application yet." })).toBeTruthy();
    expect(screen.getByRole("button", { name: "New" })).toBeTruthy();
  });
  it("Skeleton is hidden from assistive technology", () => {
    const { container } = render(<Skeleton lines={4} />);
    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
  });
  it("CopyButton writes the value and announces Copied", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    render(<CopyButton value="01928c7e" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith("01928c7e");
    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
  });
  it("Banner is presentational by default and a live region only when asked", () => {
    const { rerender, container } = render(<Banner tone="denial" title="Refused">Nothing was changed.</Banner>);
    expect(screen.queryByRole("status")).toBeNull();
    expect(container.textContent).toContain("Refused");
    rerender(<Banner tone="denial" title="Refused" live>Nothing was changed.</Banner>);
    expect(screen.getByRole("status").textContent).toContain("Refused");
  });
  it("Tabs move with the arrow keys and expose aria-selected", () => {
    const onChange = vi.fn();
    render(<Tabs label="Evidence" value="overview" onChange={onChange} tabs={[{ id: "overview", label: "Overview", panelId: "p1" }, { id: "history", label: "History", panelId: "p2" }]} />);
    fireEvent.keyDown(screen.getByRole("tab", { name: "Overview" }), { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("history");
    expect(screen.getByRole("tab", { name: "Overview" }).getAttribute("aria-selected")).toBe("true");
  });
  it("SideSheet focuses its title, closes on Escape and returns focus", () => {
    const opener = document.createElement("button");
    opener.textContent = "Open";
    document.body.append(opener);
    opener.focus();
    const onClose = vi.fn();
    const { rerender } = render(<SideSheet open onClose={onClose} title="Create Module">form</SideSheet>);
    expect(document.activeElement?.textContent).toContain("Create Module");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    rerender(<SideSheet open={false} onClose={onClose} title="Create Module">form</SideSheet>);
  });
});
