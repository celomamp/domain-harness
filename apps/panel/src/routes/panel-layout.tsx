import { Outlet, redirect, useLoaderData } from "react-router";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { SESSION_INVALID } from "@domain-harness/contract";
import type { Role } from "@domain-harness/contract";
import { PanelChrome } from "../components/panel-chrome.tsx";
import { getSession } from "../registry.server.ts";
import { clearSessionCookie, readSessionToken } from "../session.server.ts";

/**
 * Every panel surface sits under this layout: it requires a live registry
 * session and renders panel-chrome with the session's role.
 */
/** Authenticated pages are never stored by a shared cache or the back-forward cache. */
export const headers: HeadersFunction = () => ({ "Cache-Control": "private, no-store" });

export async function loader({ request }: LoaderFunctionArgs): Promise<Response | { role: Role }> {
  const token = readSessionToken(request);
  if (token === undefined) return redirect("/sign-in");
  const result = await getSession(token);
  if (result.kind === "ok") return { role: result.value.role };
  if (result.kind === "refused" && result.error.code === SESSION_INVALID) {
    return redirect("/sign-in", { headers: { "Set-Cookie": clearSessionCookie(request) } });
  }
  // Any other refusal (a misrouted registry URL answering 404, 405 or 413) or
  // an outage: keep the session and say sign-in is unavailable.
  return redirect("/sign-in?status=unavailable");
}

export default function PanelLayout() {
  const { role } = useLoaderData<typeof loader>();
  return (
    <>
      <PanelChrome role={role} />
      <main className="panel-main">
        <Outlet />
      </main>
    </>
  );
}
