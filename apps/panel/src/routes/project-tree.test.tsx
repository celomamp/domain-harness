// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createRoutesStub, Outlet } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectInfo, ProjectTree, Role } from "@domain-harness/contract";
import { PanelChrome } from "../components/panel-chrome.tsx";
import { projectTreeHeader } from "../components/project-tree.tsx";
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
const fullTree = { rootId: ROOT, projects: [root, a, b, c], lockedRules: [] };
const onlyRoot = { rootId: ROOT, projects: [root], lockedRules: [] };

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

/** The child-Project permission grants the stub loader answers for the selected Project id (the root when none). */
type PermissionsFor = (projectId: string) => Promise<unknown>;

const BO = "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e610";
const AL = "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e611";
const SAM = "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e612";
const BEA = "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e613";
const eligible = [
  { accountId: AL, name: "Al Builder", role: "Builder" },
  { accountId: BO, name: "Bo Builder", role: "Builder" },
  { accountId: SAM, name: "Sam Owner", role: "Standard owner" },
];

const noGrantsFor: PermissionsFor = (projectId) => {
  const project = fullTree.projects.find((p) => p.id === projectId) ?? root;
  return Promise.resolve(ok({ project: { id: project.id, name: project.name }, grants: [], eligibleAccounts: eligible }));
};

