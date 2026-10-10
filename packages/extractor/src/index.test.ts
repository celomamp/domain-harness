import { describe, expect, it } from "vitest";
import { packageName } from "./index.ts";

describe("@domain-harness/extractor", () => {
  it("exposes its workspace name", () => {
    expect(packageName).toBe("@domain-harness/extractor");
  });
});
