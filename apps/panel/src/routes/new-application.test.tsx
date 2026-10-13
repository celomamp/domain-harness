// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRoutesStub, Outlet } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@domain-harness/contract";
import { PanelChrome } from "../components/panel-chrome.tsx";
import NewApplicationPage, { action, loader } from "./new-application.tsx";

const TENANT = "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e5f6";
const ROOT = "01928c7e-5b2a-7c3d-9e4f-a1b2c3d4e5f7";
const A = "01928c7e-5b2a-7c3d-ae4f-a1b2c3d4e5f8";
const B = "01928c7e-5b2a-7c3d-be4f-a1b2c3d4e5f9";
const APP = "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e5fb";
const AT = "2026-10-13T09:00:00.000Z";
const SESSION_TOKEN = `${TENANT}.${"S".repeat(43)}`;
const COOKIE = `dh_session=${SESSION_TOKEN}`;

const root = { id: ROOT, name: "Acme", levelName: null, parentId: null, createdAt: AT };
const a = { id: A, name: "Platform", levelName: "Division", parentId: ROOT, createdAt: AT };
const b = { id: B, name: "Web", levelName: "Product line", parentId: A, createdAt: AT };
const tree = { rootId: ROOT, projects: [root, a, b], lockedRules: [] };
const ok = (value: unknown) => ({ kind: "ok", value });

async function actionWithCookie(args: ActionFunctionArgs) {
  const body = await args.request.formData();
  const request = new Request(args.request.url, { method: "POST", body, headers: { cookie: COOKIE } });
  return action({ ...args, request });
}

function renderPage(role: Role, treeResult: Promise<unknown>) {
  const Layout = () => (
    <>
      <PanelChrome role={role} />
      <main>
        <Outlet />
      </main>
    </>
  );
  const Stub = createRoutesStub([
    {
      Component: Layout,
      children: [
        {
          path: "/new-application",
          Component: NewApplicationPage,
          loader: () => ({ tree: treeResult }),
          action: actionWithCookie,
        },
      ],
    },
  ]);
  render(<Stub initialEntries={["/new-application"]} />);
}

