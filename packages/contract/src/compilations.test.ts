import { describe, expect, it } from "vitest";
import {
  BINDING_REFUSAL_COMPILATION_SCHEMA_VERSION,
  BUNDLE_STATUS_COMPILATION_SCHEMA_VERSION,
  CATALOG_UNREAD,
  COLLECTOR_HEALTH_COMPILATION_SCHEMA_VERSION,
  COMPILATION_API_PATHS,
  COMPILATION_CATALOG_MAJOR,
  COMPILATION_CATALOG_VERSION,
  COMPILATION_KEYS,
  COMPILATION_SCHEMA_DOCS,
  COMPILATION_TYPE_NAMES,
  DEVIATION_COMPILATION_SCHEMA_VERSION,
  GATE_RUN_COMPILATION_SCHEMA_VERSION,
  GUIDANCE_COMPILATION_SCHEMA_VERSION,
  isBindingRefusalCompilation,
  isBundleStatusCompilation,
  isBundleStatusList,
  isBundleStatusView,
  isCollectorHealthCompilation,
  isCollectorHealthList,
  isCollectorHealthView,
  isCompilation,
  isCompilationCatalogRead,
  isCompilationCatalogReadState,
  isCompilationTypeName,
  isDeviationCompilation,
  isDroppedByReason,
  isGateRunCompilation,
  isGateRunDeviationSummary,
  isGuidanceCompilation,
  isGuidanceCompilationSubject,
  isSupportedCompilationSchemaVersion,
} from "./compilations.ts";
import type { Compilation } from "./compilations.ts";

const KEY = "01928c7e-5b2a-7c3d-8e4f-a1b2c3d4e5f6";
const APP = "01928c7e-5b2a-7c3d-9e4f-a1b2c3d4e5f7";
const STANDARD = "01928c7e-5b2a-7c3d-ae4f-a1b2c3d4e5f8";
const AT = "2026-10-15T12:00:00.000Z";
const HASH = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

function envelope(type: Compilation["type"]): Record<string, unknown> {
  return {
    type,
    schemaVersion: "1.0.0",
    catalogVersion: COMPILATION_CATALOG_VERSION,
    idempotencyKey: KEY,
    applicationId: APP,
    agentToolName: "claude-code",
    occurredAt: AT,
    sequence: 1,
  };
}

const guidance = {
  ...envelope("guidance"),
  tool: "code_stack_rule",
  outcome: "hit",
  subject: { kind: "slot-token", slotToken: "code-stack/library/React" },
};

const gateRun = {
  ...envelope("gate_run"),
  revision: "abc123",
  verdict: "fail",
  checkedCount: 3,
  openCount: 1,
  deviations: [
    {
      standardId: STANDARD,
      slot: { moduleKind: "code-stack", slotKind: "library", name: "React" },
      subject: "React",
      status: "open",
    },
  ],
};

const deviation = {
  ...envelope("deviation"),
  deviation: {
    standardId: STANDARD,
    standardVersion: 2,
    slot: { moduleKind: "code-stack", slotKind: "library", name: "React" },
    subject: "React",
    kind: "prohibited",
    status: "open",
    correction: "Remove React.",
  },
};

const bindingRefusal = {
  ...envelope("binding_refusal"),
  reason: "unknown_application",
  sentence: "The Application is not bound.",
};

const bundleStatus = {
  ...envelope("bundle_status"),
  bundleHash: HASH,
  bundleSequence: 4,
  issuedAt: AT,
};

const collectorHealth = {
  ...envelope("collector_health"),
  pendingCount: 2,
  droppedByReason: { schema_failed: 1 },
};

