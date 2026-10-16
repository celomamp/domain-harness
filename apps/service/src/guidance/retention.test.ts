// Suite for the retention sweep (Story 6.7): boundary deletion, counts, and
// the never-throw authenticated fetch with its 90-day fallback contract.
import { describe, expect, it, vi } from "vitest";
import { createInMemoryGuidanceEventStore } from "./events.ts";
import type { GuidanceEventInput } from "./events.ts";
import { fetchRetentionDays, sweepGuidanceEvents } from "./retention.ts";
import type { UuidV7 } from "@domain-harness/contract";

const APP = "018f3d2a-7000-7000-8000-000000000001" as UuidV7;
const HASH = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const NOW = new Date("2026-10-16T12:00:00.000Z");

async function recordAt() {
  const store = createInMemoryGuidanceEventStore();
  const input: GuidanceEventInput = {
    applicationId: APP,
    tool: "code_stack_rule",
    subject: "React",
    outcome: { kind: "miss" },
    agentTool: null,
    bundleHash: HASH,
  };
  const event = await store.appendGuidanceEvent(input);
  return { store, event };
}

describe("sweepGuidanceEvents", () => {
  it("deletes rows strictly before the cutoff and keeps the boundary", async () => {
    const { store } = await recordAt();
    const events = await store.listGuidanceEvents(APP);
    const createdAt = events[0]?.createdAt ?? "";
    expect(await store.deleteGuidanceEventsOlderThan(createdAt)).toBe(0);
    expect(await store.countGuidanceEvents(APP)).toBe(1);
    expect(await store.deleteGuidanceEventsOlderThan("2999-01-01T00:00:00.000Z")).toBe(1);
    expect(await store.countGuidanceEvents(APP)).toBe(0);
  });

  it("returns the setting alongside the deleted count", async () => {
    const { store } = await recordAt();
    const result = await sweepGuidanceEvents({ store, retentionDays: 30, now: NOW });
    expect(result).toEqual({ retentionDays: 30, deleted: 0 });
  });
});

describe("fetchRetentionDays", () => {
  const input = { baseUrl: "http://registry.test", credential: "tenant-credential" };

  it("returns the registry's setting on a guarded 200", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ retentionDays: 30 }), { status: 200 })));
    const result = await fetchRetentionDays({ ...input, fetchImpl: fetchImpl });
    expect(result).toEqual({ ok: true, days: 30 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://registry.test/v1/guidance-access/retention");
    expect((init.headers as Record<string, string>)["authorization"]).toBe("Bearer tenant-credential");
  });

  it("answers no value on refusal, bad status, bad body or transport failure", async () => {
    const refused = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ code: "session_invalid" }), { status: 401 })),
    );
    expect(await fetchRetentionDays({ ...input, fetchImpl: refused })).toEqual({ ok: false });
    const outOfRange = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ retentionDays: 0 }), { status: 200 })));
    expect(await fetchRetentionDays({ ...input, fetchImpl: outOfRange })).toEqual({ ok: false });
    const notJson = vi.fn(() => Promise.resolve(new Response("nope", { status: 200 })));
    expect(await fetchRetentionDays({ ...input, fetchImpl: notJson })).toEqual({ ok: false });
    const down = vi.fn(() => Promise.reject(new Error("unreachable")));
    expect(await fetchRetentionDays({ ...input, fetchImpl: down })).toEqual({ ok: false });
  });
});
