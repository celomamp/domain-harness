import { describe, expect, it } from "vitest";
import {
  DEMO_ACCOUNTS,
  isDemoEmail,
  isEmailAddress,
  isErrorEnvelope,
  isSessionCreated,
  isSessionInfo,
  normalizeEmail,
  REGISTRY_API_PATHS,
  SESSION_INVALID,
  SIGN_IN_LINK_INVALID,
} from "./index.ts";

const ACCOUNT = "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e5f6";
const TENANT = "01928c7e-5b2a-7c3d-9e4f-a1b2c3d4e5f7";
const info = { accountId: ACCOUNT, tenantId: TENANT, role: "Buyer" };

describe("sign-in wire contract", () => {
  it("names the registry paths and error codes once", () => {
    expect(REGISTRY_API_PATHS).toEqual({
      signInLinks: "/v1/sign-in-links",
      sessions: "/v1/sessions",
      session: "/v1/session",
      demoSessions: "/v1/demo-sessions",
    });
    expect(SIGN_IN_LINK_INVALID).toBe("sign_in_link_invalid");
    expect(SESSION_INVALID).toBe("session_invalid");
  });
});

describe("isEmailAddress / normalizeEmail", () => {
  it.each([["bea@acme.io"], [" Bea@Acme.io "], ["a.b+c@x.co.uk"]])("accepts %j", (value) => {
    expect(isEmailAddress(value)).toBe(true);
  });

  it.each([[""], ["   "], ["not-an-email"], ["a@b"], ["a b@c.io"], ["@x.io"], [undefined], [null], [7]])(
    "rejects %j",
    (value) => {
      expect(isEmailAddress(value)).toBe(false);
    },
  );

  it("trims and lower-cases", () => {
    expect(normalizeEmail(" Bea@Acme.io ")).toBe("bea@acme.io");
  });
});

describe("isSessionInfo", () => {
  it("accepts a well-formed session", () => {
    expect(isSessionInfo(info)).toBe(true);
  });

  it.each([
    ["a non-v7 account id", { ...info, accountId: "3f2b8c1e-9d4a-4b6e-8f7a-1c2d3e4f5a6b" }],
    ["a missing tenant id", { accountId: ACCOUNT, role: "Buyer" }],
    ["an unknown role", { ...info, role: "Admin" }],
    ["null", null],
    ["an array", [info]],
    ["a string", "Buyer"],
  ])("rejects %s", (_label, value) => {
    expect(isSessionInfo(value)).toBe(false);
  });
});

describe("isSessionCreated", () => {
  const created = { sessionToken: `${TENANT}.secret`, expiresAt: "2026-10-10T12:00:00.000Z", session: info };

  it("accepts a well-formed response", () => {
    expect(isSessionCreated(created)).toBe(true);
  });

  it.each([
    ["an empty token", { ...created, sessionToken: "" }],
    ["a non-UTC timestamp", { ...created, expiresAt: "2026-10-10T12:00:00+02:00" }],
    ["a bad session", { ...created, session: { ...info, role: "x" } }],
    ["no token", { expiresAt: created.expiresAt, session: info }],
    ["undefined", undefined],
  ])("rejects %s", (_label, value) => {
    expect(isSessionCreated(value)).toBe(false);
  });
});

describe("isErrorEnvelope", () => {
  it("accepts { code, message, subject }", () => {
    expect(isErrorEnvelope({ code: "c", message: "m", subject: "s" })).toBe(true);
  });

  it.each([[{ code: "c", message: "m" }], [{ code: 1, message: "m", subject: "s" }], [null], ["c"], [[]]])(
    "rejects %j",
    (value) => {
      expect(isErrorEnvelope(value)).toBe(false);
    },
  );
});

describe("demo accounts", () => {
  it("lists one well-formed, normalized address per role", () => {
    expect(DEMO_ACCOUNTS.map((account) => account.role)).toEqual(["Buyer", "Standard owner", "Builder"]);
    for (const account of DEMO_ACCOUNTS) {
      expect(isEmailAddress(account.email)).toBe(true);
      expect(normalizeEmail(account.email)).toBe(account.email);
    }
  });

  it("recognizes a demo address in any case or padding, and nothing else", () => {
    expect(isDemoEmail(" Buyer@Demo.DomainHarness.test ")).toBe(true);
    expect(isDemoEmail("buyer@acme.io")).toBe(false);
  });
});
