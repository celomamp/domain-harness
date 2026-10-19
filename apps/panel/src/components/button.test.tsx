// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "./button.tsx";

describe("Button", () => {
  it("renders every variant with its class and a safe default type", () => {
    render(<><Button variant="primary">Go</Button><Button variant="secondary">Keep</Button><Button variant="ghost">Cancel</Button><Button variant="inverse">Back</Button></>);
    expect(screen.getByRole("button", { name: "Go" }).className).toBe("button-primary");
    expect(screen.getByRole("button", { name: "Keep" }).className).toBe("button-secondary");
    expect(screen.getByRole("button", { name: "Cancel" }).className).toBe("button-ghost");
    expect(screen.getByRole("button", { name: "Back" }).className).toBe("button-inverse");
    expect(screen.getByRole("button", { name: "Go" }).getAttribute("type")).toBe("button");
  });
});
