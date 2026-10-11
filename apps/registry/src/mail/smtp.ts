import { createTransport } from "nodemailer";
import type { Transport, Transporter } from "nodemailer";
import type { MailMessage, MailTransport } from "./transport.ts";

/**
 * Real delivery over SMTP through Nodemailer; `target` is an SMTP URL such as
 * `smtps://user:pass@smtp.example.com`. Tests pass a Nodemailer transport
 * object instead, so no connection is ever opened.
 */
export class SmtpTransport implements MailTransport {
  readonly #transporter: Transporter;
  readonly #from: string;

  constructor(target: string | Transport, from: string) {
    this.#transporter = typeof target === "string" ? createTransport(target) : createTransport(target);
    this.#from = from;
  }

  async send(message: MailMessage): Promise<void> {
    await this.#transporter.sendMail({ from: this.#from, to: message.to, subject: message.subject, text: message.text });
  }
}