function registry(...answers: [number, unknown][]) {
  const queue = [...answers];
  const fetch = vi.fn(() => {
    const [status, body] = queue.shift() ?? [500, {}];
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

const status = (): HTMLElement => {
  const region = document.querySelector<HTMLElement>(".page-status");
  if (region === null) expect.fail("the page's status region is missing");
  return region;
};

const description = () => screen.getByLabelText<HTMLTextAreaElement>("Description");
const project = () => screen.getByLabelText<HTMLSelectElement>("Project");

async function submit(text: string, projectId: string): Promise<void> {
  fireEvent.change(await screen.findByLabelText("Description"), { target: { value: text } });
  await screen.findByRole("option", { name: "Web (level Product line)" });
  fireEvent.change(project(), { target: { value: projectId } });
  fireEvent.click(screen.getByRole("button", { name: "Place the Application" }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("New-application flow page", () => {
  it("shows the heading, the nav entry, a Description, a Project select with the placeholder first and the one gold button", async () => {
    renderPage("Builder", Promise.resolve(ok(tree)));
    expect(await screen.findByRole("option", { name: "Web (level Product line)" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("New-application flow");
    expect(screen.getByRole("link", { name: "New-application flow" }).getAttribute("aria-current")).toBe("page");
    expect(description().tagName).toBe("TEXTAREA");
    expect([...project().options].map((o) => [o.value, o.textContent])).toEqual([
      ["", "Choose a Project"],
      [ROOT, "Acme (root Project)"],
      [A, "Platform (level Division)"],
      [B, "Web (level Product line)"],
    ]);
    expect(project().value).toBe("");
    const place = screen.getByRole("button", { name: "Place the Application" });
    expect(place.className).toBe("button-primary");
    expect(document.querySelectorAll(".button-primary")).toHaveLength(1);
  });

  it("keeps the form structure busy while the Projects load", async () => {
    renderPage("Builder", new Promise(() => undefined));
    expect(await screen.findByText("Loading the Projects…")).toBeTruthy();
    expect(project().closest("[aria-busy]")?.getAttribute("aria-busy")).toBe("true");
    expect(description()).toBeTruthy();
    expect([...project().options].map((o) => o.textContent)).toEqual(["Choose a Project"]);
    expect(screen.getByRole("button", { name: "Place the Application" })).toBeTruthy();
  });

  it.each([
    ["an unavailable answer", () => Promise.resolve({ kind: "unavailable" })],
    [
      "a failed promise",
      () => {
        const failed = Promise.reject(new Error("down"));
        failed.catch(() => undefined);
        return failed;
      },
    ],
  ])("says the Projects are unavailable on %s, keeping the form structure", async (_label, result: () => Promise<unknown>) => {
    renderPage("Builder", result());
    expect(await screen.findByText("The Projects are unavailable right now. Try again in a few minutes.")).toBeTruthy();
    expect(description()).toBeTruthy();
    expect(project()).toBeTruthy();
    expect(screen.getByRole("button", { name: "Place the Application" })).toBeTruthy();
  });

  it("announces a placed Application naming its Project, and empties the form", async () => {
    const fetch = registry([
      201,
      { id: APP, description: "Checkout", project: { id: B, name: "Web" }, fromFlow: true, createdAt: AT },
    ]);
    renderPage("Builder", Promise.resolve(ok(tree)));
    await submit(" Checkout ", B);
    await waitFor(() => {
      expect(status().textContent).toBe("The Application is placed on Web. The Buyer sees it on Inventory now.");
    });
    expect(status().querySelector(".denial")).toBeNull();
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/v1\/applications$/);
    expect(init.body).toBe(JSON.stringify({ description: " Checkout ", projectId: B }));
    await waitFor(() => {
      expect(description().value).toBe("");
    });
    expect(project().value).toBe("");
  });

  it("names the Project field when no Project is chosen, keeping the description", async () => {
    const fetch = registry([400, { code: "invalid_input", message: "m", subject: "projectId" }]);
    renderPage("Builder", Promise.resolve(ok(tree)));
    await submit("Checkout", "");
    expect(await screen.findByText("A description with no Project is not created. Choose a Project.")).toBeTruthy();
    expect(description().value).toBe("Checkout");
    expect(project().getAttribute("aria-invalid")).toBe("true");
    expect(project().getAttribute("aria-describedby")).toBe("new-application-projectId-error");
    expect((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body).toBe(
      JSON.stringify({ description: "Checkout", projectId: "" }),
    );
  });

  it("puts ink text under the Description on a bad description, keeping the Project", async () => {
    registry([400, { code: "invalid_input", message: "m", subject: "description" }]);
    renderPage("Builder", Promise.resolve(ok(tree)));
    await submit("   ", A);
    expect(await screen.findByText("Describe the Application in 1 to 500 characters. Nothing was created.")).toBeTruthy();
    expect(description().getAttribute("aria-invalid")).toBe("true");
    expect(project().value).toBe(A);
  });

  it("announces a denial naming the Project when the Builder has no build grant", async () => {
    registry([403, { code: "build_grant_denied", message: "m", subject: "projectId" }], [200, tree]);
    renderPage("Builder", Promise.resolve(ok(tree)));
    await submit("Checkout", A);
    await waitFor(() => {
      expect(status().textContent).toBe("You have no build grant on Platform. Ask the Buyer for one. Nothing was created.");
    });
    expect(status().querySelector(".denial")).not.toBeNull();
    expect(description().value).toBe("Checkout");
  });

  it("asks for another Project when the chosen one no longer exists", async () => {
    registry([404, { code: "project_not_found", message: "m", subject: "projectId" }]);
    renderPage("Buyer", Promise.resolve(ok(tree)));
    await submit("Checkout", A);
    await waitFor(() => {
      expect(status().textContent).toBe("That Project no longer exists. Choose another Project. Nothing was created.");
    });
  });
});

describe("/new-application loader and action", () => {
  const actionArgs = (fields: Record<string, string>, headers: Record<string, string> = { cookie: COOKIE }) =>
    ({
      request: new Request("http://x/new-application", { method: "POST", body: new URLSearchParams(fields), headers }),
      params: {},
      context: {},
    }) as unknown as ActionFunctionArgs;

  it("defers the tree, and redirects to sign-in without a session cookie", async () => {
    registry([200, tree]);
    const result = loader({ request: new Request("http://x/new-application", { headers: { cookie: COOKIE } }) } as LoaderFunctionArgs);
    if (result instanceof Response) throw new Error("expected data");
    expect(result.tree).toBeInstanceOf(Promise);
    expect(await result.tree).toEqual(ok(tree));
    const away = loader({ request: new Request("http://x/new-application") } as LoaderFunctionArgs);
    expect((away as Response).headers.get("location")).toBe("/sign-in");
  });

  it("redirects to sign-in on a lapsed session and without a cookie", async () => {
    registry([401, { code: "session_invalid", message: "m", subject: "session" }]);
    const lapsed = await action(actionArgs({ description: "x", projectId: A }));
    expect((lapsed as Response).headers.get("location")).toBe("/sign-in");
    const none = await action(actionArgs({ description: "x", projectId: A }, {}));
    expect((none as Response).headers.get("location")).toBe("/sign-in");
  });

  it.each([
    ["an outage", () => Promise.reject(new Error("down"))],
    ["an unexpected refusal", () => Promise.resolve(new Response(JSON.stringify({ code: "not_found", message: "m", subject: "/" }), { status: 404 }))],
  ])("says the flow is unavailable on %s, keeping the values", async (_label, answer) => {
    vi.stubGlobal("fetch", vi.fn(answer));
    const result = (await action(actionArgs({ description: "x", projectId: A }))) as unknown as {
      data: { status: unknown; values: unknown };
      init: { status: number };
    };
    expect(result.init.status).toBe(503);
    expect(result.data.status).toEqual({
      tone: "denial",
      message: "The New-application flow is unavailable right now, so nothing was created. Try again in a few minutes.",
    });
    expect(result.data.values).toEqual({ description: "x", projectId: A });
  });

  it("falls back to the Project id when the tree cannot be read for a build grant denial", async () => {
    registry([403, { code: "build_grant_denied", message: "m", subject: "projectId" }], [503, {}]);
    const result = (await action(actionArgs({ description: "x", projectId: A }))) as unknown as { data: { status: { message: string } } };
    expect(result.data.status.message).toBe(`You have no build grant on ${A}. Ask the Buyer for one. Nothing was created.`);
  });
});
