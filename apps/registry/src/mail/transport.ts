import { SIGN_IN_LINK_TTL_MINUTES } from "@domain-harness/contract";

/** One plain-text message. */
export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

/** Where sign-in mail goes. Implementations never log the message, its address or its link. */
export interface MailTransport {
  send(message: MailMessage): Promise<void>;
}

export const SIGN_IN_SUBJECT = "Your Domain Harness sign-in link";

/** Build the panel's verify URL for `token` under `panelUrl` (no trailing slash needed). */
export function signInLinkUrl(panelUrl: string, token: string): string {
  return `${panelUrl.replace(/\/+$/, "")}/sign-in/verify?token=${encodeURIComponent(token)}`;
}

/** The sign-in email: names the Company and the management panel, says the link works once and expires. */
export function composeSignInMessage(input: {
  readonly to: string;
  readonly companyName: string;
  readonly panelUrl: string;
  readonly token: string;
}): MailMessage {
  const link = signInLinkUrl(input.panelUrl, input.token);
  const text = [
    `Sign in to the Domain Harness management panel for ${input.companyName}.`,
    "",
    "Open this link to sign in:",
    link,
    "",
    `The link works once and expires in ${String(SIGN_IN_LINK_TTL_MINUTES)} minutes.`,
    "If you did not ask to sign in, you can ignore this email.",
    "",
  ].join("\n");
  return { to: input.to, subject: SIGN_IN_SUBJECT, text };
}
