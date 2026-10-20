import { useEffect, useRef, useState } from "react";
import { Form, useNavigation } from "react-router";
import { Button } from "./button.tsx";
import { Status } from "./status.tsx";

export const SIGN_IN_COPY = {
  sent: "Check your email for a sign-in link",
  fieldError: "Enter an email address, for example name@company.com.",
  linkInvalid: "This sign-in link was already used or has expired. Enter your email address to get a new link.",
  unavailable: "Sign-in is unavailable right now. Try again in a few minutes.",
} as const;

/** A demo account offered on staging: signs in at once, no emailed link. */
export interface DemoAccount {
  readonly name: string;
  readonly email: string;
  readonly role: string;
}

/** What the sign-in surface shows besides the form. */
export type SignInNotice = "sent" | "invalid" | "link-invalid" | "unavailable" | null;

export interface SignInFormProps {
  readonly notice: SignInNotice;
  /** The last submitted value, kept in the field. */
  readonly email: string;
  /** Staging only: demo accounts to sign in as with one press. Empty elsewhere. */
  readonly demoAccounts?: readonly DemoAccount[];
}

/**
 * sign-in: a cream canvas with one email field (standard-form). Opening it
 * focuses the field. The link-sent text and every denial are announced as a
 * status; an invalid address keeps its value and adds ink text under it.
 */
export function SignInForm({ notice, email, demoAccounts = [] }: SignInFormProps) {
  const input = useRef<HTMLInputElement>(null);
  const confirmationHeading = useRef<HTMLHeadingElement>(null);
  const awaitingActionResult = useRef(false);
  const actionWasPending = useRef(false);
  const [showForm, setShowForm] = useState(false);
  const navigation = useNavigation();
  const pending = navigation.state !== "idle";
  const invalid = notice === "invalid";
  const showConfirmation = notice === "sent" && !showForm;

  useEffect(() => {
    if (!awaitingActionResult.current) return;

    if (pending) {
      actionWasPending.current = true;
    } else if (actionWasPending.current) {
      awaitingActionResult.current = false;
      actionWasPending.current = false;
      setShowForm(false);
    }
  }, [pending]);

  useEffect(() => {
    if (showConfirmation) {
      confirmationHeading.current?.focus();
    } else {
      input.current?.focus();
    }
  }, [invalid, notice, showConfirmation]);

  const status =
    notice === "sent"
      ? { tone: "notice" as const, message: SIGN_IN_COPY.sent }
      : notice === "link-invalid"
        ? { tone: "denial" as const, message: SIGN_IN_COPY.linkInvalid }
        : notice === "unavailable"
          ? { tone: "denial" as const, message: SIGN_IN_COPY.unavailable }
          : { tone: "notice" as const, message: undefined };

  return (
    <main className="sign-in-shell">
      <aside className="sign-in-brand" aria-label="Domain Harness">
        <p className="sign-in-brand__wordmark">Domain Harness</p>
        <p className="sign-in-brand__statement">Software-construction Standards, made usable.</p>
        <ul className="sign-in-brand__evidence">
          <li>Trace every requirement.</li>
          <li>Keep decisions visible.</li>
          <li>Ground progress in evidence.</li>
        </ul>
        <div className="sign-in-brand__rule" aria-hidden="true" />
      </aside>

      <section className="sign-in-panel" aria-labelledby="sign-in-title">
        <div className="sign-in-panel__content">
          <h1 id="sign-in-title" className="type-display">
            Sign in
          </h1>
          <p className="type-body-light">Enter the email address your Company provisioned for the management panel.</p>
          {showConfirmation ? (
            <section className="sign-in-confirmation" aria-labelledby="sign-in-confirmation-title">
              <h2
                ref={confirmationHeading}
                id="sign-in-confirmation-title"
                className="type-section-title"
                tabIndex={-1}
              >
                Check your email
              </h2>
              <p className="sign-in-confirmation__email">{email}</p>
              <Status tone={status.tone} message={status.message} />
              <Button
                variant="secondary"
                onClick={() => {
                  // The person chose the form: a submit still settling (its
                  // revalidation) must not flip back to the confirmation.
                  awaitingActionResult.current = false;
                  actionWasPending.current = false;
                  setShowForm(true);
                }}
              >
                Use a different address
              </Button>
            </section>
          ) : (
            <>
              <Status tone={status.tone} message={notice === "sent" ? undefined : status.message} />
              <Form
                method="post"
                className="standard-form"
                noValidate
                aria-busy={pending}
                onSubmit={() => {
                  awaitingActionResult.current = true;
                }}
              >
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
                  disabled={pending}
                  aria-invalid={invalid ? true : undefined}
                  aria-describedby={invalid ? "email-error" : undefined}
                />
                {invalid ? (
                  <p id="email-error" className="field-error">
                    {SIGN_IN_COPY.fieldError}
                  </p>
                ) : null}
                <Button variant="primary" type="submit" disabled={pending}>
                  Email me a sign-in link
                </Button>
              </Form>
            </>
          )}
          {demoAccounts.length === 0 ? null : (
            <section className="sign-in-demo" aria-labelledby="sign-in-demo-title">
              <h2 id="sign-in-demo-title" className="type-label">
                Demo accounts (staging)
              </h2>
              <p className="sign-in-demo__note">Sign in at once as one of these accounts; no email is sent.</p>
              <div className="sign-in-demo__accounts">
                {demoAccounts.map((account) => (
                  <Form method="post" key={account.email}>
                    <input type="hidden" name="email" value={account.email} />
                    <Button variant="secondary" type="submit" disabled={pending}>
                      {`Sign in as ${account.role}`}
                    </Button>
                  </Form>
                ))}
              </div>
            </section>
          )}
        </div>
      </section>
    </main>
  );
}
