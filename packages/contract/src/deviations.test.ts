import { describe, expect, it } from "vitest";
import {
  ACCEPTED_DEVIATION_ALERT_API_PATHS,
  ACCEPTED_DEVIATION_API_PATHS,
  DEVIATION_KINDS,
  acceptedDeviationAlertDismissalPath,
  isAcceptedDeviation,
  isAcceptedDeviationAlert,
  isAcceptedDeviationAlertList,
  isAcceptedDeviationAlerts,
  isAcceptedDeviationRecord,
  isAcceptedDeviationRecordList,
  isAlertDismissedResult,
  isDeviation,
  parseDeviationLine,
} from "./index.ts";
import type {
  AcceptedDeviation,
  AcceptedDeviationAlert,
  AcceptedDeviationRecord,
  Deviation,
  DeviationMatchKey,
  EffectiveSlot,
  UuidV7,
} from "./index.ts";

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

const BUYER_ACCOUNT_ID = "018f3d2a-7000-7000-8000-000000000003" as UuidV7;
const RECORD_ID = "018f3d2a-7000-7000-8000-00000000000a" as UuidV7;

const validRecord: AcceptedDeviationRecord = {
  id: RECORD_ID,
  applicationId: APPLICATION_ID,
  standardId: STANDARD_ID,
  standardVersion: 3,
  slot,
  subject: "lodash",
  start: "2026-01-01T00:00:00.000Z",
  end: "2026-12-31T23:59:59.000Z",
  buyer: { accountId: BUYER_ACCOUNT_ID, name: "Bea Buyer" },
  justification: "Keep lodash@4.17.21 until the approved entry in this slot is adopted.",
  alertIntervalHours: 168,
  createdAt: "2026-09-30T12:00:00.000Z",
};

describe("Accepted-deviation API paths", () => {
  it("names the registry's acceptance surface exactly", () => {
    expect(ACCEPTED_DEVIATION_API_PATHS.acceptedDeviations).toBe("/v1/accepted-deviations");
  });
});

describe("parseDeviationLine", () => {
  const matchKey: DeviationMatchKey = { standardId: STANDARD_ID, slot, subject: "lodash" };

  it("parses a gate-formatted line back into its match key", () => {
    const line = `${STANDARD_ID} code-stack/library/Lodash lodash: The Standard ${STANDARD_ID} prohibits lodash; use the approved library ramda instead.`;
    expect(parseDeviationLine(line)).toEqual(matchKey);
  });

  it("round-trips colons and spaces in the subject and the correction", () => {
    // A subject may carry colons as long as none starts the `": "` separator.
    const subject = "lodash version 4:17:21, the old one";
    const slot: EffectiveSlot = { moduleKind: "design-system", slotKind: "import", name: "legacy-util" };
    const line = `${STANDARD_ID} design-system/import/legacy-util ${subject}: correction: with "a colon", and spaces`;
    expect(parseDeviationLine(line)).toEqual({ standardId: STANDARD_ID, slot, subject });
  });

  it("accepts surrounding whitespace (a CI log carries the line inside its output)", () => {
    const line = `\t ${STANDARD_ID} code-stack/library/Lodash lodash: correction \n`;
    expect(parseDeviationLine(line)).toEqual(matchKey);
  });

  it("rejects everything that is not exactly the gate grammar", () => {
    expect(parseDeviationLine("")).toBeNull();
    expect(parseDeviationLine("noseparator")).toBeNull();
    expect(parseDeviationLine(STANDARD_ID)).toBeNull();
    // no colon separator
    expect(parseDeviationLine(`${STANDARD_ID} code-stack/library/Lodash lodash`)).toBeNull();
    expect(parseDeviationLine(`${STANDARD_ID} code-stack/library/Lodash lodash:x`)).toBeNull();
    expect(parseDeviationLine(`${STANDARD_ID} code-stack/library/Lodash : x`)).toBeNull();
    // malformed slot tokens
    expect(parseDeviationLine(`${STANDARD_ID} library/Lodash lodash: x`)).toBeNull();
    // empty slot parts or an unknown Module kind
    expect(parseDeviationLine(`${STANDARD_ID} code-stack//Lodash lodash: x`)).toBeNull();
    expect(parseDeviationLine(`${STANDARD_ID} code-stack/library/ lodash: x`)).toBeNull();
    expect(parseDeviationLine(`${STANDARD_ID} not-a-kind/library/Lodash lodash: x`)).toBeNull();
    // empty subject
    expect(parseDeviationLine(`${STANDARD_ID} code-stack/library/Lodash : colon`)).toBeNull();
    // a non-UUID id is not a Gate line (it can never round-trip a key)
    expect(parseDeviationLine(`not-a-uuid code-stack/library/Lodash lodash: x`)).toBeNull();
  });

  it("never throws on non-line input", () => {
    for (const value of [undefined as unknown as string, null as unknown as string, 7 as unknown as string]) {
      expect(parseDeviationLine(value)).toBeNull();
    }
  });
});

