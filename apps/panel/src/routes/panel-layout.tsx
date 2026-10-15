import { Outlet, redirect, useLoaderData } from "react-router";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { SESSION_INVALID } from "@domain-harness/contract";
import type { Role } from "@domain-harness/contract";
import { AcceptedDeviationAlertBand } from "../components/accepted-deviation-alert-band.tsx";
import { PanelChrome } from "../components/panel-chrome.tsx";
import { getAcceptedDeviationAlerts, getSession } from "../registry.server.ts";
import type { RegistryResult } from "../registry.server.ts";
import type { AcceptedDeviationAlert } from "@domain-harness/contract";
import { clearSessionCookie, readSessionToken } from "../session.server.ts";

/**
 * Every panel surface sits under this layout: it requires a live registry
 * session and renders panel-chrome with the session's role, plus the Buyer's
 * Accepted-deviation alerts streamed in beside it, so a slow alert read never
 * holds a page back and an alert outage cannot break one.
 */
/** Authenticated pages are never stored by a shared cache or the back-forward cache. */
export const headers: HeadersFunction = () => ({ "Cache-Control": "private, no-store" });

export async function loader({
  request,
}: LoaderFunctionArgs): Promise<
  Response | { role: Role; alerts: Promise<RegistryResult<AcceptedDeviationAlert[]>> }
> {
  const token = readSessionToken(request);
  if (token === undefined) return redirect("/sign-in");
  const result = await getSession(token);
  if (result.kind === "ok") {
    // Only the Buyer's sessions stream the band's read: any other role renders
    // no band, so the layer never calls the registry for a result that would
    // be thrown away. Unavailable or refused results render nothing anyway.
    const { role } = result.value;
    return {
      role,
      alerts:
        role === "Buyer"
          ? getAcceptedDeviationAlerts(token)
          : Promise.resolve({ kind: "ok", value: [] } as RegistryResult<AcceptedDeviationAlert[]>),
    };
  }
  if (result.kind === "refused" && result.error.code === SESSION_INVALID) {
    return redirect("/sign-in", { headers: { "Set-Cookie": clearSessionCookie(request) } });
  }
  // Any other refusal (a misrouted registry URL answering 404, 405 or 413) or
  // an outage: keep the session and say sign-in is unavailable.
  return redirect("/sign-in?status=unavailable");
}

export default function PanelLayout() {
  const { role, alerts } = useLoaderData<typeof loader>();
  return (
    <>
      <PanelChrome role={role} />
      <AcceptedDeviationAlertBand role={role} alerts={alerts} />
      <main className="panel-main">
        <Outlet />
      </main>
    </>
  );
}
