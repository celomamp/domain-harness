import { describe, expect, it } from "vitest";
import { parseDeviationLine } from "@domain-harness/contract";
import { createInMemoryBindingLedger } from "./binding.ts";
import { runGateDirect } from "./direct.ts";
import type { GateFixture } from "./fixtures.ts";
import { gateFixtures } from "./fixtures.ts";
import { formatDeviationLine } from "./result.ts";

/** Run one fixture through the direct adapter on a fresh ledger. */
function runFixture(fixture: GateFixture): ReturnType<typeof runGateDirect> {
  return runGateDirect({
    applicationId: fixture.applicationId,
    repoFingerprint: fixture.repoFingerprint,
    files: fixture.files,
    bundle: fixture.bundle,
    ledger: createInMemoryBindingLedger(
      fixture.boundFingerprint === null
        ? []
        : [{ applicationId: fixture.applicationId, fingerprint: fixture.boundFingerprint }],
    ),
    now: fixture.now,
  });
}

describe("one deviation-line grammar across contract and gate", () => {
  it("parseDeviationLine inverts formatDeviationLine for every deviation the 5.4 fixture suite yields", async () => {
    let parsed = 0;
    for (const fixture of gateFixtures) {
      const outcome = await runFixture(fixture);
      for (const deviation of outcome.deviations) {
        const key = parseDeviationLine(formatDeviationLine(deviation));
        expect(
          key,
          `fixture ${fixture.name}: parseDeviationLine could not invert ${formatDeviationLine(deviation)}`,
        ).not.toBeNull();
        expect(key, `fixture ${fixture.name}`).toEqual({
          standardId: deviation.standardId,
          slot: deviation.slot,
          subject: deviation.subject,
        });
        parsed += 1;
      }
    }
    // The suite actually produced the lines; the invariant is not vacuous.
    expect(parsed).toBeGreaterThan(0);
  });
});
