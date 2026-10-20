// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createRoutesStub, Outlet } from "react-router";
import type { ActionFunctionArgs } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@domain-harness/contract";
import { PanelChrome } from "../components/panel-chrome.tsx";
import Standards, { action } from "./standards.tsx";

const TENANT = "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e5f6";
const MODULE = "01928c7e-5b2a-7c3d-9e4f-a1b2c3d4e5f7";
const SAM = "01928c7e-5b2a-7c3d-ae4f-a1b2c3d4e5f8";
const BEA = "01928c7e-5b2a-7c3d-be4f-a1b2c3d4e5f9";
const SUE = "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e5fa";
const AT = "2026-10-11T09:00:00.000Z";
const COOKIE = `dh_session=${TENANT}.${"S".repeat(43)}`;

const unowned = { id: MODULE, kind: "code-stack", name: "Code stack", owner: null, createdAt: AT };
const owned = {
  ...unowned,
  owner: { accountId: SAM, name: "Sam Owner", assignedAt: AT, assignedBy: { accountId: BEA, name: "Bea Buyer" } },
};
const standardOwners = [
  { accountId: SAM, name: "Sam Owner" },
  { accountId: SUE, name: "Sue Owner" },
];
const DENIAL = "Only the Buyer can create a Module or assign its Standard owner. Nothing was changed.";

/** The real action, with the session cookie a browser would send. */
async function actionWithCookie(args: ActionFunctionArgs) {
  const body = await args.request.formData();
  const request = new Request("http://x/standards", { method: "POST", body, headers: { cookie: COOKIE } });
  return action({ ...args, request });
}

function renderStandards(role: Role, list: unknown) {
  const Layout = () => (
    <PanelChrome role={role}>
      <Outlet />
    </PanelChrome>
  );
  const Stub = createRoutesStub([
    {
      Component: Layout,
      children: [{ path: "/standards", Component: Standards, loader: () => ({ list }), action: actionWithCookie }],
    },
  ]);
  render(<Stub initialEntries={["/standards"]} />);
}

