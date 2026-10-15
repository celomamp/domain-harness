/**
 * Load suite for the Guidance serving unit (Stories 4.4 + 4.5, NFR-6): many
 * concurrent `serveGuidanceCall`s over the InMemory twins with a
 * realistically-sized bundle, with recording in the path. Guidance never
 * blocks an agent's turn and needs no prior briefing call, so the whole
 * decision — identity, staleness, core resolution, the match and the one
 * event append — must land well under the p95 bound of 500 ms from the
 * bundle cache.
 */
import { describe, expect, it } from "vitest";
import { performance } from "node:perf_hooks";
import type { GuidanceToolName, StandardBundlePayload, StandardInfo, UuidV7 } from "@domain-harness/contract";
import { serveGuidanceCall } from "./serve.ts";
import type { ServeGuidanceCallInput } from "./serve.ts";
import { createInMemoryGuidanceIdentityStore } from "./store.ts";
import { createInMemoryGuidanceEventStore } from "./events.ts";
import { createInMemoryBundleRecordStore } from "../bundles/store.ts";
import { bundleHashOf } from "../bundles/verify.ts";
import { makeBundlePayload, makeSigningKey, signPayload } from "../bundles/test-fixtures.ts";
import { bundledState } from "../bundles/puller.ts";

const TENANT = "018f3d2a-7000-7000-8000-000000000100" as UuidV7;
const APPLICATION_ID = "018f3d2a-7000-7000-8000-000000000001" as UuidV7;
const ROOT = "018f3d2a-7000-7000-8000-000000000110" as UuidV7;
// The caller's Application is bound to the third Project of the tree (`projectIdOf(2)` below).
const PROJECT_A = "018f3d2a-7000-7000-8000-000000011002" as UuidV7;

const NOW = "2026-10-14T12:00:00.000Z";
const ISSUED = "2026-10-14T06:00:00.000Z";
const STANDARD_COUNT = 200;
const CALLS = 400;
/** Concurrent calls at any moment; 400 calls flow through 50 standing workers. */
const CONCURRENCY = 50;
const P95_BOUND_MS = 500;

function projectIdOf(index: number): UuidV7 {
  return `018f3d2a-7000-7000-8000-0000000${String(11000 + index)}` as UuidV7;
}

function standardIdOf(index: number): UuidV7 {
  return `018f3d2a-7000-7000-8000-0000000${String(12000 + index)}` as UuidV7;
}

function accountIdOf(index: number): UuidV7 {
  return `018f3d2a-7000-7000-8000-0000000${String(13000 + index)}` as UuidV7;
}

/** A realistically-sized bundle: 200 Standards in all four entry shapes across an 11-Project tree. */
function makeLargePayload(): StandardBundlePayload {
  const standards: StandardInfo[] = [];
  for (let index = 0; index < STANDARD_COUNT; index += 1) {
    const scope = index % 10 === 0 ? ROOT : projectIdOf(index % 10);
    const module = { id: accountIdOf(index + STANDARD_COUNT), kind: "design-system" as const, name: `Module ${String(index)}` };
    const shape = index % 4;
    const entry =
      shape === 0
        ? {
            kind: "component" as const,
            name: `Component${String(index)}`,
            usageRule: `Use Component${String(index)} when the situation names component${String(index)}.`,
            tokens: [],
            correctionInstruction: null,
          }
        : shape === 1
          ? { kind: "token" as const, name: `token-${String(index)}`, status: "required" as const }
          : shape === 2
            ? { kind: "import" as const, specifier: `~/company/module-${String(index)}`, status: "prohibited" as const }
            : { kind: "token" as const, name: `color-token-${String(index)}`, status: "prohibited" as const };
    standards.push({
      id: standardIdOf(index),
      version: 1,
      module,
      project: { id: scope, name: `Scope ${String(index)}` },
      entry,
      publishedAt: ISSUED,
      publishedBy: { accountId: accountIdOf(index), name: "Bea" },
    });
  }
  const projects = [ROOT, ...Array.from({ length: 10 }, (_unused, index) => projectIdOf(index))].map((id, index) => ({
    id,
    name: index === 0 ? "Root" : `Project ${String(index)}`,
    levelName: null,
    parentId: index === 0 ? null : ROOT,
    createdAt: ISSUED,
  }));
  return {
    ...makeBundlePayload({ keyId: "perf-test-key", sequence: 1, issuedAt: ISSUED }),
    standards,
    tree: { rootId: ROOT, projects, lockedRules: [] },
    applications: [{ id: APPLICATION_ID, projectId: PROJECT_A, fromFlow: true, agentTool: null }],
  };
}

/** The p95 of a set of durations: the value at the 95th percentile, ceiled to the last sample. */
export function p95Of(durations: readonly number[]): number {
  if (durations.length === 0) return 0;
  const sorted = [...durations].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length))] ?? 0;
}

describe("serveGuidanceCall under load (NFR-6)", () => {
  it(`answers ${String(CALLS)} concurrent calls, every call within the p95 bound of ${String(P95_BOUND_MS)} ms`, async () => {
    const payload = makeLargePayload();
    const signed = signPayload(payload, makeSigningKey("perf-test-key"));
    const hash = bundleHashOf(signed);
    const bundleStore = createInMemoryBundleRecordStore();
    await bundleStore.activate(signed, hash, TENANT);
    const identityStore = createInMemoryGuidanceIdentityStore();
    const shared: Pick<ServeGuidanceCallInput, "tenantId" | "now" | "identityStore" | "eventStore" | "getPinnedBundle" | "getBundledState"> = {
      tenantId: TENANT,
      now: NOW,
      identityStore,
      eventStore: createInMemoryGuidanceEventStore(),
      getPinnedBundle: () => Promise.resolve({ payload, hash }),
      getBundledState: (now) => bundledState(bundleStore, TENANT, now),
    };

    const tools: readonly GuidanceToolName[] = ["design_component", "design_token", "design_import", "code_stack_rule"];
    const inputs: ServeGuidanceCallInput[] = Array.from({ length: CALLS }, (_unused, index) => ({
      ...shared,
      headers: { applicationId: APPLICATION_ID, advisoryProjectId: PROJECT_A, repoFingerprint: "1".repeat(64) },
      tool: tools[index % 4] ?? "code_stack_rule",
      subject: `component${String(index % STANDARD_COUNT)}`,
    }));

    const durations: number[] = new Array<number>(CALLS).fill(0);
    // 50 standing workers each run its next call the moment its previous one
    // answers: many concurrent `serveGuidanceCall`s over the same bundle
    // cache, each one stateless (fresh identity decision, no caching between
    // calls). Per-call durations are what an agent's turn would feel.
    let next = 0;
    await Promise.all(
      Array.from({ length: CONCURRENCY }, () =>
        (async () => {
          while (next < CALLS) {
            const current = next;
            next += 1;
            const input = inputs[current];
            if (input === undefined) break;
            const callStart = performance.now();
            const result = await serveGuidanceCall(input);
            durations[current] = performance.now() - callStart;
            expect(result.kind === "hit" || result.kind === "miss").toBe(true);
          }
        })(),
      ),
    );

    const p95 = p95Of(durations);
    expect(p95).toBeLessThan(P95_BOUND_MS);
  });
});
