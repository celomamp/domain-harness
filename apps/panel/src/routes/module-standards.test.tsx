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

function renderPage(role: Role, list: unknown, url = `/standards/${MODULE}`, state = list === null ? "unavailable" : "ok") {
  const Layout = () => (
    <>
      <PanelChrome role={role} />
      <main>
        <Outlet />
      </main>
    </>
  );
  const loader = ({ request, params }: LoaderFunctionArgs) => ({
    moduleId: params["moduleId"] ?? "",
    list,
    state,
    editId: new URL(request.url).searchParams.get("edit"),
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
      "Category",
      "Status",
      "Version constraint",
      "Version",
      "Published (UTC)",
      "Standard id",
    ]);
    const rows = within(table).getAllByRole("row").slice(1);
    expect([...(rows[0]?.querySelectorAll("td") ?? [])].map((td) => td.textContent)).toEqual([
      "library",
      "approved",
      "^18",
      "1",
      AT,
      STANDARD,
    ]);
    expect(rows[1]?.querySelectorAll("td")[2]?.textContent).toBe("None");
    expect(within(rows[0] as HTMLElement).getByRole("link", { name: "Edit React" }).getAttribute("href")).toBe(
      `/standards/${MODULE}?edit=${STANDARD}`,
    );

    const labels = [...document.querySelectorAll("form.standard-form label")].map((l) => l.textContent);
    expect(labels).toEqual([
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
      ["Project scope", "Acme (root Project)"],
      ["Version", "1"],
      ["Published (UTC)", LATER],
    ]);
    expect(status().textContent).toBe(
      `Published React: Standard ${STANDARD}, version 1, in Module Frontend stack, Project scope Acme (root Project), at ${LATER}.`,
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
          'library "Vue" in Module Backend stack, at the root Project.',
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

  it("shows plain text instead of the form for a design-system Module", async () => {
    renderPage("Standard owner", { module: { ...module, kind: "design-system", name: "Design system" }, standards: [] });
    expect(await screen.findByText("Design-system entries are not available yet.")).toBeTruthy();
    expect(screen.getByText("Kind: design system")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
  });

  it("keeps the structure and says Standards are unavailable when the registry is down", async () => {
    renderPage("Buyer", null);
    expect(await screen.findByRole("heading", { level: 1, name: "Standards" })).toBeTruthy();
    expect(status().textContent).toBe("Standards are unavailable right now. Try again in a few minutes.");
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
    await screen.findByRole("table");
    expect(document.querySelectorAll("[tabindex]").length).toBe(0);
    const focusables = [
      ...document.querySelectorAll<HTMLElement>("main a[href], main button, main input:not([type=hidden]), main select, main textarea"),
    ];
    expect(focusables.map((el) => el.getAttribute("name") ?? el.textContent)).toEqual([
      "All Modules",
      "Edit React",
      "category",
      "name",
      "versionConstraint",
      "status",
      "correctionInstruction",
      "Publish",
    ]);
  });
});
