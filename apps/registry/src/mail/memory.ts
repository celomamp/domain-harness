import type { MailMessage, MailTransport } from "./transport.ts";

/** Tests: keeps every message in memory. */
export class MemoryTransport implements MailTransport {
  readonly messages: MailMessage[] = [];

  send(message: MailMessage): Promise<void> {
    this.messages.push(message);
    return Promise.resolve();
  }
}
