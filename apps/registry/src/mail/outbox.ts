import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { mintUuidV7 } from "../ids.ts";
import type { MailMessage, MailTransport } from "./transport.ts";

/** A message as written to the outbox. */
export interface OutboxMessage extends MailMessage {
  readonly from: string;
}

/**
 * Local development and tests: each message becomes one JSON file
 * (`<uuidv7>.json`, mode 0600) in `dir`, which is created mode 0700. Nothing
 * leaves the machine. File names sort in send order.
 */
export class OutboxTransport implements MailTransport {
  readonly #dir: string;
  readonly #from: string;

  constructor(dir: string, from: string) {
    this.#dir = dir;
    this.#from = from;
  }

  async send(message: MailMessage): Promise<void> {
    await mkdir(this.#dir, { recursive: true, mode: 0o700 });
    const body: OutboxMessage = { from: this.#from, to: message.to, subject: message.subject, text: message.text };
    await writeFile(join(this.#dir, `${mintUuidV7()}.json`), `${JSON.stringify(body, null, 2)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
  }
}
