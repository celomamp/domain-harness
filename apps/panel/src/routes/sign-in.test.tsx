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

  it("keeps the form visible until a second sign-in request resolves", async () => {
    let resolveSecond: ((response: Response) => void) | undefined;
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response("{}", { status: 202 }))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveSecond = resolve;
          }),
      );
    vi.stubGlobal("fetch", fetch);

    renderSignIn();
    await submit("bea@acme.io");
    await screen.findByRole("heading", { name: "Check your email" });
    fireEvent.click(screen.getByRole("button", { name: "Use a different address" }));

    const input = screen.getByLabelText<HTMLInputElement>("Email address");
    fireEvent.change(input, { target: { value: "new@acme.io" } });
    fireEvent.click(screen.getByRole("button", { name: "Email me a sign-in link" }));
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    expect(screen.getByLabelText("Email address")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Check your email" })).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("");
    expect(screen.getByRole("button", { name: "Email me a sign-in link" }).hasAttribute("disabled")).toBe(true);

    resolveSecond?.(new Response("{}", { status: 202 }));
    await screen.findByRole("heading", { name: "Check your email" });
    expect(screen.getByText("new@acme.io")).toBeTruthy();
  });
});

describe("sign-in with the demo toggle (staging only)", () => {
  const created = {
    sessionToken: "01928c7e-5b2a-7c3d-9e4f-a1b2c3d4e5f7.demo-token",
    expiresAt: "2099-01-01T00:00:00.000Z",
    session: {
      accountId: "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e5f6",
      tenantId: "01928c7e-5b2a-7c3d-9e4f-a1b2c3d4e5f7",
      role: "Buyer",
    },
  };
  const post = (email: string) => {
    const body = new FormData();
    body.set("email", email);
    return action({
      request: new Request("http://localhost/sign-in", { method: "POST", body }),
      params: {},
      context: {},
    } as unknown as Parameters<typeof action>[0]);
  };
  /** Answers each registry call in turn. */
  function answers(...replies: [number, unknown][]) {
    const fetch = vi.fn();
    for (const [status, body] of replies) {
      fetch.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
    }
    vi.stubGlobal("fetch", fetch);
    return fetch;
  }
  const urls = (fetch: ReturnType<typeof vi.fn>) => fetch.mock.calls.map((call) => String(call[0]).replace(/^.*(\/v1\/)/, "$1"));

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("only emails links, and says nothing about demo accounts, while PANEL_DEMO_SIGN_IN is off", async () => {
    const fetch = answers([202, {}]);
    renderSignIn();
    await screen.findByLabelText("Email address");
    expect(screen.queryByText(/demo accounts/)).toBeNull();
    await post("buyer@demo.domainharness.test");
    expect(urls(fetch)).toEqual(["/v1/sign-in-links"]);
  });

  it("signs a demo account in as soon as its address is entered, with no email", async () => {
    vi.stubEnv("PANEL_DEMO_SIGN_IN", "1");
    const fetch = answers([201, created]);
    renderSignIn();
    expect(await screen.findByText(/demo accounts sign in as soon as you enter their address/)).toBeTruthy();

    const response = (await post(" Buyer@Demo.DomainHarness.test ")) as Response;
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/inventory");
    expect(response.headers.get("Set-Cookie")).toContain(`dh_session=${created.sessionToken}`);
    expect(urls(fetch)).toEqual(["/v1/demo-sessions"]);
    const init = fetch.mock.calls[0]?.[1] as RequestInit;
    expect(init.body).toBe(JSON.stringify({ email: "buyer@demo.domainharness.test" }));
  });

  it.each([
    ["not a demo account", 401, { code: "sign_in_link_invalid", message: "m", subject: "token" }],
    ["demo sign-in off at the registry", 404, { code: "not_found", message: "m", subject: "/v1/demo-sessions" }],
  ])("emails a link as usual when the address is %s", async (_case, status, body) => {
    vi.stubEnv("PANEL_DEMO_SIGN_IN", "1");
    const fetch = answers([status, body], [202, {}]);
    const result = (await post("bea@acme.io")) as { data: { notice: string } };
    expect(result.data.notice).toBe("sent");
    expect(urls(fetch)).toEqual(["/v1/demo-sessions", "/v1/sign-in-links"]);
  });
});
