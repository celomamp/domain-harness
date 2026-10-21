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

const labels = () => [...document.querySelectorAll("form.standard-form label")].map((l) => l.textContent);

/** Open the Publish standard sheet and return its dialog. */
async function openPublishSheet(name: RegExp) {
  fireEvent.click(await screen.findByRole("button", { name: "Publish standard" }));
  return screen.findByRole("dialog", { name });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Module Standards page", () => {
  it("shows the Module, its kind and owner, a summary and a table with header cells, even to a Builder", async () => {
    renderPage("Builder", { module, standards: [react, { ...vue, module: react.module }] });
    expect(await screen.findByRole("heading", { level: 1, name: "Frontend stack" })).toBeTruthy();
    expect(screen.getByText("code stack")).toBeTruthy();
    expect(screen.getByText("Standard owner: Sam Owner")).toBeTruthy();

    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(breadcrumb).getByRole("link", { name: "Standards" }).getAttribute("href")).toBe("/standards");
    expect(within(breadcrumb).getByText("Frontend stack").getAttribute("aria-current")).toBe("page");

    expect(screen.getByRole("group", { name: "Standards" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Projects scoped" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Last published" })).toBeTruthy();

    const table = screen.getByRole("table", { name: "Standards" });
    expect(within(table).getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Standard",
      "Project scope",
      "Category",
      "Status",
      "Version constraint",
      "Version",
      "Published (UTC)",
      "Details",
    ]);
    const nameLink = within(table).getByRole("link", { name: "React" });
    expect(nameLink.getAttribute("href")).toBe(`/standards/${MODULE}?edit=${STANDARD}`);
    expect(nameLink.className).toContain("standard-name");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows[0]?.textContent).toContain("Acme");
    expect(rows[0]?.textContent).toContain("library");
    expect(rows[0]?.textContent).toContain("approved");
    expect(rows[0]?.textContent).toContain("^18");
    expect(rows[0]?.textContent).toContain("11 Oct 2026, 09:00 UTC");

    const dialog = await openPublishSheet(/Publish a code-stack Standard/);
    expect(labels()).toEqual([
      "Project scope",
      "Category",
      "Name",
      "Version constraint (optional)",
      "Status",
      "Correction instruction (optional)",
    ]);
    expect([...within(dialog).getByLabelText<HTMLSelectElement>("Category").options].map((o) => o.value)).toEqual([
      "",
      "language",
      "framework",
      "library",
    ]);
    expect([...within(dialog).getByLabelText<HTMLSelectElement>("Status").options].map((o) => o.value)).toEqual([
      "",
      "approved",
      "prohibited",
      "required",
    ]);
    expect(within(dialog).getByLabelText("Correction instruction (optional)").tagName).toBe("TEXTAREA");
    expect(within(dialog).getByRole("button", { name: "Publish" }).className).toBe("button-primary");
    expect(within(dialog).queryByRole("link", { name: "Cancel edit" })).toBeNull();
  });

  it("shows the empty state", async () => {
    renderPage("Standard owner", { module, standards: [] });
    expect(await screen.findByText("No Standard is published in this Module yet.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("announces the registry's denial to a Builder as a status, and nothing changes", async () => {
    const fetch = registry([403, { code: "not_module_owner", message: "m", subject: "role" }]);
    renderPage("Builder", { module, standards: [react] });
    const dialog = await openPublishSheet(/Publish a code-stack Standard/);
    fireEvent.change(within(dialog).getByLabelText("Category"), { target: { value: "library" } });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Vue" } });
    fireEvent.change(within(dialog).getByLabelText("Status"), { target: { value: "approved" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Publish" }));
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
    const dialog = await openPublishSheet(/Publish a code-stack Standard/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Publish" }));
    await waitFor(() => {
      expect(status().textContent).toMatch(/^This Module has no owner, so nothing can be published into it/);
    });
  });

  it("keeps every value and puts ink text under the field on an invalid submit", async () => {
    registry([400, { code: "invalid_input", message: "m", subject: "name" }]);
    renderPage("Standard owner", { module, standards: [] });
    const long = "x".repeat(201);
    const dialog = await openPublishSheet(/Publish a code-stack Standard/);
    fireEvent.change(within(dialog).getByLabelText("Category"), { target: { value: "framework" } });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: long } });
    fireEvent.change(within(dialog).getByLabelText("Version constraint (optional)"), { target: { value: ">=1" } });
    fireEvent.change(within(dialog).getByLabelText("Status"), { target: { value: "required" } });
    fireEvent.change(within(dialog).getByLabelText("Correction instruction (optional)"), { target: { value: "Use it." } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Publish" }));

    const error = await within(dialog).findByText("Enter a name of 1 to 200 characters.");
    const name = within(dialog).getByLabelText<HTMLInputElement>("Name");
    expect(name.value).toBe(long);
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(name.getAttribute("aria-describedby")).toBe(error.id);
    expect(error.className).toBe("field-error");
    expect(error.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(within(dialog).getByLabelText<HTMLSelectElement>("Category").value).toBe("framework");
    expect(within(dialog).getByLabelText<HTMLInputElement>("Version constraint (optional)").value).toBe(">=1");
    expect(within(dialog).getByLabelText<HTMLSelectElement>("Status").value).toBe("required");
    expect(within(dialog).getByLabelText<HTMLTextAreaElement>("Correction instruction (optional)").value).toBe("Use it.");
    expect(status().textContent).toBe("");
  });

  it("shows the Standard id, Project scope, version and UTC time after a publish, and closes the sheet", async () => {
    const fetch = registry([201, { ...react, publishedAt: LATER }]);
    renderPage("Standard owner", { module, standards: [] });
    const dialog = await openPublishSheet(/Publish a code-stack Standard/);
    fireEvent.change(within(dialog).getByLabelText("Category"), { target: { value: "library" } });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: " React " } });
    fireEvent.change(within(dialog).getByLabelText("Status"), { target: { value: "approved" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Publish" }));

    await screen.findByText("Published");
    const facts = document.querySelector(".published-facts");
    expect(facts?.textContent).toContain("Standard id");
    expect(facts?.textContent).toContain(STANDARD);
    expect(facts?.textContent).toContain("Version");
    expect(facts?.textContent).toContain("1");
    expect(facts?.textContent).toContain("Project scope");
    expect(facts?.textContent).toContain("Acme");
    expect(facts?.textContent).toContain("Published (UTC)");
    expect(facts?.textContent).toContain("11 Oct 2026, 10:30 UTC");
    expect(within(facts as HTMLElement).getByRole("button", { name: "Copy" })).toBeTruthy();
    expect(status().textContent).toBe(
      `Published React: Standard ${STANDARD}, version 1, in Module Frontend stack, Project scope Acme, at ${LATER}.`,
    );
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    const [url] = fetch.mock.calls[0] as unknown as [string];
    expect(url).toMatch(new RegExp(`/v1/modules/${MODULE}/standards$`));
  });

  it("names both Standards and the slot on a slot conflict", async () => {
    registry([409, { code: "slot_conflict", message: "m", subject: HOLDER }], [200, { standardId: HOLDER, versions: [vue] }]);
    renderPage("Standard owner", { module, standards: [] });
    const dialog = await openPublishSheet(/Publish a code-stack Standard/);
    fireEvent.change(within(dialog).getByLabelText("Category"), { target: { value: "library" } });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "VUE" } });
    fireEvent.change(within(dialog).getByLabelText("Status"), { target: { value: "approved" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Publish" }));
    await waitFor(() => {
      expect(status().textContent).toBe(
        `Nothing was published. The library "VUE" is in the same Conflict slot (code stack, library, "Vue") as Standard ${HOLDER}, ` +
          'library "Vue" in Module Backend stack, at Project Acme.',
      );
    });
    expect(within(dialog).getByLabelText<HTMLInputElement>("Name").value).toBe("VUE");
  });

  it("edits a Standard: prefills the live entry and publishes a new version", async () => {
    const fetch = registry([201, { ...react, version: 2, entry: { ...react.entry, status: "required" } }]);
    renderPage("Standard owner", { module, standards: [react] }, `/standards/${MODULE}?edit=${STANDARD}`);
    const dialog = await screen.findByRole("dialog", { name: "Edit React" });
    const category = within(dialog).getByLabelText<HTMLSelectElement>("Category");
    expect(category.value).toBe("library");
    expect(within(dialog).getByLabelText<HTMLInputElement>("Name").value).toBe("React");
    expect(within(dialog).getByLabelText<HTMLTextAreaElement>("Correction instruction (optional)").value).toBe("Use React 18.");
    expect(within(dialog).getByRole("link", { name: "Cancel edit" })).toBeTruthy();

    fireEvent.change(within(dialog).getByLabelText("Status"), { target: { value: "required" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Publish" }));
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
    const dialog = await screen.findByRole("dialog", { name: "Edit React" });
    fireEvent.change(within(dialog).getByLabelText("Status"), { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Publish" }));
    expect(await within(dialog).findByText("Choose a status: approved, prohibited or required.")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Edit React" })).toBeTruthy();
  });

  it("leaves edit mode on Esc without committing and returns focus to the row's name link", async () => {
    const fetch = registry();
    renderPage("Standard owner", { module, standards: [react] }, `/standards/${MODULE}?edit=${STANDARD}`);
    const dialog = await screen.findByRole("dialog", { name: "Edit React" });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Changed" } });
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole("link", { name: "React" }));
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps the structure and says Standards are unavailable when the registry is down", async () => {
    renderPage("Buyer", null);
    await waitFor(() => {
      expect(status().textContent).toBe("Standards are unavailable right now. Try again in a few minutes.");
    });
    expect(screen.getByRole("heading", { level: 1, name: "Standards" })).toBeTruthy();
    expect(status().querySelector(".denial")).not.toBeNull();
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
    await screen.findByRole("button", { name: "Publish standard" });
    // The shell's skip-link target on `<main>` carries tabindex="-1"; no element
    // may carry a tabindex that participates in (or reorders) the tab order.
    expect([...document.querySelectorAll<HTMLElement>("[tabindex]")].filter((el) => el.tabIndex > 0)).toHaveLength(0);
    const focusables = [
      ...document.querySelectorAll<HTMLElement>("main a[href], main button, main input:not([type=hidden]), main select, main textarea"),
    ];
    const labels = focusables.map((el) => el.getAttribute("name") ?? el.textContent);
    expect(labels.indexOf("Standards")).toBeLessThan(labels.indexOf("Publish standard"));
    expect(labels.indexOf("Publish standard")).toBeLessThan(labels.indexOf("React"));
    expect(labels.indexOf("React")).toBeLessThan(labels.indexOf("Show details"));
  });

  it("keeps the publish form's field names and intents", async () => {
    renderPage("Standard owner", { module, standards: [] });
    const dialog = await openPublishSheet(/Publish a code-stack Standard/);
    expect(within(dialog).getByLabelText("Category")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Publish" })).toBeTruthy();
  });

  it("keeps long Module and Standard names visible and wrapped", async () => {
    const long = "S".repeat(120);
    const longModule = { ...module, name: long };
    const longStandard = { ...react, module: longModule, entry: { ...react.entry, name: long } };
    renderPage("Standard owner", { module: longModule, standards: [longStandard] });
    expect((await screen.findByRole("heading", { level: 1, name: long })).className).toContain("type-page-title");
    expect(screen.getByRole("link", { name: long }).className).toContain("standard-name");
  });

  it("handles 60 standards without dropping rows", async () => {
    const sixty = Array.from({ length: 60 }, (_, i) => ({
      ...react,
      id: `std-${String(i)}`,
      version: i + 1,
      entry: { ...react.entry, name: `Library ${String(i)}` },
    }));
    renderPage("Standard owner", { module, standards: sixty });
    await screen.findByRole("table", { name: /Standards/ });
    expect(screen.getAllByRole("row")).toHaveLength(61);
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

describe("Module Standards page: cold-load and session", () => {
  it("shows the structure, the table header cells and a busy row, and no form, while the list loads", async () => {
    let resolve: (value: unknown) => void = () => undefined;
    const pending = new Promise((done) => {
      resolve = done;
    });
    renderPage("Standard owner", null, `/standards/${MODULE}`, "ok", pending);
    expect(await screen.findByRole("heading", { level: 1, name: "Standards" })).toBeTruthy();
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Standard",
      "Project scope",
      "Status",
      "Version",
      "Published (UTC)",
    ]);
    const busy = within(table).getByText("Loading Standards…");
    expect(busy.closest("[aria-busy='true']")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Publish standard" })).toBeNull();
    expect(document.querySelector("form.standard-form")).toBeNull();
    expect(screen.getByRole("status")).toBeTruthy();

    resolve({ kind: "ok", value: { module, standards: [react] } });
    expect(await screen.findByRole("heading", { level: 1, name: "Frontend stack" })).toBeTruthy();
    expect(screen.queryByText("Loading Standards…")).toBeNull();
    expect(document.querySelector("[aria-busy='true']")).toBeNull();
    expect(screen.getByRole("button", { name: "Publish standard" })).toBeTruthy();
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
  it("shows the design-system table with header cells, one row per entry kind, and its name links", async () => {
    renderPage("Builder", { module: designModule, standards: [button, primary, mui] });
    expect(await screen.findByText("design system")).toBeTruthy();
    const table = screen.getByRole("table", { name: "Standards" });
    expect(within(table).getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Standard",
      "Project scope",
      "Entry kind",
      "Status",
      "Usage rule",
      "Tokens",
      "Version",
      "Published (UTC)",
      "Details",
    ]);
    expect(within(table).getByRole("link", { name: "Button" }).className).toContain("standard-name");
    expect(within(table).getByRole("link", { name: "primary" }).getAttribute("href")).toBe(
      `/standards/${MODULE}?edit=${HOLDER}`,
    );
    expect(within(table).getByRole("link", { name: "@mui/material" }).getAttribute("href")).toBe(
      `/standards/${MODULE}?edit=${BEA}`,
    );
    // A component has no status field: its Status cell says what governs it instead of "None".
    const componentRow = within(table).getByRole("link", { name: "Button" }).closest("tr") as HTMLElement;
    const cells = within(componentRow).getAllByRole("cell").map((cell) => cell.textContent);
    expect(cells).toContain("Governed by usage rule");
    expect(cells).not.toContain("None");
  });

  it("shows the empty state and the design-system form with the component field set first", async () => {
    renderPage("Standard owner", { module: designModule, standards: [] });
    expect(await screen.findByText("No Standard is published in this Module yet.")).toBeTruthy();
    const dialog = await openPublishSheet(/Publish a design-system Standard/);
    expect(document.querySelectorAll("form.standard-form")).toHaveLength(1);
    expect(labels()).toEqual([
      "Project scope",
      "Entry kind",
      "Name",
      "Usage rule",
      "Tokens it depends on (optional, separated by commas)",
      "Correction instruction (optional)",
    ]);
    expect([...within(dialog).getByLabelText<HTMLSelectElement>("Entry kind").options].map((o) => o.value)).toEqual([
      "component",
      "token",
      "import",
    ]);
    expect(within(dialog).getByLabelText("Usage rule").tagName).toBe("TEXTAREA");
  });

  it("switches the field set with the entry kind", async () => {
    renderPage("Standard owner", { module: designModule, standards: [] });
    const dialog = await openPublishSheet(/Publish a design-system Standard/);
    const kind = within(dialog).getByLabelText("Entry kind");
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "primary" } });
    fireEvent.change(kind, { target: { value: "token" } });
    expect(labels()).toEqual(["Project scope", "Entry kind", "Name", "Status"]);
    expect(within(dialog).getByLabelText<HTMLInputElement>("Name").value).toBe("primary");
    expect([...within(dialog).getByLabelText<HTMLSelectElement>("Status").options].map((o) => o.value)).toEqual([
      "",
      "required",
      "prohibited",
    ]);
    fireEvent.change(kind, { target: { value: "import" } });
    expect(labels()).toEqual(["Project scope", "Entry kind", "Module specifier", "Status"]);
    fireEvent.change(kind, { target: { value: "component" } });
    expect(labels()).toHaveLength(6);
  });

  it("publishes a component and shows the published facts", async () => {
    const fetch = registry([201, { ...button, publishedAt: LATER }]);
    renderPage("Standard owner", { module: designModule, standards: [] });
    const dialog = await openPublishSheet(/Publish a design-system Standard/);
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: " Button " } });
    fireEvent.change(within(dialog).getByLabelText("Usage rule"), { target: { value: "Use for primary actions" } });
    fireEvent.change(within(dialog).getByLabelText("Tokens it depends on (optional, separated by commas)"), {
      target: { value: "primary, spacing-4" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Publish" }));
    await screen.findByText("Published");
    const facts = document.querySelector(".published-facts");
    expect(facts?.textContent).toContain(STANDARD);
    expect(facts?.textContent).toContain("1");
    expect(status().textContent).toMatch(/^Published Button: Standard /);
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({ entry: { kind: "component", tokens: ["primary", "spacing-4"] } });
  });

  it("keeps every value and puts ink text under the field on an invalid submit", async () => {
    registry([400, { code: "invalid_input", message: "m", subject: "tokens" }]);
    renderPage("Standard owner", { module: designModule, standards: [] });
    const dialog = await openPublishSheet(/Publish a design-system Standard/);
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Button" } });
    fireEvent.change(within(dialog).getByLabelText("Usage rule"), { target: { value: "Use it" } });
    fireEvent.change(within(dialog).getByLabelText("Tokens it depends on (optional, separated by commas)"), {
      target: { value: "a, A" },
    });
    fireEvent.change(within(dialog).getByLabelText("Correction instruction (optional)"), { target: { value: "Fix it." } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Publish" }));

    const error = await within(dialog).findByText(
      "List at most 50 different token names of 1 to 200 characters each, separated by commas, or leave it empty.",
    );
    const tokens = within(dialog).getByLabelText<HTMLInputElement>("Tokens it depends on (optional, separated by commas)");
    expect(tokens.value).toBe("a, A");
    expect(tokens.getAttribute("aria-describedby")).toBe(error.id);
    expect(error.className).toBe("field-error");
    expect(within(dialog).getByLabelText<HTMLInputElement>("Name").value).toBe("Button");
    expect(within(dialog).getByLabelText<HTMLTextAreaElement>("Usage rule").value).toBe("Use it");
    expect(within(dialog).getByLabelText<HTMLTextAreaElement>("Correction instruction (optional)").value).toBe("Fix it.");
    expect(within(dialog).getByLabelText<HTMLSelectElement>("Entry kind").value).toBe("component");
  });

  it("keeps a refused token's kind and values", async () => {
    registry([400, { code: "invalid_input", message: "m", subject: "status" }]);
    renderPage("Standard owner", { module: designModule, standards: [] });
    const dialog = await openPublishSheet(/Publish a design-system Standard/);
    fireEvent.change(within(dialog).getByLabelText("Entry kind"), { target: { value: "token" } });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "primary" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Publish" }));
    expect(await within(dialog).findByText("Choose a status: required or prohibited.")).toBeTruthy();
    expect(within(dialog).getByLabelText<HTMLSelectElement>("Entry kind").value).toBe("token");
    expect(within(dialog).getByLabelText<HTMLInputElement>("Name").value).toBe("primary");
  });

  it("names both Standards and the component slot on a slot conflict", async () => {
    const holder = { ...button, id: HOLDER, module: { id: BEA, kind: "design-system", name: "Brand design system" } };
    registry([409, { code: "slot_conflict", message: "m", subject: HOLDER }], [200, { standardId: HOLDER, versions: [holder] }]);
    renderPage("Standard owner", { module: designModule, standards: [] });
    const dialog = await openPublishSheet(/Publish a design-system Standard/);
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "button" } });
    fireEvent.change(within(dialog).getByLabelText("Usage rule"), { target: { value: "Use it" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Publish" }));
    await waitFor(() => {
      expect(status().textContent).toBe(
        `Nothing was published. The component "button" is in the same Conflict slot (design system, component, "Button") ` +
          `as Standard ${HOLDER}, component "Button" in Module Brand design system, at Project Acme.`,
      );
    });
    expect(status().querySelector(".denial")).not.toBeNull();
    expect(within(dialog).getByLabelText<HTMLInputElement>("Name").value).toBe("button");
  });

  it("edits a component: its kind and values are prefilled; Esc leaves", async () => {
    const fetch = registry();
    renderPage("Standard owner", { module: designModule, standards: [button, primary] }, `/standards/${MODULE}?edit=${STANDARD}`);
    const dialog = await screen.findByRole("dialog", { name: "Edit Button" });
    const kind = within(dialog).getByLabelText<HTMLSelectElement>("Entry kind");
    expect(kind.value).toBe("component");
    expect(within(dialog).getByLabelText<HTMLInputElement>("Tokens it depends on (optional, separated by commas)").value).toBe(
      "primary, spacing-4",
    );
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole("link", { name: "Button" }));
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("edits a token with its own field set", async () => {
    renderPage("Standard owner", { module: designModule, standards: [button, primary] }, `/standards/${MODULE}?edit=${HOLDER}`);
    const dialog = await screen.findByRole("dialog", { name: "Edit primary" });
    expect(labels()).toEqual(["Entry kind", "Name", "Status"]);
    expect(within(dialog).getByLabelText<HTMLSelectElement>("Status").value).toBe("prohibited");
    expect(within(dialog).getByRole("link", { name: "Cancel edit" })).toBeTruthy();
  });
});

describe("Module Standards page: Project scope", () => {
  const fill = (dialog: HTMLElement) => {
    fireEvent.change(within(dialog).getByLabelText("Category"), { target: { value: "library" } });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Vue" } });
    fireEvent.change(within(dialog).getByLabelText("Status"), { target: { value: "approved" } });
  };

  it("lists every Project in tree order with level names, the root selected, before the entry fields", async () => {
    renderPage("Standard owner", { module, standards: [] });
    const dialog = await openPublishSheet(/Publish a code-stack Standard/);
    const scope = within(dialog).getByLabelText<HTMLSelectElement>("Project scope");
    expect(scope.id).toBe("standard-project");
    expect(scope.name).toBe("projectId");
    expect([...scope.options].map((o) => [o.value, o.textContent])).toEqual([
      [TENANT, "Acme"],
      [WEB, "Web (level Product line)"],
      [CHECKOUT, "Checkout (level Team)"],
    ]);
    expect(scope.value).toBe(TENANT);
    expect(scope.compareDocumentPosition(within(dialog).getByLabelText("Category")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows the picker on the design-system form too, before the entry kind", async () => {
    renderPage("Standard owner", { module: designModule, standards: [] });
    const dialog = await openPublishSheet(/Publish a design-system Standard/);
    const scope = within(dialog).getByLabelText<HTMLSelectElement>("Project scope");
    expect(scope.value).toBe(TENANT);
    expect(labels().slice(0, 2)).toEqual(["Project scope", "Entry kind"]);
  });

  it("keeps the chosen scope and shows ink text under the picker on the design-system form", async () => {
    const fetch = registry([404, { code: "project_not_found", message: "m", subject: "projectId" }]);
    renderPage("Standard owner", { module: designModule, standards: [] });
    const dialog = await openPublishSheet(/Publish a design-system Standard/);
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Button" } });
    fireEvent.change(within(dialog).getByLabelText("Usage rule"), { target: { value: "Use it" } });
    const scope = within(dialog).getByLabelText<HTMLSelectElement>("Project scope");
    fireEvent.change(scope, { target: { value: CHECKOUT } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Publish" }));
    const error = await within(dialog).findByText("Choose a Project in this Company's Project tree.");
    expect(error.className).toBe("field-error");
    expect(scope.getAttribute("aria-invalid")).toBe("true");
    expect(scope.getAttribute("aria-describedby")).toBe(error.id);
    expect(scope.value).toBe(CHECKOUT);
    expect(within(dialog).getByLabelText<HTMLInputElement>("Name").value).toBe("Button");
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({ projectId: CHECKOUT, entry: { kind: "component" } });
  });

  it("shows an edited design-system Standard's scope as fixed text, with no picker", async () => {
    renderPage(
      "Standard owner",
      { module: designModule, standards: [{ ...button, project: { id: WEB, name: "Web" } }] },
      `/standards/${MODULE}?edit=${STANDARD}`,
    );
    const dialog = await screen.findByRole("dialog", { name: "Edit Button" });
    expect(within(dialog).getByText("Project scope: Web (fixed for this Standard)")).toBeTruthy();
    expect(document.querySelector("select[name='projectId']")).toBeNull();
    expect(labels()[0]).toBe("Entry kind");
  });

  it("shows an edited Standard's scope as fixed text, with no picker", async () => {
    renderPage("Standard owner", { module, standards: [{ ...react, project: { id: WEB, name: "Web" } }] }, `/standards/${MODULE}?edit=${STANDARD}`);
    const dialog = await screen.findByRole("dialog", { name: "Edit React" });
    expect(within(dialog).getByText("Project scope: Web (fixed for this Standard)")).toBeTruthy();
    expect(within(dialog).queryByLabelText("Project scope")).toBeNull();
    expect(document.querySelector("select[name='projectId']")).toBeNull();
  });

  it("publishes at the chosen Project and names it in the facts, the status and the table", async () => {
    const fetch = registry([201, { ...react, entry: { ...react.entry, name: "Vue" }, project: { id: CHECKOUT, name: "Checkout" } }]);
    renderPage("Standard owner", { module, standards: [{ ...vue, module: react.module, project: { id: WEB, name: "Web" } }] });
    const dialog = await openPublishSheet(/Publish a code-stack Standard/);
    fill(dialog);
    fireEvent.change(within(dialog).getByLabelText("Project scope"), { target: { value: CHECKOUT } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Publish" }));
    await screen.findByText("Published");
    const facts = document.querySelector(".published-facts");
    expect(facts?.textContent).toContain("Checkout");
    expect(status().textContent).toContain("Project scope Checkout,");
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({ projectId: CHECKOUT });
    const row = within(screen.getByRole("table")).getAllByRole("row")[1];
    expect(row?.querySelector("td")?.textContent).toBe("Web");
  });

  it("keeps the chosen scope on a refused submit", async () => {
    registry([403, { code: "not_module_owner", message: "m", subject: "role" }]);
    renderPage("Builder", { module, standards: [] });
    const dialog = await openPublishSheet(/Publish a code-stack Standard/);
    fill(dialog);
    fireEvent.change(within(dialog).getByLabelText("Project scope"), { target: { value: WEB } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Publish" }));
    await waitFor(() => {
      expect(status().textContent).toBe("Only the Standard owner of this Module can publish into it. Nothing was published.");
    });
    expect(within(dialog).getByLabelText<HTMLSelectElement>("Project scope").value).toBe(WEB);
  });

  it("puts ink text under the picker for project_not_found", async () => {
    registry([404, { code: "project_not_found", message: "m", subject: "projectId" }]);
    renderPage("Standard owner", { module, standards: [] });
    const dialog = await openPublishSheet(/Publish a code-stack Standard/);
    fill(dialog);
    const scope = within(dialog).getByLabelText<HTMLSelectElement>("Project scope");
    fireEvent.change(scope, { target: { value: WEB } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Publish" }));
    const error = await within(dialog).findByText("Choose a Project in this Company's Project tree.");
    expect(error.className).toBe("field-error");
    expect(scope.getAttribute("aria-invalid")).toBe("true");
    expect(scope.getAttribute("aria-describedby")).toBe(error.id);
    expect(scope.value).toBe(WEB);
    expect(status().textContent).toBe("");
  });

  it("says the Standard goes to the root Project when the tree is unavailable, and sends no scope", async () => {
    const fetch = registry([201, react]);
    renderPage("Standard owner", { module, standards: [] }, `/standards/${MODULE}`, "ok", undefined, Promise.resolve({ kind: "unavailable" }));
    const dialog = await openPublishSheet(/Publish a code-stack Standard/);
    expect(
      await within(dialog).findByText(
        "The Project tree is unavailable right now, so this Standard will be published at the root Project.",
      ),
    ).toBeTruthy();
    expect(within(dialog).queryByLabelText("Project scope")).toBeNull();
    fill(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Publish" }));
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
    const dialog = await openPublishSheet(/Publish a code-stack Standard/);
    expect(
      await within(dialog).findByText(
        "The Project tree is unavailable right now, so this Standard will be published at the root Project.",
      ),
    ).toBeTruthy();
  });
});
