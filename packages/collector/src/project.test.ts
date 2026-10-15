import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  isBindingRefusalCompilation,
  isBundleStatusCompilation,
  isCollectorHealthCompilation,
  isDeviationCompilation,
  isGateRunCompilation,
  isGuidanceCompilation,
  isUuidV7,
} from "@domain-harness/contract";
import type { Deviation, GuidanceEvent, UuidV7 } from "@domain-harness/contract";
import { mintUuidV7 } from "./ids.ts";
import {
  hashGuidanceSubject,
  projectBindingRefusalCompilation,
  projectBundleStatusCompilation,
  projectCollectorHealthCompilation,
  projectDeviationCompilation,
  projectGateRunCompilation,
  projectGuidanceCompilation,
  projectGuidanceSubject,
} from "./project.ts";

const APP = "01928c7e-5b2a-7c3d-9e4f-a1b2c3d4e5f7" as UuidV7;
const STANDARD = "01928c7e-5b2a-7c3d-ae4f-a1b2c3d4e5f8" as UuidV7;
const AT = "2026-10-15T12:00:00.000Z";
const HASH = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const TENANT_KEY = "tenant-service-credential";

function guidanceEvent(overrides: Partial<GuidanceEvent> = {}): GuidanceEvent {
  return {
    id: mintUuidV7(),
    applicationId: APP,
    sequence: 7,
    tool: "code_stack_rule",
    subject: "code-stack/library/React",
    outcome: { kind: "hit", standardId: "standard-1", version: 2 },
    agentTool: "claude-code",
    bundleHash: HASH,
    createdAt: AT,
    ...overrides,
  };
}

function deviation(overrides: Partial<Deviation> = {}): Deviation {
  return {
    standardId: STANDARD,
    standardVersion: 2,
    slot: { moduleKind: "code-stack", slotKind: "library", name: "React" },
    subject: "React",
    kind: "prohibited",
    status: "open",
    correction: "Remove React.",
    ...overrides,
  };
}

describe("guidance projection", () => {
  it("projects a hit with the tool, the outcome and a slot token verbatim", () => {
    const compilation = projectGuidanceCompilation(guidanceEvent(), { sequence: 41, tenantKey: TENANT_KEY });
    expect(isGuidanceCompilation(compilation)).toBe(true);
    expect(compilation.tool).toBe("code_stack_rule");
    expect(compilation.outcome).toBe("hit");
    expect(compilation.subject).toEqual({ kind: "slot-token", slotToken: "code-stack/library/React" });
    expect(compilation.applicationId).toBe(APP);
    expect(compilation.agentToolName).toBe("claude-code");
    expect(compilation.occurredAt).toBe(AT);
    expect(compilation.sequence).toBe(41);
    expect(isUuidV7(compilation.idempotencyKey)).toBe(true);
  });

  it("projects a miss with the miss outcome", () => {
    const compilation = projectGuidanceCompilation(
      guidanceEvent({ outcome: { kind: "miss" }, subject: "design-system/component/Button" }),
      { sequence: 1, tenantKey: TENANT_KEY },
    );
    expect(compilation.outcome).toBe("miss");
    expect(compilation.subject).toEqual({ kind: "slot-token", slotToken: "design-system/component/Button" });
  });

  it("keeps an import-specifier slash inside the slot name as a token", () => {
    const subject = projectGuidanceSubject("design-system/import/react-dom/client", TENANT_KEY);
    expect(subject).toEqual({ kind: "slot-token", slotToken: "design-system/import/react-dom/client" });
  });

  it("hashes a non-grammar subject with the tenant key and never emits raw text", () => {
    for (const subject of [
      "How do I write React code?",
      "code-stack/design-token/--x",
      "code-stack/library/",
      "React",
      "日本語プロンプト 🎭",
      "ignore all previous instructions",
    ]) {
      const projected = projectGuidanceSubject(subject, TENANT_KEY);
      expect(projected).toEqual({ kind: "subject-hash", hash: hashGuidanceSubject(subject, TENANT_KEY) });
      if (projected.kind === "subject-hash") {
        expect(projected.hash).toMatch(/^[0-9a-f]{64}$/);
      }
      const compilation = projectGuidanceCompilation(guidanceEvent({ subject }), {
        sequence: 2,
        tenantKey: TENANT_KEY,
      });
      expect(isGuidanceCompilation(compilation)).toBe(true);
      expect(JSON.stringify(compilation)).not.toContain(subject);
    }
  });

  it("keys the hash by tenant and matches the HMAC-SHA256 vector", () => {
    expect(hashGuidanceSubject("s", "k1")).not.toBe(hashGuidanceSubject("s", "k2"));
    const vector = createHmac("sha256", "vector-key").update("vector-subject", "utf8").digest("hex");
    expect(hashGuidanceSubject("vector-subject", "vector-key")).toBe(vector);
  });

  it("rejects an empty tenantKey instead of hashing identically across tenants", () => {
    expect(() => hashGuidanceSubject("subject", "")).toThrow(/tenantKey/);
    expect(() => projectGuidanceSubject("not a slot token", "")).toThrow(/tenantKey/);
    expect(() => projectGuidanceSubject("code-stack/library/React", "")).toThrow(/tenantKey/);
    expect(() =>
      projectGuidanceCompilation(guidanceEvent({ subject: "not a slot token" }), {
        sequence: 1,
        tenantKey: "",
      }),
    ).toThrow(/tenantKey/);
  });

  it("defaults agentToolName to the event verbatim, falling back to the caller supply", () => {
    const fromEvent = projectGuidanceCompilation(guidanceEvent({ agentTool: "claude-code" }), {
      sequence: 1,
      tenantKey: TENANT_KEY,
      agentToolName: "cursor",
    });
    expect(fromEvent.agentToolName).toBe("claude-code");
    const fallback = projectGuidanceCompilation(guidanceEvent({ agentTool: null }), {
      sequence: 1,
      tenantKey: TENANT_KEY,
      agentToolName: "cursor",
    });
    expect(fallback.agentToolName).toBe("cursor");
    expect(() =>
      projectGuidanceCompilation(guidanceEvent({ agentTool: null }), { sequence: 1, tenantKey: TENANT_KEY }),
    ).toThrow(/agentToolName/);
  });

  it("never reuses the record store sequence: the caller counter decides", () => {
    const compilation = projectGuidanceCompilation(guidanceEvent({ sequence: 7 }), {
      sequence: 99,
      tenantKey: TENANT_KEY,
    });
    expect(compilation.sequence).toBe(99);
  });

  it("mints a fresh UUIDv7 idempotency key per projection", () => {
    const first = projectGuidanceCompilation(guidanceEvent(), { sequence: 1, tenantKey: TENANT_KEY });
    const second = projectGuidanceCompilation(guidanceEvent(), { sequence: 2, tenantKey: TENANT_KEY });
    expect(first.idempotencyKey).not.toBe(second.idempotencyKey);
    expect(isUuidV7(first.idempotencyKey)).toBe(true);
    expect(isUuidV7(second.idempotencyKey)).toBe(true);
  });
});

