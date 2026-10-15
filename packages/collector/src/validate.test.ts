import { describe, expect, it } from "vitest";
import { COMPILATION_CATALOG_VERSION } from "@domain-harness/contract";
import type { UuidV7 } from "@domain-harness/contract";
import {
  projectBindingRefusalCompilation,
  projectBundleStatusCompilation,
  projectCollectorHealthCompilation,
  projectDeviationCompilation,
  projectGateRunCompilation,
  projectGuidanceCompilation,
} from "./project.ts";
import { DROP_REASONS, DropLedger, validateForSend } from "./validate.ts";

const APP = "01928c7e-5b2a-7c3d-9e4f-a1b2c3d4e5f7" as UuidV7;
const KEY = "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e5f6" as UuidV7;
const STANDARD = "01928c7e-5b2a-7c3d-ae4f-a1b2c3d4e5f8" as UuidV7;
const AT = "2026-10-15T12:00:00.000Z";
const HASH = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

function guidance(): Record<string, unknown> {
  return {
    type: "guidance",
    schemaVersion: "1.0.0",
    catalogVersion: COMPILATION_CATALOG_VERSION,
    idempotencyKey: KEY,
    applicationId: APP,
    agentToolName: "claude-code",
    occurredAt: AT,
    sequence: 1,
    tool: "code_stack_rule",
    outcome: "hit",
    subject: { kind: "slot-token", slotToken: "code-stack/library/React" },
  };
}

