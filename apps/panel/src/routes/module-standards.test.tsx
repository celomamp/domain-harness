// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createRoutesStub, Outlet } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@domain-harness/contract";
import { PanelChrome } from "../components/panel-chrome.tsx";
import ModuleStandards, { action } from "./module-standards.tsx";

const TENANT = "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e5f6";
const MODULE = "01928c7e-5b2a-7c3d-9e4f-a1b2c3d4e5f7";
const SAM = "01928c7e-5b2a-7c3d-ae4f-a1b2c3d4e5f8";
const BEA = "01928c7e-5b2a-7c3d-be4f-a1b2c3d4e5f9";
const STANDARD = "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e5fa";
const HOLDER = "01928c7e-5b2a-7c3d-9e4f-a1b2c3d4e5fb";
const AT = "2026-10-11T09:00:00.000Z";
const LATER = "2026-10-11T10:30:00.000Z";
const WEB = "01928c7e-5b2a-7c3d-ae4f-a1b2c3d4e5fc";
const CHECKOUT = "01928c7e-5b2a-7c3d-be4f-a1b2c3d4e5fd";
const TREE = {
  rootId: TENANT,
  projects: [
    { id: TENANT, name: "Acme", levelName: null, parentId: null, createdAt: AT },
    { id: WEB, name: "Web", levelName: "Product line", parentId: TENANT, createdAt: AT },
    { id: CHECKOUT, name: "Checkout", levelName: "Team", parentId: WEB, createdAt: AT },
  ],
  lockedRules: [],
};
const COOKIE = `dh_session=${TENANT}.${"S".repeat(43)}`;

const module = {
  id: MODULE,
  kind: "code-stack",
  name: "Frontend stack",
  owner: { accountId: SAM, name: "Sam Owner", assignedAt: AT, assignedBy: { accountId: BEA, name: "Bea Buyer" } },
  createdAt: AT,
};
const react = {
  id: STANDARD,
  version: 1,
  module: { id: MODULE, kind: "code-stack", name: "Frontend stack" },
  project: { id: TENANT, name: "Acme" },
  entry: { category: "library", name: "React", versionConstraint: "^18", status: "approved", correctionInstruction: "Use React 18." },
  publishedAt: AT,
  publishedBy: { accountId: SAM, name: "Sam Owner" },
};
const vue = {
  ...react,
  id: HOLDER,
  module: { id: BEA, kind: "code-stack", name: "Backend stack" },
  entry: { ...react.entry, name: "Vue", versionConstraint: null, correctionInstruction: null },
};

/** The real action, with the session cookie a browser would send. */
async function actionWithCookie(args: ActionFunctionArgs) {
  const body = await args.request.formData();
  const request = new Request(args.request.url, { method: "POST", body, headers: { cookie: COOKIE } });
  return action({ ...args, request });
}

type LoadState = "ok" | "unavailable" | "not-found" | "session-ended";

function resultOf(list: unknown, state: LoadState): unknown {
  switch (state) {
    case "ok":
      return { kind: "ok", value: list };
    case "not-found":
      return { kind: "refused", error: { code: "module_not_found", message: "m", subject: "moduleId" } };
    case "session-ended":
      return { kind: "refused", error: { code: "session_invalid", message: "m", subject: "session" } };
    case "unavailable":
      return { kind: "unavailable" };
  }
}

