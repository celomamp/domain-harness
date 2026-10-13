import { describe, expect, it } from "vitest";
import { DEVIATION_KINDS, isAcceptedDeviation, isDeviation } from "./index.ts";
import type { AcceptedDeviation, Deviation, EffectiveSlot, UuidV7 } from "./index.ts";

const APPLICATION_ID = "018f3d2a-7000-7000-8000-000000000001" as UuidV7;
const STANDARD_ID = "018f3d2a-7000-7000-8000-000000000002" as UuidV7;

const slot: EffectiveSlot = { moduleKind: "code-stack", slotKind: "library", name: "Lodash" };

const validDeviation: Deviation = {
  standardId: STANDARD_ID,
  standardVersion: 3,
  slot,
  subject: "lodash",
  kind: "prohibited",
  status: "open",
  correction: 'The Standard 018f3d2a-7000-7000-8000-000000000002 prohibits lodash; use the approved library ramda instead.',
};

const validAccepted: AcceptedDeviation = {
  applicationId: APPLICATION_ID,
  standardId: STANDARD_ID,
  standardVersion: 3,
  slot,
  subject: "lodash",
  start: "2026-01-01T00:00:00.000Z",
  end: "2026-12-31T23:59:59.000Z",
};

const id = "018f3d2a-7000-7000-8000-000000000002" as UuidV7;

describe("deviation contract", () => {
  it("round-trips a valid deviation and an accepted deviation", () => {
    expect(isDeviation(validDeviation)).toBe(true);
    expect(isDeviation(JSON.parse(JSON.stringify(validDeviation)) as unknown)).toBe(true);
    expect(isAcceptedDeviation(validAccepted)).toBe(true);
    expect(isAcceptedDeviation(JSON.parse(JSON.stringify(validAccepted)) as unknown)).toBe(true);
  });

  it("rejects malformed deviations", () => {
    expect(isDeviation(null)).toBe(false);
    expect(isDeviation("deviation")).toBe(false);
    expect(isDeviation([])).toBe(false);
    expect(isDeviation({})).toBe(false);

    const missingSubject = { ...validDeviation, subject: undefined } as unknown;
    expect(isDeviation(missingSubject)).toBe(false);

    const extraKey = { ...validDeviation, extra: true } as unknown;
    expect(isDeviation(extraKey)).toBe(false);

    const badId = { ...validDeviation, standardId: "not-a-uuid" } as unknown;
    expect(isDeviation(badId)).toBe(false);

    const wrongIdVersion = { ...validDeviation, standardId: id.toUpperCase() } as unknown;
    expect(isDeviation(wrongIdVersion)).toBe(false);

    const zeroVersion = { ...validDeviation, standardVersion: 0 } as unknown;
    expect(isDeviation(zeroVersion)).toBe(false);

    const fractionalVersion = { ...validDeviation, standardVersion: 1.5 } as unknown;
    expect(isDeviation(fractionalVersion)).toBe(false);

    const stringVersion = { ...validDeviation, standardVersion: "3" } as unknown;
    expect(isDeviation(stringVersion)).toBe(false);

    const badSlot = { ...validDeviation, slot: { moduleKind: "code-stack", slotKind: 7, name: "Lodash" } } as unknown;
    expect(isDeviation(badSlot)).toBe(false);

    const slotMissingName = {
      ...validDeviation,
      slot: { moduleKind: "code-stack", slotKind: "library" },
    } as unknown;
    expect(isDeviation(slotMissingName)).toBe(false);

    const emptySlot = { ...validDeviation, slot: {} } as unknown;
    expect(isDeviation(emptySlot)).toBe(false);

    const badKind = { ...validDeviation, kind: "visual-fidelity" } as unknown;
    expect(isDeviation(badKind)).toBe(false);

    const badStatus = { ...validDeviation, status: "closed" } as unknown;
    expect(isDeviation(badStatus)).toBe(false);

    const missingCorrection = { ...validDeviation, correction: null } as unknown;
    expect(isDeviation(missingCorrection)).toBe(false);
  });

  it("rejects malformed accepted deviations", () => {
    expect(isAcceptedDeviation(null)).toBe(false);
    expect(isAcceptedDeviation([])).toBe(false);
    expect(isAcceptedDeviation({})).toBe(false);

    const missingEnd = { ...validAccepted, end: undefined } as unknown;
    expect(isAcceptedDeviation(missingEnd)).toBe(false);

    const extraKey = { ...validAccepted, justification: "known exception" } as unknown;
    expect(isAcceptedDeviation(extraKey)).toBe(false);

    const badApplication = { ...validAccepted, applicationId: "018f3d2a-7000-7000-8000-00000000000g" } as unknown;
    expect(isAcceptedDeviation(badApplication)).toBe(false);

    const badStart = { ...validAccepted, start: "2026-01-01 00:00:00" } as unknown;
    expect(isAcceptedDeviation(badStart)).toBe(false);

    const offsetEnd = { ...validAccepted, end: "2026-12-31T23:59:59+00:00" } as unknown;
    expect(isAcceptedDeviation(offsetEnd)).toBe(false);

    const zeroVersion = { ...validAccepted, standardVersion: 0 } as unknown;
    expect(isAcceptedDeviation(zeroVersion)).toBe(false);

    const badSubject = { ...validAccepted, subject: 42 } as unknown;
    expect(isAcceptedDeviation(badSubject)).toBe(false);

    const slotMissingName = {
      ...validAccepted,
      slot: { moduleKind: "design-system", slotKind: "component" },
    } as unknown;
    expect(isAcceptedDeviation(slotMissingName)).toBe(false);

    const emptySlot = { ...validAccepted, slot: {} } as unknown;
    expect(isAcceptedDeviation(emptySlot)).toBe(false);
  });

  it("round-trips every deviation kind and the accepted status", () => {
    expect(isDeviation({ ...validDeviation, status: "accepted" })).toBe(true);
    for (const kind of DEVIATION_KINDS) {
      expect(isDeviation({ ...validDeviation, kind }), `kind ${kind}`).toBe(true);
    }
  });
});
