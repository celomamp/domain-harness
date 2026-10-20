import { redirect } from "react-router";
import type { ActionFunctionArgs } from "react-router";
import { clearSessionCookie } from "../session.server.ts";

/**
 * Sign-out: a resource action reached only by the account block's form. It
 * clears the session cookie and sends the browser to sign-in, so ending a
 * session can never be triggered by navigation.
 */
export function action({ request }: ActionFunctionArgs): Response {
  return redirect("/sign-in", { headers: { "Set-Cookie": clearSessionCookie(request) } });
}
