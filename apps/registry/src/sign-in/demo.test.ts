import { describe, expect, it } from "vitest";
import { DEFAULT_DEMO_ACCOUNTS, demoAccountsFromEnv } from "./demo.ts";

describe("demoAccountsFromEnv", () => {
  it("is off unless REGISTRY_DEMO_SIGN_IN is exactly 1", () => {
    expect(demoAccountsFromEnv({})).toBeUndefined();
    expect(demoAccountsFromEnv({ REGISTRY_DEMO_SIGN_IN: "true" })).toBeUndefined();
    expect(demoAccountsFromEnv({ REGISTRY_DEMO_SIGN_IN: "0", REGISTRY_DEMO_ACCOUNTS: "Buyer=a@x.io" })).toBeUndefined();
  });

  it("uses one default address per role when no list is set", () => {
    const accounts = demoAccountsFromEnv({ REGISTRY_DEMO_SIGN_IN: " 1 " });
    expect(accounts).toBe(DEFAULT_DEMO_ACCOUNTS);
    expect(accounts?.map((account) => account.role)).toEqual(["Buyer", "Standard owner", "Builder"]);
  });

  it("reads one normalized address per role from REGISTRY_DEMO_ACCOUNTS, in role order", () => {
    expect(
      demoAccountsFromEnv({
        REGISTRY_DEMO_SIGN_IN: "1",
        REGISTRY_DEMO_ACCOUNTS: " Builder = Lia@Acme.com ; Buyer=ana@acme.com;Standard owner=rui@acme.com; ",
      }),
    ).toEqual([
      { name: "Demo Buyer", email: "ana@acme.com", role: "Buyer" },
      { name: "Demo Standard owner", email: "rui@acme.com", role: "Standard owner" },
      { name: "Demo Builder", email: "lia@acme.com", role: "Builder" },
    ]);
  });

  it.each([
    ["Buyer=ana@acme.com;Builder=lia@acme.com", "list one email for each role"],
    ["Buyer=ana@acme.com;Standard owner=rui@acme.com;Builder=lia@acme.com;Buyer=bo@acme.com", "listed twice"],
    ["Admin=ana@acme.com;Standard owner=rui@acme.com;Builder=lia@acme.com", "Role=email"],
    ["Buyer=not-an-email;Standard owner=rui@acme.com;Builder=lia@acme.com", "email address"],
    ["Buyer=ana@acme.com;Standard owner=ana@acme.com;Builder=lia@acme.com", "its own email"],
  ])("refuses %j instead of falling back to the defaults", (list, message) => {
    expect(() => demoAccountsFromEnv({ REGISTRY_DEMO_SIGN_IN: "1", REGISTRY_DEMO_ACCOUNTS: list })).toThrow(message);
  });
});