function renderPage(
  role: Role,
  result: unknown,
  url = "/projects",
  pending?: Promise<unknown>,
  effectiveFor: EffectiveFor = emptySetFor,
  permissionsFor: PermissionsFor = noGrantsFor,
  buildsFor: PermissionsFor = noGrantsFor,
) {
  const Layout = () => (
    <PanelChrome role={role}>
      <Outlet />
    </PanelChrome>
  );
  const loader = ({ request }: LoaderFunctionArgs) => {
    const projectParam = new URL(request.url).searchParams.get("project");
    return {
      projectParam,
      tree: pending ?? Promise.resolve(result),
      effective: effectiveFor(projectParam ?? ROOT),
      permissions: permissionsFor(projectParam ?? ROOT),
      builds: buildsFor(projectParam ?? ROOT),
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

/** The page's top status region (the Status component), never an in-place plan-refusal region. */
const status = (): HTMLElement => {
  const region = document.querySelector<HTMLElement>(".page-status");
  if (region === null) expect.fail("the page's top status region (.page-status) is missing");
  expect(region.getAttribute("role")).toBe("status");
  return region;
};
const items = () => screen.getAllByRole("treeitem");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("projectTreeHeader", () => {
  it("derives the selected Project's parent, level and child count", () => {
    expect(projectTreeHeader(fullTree as unknown as ProjectTree, a as unknown as ProjectInfo)).toEqual({
      parent: "Acme",
      level: "Division",
      children: 1,
    });
    expect(projectTreeHeader(fullTree as unknown as ProjectTree, root as unknown as ProjectInfo)).toEqual({
      parent: "None",
      level: "None",
      children: 2,
    });
  });
});

describe("Project tree page", () => {
  it("shows an accessible tree: names with level names exactly as typed, levels, groups and the selected root", async () => {
    renderPage("Buyer", ok(fullTree));
    const tree = await screen.findByRole("tree", { name: "Project tree" });
    // The page title is the selected Project (the root by default).
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Acme");
    // The shell nav marks the current destination; the breadcrumb links back to the same page.
    expect(screen.getAllByRole("link", { name: "Project tree" }).some((link) => link.getAttribute("aria-current") === "page")).toBe(
      true,
    );

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
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Web");
    // The header offers to change the parent (a secondary action, hidden for the root).
    const change = screen.getByRole("button", { name: "Change parent" });
    expect(change.className).toBe("button-secondary");
    // The sheet opens with the current parent as the default and the inverse commit.
    fireEvent.click(change);
    const dialog = screen.getByRole("dialog", { name: "Change the parent of Web" });
    const parent = within(dialog).getByLabelText<HTMLSelectElement>("Parent");
    expect(parent.value).toBe(A);
    expect(within(dialog).getByRole("button", { name: "Save parent" }).className).toBe("button-inverse");
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
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Web");
    expect(screen.getByRole("button", { name: "Change parent" })).toBeTruthy();
    fireEvent.keyDown(tree, { key: "Home" });
    await waitFor(() => {
      expect(document.activeElement).toBe(items()[0]);
    });
    fireEvent.keyDown(tree, { key: " " });
    await waitFor(() => {
      expect(items()[0]?.getAttribute("aria-selected")).toBe("true");
    });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Acme");
    expect(screen.queryByRole("button", { name: "Change parent" })).toBeNull();
  });

  it("collapses and expands a branch with its chevron", async () => {
    renderPage("Buyer", ok(fullTree));
    await screen.findByRole("tree");
    expect(items()).toHaveLength(4);
    const platform = items()[1] as HTMLElement;
    fireEvent.click(within(platform).getByRole("button", { name: "Collapse Platform" }));
    // Web is hidden; the root, Platform and Data remain.
    expect(items().map((item) => item.getAttribute("aria-label"))).toEqual([
      "Acme, root Project, no level name",
      "Platform, level Division",
      "Data, level Division",
    ]);
    fireEvent.click(within(items()[1] as HTMLElement).getByRole("button", { name: "Expand Platform" }));
    expect(items()).toHaveLength(4);
  });

  it("keeps focus on a rendered node with a single tab stop after collapsing a branch", async () => {
    renderPage("Buyer", ok(fullTree));
    await screen.findByRole("tree");
    const tree = screen.getByRole("tree");
    // Collapse Platform so Web is no longer rendered; the chevron click moves
    // the roving focus onto Platform, so the next Arrow key continues from it.
    fireEvent.click(within(items()[1] as HTMLElement).getByRole("button", { name: "Collapse Platform" }));
    expect(items()).toHaveLength(3);
    // ArrowDown from Platform targets the next visible node (Data), not Acme.
    fireEvent.keyDown(tree, { key: "ArrowDown" });
    await waitFor(() => {
      expect(document.activeElement).toBe(items()[2]);
    });
    // ArrowDown at the last visible node stays on a rendered node, never a collapsed id.
    fireEvent.keyDown(tree, { key: "ArrowDown" });
    await waitFor(() => {
      expect(items()).toContain(document.activeElement as HTMLElement);
    });
    // Exactly one rendered node is in the tab order, and it is the focused one.
    const tabStops = items().filter((item) => item.tabIndex === 0);
    expect(tabStops).toHaveLength(1);
    expect(tabStops[0]).toBe(document.activeElement);
  });

  it("selects a nested Project on click, and only that Project", async () => {
    renderPage("Buyer", ok(fullTree));
    await screen.findByRole("tree");
    fireEvent.click(screen.getByText("Web"));
    await waitFor(() => {
      expect(items().map((item) => item.getAttribute("aria-selected"))).toEqual(["false", "false", "true", "false"]);
    });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Web");
    expect(screen.getByRole("button", { name: "Change parent" })).toBeTruthy();
  });

  it("announces a successful create and closes the sheet", async () => {
    const created = { id: "01928c7e-5b2a-7c3d-9e4f-a1b2c3d4e5fb", name: "Mobile", levelName: "Team", parentId: ROOT, createdAt: AT };
    registry([201, created], [200, { ...fullTree, projects: [...fullTree.projects, created] }]);
    renderPage("Buyer", ok(fullTree));
    fireEvent.click(await screen.findByRole("button", { name: "Create project" }));
    const dialog = screen.getByRole("dialog", { name: "Create project" });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Mobile" } });
    fireEvent.change(within(dialog).getByLabelText("Level name"), { target: { value: "Team" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create Project" }));
    await waitFor(() => {
      expect(status().textContent).toBe('Created Mobile, level "Team", under Acme.');
    });
    expect(status().querySelector(".denial")).toBeNull();
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("labels the root by having no parent, whatever its level name", async () => {
    const named = { ...root, levelName: "Company" };
    const noLevel = { ...c, levelName: null };
    renderPage("Buyer", ok({ rootId: ROOT, projects: [named, a, b, noLevel], lockedRules: [] }));
    await screen.findByRole("tree");
    expect(items().map((item) => item.getAttribute("aria-label"))).toEqual([
      "Acme, root Project, level Company",
      "Platform, level Division",
      "Web, level   Product line ",
      "Data, no level name",
    ]);
    // Only nodes with children expose an expanded state.
    expect(items().map((item) => item.getAttribute("aria-expanded"))).toEqual(["true", "true", null, null]);
    // The create form's Parent select (inside the sheet) offers every Project.
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));
    const dialog = screen.getByRole("dialog", { name: "Create project" });
    expect([...within(dialog).getByLabelText<HTMLSelectElement>("Parent").options].map((o) => o.textContent)).toEqual([
      "Acme (root Project)",
      "Platform (level Division)",
      "Web (level   Product line )",
      "Data (no level name)",
    ]);
  });

  it("shows the create form to a Builder too, with Name, Level name, Parent and the one gold action per surface", async () => {
    renderPage("Builder", ok(fullTree));
    fireEvent.click(await screen.findByRole("button", { name: "Create project" }));
    const dialog = screen.getByRole("dialog", { name: "Create project" });
    expect(within(dialog).getByRole("heading", { name: "Create a Project" })).toBeTruthy();
    const labels = [...dialog.querySelectorAll("form[aria-labelledby='project-create-heading'] label")].map(
      (l) => l.textContent,
    );
    expect(labels).toEqual(["Name", "Level name", "Parent"]);
    const parent = within(dialog).getByLabelText<HTMLSelectElement>("Parent");
    expect([...parent.options].map((o) => [o.value, o.textContent])).toEqual([
      [ROOT, "Acme (root Project)"],
      [A, "Platform (level Division)"],
      [B, "Web (level   Product line )"],
      [C, "Data (level Division)"],
    ]);
    expect(parent.value).toBe(ROOT);
    expect(within(dialog).getByRole("button", { name: "Create Project" }).className).toBe("button-primary");
    // One gold action in the header, one in the sheet's commit.
    expect(document.querySelectorAll(".button-primary")).toHaveLength(2);
    // The root's parent cannot change: no change-parent action while the root is selected.
    expect(screen.queryByRole("button", { name: "Change parent" })).toBeNull();
  });

  it("announces the registry's denial to a Builder as a status, and the tree is unchanged", async () => {
    const fetch = registry([403, { code: "role_denied", message: "m", subject: "role" }]);
    renderPage("Builder", ok(fullTree));
    fireEvent.click(await screen.findByRole("button", { name: "Create project" }));
    const dialog = screen.getByRole("dialog", { name: "Create project" });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Mobile" } });
    fireEvent.change(within(dialog).getByLabelText("Level name"), { target: { value: "Team" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create Project" }));
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
    fireEvent.click(await screen.findByRole("button", { name: "Create project" }));
    const dialog = screen.getByRole("dialog", { name: "Create project" });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: " Mobile " } });
    fireEvent.change(within(dialog).getByLabelText("Level name"), { target: { value: "   " } });
    fireEvent.change(within(dialog).getByLabelText("Parent"), { target: { value: A } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create Project" }));
    const error = await within(dialog).findByText("Enter a level name of 1 to 200 characters that is not only spaces.");
    expect(error.className).toBe("field-error");
    const level = within(dialog).getByLabelText<HTMLInputElement>("Level name");
    expect(level.value).toBe("   ");
    expect(level.getAttribute("aria-invalid")).toBe("true");
    expect(level.getAttribute("aria-describedby")).toBe(error.id);
    expect(within(dialog).getByLabelText<HTMLInputElement>("Name").value).toBe(" Mobile ");
    expect(within(dialog).getByLabelText<HTMLSelectElement>("Parent").value).toBe(A);
  });

  it("names the parent that closes a cycle in the status", async () => {
    registry([409, { code: "project_cycle", message: "m", subject: B }], [200, fullTree]);
    renderPage("Buyer", ok(fullTree), `/projects?project=${A}`);
    fireEvent.click(await screen.findByRole("button", { name: "Change parent" }));
    const dialog = screen.getByRole("dialog", { name: "Change the parent of Platform" });
    fireEvent.change(within(dialog).getByLabelText<HTMLSelectElement>("Parent"), { target: { value: B } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save parent" }));
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
    expect(screen.getByRole("button", { name: "Create project" })).toBeTruthy();
  });

  it("shows the structure while the tree loads: the heading, a busy tree region, no forms", async () => {
    renderPage("Buyer", null, "/projects", new Promise(() => undefined));
    expect(await screen.findByText("Loading the Project tree…")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Project tree");
    const region = screen.getByRole("region", { name: "Project tree" });
    expect(region.getAttribute("aria-busy")).toBe("true");
    expect(document.querySelectorAll("main form")).toHaveLength(0);
    expect(screen.queryByRole("tree")).toBeNull();
  });

  it("keeps the structure and says the tree is unavailable when the registry is down", async () => {
    renderPage("Buyer", { kind: "unavailable" });
    await waitFor(() => {
      expect(screen.getByText("The Project tree is unavailable right now. Try again in a few minutes.")).toBeTruthy();
    });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Project tree");
    expect(screen.queryByRole("tree")).toBeNull();
    // The loader error is a non-live banner; Status stays the single live region.
    expect(status().textContent).toBe("");
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("offers to sign in again when the session has ended", async () => {
    renderPage("Buyer", { kind: "refused", error: { code: "session_invalid", message: "m", subject: "session" } });
    expect(await screen.findByRole("link", { name: "Sign in again" })).toBeTruthy();
    expect(screen.getByText("Your session has ended, so the Project tree cannot be shown.")).toBeTruthy();
  });

  it("shows the selected Project in a two-pane layout with context tabs", async () => {
    renderPage("Buyer", ok(fullTree));
    expect(await screen.findByRole("heading", { name: "Acme" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Effective standards" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Access" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Build grants" })).toBeTruthy();
  });

  it("opens Create project in a side sheet", async () => {
    renderPage("Buyer", ok(fullTree));
    fireEvent.click(await screen.findByRole("button", { name: "Create project" }));
    expect(screen.getByRole("dialog", { name: /Create project/ })).toBeTruthy();
  });
});

describe("Effective Standard set", () => {
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
  const panel = () => screen.getByRole("tabpanel", { name: "Effective standards" });

  it("shows the selected Project's set in a table with header cells once the Buyer selects it", async () => {
    renderPage("Buyer", ok(fullTree), "/projects", undefined, setsFor);
    expect(await screen.findByText("No Standard applies to Acme yet.")).toBeTruthy();
    fireEvent.click(screen.getByText("Web"));
    await within(panel()).findAllByRole("rowheader");
    const table = within(panel()).getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "Conflict slot",
      "Status",
      "Version",
      "Source Project",
      "Locked rule",
    ]);
    expect(within(table).getAllByRole("rowheader").map((cell) => cell.textContent)).toEqual([
      '(code stack, library, "x")',
      '(design system, component, "Button")',
    ]);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell").slice(0, 3).map((cell) => cell.textContent))).toEqual([
      ["prohibited", "1", "Web (this Project)"],
      ["Governed by usage rule", "3", "Platform"],
    ]);
    // The status cell carries a word-and-icon badge; a component's is neutral.
    expect(within(rows[0] as HTMLElement).getAllByRole("cell")[0]?.querySelector(".badge")).not.toBeNull();
    expect(within(rows[1] as HTMLElement).getAllByRole("cell")[0]?.querySelector(".badge")?.getAttribute("data-tone")).toBe("neutral");
    // Only the row scoped to the selected Project holds the mark form.
    expect(within(rows[0] as HTMLElement).getByRole("button", { name: 'Mark as Locked rule (code stack, library, "x")' })).toBeTruthy();
    expect(within(rows[1] as HTMLElement).queryByRole("button")).toBeNull();
    expect(within(rows[1] as HTMLElement).getAllByRole("cell")[3]?.textContent).toBe("Not locked");
    // The tree and the create action stay.
    expect(screen.getByRole("tree")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create project" })).toBeTruthy();
  });

  it("marks Locked rules on the tree and shows an ancestor's Locked rule as coming from it", async () => {
    const STANDARD = "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e603";
    const lockedTree = {
      ...fullTree,
      lockedRules: [
        { standardId: STANDARD, projectId: A, markedAt: AT, markedBy: { accountId: OWNER, name: "Bea" } },
        { standardId: "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e604", projectId: C, markedAt: AT, markedBy: { accountId: OWNER, name: "Bea" } },
        { standardId: "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e605", projectId: C, markedAt: AT, markedBy: { accountId: OWNER, name: "Bea" } },
      ],
    };
    const xEntry = { category: "library", name: "X", versionConstraint: null, status: "prohibited", correctionInstruction: null };
    const yEntry = { category: "library", name: "y", versionConstraint: null, status: "approved", correctionInstruction: null };
    const lockedSet = {
      project: webRef,
      standards: [
        {
          slot: { moduleKind: "code-stack", slotKind: "library", name: "X" },
          status: "prohibited",
          standard: standard(STANDARD, platformRef, 1, xEntry),
          sourceProject: platformRef,
          locked: true,
        },
        {
          slot: { moduleKind: "code-stack", slotKind: "library", name: "y" },
          status: "approved",
          standard: standard("01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e606", webRef, 1, yEntry),
          sourceProject: webRef,
          locked: true,
        },
      ],
    };
    renderPage("Buyer", ok(lockedTree), `/projects?project=${B}`, undefined, () => Promise.resolve(ok(lockedSet)));
    await screen.findByRole("tree");
    expect(items().map((item) => item.getAttribute("aria-label"))).toEqual([
      "Acme, root Project, no level name",
      "Platform, level Division, 1 Locked rule",
      "Web, level   Product line ",
      "Data, level Division, 2 Locked rules",
    ]);
    await within(panel()).findAllByRole("rowheader");
    const rows = within(within(panel()).getByRole("table")).getAllByRole("row").slice(1);
    // The parent's Locked rule: prohibited, the parent as Source Project, "Locked rule", no button.
    expect(within(rows[0] as HTMLElement).getAllByRole("cell").map((cell) => cell.textContent)).toEqual([
      "prohibited",
      "1",
      "Platform",
      "Locked rule",
    ]);
    expect(within(rows[0] as HTMLElement).queryByRole("button")).toBeNull();
    // The visible node text matches its accessible name.
    expect((items()[1] as HTMLElement).querySelector(".project-node__level")?.textContent).toBe("level Division, 1 Locked rule");
    expect((items()[3] as HTMLElement).querySelector(".project-node__locked")?.textContent).toBe(", 2 Locked rules");
    // This Project's own Locked rule can be removed here.
    const remove = within(rows[1] as HTMLElement).getByRole("button", { name: 'Remove Locked rule (code stack, library, "y")' });
    const form = remove.closest("form") as HTMLFormElement;
    expect(Object.fromEntries(new FormData(form))).toEqual({
      intent: "lock",
      standardId: "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e606",
      locked: "false",
    });
  });

  it("announces the registry's denial when the Standard owner submits a mark, keeping the tree and the table", async () => {
    const fetch = registry([403, { code: "role_denied", message: "m", subject: "role" }]);
    renderPage("Standard owner", ok(fullTree), `/projects?project=${B}`, undefined, setsFor);
    const mark = await screen.findByRole("button", { name: 'Mark as Locked rule (code stack, library, "x")' });
    fireEvent.click(mark);
    await waitFor(() => {
      expect(status().textContent).toBe("Only the Buyer can mark or remove a Locked rule. Nothing was changed.");
    });
    expect(fetch).toHaveBeenCalled();
    expect(screen.getByRole("tree")).toBeTruthy();
    expect(within(panel()).getByRole("table")).toBeTruthy();
  });

  it("selects by ?project and shows the empty state for a Project with no Standard", async () => {
    renderPage("Buyer", ok(fullTree), `/projects?project=${C}`, undefined, setsFor);
    expect(await screen.findByText("No Standard applies to Data yet.")).toBeTruthy();
    expect(within(panel()).queryByRole("table")).toBeNull();
  });

  it("shows the tree first while the set loads, with the loading text in the tab", async () => {
    renderPage("Buyer", ok(fullTree), "/projects", undefined, () => new Promise(() => undefined));
    await screen.findByRole("tree");
    expect(await screen.findByText("Loading the Effective Standard set…")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create project" })).toBeTruthy();
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
  ])("says the set is unavailable on %s, keeping the tree and actions", async (_label, effectiveFor: EffectiveFor) => {
    renderPage("Buyer", ok(fullTree), `/projects?project=${B}`, undefined, effectiveFor);
    expect(
      await screen.findByText("The Effective Standard set is unavailable right now. Try again in a few minutes."),
    ).toBeTruthy();
    expect(screen.getByRole("tree")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create project" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Change parent" })).toBeTruthy();
  });
});

describe("child-Project permission", () => {
  const grantsFor =
    (grants: unknown[], accounts: unknown[] = eligible): PermissionsFor =>
    (projectId) => {
      const project = fullTree.projects.find((p) => p.id === projectId) ?? root;
      return Promise.resolve(ok({ project: { id: project.id, name: project.name }, grants, eligibleAccounts: accounts }));
    };
  const boGrant = {
    account: { accountId: BO, name: "Bo Builder", role: "Builder" },
    grantedAt: "2026-10-12T23:30:00.000Z",
    grantedBy: { accountId: BEA, name: "Bea Buyer" },
  };
  const openAccess = async () => {
    fireEvent.click(await screen.findByRole("tab", { name: "Access" }));
    return screen.getByRole("tabpanel", { name: "Access" });
  };

  it("lists each current grant with its account, a Granted badge and a Revoke commit", async () => {
    renderPage("Buyer", ok(fullTree), `/projects?project=${A}`, undefined, emptySetFor, grantsFor([boGrant]));
    const panel = await openAccess();
    expect(await within(panel).findByText("Bo Builder (Builder), granted by Bea Buyer on 2026-10-12")).toBeTruthy();
    expect(within(panel).getByText("Granted")).toBeTruthy();
    expect(within(panel).getAllByText("Not granted")).toHaveLength(2);
    const revoke = within(panel).getByRole("button", { name: "Revoke Bo Builder" });
    expect(revoke.className).toBe("button-inverse");
    expect(Object.fromEntries(new FormData(revoke.closest("form") as HTMLFormElement))).toEqual({
      intent: "permission",
      projectId: A,
      accountId: BO,
      granted: "false",
    });
    // Each not-yet-granted account holds its own compact grant commit.
    const alRow = within(panel).getByText("Al Builder (Builder)").closest("li") as HTMLElement;
    const grant = within(alRow).getByRole("button", { name: "Grant permission" });
    expect(Object.fromEntries(new FormData(grant.closest("form") as HTMLFormElement))).toEqual({
      intent: "permission",
      projectId: A,
      granted: "true",
      accountId: AL,
    });
  });

  it("shows every eligible account as Not granted with a Grant commit when there is no grant", async () => {
    renderPage("Builder", ok(fullTree));
    const panel = await openAccess();
    expect(await within(panel).findByText("Al Builder (Builder)")).toBeTruthy();
    expect(within(panel).getAllByText("Not granted")).toHaveLength(3);
    expect(within(panel).getAllByRole("button", { name: "Grant permission" })).toHaveLength(3);
  });

  it("says every account already has the permission when none is left", async () => {
    renderPage("Buyer", ok(fullTree), "/projects", undefined, emptySetFor, grantsFor([boGrant], [boGrant.account]));
    const panel = await openAccess();
    expect(await within(panel).findByText("Every account already has this permission.")).toBeTruthy();
    expect(within(panel).getByText("Granted")).toBeTruthy();
    expect(within(panel).queryByRole("button", { name: "Grant permission" })).toBeNull();
  });

  it("shows the empty state when there are no eligible accounts", async () => {
    renderPage("Buyer", ok(fullTree), "/projects", undefined, emptySetFor, grantsFor([], []));
    const panel = await openAccess();
    expect(await within(panel).findByText("No account has this permission yet. The Buyer can always create child Projects.")).toBeTruthy();
  });

  it("shows the loading text while the grants load", async () => {
    renderPage("Buyer", ok(fullTree), "/projects", undefined, emptySetFor, () => new Promise(() => undefined));
    await openAccess();
    expect(await screen.findByText("Loading the child-Project permission…")).toBeTruthy();
  });

  it.each([
    ["an unavailable answer", () => Promise.resolve({ kind: "unavailable" })],
    ["a refusal", () => Promise.resolve({ kind: "refused", error: { code: "project_not_found", message: "m", subject: "projectId" } })],
    [
      "a failed promise",
      () => {
        const failed = Promise.reject(new Error("down"));
        failed.catch(() => undefined);
        return failed;
      },
    ],
  ])("says the permission is unavailable on %s, keeping the tree", async (_label, permissionsFor: PermissionsFor) => {
    renderPage("Buyer", ok(fullTree), `/projects?project=${B}`, undefined, emptySetFor, permissionsFor);
    await openAccess();
    expect(
      await screen.findByText("The child-Project permission is unavailable right now. Try again in a few minutes."),
    ).toBeTruthy();
    expect(screen.getByRole("tree")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create project" })).toBeTruthy();
  });

  it("announces the grant when the Buyer grants from the section", async () => {
    const fetch = registry([
      200,
      {
        project: { id: ROOT, name: "Acme" },
        account: { accountId: AL, name: "Al Builder", role: "Builder" },
        granted: true,
        changedAt: AT,
        changedBy: { accountId: BEA, name: "Bea Buyer" },
      },
    ]);
    renderPage("Buyer", ok(fullTree));
    const panel = await openAccess();
    const alRow = (await within(panel).findByText("Al Builder (Builder)")).closest("li") as HTMLElement;
    fireEvent.click(within(alRow).getByRole("button", { name: "Grant permission" }));
    await waitFor(() => {
      expect(status().textContent).toBe("Al Builder can now create child Projects under Acme.");
    });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(new RegExp(`/v1/projects/${ROOT}/child-permissions$`));
    expect(init.body).toBe(JSON.stringify({ accountId: AL, granted: true }));
  });

  it("announces the registry's denial when a Builder grants the permission", async () => {
    registry([403, { code: "role_denied", message: "m", subject: "role" }]);
    renderPage("Builder", ok(fullTree));
    const panel = await openAccess();
    const alRow = (await within(panel).findByText("Al Builder (Builder)")).closest("li") as HTMLElement;
    fireEvent.click(within(alRow).getByRole("button", { name: "Grant permission" }));
    await waitFor(() => {
      expect(status().textContent).toBe(
        "Only the Buyer can grant or revoke the permission to create child Projects. Nothing was changed.",
      );
    });
    expect(status().querySelector(".denial")).not.toBeNull();
  });

  it("names the parent when a Builder without the permission submits a create", async () => {
    registry([403, { code: "child_permission_denied", message: "m", subject: "parentId" }], [200, fullTree]);
    renderPage("Builder", ok(fullTree), `/projects?project=${A}`);
    fireEvent.click(await screen.findByRole("button", { name: "Create project" }));
    const dialog = screen.getByRole("dialog", { name: "Create project" });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Mobile" } });
    fireEvent.change(within(dialog).getByLabelText("Level name"), { target: { value: "Team" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create Project" }));
    await waitFor(() => {
      expect(status().textContent).toBe(
        "You do not have permission to create a child Project under Platform. Ask the Buyer for it. Nothing was created.",
      );
    });
    expect(status().querySelector(".denial")).not.toBeNull();
    expect(items()).toHaveLength(4);
  });
});

describe("build grant", () => {
  const grantsFor =
    (grants: unknown[], accounts: unknown[] = eligible): PermissionsFor =>
    (projectId) => {
      const project = fullTree.projects.find((p) => p.id === projectId) ?? root;
      return Promise.resolve(ok({ project: { id: project.id, name: project.name }, grants, eligibleAccounts: accounts }));
    };
  const boGrant = {
    account: { accountId: BO, name: "Bo Builder", role: "Builder" },
    grantedAt: "2026-10-13T23:30:00.000Z",
    grantedBy: { accountId: BEA, name: "Bea Buyer" },
  };
  const renderBuilds = (role: Role, url: string, buildsFor: PermissionsFor) => {
    renderPage(role, ok(fullTree), url, undefined, emptySetFor, noGrantsFor, buildsFor);
  };
  const openBuilds = async () => {
    fireEvent.click(await screen.findByRole("tab", { name: "Build grants" }));
    return screen.getByRole("tabpanel", { name: "Build grants" });
  };

  it("sits behind the Build grants tab and lists each grant with a Granted badge and a Revoke commit", async () => {
    renderBuilds("Buyer", `/projects?project=${A}`, grantsFor([boGrant]));
    const panel = await openBuilds();
    expect(await within(panel).findByText("Bo Builder (Builder), granted by Bea Buyer on 2026-10-13")).toBeTruthy();
    expect(within(panel).getByText("Granted")).toBeTruthy();
    expect(within(panel).getAllByText("Not granted")).toHaveLength(2);
    const revoke = within(panel).getByRole("button", { name: "Revoke Bo Builder" });
    expect(Object.fromEntries(new FormData(revoke.closest("form") as HTMLFormElement))).toEqual({
      intent: "build",
      projectId: A,
      accountId: BO,
      granted: "false",
    });
  });

  it("shows every eligible account as Not granted with a Grant build commit", async () => {
    renderBuilds("Builder", "/projects", noGrantsFor);
    const panel = await openBuilds();
    expect(await within(panel).findByText("Al Builder (Builder)")).toBeTruthy();
    expect(within(panel).getAllByText("Not granted")).toHaveLength(3);
    expect(within(panel).getAllByRole("button", { name: "Grant build" })).toHaveLength(3);
  });

  it("says every account already has a build grant when none is left", async () => {
    renderBuilds("Buyer", "/projects", grantsFor([boGrant], [boGrant.account]));
    const panel = await openBuilds();
    expect(await within(panel).findByText("Every account already has a build grant here.")).toBeTruthy();
    expect(within(panel).queryByRole("button", { name: "Grant build" })).toBeNull();
  });

  it("shows the loading text while the grants load", async () => {
    renderBuilds("Buyer", "/projects", () => new Promise(() => undefined));
    await openBuilds();
    expect(await screen.findByText("Loading the build grant…")).toBeTruthy();
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
  ])("says the build grant is unavailable on %s, keeping the tree", async (_label, buildsFor: PermissionsFor) => {
    renderBuilds("Buyer", `/projects?project=${B}`, buildsFor);
    await openBuilds();
    expect(await screen.findByText("The build grant is unavailable right now. Try again in a few minutes.")).toBeTruthy();
    expect(screen.getByRole("tree")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create project" })).toBeTruthy();
  });

  it.each([
    [true, "Al Builder can now place Applications on Acme."],
    [false, "Al Builder can no longer place Applications on Acme."],
  ])("announces the change (granted %s) naming the account and the Project", async (granted, message) => {
    const fetch = registry([
      200,
      {
        project: { id: ROOT, name: "Acme" },
        account: { accountId: AL, name: "Al Builder", role: "Builder" },
        granted,
        changedAt: AT,
        changedBy: { accountId: BEA, name: "Bea Buyer" },
      },
    ]);
    renderBuilds("Buyer", "/projects", noGrantsFor);
    const panel = await openBuilds();
    const alRow = (await within(panel).findByText("Al Builder (Builder)")).closest("li") as HTMLElement;
    fireEvent.click(within(alRow).getByRole("button", { name: "Grant build" }));
    await waitFor(() => {
      expect(status().textContent).toBe(message);
    });
    const [url] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(new RegExp(`/v1/projects/${ROOT}/build-grants$`));
  });

  it("announces the registry's denial when a Builder grants a build", async () => {
    registry([403, { code: "role_denied", message: "m", subject: "role" }]);
    renderBuilds("Builder", "/projects", noGrantsFor);
    const panel = await openBuilds();
    const alRow = (await within(panel).findByText("Al Builder (Builder)")).closest("li") as HTMLElement;
    fireEvent.click(within(alRow).getByRole("button", { name: "Grant build" }));
    await waitFor(() => {
      expect(status().textContent).toBe("Only the Buyer can grant or revoke the build grant. Nothing was changed.");
    });
    expect(status().querySelector(".denial")).not.toBeNull();
  });
});

describe("plan refusal", () => {
  const planRefused = { code: "plan_refused", message: "m", subject: "plan" };
  const topStatus = status;
  /** The always-mounted plan-refusal live region inside `container`. */
  const regionIn = (container: HTMLElement): HTMLElement => {
    const region = container.querySelector<HTMLElement>(".plan-refusal-region");
    if (region === null) expect.fail("the plan-refusal region is missing");
    expect(region.getAttribute("role")).toBe("status");
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.getAttribute("aria-atomic")).toBe("true");
    return region;
  };
  /** Wait for the refusal text inside the region, and return its `<p class="plan-refusal">`. */
  const refusalIn = async (region: HTMLElement, text: string): Promise<HTMLElement> => {
    const shown = await within(region).findByText(text);
    expect(shown.tagName).toBe("P");
    expect(shown.className).toBe("plan-refusal");
    return shown;
  };
  const expectNoPrice = (text: string) => {
    expect(text).toContain("Team (first sale)");
    expect(text).not.toMatch(/\$|€|£|price|per month|\d+\s*\/\s*(mo|month|seat)/i);
    for (const other of ["Community", "Business", "Enterprise"]) expect(text).not.toContain(other);
  };

  it("shows a create refusal in place inside the Create a Project form, keeping the values and the top status empty", async () => {
    const fetch = registry([403, planRefused]);
    renderPage("Buyer", ok(onlyRoot));
    fireEvent.click(await screen.findByRole("button", { name: "Create project" }));
    const form = screen.getByRole("form", { name: "Create a Project" });
    fireEvent.change(within(form).getByLabelText("Name"), { target: { value: "Second" } });
    fireEvent.change(within(form).getByLabelText("Level name"), { target: { value: "Team" } });
    // The live region is mounted empty before the submit, so the refusal is announced when it appears.
    const region = regionIn(form);
    expect(region.textContent).toBe("");
    fireEvent.click(within(form).getByRole("button", { name: "Create Project" }));
    const refusal = await refusalIn(region, "Creating another Project is included in Team (first sale). Nothing was changed.");
    expect(regionIn(form)).toBe(region);
    expectNoPrice(region.textContent);
    // Under the button.
    const button = within(form).getByRole("button", { name: "Create Project" });
    expect(button.compareDocumentPosition(refusal) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(topStatus().textContent).toBe("");
    expect(within(form).getByLabelText<HTMLInputElement>("Name").value).toBe("Second");
    expect(within(form).getByLabelText<HTMLInputElement>("Level name").value).toBe("Team");
    expect(items()).toHaveLength(1);
    expect(screen.getByText("No Project yet beyond the root Project.")).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("shows a parent refusal in place inside the Change parent form, keeping the chosen parent", async () => {
    registry([403, planRefused]);
    renderPage("Buyer", ok(fullTree), `/projects?project=${B}`);
    fireEvent.click(await screen.findByRole("button", { name: "Change parent" }));
    const form = screen.getByRole("form", { name: "Change the parent of Web" });
    const parent = within(form).getByLabelText<HTMLSelectElement>("Parent");
    fireEvent.change(parent, { target: { value: C } });
    const region = regionIn(form);
    expect(region.textContent).toBe("");
    fireEvent.click(within(form).getByRole("button", { name: "Save parent" }));
    await refusalIn(region, "Setting a parent is included in Team (first sale). Nothing was changed.");
    expectNoPrice(region.textContent);
    expect(topStatus().textContent).toBe("");
    expect((within(form).getByLabelText<HTMLSelectElement>("Parent")).value).toBe(C);
    expect(items()).toHaveLength(4);
  });

  it("shows a lock refusal in place inside the Effective standards tab, above the table", async () => {
    const MODULE = "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e5fc";
    const webRef = { id: B, name: "Web" };
    const entry = { category: "library", name: "x", versionConstraint: null, status: "prohibited", correctionInstruction: null };
    const webSet = {
      project: webRef,
      standards: [
        {
          slot: { moduleKind: "code-stack", slotKind: "library", name: "x" },
          status: "prohibited",
          standard: {
            id: "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e601",
            version: 1,
            module: { id: MODULE, kind: "code-stack", name: "Stack" },
            project: webRef,
            entry,
            publishedAt: AT,
            publishedBy: { accountId: BEA, name: "Bea" },
          },
          sourceProject: webRef,
          locked: false,
        },
      ],
    };
    registry([403, planRefused]);
    renderPage("Buyer", ok(fullTree), `/projects?project=${B}`, undefined, () => Promise.resolve(ok(webSet)));
    const mark = await screen.findByRole("button", { name: 'Mark as Locked rule (code stack, library, "x")' });
    const panel = screen.getByRole("tabpanel", { name: "Effective standards" });
    expect(regionIn(panel).textContent).toBe("");
    fireEvent.click(mark);
    // The tab may re-render while the set revalidates; the region is re-read once the text shows.
    await waitFor(() => {
      expect(regionIn(screen.getByRole("tabpanel", { name: "Effective standards" })).textContent).toBe(
        "Marking a Locked rule is included in Team (first sale). Nothing was changed.",
      );
    });
    const current = screen.getByRole("tabpanel", { name: "Effective standards" });
    const region = regionIn(current);
    await refusalIn(region, "Marking a Locked rule is included in Team (first sale). Nothing was changed.");
    expectNoPrice(region.textContent);
    const table = await within(current).findByRole("table");
    expect(region.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(topStatus().textContent).toBe("");
    expect(screen.getByRole("tree")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create project" })).toBeTruthy();
  });
});
