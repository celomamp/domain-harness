// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRoutesStub, useLoaderData } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import type { AcceptedDeviationAlert, Role, UuidV7 } from "@domain-harness/contract";
import type { RegistryResult } from "../registry.server.ts";
import { ACCEPTED_DEVIATION_ALERT_COPY, AcceptedDeviationAlertBand } from "./accepted-deviation-alert-band.tsx";

afterEach(() => {
  cleanup();
});

const alertOne: AcceptedDeviationAlert = {
  id: "018f3d2a-7000-7000-8000-00000000000b" as UuidV7,
  acceptanceId: "018f3d2a-7000-7000-8000-00000000000c" as UuidV7,
  applicationId: "018f3d2a-7000-7000-8000-000000000001" as UuidV7,
  applicationName: "Expense cards",
  standardId: "018f3d2a-7000-7000-8000-000000000002" as UuidV7,
  standardVersion: 1,
  slot: { moduleKind: "code-stack", slotKind: "library", name: "React" },
  subject: "React",
  end: "2026-12-01T00:00:00.000Z",
  dueAt: "2026-10-14T09:00:00.000Z",
  raisedAt: "2026-10-14T09:00:01.000Z",
};

const alertTwo: AcceptedDeviationAlert = {
  ...alertOne,
  id: "018f3d2a-7000-7000-8000-00000000000d" as UuidV7,
  applicationName: "Checkout Web",
  dueAt: "2026-10-15T09:00:00.000Z",
};

type Alerts = Promise<RegistryResult<AcceptedDeviationAlert[]>>;

const ok = (alerts: AcceptedDeviationAlert[]): Alerts =>
  Promise.resolve({ kind: "ok", value: alerts } as RegistryResult<AcceptedDeviationAlert[]>);
const refused: Alerts = Promise.resolve({
  kind: "refused",
  error: { code: "role_denied", message: "m", subject: "alertId" },
});
const unavailable: Alerts = Promise.resolve({ kind: "unavailable" });

/** What the dismissals were posted with. */
let posted: { alertId: string }[] = [];
let verdict: boolean;
let dismissCount = 0;

interface LayoutHarnessOptions {
  readonly role: Role;
  readonly alerts: Alerts | undefined;
  /** The alerts the loader serves after the dismissals' revalidation. */
  readonly revalidated?: Alerts;
}

function renderBand(options: LayoutHarnessOptions) {
  cleanup();
  posted = [];
  verdict = true;
  dismissCount = 0;
  let round = 0;
  const nextAlerts = (): Alerts => {
    round += 1;
    return round > 1 && options.revalidated !== undefined ? options.revalidated : (options.alerts ?? ok([]));
  };
  const Stub = createRoutesStub([
    {
      path: "/accepted-deviation-alerts/dismissals",
      action: async ({ request }: { request: Request }) => {
        dismissCount += 1;
        const alertId = (await request.formData()).get("alertId");
        posted.push({ alertId: typeof alertId === "string" ? alertId : "" });
        return { ok: verdict };
      },
    },
    {
      path: "/inventory",
      Component: function BandLayout() {
        const { role, alerts } = useLoaderData<{ role: Role; alerts: Alerts }>();
        return (
          <>
            <AcceptedDeviationAlertBand role={role} alerts={alerts} />
            <main>page behind</main>
          </>
        );
      },
      loader: () => ({ role: options.role, alerts: nextAlerts() }),
    },
  ]);
  render(<Stub initialEntries={["/inventory"]} />);
}