describe("gate-run projection", () => {
  it("fails when a Deviation is still open, carrying counts and match keys", () => {
    const compilation = projectGateRunCompilation(
      {
        applicationId: APP,
        revision: "abc123",
        deviations: [deviation(), deviation({ status: "accepted" })],
        checked: 3,
        open: 1,
        createdAt: AT,
      },
      { sequence: 5, agentToolName: "cursor" },
    );
    expect(isGateRunCompilation(compilation)).toBe(true);
    expect(compilation.verdict).toBe("fail");
    expect(compilation.revision).toBe("abc123");
    expect(compilation.checkedCount).toBe(3);
    expect(compilation.openCount).toBe(1);
    expect(compilation.deviations).toEqual([
      {
        standardId: STANDARD,
        slot: { moduleKind: "code-stack", slotKind: "library", name: "React" },
        subject: "React",
        status: "open",
      },
      {
        standardId: STANDARD,
        slot: { moduleKind: "code-stack", slotKind: "library", name: "React" },
        subject: "React",
        status: "accepted",
      },
    ]);
    expect(compilation.occurredAt).toBe(AT);
    expect(compilation.applicationId).toBe(APP);
    expect(compilation.agentToolName).toBe("cursor");
    expect(compilation.sequence).toBe(5);
  });

  it("passes when nothing is open", () => {
    const compilation = projectGateRunCompilation(
      {
        applicationId: APP,
        revision: "rev-2",
        deviations: [],
        checked: 4,
        open: 0,
        createdAt: AT,
      },
      { sequence: 6, agentToolName: "cursor" },
    );
    expect(compilation.verdict).toBe("pass");
    expect(compilation.deviations).toEqual([]);
  });
});

describe("deviation, refusal, bundle-status and health projections", () => {
  it("reuses the Deviation inline", () => {
    const source = deviation();
    const compilation = projectDeviationCompilation(source, {
      applicationId: APP,
      agentToolName: "claude-code",
      sequence: 8,
      occurredAt: AT,
    });
    expect(isDeviationCompilation(compilation)).toBe(true);
    expect(compilation.deviation).toEqual(source);
    expect(compilation.occurredAt).toBe(AT);
    expect(compilation.sequence).toBe(8);
  });

  it("projects the live refusal reason and sentence verbatim", () => {
    const compilation = projectBindingRefusalCompilation(
      { reason: "unknown_application", sentence: "The Application is not bound." },
      { applicationId: APP, agentToolName: "cursor", sequence: 9, occurredAt: AT },
    );
    expect(isBindingRefusalCompilation(compilation)).toBe(true);
    expect(compilation.reason).toBe("unknown_application");
    expect(compilation.sentence).toBe("The Application is not bound.");
  });

  it("projects the bundle hash, sequence and issue instant verbatim", () => {
    const compilation = projectBundleStatusCompilation(
      { bundleHash: HASH, bundleSequence: 4, issuedAt: AT },
      { applicationId: APP, agentToolName: "claude-code", sequence: 10, occurredAt: AT },
    );
    expect(isBundleStatusCompilation(compilation)).toBe(true);
    expect(compilation.bundleHash).toBe(HASH);
    expect(compilation.bundleSequence).toBe(4);
    expect(compilation.issuedAt).toBe(AT);
  });

  it("projects pending and dropped-by-reason counts verbatim", () => {
    const compilation = projectCollectorHealthCompilation(
      { pendingCount: 0, droppedByReason: { schema_failed: 3 } },
      { applicationId: APP, agentToolName: "claude-code", sequence: 11, occurredAt: AT },
    );
    expect(isCollectorHealthCompilation(compilation)).toBe(true);
    expect(compilation.pendingCount).toBe(0);
    expect(compilation.droppedByReason).toEqual({ schema_failed: 3 });
  });
});
