import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Transport } from "nodemailer";
import { afterEach, describe, expect, it } from "vitest";
import { createTransportFromEnv } from "./from-env.ts";
import { MemoryTransport } from "./memory.ts";
import { OutboxTransport } from "./outbox.ts";
import { SmtpTransport } from "./smtp.ts";
import { composeSignInMessage, SIGN_IN_SUBJECT, signInLinkUrl } from "./transport.ts";

const TOKEN = `0192a000-0000-7000-8000-000000000001.${"A".repeat(43)}`;

describe("composeSignInMessage", () => {
  const message = composeSignInMessage({
    to: "bea@acme.io",
    companyName: "Acme",
    panelUrl: "https://panel.example/",
    token: TOKEN,
  });

  it("has the fixed subject and the recipient", () => {
    expect(message.subject).toBe("Your Domain Harness sign-in link");
    expect(SIGN_IN_SUBJECT).toBe(message.subject);
    expect(message.to).toBe("bea@acme.io");
  });

  it("names the Company and the management panel, single use and the 15-minute expiry", () => {
    expect(message.text).toContain("Domain Harness management panel for Acme");
    expect(message.text).toContain("The link works once and expires in 15 minutes.");
  });

  it("links to the panel's verify route with the token", () => {
    expect(message.text).toContain(`https://panel.example/sign-in/verify?token=${encodeURIComponent(TOKEN)}`);
    expect(signInLinkUrl("http://localhost:3000", "a.b")).toBe("http://localhost:3000/sign-in/verify?token=a.b");
  });
});

describe("transports", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("memory keeps every message", async () => {
    const memory = new MemoryTransport();
    await memory.send({ to: "a@x.io", subject: "s", text: "t" });
    expect(memory.messages).toEqual([{ to: "a@x.io", subject: "s", text: "t" }]);
  });

  it("outbox writes one JSON file per message with mode 0600", async () => {
    const base = await mkdtemp(join(tmpdir(), "dh-outbox-"));
    dirs.push(base);
    const dir = join(base, "nested");
    const outbox = new OutboxTransport(dir, "Domain Harness <no-reply@localhost>");
    await outbox.send({ to: "a@x.io", subject: "s1", text: "t1" });
    await outbox.send({ to: "b@x.io", subject: "s2", text: "t2" });

    const files = (await readdir(dir)).sort();
    expect(files).toHaveLength(2);
    const bodies = await Promise.all(files.map(async (f) => JSON.parse(await readFile(join(dir, f), "utf8")) as unknown));
    expect(bodies).toEqual([
      { from: "Domain Harness <no-reply@localhost>", to: "a@x.io", subject: "s1", text: "t1" },
      { from: "Domain Harness <no-reply@localhost>", to: "b@x.io", subject: "s2", text: "t2" },
    ]);
    for (const file of files) {
      expect((await stat(join(dir, file))).mode & 0o777).toBe(0o600);
    }
  });
});

describe("SmtpTransport", () => {
  it("hands Nodemailer the from, to, subject and text", async () => {
    const sent: Record<string, unknown>[] = [];
    const capture: Transport = {
      name: "capture",
      version: "1",
      send(mail, callback) {
        sent.push({ ...(mail.data as Record<string, unknown>) });
        callback(null, { envelope: { from: false, to: [] }, messageId: "<test@local>" });
      },
    };
    await new SmtpTransport(capture, "Domain Harness <dh@example.com>").send({ to: "bea@acme.io", subject: "s", text: "t" });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ from: "Domain Harness <dh@example.com>", to: "bea@acme.io", subject: "s", text: "t" });
  });
});

describe("createTransportFromEnv", () => {
  it("chooses the outbox", () => {
    expect(createTransportFromEnv({ REGISTRY_MAIL_OUTBOX_DIR: "/tmp/outbox" })).toBeInstanceOf(OutboxTransport);
  });

  it("chooses SMTP with a from address (constructing it opens no connection)", () => {
    expect(
      createTransportFromEnv({ REGISTRY_SMTP_URL: "smtp://127.0.0.1:2525", REGISTRY_MAIL_FROM: "dh@example.com" }),
    ).toBeInstanceOf(SmtpTransport);
  });

  it.each([
    ["nothing", {}],
    ["blank values", { REGISTRY_SMTP_URL: " ", REGISTRY_MAIL_OUTBOX_DIR: "" }],
    ["both", { REGISTRY_SMTP_URL: "smtp://127.0.0.1:2525", REGISTRY_MAIL_FROM: "a@b.io", REGISTRY_MAIL_OUTBOX_DIR: "/tmp/o" }],
    ["SMTP without a from address", { REGISTRY_SMTP_URL: "smtp://127.0.0.1:2525" }],
  ])("refuses %s with missing_configuration", (_label, env) => {
    expect(() => createTransportFromEnv(env)).toThrow(expect.objectContaining({ code: "missing_configuration" }));
  });
});
