import { describe, expect, it } from "vitest";
import { GUIDANCE_EVENT_RETENTION_DAYS, isGuidanceEvent } from "./index.ts";
import type { GuidanceEvent, UuidV7 } from "./index.ts";

const ID = "018f3d2a-7000-7000-8000-000000000001" as UuidV7;
const APP = "018f3d2a-7000-7000-8000-000000000002" as UuidV7;
const STANDARD = "018f3d2a-7000-7000-8000-000000000003" as UuidV7;
const HASH = "a".repeat(64);
const AT = "2026-10-15T12:00:00.000Z";

function validEvent(overrides: Partial<GuidanceEvent> = {}): GuidanceEvent {
  return {
    id: ID,
    applicationId: APP,
    sequence: 1,
    tool: "code_stack_rule",
    subject: "react",
    outcome: { kind: "hit", standardId: STANDARD, version: 2 },
    agentTool: "claude-code",
    bundleHash: HASH,
    createdAt: AT,
    ...overrides,
  };
}

describe("Guidance event contract (Story 4.5)", () => {
  it("versions the 90-day default lifetime", () => {
    expect(GUIDANCE_EVENT_RETENTION_DAYS).toBe(90);
  });

  it("accepts a hit with a target and a miss with a null agent tool", () => {
    expect(isGuidanceEvent(validEvent())).toBe(true);
    expect(
      isGuidanceEvent(validEvent({ outcome: { kind: "miss" }, agentTool: null, tool: "design_token", sequence: 3 })),
    ).toBe(true);
  });

  it("rejects a subject outside 1..1000 code points, a bad hash, an empty standard id and a bad version", () => {
    expect(isGuidanceEvent(validEvent({ subject: "" }))).toBe(false);
    expect(isGuidanceEvent(validEvent({ subject: "x".repeat(1001) }))).toBe(false);
    // 1000 code points (astral: 2000 UTF-16 units) is inside the bound.
    expect(isGuidanceEvent(validEvent({ subject: "🦋".repeat(500) }))).toBe(true);
    expect(isGuidanceEvent(validEvent({ bundleHash: "abc" }))).toBe(false);
    expect(isGuidanceEvent(validEvent({ bundleHash: "A".repeat(64) }))).toBe(false);
    expect(isGuidanceEvent(validEvent({ outcome: { kind: "hit", standardId: "   ", version: 1 } }))).toBe(false);
    expect(isGuidanceEvent(validEvent({ outcome: { kind: "hit", standardId: STANDARD, version: 0 } }))).toBe(false);
    expect(isGuidanceEvent(validEvent({ outcome: { kind: "hit", standardId: STANDARD, version: 1.5 } }))).toBe(false);
  });

  it("rejects bad ids, sequences, tools, agent tools, timestamps and extra keys", () => {
    expect(isGuidanceEvent(validEvent({ id: "nope" as unknown as UuidV7 }))).toBe(false);
    expect(isGuidanceEvent(validEvent({ applicationId: "nope" as unknown as UuidV7 }))).toBe(false);
    expect(isGuidanceEvent(validEvent({ sequence: 0 }))).toBe(false);
    expect(isGuidanceEvent(validEvent({ tool: "not_a_tool" as unknown as GuidanceEvent["tool"] }))).toBe(false);
    expect(isGuidanceEvent(validEvent({ agentTool: "emacs" as unknown as GuidanceEvent["agentTool"] }))).toBe(false);
    expect(isGuidanceEvent(validEvent({ createdAt: "2026-10-15T12:00:00+02:00" }))).toBe(false);
    expect(isGuidanceEvent({ ...validEvent(), extra: 1 })).toBe(false);
    expect(isGuidanceEvent(validEvent({ outcome: { kind: "miss", standardId: STANDARD } as unknown as GuidanceEvent["outcome"] }))).toBe(false);
  });
});
