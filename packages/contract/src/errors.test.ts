import { describe, expect, expectTypeOf, it } from "vitest";
import { PLAN_REFUSED, PLANS } from "./index.ts";
import type { ErrorEnvelope } from "./index.ts";

describe("ErrorEnvelope", () => {
  it("is exactly { code, message, subject }, all readonly strings", () => {
    expectTypeOf<ErrorEnvelope>().toEqualTypeOf<{
      readonly code: string;
      readonly message: string;
      readonly subject: string;
    }>();
  });

  it("rejects an envelope with a missing or extra field", () => {
    // @ts-expect-error subject is required
    const missing: ErrorEnvelope = { code: "c", message: "m" };
    // @ts-expect-error no fields beyond code, message and subject
    const extra: ErrorEnvelope = { code: "c", message: "m", subject: "s", detail: "x" };
    expectTypeOf(missing).toEqualTypeOf<ErrorEnvelope>();
    expectTypeOf(extra).toEqualTypeOf<ErrorEnvelope>();
  });
});

describe("PLAN_REFUSED", () => {
  it("is the stable code plan_refused and names no plan", () => {
    expect(PLAN_REFUSED).toBe("plan_refused");
    for (const plan of PLANS) expect(PLAN_REFUSED.toLowerCase()).not.toContain(plan.toLowerCase());
  });
});
