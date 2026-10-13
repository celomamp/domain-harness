import { describe, expect, it } from "vitest";
import { validateApplicationBody } from "./validate.ts";

const PROJECT = "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e5f8";

describe("validateApplicationBody", () => {
  it("trims the description and passes the Project id through", () => {
    expect(validateApplicationBody({ description: " Checkout ", projectId: PROJECT })).toEqual({
      description: "Checkout",
      projectId: PROJECT,
    });
  });

  it("accepts 500 characters (code points) and refuses 501", () => {
    const wide = "\u{1F600}".repeat(500);
    expect(validateApplicationBody({ description: ` ${wide} `, projectId: PROJECT }).description).toBe(wide);
    expect(() => validateApplicationBody({ description: "\u{1F600}".repeat(501), projectId: PROJECT })).toThrow(
      expect.objectContaining({ code: "invalid_input", subject: "description" }),
    );
  });
});
