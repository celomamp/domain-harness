import { describe, expect, it } from "vitest";
import { packageName } from "./index.ts";

describe("@domain-harness/cli", () => {
  it("exposes its workspace name", () => {
    expect(packageName).toBe("@domain-harness/cli");
  });
});
