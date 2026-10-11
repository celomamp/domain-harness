import { describe, expect, it } from "vitest";
import type { RegistryDb } from "../db/client.ts";
import { MemoryTransport } from "../mail/memory.ts";
import { consumeSignInLink, getSession, requestSignInLinks } from "./service.ts";

/** A database handle that fails the test if anything touches it. */
function untouchableDb(): { db: RegistryDb; calls: () => number } {
  let calls = 0;
  const db = new Proxy(
    {},
    {
      get() {
        calls += 1;
        throw new Error("the database was touched");
      },
    },
  ) as RegistryDb;
  return { db, calls: () => calls };
}

const malformed: [string, unknown][] = [
  ["garbage", "garbage"],
  ["a non-v7 tenant part", `3f2b8c1e-9d4a-4b6e-8f7a-1c2d3e4f5a6b.${"A".repeat(43)}`],
  ["undefined", undefined],
  ["an empty string", ""],
];

describe("sign-in service without a valid token", () => {
  it.each(malformed)("consumeSignInLink rejects %s as sign_in_link_invalid and issues no query", async (_l, token) => {
    const { db, calls } = untouchableDb();
    await expect(consumeSignInLink(db, token)).rejects.toMatchObject({ code: "sign_in_link_invalid", subject: "token" });
    expect(calls()).toBe(0);
  });

  it.each(malformed)("getSession rejects %s as session_invalid and issues no query", async (_l, token) => {
    const { db, calls } = untouchableDb();
    await expect(getSession(db, token)).rejects.toMatchObject({ code: "session_invalid" });
    expect(calls()).toBe(0);
  });

  it.each([[""], ["not-an-email"]])("requestSignInLinks rejects %j before any query", async (email) => {
    const { db, calls } = untouchableDb();
    const mail = new MemoryTransport();
    await expect(requestSignInLinks(db, mail, { panelUrl: "http://panel.test" }, email)).rejects.toMatchObject({
      code: "invalid_input",
      subject: "email",
    });
    expect(calls()).toBe(0);
    expect(mail.messages).toEqual([]);
  });
});