describe("compilation guards", () => {
  it("accepts one valid Compilation of each of the six types", () => {
    expect(isGuidanceCompilation(guidance)).toBe(true);
    expect(isGateRunCompilation(gateRun)).toBe(true);
    expect(isDeviationCompilation(deviation)).toBe(true);
    expect(isBindingRefusalCompilation(bindingRefusal)).toBe(true);
    expect(isBundleStatusCompilation(bundleStatus)).toBe(true);
    expect(isCollectorHealthCompilation(collectorHealth)).toBe(true);
    for (const value of [guidance, gateRun, deviation, bindingRefusal, bundleStatus, collectorHealth]) {
      expect(isCompilation(value)).toBe(true);
    }
  });

  it("accepts the subject-hash arm and an empty drop map", () => {
    expect(
      isGuidanceCompilationSubject({ kind: "subject-hash", hash: HASH }),
    ).toBe(true);
    expect(
      isGuidanceCompilation({ ...guidance, subject: { kind: "subject-hash", hash: HASH } }),
    ).toBe(true);
    expect(isCollectorHealthCompilation({ ...collectorHealth, droppedByReason: {} })).toBe(true);
    expect(isGateRunCompilation({ ...gateRun, verdict: "pass", openCount: 0, deviations: [] })).toBe(true);
  });

  it("rejects an extra or missing key", () => {
    expect(isGuidanceCompilation({ ...guidance, extra: 1 })).toBe(false);
    const withoutTool: Record<string, unknown> = { ...guidance };
    delete withoutTool["tool"];
    expect(isGuidanceCompilation(withoutTool)).toBe(false);
    expect(isCompilation({ ...gateRun, extra: 1 })).toBe(false);
  });

  it("rejects a bad UUIDv7, timestamp, sequence or agent tool", () => {
    expect(isGuidanceCompilation({ ...guidance, idempotencyKey: "not-a-uuid" })).toBe(false);
    expect(isGuidanceCompilation({ ...guidance, applicationId: STANDARD.replace("a", "A") })).toBe(false);
    expect(isGuidanceCompilation({ ...guidance, occurredAt: "15/10/2026" })).toBe(false);
    expect(isGuidanceCompilation({ ...guidance, occurredAt: "2026-10-15 12:00:00" })).toBe(false);
    expect(isGuidanceCompilation({ ...guidance, sequence: 0 })).toBe(false);
    expect(isGuidanceCompilation({ ...guidance, sequence: 1.5 })).toBe(false);
    expect(isGuidanceCompilation({ ...guidance, agentToolName: "  " })).toBe(false);
  });

  it("rejects a raw-text subject: only slot tokens and 64-hex hashes cross", () => {
    expect(isGuidanceCompilationSubject("React")).toBe(false);
    expect(isGuidanceCompilationSubject({ kind: "slot-token", slotToken: "React" })).toBe(false);
    expect(isGuidanceCompilationSubject({ kind: "slot-token", slotToken: "code-stack/library/" })).toBe(false);
    expect(
      isGuidanceCompilationSubject({ kind: "slot-token", slotToken: "code-stack/design-token/--x" }),
    ).toBe(false);
    expect(isGuidanceCompilationSubject({ kind: "subject-hash", hash: "React" })).toBe(false);
    expect(isGuidanceCompilationSubject({ kind: "subject-hash", hash: HASH.toUpperCase() })).toBe(false);
    expect(isGuidanceCompilationSubject({ kind: "other", slotToken: "code-stack/library/React" })).toBe(false);
    expect(isGuidanceCompilation({ ...guidance, subject: "React" })).toBe(false);
  });

  it("rejects per-type field violations", () => {
    expect(isGuidanceCompilation({ ...guidance, tool: "unknown_tool" })).toBe(false);
    expect(isGuidanceCompilation({ ...guidance, outcome: "unbound" })).toBe(false);
    expect(isGateRunCompilation({ ...gateRun, verdict: "maybe" })).toBe(false);
    expect(isGateRunCompilation({ ...gateRun, checkedCount: -1 })).toBe(false);
    expect(isGateRunCompilation({ ...gateRun, openCount: 1.5 })).toBe(false);
    expect(isGateRunCompilation({ ...gateRun, deviations: [{ ...gateRun.deviations[0], status: "old" }] })).toBe(false);
    expect(isGateRunDeviationSummary({ ...gateRun.deviations[0], subject: "" })).toBe(false);
    expect(isDeviationCompilation({ ...deviation, deviation: { ...deviation.deviation, kind: "nope" } })).toBe(false);
    expect(isBindingRefusalCompilation({ ...bindingRefusal, reason: "refused" })).toBe(false);
    expect(isBindingRefusalCompilation({ ...bindingRefusal, sentence: "" })).toBe(false);
    expect(isBundleStatusCompilation({ ...bundleStatus, bundleHash: "zz" })).toBe(false);
    expect(isBundleStatusCompilation({ ...bundleStatus, bundleSequence: 0 })).toBe(false);
    expect(isBundleStatusCompilation({ ...bundleStatus, issuedAt: "yesterday" })).toBe(false);
    expect(isCollectorHealthCompilation({ ...collectorHealth, pendingCount: -1 })).toBe(false);
    expect(
      isCollectorHealthCompilation({ ...collectorHealth, droppedByReason: { schema_failed: 1.5 } }),
    ).toBe(false);
    expect(isCompilation({ ...guidance, type: "guidance_note" })).toBe(false);
  });

  it("never throws on non-objects", () => {
    for (const value of [undefined, null, 0, "guidance_note", [], true]) {
      expect(isCompilation(value)).toBe(false);
      expect(isGuidanceCompilation(value)).toBe(false);
      expect(isGateRunCompilation(value)).toBe(false);
      expect(isDeviationCompilation(value)).toBe(false);
      expect(isBindingRefusalCompilation(value)).toBe(false);
      expect(isBundleStatusCompilation(value)).toBe(false);
      expect(isCollectorHealthCompilation(value)).toBe(false);
      expect(isGuidanceCompilationSubject(value)).toBe(false);
      expect(isGateRunDeviationSummary(value)).toBe(false);
      expect(isCompilationTypeName(value)).toBe(false);
      expect(isSupportedCompilationSchemaVersion(value)).toBe(false);
      expect(isCompilationCatalogRead(value)).toBe(false);
      expect(isCompilationCatalogReadState(value)).toBe(false);
    }
  });
});

