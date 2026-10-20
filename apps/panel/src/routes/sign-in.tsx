import { data, redirect, useActionData, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { isEmailAddress, normalizeEmail, SIGN_IN_LINK_INVALID } from "@domain-harness/contract";
import { SignInForm } from "../components/sign-in-form.tsx";
import type { SignInNotice } from "../components/sign-in-form.tsx";
import { createDemoSession, requestSignInLink } from "../registry.server.ts";
import { sessionCookie } from "../session.server.ts";

/**
 * Demo sign-in feature toggle (staging only): with PANEL_DEMO_SIGN_IN=1, a
 * typed address is first offered to the registry's demo sessions; a demo
 * account signs in at once, any other address gets the emailed link as
 * usual. The registry decides which addresses are demo accounts
 * (REGISTRY_DEMO_SIGN_IN / REGISTRY_DEMO_ACCOUNTS); the panel never knows them.
 */
function demoSignInEnabled(): boolean {
  return process.env["PANEL_DEMO_SIGN_IN"]?.trim() === "1";
}

export const meta: MetaFunction = () => [{ title: "Sign in | Domain Harness" }];

export interface SignInActionData {
  readonly notice: "sent" | "invalid" | "unavailable";
  readonly email: string;
}

/** `?status=link-invalid` and `?status=unavailable` come from the verify route. */
export function loader({ request }: LoaderFunctionArgs): { notice: SignInNotice; demoSignIn: boolean } {
  const status = new URL(request.url).searchParams.get("status");
  return {
    notice: status === "link-invalid" || status === "unavailable" ? status : null,
    demoSignIn: demoSignInEnabled(),
  };
}

/**
 * Validate the address here, so a malformed one never reaches the registry,
 * then ask the registry to email links. The registry answers the same for
 * every well-formed address, and so does this page.
 *
 * All outcomes answer 200: React Router renders the ErrorBoundary for any
 * 4xx/5xx action response, which would hide the inline notices below behind
 * a generic error page. The notice field carries the outcome instead.
 */
export async function action({ request }: ActionFunctionArgs) {
  const form = await request.formData();
  const raw = form.get("email");
  const email = typeof raw === "string" ? raw : "";
  if (!isEmailAddress(email)) {
    return data<SignInActionData>({ notice: "invalid", email });
  }
  if (demoSignInEnabled()) {
    const demo = await createDemoSession(normalizeEmail(email));
    if (demo.kind === "ok") {
      return redirect("/inventory", {
        headers: { "Set-Cookie": sessionCookie(request, demo.value.sessionToken, demo.value.expiresAt) },
      });
    }
    // Not a demo account (or demo sign-in off at the registry): email a link.
    const notDemo = demo.kind === "refused" && (demo.error.code === SIGN_IN_LINK_INVALID || demo.error.code === "not_found");
    if (!notDemo) return data<SignInActionData>({ notice: "unavailable", email });
  }
  const result = await requestSignInLink(normalizeEmail(email));
  if (result.kind === "unavailable") {
    return data<SignInActionData>({ notice: "unavailable", email });
  }
  if (result.kind === "refused") {
    // Only the registry's own verdict on the email field is a field error;
    // any other refusal means sign-in is not working right now.
    const fieldError = result.error.code === "invalid_input" && result.error.subject === "email";
    return fieldError
      ? data<SignInActionData>({ notice: "invalid", email })
      : data<SignInActionData>({ notice: "unavailable", email });
  }
  return data<SignInActionData>({ notice: "sent", email });
}

export default function SignIn() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  return (
    <SignInForm
      notice={actionData?.notice ?? loaderData.notice}
      email={actionData?.email ?? ""}
      demoSignIn={loaderData.demoSignIn}
    />
  );
}