describe("accepted deviation record guard", () => {
  it("round-trips a valid record through JSON", () => {
    expect(isAcceptedDeviationRecord(validRecord)).toBe(true);
    expect(isAcceptedDeviationRecord(JSON.parse(JSON.stringify(validRecord)) as unknown)).toBe(true);
    expect(isAcceptedDeviationRecordList([validRecord])).toBe(true);
    expect(isAcceptedDeviationRecordList([JSON.parse(JSON.stringify(validRecord))])).toBe(true);
  });

  it("rejects malformed records", () => {
    expect(isAcceptedDeviationRecord(null)).toBe(false);
    expect(isAcceptedDeviationRecord("record")).toBe(false);
    expect(isAcceptedDeviationRecord([])).toBe(false);
    expect(isAcceptedDeviationRecord({})).toBe(false);
    expect(isAcceptedDeviationRecordList(null)).toBe(false);
    expect(isAcceptedDeviationRecordList({})).toBe(false);
    expect(isAcceptedDeviationRecordList([validRecord, { bad: 1 }])).toBe(false);

    const missingEnd = { ...validRecord, end: undefined } as unknown;
    expect(isAcceptedDeviationRecord(missingEnd)).toBe(false);

    const extraKey = { ...validRecord, correction: "not stored on the record" } as unknown;
    expect(isAcceptedDeviationRecord(extraKey)).toBe(false);

    const badId = { ...validRecord, id: "not-a-uuid" } as unknown;
    expect(isAcceptedDeviationRecord(badId)).toBe(false);

    const badApplication = { ...validRecord, applicationId: 42 } as unknown;
    expect(isAcceptedDeviationRecord(badApplication)).toBe(false);

    const badStandard = { ...validRecord, standardId: "018f3d2a-7000-7000-8000-00000000000g" } as unknown;
    expect(isAcceptedDeviationRecord(badStandard)).toBe(false);

    const zeroVersion = { ...validRecord, standardVersion: 0 } as unknown;
    expect(isAcceptedDeviationRecord(zeroVersion)).toBe(false);

    const emptySlot = { ...validRecord, slot: null } as unknown;
    expect(isAcceptedDeviationRecord(emptySlot)).toBe(false);

    const badStart = { ...validRecord, start: "2026-01-01 00:00:00" } as unknown;
    expect(isAcceptedDeviationRecord(badStart)).toBe(false);

    const offsetEnd = { ...validRecord, end: "2026-12-31T23:59:59+00:00" } as unknown;
    expect(isAcceptedDeviationRecord(offsetEnd)).toBe(false);

    const badBuyer = { ...validRecord, buyer: { accountId: "not-a-uuid", name: "Bea" } } as unknown;
    expect(isAcceptedDeviationRecord(badBuyer)).toBe(false);

    const namelessBuyer = { ...validRecord, buyer: { accountId: BUYER_ACCOUNT_ID, name: 7 } } as unknown;
    expect(isAcceptedDeviationRecord(namelessBuyer)).toBe(false);

    const textualJustification = { ...validRecord, justification: null } as unknown;
    expect(isAcceptedDeviationRecord(textualJustification)).toBe(false);

    for (const interval of [0, 8761, 1.5, "168", null]) {
      const badInterval = { ...validRecord, alertIntervalHours: interval } as unknown;
      expect(isAcceptedDeviationRecord(badInterval), `interval ${String(interval)}`).toBe(false);
    }

    const badCreatedAt = { ...validRecord, createdAt: "yesterday" } as unknown;
    expect(isAcceptedDeviationRecord(badCreatedAt)).toBe(false);
  });

  it("rejects records whose subject, justification or slot name are empty after trimming", () => {
    for (const overrides of [{ subject: "" }, { subject: "   " }, { justification: "" }, { justification: "  " }, { slot: { ...slot, name: "" } }, { slot: { ...slot, name: "  " } }]) {
      const emptied = { ...validRecord, ...overrides } as unknown;
      expect(isAcceptedDeviationRecord(emptied), `case ${JSON.stringify(overrides)}`).toBe(false);
    }
    // The guard sticks the trimmed non-empty values.
    expect(isAcceptedDeviationRecord({ ...validRecord, subject: " lodash " })).toBe(true);
    expect(isAcceptedDeviationRecord({ ...validRecord, slot: { ...slot, name: " Lodash " } })).toBe(true);
  });

  it("accepts the interval bounds 1 and 8760", () => {
    expect(isAcceptedDeviationRecord({ ...validRecord, alertIntervalHours: 1 })).toBe(true);
    expect(isAcceptedDeviationRecord({ ...validRecord, alertIntervalHours: 8760 })).toBe(true);
  });
});

