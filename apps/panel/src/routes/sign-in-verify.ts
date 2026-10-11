import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { createSession } from "../registry.server.ts";
import { sessionCookie } from "../session.server.ts";

// The token travels in this URL once; the redirect drops it from the address
// bar and no referrer carries it onward.
const NO_REFERRER = { "Referrer-Policy": "no-referrer", "Cache-Control": "no-store" };

/**
 * Opening the emailed link consumes it (single use is enforced by the
 * registry), sets the session cookie and lands on Inventory. A used, expired
 * or malformed link returns to sign-in with a denial; an unreachable registry
 * returns to sign-in saying sign-in is unavailable.
 */
export async function loader({ request }: LoaderFunctionArgs): Promise<Response> {
  const token = new URL(request.url).searchParams.get("token");
  if (token === null || token === "") {
    return redirect("/sign-in?status=link-invalid", { headers: NO_REFERRER });
  }
  const result = await createSession(token);
  if (result.kind === "ok") {
    const headers = new Headers(NO_REFERRER);
    headers.append("Set-Cookie", sessionCookie(request, result.value.sessionToken, result.value.expiresAt));
    return redirect("/inventory", { headers });
  }
  return redirect(result.kind === "refused" ? "/sign-in?status=link-invalid" : "/sign-in?status=unavailable", {
    headers: NO_REFERRER,
  });
}