describe("accepted-deviation-alert band", () => {
  it("renders the exact band line for one live alert", async () => {
    renderBand({ role: "Buyer", alerts: ok([alertOne]) });
    expect((await screen.findByRole("status")).className).toBe("accepted-deviation-alert");
    expect(await screen.findByText(ACCEPTED_DEVIATION_ALERT_COPY.line(alertOne))).toBeTruthy();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy();
  });

  it("renders one band per live alert", async () => {
    renderBand({ role: "Buyer", alerts: ok([alertOne, alertTwo]) });
    expect(await screen.findByText(ACCEPTED_DEVIATION_ALERT_COPY.line(alertTwo))).toBeTruthy();
    expect(await screen.findByText(ACCEPTED_DEVIATION_ALERT_COPY.line(alertOne))).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Dismiss" })).toHaveLength(2);
  });

  it("renders nothing when the alert read is empty, refused or unavailable", async () => {
    for (const alerts of [ok([]), refused, unavailable]) {
      renderBand({ role: "Buyer", alerts });
      await screen.findByText("page behind");
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 20);
      });
      expect(screen.queryByRole("status")).toBeNull();
      expect(screen.queryAllByRole("button", { name: "Dismiss" })).toHaveLength(0);
      // Not even the wrapper's spacing: no dead space under panel-chrome.
      expect(document.querySelector(".accepted-deviation-alert-band")).toBeNull();
    }
  });

  it("renders no band for a non-Buyer session", async () => {
    for (const role of ["Builder", "Standard owner"] as const) {
      renderBand({ role, alerts: ok([alertOne, alertTwo]) });
      await screen.findByText("page behind");
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 20);
      });
      expect(screen.queryByRole("status")).toBeNull();
      expect(screen.queryAllByRole("button", { name: "Dismiss" })).toHaveLength(0);
      cleanup();
    }
  });

  it("dismisses once through the resource route and drops the band after the revalidation", async () => {
    renderBand({ role: "Buyer", alerts: ok([alertOne]), revalidated: ok([]) });
    fireEvent.click(await screen.findByRole("button", { name: "Dismiss" }));
    await waitFor(() => {
      expect(dismissCount).toBe(1);
    });
    expect(posted).toEqual([{ alertId: alertOne.id }]);
    // The revalidation answers an empty list: the band is gone.
    await waitFor(() => {
      expect(screen.queryByRole("status")).toBeNull();
    });
    expect(screen.queryAllByRole("button", { name: "Dismiss" })).toHaveLength(0);
    // A second click is impossible (the band is gone; exactly one POST).
    expect(dismissCount).toBe(1);
  });

  it("keeps the band and shows the failure status when the dismissal is refused", async () => {
    // The refusal wrote nothing, so the revalidation serves the same list.
    renderBand({ role: "Buyer", alerts: ok([alertOne]), revalidated: ok([alertOne]) });
    verdict = false;
    fireEvent.click(await screen.findByRole("button", { name: "Dismiss" }));
    expect(await screen.findByText(ACCEPTED_DEVIATION_ALERT_COPY.failure)).toBeTruthy();
    // The band keeps its last state; the page behind is untouched.
    expect(await screen.findByText(ACCEPTED_DEVIATION_ALERT_COPY.line(alertOne))).toBeTruthy();
    expect(screen.getByText("page behind")).toBeTruthy();
  });

  it("clears the failure status when a later dismissal succeeds", async () => {
    // Two refusals, then the same dismissal accepted: the failure status goes
    // away and the band keeps its last state (the registry still serves it —
    // a refusal writes nothing, so round 2 revalidates to the same list).
    renderBand({ role: "Buyer", alerts: ok([alertOne]), revalidated: ok([alertOne]) });
    verdict = false;
    fireEvent.click(await screen.findByRole("button", { name: "Dismiss" }));
    expect(await screen.findByText(ACCEPTED_DEVIATION_ALERT_COPY.failure)).toBeTruthy();
    verdict = true;
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => {
      expect(screen.queryByText(ACCEPTED_DEVIATION_ALERT_COPY.failure)).toBeNull();
    });
    // The band stays: the accepted dismissal removed one row but this stub's
    // revalidated list is pinned, so only the failure status is cleared.
    expect(screen.getByText(ACCEPTED_DEVIATION_ALERT_COPY.line(alertOne))).toBeTruthy();
    expect(dismissCount).toBe(2);
    expect(posted).toEqual([{ alertId: alertOne.id }, { alertId: alertOne.id }]);
  });
});
