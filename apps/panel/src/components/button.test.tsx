// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, Form, RouterProvider } from "react-router";
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

  it("is busy while its own form is in flight and ignores a second press, then settles", async () => {
    let finish: (value: null) => void = () => undefined;
    let submits = 0;
    const router = createMemoryRouter([
      {
        path: "/",
        action: () => {
          submits += 1;
          return new Promise<null>((resolve) => {
            finish = resolve;
          });
        },
        element: (
          <>
            <Form method="post">
              <Button variant="primary" type="submit">
                Save
              </Button>
            </Form>
            <Button variant="secondary">Other</Button>
          </>
        ),
      },
    ]);
    render(<RouterProvider router={router} />);
    const save = screen.getByRole("button", { name: "Save" });
    expect(save.getAttribute("aria-busy")).toBeNull();

    fireEvent.click(save);
    await screen.findByRole("button", { name: "Save", busy: true });
    expect(screen.getByRole("button", { name: "Other" }).getAttribute("aria-busy")).toBeNull();
    fireEvent.click(save);
    expect(submits).toBe(1);

    await act(async () => {
      finish(null);
      await Promise.resolve();
    });
    await screen.findByRole("button", { name: "Save", busy: false });
  });
});
