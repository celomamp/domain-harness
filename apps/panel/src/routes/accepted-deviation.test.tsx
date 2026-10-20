// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createRoutesStub, Outlet } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AcceptedDeviationRecord, ApplicationInfo, EffectiveStandardSet, Role, StandardInfo, UuidV7 } from "@domain-harness/contract";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { PanelChrome } from "../components/panel-chrome.tsx";
import AcceptedDeviationPage, { acceptanceStatus, action, loader } from "./accepted-deviation.tsx";

const TENANT = "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e5f6";
const PROJECT = "01928c7e-5b2a-7c3d-9e4f-a1b2c3d4e5f7";
const APP = "01928c7e-5b2a-7c3d-ae4f-a1b2c3d4e5f8";
const STANDARD = "01928c7e-5b2a-7c3d-be4f-a1b2c3d4e5f9";
const RECORDED_ID = "01928c7e-5b2a-7c3d-ae4f-a1b2c3d4e5fa";
const EXPIRED_ID = "01928c7e-5b2a-7c3d-be4f-a1b2c3d4e5fc";
const BUYER_ID = "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e5fb";
const SESSION_TOKEN = `${TENANT}.${"S".repeat(43)}`;
const COOKIE = `dh_session=${SESSION_TOKEN}`;
const UNAVAILABLE = "The Company's data is unavailable right now. Try again in a few minutes.";
const PLAN_REFUSAL = "Recording an Accepted deviation is included in Team (first sale). Nothing was changed.";

const application: ApplicationInfo = {
  id: APP as UuidV7,
  description: "Checkout Web",
  project: { id: PROJECT as UuidV7, name: "Platform" },
  fromFlow: true,
  agentTool: null,
  createdAt: "2026-10-13T09:00:00.000Z",
};

const standard: StandardInfo = {
  id: STANDARD as UuidV7,
  version: 3,
  module: { id: TENANT as UuidV7, kind: "code-stack", name: "Frontend stack" },
  project: { id: PROJECT as UuidV7, name: "Platform" },
  entry: { category: "library", name: "react", versionConstraint: "^18", status: "approved", correctionInstruction: null },
  publishedAt: "2026-10-13T09:00:00.000Z",
  publishedBy: { accountId: BUYER_ID as UuidV7, name: "Sam" },
};

const effectiveSet: EffectiveStandardSet = {
  project: { id: PROJECT as UuidV7, name: "Platform" },
  standards: [
    {
      slot: { moduleKind: "code-stack", slotKind: "library", name: "react" },
      status: "approved",
      standard,
      sourceProject: { id: PROJECT as UuidV7, name: "Platform" },
      locked: false,
    },
  ],
};

const storedRecord: AcceptedDeviationRecord = {
  id: RECORDED_ID as UuidV7,
  applicationId: APP as UuidV7,
  standardId: STANDARD as UuidV7,
  standardVersion: 3,
  slot: { moduleKind: "code-stack", slotKind: "library", name: "react" },
  subject: "lodash",
  start: "2026-10-01T00:00:00.000Z",
  end: "2026-11-01T00:00:00.000Z",
  buyer: { accountId: BUYER_ID as UuidV7, name: "Bea Buyer" },
  justification: "known exception",
  alertIntervalHours: 168,
  createdAt: "2026-10-13T09:00:00.000Z",
};

const ok = (value: unknown) => ({ kind: "ok", value });
const refused = (error: unknown) => ({ kind: "refused", error });

interface Seed {
  readonly role: Role;
  readonly entry?: string;
  readonly applications?: Promise<unknown>;
  readonly effective?: Promise<unknown>;
  readonly records?: Promise<unknown>;
}

function renderPage({ role, entry = "/accepted-deviation", applications = Promise.resolve(ok([application])), effective = Promise.resolve(ok(effectiveSet)), records = Promise.resolve(ok([])) }: Seed) {
  const Layout = () => (
    <PanelChrome role={role}>
      <Outlet />
    </PanelChrome>
  );
  const Stub = createRoutesStub([
    {
      Component: Layout,
      children: [
        {
          path: "/accepted-deviation",
          Component: AcceptedDeviationPage,
          loader: () => ({ applications, effective, records }),
          action: (args: ActionFunctionArgs) =>
            args.request.formData().then((body: FormData) =>
              action({
                ...args,
                request: new Request(args.request.url, {
                  method: "POST",
                  body,
                  headers: { cookie: COOKIE },
                }),
              }),
            ),
        },
      ],
    },
  ]);
  render(<Stub initialEntries={[entry]} />);
}