function renderPage(
  role: Role,
  list: unknown,
  url = `/standards/${MODULE}`,
  state: LoadState = list === null ? "unavailable" : "ok",
  standards?: Promise<unknown>,
  tree: Promise<unknown> = Promise.resolve({ kind: "ok", value: TREE }),
) {
  const Layout = () => (
    <PanelChrome role={role}>
      <Outlet />
    </PanelChrome>
  );
  const loader = ({ request, params }: LoaderFunctionArgs) => ({
    moduleId: params["moduleId"] ?? "",
    editParam: new URL(request.url).searchParams.get("edit"),
    standards: standards ?? Promise.resolve(resultOf(list, state)),
    tree,
  });
  const Stub = createRoutesStub([
    {
      Component: Layout,
      children: [
        { path: "/standards", Component: () => <h1>All Modules page</h1> },
        { path: "/standards/:moduleId", Component: ModuleStandards, loader, action: actionWithCookie },
      ],
    },
  ]);
  render(<Stub initialEntries={[url]} />);
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Module Standards page", () => {
  it("shows the Module, its kind and owner, a table with header cells and the code-stack form, even to a Builder", async () => {
    renderPage("Builder", { module, standards: [react, { ...vue, module: react.module }] });
    expect(await screen.findByRole("heading", { level: 1, name: "Frontend stack" })).toBeTruthy();
    expect(screen.getByText("Kind: code stack")).toBeTruthy();
    expect(screen.getByText("Standard owner: Sam Owner")).toBeTruthy();
    expect(screen.getByRole("link", { name: "All Modules" }).getAttribute("href")).toBe("/standards");
    expect(screen.getByRole("link", { name: "Standards" }).getAttribute("aria-current")).toBe("page");

    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Standard",
      "Project scope",
      "Category",
      "Status",
      "Version constraint",
      "Version",
      "Published (UTC)",
      "Standard id",
    ]);
    const rows = within(table).getAllByRole("row").slice(1);
    expect([...(rows[0]?.querySelectorAll("td") ?? [])].map((td) => td.textContent)).toEqual([
      "Acme",
      "library",
      "approved",
      "^18",
      "1",
      AT,
      STANDARD,
    ]);
    expect(rows[1]?.querySelectorAll("td")[3]?.textContent).toBe("None");
    expect(within(rows[0] as HTMLElement).getByRole("link", { name: "Edit React" }).getAttribute("href")).toBe(
      `/standards/${MODULE}?edit=${STANDARD}`,
    );

    const labels = [...document.querySelectorAll("form.standard-form label")].map((l) => l.textContent);
    expect(labels).toEqual([
      "Project scope",
      "Category",
      "Name",
      "Version constraint (optional)",
      "Status",
      "Correction instruction (optional)",
    ]);
    expect([...screen.getByLabelText<HTMLSelectElement>("Category").options].map((o) => o.value)).toEqual([
      "",
      "language",
      "framework",
      "library",
    ]);
    expect([...screen.getByLabelText<HTMLSelectElement>("Status").options].map((o) => o.value)).toEqual([
      "",
      "approved",
      "prohibited",
      "required",
    ]);
    expect(screen.getByLabelText("Correction instruction (optional)").tagName).toBe("TEXTAREA");
    const publish = screen.getByRole("button", { name: "Publish" });
    expect(publish.className).toBe("button-primary");
    expect(document.querySelectorAll(".button-primary")).toHaveLength(1);
    expect(screen.queryByRole("link", { name: "Cancel edit" })).toBeNull();
  });

  it("shows the empty state", async () => {
    renderPage("Standard owner", { module, standards: [] });
    expect(await screen.findByText("No Standard is published in this Module yet.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("announces the registry's denial to a Builder as a status, and nothing changes", async () => {
    const fetch = registry([403, { code: "not_module_owner", message: "m", subject: "role" }]);
    renderPage("Builder", { module, standards: [react] });
    fireEvent.change(await screen.findByLabelText("Category"), { target: { value: "library" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Vue" } });
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "approved" } });
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() => {
      expect(status().textContent).toBe("Only the Standard owner of this Module can publish into it. Nothing was published.");
    });
    expect(status().querySelector(".denial")).not.toBeNull();
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("announces that an ownerless Module cannot be published into", async () => {
    registry([409, { code: "module_has_no_owner", message: "m", subject: "moduleId" }]);
    renderPage("Buyer", { module: { ...module, owner: null }, standards: [] });
    expect(await screen.findByText("Standard owner: No owner")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() => {
      expect(status().textContent).toMatch(/^This Module has no owner, so nothing can be published into it/);
    });
  });

  it("keeps every value and puts ink text under the field on an invalid submit", async () => {
    registry([400, { code: "invalid_input", message: "m", subject: "name" }]);
    renderPage("Standard owner", { module, standards: [] });
    const long = "x".repeat(201);
    fireEvent.change(await screen.findByLabelText("Category"), { target: { value: "framework" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: long } });
    fireEvent.change(screen.getByLabelText("Version constraint (optional)"), { target: { value: ">=1" } });
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "required" } });
    fireEvent.change(screen.getByLabelText("Correction instruction (optional)"), { target: { value: "Use it." } });
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));

    const error = await screen.findByText("Enter a name of 1 to 200 characters.");
    const name = screen.getByLabelText<HTMLInputElement>("Name");
    expect(name.value).toBe(long);
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(name.getAttribute("aria-describedby")).toBe(error.id);
    expect(error.className).toBe("field-error");
    expect(error.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(screen.getByLabelText<HTMLSelectElement>("Category").value).toBe("framework");
    expect(screen.getByLabelText<HTMLInputElement>("Version constraint (optional)").value).toBe(">=1");
    expect(screen.getByLabelText<HTMLSelectElement>("Status").value).toBe("required");
    expect(screen.getByLabelText<HTMLTextAreaElement>("Correction instruction (optional)").value).toBe("Use it.");
    expect(status().textContent).toBe("");
  });

  it("shows the Standard id, Module, Project scope, version and UTC time after a publish", async () => {
    const fetch = registry([201, { ...react, publishedAt: LATER }]);
    renderPage("Standard owner", { module, standards: [] });
    fireEvent.change(await screen.findByLabelText("Category"), { target: { value: "library" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: " React " } });
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "approved" } });
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));

    const heading = await screen.findByRole("heading", { level: 2, name: "Published" });
    const facts = heading.parentElement?.querySelector("dl");
    const pairs = [...(facts?.querySelectorAll("dt") ?? [])].map((dt) => [dt.textContent, dt.nextElementSibling?.textContent]);
    expect(pairs).toEqual([
      ["Standard id", STANDARD],
      ["Module", "Frontend stack"],
      ["Project scope", "Acme"],
      ["Version", "1"],
      ["Published (UTC)", LATER],
    ]);
    expect(status().textContent).toBe(
      `Published React: Standard ${STANDARD}, version 1, in Module Frontend stack, Project scope Acme, at ${LATER}.`,
    );
    expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("");
    const [url] = fetch.mock.calls[0] as unknown as [string];
    expect(url).toMatch(new RegExp(`/v1/modules/${MODULE}/standards$`));
  });

  it("names both Standards and the slot on a slot conflict", async () => {
    registry([409, { code: "slot_conflict", message: "m", subject: HOLDER }], [200, { standardId: HOLDER, versions: [vue] }]);
    renderPage("Standard owner", { module, standards: [] });
    fireEvent.change(await screen.findByLabelText("Category"), { target: { value: "library" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "VUE" } });
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "approved" } });
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() => {
      expect(status().textContent).toBe(
        `Nothing was published. The library "VUE" is in the same Conflict slot (code stack, library, "Vue") as Standard ${HOLDER}, ` +
          'library "Vue" in Module Backend stack, at Project Acme.',
      );
    });
    expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("VUE");
  });

  it("edits a Standard: focuses the first field, prefills the live entry and publishes a new version", async () => {
    const fetch = registry([201, { ...react, version: 2, entry: { ...react.entry, status: "required" } }]);
    renderPage("Standard owner", { module, standards: [react] }, `/standards/${MODULE}?edit=${STANDARD}`);
    expect(await screen.findByRole("heading", { level: 2, name: "Edit React" })).toBeTruthy();
    const category = screen.getByLabelText<HTMLSelectElement>("Category");
    expect(document.activeElement).toBe(category);
    expect(category.value).toBe("library");
    expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("React");
    expect(screen.getByLabelText<HTMLTextAreaElement>("Correction instruction (optional)").value).toBe("Use React 18.");
    expect(screen.getByRole("link", { name: "Cancel edit" })).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "required" } });
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() => {
      expect(status().textContent).toMatch(/^Published React: Standard .+, version 2,/);
    });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(new RegExp(`/v1/standards/${STANDARD}/versions$`));
    expect(JSON.parse(init.body as string)).toMatchObject({ entry: { status: "required", name: "React" } });
  });

  it("stays in edit mode after a refused edit", async () => {
    registry([400, { code: "invalid_input", message: "m", subject: "status" }]);
    renderPage("Standard owner", { module, standards: [react] }, `/standards/${MODULE}?edit=${STANDARD}`);
    fireEvent.change(await screen.findByLabelText("Status"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    expect(await screen.findByText("Choose a status: approved, prohibited or required.")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Edit React" })).toBeTruthy();
  });

  it("leaves edit mode on Esc without committing and returns focus to the row's Edit link", async () => {
    const fetch = registry();
    renderPage("Standard owner", { module, standards: [react] }, `/standards/${MODULE}?edit=${STANDARD}`);
    const name = await screen.findByLabelText("Name");
    fireEvent.change(name, { target: { value: "Changed" } });
    fireEvent.keyDown(name, { key: "Escape" });
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "Publish a code-stack Standard" })).toBeTruthy();
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole("link", { name: "Edit React" }));
    });
    expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps the structure and says Standards are unavailable when the registry is down", async () => {
    renderPage("Buyer", null);
    await waitFor(() => {
      expect(status().textContent).toBe("Standards are unavailable right now. Try again in a few minutes.");
    });
    expect(screen.getByRole("heading", { level: 1, name: "Standards" })).toBeTruthy();
    expect(status().querySelector(".denial")).not.toBeNull();
    expect(screen.getByRole("link", { name: "All Modules" })).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("says when the Module was not found", async () => {
    renderPage("Buyer", null, `/standards/${MODULE}`, "not-found");
    await waitFor(() => {
      expect(status().textContent).toBe("That Module was not found.");
    });
  });

  it("keeps tab order equal to reading order with no positive tabindex", async () => {
    renderPage("Standard owner", { module, standards: [react] });
    await screen.findByRole("button", { name: "Publish" });
    expect(document.querySelectorAll("[tabindex]").length).toBe(0);
    const focusables = [
      ...document.querySelectorAll<HTMLElement>("main a[href], main button, main input:not([type=hidden]), main select, main textarea"),
    ];
    expect(focusables.map((el) => el.getAttribute("name") ?? el.textContent)).toEqual([
      "All Modules",
      "Edit React",
      "projectId",
      "category",
      "name",
      "versionConstraint",
      "status",
      "correctionInstruction",
      "Publish",
    ]);
  });
});

