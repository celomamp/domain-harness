import { describe, expect, it } from "vitest";
import type { GuidanceEvent, UuidV7 } from "@domain-harness/contract";
import { mintUuidV7 } from "./ids.ts";
import { projectGuidanceCompilation } from "./project.ts";
import { InMemoryCollectorOutbox } from "./queue.ts";

const APP = "01928c7e-5b2a-7c3d-9e4f-a1b2c3d4e5f7" as UuidV7;
const APP_TWO = "01928c7e-5b2a-7c3d-9e4f-a1b2c3d4e600" as UuidV7;
const AT = "2026-10-16T12:00:00.000Z";
const HASH = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const TENANT_KEY = "tenant-service-credential";

function guidanceEvent(applicationId: UuidV7 = APP): GuidanceEvent {
  return {
    id: mintUuidV7(),
    applicationId,
    sequence: 7,
    tool: "code_stack_rule",
    subject: "code-stack/library/React",
    outcome: { kind: "hit", standardId: "standard-1", version: 2 },
    agentTool: "claude-code",
    bundleHash: HASH,
    createdAt: AT,
  };
}

describe("InMemoryCollectorOutbox", () => {
  it("allocates one monotonic per-Application sequence across enqueues", async () => {
    const outbox = new InMemoryCollectorOutbox();
    const first = await outbox.enqueue(APP, (sequence) => projectGuidanceCompilation(guidanceEvent(), { sequence, tenantKey: TENANT_KEY }), AT);
    const second = await outbox.enqueue(APP, (sequence) => projectGuidanceCompilation(guidanceEvent(), { sequence, tenantKey: TENANT_KEY }), AT);
    const other = await outbox.enqueue(APP_TWO, (sequence) => projectGuidanceCompilation(guidanceEvent(APP_TWO), { sequence, tenantKey: TENANT_KEY }), AT);
    expect(first).toMatchObject({ stored: true, sequence: 1 });
    expect(second).toMatchObject({ stored: true, sequence: 2 });
    expect(other).toMatchObject({ stored: true, sequence: 1 });
  });

  it("validates before storing: a schema failure drops whole and advances nothing", async () => {
    const outbox = new InMemoryCollectorOutbox();
    const dropped = await outbox.enqueue(APP, () => ({ type: "note" }) as never, AT);
    expect(dropped).toMatchObject({ stored: false, reason: "schema_failed", subject: "type" });
    const next = await outbox.enqueue(APP, (sequence) => projectGuidanceCompilation(guidanceEvent(), { sequence, tenantKey: TENANT_KEY }), AT);
    expect(next).toMatchObject({ stored: true, sequence: 1 });
    await expect(outbox.stats()).resolves.toEqual({ pendingCount: 1, sentCount: 0 });
  });

  it("lists due entries in retry order and hides sent and future entries", async () => {
    const outbox = new InMemoryCollectorOutbox();
    const one = await outbox.enqueue(APP, (sequence) => projectGuidanceCompilation(guidanceEvent(), { sequence, tenantKey: TENANT_KEY }), AT);
    const two = await outbox.enqueue(APP, (sequence) => projectGuidanceCompilation(guidanceEvent(), { sequence, tenantKey: TENANT_KEY }), AT);
    if (!one.stored || !two.stored) throw new Error("setup failed");
    await outbox.noteAttempt(two.idempotencyKey, "2026-10-16T12:05:00.000Z");
    await expect(outbox.listDue(AT, 10).then((rows) => rows.map((row) => row.sequence))).resolves.toEqual([1]);
    await outbox.markSent(one.idempotencyKey);
    await expect(outbox.listDue("2026-10-16T12:05:00.000Z", 10).then((rows) => rows.map((row) => row.sequence))).resolves.toEqual([2]);
    await expect(outbox.stats()).resolves.toEqual({ pendingCount: 1, sentCount: 1 });
  });

  it("derives queue gaps from the watermark minus present rows", async () => {
    const outbox = new InMemoryCollectorOutbox();
    const one = await outbox.enqueue(APP, (sequence) => projectGuidanceCompilation(guidanceEvent(), { sequence, tenantKey: TENANT_KEY }), AT);
    const two = await outbox.enqueue(APP, (sequence) => projectGuidanceCompilation(guidanceEvent(), { sequence, tenantKey: TENANT_KEY }), AT);
    if (!one.stored || !two.stored) throw new Error("setup failed");
    await expect(outbox.detectGaps()).resolves.toEqual([]);
    outbox.removeForTest(one.idempotencyKey);
    await expect(outbox.detectGaps()).resolves.toEqual([{ applicationId: APP, missing: [1] }]);
  });

  it("resequences a refused entry under a fresh sequence, keeping the gap visible", async () => {
    const outbox = new InMemoryCollectorOutbox();
    const one = await outbox.enqueue(APP, (sequence) => projectGuidanceCompilation(guidanceEvent(), { sequence, tenantKey: TENANT_KEY }), AT);
    if (!one.stored) throw new Error("setup failed");
    const fresh = await outbox.resequence(
      one.idempotencyKey,
      (sequence) => ({ ...projectGuidanceCompilation(guidanceEvent(), { sequence: 999, tenantKey: TENANT_KEY }), sequence }),
      AT,
    );
    expect(fresh).toBe(2);
    await expect(outbox.detectGaps()).resolves.toEqual([{ applicationId: APP, missing: [1] }]);
    await expect(outbox.listDue(AT, 10).then((rows) => rows.map((row) => row.sequence))).resolves.toEqual([2]);
  });
});