const must = (selector: string): Element => {
  const element = document.querySelector(selector);
  if (element === null) expect.fail(`missing element ${selector}`);
  return element;
};

const input = (selector: string): HTMLInputElement => must(selector) as HTMLInputElement;
const select = (selector: string): HTMLSelectElement => must(selector) as HTMLSelectElement;
const applicationSelect = (): HTMLSelectElement => select("#accepted-deviation-applicationId");
const standardField = (): HTMLInputElement => input("#accepted-deviation-standardId");
const slotField = (): HTMLInputElement => input("#accepted-deviation-slot");
const subjectField = (): HTMLInputElement => input("#accepted-deviation-subject");
const pasteArea = (): HTMLTextAreaElement => must("#accepted-deviation-ci-line") as HTMLTextAreaElement;

/** Waits until the Application select is populated (the stub's first render is asynchronous). */
const applicationLoaded = async (): Promise<void> =>
  waitFor(() => {
    const option = [...applicationSelect().options].find((o) => o.value === APP);
    expect(option).toBeTruthy();
  });

const status = (): HTMLElement => {
  const region = document.querySelector<HTMLElement>(".page-status");
  if (region === null) expect.fail("the page's status region is missing");
  return region;
};

interface SubmitInput {
  readonly standardId?: string;
  readonly slot?: string;
  readonly subject?: string;
  readonly justification?: string;
  readonly start?: string;
  readonly end?: string;
  readonly interval?: string;
}