describe("validateForSend", () => {
  it("accepts a projected Compilation whole", () => {
    const projected = projectGuidanceCompilation(
      {
        id: KEY,
        applicationId: APP,
        sequence: 3,
        tool: "code_stack_rule",
        subject: "code-stack/library/React",
        outcome: { kind: "hit", standardId: "s", version: 1 },
        agentTool: "claude-code",
        bundleHash: HASH,
        createdAt: AT,
      },
      { sequence: 1, tenantKey: "tenant-key" },
    );
    const result = validateForSend(JSON.parse(JSON.stringify(projected)) as unknown);
    expect(result).toEqual({ ok: true, compilation: projected });
  });

  it("accepts one projected Compilation of every other type whole", () => {
    const record = { applicationId: APP, agentToolName: "cursor", sequence: 2, occurredAt: AT };
    const projected = [
      projectGateRunCompilation(
        { applicationId: APP, revision: "rev-1", deviations: [], checked: 1, open: 0, createdAt: AT },
        { sequence: 2, agentToolName: "cursor" },
      ),
      projectDeviationCompilation(
        {
          standardId: STANDARD,
          standardVersion: 1,
          slot: { moduleKind: "code-stack", slotKind: "library", name: "React" },
          subject: "React",
          kind: "prohibited",
          status: "open",
          correction: "Remove React.",
        },
        record,
      ),
      projectBindingRefusalCompilation({ reason: "unavailable", sentence: "The store was down." }, record),
      projectBundleStatusCompilation({ bundleHash: HASH, bundleSequence: 1, issuedAt: AT }, record),
      projectCollectorHealthCompilation({ pendingCount: 0, droppedByReason: {} }, record),
    ];
    for (const compilation of projected) {
      const result = validateForSend(JSON.parse(JSON.stringify(compilation)) as unknown);
      expect(result).toEqual({ ok: true, compilation });
    }
  });

  it("drops an unknown major schema version, naming schemaVersion", () => {
    const result = validateForSend({ ...guidance(), schemaVersion: "2.0.0" });
    expect(result).toEqual({
      ok: false,
      dropped: true,
      reason: "schema_failed",
      subject: "schemaVersion",
      message: expect.stringContaining("major 1") as string,
    });
  });

  it("drops a wrong catalog version, naming catalogVersion", () => {
    const result = validateForSend({ ...guidance(), catalogVersion: "9.9.9" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.dropped).toBe(true);
      expect(result.reason).toBe("schema_failed");
      expect(result.subject).toBe("catalogVersion");
    }
  });

  it("drops a calendar-invalid instant whole, naming occurredAt", () => {
    const result = validateForSend({ ...guidance(), occurredAt: "2026-02-30T12:00:00.000Z" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.dropped).toBe(true);
      expect(result.subject).toBe("occurredAt");
    }
  });

  it("drops an int4-overflowing sequence whole, naming sequence", () => {
    const result = validateForSend({ ...guidance(), sequence: 2_147_483_648 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.dropped).toBe(true);
      expect(result.subject).toBe("sequence");
    }
  });

  it("drops an extra key whole, naming it, and a missing key whole", () => {
    const extra = validateForSend({ ...guidance(), smuggled: "prompt text" });
    expect(extra.ok).toBe(false);
    if (!extra.ok) {
      expect(extra.subject).toBe("smuggled");
      expect(extra.reason).toBe("schema_failed");
    }
    const missing: Record<string, unknown> = { ...guidance() };
    delete missing["tool"];
    const missingResult = validateForSend(missing);
    expect(missingResult.ok).toBe(false);
    if (!missingResult.ok) expect(missingResult.subject).toBe("tool");
  });

  it("drops raw-text subjects and non-objects whole with no partial value", () => {
    for (const value of [
      { ...guidance(), subject: "React" },
      { ...guidance(), subject: { kind: "slot-token", slotToken: "React" } },
      { ...guidance(), type: "guidance_note" },
      undefined,
      null,
      "guidance",
      [],
    ]) {
      const result = validateForSend(value);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.dropped).toBe(true);
        expect(result.reason).toBe("schema_failed");
        expect("compilation" in result).toBe(false);
      }
    }
  });

  it("drops one invalid body per non-guidance type, naming its subject", () => {
    const envelope = {
      schemaVersion: "1.0.0",
      catalogVersion: COMPILATION_CATALOG_VERSION,
      idempotencyKey: KEY,
      applicationId: APP,
      agentToolName: "cursor",
      occurredAt: AT,
      sequence: 1,
    };
    const deviation = {
      standardId: STANDARD,
      standardVersion: 1,
      slot: { moduleKind: "code-stack", slotKind: "library", name: "React" },
      subject: "React",
      kind: "prohibited",
      status: "open",
      correction: "Remove React.",
    };
    const cases: Array<{ body: Record<string, unknown>; subject: string }> = [
      {
        body: {
          ...envelope,
          type: "gate_run",
          revision: "rev-1",
          verdict: "maybe",
          checkedCount: 1,
          openCount: 0,
          deviations: [],
        },
        subject: "verdict",
      },
      {
        body: { ...envelope, type: "deviation", deviation: { ...deviation, kind: "nope" } },
        subject: "deviation",
      },
      {
        body: { ...envelope, type: "binding_refusal", reason: "refused", sentence: "No." },
        subject: "reason",
      },
      {
        body: {
          ...envelope,
          type: "bundle_status",
          bundleHash: "not-hex",
          bundleSequence: 1,
          issuedAt: AT,
        },
        subject: "bundleHash",
      },
      {
        body: { ...envelope, type: "collector_health", pendingCount: -1, droppedByReason: {} },
        subject: "pendingCount",
      },
    ];
    for (const { body, subject } of cases) {
      expect(validateForSend(body)).toEqual({
        ok: false,
        dropped: true,
        reason: "schema_failed",
        subject,
        message: expect.any(String) as string,
      });
    }
  });

  it("keeps the drop-reason vocabulary closed at schema_failed", () => {
    expect([...DROP_REASONS]).toEqual(["schema_failed"]);
  });
});

describe("DropLedger", () => {
  it("counts drops by reason and snapshots the droppedByReason map", () => {
    const ledger = new DropLedger();
    expect(ledger.snapshot()).toEqual({});
    ledger.record("schema_failed");
    ledger.record("schema_failed");
    expect(ledger.snapshot()).toEqual({ schema_failed: 2 });
  });

  it("counts a validation drop end to end", () => {
    const ledger = new DropLedger();
    const result = validateForSend({
      ...guidance(),
      applicationId: STANDARD.replace("a", "A"),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) ledger.record(result.reason);
    expect(ledger.snapshot()).toEqual({ schema_failed: 1 });
  });
});