describe("unknown major schema versions", () => {
  it("accepts major 1 and rejects every other major", () => {
    expect(isSupportedCompilationSchemaVersion("1.0.0")).toBe(true);
    expect(isSupportedCompilationSchemaVersion("1.2.3")).toBe(true);
    expect(isSupportedCompilationSchemaVersion("2.0.0")).toBe(false);
    expect(isSupportedCompilationSchemaVersion("0.9.9")).toBe(false);
    expect(isSupportedCompilationSchemaVersion("1.0")).toBe(false);
    expect(isSupportedCompilationSchemaVersion("v1.0.0")).toBe(false);
    expect(isSupportedCompilationSchemaVersion("")).toBe(false);
    expect(isSupportedCompilationSchemaVersion(1)).toBe(false);
  });

  it("rejects a Compilation carrying an unknown major or another catalog version", () => {
    expect(isGuidanceCompilation({ ...guidance, schemaVersion: "2.0.0" })).toBe(false);
    expect(isCompilation({ ...gateRun, schemaVersion: "2.0.0" })).toBe(false);
    expect(isCompilation({ ...guidance, catalogVersion: "9.9.9" })).toBe(false);
  });
});

describe("catalog-read shapes", () => {
  it("accepts the stored record and the read state", () => {
    expect(
      isCompilationCatalogRead({
        catalogVersion: COMPILATION_CATALOG_VERSION,
        readBy: { accountId: KEY, name: "Bea Buyer" },
        readAt: AT,
      }),
    ).toBe(true);
    expect(
      isCompilationCatalogReadState({
        catalogVersion: COMPILATION_CATALOG_VERSION,
        read: true,
        readBy: { accountId: KEY, name: "Bea Buyer" },
        readAt: AT,
      }),
    ).toBe(true);
    expect(
      isCompilationCatalogReadState({
        catalogVersion: COMPILATION_CATALOG_VERSION,
        read: false,
        readBy: null,
        readAt: null,
      }),
    ).toBe(true);
  });

  it("rejects a read state whose flag disagrees with its record", () => {
    expect(
      isCompilationCatalogReadState({
        catalogVersion: COMPILATION_CATALOG_VERSION,
        read: true,
        readBy: null,
        readAt: null,
      }),
    ).toBe(false);
    expect(
      isCompilationCatalogReadState({
        catalogVersion: COMPILATION_CATALOG_VERSION,
        read: false,
        readBy: { accountId: KEY, name: "Bea Buyer" },
        readAt: AT,
      }),
    ).toBe(false);
  });
});

