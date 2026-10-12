// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createRoutesStub, Outlet } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@domain-harness/contract";
import { PanelChrome } from "../components/panel-chrome.tsx";
import ProjectTreePage, { action } from "./project-tree.tsx";

const TENANT = "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e5f6";
const ROOT = "01928c7e-5b2a-7c3d-9e4f-a1b2c3d4e5f7";
const A = "01928c7e-5b2a-7c3d-ae4f-a1b2c3d4e5f8";
const B = "01928c7e-5b2a-7c3d-be4f-a1b2c3d4e5f9";
const C = "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e5fa";
const AT = "2026-10-12T09:00:00.000Z";
const COOKIE = `dh_session=${TENANT}.${"S".repeat(43)}`;

const root = { id: ROOT, name: "Acme", levelName: null, parentId: null, createdAt: AT };
const a = { id: A, name: "Platform", levelName: "Division", parentId: ROOT, createdAt: AT };
const b = { id: B, name: "Web", levelName: "  Product line ", parentId: A, createdAt: AT };
const c = { id: C, name: "Data", levelName: "Division", parentId: ROOT, createdAt: AT };
const fullTree = { rootId: ROOT, projects: [root, a, b, c] };
const onlyRoot = { rootId: ROOT, projects: [root] };

/** The real action, with the session cookie a browser would send. */
async function actionWithCookie(args: ActionFunctionArgs) {
  const body = await args.request.formData();
  const request = new Request(args.request.url, { method: "POST", body, headers: { cookie: COOKIE } });
  return action({ ...args, request });
}

/** The Effective Standard set the stub loader answers for the selected Project id (the root when none). */
type EffectiveFor = (projectId: string) => Promise<unknown>;

const emptySetFor: EffectiveFor = (projectId) => {
  const project = fullTree.projects.find((p) => p.id === projectId) ?? root;
  return Promise.resolve(ok({ project: { id: project.id, name: project.name }, standards: [] }));
};

function renderPage(
  role: Role,
  result: unknown,
  url = "/projects",
  pending?: Promise<unknown>,
  effectiveFor: EffectiveFor = emptySetFor,
) {
  const Layout = () => (
    <>
      <PanelChrome role={role} />
      <main>
        <Outlet />
      </main>
    </>
  );
  const loader = ({ request }: LoaderFunctionArgs) => {
    const projectParam = new URL(request.url).searchParams.get("project");
    return {
      projectParam,
      tree: pending ?? Promise.resolve(result),
      effective: effectiveFor(projectParam ?? ROOT),
    };
  };
  const Stub = createRoutesStub([
    { Component: Layout, children: [{ path: "/projects", Component: ProjectTreePage, loader, action: actionWithCookie }] },
  ]);
  render(<Stub initialEntries={[url]} />);
}

