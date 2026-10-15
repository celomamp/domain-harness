import { Suspense, useEffect, useRef, useState } from "react";
import { Await, useFetcher, useRevalidator } from "react-router";
import type { AcceptedDeviationAlert } from "@domain-harness/contract";
import type { Role } from "@domain-harness/contract";
import type { RegistryResult } from "../registry.server.ts";
import { Button } from "./button.tsx";

/**
 * The Accepted-deviation-alert band (UX-DR17): the gold band under
 * panel-chrome that names the Application, the Standard and the acceptance's
 * end date, and carries the one Dismiss control. It is a live status whose
 * content stands still: no rule of this component ever animates or
 * transitions. Only the Buyer sees bands; every other session renders
 * nothing.
 */
export const ACCEPTED_DEVIATION_ALERT_COPY = {
  /** `Application <description>. Standard <id>. End date <YYYY-MM-DD>.` */
  line: (alert: AcceptedDeviationAlert) =>
    `Application ${alert.applicationName}. Standard ${alert.standardId}. End date ${alert.end.slice(0, 10)}.`,
  dismiss: "Dismiss",
  /** A refused dismissal: the band keeps its last state and a status says so. */
  failure:
    "The Accepted-deviation alert was not dismissed; it stays raised. Try again in a few minutes.",
} as const;

interface BandProps {
  readonly alert: AcceptedDeviationAlert;
  readonly onFailure: () => void;
  readonly onDismissed: () => void;
}

/**
 * One band. The dismissal is a fetcher POST to the dedicated resource route,
 * so the current page never navigates; a completed dismissal revalidates the
 * routers (the band's list comes from the layout's streamed loader) and
 * reports the success, and a refusal keeps the band and announces the failure
 * as a status.
 */
function Band({ alert, onFailure, onDismissed }: BandProps) {
  const fetcher = useFetcher<{ readonly ok: boolean }>();
  const revalidator = useRevalidator();
  const handled = useRef<unknown>(null);

  useEffect(() => {
    if (fetcher.state !== "idle" || fetcher.data === undefined || handled.current === fetcher.data) return;
    handled.current = fetcher.data;
    if (fetcher.data.ok) {
      onDismissed();
      void revalidator.revalidate();
    } else {
      onFailure();
    }
  }, [fetcher.state, fetcher.data, revalidator, onFailure, onDismissed]);

  return (
    <div className="accepted-deviation-alert" role="status">
      <p className="accepted-deviation-alert__line">{ACCEPTED_DEVIATION_ALERT_COPY.line(alert)}</p>
      <fetcher.Form method="post" action="/accepted-deviation-alerts/dismissals">
        <input type="hidden" name="alertId" value={alert.id} />
        <Button variant="inverse" type="submit">
          {ACCEPTED_DEVIATION_ALERT_COPY.dismiss}
        </Button>
      </fetcher.Form>
    </div>
  );
}

export interface AcceptedDeviationAlertBandProps {
  /** The layout's role: only the Buyer renders bands. */
  readonly role: Role;
  /** The streamed alerts result: `null` bands while pending, refused or empty. */
  readonly alerts: Promise<RegistryResult<AcceptedDeviationAlert[]>>;
}

/** The streamed list of bands, or the failure status under them. */
export function AcceptedDeviationAlertBand({ role, alerts }: AcceptedDeviationAlertBandProps) {
  if (role !== "Buyer") return null;
  return (
    <Suspense fallback={null}>
      <Await resolve={alerts} errorElement={null}>
        {(result: RegistryResult<AcceptedDeviationAlert[]>) => <Bands result={result} />}
      </Await>
    </Suspense>
  );
}

/**
 * The resolved list's wrapper: nothing at all — not even the wrapper's
 * spacing — when the read is unavailable, refused or empty, so a Buyer page
 * without alert bands shows no dead space under panel-chrome.
 */
function Bands({ result }: { result: RegistryResult<AcceptedDeviationAlert[]> }) {
  const [failure, setFailure] = useState(false);
  // Unavailable, refused or empty: no band — a page never waits for it.
  if (result.kind !== "ok" || result.value.length === 0) return null;
  return (
    <div className="accepted-deviation-alert-band">
      {result.value.map((alert) => (
        <Band
          key={alert.id}
          alert={alert}
          onFailure={() => {
            setFailure(true);
          }}
          onDismissed={() => {
            setFailure(false);
          }}
        />
      ))}
      {failure ? (
        <p className="accepted-deviation-alert-band__status status-text" role="status">
          {ACCEPTED_DEVIATION_ALERT_COPY.failure}
        </p>
      ) : null}
    </div>
  );
}
