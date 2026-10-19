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
    renderPage("Buyer", ok({ rootId: ROOT, projects: [named, a, b, noLevel], lockedRules: [] }));
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
    const labels = [...document.querySelectorAll("form[aria-labelledby='project-create-heading'] label")].map(
      (l) => l.textContent,
    );
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
    expect(document.querySelectorAll("main form")).toHaveLength(0);
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
      "Locked rule",
    ]);
    expect(within(table).getAllByRole("rowheader").map((cell) => cell.textContent)).toEqual([
      '(code stack, library, "x")',
      '(design system, component, "Button")',
    ]);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell").slice(0, 3).map((cell) => cell.textContent))).toEqual([
      ["prohibited", "1", "Web (this Project)"],
      ["None", "3", "Platform"],
    ]);
    // Only the row scoped to the selected Project holds the mark form.
    expect(within(rows[0] as HTMLElement).getByRole("button", { name: 'Mark as Locked rule (code stack, library, "x")' })).toBeTruthy();
    expect(within(rows[1] as HTMLElement).queryByRole("button")).toBeNull();
    expect(within(rows[1] as HTMLElement).getAllByRole("cell")[3]?.textContent).toBe("Not locked");
    // The tree and the forms stay.
    expect(screen.getByRole("tree")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create Project" })).toBeTruthy();
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
    await within(section()).findAllByRole("rowheader");
    const rows = within(within(section()).getByRole("table")).getAllByRole("row").slice(1);
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
    expect(within(section()).getByRole("table")).toBeTruthy();
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
    expect(within(section()).getAllByRole("columnheader")).toHaveLength(5);
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

describe("child-Project permission", () => {
  const section = () => screen.getByRole("region", { name: /^Child-Project permission for / });
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

  it("lists each current grant with its granter and UTC date, and a Revoke button per grant", async () => {
    renderPage("Buyer", ok(fullTree), `/projects?project=${A}`, undefined, emptySetFor, grantsFor([boGrant]));
    // Wait on the whole screen: the busy fallback section is replaced by a new one once the grants load.
    const item = await screen.findByText("Bo Builder (Builder), granted by Bea Buyer on 2026-10-12");
    expect(section().contains(item)).toBe(true);
    expect(screen.getByRole("heading", { level: 2, name: "Child-Project permission for Platform" })).toBeTruthy();
    const revoke = within(item.closest("li") as HTMLElement).getByRole("button", { name: "Revoke Bo Builder" });
    expect(revoke.className).toBe("button-inverse");
    expect(Object.fromEntries(new FormData(revoke.closest("form") as HTMLFormElement))).toEqual({
      intent: "permission",
      projectId: A,
      accountId: BO,
      granted: "false",
    });
    // The grant select offers the eligible accounts not yet granted.
    const select = within(section()).getByLabelText<HTMLSelectElement>("Account");
    expect([...select.options].map((o) => [o.value, o.textContent])).toEqual([
      ["", "Choose an account"],
      [AL, "Al Builder (Builder)"],
      [SAM, "Sam Owner (Standard owner)"],
    ]);
    const grant = within(section()).getByRole("button", { name: "Grant permission" });
    expect(Object.fromEntries(new FormData(grant.closest("form") as HTMLFormElement))).toEqual({
      intent: "permission",
      projectId: A,
      granted: "true",
      accountId: "",
    });
  });

  it("shows the empty state and every eligible account when there is no grant", async () => {
    renderPage("Builder", ok(fullTree));
    expect(
      await screen.findByText("No account has this permission yet. The Buyer can always create child Projects."),
    ).toBeTruthy();
    expect(section().getAttribute("aria-busy")).toBeNull();
    const select = within(section()).getByLabelText<HTMLSelectElement>("Account");
    expect([...select.options].map((o) => o.textContent)).toEqual([
      "Choose an account",
      "Al Builder (Builder)",
      "Bo Builder (Builder)",
      "Sam Owner (Standard owner)",
    ]);
    expect(within(section()).getByRole("button", { name: "Grant permission" })).toBeTruthy();
  });

  it("says every account already has the permission instead of the form when none is left", async () => {
    renderPage("Buyer", ok(fullTree), "/projects", undefined, emptySetFor, grantsFor([boGrant], [boGrant.account]));
    expect(await screen.findByText("Every account already has this permission.")).toBeTruthy();
    expect(within(section()).queryByLabelText("Account")).toBeNull();
    expect(within(section()).queryByRole("button", { name: "Grant permission" })).toBeNull();
  });

  it("shows a busy section while the grants load, with the tree and forms already there", async () => {
    renderPage("Buyer", ok(fullTree), "/projects", undefined, emptySetFor, () => new Promise(() => undefined));
    await screen.findByRole("tree");
    expect(await screen.findByText("Loading the child-Project permission…")).toBeTruthy();
    expect(section().getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("button", { name: "Create Project" })).toBeTruthy();
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
  ])("says the permission is unavailable on %s, keeping the tree, the table and the forms", async (_label, permissionsFor: PermissionsFor) => {
    renderPage("Buyer", ok(fullTree), `/projects?project=${B}`, undefined, emptySetFor, permissionsFor);
    expect(
      await screen.findByText("The child-Project permission is unavailable right now. Try again in a few minutes."),
    ).toBeTruthy();
    expect(section().getAttribute("aria-busy")).toBeNull();
    expect(screen.getByRole("tree")).toBeTruthy();
    expect(await screen.findByText("No Standard applies to Web yet.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create Project" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Change parent" })).toBeTruthy();
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
    const grant = await screen.findByRole("button", { name: "Grant permission" });
    fireEvent.change(within(section()).getByLabelText("Account"), { target: { value: AL } });
    fireEvent.click(grant);
    await waitFor(() => {
      expect(status().textContent).toBe("Al Builder can now create child Projects under Acme.");
    });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(new RegExp(`/v1/projects/${ROOT}/child-permissions$`));
    expect(init.body).toBe(JSON.stringify({ accountId: AL, granted: true }));
  });

  it("asks for an account when the placeholder is submitted", async () => {
    const fetch = registry([400, { code: "invalid_input", message: "m", subject: "accountId" }]);
    renderPage("Buyer", ok(fullTree));
    fireEvent.click(await screen.findByRole("button", { name: "Grant permission" }));
    await waitFor(() => {
      expect(status().textContent).toBe("Choose an account of this Company other than the Buyer. Nothing was changed.");
    });
    expect((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body).toBe(
      JSON.stringify({ accountId: "", granted: true }),
    );
  });

  it("names the parent when a Builder without the permission submits a create", async () => {
    registry([403, { code: "child_permission_denied", message: "m", subject: "parentId" }], [200, fullTree]);
    renderPage("Builder", ok(fullTree), `/projects?project=${A}`);
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Mobile" } });
    fireEvent.change(screen.getByLabelText("Level name"), { target: { value: "Team" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Project" }));
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
  const section = () => screen.getByRole("region", { name: /^Build grant for / });
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

  it("sits under the child-Project permission and lists each grant with its granter, UTC date and a Revoke button", async () => {
    renderBuilds("Buyer", `/projects?project=${A}`, grantsFor([boGrant]));
    const item = await screen.findByText("Bo Builder (Builder), granted by Bea Buyer on 2026-10-13");
    expect(section().contains(item)).toBe(true);
    expect(screen.getByRole("heading", { level: 2, name: "Build grant for Platform" })).toBeTruthy();
    const child = screen.getByRole("region", { name: "Child-Project permission for Platform" });
    expect(child.compareDocumentPosition(section()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const revoke = within(item.closest("li") as HTMLElement).getByRole("button", { name: "Revoke Bo Builder" });
    expect(Object.fromEntries(new FormData(revoke.closest("form") as HTMLFormElement))).toEqual({
      intent: "build",
      projectId: A,
      accountId: BO,
      granted: "false",
    });
    const select = within(section()).getByLabelText<HTMLSelectElement>("Account");
    expect([...select.options].map((o) => [o.value, o.textContent])).toEqual([
      ["", "Choose an account"],
      [AL, "Al Builder (Builder)"],
      [SAM, "Sam Owner (Standard owner)"],
    ]);
    const grant = within(section()).getByRole("button", { name: "Grant build" });
    expect(Object.fromEntries(new FormData(grant.closest("form") as HTMLFormElement))).toEqual({
      intent: "build",
      projectId: A,
      granted: "true",
      accountId: "",
    });
  });

  it("shows the empty state to every role, with the grant form", async () => {
    renderBuilds("Builder", "/projects", noGrantsFor);
    expect(
      await screen.findByText("No account has a build grant here yet. The Buyer can always place Applications."),
    ).toBeTruthy();
    expect(section().getAttribute("aria-busy")).toBeNull();
    expect(within(section()).getByRole("button", { name: "Grant build" })).toBeTruthy();
  });

  it("says every account already has a build grant instead of the form when none is left", async () => {
    renderBuilds("Buyer", "/projects", grantsFor([boGrant], [boGrant.account]));
    expect(await screen.findByText("Every account already has a build grant here.")).toBeTruthy();
    expect(within(section()).queryByLabelText("Account")).toBeNull();
  });

  it("shows a busy section while the grants load, with the tree and forms already there", async () => {
    renderBuilds("Buyer", "/projects", () => new Promise(() => undefined));
    await screen.findByRole("tree");
    expect(await screen.findByText("Loading the build grant…")).toBeTruthy();
    expect(section().getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("button", { name: "Create Project" })).toBeTruthy();
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
  ])("says the build grant is unavailable on %s, keeping the tree, the permission and the forms", async (_label, buildsFor: PermissionsFor) => {
    renderBuilds("Buyer", `/projects?project=${B}`, buildsFor);
    expect(await screen.findByText("The build grant is unavailable right now. Try again in a few minutes.")).toBeTruthy();
    expect(screen.getByRole("tree")).toBeTruthy();
    expect(await screen.findByText("No account has this permission yet. The Buyer can always create child Projects.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create Project" })).toBeTruthy();
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
    const grant = await screen.findByRole("button", { name: "Grant build" });
    fireEvent.change(within(section()).getByLabelText("Account"), { target: { value: AL } });
    fireEvent.click(grant);
    await waitFor(() => {
      expect(status().textContent).toBe(message);
    });
    const [url] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(new RegExp(`/v1/projects/${ROOT}/build-grants$`));
  });

  it.each([
    [403, { code: "role_denied", message: "m", subject: "role" }, "Only the Buyer can grant or revoke the build grant. Nothing was changed."],
    [400, { code: "invalid_input", message: "m", subject: "accountId" }, "Choose an account of this Company other than the Buyer. Nothing was changed."],
  ])("maps a %s refusal to its denial", async (code, envelope, message) => {
    registry([code, envelope]);
    renderBuilds("Builder", "/projects", noGrantsFor);
    fireEvent.click(await screen.findByRole("button", { name: "Grant build" }));
    await waitFor(() => {
      expect(status().textContent).toBe(message);
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
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Second" } });
    fireEvent.change(screen.getByLabelText("Level name"), { target: { value: "Team" } });
    const form = screen.getByRole("form", { name: "Create a Project" });
    // The live region is mounted empty before the submit, so the refusal is announced when it appears.
    const region = regionIn(form);
    expect(region.textContent).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Create Project" }));
    const refusal = await refusalIn(region, "Creating another Project is included in Team (first sale). Nothing was changed.");
    expect(regionIn(form)).toBe(region);
    expectNoPrice(region.textContent);
    // Under the button.
    const button = within(form).getByRole("button", { name: "Create Project" });
    expect(button.compareDocumentPosition(refusal) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(topStatus().textContent).toBe("");
    expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("Second");
    expect(screen.getByLabelText<HTMLInputElement>("Level name").value).toBe("Team");
    expect(items()).toHaveLength(1);
    expect(screen.getByText("No Project yet beyond the root Project.")).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("shows a parent refusal in place inside the Change parent form, keeping the chosen parent", async () => {
    registry([403, planRefused]);
    renderPage("Buyer", ok(fullTree), `/projects?project=${B}`);
    await screen.findByRole("heading", { name: "Change the parent of Web" });
    const parent = screen.getAllByLabelText<HTMLSelectElement>("Parent")[1] as HTMLSelectElement;
    fireEvent.change(parent, { target: { value: C } });
    const form = screen.getByRole("form", { name: "Change the parent of Web" });
    const region = regionIn(form);
    expect(region.textContent).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Change parent" }));
    await refusalIn(region, "Setting a parent is included in Team (first sale). Nothing was changed.");
    expectNoPrice(region.textContent);
    expect(regionIn(screen.getByRole("form", { name: "Create a Project" })).textContent).toBe("");
    expect(topStatus().textContent).toBe("");
    expect((screen.getAllByLabelText<HTMLSelectElement>("Parent")[1] as HTMLSelectElement).value).toBe(C);
    expect(items()).toHaveLength(4);
  });

  it("shows a lock refusal in place inside the Effective Standard set section, above the table", async () => {
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
    const section = screen.getByRole("region", { name: "Effective Standard set for Web" });
    expect(regionIn(section).textContent).toBe("");
    fireEvent.click(mark);
    // The section may re-render while the set revalidates; the region is re-read once the text shows.
    await waitFor(() => {
      expect(regionIn(screen.getByRole("region", { name: "Effective Standard set for Web" })).textContent).toBe(
        "Marking a Locked rule is included in Team (first sale). Nothing was changed.",
      );
    });
    const current = screen.getByRole("region", { name: "Effective Standard set for Web" });
    const region = regionIn(current);
    await refusalIn(region, "Marking a Locked rule is included in Team (first sale). Nothing was changed.");
    expectNoPrice(region.textContent);
    const table = await within(current).findByRole("table");
    expect(region.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(topStatus().textContent).toBe("");
    expect(screen.getByRole("tree")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create Project" })).toBeTruthy();
  });
});