function ok(value: unknown) {
  return { kind: "ok", value };
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

const status = () => screen.getByRole("status");
const items = () => screen.getAllByRole("treeitem");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Project tree page", () => {
  it("shows an accessible tree: names with level names exactly as typed, levels, groups and the selected root", async () => {
    renderPage("Buyer", ok(fullTree));
    const tree = await screen.findByRole("tree", { name: "Project tree" });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Project tree");
    expect(screen.getByRole("link", { name: "Project tree" }).getAttribute("aria-current")).toBe("page");

    expect(items().map((item) => item.getAttribute("aria-label"))).toEqual([
      "Acme, root Project, no level name",
      "Platform, level Division",
      "Web, level   Product line ",
      "Data, level Division",
    ]);
    expect(items().map((item) => item.getAttribute("aria-level"))).toEqual(["1", "2", "3", "2"]);
    expect(items().map((item) => item.getAttribute("aria-selected"))).toEqual(["true", "false", "false", "false"]);
    expect(within(tree).getAllByRole("group")).toHaveLength(2);
    // Web sits in Platform's group.
    const platform = items()[1] as HTMLElement;
    expect(within(platform).getByRole("treeitem").getAttribute("aria-label")).toBe("Web, level   Product line ");
    expect(screen.queryByText("No Project yet beyond the root Project.")).toBeNull();
    // Roving tabindex: only the selected node is in the tab order.
    expect(items().map((item) => item.tabIndex)).toEqual([0, -1, -1, -1]);
  });

  it("selects the Project named by ?project and offers to change its parent", async () => {
    renderPage("Buyer", ok(fullTree), `/projects?project=${B}`);
    await screen.findByRole("tree");
    expect(items().map((item) => item.getAttribute("aria-selected"))).toEqual(["false", "false", "true", "false"]);
    expect(screen.getByRole("heading", { name: "Change the parent of Web" })).toBeTruthy();
    const parent = screen.getAllByLabelText<HTMLSelectElement>("Parent")[1] as HTMLSelectElement;
    expect(parent.value).toBe(A);
    const change = screen.getByRole("button", { name: "Change parent" });
    expect(change.className).toBe("button-inverse");
  });

  it("moves focus with Up, Down, Home and End and selects with Enter and Space", async () => {
    renderPage("Buyer", ok(fullTree));
    await screen.findByRole("tree");
    const tree = screen.getByRole("tree");
    (items()[0] as HTMLElement).focus();
    fireEvent.keyDown(tree, { key: "ArrowDown" });
    await waitFor(() => {
      expect(document.activeElement).toBe(items()[1]);
    });
    fireEvent.keyDown(tree, { key: "End" });
    await waitFor(() => {
      expect(document.activeElement).toBe(items()[3]);
    });
    fireEvent.keyDown(tree, { key: "ArrowUp" });
    await waitFor(() => {
      expect(document.activeElement).toBe(items()[2]);
    });
    expect(items().map((item) => item.tabIndex)).toEqual([-1, -1, 0, -1]);
    fireEvent.keyDown(tree, { key: "Enter" });
    await waitFor(() => {
      expect(items()[2]?.getAttribute("aria-selected")).toBe("true");
    });
    expect(screen.getByRole("heading", { name: "Change the parent of Web" })).toBeTruthy();
    fireEvent.keyDown(tree, { key: "Home" });
    await waitFor(() => {
      expect(document.activeElement).toBe(items()[0]);
    });
    fireEvent.keyDown(tree, { key: " " });
    await waitFor(() => {
      expect(items()[0]?.getAttribute("aria-selected")).toBe("true");
    });
    expect(screen.queryByRole("button", { name: "Change parent" })).toBeNull();
  });

  it("selects a nested Project on click, and only that Project", async () => {
    renderPage("Buyer", ok(fullTree));
    await screen.findByRole("tree");
    fireEvent.click(screen.getByText("Web"));
    await waitFor(() => {
      expect(items().map((item) => item.getAttribute("aria-selected"))).toEqual(["false", "false", "true", "false"]);
    });
    expect(screen.getByRole("heading", { name: "Change the parent of Web" })).toBeTruthy();
  });

  it("announces a successful create and empties the form", async () => {
    const created = { id: "01928c7e-5b2a-7c3d-9e4f-a1b2c3d4e5fb", name: "Mobile", levelName: "Team", parentId: ROOT, createdAt: AT };
    registry([201, created], [200, { ...fullTree, projects: [...fullTree.projects, created] }]);
    renderPage("Buyer", ok(fullTree));
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Mobile" } });
    fireEvent.change(screen.getByLabelText("Level name"), { target: { value: "Team" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Project" }));
    await waitFor(() => {
      expect(status().textContent).toBe('Created Mobile, level "Team", under Acme.');
    });
    expect(status().querySelector(".denial")).toBeNull();
    expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("");
    expect(screen.getByLabelText<HTMLInputElement>("Level name").value).toBe("");
  });

  it("labels the root by having no parent, whatever its level name", async () => {
    const named = { ...root, levelName: "Company" };
    const noLevel = { ...c, levelName: null };
    renderPage("Buyer", ok({ rootId: ROOT, projects: [named, a, b, noLevel] }));
    await screen.findByRole("tree");
    expect(items().map((item) => item.getAttribute("aria-label"))).toEqual([
      "Acme, root Project, level Company",
      "Platform, level Division",
      "Web, level   Product line ",
      "Data, no level name",
    ]);
    expect([...screen.getByLabelText<HTMLSelectElement>("Parent").options].map((o) => o.textContent)).toEqual([
      "Acme (root Project)",
      "Platform (level Division)",
      "Web (level   Product line )",
      "Data (no level name)",
    ]);
    expect(items().some((item) => item.hasAttribute("aria-expanded"))).toBe(false);
  });

  it("shows the create form to a Builder too, with Name, Level name, Parent and the one gold button", async () => {
    renderPage("Builder", ok(fullTree));
    await screen.findByRole("tree");
    expect(screen.getByRole("heading", { name: "Create a Project" })).toBeTruthy();
    const labels = [...document.querySelectorAll("form.standard-form label")].map((l) => l.textContent);
    expect(labels).toEqual(["Name", "Level name", "Parent"]);
    const parent = screen.getByLabelText<HTMLSelectElement>("Parent");
    expect([...parent.options].map((o) => [o.value, o.textContent])).toEqual([
      [ROOT, "Acme (root Project)"],
      [A, "Platform (level Division)"],
      [B, "Web (level   Product line )"],
      [C, "Data (level Division)"],
    ]);
    expect(parent.value).toBe(ROOT);
    expect(screen.getByRole("button", { name: "Create Project" }).className).toBe("button-primary");
    expect(document.querySelectorAll(".button-primary")).toHaveLength(1);
    // The root's parent cannot change: no change-parent form while the root is selected.
    expect(screen.queryByRole("button", { name: "Change parent" })).toBeNull();
  });

  it("announces the registry's denial to a Builder as a status, and the tree is unchanged", async () => {
    const fetch = registry([403, { code: "role_denied", message: "m", subject: "role" }]);
    renderPage("Builder", ok(fullTree));
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Mobile" } });
    fireEvent.change(screen.getByLabelText("Level name"), { target: { value: "Team" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Project" }));
    await waitFor(() => {
      expect(status().textContent).toBe("Only the Buyer can change the Project tree. Nothing was changed.");
    });
    expect(status().querySelector(".denial")).not.toBeNull();
    expect(items()).toHaveLength(4);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps every value and puts ink text under the field on an invalid submit", async () => {
    registry([400, { code: "invalid_input", message: "m", subject: "levelName" }]);
    renderPage("Buyer", ok(fullTree));
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: " Mobile " } });
    fireEvent.change(screen.getByLabelText("Level name"), { target: { value: "   " } });
    fireEvent.change(screen.getByLabelText("Parent"), { target: { value: A } });
    fireEvent.click(screen.getByRole("button", { name: "Create Project" }));
    const error = await screen.findByText("Enter a level name of 1 to 200 characters that is not only spaces.");
    expect(error.className).toBe("field-error");
    const level = screen.getByLabelText<HTMLInputElement>("Level name");
    expect(level.value).toBe("   ");
    expect(level.getAttribute("aria-invalid")).toBe("true");
    expect(level.getAttribute("aria-describedby")).toBe(error.id);
    expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe(" Mobile ");
    expect(screen.getByLabelText<HTMLSelectElement>("Parent").value).toBe(A);
  });

  it("names the parent that closes a cycle in the status", async () => {
    registry([409, { code: "project_cycle", message: "m", subject: B }], [200, fullTree]);
    renderPage("Buyer", ok(fullTree), `/projects?project=${A}`);
    await screen.findByRole("heading", { name: "Change the parent of Platform" });
    const parent = screen.getAllByLabelText<HTMLSelectElement>("Parent")[1] as HTMLSelectElement;
    fireEvent.change(parent, { target: { value: B } });
    fireEvent.click(screen.getByRole("button", { name: "Change parent" }));
    await waitFor(() => {
      expect(status().textContent).toBe(
        "Nothing was changed. Web is a descendant of Platform, so it cannot be its parent. Choose another parent.",
      );
    });
  });

  it("shows the empty state when only the root exists", async () => {
    renderPage("Buyer", ok(onlyRoot));
    expect(await screen.findByText("No Project yet beyond the root Project.")).toBeTruthy();
    expect(items().map((item) => item.getAttribute("aria-label"))).toEqual(["Acme, root Project, no level name"]);
    expect(screen.getByRole("button", { name: "Create Project" })).toBeTruthy();
  });

  it("shows the structure while the tree loads: the heading, a busy tree region, no forms", async () => {
    renderPage("Buyer", null, "/projects", new Promise(() => undefined));
    expect(await screen.findByText("Loading the Project tree…")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Project tree");
    const region = screen.getByRole("region", { name: "Project tree" });
    expect(region.getAttribute("aria-busy")).toBe("true");
    expect(document.querySelectorAll("form")).toHaveLength(0);
    expect(screen.queryByRole("tree")).toBeNull();
  });

  it("keeps the structure and says the tree is unavailable when the registry is down", async () => {
    renderPage("Buyer", { kind: "unavailable" });
    await waitFor(() => {
      expect(status().textContent).toBe("The Project tree is unavailable right now. Try again in a few minutes.");
    });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Project tree");
    expect(screen.queryByRole("tree")).toBeNull();
  });

  it("offers to sign in again when the session has ended", async () => {
    renderPage("Buyer", { kind: "refused", error: { code: "session_invalid", message: "m", subject: "session" } });
    expect(await screen.findByRole("link", { name: "Sign in again" })).toBeTruthy();
    expect(status().textContent).toBe("Your session has ended, so the Project tree cannot be shown.");
  });
});

describe("Effective Standard set preview", () => {
  const OWNER = "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e5fb";
  const MODULE = "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e5fc";
  const standard = (id: string, project: { id: string; name: string }, version: number, entry: unknown, kind = "code-stack") => ({
    id,
    version,
    module: { id: MODULE, kind, name: "Stack" },
    project,
    entry,
    publishedAt: AT,
    publishedBy: { accountId: OWNER, name: "Sam" },
  });
  const webRef = { id: B, name: "Web" };
  const platformRef = { id: A, name: "Platform" };
  const webSet = {
    project: webRef,
    standards: [
      {
        slot: { moduleKind: "code-stack", slotKind: "library", name: "x" },
        status: "prohibited",
        standard: standard("01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e601", webRef, 1, {
          category: "library",
          name: "x",
          versionConstraint: null,
          status: "prohibited",
          correctionInstruction: null,
        }),
        sourceProject: webRef,
        locked: false,
      },
      {
        slot: { moduleKind: "design-system", slotKind: "component", name: "Button" },
        status: null,
        standard: standard(
          "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e602",
          platformRef,
          3,
          { kind: "component", name: "Button", usageRule: "Primary actions", tokens: [], correctionInstruction: null },
          "design-system",
        ),
        sourceProject: platformRef,
        locked: false,
      },
    ],
  };
  const setsFor: EffectiveFor = (projectId) => (projectId === B ? Promise.resolve(ok(webSet)) : emptySetFor(projectId));
  const section = () => screen.getByRole("region", { name: /^Effective Standard set for / });

  it("shows the selected Project's set in a table with header cells once the Buyer selects it", async () => {
    renderPage("Buyer", ok(fullTree), "/projects", undefined, setsFor);
    expect(await screen.findByText("No Standard applies to Acme yet.")).toBeTruthy();
    fireEvent.click(screen.getByText("Web"));
    await screen.findByRole("heading", { level: 2, name: "Effective Standard set for Web" });
    await within(section()).findAllByRole("rowheader");
    const table = within(section()).getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "Conflict slot",
      "Status",
      "Version",
      "Source Project",
    ]);
    expect(within(table).getAllByRole("rowheader").map((cell) => cell.textContent)).toEqual([
      '(code stack, library, "x")',
      '(design system, component, "Button")',
    ]);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell").map((cell) => cell.textContent))).toEqual([
      ["prohibited", "1", "Web (this Project)"],
      ["None", "3", "Platform"],
    ]);
    // The tree and the forms stay.
    expect(screen.getByRole("tree")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create Project" })).toBeTruthy();
  });

  it("selects by ?project and shows the empty state for a Project with no Standard", async () => {
    renderPage("Buyer", ok(fullTree), `/projects?project=${C}`, undefined, setsFor);
    expect(await screen.findByText("No Standard applies to Data yet.")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Effective Standard set for Data" })).toBeTruthy();
    expect(within(section()).queryByRole("table")).toBeNull();
  });

  it("shows the tree first while the set loads, with a busy section and loading row", async () => {
    renderPage("Buyer", ok(fullTree), "/projects", undefined, () => new Promise(() => undefined));
    await screen.findByRole("tree");
    expect(await screen.findByText("Loading the Effective Standard set…")).toBeTruthy();
    expect(section().getAttribute("aria-busy")).toBe("true");
    expect(within(section()).getAllByRole("columnheader")).toHaveLength(4);
    expect(screen.getByRole("button", { name: "Create Project" })).toBeTruthy();
  });

  it.each([
    ["an unavailable answer", () => Promise.resolve({ kind: "unavailable" })],
    ["a refusal", () => Promise.resolve({ kind: "refused", error: { code: "slot_conflict", message: "m", subject: A } })],
    [
      "a failed promise",
      () => {
        const failed = Promise.reject(new Error("down"));
        // Marked handled here; the page's Await still sees the rejection.
        failed.catch(() => undefined);
        return failed;
      },
    ],
  ])("says the set is unavailable on %s, keeping the tree and forms", async (_label, effectiveFor: EffectiveFor) => {
    renderPage("Buyer", ok(fullTree), `/projects?project=${B}`, undefined, effectiveFor);
    expect(
      await screen.findByText("The Effective Standard set is unavailable right now. Try again in a few minutes."),
    ).toBeTruthy();
    expect(section().getAttribute("aria-busy")).toBeNull();
    expect(screen.getByRole("tree")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create Project" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Change parent" })).toBeTruthy();
  });
});
