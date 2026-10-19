// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import SignIn, { action, loader } from "./sign-in.tsx";

const SENT = "Check your email for a sign-in link";

function renderSignIn(url = "/sign-in") {
  const Stub = createRoutesStub([{ path: "/sign-in", Component: SignIn, loader, action }]);
  render(<Stub initialEntries={[url]} />);
}

function registry(status: number, body: unknown) {
  const fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

async function submit(value: string): Promise<void> {
  const input = await screen.findByLabelText("Email address");
  fireEvent.change(input, { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Email me a sign-in link" }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("sign-in", () => {
  it("focuses the email field on open and has an empty status region", async () => {
    renderSignIn();
    const input = await screen.findByLabelText("Email address");
    await waitFor(() => {
      expect(document.activeElement).toBe(input);
    });
    expect(screen.getByRole("status").textContent).toBe("");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Sign in");
  });

  it("keeps tab order equal to reading order: the field, then the button, with no positive tabindex", async () => {
    renderSignIn();
    await screen.findByLabelText("Email address");
    const focusables = [...document.querySelectorAll<HTMLElement>("input, button, a[href]")];
    expect(focusables.map((el) => el.tagName)).toEqual(["INPUT", "BUTTON"]);
    expect(document.querySelectorAll("[tabindex]").length).toBe(0);
  });

  it("announces the same text as a status for a provisioned address, normalized before sending", async () => {
    const fetch = registry(202, {});
    renderSignIn();
    await submit(" Bea@Acme.io ");
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe(SENT);
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/v1\/sign-in-links$/);
    expect(init.body).toBe(JSON.stringify({ email: "bea@acme.io" }));
  });

  it("announces exactly the same text for an unknown address (the registry answers identically)", async () => {
    registry(202, {});
    renderSignIn();
    await submit("nobody@else.io");
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe(SENT);
    });
  });

  it.each([[""], ["not-an-email"]])(
    "keeps %j in the field, asks for an email address in ink text under it, and calls no registry",
    async (value) => {
      const fetch = registry(202, {});
      renderSignIn();
      await submit(value);
      const error = await screen.findByText(/Enter an email address/);
      const input = screen.getByLabelText<HTMLInputElement>("Email address");
      expect(input.value).toBe(value);
      expect(input.getAttribute("aria-invalid")).toBe("true");
      expect(input.getAttribute("aria-describedby")).toBe(error.id);
      expect(error.className).toBe("field-error");
      expect(error.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
      expect(fetch).not.toHaveBeenCalled();
      expect(screen.getByRole("status").textContent).toBe("");
    },
  );

  it("announces a denial status when sign-in is unavailable, and nothing else breaks", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("fetch failed"))));
    renderSignIn();
    await submit("bea@acme.io");
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toMatch(/Sign-in is unavailable/);
    });
    expect(screen.getByRole("status").querySelector(".denial")).not.toBeNull();
    expect(screen.getByLabelText<HTMLInputElement>("Email address").value).toBe("bea@acme.io");
  });

  it("shows the field error only for the registry's invalid_input on email", async () => {
    registry(400, { code: "invalid_input", message: "m", subject: "email" });
    renderSignIn();
    await submit("bea@acme.io");
    expect(await screen.findByText(/Enter an email address/)).toBeTruthy();
  });

  it.each([
    ["a 400 on another subject", 400, { code: "invalid_input", message: "m", subject: "body" }],
    ["a 404 from a misrouted registry URL", 404, { code: "not_found", message: "m", subject: "/v1/sign-in-links" }],
    ["a 415", 415, { code: "unsupported_media_type", message: "m", subject: "content-type" }],
  ])("shows the unavailable status, not a field error, for %s", async (_label, status, body) => {
    registry(status, body);
    renderSignIn();
    await submit("bea@acme.io");
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toMatch(/Sign-in is unavailable/);
    });
    expect(screen.queryByText(/Enter an email address/)).toBeNull();
  });

  it("announces a used or expired link as a denial and stays on sign-in", async () => {
    renderSignIn("/sign-in?status=link-invalid");
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toMatch(/already used or has expired/);
    });
    expect(screen.getByRole("status").querySelector(".denial")).not.toBeNull();
    expect(screen.getByLabelText("Email address")).toBeTruthy();
  });

  it("announces an unreachable registry from the verify redirect", async () => {
    renderSignIn("/sign-in?status=unavailable");
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toMatch(/Sign-in is unavailable/);
    });
  });

  it("uses button-primary for the one action", async () => {
    renderSignIn();
    const button = await screen.findByRole("button", { name: "Email me a sign-in link" });
    expect(button.className).toBe("button-primary");
    expect(button.getAttribute("type")).toBe("submit");
  });

  it("shows a split brand panel and a single gold action", async () => {
    renderSignIn();
    expect(await screen.findByText("Domain Harness")).toBeTruthy();
    expect(screen.getByText(/software-construction Standards/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Email me a sign-in link" }).className).toBe("button-primary");
  });

  it("replaces the form with a confirmation panel after sending", async () => {
    const fetch = registry(202, {});
    renderSignIn();
    await submit("bea@acme.io");

    const heading = await screen.findByRole("heading", { name: "Check your email" });
    expect(document.activeElement).toBe(heading);
    expect(screen.getByText("bea@acme.io")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe(SENT);
    expect(screen.queryByLabelText("Email address")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Use a different address" }));
    expect(screen.getByLabelText("Email address")).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
