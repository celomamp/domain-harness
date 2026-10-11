import { useEffect, useRef } from "react";
import { Form } from "react-router";
import { Button } from "./button.tsx";
import { Status } from "./status.tsx";

export const SIGN_IN_COPY = {
  sent: "Check your email for a sign-in link",
  fieldError: "Enter an email address, for example name@company.com.",
  linkInvalid: "This sign-in link was already used or has expired. Enter your email address to get a new link.",
  unavailable: "Sign-in is unavailable right now. Try again in a few minutes.",
} as const;

/** What the sign-in surface shows besides the form. */
export type SignInNotice = "sent" | "invalid" | "link-invalid" | "unavailable" | null;

export interface SignInFormProps {
  readonly notice: SignInNotice;
  /** The last submitted value, kept in the field. */
  readonly email: string;
}

/**
 * sign-in: a cream canvas with one email field (standard-form). Opening it
 * focuses the field. The link-sent text and every denial are announced as a
 * status; an invalid address keeps its value and adds ink text under it.
 */
export function SignInForm({ notice, email }: SignInFormProps) {
  const input = useRef<HTMLInputElement>(null);
  const invalid = notice === "invalid";

  useEffect(() => {
    input.current?.focus();
  }, [invalid]);

  const status =
    notice === "sent"
      ? { tone: "notice" as const, message: SIGN_IN_COPY.sent }
      : notice === "link-invalid"
        ? { tone: "denial" as const, message: SIGN_IN_COPY.linkInvalid }
        : notice === "unavailable"
          ? { tone: "denial" as const, message: SIGN_IN_COPY.unavailable }
          : { tone: "notice" as const, message: undefined };

  return (
    <main className="sign-in">
      <p className="sign-in__wordmark">Domain Harness</p>
      <h1 className="type-display">Sign in</h1>
      <p className="type-body-light">Enter the email address your Company provisioned for the management panel.</p>
      <Status tone={status.tone} message={status.message} />
      <Form method="post" className="standard-form" noValidate>
        <label htmlFor="email" className="type-label">
          Email address
        </label>
        <input
          ref={input}
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          defaultValue={email}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={invalid ? "email-error" : undefined}
        />
        {invalid ? (
          <p id="email-error" className="field-error">
            {SIGN_IN_COPY.fieldError}
          </p>
        ) : null}
        <Button variant="primary" type="submit">
          Email me a sign-in link
        </Button>
      </Form>
    </main>
  );
}
