import { describe, expect, it } from "vitest";
import { packageName } from "./index.ts";

describe("@domain-harness/panel", () => {
  it("exposes its workspace name", () => {
    expect(packageName).toBe("@domain-harness/panel");
  });
});
