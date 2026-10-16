// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UuidV7 } from "@domain-harness/contract";
import Application, { deriveEvidence, loader } from "./application.tsx";

const APP = "01928c7e-5b2a-7c3d-ae4f-a1b2c3d4e5f8";
const STANDARD = "01928c7e-5b2a-7c3d-be4f-a1b2c3d4e5f9";
const OTHER_STANDARD = "01928c7e-5b2a-7c3d-be4f-a1b2c3d4e5fa";
const PROJECT = "01928c7e-5b2a-7c3d-9e4f-a1b2c3d4e5f7";
const TENANT = "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e5f6";
const BUYER = "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e5fb";
const COOKIE = `dh_session=${TENANT}.${"S".repeat(43)}`;

const application = {
  id: APP,
  description: "Expense cards",
  project: { id: PROJECT, name: "Platform" },
  fromFlow: true,
  agentTool: "claude-code",
  createdAt: "2026-10-13T09:00:00.000Z",
};

const slot = { moduleKind: "code-stack", slotKind: "library", name: "React" };

const envelope = (type: string, sequence: number) => ({
  type,
  schemaVersion: "1.0.0",
  catalogVersion: "1.0.0",
  idempotencyKey: `01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e${String(600 + sequence)}`,
  applicationId: APP,
  agentToolName: "claude-code",
  occurredAt: "2026-10-15T12:00:00.000Z",
  sequence,
});

const guidance = { ...envelope("guidance", 1), tool: "code_stack_rule", outcome: "hit", subject: { kind: "slot-token", slotToken: "code-stack/library/React" } };

const openSummary = { standardId: STANDARD, slot, subject: "lodash", status: "open" };
const acceptedSummary = {
  standardId: OTHER_STANDARD,
  slot: { moduleKind: "design-system", slotKind: "color", name: "action" },
  subject: "--color-action",
  status: "accepted",
};

const gateRun = {
  ...envelope("gate_run", 2),
  revision: "abc123",
  verdict: "fail",
  checkedCount: 14,
  openCount: 1,
  deviations: [openSummary, acceptedSummary],
};

const deviation = {
  ...envelope("deviation", 3),
  deviation: {
    standardId: STANDARD,
    standardVersion: 2,
    slot,
    subject: "lodash",
    kind: "prohibited",
    status: "open",
    correction: "Replace lodash with the approved entry in this conflict slot.",
  },
};

const refusal = {
  ...envelope("binding_refusal", 4),
  reason: "missing_identification_file",
  sentence: "unbound Application.",
};

const storedRecord = {
  id: "01928c7e-5b2a-7c3d-ae4f-a1b2c3d4e5fc" as UuidV7,
  applicationId: APP as UuidV7,
  standardId: OTHER_STANDARD as UuidV7,
  standardVersion: 3,
  slot: { moduleKind: "design-system", slotKind: "color", name: "action" },
  subject: "--color-action",
  start: "2026-10-01T00:00:00.000Z",
  end: "2026-12-01T00:00:00.000Z",
  buyer: { accountId: BUYER as UuidV7, name: "Bea Buyer" },
  justification: "known exception",
  alertIntervalHours: 336,
  createdAt: "2026-10-13T09:00:00.000Z",
};

const ok = (value: unknown) => ({ kind: "ok", value });