describe("status-view shapes (Story 6.4)", () => {
  const status = {
    applicationId: APP,
    agentToolName: "claude-code",
    bundleHash: HASH,
    bundleSequence: 4,
    issuedAt: AT,
    stalenessBoundHours: 24,
    frozen: false,
  };
  const health = {
    applicationId: APP,
    agentToolName: "claude-code",
    occurredAt: AT,
    pendingCount: 2,
    droppedByReason: { schema_failed: 1 },
  };

  it("accepts the bundle-status and Collector-health views and their envelopes", () => {
    expect(isBundleStatusView(status)).toBe(true);
    expect(isBundleStatusList({ statuses: [status] })).toBe(true);
    expect(isBundleStatusList({ statuses: [] })).toBe(true);
    expect(isCollectorHealthView(health)).toBe(true);
    expect(isCollectorHealthList({ reports: [health] })).toBe(true);
    expect(isCollectorHealthList({ reports: [] })).toBe(true);
    expect(isDroppedByReason({ schema_failed: 1, queue_gap: 0 })).toBe(true);
  });

  it("rejects views with extra or missing keys, bad hashes, instants, counts or bounds", () => {
    expect(isBundleStatusView({ ...status, extra: 1 })).toBe(false);
    expect(isBundleStatusView({ ...status, bundleHash: "not-hex" })).toBe(false);
    expect(isBundleStatusView({ ...status, bundleSequence: 0 })).toBe(false);
    expect(isBundleStatusView({ ...status, bundleSequence: 1.5 })).toBe(false);
    expect(isBundleStatusView({ ...status, issuedAt: "2026-10-15" })).toBe(false);
    expect(isBundleStatusView({ ...status, stalenessBoundHours: 0 })).toBe(false);
    expect(isBundleStatusView({ ...status, stalenessBoundHours: 721 })).toBe(false);
    expect(isBundleStatusView({ ...status, frozen: "no" })).toBe(false);
    expect(isBundleStatusList({ statuses: [{ ...status, frozen: "no" }] })).toBe(false);
    expect(isBundleStatusList({})).toBe(false);
    expect(isCollectorHealthView({ ...health, pendingCount: -1 })).toBe(false);
    expect(isCollectorHealthView({ ...health, droppedByReason: { schema_failed: 1.5 } })).toBe(false);
    expect(isCollectorHealthView({ ...health, occurredAt: "tomorrow" })).toBe(false);
    expect(isCollectorHealthList({ reports: "none" })).toBe(false);
    expect(isDroppedByReason({ schema_failed: -1 })).toBe(false);
  });
});

