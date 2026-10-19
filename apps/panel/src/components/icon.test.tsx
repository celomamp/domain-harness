// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Icon } from "./icon.tsx";

describe("Icon", () => {
  it("is decorative by default", () => {
    const { container } = render(<Icon name="inventory" />);
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });
  it("is labelled when a label is provided", () => {
    render(<Icon name="inventory" label="Inventory" />);
    expect(screen.getByRole("img", { name: "Inventory" })).toBeTruthy();
  });
});