function renderApplication(evidence: Promise<unknown>, records: Promise<unknown> = Promise.resolve(ok([storedRecord]))) {
  const Stub = createRoutesStub([
    {
      path: "/applications/:applicationId",
      Component: Application,
      loader: () => ({ evidence, records }),
    },
  ]);
  render(<Stub initialEntries={[`/applications/${APP}`]} />);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Application surface", () => {
  it("shows the description, the latest Adherence as text, the verdict and Guidance consultation", async () => {
    renderApplication(Promise.resolve(ok({ application, compilations: [guidance, gateRun, deviation] })));
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe("Expense cards");
    expect(screen.getByText("Adherence 13 of 14 checked Standards on the last Gate run.")).toBeTruthy();
    expect(screen.getByText("Gate run: fail.")).toBeTruthy();
    expect(screen.getByText("Guidance was consulted: yes.")).toBeTruthy();
  });

  it("renders deviation rows with the status word, key fields, the cream-inset Correction and a copyable control", async () => {
    renderApplication(Promise.resolve(ok({ application, compilations: [guidance, gateRun, deviation] })));
    const table = await screen.findByRole("table");
    expect(within(table).getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Status",
      "Standard",
      "Conflict slot",
      "Subject",
      "Record",
    ]);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain("open");
    expect(rows[0]?.textContent).toContain(STANDARD);
    expect(rows[0]?.textContent).toContain("code-stack/library/React");
    expect(rows[0]?.textContent).toContain("lodash");
    expect(rows[0]?.textContent).toContain("Deviation open.");
    const inset = rows[0]?.querySelector(".correction-instruction");
    expect(inset?.textContent).toContain("Replace lodash with the approved entry in this conflict slot.");
    expect(within(rows[0] as HTMLElement).getByRole("button", { name: "Copy" })).toBeTruthy();
    expect(rows[1]?.textContent).toContain("accepted");
    expect(document.body.textContent).not.toMatch(/Builder/);
  });

  it("copies the Correction when the Copy control is activated", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    renderApplication(Promise.resolve(ok({ application, compilations: [gateRun, deviation] })));
    const button = await screen.findByRole("button", { name: "Copy" });
    button.click();
    await screen.findByRole("button", { name: "Copied" });
    expect(writeText).toHaveBeenCalledWith("Replace lodash with the approved entry in this conflict slot.");
  });

  it("links an open row to the pre-filled acceptance form and shows the accepted row's end date and interval", async () => {
    renderApplication(Promise.resolve(ok({ application, compilations: [guidance, gateRun, deviation] })));
    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    const accept = within(rows[0] as HTMLElement).getByRole("link", { name: "Accept this Deviation" });
    const href = accept.getAttribute("href") ?? "";
    expect(href).toContain(`/accepted-deviation?application=${APP}`);
    expect(href).toContain(`standardId=${STANDARD}`);
    expect(href).toContain("slot=code-stack%2Flibrary%2FReact");
    expect(href).toContain("subject=lodash");
    expect(href).toContain("returnTo=");
    expect(within(rows[1] as HTMLElement).queryByRole("link", { name: "Accept this Deviation" })).toBeNull();
    expect(rows[1]?.textContent).toContain("End date 2026-12-01. Alert every 336 hours.");
  });

  it("says Guidance was not consulted when no Guidance Compilation exists", async () => {
    renderApplication(Promise.resolve(ok({ application, compilations: [gateRun] })));
    expect(await screen.findByText("Guidance was consulted: no.")).toBeTruthy();
  });

  it("shows the listed-without-evidence text when there is no Gate run and no Guidance event", async () => {
    renderApplication(Promise.resolve(ok({ application, compilations: [] })));
    expect(await screen.findByText("This Application is listed and has no Guidance event and no Gate run.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows the unbound failure sentence with its recovery when the refusal is the latest evidence", async () => {
    renderApplication(Promise.resolve(ok({ application, compilations: [guidance, gateRun, refusal] })));
    const failure = await screen.findByRole("status");
    expect(failure.textContent).toContain("unbound Application.");
    expect(failure.textContent).toContain("The Project identification file is missing or unreadable");
    expect(failure.textContent).toContain("Restore that file or ask the Buyer to place the Application.");
  });

  it("hides the failure once a later Gate run arrives", async () => {
    renderApplication(Promise.resolve(ok({ application, compilations: [{ ...refusal, sequence: 1 }, guidance, gateRun, deviation] })));
    await screen.findByText("Adherence 13 of 14 checked Standards on the last Gate run.");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says the Compilation did not arrive when the evidence is refused or the registry is down", async () => {
    for (const answer of [
      Promise.resolve({ kind: "unavailable" }),
      Promise.resolve({ kind: "refused", error: { code: "session_invalid", message: "m", subject: "session" } }),
    ]) {
      cleanup();
      renderApplication(answer);
      expect(await screen.findByText("The Compilation did not arrive. Try again in a few minutes.")).toBeTruthy();
      cleanup();
    }
  });

  it("is busy while the evidence loads, and redirects to sign-in without a cookie", async () => {
    const Stub = createRoutesStub([
      { path: "/applications/:applicationId", Component: Application, loader: () => ({ evidence: new Promise(() => undefined), records: new Promise(() => undefined) }) },
    ]);
    render(<Stub initialEntries={[`/applications/${APP}`]} />);
    expect(await screen.findByText("Loading the Application evidence…")).toBeTruthy();
    cleanup();
    const away = loader({ request: new Request(`http://x/applications/${APP}`), params: { applicationId: APP } } as unknown as LoaderFunctionArgs);
    expect((away as Response).headers.get("location")).toBe("/sign-in");
  });
});

describe("/applications/:applicationId loader", () => {
  it("defers GET /v1/applications/:id/evidence with the session", async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ application, compilations: [] }), { status: 200 })));
    vi.stubGlobal("fetch", fetch);
    const result = loader({
      request: new Request(`http://x/applications/${APP}`, { headers: { cookie: COOKIE } }),
      params: { applicationId: APP },
    } as unknown as LoaderFunctionArgs);
    if (result instanceof Response) throw new Error("expected data");
    expect(result.evidence).toBeInstanceOf(Promise);
    expect(await result.evidence).toEqual({ kind: "ok", value: { application, compilations: [] } });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(new RegExp(`/v1/applications/${APP}/evidence$`));
    expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${TENANT}.${"S".repeat(43)}`);
  });
});

describe("deriveEvidence", () => {
  it("joins Corrections by match key and keeps the latest Gate run and refusal by sequence", () => {
    const derived = deriveEvidence([guidance, gateRun, deviation, refusal] as never);
    expect(derived.consulted).toBe(true);
    expect(derived.latest?.sequence).toBe(2);
    expect(derived.rows).toHaveLength(2);
    expect(derived.rows[0]?.correction).toBe("Replace lodash with the approved entry in this conflict slot.");
    expect(derived.rows[1]?.correction).toBeNull();
    expect(derived.refusal?.sequence).toBe(4);
  });
});