const designModule = { ...module, kind: "design-system", name: "Design system" };
const button = {
  ...react,
  module: { id: MODULE, kind: "design-system", name: "Design system" },
  entry: {
    kind: "component",
    name: "Button",
    usageRule: "Use for primary actions",
    tokens: ["primary", "spacing-4"],
    correctionInstruction: null,
  },
};
const primary = { ...button, id: HOLDER, entry: { kind: "token", name: "primary", status: "prohibited" } };
const mui = {
  ...button,
  id: BEA,
  entry: { kind: "import", specifier: "@mui/material", status: "required" },
};

const labels = () => [...document.querySelectorAll("form.standard-form label")].map((l) => l.textContent);

describe("Module Standards page: cold-load and session", () => {
  it("shows the structure, the table header cells and a busy row, and no form, while the list loads", async () => {
    let resolve: (value: unknown) => void = () => undefined;
    const pending = new Promise((done) => {
      resolve = done;
    });
    renderPage("Standard owner", null, `/standards/${MODULE}`, "ok", pending);
    expect(await screen.findByRole("heading", { level: 1, name: "Standards" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Standards" })).toBeTruthy();
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Standard",
      "Project scope",
      "Status",
      "Version",
      "Published (UTC)",
      "Standard id",
    ]);
    const busy = within(table).getByText("Loading Standards…");
    expect(busy.closest("[aria-busy='true']")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
    expect(document.querySelector("form.standard-form")).toBeNull();
    expect(screen.getByRole("status")).toBeTruthy();

    resolve({ kind: "ok", value: { module, standards: [react] } });
    expect(await screen.findByRole("heading", { level: 1, name: "Frontend stack" })).toBeTruthy();
    expect(screen.queryByText("Loading Standards…")).toBeNull();
    expect(document.querySelector("[aria-busy='true']")).toBeNull();
    expect(screen.getByRole("button", { name: "Publish" })).toBeTruthy();
  });

  it("shows a denial with a Sign in again link when the session has ended", async () => {
    renderPage("Buyer", null, `/standards/${MODULE}`, "session-ended");
    await waitFor(() => {
      expect(status().textContent).toBe("Your session has ended, so the Standards cannot be shown.");
    });
    expect(status().querySelector(".denial")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Sign in again" }).getAttribute("href")).toBe("/sign-in");
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("Module Standards page: design system", () => {
  it("shows the design-system table with header cells, one row per entry kind, and its Edit links", async () => {
    renderPage("Builder", { module: designModule, standards: [button, primary, mui] });
    expect(await screen.findByText("Kind: design system")).toBeTruthy();
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Standard",
      "Project scope",
      "Entry kind",
      "Status",
      "Usage rule",
      "Tokens",
      "Version",
      "Published (UTC)",
      "Standard id",
    ]);
    const cells = within(table)
      .getAllByRole("row")
      .slice(1)
      .map((row) => [...row.querySelectorAll("td")].slice(1, 5).map((td) => td.textContent));
    expect(cells).toEqual([
      ["component", "None", "Use for primary actions", "primary, spacing-4"],
      ["token", "prohibited", "None", "None"],
      ["import", "required", "None", "None"],
    ]);
    expect(within(table).getAllByRole("rowheader").map((th) => th.querySelector("p")?.textContent)).toEqual([
      "Button",
      "primary",
      "@mui/material",
    ]);
    expect(screen.getByRole("link", { name: "Edit @mui/material" }).getAttribute("href")).toBe(
      `/standards/${MODULE}?edit=${BEA}`,
    );
  });

  it("shows the empty state and the design-system form with the component field set first", async () => {
    renderPage("Standard owner", { module: designModule, standards: [] });
    expect(await screen.findByText("No Standard is published in this Module yet.")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Publish a design-system Standard" })).toBeTruthy();
    expect(document.querySelectorAll("form.standard-form")).toHaveLength(1);
    expect(labels()).toEqual([
      "Project scope",
      "Entry kind",
      "Name",
      "Usage rule",
      "Tokens it depends on (optional, separated by commas)",
      "Correction instruction (optional)",
    ]);
    expect([...screen.getByLabelText<HTMLSelectElement>("Entry kind").options].map((o) => o.value)).toEqual([
      "component",
      "token",
      "import",
    ]);
    expect(screen.getByLabelText("Usage rule").tagName).toBe("TEXTAREA");
    expect(document.querySelectorAll(".button-primary")).toHaveLength(1);
  });

  it("switches the field set with the entry kind", async () => {
    renderPage("Standard owner", { module: designModule, standards: [] });
    const kind = await screen.findByLabelText("Entry kind");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "primary" } });
    fireEvent.change(kind, { target: { value: "token" } });
    expect(labels()).toEqual(["Project scope", "Entry kind", "Name", "Status"]);
    expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("primary");
    expect([...screen.getByLabelText<HTMLSelectElement>("Status").options].map((o) => o.value)).toEqual([
      "",
      "required",
      "prohibited",
    ]);
    fireEvent.change(kind, { target: { value: "import" } });
    expect(labels()).toEqual(["Project scope", "Entry kind", "Module specifier", "Status"]);
    fireEvent.change(kind, { target: { value: "component" } });
    expect(labels()).toHaveLength(6);
  });

  it("publishes a component and shows the five published facts", async () => {
    const fetch = registry([201, { ...button, publishedAt: LATER }]);
    renderPage("Standard owner", { module: designModule, standards: [] });
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: " Button " } });
    fireEvent.change(screen.getByLabelText("Usage rule"), { target: { value: "Use for primary actions" } });
    fireEvent.change(screen.getByLabelText("Tokens it depends on (optional, separated by commas)"), {
      target: { value: "primary, spacing-4" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    const heading = await screen.findByRole("heading", { level: 2, name: "Published" });
    const facts = [...(heading.parentElement?.querySelectorAll("dt") ?? [])].map((dt) => dt.textContent);
    expect(facts).toEqual(["Standard id", "Module", "Project scope", "Version", "Published (UTC)"]);
    expect(status().textContent).toMatch(/^Published Button: Standard /);
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({ entry: { kind: "component", tokens: ["primary", "spacing-4"] } });
  });

  it("keeps every value and puts ink text under the field on an invalid submit", async () => {
    registry([400, { code: "invalid_input", message: "m", subject: "tokens" }]);
    renderPage("Standard owner", { module: designModule, standards: [] });
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Button" } });
    fireEvent.change(screen.getByLabelText("Usage rule"), { target: { value: "Use it" } });
    fireEvent.change(screen.getByLabelText("Tokens it depends on (optional, separated by commas)"), {
      target: { value: "a, A" },
    });
    fireEvent.change(screen.getByLabelText("Correction instruction (optional)"), { target: { value: "Fix it." } });
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));

    const error = await screen.findByText(
      "List at most 50 different token names of 1 to 200 characters each, separated by commas, or leave it empty.",
    );
    const tokens = screen.getByLabelText<HTMLInputElement>("Tokens it depends on (optional, separated by commas)");
    expect(tokens.value).toBe("a, A");
    expect(tokens.getAttribute("aria-describedby")).toBe(error.id);
    expect(error.className).toBe("field-error");
    expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("Button");
    expect(screen.getByLabelText<HTMLTextAreaElement>("Usage rule").value).toBe("Use it");
    expect(screen.getByLabelText<HTMLTextAreaElement>("Correction instruction (optional)").value).toBe("Fix it.");
    expect(screen.getByLabelText<HTMLSelectElement>("Entry kind").value).toBe("component");
  });

  it("keeps a refused token's kind and values", async () => {
    registry([400, { code: "invalid_input", message: "m", subject: "status" }]);
    renderPage("Standard owner", { module: designModule, standards: [] });
    fireEvent.change(await screen.findByLabelText("Entry kind"), { target: { value: "token" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "primary" } });
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    expect(await screen.findByText("Choose a status: required or prohibited.")).toBeTruthy();
    expect(screen.getByLabelText<HTMLSelectElement>("Entry kind").value).toBe("token");
    expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("primary");
  });

  it("names both Standards and the component slot on a slot conflict", async () => {
    const holder = { ...button, id: HOLDER, module: { id: BEA, kind: "design-system", name: "Brand design system" } };
    registry([409, { code: "slot_conflict", message: "m", subject: HOLDER }], [200, { standardId: HOLDER, versions: [holder] }]);
    renderPage("Standard owner", { module: designModule, standards: [] });
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "button" } });
    fireEvent.change(screen.getByLabelText("Usage rule"), { target: { value: "Use it" } });
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() => {
      expect(status().textContent).toBe(
        `Nothing was published. The component "button" is in the same Conflict slot (design system, component, "Button") ` +
          `as Standard ${HOLDER}, component "Button" in Module Brand design system, at Project Acme.`,
      );
    });
    expect(status().querySelector(".denial")).not.toBeNull();
    expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("button");
  });

  it("edits a component: its kind and values are prefilled and the first field is focused; Esc leaves", async () => {
    const fetch = registry();
    renderPage("Standard owner", { module: designModule, standards: [button, primary] }, `/standards/${MODULE}?edit=${STANDARD}`);
    expect(await screen.findByRole("heading", { level: 2, name: "Edit Button" })).toBeTruthy();
    const kind = screen.getByLabelText<HTMLSelectElement>("Entry kind");
    expect(document.activeElement).toBe(kind);
    expect(kind.value).toBe("component");
    expect(screen.getByLabelText<HTMLInputElement>("Tokens it depends on (optional, separated by commas)").value).toBe(
      "primary, spacing-4",
    );
    fireEvent.keyDown(screen.getByLabelText("Usage rule"), { key: "Escape" });
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "Publish a design-system Standard" })).toBeTruthy();
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole("link", { name: "Edit Button" }));
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("edits a token with its own field set", async () => {
    renderPage("Standard owner", { module: designModule, standards: [button, primary] }, `/standards/${MODULE}?edit=${HOLDER}`);
    expect(await screen.findByRole("heading", { level: 2, name: "Edit primary" })).toBeTruthy();
    expect(labels()).toEqual(["Entry kind", "Name", "Status"]);
    expect(screen.getByLabelText<HTMLSelectElement>("Status").value).toBe("prohibited");
    expect(screen.getByRole("link", { name: "Cancel edit" })).toBeTruthy();
  });
});

