import { data, useActionData, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { isEmailAddress, normalizeEmail } from "@domain-harness/contract";
import { SignInForm } from "../components/sign-in-form.tsx";
import type { SignInNotice } from "../components/sign-in-form.tsx";
import { requestSignInLink } from "../registry.server.ts";

export const meta: MetaFunction = () => [{ title: "Sign in | Domain Harness" }];

export interface SignInActionData {
  readonly notice: "sent" | "invalid" | "unavailable";
  readonly email: string;
}

/** `?status=link-invalid` and `?status=unavailable` come from the verify route. */
export function loader({ request }: LoaderFunctionArgs): { notice: SignInNotice } {
  const status = new URL(request.url).searchParams.get("status");
  return { notice: status === "link-invalid" || status === "unavailable" ? status : null };
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
  return <SignInForm notice={actionData?.notice ?? loaderData.notice} email={actionData?.email ?? ""} />;
}
