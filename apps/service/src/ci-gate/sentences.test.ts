import { describe, expect, it } from "vitest";
import { PLANS } from "@domain-harness/contract";
import * as sentenceExports from "./sentences.ts";
import {
  BUNDLE_STALE,
  BUNDLE_VERIFICATION_FAILED,
  DUPLICATE_APPLICATION_ID,
  EFFECTIVE_STANDARD_SET_COULD_NOT_BE_READ,
  FAIL,
  MISSING_IDENTIFICATION_FILE,
  PASS,
  RUN_DID_NOT_COMPLETE,
  STEP_CANNOT_RUN,
  UNBOUND,
  sentences,
} from "./sentences.ts";

describe("ci-gate sentences (UX-DR29)", () => {
  it("pins every exported sentence constant to its exact string", () => {
    expect(PASS).toBe("pass");
    expect(FAIL).toBe("fail");
    expect(UNBOUND).toBe("unbound Application");
    expect(MISSING_IDENTIFICATION_FILE).toBe("missing or unreadable identification file");
    expect(DUPLICATE_APPLICATION_ID).toBe("duplicate Application id");
    expect(RUN_DID_NOT_COMPLETE).toBe("run did not complete");
    expect(EFFECTIVE_STANDARD_SET_COULD_NOT_BE_READ).toBe("Effective Standard set could not be read");
    expect(BUNDLE_STALE).toBe("bundle stale");
    expect(BUNDLE_VERIFICATION_FAILED).toBe("bundle verification failed");
    expect(STEP_CANNOT_RUN).toBe("the step cannot run");

    expect(sentences).toEqual({
      pass: "pass",
      fail: "fail",
      unbound: "unbound Application",
      missingOrUnreadableIdentificationFile: "missing or unreadable identification file",
      duplicateApplicationId: "duplicate Application id",
      runDidNotComplete: "run did not complete",
      effectiveStandardSetCouldNotBeRead: "Effective Standard set could not be read",
      bundleStale: "bundle stale",
      bundleVerificationFailed: "bundle verification failed",
      stepCannotRun: "the step cannot run",
    });
  });

  it("never names a plan in any exported sentence constant", () => {
    const allStrings: string[] = [];
    for (const value of Object.values(sentenceExports)) {
      if (typeof value === "string") {
        allStrings.push(value);
      } else {
        for (const nested of Object.values(value)) {
          if (typeof nested === "string") allStrings.push(nested);
        }
      }
    }
    expect(allStrings.length).toBeGreaterThan(0);
    for (const text of allStrings) {
      expect(text).not.toMatch(/\b(Community|Team|Business|Enterprise)\s+plan\b/i);
      for (const plan of PLANS) {
        expect(text.toLowerCase()).not.toContain(plan.toLowerCase());
      }
    }
  });
});