describe("Module Standards page: Project scope", () => {
  const scope = () => screen.getByLabelText<HTMLSelectElement>("Project scope");
  const fill = async () => {
    fireEvent.change(await screen.findByLabelText("Category"), { target: { value: "library" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Vue" } });
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "approved" } });
  };

  it("lists every Project in tree order with level names, the root selected, before the entry fields", async () => {
    renderPage("Standard owner", { module, standards: [] });
    await screen.findByLabelText("Category");
    expect(scope().id).toBe("standard-project");
    expect(scope().name).toBe("projectId");
    expect([...scope().options].map((o) => [o.value, o.textContent])).toEqual([
      [TENANT, "Acme"],
      [WEB, "Web (level Product line)"],
      [CHECKOUT, "Checkout (level Team)"],
    ]);
    expect(scope().value).toBe(TENANT);
    expect(scope().compareDocumentPosition(screen.getByLabelText("Category")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows the picker on the design-system form too, before the entry kind", async () => {
    renderPage("Standard owner", { module: designModule, standards: [] });
    await screen.findByLabelText("Entry kind");
    expect(scope().value).toBe(TENANT);
    expect(labels().slice(0, 2)).toEqual(["Project scope", "Entry kind"]);
  });

  it("keeps the chosen scope and shows ink text under the picker on the design-system form", async () => {
    const fetch = registry([404, { code: "project_not_found", message: "m", subject: "projectId" }]);
    renderPage("Standard owner", { module: designModule, standards: [] });
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Button" } });
    fireEvent.change(screen.getByLabelText("Usage rule"), { target: { value: "Use it" } });
    fireEvent.change(scope(), { target: { value: CHECKOUT } });
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    const error = await screen.findByText("Choose a Project in this Company's Project tree.");
    expect(error.className).toBe("field-error");
    expect(scope().getAttribute("aria-invalid")).toBe("true");
    expect(scope().getAttribute("aria-describedby")).toBe(error.id);
    expect(scope().value).toBe(CHECKOUT);
    expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("Button");
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({ projectId: CHECKOUT, entry: { kind: "component" } });
  });

  it("shows an edited design-system Standard's scope as fixed text, with no picker", async () => {
    renderPage(
      "Standard owner",
      { module: designModule, standards: [{ ...button, project: { id: WEB, name: "Web" } }] },
      `/standards/${MODULE}?edit=${STANDARD}`,
    );
    expect(await screen.findByText("Project scope: Web (fixed for this Standard)")).toBeTruthy();
    expect(document.querySelector("select[name='projectId']")).toBeNull();
    expect(labels()[0]).toBe("Entry kind");
  });

  it("shows an edited Standard's scope as fixed text, with no picker", async () => {
    renderPage("Standard owner", { module, standards: [{ ...react, project: { id: WEB, name: "Web" } }] }, `/standards/${MODULE}?edit=${STANDARD}`);
    expect(await screen.findByText("Project scope: Web (fixed for this Standard)")).toBeTruthy();
    expect(screen.queryByLabelText("Project scope")).toBeNull();
    expect(document.querySelector("select[name='projectId']")).toBeNull();
  });

  it("publishes at the chosen Project and names it in the facts, the status and the table", async () => {
    const fetch = registry([201, { ...react, entry: { ...react.entry, name: "Vue" }, project: { id: CHECKOUT, name: "Checkout" } }]);
    renderPage("Standard owner", { module, standards: [{ ...vue, module: react.module, project: { id: WEB, name: "Web" } }] });
    await fill();
    fireEvent.change(scope(), { target: { value: CHECKOUT } });
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    const heading = await screen.findByRole("heading", { level: 2, name: "Published" });
    const facts = [...(heading.parentElement?.querySelectorAll("dt") ?? [])].map((dt) => [dt.textContent, dt.nextElementSibling?.textContent]);
    expect(facts).toContainEqual(["Project scope", "Checkout"]);
    expect(status().textContent).toContain("Project scope Checkout,");
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({ projectId: CHECKOUT });
    const row = within(screen.getByRole("table")).getAllByRole("row")[1];
    expect(row?.querySelector("td")?.textContent).toBe("Web");
  });

  it("keeps the chosen scope on a refused submit", async () => {
    registry([403, { code: "not_module_owner", message: "m", subject: "role" }]);
    renderPage("Builder", { module, standards: [] });
    await fill();
    fireEvent.change(scope(), { target: { value: WEB } });
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() => {
      expect(status().textContent).toBe("Only the Standard owner of this Module can publish into it. Nothing was published.");
    });
    expect(scope().value).toBe(WEB);
  });

  it("puts ink text under the picker for project_not_found", async () => {
    registry([404, { code: "project_not_found", message: "m", subject: "projectId" }]);
    renderPage("Standard owner", { module, standards: [] });
    await fill();
    fireEvent.change(scope(), { target: { value: WEB } });
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    const error = await screen.findByText("Choose a Project in this Company's Project tree.");
    expect(error.className).toBe("field-error");
    expect(scope().getAttribute("aria-invalid")).toBe("true");
    expect(scope().getAttribute("aria-describedby")).toBe(error.id);
    expect(scope().value).toBe(WEB);
    expect(status().textContent).toBe("");
  });

  it("says the Standard goes to the root Project when the tree is unavailable, and sends no scope", async () => {
    const fetch = registry([201, react]);
    renderPage("Standard owner", { module, standards: [] }, `/standards/${MODULE}`, "ok", undefined, Promise.resolve({ kind: "unavailable" }));
    expect(
      await screen.findByText(
        "The Project tree is unavailable right now, so this Standard will be published at the root Project.",
      ),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Project scope")).toBeNull();
    await fill();
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(1);
    });
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).not.toHaveProperty("projectId");
  });

  it("treats a rejected tree promise as unavailable", async () => {
    const rejected = Promise.reject(new Error("down"));
    rejected.catch(() => undefined);
    renderPage("Standard owner", { module, standards: [] }, `/standards/${MODULE}`, "ok", undefined, rejected);
    expect(
      await screen.findByText(
        "The Project tree is unavailable right now, so this Standard will be published at the root Project.",
      ),
    ).toBeTruthy();
  });
});
