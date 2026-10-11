import { EnvelopeError } from "../errors.ts";
import { OutboxTransport } from "./outbox.ts";
import { SmtpTransport } from "./smtp.ts";
import type { MailTransport } from "./transport.ts";

/** Environment variables that choose and configure the transport. */
export const MAIL_ENV = {
  smtpUrl: "REGISTRY_SMTP_URL",
  from: "REGISTRY_MAIL_FROM",
  outboxDir: "REGISTRY_MAIL_OUTBOX_DIR",
} as const;

/**
 * The transport the environment configures: SMTP (`REGISTRY_SMTP_URL` plus
 * `REGISTRY_MAIL_FROM`) or the file outbox (`REGISTRY_MAIL_OUTBOX_DIR`).
 * Exactly one must be set; otherwise `missing_configuration` is thrown.
 */
export function createTransportFromEnv(env: Readonly<Record<string, string | undefined>>): MailTransport {
  const smtpUrl = nonEmpty(env[MAIL_ENV.smtpUrl]);
  const outboxDir = nonEmpty(env[MAIL_ENV.outboxDir]);
  const from = nonEmpty(env[MAIL_ENV.from]);
  if ((smtpUrl === undefined) === (outboxDir === undefined)) {
    throw new EnvelopeError({
      code: "missing_configuration",
      message: `set exactly one of ${MAIL_ENV.smtpUrl} (with ${MAIL_ENV.from}) or ${MAIL_ENV.outboxDir}`,
      subject: smtpUrl === undefined ? MAIL_ENV.smtpUrl : MAIL_ENV.outboxDir,
    });
  }
  if (smtpUrl !== undefined) {
    if (from === undefined) {
      throw new EnvelopeError({
        code: "missing_configuration",
        message: `${MAIL_ENV.from} is required with ${MAIL_ENV.smtpUrl}`,
        subject: MAIL_ENV.from,
      });
    }
    return new SmtpTransport(smtpUrl, from);
  }
  return new OutboxTransport(outboxDir ?? "", from ?? "Domain Harness <no-reply@localhost>");
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === "" ? undefined : value.trim();
}