function registry(status: number, body: unknown) {
  const fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

/** Open the Create Module sheet and return its dialog. */
async function openCreateSheet() {
  fireEvent.click(await screen.findByRole("button", { name: "Create Module" }));
  return screen.findByRole("dialog", { name: "Create a Module" });
}

/** Open the owner sheet for a Module and return its dialog. */
async function openOwnerSheet(actionName: "Change owner" | "Assign owner") {
  fireEvent.click(await screen.findByRole("button", { name: actionName }));
  return screen.findByRole("dialog", { name: /Standard owner/ });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Standards: Modules section", () => {
  it("shows a summary of Modules by kind and ownership", async () => {
    renderStandards("Buyer", {
      modules: [owned, { ...unowned, id: SUE, name: "Another code stack" }],
      standardOwners,
    });
    expect(await screen.findByText("Modules")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.getByText("Without an owner")).toBeTruthy();
  });

  it("shows the empty state and a create sheet whose kind control has exactly code stack and design system", async () => {
    renderStandards("Buyer", { modules: [], standardOwners });
    expect(await screen.findByText("No Module yet.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create Module" }).className).toBe("button-primary");
    const dialog = await openCreateSheet();
    const kind = within(dialog).getByLabelText<HTMLSelectElement>("Kind");
    expect([...kind.options].map((o) => [o.value, o.textContent])).toEqual([
      ["code-stack", "code stack"],
      ["design-system", "design system"],
    ]);
    expect(within(dialog).getByLabelText("Module name")).toBeTruthy();
  });

  it("lists Modules in a table with header cells, kind badges, owner and assigned date", async () => {
    renderStandards("Buyer", {
      modules: [owned, { ...unowned, id: SUE, name: "Design system", kind: "design-system" }],
      standardOwners,
    });
    const table = await screen.findByRole("table");
    const headers = within(table).getAllByRole("columnheader").map((th) => th.textContent);
    expect(headers).toEqual(["Module", "Kind", "Standard owner", "Assigned date", "Actions"]);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(within(rows[0] as HTMLElement).getByRole("rowheader").textContent).toBe("Code stack");
    expect(within(rows[0] as HTMLElement).getByRole("link", { name: "Code stack" }).getAttribute("href")).toBe(
      `/standards/${MODULE}`,
    );
    expect(screen.getByText("Open a Module to see and publish its Standards.")).toBeTruthy();
    expect(rows[0]?.textContent).toContain("code stack");
    expect(rows[0]?.textContent).toContain("Sam Owner");
    expect(rows[0]?.textContent).toContain("11 Oct 2026");
    expect(rows[1]?.textContent).toContain("design system");
    expect(rows[1]?.textContent).toContain("No owner");
    expect(within(rows[0] as HTMLElement).getByRole("button", { name: "Change owner" })).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByRole("button", { name: "Assign owner" })).toBeTruthy();
  });

  it("opens the owner side sheet from a row action and keeps focus inside it", async () => {
    renderStandards("Buyer", { modules: [owned], standardOwners });
    fireEvent.click(await screen.findByRole("button", { name: "Change owner" }));
    expect(screen.getByRole("dialog", { name: /Standard owner/ })).toBeTruthy();
    expect(document.activeElement?.textContent).toContain("Standard owner");
  });

  it("shows every control to a Builder and announces the registry's denial as a status, table unchanged", async () => {
    const fetch = registry(403, { code: "role_denied", message: "m", subject: "role" });
    renderStandards("Builder", { modules: [unowned], standardOwners });
    expect(await screen.findByRole("button", { name: "Create Module" })).toBeTruthy();

    const ownerDialog = await openOwnerSheet("Assign owner");
    const select = within(ownerDialog).getByLabelText<HTMLSelectElement>("Standard owner for Code stack");
    expect([...select.options].map((o) => o.textContent)).toEqual(["Choose a Standard owner", "Sam Owner", "Sue Owner"]);
    fireEvent.change(select, { target: { value: SAM } });
    fireEvent.click(within(ownerDialog).getByRole("button", { name: "Assign Standard owner" }));
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe(DENIAL);
    });
    expect(screen.getByRole("status").querySelector(".denial")).not.toBeNull();
    expect(screen.getByRole("table").textContent).toContain("No owner");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("shows every control to a Builder in the create sheet and announces the denial", async () => {
    const fetch = registry(403, { code: "role_denied", message: "m", subject: "role" });
    renderStandards("Builder", { modules: [unowned], standardOwners });
    const dialog = await openCreateSheet();
    fireEvent.change(within(dialog).getByLabelText("Module name"), { target: { value: "Code stack 2" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe(DENIAL);
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    // The refusal keeps the sheet open with the submitted name.
    expect(within(dialog).getByLabelText<HTMLInputElement>("Module name").value).toBe("Code stack 2");
  });

  it("keeps the values and adds ink text under the field on an invalid submit", async () => {
    registry(409, { code: "module_name_taken", message: "m", subject: "name" });
    renderStandards("Buyer", { modules: [unowned], standardOwners });
    const dialog = await openCreateSheet();
    fireEvent.change(within(dialog).getByLabelText("Module name"), { target: { value: "code STACK" } });
    fireEvent.change(within(dialog).getByLabelText("Kind"), { target: { value: "design-system" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));

    const error = await within(dialog).findByText(/Another Module already has this name/);
    const input = within(dialog).getByLabelText<HTMLInputElement>("Module name");
    expect(input.value).toBe("code STACK");
    expect(within(dialog).getByLabelText<HTMLSelectElement>("Kind").value).toBe("design-system");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(error.id);
    expect(error.className).toBe("field-error");
    expect(error.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it("adds ink text under the owner select for an ineligible account and keeps the choice", async () => {
    const fetch = registry(400, { code: "invalid_input", message: "m", subject: "accountId" });
    renderStandards("Buyer", { modules: [owned], standardOwners });
    const dialog = await openOwnerSheet("Change owner");
    const before = within(dialog).getByLabelText<HTMLSelectElement>("Standard owner for Code stack");
    expect(before.value).toBe(SAM);
    fireEvent.change(before, { target: { value: SUE } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Assign Standard owner" }));
    const error = await within(dialog).findByText("Choose a Standard owner account.");
    const select = within(dialog).getByLabelText<HTMLSelectElement>("Standard owner for Code stack");
    expect(select.value).toBe(SUE);
    expect(select.getAttribute("aria-invalid")).toBe("true");
    expect(select.getAttribute("aria-describedby")).toBe(error.id);
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.body).toBe(JSON.stringify({ accountId: SUE }));
  });

  it("announces a created Module as a status and closes the sheet", async () => {
    registry(201, { ...unowned, id: SUE, name: "Code stack" });
    renderStandards("Buyer", { modules: [], standardOwners });
    const dialog = await openCreateSheet();
    fireEvent.change(within(dialog).getByLabelText("Module name"), { target: { value: " Code stack " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("Module created: Code stack.");
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Create a Module" })).toBeNull();
    });
  });

  it("keeps the structure and says Modules are unavailable when the registry is down", async () => {
    renderStandards("Buyer", null);
    expect(await screen.findByText("Modules are unavailable right now. Try again in a few minutes.")).toBeTruthy();
    expect(screen.getByRole("status").querySelector(".denial")).not.toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("button", { name: "Create Module" })).toBeTruthy();
  });

  it("keeps tab order equal to reading order with no positive tabindex", async () => {
    renderStandards("Buyer", { modules: [unowned], standardOwners });
    await screen.findByRole("table");
    // The shell's skip-link target on `<main>` carries tabindex="-1"; no element
    // may carry a tabindex that participates in (or reorders) the tab order.
    expect([...document.querySelectorAll<HTMLElement>("[tabindex]")].filter((el) => el.tabIndex >= 0)).toHaveLength(0);
    const focusables = [
      ...document.querySelectorAll<HTMLElement>("main a[href], main button, main input:not([type=hidden]), main select"),
    ];
    const labels = focusables.map((el) => el.getAttribute("name") ?? el.textContent);
    expect(labels[0]).toBe("Create Module");
    expect(labels).toContain("Code stack");
    expect(labels.at(-1)).toBe("Assign owner");
  });
});