describe("Accepted-deviation alert API paths", () => {
  it("names the registry's alert surface and its dismissal path exactly", () => {
    expect(ACCEPTED_DEVIATION_ALERT_API_PATHS.alerts).toBe("/v1/accepted-deviation-alerts");
    expect(acceptedDeviationAlertDismissalPath(RECORD_ID)).toBe(
      `/v1/accepted-deviation-alerts/${RECORD_ID}/dismissal`,
    );
  });

  it("escapes a path id so it cannot change the route shape", () => {
    expect(acceptedDeviationAlertDismissalPath("a/b")).toBe("/v1/accepted-deviation-alerts/a%2Fb/dismissal");
  });
});

describe("Accepted-deviation alert guards", () => {
  const ALERT_ID = "018f3d2a-7000-7000-8000-00000000000b" as UuidV7;
  const ACCEPTANCE_ID = "018f3d2a-7000-7000-8000-00000000000c" as UuidV7;

  const validAlert: AcceptedDeviationAlert = {
    id: ALERT_ID,
    acceptanceId: ACCEPTANCE_ID,
    applicationId: APPLICATION_ID,
    applicationName: "Expense cards",
    standardId: STANDARD_ID,
    standardVersion: 3,
    slot,
    subject: "lodash",
    end: "2026-12-31T23:59:59.000Z",
    dueAt: "2026-10-14T09:00:00.000Z",
    raisedAt: "2026-10-14T09:00:01.000Z",
  };

  it("round-trips a valid alert, its list and the { alerts } envelope through JSON", () => {
    expect(isAcceptedDeviationAlert(validAlert)).toBe(true);
    expect(isAcceptedDeviationAlert(JSON.parse(JSON.stringify(validAlert)) as unknown)).toBe(true);
    expect(isAcceptedDeviationAlertList([validAlert])).toBe(true);
    expect(isAcceptedDeviationAlerts({ alerts: [validAlert] })).toBe(true);
    expect(isAcceptedDeviationAlerts({ alerts: [] })).toBe(true);
    expect(isAcceptedDeviationAlerts(JSON.parse(JSON.stringify({ alerts: [validAlert] })))).toBe(true);
  });

  it("rejects alert shapes that are not the envelope, list or dismissal result", () => {
    expect(isAcceptedDeviationAlertList(null)).toBe(false);
    expect(isAcceptedDeviationAlertList({})).toBe(false);
    expect(isAcceptedDeviationAlertList([validAlert, { bad: 1 }])).toBe(false);
    expect(isAcceptedDeviationAlerts(null)).toBe(false);
    expect(isAcceptedDeviationAlerts([validAlert])).toBe(false);
    expect(isAcceptedDeviationAlerts({ alerts: {} })).toBe(false);
    expect(isAcceptedDeviationAlerts({ alerts: [validAlert], extra: true })).toBe(false);
    expect(isAcceptedDeviationAlerts({ records: [validAlert] })).toBe(false);
  });

  it("rejects malformed alerts", () => {
    expect(isAcceptedDeviationAlert(null)).toBe(false);
    expect(isAcceptedDeviationAlert("alert")).toBe(false);
    expect(isAcceptedDeviationAlert([])).toBe(false);
    expect(isAcceptedDeviationAlert({})).toBe(false);

    const badCase = (label: string, overrides: Record<string, unknown>): void => {
      const broken = { ...validAlert, ...overrides } as unknown;
      expect(isAcceptedDeviationAlert(broken), label).toBe(false);
    };

    badCase("a missing raisedAt", { raisedAt: undefined });
    badCase("an extra key", { kind: "prohibited" });
    badCase("a non-UUID id", { id: "not-a-uuid" });
    badCase("an uppercase id", { id: (ALERT_ID as string).toUpperCase() });
    badCase("a non-UUID acceptance", { acceptanceId: 42 });
    badCase("a non-UUID application", { applicationId: "018f3d2a-7000-7000-8000-00000000000g" });
    badCase("a non-UUID standard", { standardId: null });
    badCase("a zero version", { standardVersion: 0 });
    badCase("a fractional version", { standardVersion: 1.5 });
    badCase("an empty application name", { applicationName: "   " });
    badCase("a numeric application name", { applicationName: 7 });
    badCase("an empty subject", { subject: "" });
    badCase("an empty slot name", { slot: { ...slot, name: "" } });
    badCase("a whitespace slot name", { slot: { ...slot, name: "  " } });
    badCase("a slotless object", { slot: {} });
    badCase("a null slot", { slot: null });
    badCase("an unknown module kind", { slot: { moduleKind: "tree", slotKind: "library", name: "x" } });
    badCase("a non-ISO end", { end: "2026-12-31 23:59:59" });
    badCase("an offset dueAt", { dueAt: "2026-10-14T09:00:00+00:00" });
    // `isUtcIso` is regex-only: a calendar-invalid instant (February 30) rolls
    // over and passes here, exactly as in the 5.5 record guard; the registry's
    // window gate rejects calendar-invalid instants, so none is ever stored.
    badCase("a NaN date", { dueAt: "not-a-date" });
  });

  it("accepts alerts whose subject, application name or slot name carry surrounding whitespace", () => {
    expect(isAcceptedDeviationAlert({ ...validAlert, subject: " lodash " })).toBe(true);
    expect(isAcceptedDeviationAlert({ ...validAlert, applicationName: " Expense cards " })).toBe(true);
    expect(isAcceptedDeviationAlert({ ...validAlert, slot: { ...slot, name: " Lodash " } })).toBe(true);
  });

  it("accepts only { dismissed: true } as the dismissal result", () => {
    expect(isAlertDismissedResult({ dismissed: true })).toBe(true);
    expect(isAlertDismissedResult(JSON.parse(JSON.stringify({ dismissed: true })))).toBe(true);
    expect(isAlertDismissedResult(null)).toBe(false);
    expect(isAlertDismissedResult([])).toBe(false);
    expect(isAlertDismissedResult({})).toBe(false);
    expect(isAlertDismissedResult({ dismissed: false })).toBe(false);
    expect(isAlertDismissedResult({ dismissed: "true" })).toBe(false);
    expect(isAlertDismissedResult({ dismissed: true, extra: 1 })).toBe(false);
  });
});