describe("semver-bump guard", () => {
  it("pins the closed catalog: exactly the six type names at catalog 1.0.0", () => {
    expect(COMPILATION_CATALOG_VERSION).toBe("1.0.0");
    expect(COMPILATION_CATALOG_MAJOR).toBe(1);
    expect(CATALOG_UNREAD).toBe("catalog_unread");
    expect(COMPILATION_API_PATHS).toEqual({
      compilations: "/v1/compilations",
      catalogReads: "/v1/compilation-catalog/reads",
      bundleStatus: "/v1/compilations/bundle-status",
      collectorHealth: "/v1/compilations/collector-health",
    });
    expect([...COMPILATION_TYPE_NAMES]).toEqual([
      "guidance",
      "gate_run",
      "deviation",
      "binding_refusal",
      "bundle_status",
      "collector_health",
    ]);
  });

  it("pins the exact sorted key list and schema version of every type: a new type or field without a bump fails here", () => {
    const pinned: Readonly<Record<string, { version: string; keys: readonly string[] }>> = {
      guidance: {
        version: "1.0.0",
        keys: [
          "agentToolName",
          "applicationId",
          "catalogVersion",
          "idempotencyKey",
          "occurredAt",
          "outcome",
          "schemaVersion",
          "sequence",
          "subject",
          "tool",
          "type",
        ],
      },
      gate_run: {
        version: "1.0.0",
        keys: [
          "agentToolName",
          "applicationId",
          "catalogVersion",
          "checkedCount",
          "deviations",
          "idempotencyKey",
          "occurredAt",
          "openCount",
          "revision",
          "schemaVersion",
          "sequence",
          "type",
          "verdict",
        ],
      },
      deviation: {
        version: "1.0.0",
        keys: [
          "agentToolName",
          "applicationId",
          "catalogVersion",
          "deviation",
          "idempotencyKey",
          "occurredAt",
          "schemaVersion",
          "sequence",
          "type",
        ],
      },
      binding_refusal: {
        version: "1.0.0",
        keys: [
          "agentToolName",
          "applicationId",
          "catalogVersion",
          "idempotencyKey",
          "occurredAt",
          "reason",
          "schemaVersion",
          "sentence",
          "sequence",
          "type",
        ],
      },
      bundle_status: {
        version: "1.0.0",
        keys: [
          "agentToolName",
          "applicationId",
          "bundleHash",
          "bundleSequence",
          "catalogVersion",
          "idempotencyKey",
          "issuedAt",
          "occurredAt",
          "schemaVersion",
          "sequence",
          "type",
        ],
      },
      collector_health: {
        version: "1.0.0",
        keys: [
          "agentToolName",
          "applicationId",
          "catalogVersion",
          "droppedByReason",
          "idempotencyKey",
          "occurredAt",
          "pendingCount",
          "schemaVersion",
          "sequence",
          "type",
        ],
      },
    };
    expect(new Set(Object.keys(pinned))).toEqual(new Set(COMPILATION_TYPE_NAMES));
    const versions: Readonly<Record<string, string>> = {
      guidance: GUIDANCE_COMPILATION_SCHEMA_VERSION,
      gate_run: GATE_RUN_COMPILATION_SCHEMA_VERSION,
      deviation: DEVIATION_COMPILATION_SCHEMA_VERSION,
      binding_refusal: BINDING_REFUSAL_COMPILATION_SCHEMA_VERSION,
      bundle_status: BUNDLE_STATUS_COMPILATION_SCHEMA_VERSION,
      collector_health: COLLECTOR_HEALTH_COMPILATION_SCHEMA_VERSION,
    };
    for (const name of COMPILATION_TYPE_NAMES) {
      const pin = pinned[name];
      if (pin === undefined) throw new Error(`missing pin for ${name}`);
      expect(versions[name]).toBe(pin.version);
      expect([...COMPILATION_KEYS[name]].sort()).toEqual([...pin.keys].sort());
      expect([...COMPILATION_KEYS[name]].sort()).toEqual(pin.keys);
    }
  });

  it("pins the schema-reader copy to the schemas: field names always equal the key list", () => {
    expect(COMPILATION_SCHEMA_DOCS.map((doc) => doc.name)).toEqual([...COMPILATION_TYPE_NAMES]);
    const versions: Readonly<Record<string, string>> = {
      guidance: GUIDANCE_COMPILATION_SCHEMA_VERSION,
      gate_run: GATE_RUN_COMPILATION_SCHEMA_VERSION,
      deviation: DEVIATION_COMPILATION_SCHEMA_VERSION,
      binding_refusal: BINDING_REFUSAL_COMPILATION_SCHEMA_VERSION,
      bundle_status: BUNDLE_STATUS_COMPILATION_SCHEMA_VERSION,
      collector_health: COLLECTOR_HEALTH_COMPILATION_SCHEMA_VERSION,
    };
    for (const doc of COMPILATION_SCHEMA_DOCS) {
      expect(doc.version).toBe(versions[doc.name]);
      expect(doc.fields.map((field) => field.name).sort()).toEqual([...COMPILATION_KEYS[doc.name]].sort());
      for (const field of doc.fields) {
        expect(field.description.trim()).not.toBe("");
      }
    }
  });
});
