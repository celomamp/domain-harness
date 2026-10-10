import { describe, expectTypeOf, it } from "vitest";
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
