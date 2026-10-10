import { describe, expect, expectTypeOf, it } from "vitest";
import { DEFAULT_PLAN, isPlan, isRole, PLANS, ROLES } from "./index.ts";
import type { Plan, Role } from "./index.ts";

describe("ROLES", () => {
  it("is exactly Buyer, Standard owner, Builder", () => {
    expect(ROLES).toEqual(["Buyer", "Standard owner", "Builder"]);
    expectTypeOf<Role>().toEqualTypeOf<"Buyer" | "Standard owner" | "Builder">();
  });

  it.each(ROLES.map((role) => [role]))("accepts %s", (role) => {
    expect(isRole(role)).toBe(true);
  });

  it.each([["Admin"], ["buyer"], [" Buyer"], ["Standard Owner"], [""], [undefined], [null], [1], [{}]])(
    "rejects %j",
    (value) => {
      expect(isRole(value)).toBe(false);
    },
  );
});

describe("PLANS", () => {
  it("is exactly Community, Team, Business, Enterprise with Team as default", () => {
    expect(PLANS).toEqual(["Community", "Team", "Business", "Enterprise"]);
    expect(DEFAULT_PLAN).toBe("Team");
    expectTypeOf<Plan>().toEqualTypeOf<"Community" | "Team" | "Business" | "Enterprise">();
  });

  it.each(PLANS.map((plan) => [plan]))("accepts %s", (plan) => {
    expect(isPlan(plan)).toBe(true);
  });

  it.each([["Free"], ["team"], [""], [undefined], [42]])("rejects %j", (value) => {
    expect(isPlan(value)).toBe(false);
  });
});