/** Fill the form (and wait for the pieces to mount) and submit it. */
async function submit(input: SubmitInput = {}): Promise<void> {
  await applicationLoaded();
  fireEvent.change(applicationSelect(), { target: { value: APP } });
  fireEvent.change(standardField(), { target: { value: input.standardId ?? STANDARD } });
  fireEvent.change(slotField(), { target: { value: input.slot ?? "code-stack/library/react" } });
  fireEvent.change(subjectField(), { target: { value: input.subject ?? "lodash" } });
  fireEvent.change(must("#accepted-deviation-justification"), {
    target: { value: input.justification ?? "known exception" },
  });
  fireEvent.change(must("#accepted-deviation-start"), { target: { value: input.start ?? "2026-10-01" } });
  fireEvent.change(must("#accepted-deviation-end"), { target: { value: input.end ?? "2026-11-01" } });
  fireEvent.change(must("#accepted-deviation-alertIntervalHours"), {
    target: { value: input.interval ?? "168" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Record Accepted deviation" }));
}

/** A stubbed global fetch that answers the record POST (`registry.server.ts`'s only fetch from the action). */
function stubRecordFetch(answer: () => { status: number; body: unknown } = () => ({ status: 500, body: {} })): ReturnType<typeof vi.fn> {
  const fetch = vi.fn(() => {
    const { status, body } = answer();
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Accepted-deviation page (cold load)", () => {
  it("shows the heading, the nav entry, the paste area, the acceptance form and the empty records section", async () => {
    renderPage({ role: "Buyer" });
    await applicationLoaded();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Accepted deviation");
    expect(screen.getByRole("link", { name: "Accepted deviation" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("Stored acceptances")).toBeTruthy();
    await screen.findByText("No Accepted deviation is recorded yet.");
    expect(screen.getByText("Stored: Buyer, justification, start, end, match key.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Record Accepted deviation" }).className).toBe("button-primary");
  });

  it("lists the stored records as cards with every stored field (Application, Standard + version, window, alert interval, recorded by, justification)", async () => {
    renderPage({ role: "Buyer", records: Promise.resolve(ok([storedRecord])) });
    await screen.findByText("lodash");
    // The Application is named and links to its evidence page.
    const card = screen.getByRole("article", { name: "lodash" });
    expect(within(card).getByRole("link", { name: "Checkout Web" }).getAttribute("href")).toBe(`/applications/${APP}`);
    expect(screen.getByText(STANDARD)).toBeTruthy();
    expect(screen.getByText("Version 3")).toBeTruthy();
    expect(screen.getByText("01 Oct 2026 to 01 Nov 2026")).toBeTruthy();
    expect(screen.getByText("168 hours")).toBeTruthy();
    expect(screen.getByText("Bea Buyer")).toBeTruthy();
    expect(screen.getByText("known exception")).toBeTruthy();
  });

  it("shows the Application id on a card when the Applications are unavailable", async () => {
    renderPage({
      role: "Buyer",
      applications: Promise.resolve({ kind: "unavailable" }),
      records: Promise.resolve(ok([storedRecord])),
    });
    await screen.findByText("lodash");
    expect(screen.getByText(APP)).toBeTruthy();
  });

  it("renders stored acceptances as cards with an Active or Expired badge computed from the end", async () => {
    const active = { ...storedRecord, end: new Date(Date.now() + 86_400_000).toISOString() };
    const expired = { ...storedRecord, id: EXPIRED_ID as UuidV7, end: new Date(Date.now() - 1000).toISOString() };
    renderPage({ role: "Buyer", records: Promise.resolve(ok([active, expired])) });
    expect(await screen.findByText("Stored acceptances")).toBeTruthy();
    expect(await screen.findByText("Active")).toBeTruthy();
    expect(screen.getByText("Expired")).toBeTruthy();
  });

  it("shows the plan refusal on a Community tenant's cold load, naming Team (first sale), with no outage copy", async () => {
    // Community is a tenant plan, not a role: any role's cold load streams it.
    renderPage({
      role: "Buyer",
      records: Promise.resolve(refused({ code: "plan_refused", message: "m", subject: "plan" })),
    });
    await waitFor(() => {
      expect(must(".plan-refusal").textContent).toBe(PLAN_REFUSAL);
    });
    expect(must(".plan-refusal").textContent).not.toMatch(/\$|€|£|price/i);
    // The refusal is not the generic outage copy, and not a submitted denial.
    expect(screen.queryByText(UNAVAILABLE)).toBeNull();
    expect(status().querySelector("p.denial")).toBeNull();
    // The refusal names the plan in place, with no submit attached to it.
    expect(must(".plan-refusal-region").querySelector("button")).toBeNull();
  });

  it("shows the unavailable text when the Company data cannot be read", async () => {
    renderPage({ role: "Buyer", applications: Promise.resolve({ kind: "unavailable" }) });
    await waitFor(() => {
      expect(screen.getAllByText(UNAVAILABLE).length).toBeGreaterThan(0);
    });
  });
});

describe("the loader (no Application selected vs a real outage)", () => {
  it("answers effective: null — not an unavailable result — when no Application is selected", async () => {
    const fetch = vi.fn((url: string | URL) => {
      const body = String(url).endsWith("/accepted-deviations") ? { records: [storedRecord] } : { applications: [application] };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetch);
    const args = { request: new Request("http://panel.test/accepted-deviation", { headers: { cookie: COOKIE } }) } as unknown as LoaderFunctionArgs;
    const response = loader(args);
    if (response instanceof Response) throw new Error("unexpected redirect");
    const data = response;
    expect(await data.applications).toEqual(ok([application]));
    expect(await data.effective).toBeNull();
    // The route's other stream still reads through the real registry client.
    expect(await data.records).toEqual(ok([storedRecord]));
  });

  it("answers effective as an unavailable stream only when an Application is selected and the registry fails", async () => {
    const fetch = vi.fn((url: string | URL) => {
      if (String(url).includes("/effective-standards")) {
        return Promise.resolve(new Response(JSON.stringify({}), { status: 500 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ applications: [application] }), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetch);
    const args = {
      request: new Request(`http://panel.test/accepted-deviation?application=${APP}`, { headers: { cookie: COOKIE } }),
    } as unknown as LoaderFunctionArgs;
    const response = loader(args);
    if (response instanceof Response) throw new Error("unexpected redirect outage");
    expect(await response.applications).toEqual(ok([application]));
    expect(await response.effective).toEqual({ kind: "unavailable" });
  });
});

describe("the paste area", () => {
  it("pre-fills the Standard id, the Conflict slot and the subject from a CI Gate line", async () => {
    const fetch = stubRecordFetch();
    renderPage({ role: "Buyer" });
    await applicationLoaded();
    fireEvent.change(pasteArea(), {
      target: { value: `${STANDARD} code-stack/library/react lodash: Use the approved library instead.` },
    });
    fireEvent.click(screen.getByRole("button", { name: "Use this line" }));
    expect(standardField().value).toBe(STANDARD);
    expect(slotField().value).toBe("code-stack/library/react");
    expect(subjectField().value).toBe("lodash");
    expect(document.querySelector("#accepted-deviation-ci-line-error")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("pre-fills a slot whose name carries slashes, and the panel's own resolver accepts the remainder", async () => {
    const fetch = stubRecordFetch(() => ({ status: 201, body: storedRecord }));
    const slugSet: EffectiveStandardSet = {
      project: { id: PROJECT as UuidV7, name: "Platform" },
      standards: [
        {
          slot: { moduleKind: "code-stack", slotKind: "library", name: "libs/react/dom" },
          status: "approved",
          standard,
          sourceProject: { id: PROJECT as UuidV7, name: "Platform" },
          locked: false,
        },
      ],
    };
    renderPage({ role: "Buyer", effective: Promise.resolve(ok(slugSet)) });
    await applicationLoaded();
    fireEvent.change(pasteArea(), {
      target: { value: `${STANDARD} code-stack/library/libs/react/dom lodash: Use the approved library instead.` },
    });
    fireEvent.click(screen.getByRole("button", { name: "Use this line" }));
    expect(standardField().value).toBe(STANDARD);
    expect(slotField().value).toBe("code-stack/library/libs/react/dom");
    expect(subjectField().value).toBe("lodash");
    expect(document.querySelector("#accepted-deviation-ci-line-error")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    // The panel's own ink accepts the pre-filled slot (the remainder split).
    await screen.findByText("Resolved Standard version 3 in the Application's Effective Standard set.");
    // Submit without touching the pasted fields: only the rest is filled.
    fireEvent.change(applicationSelect(), { target: { value: APP } });
    fireEvent.change(must("#accepted-deviation-justification"), { target: { value: "known exception" } });
    fireEvent.change(must("#accepted-deviation-start"), { target: { value: "2026-10-01" } });
    fireEvent.change(must("#accepted-deviation-end"), { target: { value: "2026-11-01" } });
    fireEvent.change(must("#accepted-deviation-alertIntervalHours"), { target: { value: "168" } });
    fireEvent.click(screen.getByRole("button", { name: "Record Accepted deviation" }));
    await waitFor(() => {
      expect(status().textContent).toContain("Recorded the Accepted deviation for lodash.");
    });
    expect(document.querySelector("#accepted-deviation-slot-error")).toBeNull();
  });

  it("leaves the fields untouched and shows the paste ink for a line the grammar rejects, sending nothing", async () => {
    const fetch = stubRecordFetch();
    renderPage({ role: "Buyer" });
    await applicationLoaded();
    fireEvent.change(pasteArea(), { target: { value: "not a deviation line" } });
    fireEvent.click(screen.getByRole("button", { name: "Use this line" }));
    expect(standardField().value).toBe("");
    expect(slotField().value).toBe("");
    expect(subjectField().value).toBe("");
    expect(must("#accepted-deviation-ci-line-error").textContent).toBe(
      "That line is not a Gate Deviation line. Nothing is filled; enter the match key by hand.",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("puts the paste area first and shows the parsed match key", async () => {
    renderPage({ role: "Buyer" });
    await applicationLoaded();
    const paste = screen.getByLabelText("CI Gate deviation log line");
    // The paste area precedes the manual match-key fields.
    expect(paste.compareDocumentPosition(standardField()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.change(paste, {
      target: { value: `${STANDARD} code-stack/library/react lodash: Use the approved library instead.` },
    });
    fireEvent.click(screen.getByRole("button", { name: "Use this line" }));
    // The parsed preview chips carry the match key.
    expect(screen.getByText(STANDARD)).toBeTruthy();
    expect(screen.getByText("code-stack/library/react")).toBeTruthy();
    expect(screen.getByText("lodash")).toBeTruthy();
    expect(standardField().value).toBe(STANDARD);
    expect(slotField().value).toBe("code-stack/library/react");
    expect(subjectField().value).toBe("lodash");
  });
});

describe("acceptanceStatus", () => {
  it("is active before the exclusive end and expired at or after it", () => {
    const record = { ...storedRecord, end: "2026-11-01T00:00:00.000Z" };
    expect(acceptanceStatus(record, Date.parse("2026-10-31T23:59:59.999Z"))).toBe("active");
    expect(acceptanceStatus(record, Date.parse("2026-11-01T00:00:00.000Z"))).toBe("expired");
    expect(acceptanceStatus(record, Date.parse("2026-11-02T00:00:00.000Z"))).toBe("expired");
  });
});

describe("the resolved Standard version", () => {
  it("shows the version resolved from the chosen Application's Effective Standard set", async () => {
    renderPage({ role: "Buyer" });
    await applicationLoaded();
    fireEvent.change(standardField(), { target: { value: STANDARD } });
    fireEvent.change(slotField(), { target: { value: "code-stack/library/react" } });
    await screen.findByText("Resolved Standard version 3 in the Application's Effective Standard set.");
  });

  it("re-spells the slot name case- and whitespace-insensitively, like the slot rule", async () => {
    renderPage({ role: "Buyer" });
    await applicationLoaded();
    fireEvent.change(standardField(), { target: { value: STANDARD } });
    fireEvent.change(slotField(), { target: { value: "code-stack/library/  React " } });
    await screen.findByText("Resolved Standard version 3 in the Application's Effective Standard set.");
  });

  it("shows the no-matching hint for a key nothing in the set carries", async () => {
    renderPage({ role: "Buyer" });
    await applicationLoaded();
    fireEvent.change(standardField(), { target: { value: STANDARD } });
    fireEvent.change(slotField(), { target: { value: "code-stack/library/vue" } });
    await screen.findByText("No matching Standard in this Application's Effective Standard set.");
    expect(screen.queryByText(/Resolved Standard version/)).toBeNull();
  });

  it("shows nothing in the resolved area on an unselected cold load (distinct from a real outage)", async () => {
    // No `?application=` param: the loader answers no Effective set at all.
    renderPage({ role: "Buyer", effective: Promise.resolve(null) });
    await applicationLoaded();
    // A paste fills the match key before any Application is chosen.
    fireEvent.change(pasteArea(), {
      target: { value: `${STANDARD} code-stack/library/react lodash: Use the approved library instead.` },
    });
    fireEvent.click(screen.getByRole("button", { name: "Use this line" }));
    await waitFor(() => {
      expect(standardField().value).toBe(STANDARD);
    });
    expect(screen.queryByText(UNAVAILABLE)).toBeNull();
    expect(screen.queryByText(/Resolved Standard version/)).toBeNull();
  });

  it("still shows the unavailable copy in the resolved area for a true registry outage", async () => {
    renderPage({ role: "Buyer", effective: Promise.resolve({ kind: "unavailable" }) });
    await applicationLoaded();
    fireEvent.change(standardField(), { target: { value: STANDARD } });
    fireEvent.change(slotField(), { target: { value: "code-stack/library/react" } });
    await screen.findByText(UNAVAILABLE);
  });
});

describe("submitting the acceptance form", () => {
  it("records the acceptance: a success notice with the stored record's subject", async () => {
    stubRecordFetch(() => ({ status: 201, body: storedRecord }));
    renderPage({ role: "Buyer" });
    await submit();
    await waitFor(() => {
      expect(status().textContent).toContain("Recorded the Accepted deviation for lodash.");
    });
    expect(status().querySelector("p.denial")).toBeNull();
  });

  it("names the end field and keeps every value on an end at its start, and nothing is sent", async () => {
    const fetch = stubRecordFetch();
    renderPage({ role: "Buyer" });
    await submit({ start: "2026-11-01", end: "2026-10-01" });
    await waitFor(() => {
      expect(must("#accepted-deviation-end-error").textContent).toBe(
        "An end before the start is not recorded. The record is unwritten.",
      );
    });
    expect((must("#accepted-deviation-end") as HTMLInputElement).value).toBe("2026-10-01");
    expect((must("#accepted-deviation-start") as HTMLInputElement).value).toBe("2026-11-01");
    expect(subjectField().value).toBe("lodash");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("announces the Builder denial for a non-Buyer's submit, keeping the values", async () => {
    stubRecordFetch(() => ({ status: 403, body: { code: "role_denied", message: "m", subject: "role" } }));
    renderPage({ role: "Builder" });
    await submit({ subject: "old subject" });
    await waitFor(() => {
      expect(status().querySelector("p.denial")?.textContent).toBe(
        "A Builder cannot accept their own Deviation. The Buyer records the acceptance.",
      );
    });
    expect(subjectField().value).toBe("old subject");
  });

  it("shows the Community plan refusal in place, naming Team (first sale) and never a price", async () => {
    stubRecordFetch(() => ({ status: 403, body: { code: "plan_refused", message: "m", subject: "plan" } }));
    renderPage({ role: "Buyer", effective: Promise.resolve(refused({ code: "plan_refused", message: "m", subject: "plan" })) });
    await submit();
    await waitFor(() => {
      expect(must(".plan-refusal").textContent).toBe(PLAN_REFUSAL);
      expect(must(".plan-refusal").textContent).not.toMatch(/\$|€|£|price/i);
    });
    expect(status().querySelector("p.denial")).toBeNull();
  });

  it("keeps the values through the plan refusal too", async () => {
    stubRecordFetch(() => ({ status: 403, body: { code: "plan_refused", message: "m", subject: "plan" } }));
    renderPage({ role: "Buyer" });
    await submit({ subject: "old subject" });
    await waitFor(() => {
      expect(must(".plan-refusal")).toBeTruthy();
    });
    expect(subjectField().value).toBe("old subject");
    expect(must("#accepted-deviation-start").getAttribute("value")).toBe("2026-10-01");
  });

  it("answers the unknown-Application denial without changing the form", async () => {
    stubRecordFetch(() => ({ status: 404, body: { code: "application_not_found", message: "m", subject: "applicationId" } }));
    renderPage({ role: "Buyer" });
    await submit();
    await waitFor(() => {
      expect(status().querySelector("p.denial")?.textContent).toBe(
        "That Application was not found. Nothing was recorded.",
      );
    });
  });

  it("answers an outage with the action-unavailable denial", async () => {
    stubRecordFetch(() => ({ status: 500, body: {} }));
    renderPage({ role: "Buyer" });
    await submit();
    await waitFor(() => {
      expect(status().querySelector("p.denial")?.textContent).toBe(
        "The surface is unavailable right now, so nothing was recorded. Try again in a few minutes.",
      );
    });
  });

  it("answers the out-of-range interval with the interval ink and sends nothing", async () => {
    const fetch = stubRecordFetch();
    renderPage({ role: "Buyer" });
    await submit({ interval: "8761" });
    await waitFor(() => {
      expect(must("#accepted-deviation-alertIntervalHours-error").textContent).toBe(
        "Enter an integer from 1 to 8760 hours. Nothing was recorded.",
      );
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("answers a malformed slot text with the slot ink and sends nothing", async () => {
    const fetch = stubRecordFetch();
    renderPage({ role: "Buyer" });
    await submit({ slot: "code-stack/library" });
    await waitFor(() => {
      expect(must("#accepted-deviation-slot-error").textContent).toBeTruthy();
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("maps the registry's field refusals to the same ink (a trimmed-empty justification slipping through)", async () => {
    stubRecordFetch(() => ({ status: 400, body: { code: "invalid_input", message: "m", subject: "justification" } }));
    renderPage({ role: "Buyer" });
    await submit({ justification: "  " });
    await waitFor(() => {
      expect(must("#accepted-deviation-justification-error").textContent).toBe(
        "Enter a justification of 1 or more characters. Nothing was recorded.",
      );
    });
  });
});

describe("accepting from an Application deviation row", () => {
  const slotText = "code-stack/library/react";
  const returnTo = `/applications/${APP}#deviation-row-0`;
  const entry = `/accepted-deviation?application=${APP}&standardId=${STANDARD}&slot=${encodeURIComponent(slotText)}&subject=lodash&returnTo=${encodeURIComponent(returnTo)}`;

  function renderWithReturn() {
    const Stub = createRoutesStub([
      {
        path: "/accepted-deviation",
        Component: AcceptedDeviationPage,
        loader: () => ({
          applications: Promise.resolve(ok([application])),
          effective: Promise.resolve(ok(effectiveSet)),
          records: Promise.resolve(ok([])),
        }),
      },
      { path: "/applications/:applicationId", Component: () => <p>Application evidence marker</p> },
    ]);
    render(<Stub initialEntries={[entry]} />);
  }

  it("pre-fills the Application and the match key from the row", async () => {
    renderWithReturn();
    await waitFor(() => {
      expect((must("#accepted-deviation-applicationId") as HTMLSelectElement).value).toBe(APP);
    });
    expect((must("#accepted-deviation-standardId") as HTMLInputElement).value).toBe(STANDARD);
    expect((must("#accepted-deviation-slot") as HTMLInputElement).value).toBe(slotText);
    expect((must("#accepted-deviation-subject") as HTMLInputElement).value).toBe("lodash");
  });

  it("offers the way back, and Esc returns to the row", async () => {
    renderWithReturn();
    await waitFor(() => {
      expect((must("#accepted-deviation-applicationId") as HTMLSelectElement).value).toBe(APP);
    });
    expect(screen.getByRole("link", { name: "Back to Application evidence" }).getAttribute("href")).toBe(returnTo);
    fireEvent.keyDown(window, { key: "Escape" });
    await screen.findByText("Application evidence marker");
  });
});
