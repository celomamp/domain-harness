// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createRoutesStub, Outlet } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Role, UuidV7 } from "@domain-harness/contract";
import { PanelChrome } from "../components/panel-chrome.tsx";
import NewApplicationPage, { action, loader, newApplicationStep } from "./new-application.tsx";

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

const UNSET = { url: null, changedAt: null };
const URL_A = "https://g.acme.example/v1";

function renderPage(role: Role, treeResult: Promise<unknown>, endpointResult: Promise<unknown> = Promise.resolve(ok(UNSET))) {
  const Layout = () => (
    <PanelChrome role={role}>
      <Outlet />
    </PanelChrome>
  );
  const Stub = createRoutesStub([
    {
      id: "routes/panel-layout",
      Component: Layout,
      loader: () => ({ role }),
      children: [
        {
          path: "/new-application",
          Component: NewApplicationPage,
          loader: () => ({ tree: treeResult, endpoint: endpointResult }),
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

/**
 * The place form's fields, by their DOM id. Both forms on the page label their
 * fields "Description" and "Project", so the id prefix tells them apart.
 */
const description = (): HTMLTextAreaElement => must("#new-application-description") as HTMLTextAreaElement;
const project = (): HTMLSelectElement => must("#new-application-projectId") as HTMLSelectElement;

const must = (selector: string): Element => {
  const element = document.querySelector(selector);
  if (element === null) expect.fail(`missing element ${selector}`);
  return element;
};

/** Waits until the "Web" Project of the tree has loaded into `select`. */
const webOption = async (select: () => HTMLSelectElement): Promise<void> => {
  await waitFor(() => {
    const option = [...select().options].find((o) => o.textContent === "Web (level Product line)");
    expect(option).toBeTruthy();
  });
};

/** Waits until the given field is mounted (the stub's first render is asynchronous). */
const mounted = (selector: string): Promise<void> =>
  waitFor(() => {
    expect(document.querySelector(selector)).not.toBeNull();
  });

async function activateTab(label: string): Promise<void> {
  fireEvent.click(await screen.findByRole("tab", { name: label }));
}

const currentRailStep = (): string | undefined =>
  document.querySelector(".flow-step[aria-current='step'] span:last-child")?.textContent ?? undefined;

async function submit(text: string, projectId: string): Promise<void> {
  await mounted("#new-application-description");
  fireEvent.change(description(), { target: { value: text } });
  await webOption(project);
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
    await webOption(project);
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

  it("shows the Place → Generate → Result rail with the current step", async () => {
    renderPage("Builder", Promise.resolve(ok(tree)));
    await webOption(project);
    const rail = screen.getByRole("list", { name: "Application flow progress" });
    expect(within(rail).getAllByRole("listitem").map((item) => item.querySelector("span:last-child")?.textContent)).toEqual([
      "Place",
      "Generate",
      "Result",
    ]);
    expect(currentRailStep()).toBe("Place");
  });

  it("puts Register existing in its own tab, not on the progress rail", async () => {
    renderPage("Builder", Promise.resolve(ok(tree)));
    expect(await screen.findByRole("tab", { name: "Place an application" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Generate Boilerplate" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Register existing" })).toBeTruthy();
    const rail = screen.getByRole("list", { name: "Application flow progress" });
    expect(rail.textContent).not.toContain("Register existing");
  });

  it("describes the flow for the signed-in role", async () => {
    renderPage("Buyer", Promise.resolve(ok(tree)));
    await screen.findByRole("heading", { name: "New-application flow" });
    expect(screen.getByText(/Buyers can place an Application/)).toBeTruthy();
    cleanup();
    renderPage("Builder", Promise.resolve(ok(tree)));
    await screen.findByRole("heading", { name: "New-application flow" });
    expect(screen.getByText(/Builders place an Application/)).toBeTruthy();
  });

  it("maps action results to the explanatory progress step", () => {
    expect(newApplicationStep(undefined)).toBe("place");
    expect(
      newApplicationStep({ intent: "place", status: { tone: "notice", message: "Placed" }, fieldErrors: {}, values: {}, placedId: APP }),
    ).toBe("boilerplate");
    expect(
      newApplicationStep({
        intent: "boilerplate",
        status: { tone: "notice", message: "Ready" },
        fieldErrors: {},
        values: {},
        placedId: APP,
        boilerplate: {
          applicationId: APP as UuidV7,
          target: "claude-code",
          archiveName: "boilerplate.tar.gz",
          archiveBase64: "",
          artifacts: [],
        },
      }),
    ).toBe("result");
  });

  it("keeps the form structure busy while the Projects load", async () => {
    renderPage("Builder", new Promise(() => undefined));
    expect(await screen.findAllByText("Loading the Projects…")).toHaveLength(2);
    expect(project().closest("[aria-busy]")?.getAttribute("aria-busy")).toBe("true");
    expect(document.querySelectorAll(".standard-form__fields[aria-busy='true']")).toHaveLength(3);
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
    expect((await screen.findAllByText("The Projects are unavailable right now. Try again in a few minutes.")).length).toBeGreaterThan(0);
    expect(document.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(document.querySelectorAll(".banner").length).toBeGreaterThan(0);
    expect(description()).toBeTruthy();
    expect(project()).toBeTruthy();
    expect(screen.getByRole("button", { name: "Place the Application" })).toBeTruthy();
  });

  it("announces a placed Application naming its Project, and empties the form", async () => {
    const fetch = registry([
      201,
      { id: APP, description: "Checkout", project: { id: B, name: "Web" }, fromFlow: true, agentTool: null, createdAt: AT },
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
    expect(currentRailStep()).toBe("Generate");
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Generate Boilerplate" }));
    });
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

describe("Registering an existing Application", () => {
  const rendering = {
    fileName: ".domain-harness.json",
    content: `{"version":"1.0.0","applicationId":"${APP}","projectId":"${B}"}`,
  };
  const registerDescription = (): HTMLTextAreaElement =>
    must("#register-application-description") as HTMLTextAreaElement;
  const registerProject = (): HTMLSelectElement => must("#register-application-projectId") as HTMLSelectElement;

  async function submitRegister(text: string, projectId: string): Promise<void> {
    await activateTab("Register existing");
    await mounted("#register-application-description");
    fireEvent.change(registerDescription(), { target: { value: text } });
    await webOption(registerProject);
    fireEvent.change(registerProject(), { target: { value: projectId } });
    fireEvent.click(screen.getByRole("button", { name: "Register the Application" }));
  }

  it("shows the register form to every role, with a secondary button and gold kept on the place form", async () => {
    renderPage("Buyer", Promise.resolve(ok(tree)));
    await activateTab("Register existing");
    expect(await screen.findByRole("heading", { name: "Register an existing Application" })).toBeTruthy();
    expect(registerDescription().tagName).toBe("TEXTAREA");
    await webOption(registerProject);
    expect([...registerProject().options].map((o) => [o.value, o.textContent])).toEqual([
      ["", "Choose a Project"],
      [ROOT, "Acme (root Project)"],
      [A, "Platform (level Division)"],
      [B, "Web (level Product line)"],
    ]);
    expect(registerProject().value).toBe("");
    expect(screen.getByRole("button", { name: "Register the Application" }).className).toBe("button-inverse");
    expect(document.querySelectorAll(".button-primary")).toHaveLength(1);
  });

  it("registers for the Buyer: names the file, shows its exact content, and empties the form", async () => {
    const fetch = registry([201, rendering]);
    renderPage("Buyer", Promise.resolve(ok(tree)));
    await submitRegister(" Legacy checkout ", B);
    await waitFor(() => {
      expect(status().textContent).toBe(
        "The Application is registered. Commit .domain-harness.json to the repository root. No Boilerplate is generated for a registered Application.",
      );
    });
    expect(status().querySelector(".denial")).toBeNull();
    const section = await screen.findByRole("region", { name: "Project identification file" });
    expect(section.className).toBe("boilerplate-result");
    expect(screen.getByText("File: .domain-harness.json")).toBeTruthy();
    expect(section.querySelector("pre")?.textContent).toBe(rendering.content);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/v1\/applications\/registered$/);
    expect(init.body).toBe(JSON.stringify({ description: " Legacy checkout ", projectId: B }));
    await waitFor(() => {
      expect(registerDescription().value).toBe("");
    });
    expect(registerProject().value).toBe("");
  });

  it("announces a denial when a Builder registers, keeping the submitted values", async () => {
    registry([403, { code: "role_denied", message: "m", subject: "role" }]);
    renderPage("Builder", Promise.resolve(ok(tree)));
    await submitRegister("Legacy", A);
    await waitFor(() => {
      expect(status().textContent).toBe("Only the Buyer can register an existing Application. Nothing was created.");
    });
    expect(status().querySelector(".denial")).not.toBeNull();
    expect(registerDescription().value).toBe("Legacy");
    expect(registerProject().value).toBe(A);
  });

  it("puts ink text under the register form's Description on a bad description, keeping the Project", async () => {
    registry([400, { code: "invalid_input", message: "m", subject: "description" }]);
    renderPage("Buyer", Promise.resolve(ok(tree)));
    await submitRegister("   ", A);
    expect(await screen.findByText("Describe the Application in 1 to 500 characters. Nothing was created.")).toBeTruthy();
    expect(registerDescription().getAttribute("aria-invalid")).toBe("true");
    expect(registerDescription().getAttribute("aria-describedby")).toBe("register-application-description-error");
    expect(registerProject().value).toBe(A);
    // The place form is untouched.
    expect(document.querySelector("#new-application-description-error")).toBeNull();
  });

  it("names the register form's Project field when no Project is chosen, keeping the description", async () => {
    registry([400, { code: "invalid_input", message: "m", subject: "projectId" }]);
    renderPage("Buyer", Promise.resolve(ok(tree)));
    await submitRegister("Legacy", "");
    expect(await screen.findByText("A description with no Project is not created. Choose a Project.")).toBeTruthy();
    expect(registerProject().getAttribute("aria-invalid")).toBe("true");
    expect(registerProject().getAttribute("aria-describedby")).toBe("register-application-projectId-error");
    expect(registerDescription().value).toBe("Legacy");
  });

  it("asks for another Project when the chosen one no longer exists", async () => {
    registry([404, { code: "project_not_found", message: "m", subject: "projectId" }]);
    renderPage("Buyer", Promise.resolve(ok(tree)));
    await submitRegister("Legacy", A);
    await waitFor(() => {
      expect(status().textContent).toBe("That Project no longer exists. Choose another Project. Nothing was created.");
    });
  });

  it("says the registration is unavailable on anything else", async () => {
    await submitRegisterExpectingUnavailable([409, { code: "slot_conflict", message: "m", subject: "s" }]);
    await submitRegisterExpectingUnavailable([500, {}]);
  });

  async function submitRegisterExpectingUnavailable(...answers: [number, unknown][]): Promise<void> {
    registry(...answers);
    renderPage("Buyer", Promise.resolve(ok(tree)));
    await submitRegister("Legacy", A);
    await waitFor(() => {
      expect(status().textContent).toBe(
        "The Application could not be registered right now, so nothing was created. Try again in a few minutes.",
      );
    });
    cleanup();
  }
});

describe("Boilerplate and Guidance endpoint on the New-application flow", () => {
  const placedAnswer: [number, unknown] = [
    201,
    { id: APP, description: "Checkout", project: { id: B, name: "Web" }, fromFlow: true, agentTool: null, createdAt: AT },
  ];
  const result = {
    applicationId: APP,
    target: "claude-code",
    archiveName: `domain-harness-${APP}-claude-code.tar.gz`,
    archiveBase64: "H4sIAAAAAAACA2NgGAWjYBSMglEwCoYmAAA1dk3oAAQAAA==",
    artifacts: [
      { kind: "identification-file", path: ".domain-harness.json" },
      { kind: "dependency-pins", path: "package.json" },
      { kind: "design-system-references", path: "design-system.json" },
      { kind: "mcp-configuration", path: ".mcp.json" },
      { kind: "instructions", path: "CLAUDE.md" },
      { kind: "skills", path: ".claude/skills/domain-harness-guidance/SKILL.md" },
    ],
  };
  const cursorResult = {
    applicationId: APP,
    target: "cursor",
    archiveName: `domain-harness-${APP}-cursor.tar.gz`,
    archiveBase64: "H4sIAAAAAAACA2NgGAWjYBSMglEwCoYmAAA1dk3oAAQAAA==",
    artifacts: [
      { kind: "identification-file", path: ".domain-harness.json" },
      { kind: "dependency-pins", path: "package.json" },
      { kind: "design-system-references", path: "design-system.json" },
      { kind: "mcp-configuration", path: ".cursor/mcp.json" },
      { kind: "instructions", path: "AGENTS.md" },
      { kind: "skills", path: ".cursor/skills/domain-harness-guidance/SKILL.md" },
    ],
  };
  const endpointField = () => screen.getByLabelText<HTMLInputElement>("Guidance endpoint URL");

  async function placeAndGenerate(...answers: [number, unknown][]) {
    const fetch = registry(placedAnswer, ...answers);
    renderPage("Builder", Promise.resolve(ok(tree)));
    await submit("Checkout", B);
    fireEvent.click(await screen.findByRole("button", { name: "Generate the Boilerplate" }));
    return fetch;
  }

  it("shows the endpoint form to every role, with Not set. and a secondary button", async () => {
    renderPage("Builder", Promise.resolve(ok(tree)));
    expect(await screen.findByText("Not set.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Company Guidance endpoint" })).toBeTruthy();
    const companySetup = screen.getByRole("heading", { name: "Company setup" }).closest(".section-card");
    expect(companySetup).not.toBeNull();
    expect(within(companySetup as HTMLElement).getByText("Buyer")).toBeTruthy();
    expect(endpointField().value).toBe("");
    expect(screen.getByRole("button", { name: "Set the Guidance endpoint" }).className).toBe("button-inverse");
    expect(document.querySelectorAll(".button-primary")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Generate the Boilerplate" })).toBeNull();
  });

  it("fills the field with the current URL", async () => {
    renderPage("Buyer", Promise.resolve(ok(tree)), Promise.resolve(ok({ url: URL_A, changedAt: AT })));
    expect(await screen.findByText(`Current endpoint: ${URL_A}`)).toBeTruthy();
    expect(endpointField().value).toBe(URL_A);
  });

  it("keeps the endpoint form structure while the state loads, and says when it is unavailable", async () => {
    renderPage("Buyer", Promise.resolve(ok(tree)), new Promise(() => undefined));
    expect(await screen.findByText("Loading the Guidance endpoint…")).toBeTruthy();
    expect(endpointField().closest("[aria-busy]")).not.toBeNull();
    cleanup();
    renderPage("Buyer", Promise.resolve(ok(tree)), Promise.resolve({ kind: "unavailable" }));
    expect(await screen.findByText("The Guidance endpoint is unavailable right now. Try again in a few minutes.")).toBeTruthy();
    expect(endpointField()).toBeTruthy();
  });

  it("lets the Buyer set the endpoint, announcing it", async () => {
    const fetch = registry([200, { url: URL_A, changedAt: AT }]);
    renderPage("Buyer", Promise.resolve(ok(tree)));
    fireEvent.change(await screen.findByLabelText("Guidance endpoint URL"), { target: { value: URL_A } });
    fireEvent.click(screen.getByRole("button", { name: "Set the Guidance endpoint" }));
    await waitFor(() => {
      expect(status().textContent).toBe(`The Company Guidance endpoint is set to ${URL_A}.`);
    });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/v1\/guidance-endpoint$/);
    expect(init.body).toBe(JSON.stringify({ url: URL_A }));
  });

  it("announces a denial when a Builder sets the endpoint, keeping the value", async () => {
    registry([403, { code: "role_denied", message: "m", subject: "role" }]);
    renderPage("Builder", Promise.resolve(ok(tree)));
    fireEvent.change(await screen.findByLabelText("Guidance endpoint URL"), { target: { value: URL_A } });
    fireEvent.click(screen.getByRole("button", { name: "Set the Guidance endpoint" }));
    await waitFor(() => {
      expect(status().textContent).toBe("Only the Buyer can set the Company Guidance endpoint. Nothing was changed.");
    });
    expect(status().querySelector(".denial")).not.toBeNull();
    expect(endpointField().value).toBe(URL_A);
  });

  it("puts ink text under the URL on an invalid URL", async () => {
    registry([400, { code: "invalid_input", message: "m", subject: "url" }]);
    renderPage("Buyer", Promise.resolve(ok(tree)));
    fireEvent.change(await screen.findByLabelText("Guidance endpoint URL"), { target: { value: "http://x" } });
    fireEvent.click(screen.getByRole("button", { name: "Set the Guidance endpoint" }));
    expect(
      await screen.findByText(
        "Enter an https URL of up to 2048 characters with no user name, password or fragment. Nothing was changed.",
      ),
    ).toBeTruthy();
    expect(endpointField().getAttribute("aria-invalid")).toBe("true");
    expect(endpointField().value).toBe("http://x");
  });

  it("offers the Boilerplate after a placement: a labelled Agent tool select with both agent tools", async () => {
    registry(placedAnswer);
    renderPage("Builder", Promise.resolve(ok(tree)));
    await submit("Checkout", B);
    const tool = await screen.findByLabelText<HTMLSelectElement>("Agent tool");
    expect([...tool.options].map((o) => [o.value, o.textContent])).toEqual([
      ["claude-code", "Claude Code"],
      ["cursor", "Cursor"],
    ]);
    expect(tool.value).toBe("claude-code");
    expect(screen.getByRole("button", { name: "Generate the Boilerplate" }).className).toBe("button-inverse");
    expect(document.querySelectorAll(".button-primary")).toHaveLength(1);
  });

  it("renders Boilerplate artifacts as cards that copy their paths, with a commit note and archive download", async () => {
    const fetch = await placeAndGenerate([200, result]);
    await screen.findByText("The Claude Code Boilerplate is ready to download.");
    const section = document.querySelector(".artifact-grid")?.closest(".section-card") ?? null;
    expect(section).not.toBeNull();
    const artifactSection = section as HTMLElement;
    expect(artifactSection.className).toContain("section-card");
    expect(within(artifactSection).getByRole("heading", { name: "Boilerplate" })).toBeTruthy();
    const cards = [...artifactSection.querySelectorAll<HTMLElement>(".artifact-card")];
    expect(cards.map((card) => card.querySelector(".artifact-card__kind")?.textContent)).toEqual([
      "Project identification file",
      "Dependency pins",
      "Design-system references",
      "MCP configuration",
      "Instructions",
      "Skills",
    ]);
    expect(cards.map((card) => card.querySelector(".artifact-card__path")?.textContent)).toEqual([
      ".domain-harness.json",
      "package.json",
      "design-system.json",
      ".mcp.json",
      "CLAUDE.md",
      ".claude/skills/domain-harness-guidance/SKILL.md",
    ]);
    expect(cards).toHaveLength(result.artifacts.length);
    for (const card of cards) {
      expect(within(card).getByRole("button", { name: "Copy" })).toBeTruthy();
    }
    const writeText = vi.fn().mockResolvedValue(undefined);
    const originalClipboard = navigator.clipboard;
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    fireEvent.click(within(cards[0] as HTMLElement).getByRole("button", { name: "Copy" }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(".domain-harness.json");
    });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: originalClipboard });
    expect(screen.getByText("Commit .domain-harness.json to the repository root.")).toBeTruthy();
    const link = screen.getByRole("link", { name: "Download the archive" });
    expect(link.getAttribute("download")).toBe(result.archiveName);
    expect(link.getAttribute("href")).toBe(`data:application/gzip;base64,${result.archiveBase64}`);
    expect(status().textContent).toBe("The Claude Code Boilerplate is ready to download.");
    expect(currentRailStep()).toBe("Result");
    expect(screen.getByRole("button", { name: "Generate the Boilerplate" })).toBeTruthy();
    const [url, init] = fetch.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toMatch(new RegExp(`/v1/applications/${APP}/boilerplate$`));
    expect(init.body).toBe(JSON.stringify({ target: "claude-code" }));
  });

  it("generates for Cursor when it is chosen in the select, with the Cursor result surface", async () => {
    const fetch = registry(placedAnswer, [200, cursorResult]);
    renderPage("Builder", Promise.resolve(ok(tree)));
    await submit("Checkout", B);
    fireEvent.change(await screen.findByLabelText("Agent tool"), { target: { value: "cursor" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate the Boilerplate" }));
    await screen.findByText("The Cursor Boilerplate is ready to download.");
    const section = document.querySelector(".artifact-grid")?.closest(".section-card");
    if (section === null || section === undefined) throw new Error("the Boilerplate SectionCard is missing");
    expect(section.className).toContain("section-card");
    expect([...section.querySelectorAll(".artifact-card__path")].map((path) => path.textContent)).toEqual([
      ".domain-harness.json",
      "package.json",
      "design-system.json",
      ".cursor/mcp.json",
      "AGENTS.md",
      ".cursor/skills/domain-harness-guidance/SKILL.md",
    ]);
    const link = screen.getByRole("link", { name: "Download the archive" });
    expect(link.getAttribute("download")).toBe(cursorResult.archiveName);
    expect(link.getAttribute("href")).toBe(`data:application/gzip;base64,${cursorResult.archiveBase64}`);
    expect(status().textContent).toBe("The Cursor Boilerplate is ready to download.");
    const [url, init] = fetch.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toMatch(new RegExp(`/v1/applications/${APP}/boilerplate$`));
    expect(init.body).toBe('{"target":"cursor"}');
  });

  it("asks for the Buyer when the endpoint is unset, keeping the Boilerplate form", async () => {
    await placeAndGenerate([409, { code: "guidance_endpoint_unset", message: "m", subject: "guidanceEndpoint" }]);
    await waitFor(() => {
      expect(status().textContent).toBe(
        "The Company Guidance endpoint is not set. Ask the Buyer to set it. Nothing was generated.",
      );
    });
    expect(status().querySelector(".denial")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Generate the Boilerplate" })).toBeTruthy();
    expect(document.querySelector(".boilerplate-result")).toBeNull();
  });

  it.each(["unsupported_ecosystem", "boilerplate_conflict"])("shows the registry's sentence on %s", async (code) => {
    const message = "The Effective Standard set requires language Go, so nothing was generated";
    await placeAndGenerate([409, { code, message, subject: "standards" }]);
    await waitFor(() => {
      expect(status().textContent).toBe(`${message}.`);
    });
    expect(status().querySelector(".denial")).not.toBeNull();
  });

  it("says the Boilerplate is unavailable on anything else", async () => {
    await placeAndGenerate([404, { code: "application_not_found", message: "m", subject: "applicationId" }]);
    await waitFor(() => {
      expect(status().textContent).toBe(
        "The Boilerplate is unavailable right now, so nothing was generated. Try again in a few minutes.",
      );
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
    expect(result.endpoint).toBeInstanceOf(Promise);
    expect(await result.tree).toEqual(ok(tree));
    expect(await result.endpoint).toEqual({ kind: "unavailable" });
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

  it("redirects to sign-in on a lapsed session for the endpoint and the Boilerplate", async () => {
    for (const fields of [
      { intent: "guidance-endpoint", url: "https://g.example" },
      { intent: "boilerplate", applicationId: APP, target: "claude-code" },
    ]) {
      registry([401, { code: "session_invalid", message: "m", subject: "session" }]);
      const lapsed = await action(actionArgs(fields));
      expect((lapsed as Response).headers.get("location")).toBe("/sign-in");
    }
  });

  it.each([
    ["an outage", () => Promise.reject(new Error("down"))],
    ["an unexpected refusal", () => Promise.resolve(new Response(JSON.stringify({ code: "not_found", message: "m", subject: "/" }), { status: 404 }))],
  ])("says the endpoint could not be set on %s, keeping the URL", async (_label, answer) => {
    vi.stubGlobal("fetch", vi.fn(answer));
    const result = (await action(actionArgs({ intent: "guidance-endpoint", url: "https://g.example" }))) as unknown as {
      data: { status: unknown; endpoint: { value: string } };
      init: { status: number };
    };
    expect(result.init.status).toBe(503);
    expect(result.data.status).toEqual({
      tone: "denial",
      message: "The Guidance endpoint could not be set right now, so nothing was changed. Try again in a few minutes.",
    });
    expect(result.data.endpoint.value).toBe("https://g.example");
  });

  it("carries the placed Application through an endpoint submit", async () => {
    registry([200, { url: "https://g.example", changedAt: AT }]);
    const result = (await action(
      actionArgs({ intent: "guidance-endpoint", url: "https://g.example", applicationId: APP }),
    )) as unknown as { data: { placedId: string } };
    expect(result.data.placedId).toBe(APP);
  });

  it("falls back to the Project id when the tree cannot be read for a build grant denial", async () => {
    registry([403, { code: "build_grant_denied", message: "m", subject: "projectId" }], [503, {}]);
    const result = (await action(actionArgs({ description: "x", projectId: A }))) as unknown as { data: { status: { message: string } } };
    expect(result.data.status.message).toBe(`You have no build grant on ${A}. Ask the Buyer for one. Nothing was created.`);
  });

  it("redirects to sign-in on a lapsed session for the register form", async () => {
    registry([401, { code: "session_invalid", message: "m", subject: "session" }]);
    const lapsed = await action(actionArgs({ intent: "register", description: "x", projectId: A }));
    expect((lapsed as Response).headers.get("location")).toBe("/sign-in");
  });

  it.each([
    ["an outage", () => Promise.reject(new Error("down"))],
    ["an unexpected refusal", () => Promise.resolve(new Response(JSON.stringify({ code: "not_found", message: "m", subject: "/" }), { status: 404 }))],
  ])("reports a refused registration on %s as a 503 denial, keeping the values", async (_label, answer) => {
    vi.stubGlobal("fetch", vi.fn(answer));
    const result = (await action(actionArgs({ intent: "register", description: "x", projectId: A }))) as unknown as {
      data: { status: unknown; values: unknown };
      init: { status: number };
    };
    expect(result.init.status).toBe(503);
    expect(result.data.status).toEqual({
      tone: "denial",
      message: "The Application could not be registered right now, so nothing was created. Try again in a few minutes.",
    });
    expect(result.data.values).toEqual({ description: "x", projectId: A });
  });
});
