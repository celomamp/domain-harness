import { describe, expect, it } from "vitest";
import { validateProvisionInput } from "./validate.ts";

const valid = () => ({
  company: "Acme",
  accounts: [
    { name: "Bea Buyer", email: "bea@acme.io", role: "Buyer" },
    { name: "Sam Owner", email: "sam@acme.io", role: "Standard owner" },
    { name: "Bo Builder", email: "bo@acme.io", role: "Builder" },
  ],
});

function errorOf(input: unknown) {
  const result = validateProvisionInput(input);
  if (result.ok) throw new Error("expected a validation error");
  return result.error;
}

describe("validateProvisionInput", () => {
  it("accepts the happy path and defaults the plan to Team", () => {
    const result = validateProvisionInput(valid());
    expect(result).toEqual({
      ok: true,
      value: {
        company: "Acme",
        plan: "Team",
        accounts: [
          { name: "Bea Buyer", email: "bea@acme.io", role: "Buyer" },
          { name: "Sam Owner", email: "sam@acme.io", role: "Standard owner" },
          { name: "Bo Builder", email: "bo@acme.io", role: "Builder" },
        ],
      },
    });
  });

  it("keeps an explicit plan", () => {
    const result = validateProvisionInput({ ...valid(), plan: "Business" });
    expect(result.ok && result.value.plan).toBe("Business");
  });

  it("trims names and trims and lower-cases emails", () => {
    const input = valid();
    input.company = "  Acme  ";
    input.accounts[0] = { name: "  Bea  ", email: "  Bea@ACME.io ", role: "Buyer" };
    const result = validateProvisionInput(input);
    expect(result.ok && result.value.company).toBe("Acme");
    expect(result.ok && result.value.accounts[0]).toEqual({ name: "Bea", email: "bea@acme.io", role: "Buyer" });
  });

  it("rejects an invalid role naming the entry", () => {
    const input = valid();
    input.accounts[1] = { name: "Al", email: "al@acme.io", role: "Admin" };
    expect(errorOf(input)).toMatchObject({ code: "invalid_role", subject: "accounts[1].role" });
  });

  it("rejects a duplicate email after normalization, naming the later entry", () => {
    const input = valid();
    input.accounts = [
      { name: "A", email: "a@x.io", role: "Buyer" },
      { name: "B", email: " A@X.io ", role: "Builder" },
    ];
    expect(errorOf(input)).toMatchObject({ code: "duplicate_email", subject: "accounts[1].email" });
  });

  it.each([
    ["an invalid plan", { ...valid(), plan: "Free" }, "invalid_plan", "plan"],
    ["a lower-case plan", { ...valid(), plan: "team" }, "invalid_plan", "plan"],
    ["an empty company", { ...valid(), company: "  " }, "invalid_input", "company"],
    ["a missing company", { accounts: valid().accounts }, "invalid_input", "company"],
    ["no accounts", { company: "Acme", accounts: [] }, "invalid_input", "accounts"],
    ["accounts not an array", { company: "Acme", accounts: {} }, "invalid_input", "accounts"],
    ["a non-object input", [], "invalid_input", "input"],
    ["null input", null, "invalid_input", "input"],
    ["a client-supplied id", { ...valid(), id: "x" }, "invalid_input", "id"],
  ])("rejects %s", (_label, input, code, subject) => {
    expect(errorOf(input)).toMatchObject({ code, subject });
  });

  it.each([
    ["an empty email", { name: "A", email: "", role: "Buyer" }, "accounts[0].email"],
    ["a blank email", { name: "A", email: "   ", role: "Buyer" }, "accounts[0].email"],
    ["a malformed email", { name: "A", email: "not-an-email", role: "Buyer" }, "accounts[0].email"],
    ["an email with spaces inside", { name: "A", email: "a b@x.io", role: "Buyer" }, "accounts[0].email"],
    ["a missing email", { name: "A", role: "Buyer" }, "accounts[0].email"],
    ["an empty name", { name: " ", email: "a@x.io", role: "Buyer" }, "accounts[0].name"],
    ["a client-supplied account id", { id: "x", name: "A", email: "a@x.io", role: "Buyer" }, "accounts[0].id"],
    ["a non-object entry", "a@x.io", "accounts[0]"],
  ])("rejects %s as invalid_input", (_label, entry, subject) => {
    expect(errorOf({ company: "Acme", accounts: [entry] })).toMatchObject({ code: "invalid_input", subject });
  });

  it("never echoes names or emails in messages", () => {
    const input = valid();
    input.accounts.push({ name: "Secret Name", email: "SECRET@acme.io", role: "Admin" });
    const error = errorOf(input);
    expect(error.message).not.toMatch(/secret/i);
  });
});
