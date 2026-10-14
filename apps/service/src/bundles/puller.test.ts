// Outcome tests for the pull cycle (Story 4.2) against a local node:http stub
// serving canned bodies: registry envelopes and transport failures touch
// nothing in the store; verified bundles activate through the record store;
// every verification refusal is recorded append-only; staleness observations
// follow the dedup rule.
import { createPublicKey } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SignedStandardBundle, UuidV7 } from "@domain-harness/contract";
import { isSignedStandardBundle } from "@domain-harness/contract";
import { bundledState, observeStaleness, pullAndActivate, pullLatest } from "./puller.ts";
import { createInMemoryBundleRecordStore } from "./store.ts";
import type { BundleRecordStore } from "./store.ts";
import { bundleHashOf } from "./verify.ts";
import type { BundleTrustSet } from "./verify.ts";
import { makeBundlePayload, makeSigningKey, signPayload, OTHER_TENANT_ID, TEST_TENANT_ID } from "./test-fixtures.ts";

const signer = makeSigningKey("key-1");
const TRUST_SET: BundleTrustSet = new Map([["key-1", createPublicKey(signer.publicKeyPem)]]);
const T0 = Date.parse("2026-10-14T12:00:00.000Z");
const iso = (ms: number): string => new Date(ms).toISOString();

let server: Server | undefined;
let handler: (req: IncomingMessage, res: ServerResponse) => void = (): void => {};

beforeEach(() => {
  handler = (): void => {};
});

afterEach(async () => {
  const closing = server;
  server = undefined;
  if (closing !== undefined) {
    closing.closeAllConnections();
    await new Promise<void>((resolve) => {
      closing.close(() => {
        resolve();
      });
    });
  }
});

async function stubVendorUrl(): Promise<string> {
  const listening = createServer((req, res) => { handler(req, res); });
  server = listening;
  await new Promise<void>((resolve, reject) => {
    listening.once("error", reject);
    listening.listen(0, "127.0.0.1", () => {
      listening.off("error", reject);
      resolve();
    });
  });
  const address = listening.address() as AddressInfo;
  return `http://127.0.0.1:${String(address.port)}`;
}

function serveJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

function targetFor(vendorUrl: string, tenantId: UuidV7 = TEST_TENANT_ID) {
  return { vendorUrl, tenantId, credential: "tenant-credential" };
}

async function cycle(
  store: BundleRecordStore,
  vendorUrl: string,
): Promise<ReturnType<typeof pullAndActivate>> {
  return await pullAndActivate(store, { target: targetFor(vendorUrl), trustSet: TRUST_SET });
}

const bundleAt = (sequence: number, issuedMs: number, overrides: Partial<Parameters<typeof makeBundlePayload>[0]> = {}): SignedStandardBundle =>
  signPayload(
    makeBundlePayload({
      keyId: signer.keyId,
      sequence,
      issuedAt: iso(issuedMs),
      ...overrides,
    }),
    signer,
  );

describe("pullLatest", () => {
  it("performs one outbound GET with the bearer credential and returns the served bundle", async () => {
    const signed = bundleAt(1, T0);
    let seen: { method: string; url: string; authorization: string | undefined } | undefined;
    const url = await stubVendorUrl();
    handler = (req, res) => {
      seen = { method: req.method ?? "", url: req.url ?? "", authorization: req.headers.authorization };
      serveJson(res, 200, signed);
    };
    const outcome = await pullLatest(targetFor(url));
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.body).toEqual(signed);
      expect(isSignedStandardBundle(outcome.body)).toBe(true);
    }
    expect(seen?.method).toBe("GET");
    expect(seen?.url).toBe(`/v1/standard-bundles/${encodeURIComponent(TEST_TENANT_ID)}`);
    expect(seen?.authorization).toBe("Bearer tenant-credential");
  });

  it("surfaces registry envelopes (404/401/403) as pull outcomes", async () => {
    const url = await stubVendorUrl();
    const cases: Array<[number, Record<string, string>]> = [
      [404, { code: "not_found", message: "no bundle", subject: "tenantId" }],
      [401, { code: "session_invalid", message: "unknown credential", subject: "authorization" }],
      [403, { code: "role_denied", message: "another tenant", subject: "authorization" }],
    ];
    for (const [status, envelope] of cases) {
      handler = (_req, res) => {
        serveJson(res, status, envelope);
      };
      const outcome = await pullLatest(targetFor(url));
      expect(outcome).toEqual({ ok: false, reason: "registry_envelope", status, envelope });
    }
  });

  it("surfaces a transport failure (connection refused) without throwing", async () => {
    const url = await stubVendorUrl();
    const address = (server as Server).address() as AddressInfo;
    const closed = new URL(url);
    closed.port = String(address.port);
    const closing = server;
    server = undefined;
    closing?.closeAllConnections();
    await new Promise<void>((resolve) => {
      closing?.close(() => {
        resolve();
      });
    });
    const outcome = await pullLatest(targetFor(closed.toString()));
    expect(outcome).toMatchObject({ ok: false, reason: "transport_failed" });
    if (!outcome.ok && outcome.reason === "transport_failed") {
      expect(typeof outcome.detail).toBe("string");
    }
  });

  it("surfaces a 200 whose body is not JSON as an invalid-body outcome", async () => {
    const url = await stubVendorUrl();
    handler = (_req, res) => {
      res.statusCode = 200;
      res.end("not json at all");
    };
    const outcome = await pullLatest(targetFor(url));
    expect(outcome).toMatchObject({ ok: false, reason: "invalid_body", status: 200 });
  });

  it("bounds the outbound GET and maps an aborted fetch to a transport failure", async () => {
    const url = await stubVendorUrl();
    handler = (): void => {
      // The stub never responds: the timeout must abort the request.
    };
    const outcome = await pullLatest({ ...targetFor(url), timeoutMs: 50 });
    expect(outcome).toMatchObject({ ok: false, reason: "transport_failed" });
    if (!outcome.ok && outcome.reason === "transport_failed") {
      expect(typeof outcome.detail).toBe("string");
    }
  }, 10_000);
});

describe("pullAndActivate", () => {
  it("activates a verified bundle on first activation and returns the pinned pointer", async () => {
    const url = await stubVendorUrl();
    const signed = bundleAt(1, T0);
    handler = (_req, res) => {
      serveJson(res, 200, signed);
    };
    const store = createInMemoryBundleRecordStore();
    const outcome = await cycle(store, url);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.activated).toBe(true);
    expect(outcome.pointer).toEqual({ hash: outcome.hash, sequence: 1 });
    expect(outcome.sequence).toBe(1);
    expect(await store.getPointer(TEST_TENANT_ID)).toEqual({ hash: outcome.hash, sequence: 1 });
    expect(await store.pinnedBundle(outcome.hash)).toEqual(signed);
    expect(await store.listRefusals()).toEqual([]);
  });

  it("swaps the pointer to a newer bundle and keeps the old bundle row", async () => {
    const url = await stubVendorUrl();
    const first = bundleAt(1, T0);
    const second = bundleAt(2, T0 + 60_000);
    const store = createInMemoryBundleRecordStore();
    handler = (_req, res) => {
      serveJson(res, 200, first);
    };
    const firstCycle = await cycle(store, url);
    expect(firstCycle.ok).toBe(true);
    const firstHash = firstCycle.ok ? firstCycle.hash : "";
    handler = (_req, res) => {
      serveJson(res, 200, second);
    };
    const secondCycle = await cycle(store, url);
    expect(secondCycle.ok).toBe(true);
    if (secondCycle.ok) {
      expect(secondCycle.activated).toBe(true);
      expect(secondCycle.pointer.sequence).toBe(2);
      expect(secondCycle.pointer.hash).not.toBe(firstHash);
    }
    expect(await store.pinnedBundle(firstHash)).toEqual(first);
    expect(await store.listRefusals()).toEqual([]);
  });

  it("leaves everything unchanged on an equal-sequence re-pull of identical bytes", async () => {
    const url = await stubVendorUrl();
    const signed = bundleAt(1, T0);
    const store = createInMemoryBundleRecordStore();
    handler = (_req, res) => {
      serveJson(res, 200, signed);
    };
    await cycle(store, url);
    const pointer = await store.getPointer(TEST_TENANT_ID);
    handler = (_req, res) => {
      serveJson(res, 200, signed);
    };
    const outcome = await cycle(store, url);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.activated).toBe(false);
      expect(outcome.pointer).toEqual(pointer);
    }
    expect(await store.getPointer(TEST_TENANT_ID)).toEqual(pointer);
    expect(await store.listRefusals()).toEqual([]);
  });

  it("refuses an equal-sequence re-pull of different bytes as hash_mismatch, recording one refusal row", async () => {
    const url = await stubVendorUrl();
    const first = bundleAt(1, T0);
    const different = bundleAt(1, T0 + 1);
    const store = createInMemoryBundleRecordStore();
    handler = (_req, res) => {
      serveJson(res, 200, first);
    };
    await cycle(store, url);
    const pointer = await store.getPointer(TEST_TENANT_ID);
    handler = (_req, res) => {
      serveJson(res, 200, different);
    };
    const outcome = await cycle(store, url);
    expect(outcome).toMatchObject({ ok: false, stage: "verify", reason: "hash_mismatch" });
    expect(await store.getPointer(TEST_TENANT_ID)).toEqual(pointer);
    const refusals = await store.listRefusals(TEST_TENANT_ID);
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatchObject({ reason: "hash_mismatch", sequence: 1 });
    expect(refusals[0]?.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses a lower sequence as stale_sequence and leaves the pointer unchanged", async () => {
    const url = await stubVendorUrl();
    const second = bundleAt(2, T0);
    const first = bundleAt(1, T0 - 60_000);
    const store = createInMemoryBundleRecordStore();
    handler = (_req, res) => {
      serveJson(res, 200, second);
    };
    await cycle(store, url);
    const pointer = await store.getPointer(TEST_TENANT_ID);
    handler = (_req, res) => {
      serveJson(res, 200, first);
    };
    const outcome = await cycle(store, url);
    expect(outcome).toMatchObject({ ok: false, stage: "verify", reason: "stale_sequence" });
    expect(await store.getPointer(TEST_TENANT_ID)).toEqual(pointer);
    const refusals = await store.listRefusals();
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatchObject({ reason: "stale_sequence", sequence: 1 });
  });

  it("refuses tampered content as signature_failed and records the refusal", async () => {
    const url = await stubVendorUrl();
    const base = makeBundlePayload({ keyId: signer.keyId, sequence: 1, issuedAt: iso(T0) });
    const signed = signPayload(base, signer);
    const tampered = { ...signed, payload: { ...base, keyId: signer.keyId, stalenessHours: 25 } };
    const store = createInMemoryBundleRecordStore();
    handler = (_req, res) => {
      serveJson(res, 200, tampered);
    };
    const outcome = await cycle(store, url);
    expect(outcome).toMatchObject({ ok: false, stage: "verify", reason: "signature_failed" });
    expect(await store.getPointer(TEST_TENANT_ID)).toBeNull();
    const refusals = await store.listRefusals();
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatchObject({ reason: "signature_failed", sequence: 1 });
  });

  it("refuses a bundle signed by an unknown key as unknown_key before any signature work", async () => {
    const url = await stubVendorUrl();
    const rogue = makeSigningKey("rogue-key");
    const signed = signPayload(
      makeBundlePayload({ keyId: rogue.keyId, sequence: 1, issuedAt: iso(T0) }),
      rogue,
    );
    const store = createInMemoryBundleRecordStore();
    handler = (_req, res) => {
      serveJson(res, 200, { ...signed, signature: "definitely-broken" });
    };
    const outcome = await cycle(store, url);
    expect(outcome).toMatchObject({ ok: false, stage: "verify", reason: "unknown_key" });
    expect(await store.listRefusals()).toHaveLength(1);
  });

  it("refuses another tenant's bundle as tenant_mismatch and records the refusal", async () => {
    const url = await stubVendorUrl();
    const foreign = signPayload(
      makeBundlePayload({ keyId: signer.keyId, sequence: 1, issuedAt: iso(T0), tenantId: "018f3d2a-7000-7000-8000-000000000101" as UuidV7 }),
      signer,
    );
    const store = createInMemoryBundleRecordStore();
    handler = (_req, res) => {
      serveJson(res, 200, foreign);
    };
    const outcome = await cycle(store, url);
    expect(outcome).toMatchObject({ ok: false, stage: "verify", reason: "tenant_mismatch" });
    expect(await store.getPointer(TEST_TENANT_ID)).toBeNull();
    expect((await store.listRefusals())[0]).toMatchObject({ reason: "tenant_mismatch" });
  });

  it("refuses a malformed body as shape, records the refusal and leaves the pointer unchanged", async () => {
    const url = await stubVendorUrl();
    const store = createInMemoryBundleRecordStore();
    const signed = bundleAt(1, T0);
    handler = (_req, res) => {
      serveJson(res, 200, signed);
    };
    await cycle(store, url);
    const pointer = await store.getPointer(TEST_TENANT_ID);
    handler = (_req, res) => {
      serveJson(res, 200, { half: "of a bundle" });
    };
    const outcome = await cycle(store, url);
    expect(outcome).toMatchObject({ ok: false, stage: "verify", reason: "shape" });
    expect(await store.getPointer(TEST_TENANT_ID)).toEqual(pointer);
    expect((await store.listRefusals())[0]).toMatchObject({ reason: "shape" });
  });

  it("leaves the store untouched on pull denials and transport failures", async () => {
    const url = await stubVendorUrl();
    const signed = bundleAt(1, T0);
    const store = createInMemoryBundleRecordStore();

    handler = (_req, res) => {
      serveJson(res, 404, { code: "not_found", message: "no bundle", subject: "tenantId" });
    };
    const denial = await cycle(store, url);
    expect(denial).toMatchObject({ ok: false, stage: "pull", outcome: { reason: "registry_envelope", status: 404 } });

    handler = (_req, res) => {
      serveJson(res, 200, signed);
    };
    const activated = await cycle(store, url);
    expect(activated.ok).toBe(true);

    handler = (_req, res) => {
      serveJson(res, 403, { code: "role_denied", message: "no", subject: "authorization" });
    };
    const denied = await cycle(store, url);
    expect(denied).toMatchObject({ ok: false, stage: "pull" });
    const pointer = await store.getPointer(TEST_TENANT_ID);
    expect(pointer).not.toBeNull();
    expect(await store.listRefusals()).toEqual([]);
    expect(await store.listStalenessObservations()).toEqual([]);
  });
  it("records a refusal row when the activate stage refuses, even though verification passed", async () => {
    const url = await stubVendorUrl();
    // Another replica already activated sequence 2; this cycle's stale pointer
    // view still reads nothing, so verification passes and the activation is
    // refused by the sequence guard at the activate stage.
    const inner = createInMemoryBundleRecordStore();
    const winner = bundleAt(2, T0 + 60_000);
    const winnerHash = bundleHashOf(winner);
    expect((await inner.activate(winner, winnerHash, TEST_TENANT_ID)).ok).toBe(true);
    const pointer = await inner.getPointer(TEST_TENANT_ID);
    expect(pointer).toEqual({ hash: winnerHash, sequence: 2 });

    const staleView: BundleRecordStore = {
      getPointer: () => Promise.resolve(null),
      activate: (signed, hash, tenantId) => inner.activate(signed, hash, tenantId),
      recordRefusal: (input) => inner.recordRefusal(input),
      listRefusals: (tenantId) => inner.listRefusals(tenantId),
      recordStalenessObservation: (input) => inner.recordStalenessObservation(input),
      listStalenessObservations: (tenantId) => inner.listStalenessObservations(tenantId),
      pinnedBundle: (hash) => inner.pinnedBundle(hash),
    };

    const loser = bundleAt(1, T0);
    handler = (_req, res) => {
      serveJson(res, 200, loser);
    };
    const outcome = await pullAndActivate(staleView, { target: targetFor(url), trustSet: TRUST_SET });
    expect(outcome).toMatchObject({ ok: false, stage: "activate", reason: "stale_sequence" });
    expect(await inner.getPointer(TEST_TENANT_ID)).toEqual(pointer);
    const refusals = await inner.listRefusals(TEST_TENANT_ID);
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatchObject({ reason: "stale_sequence", sequence: 1 });
    expect(refusals[0]?.hash).toBe(bundleHashOf(loser));
    if (!outcome.ok && outcome.stage === "activate") {
      expect(outcome.record.id).toBe(refusals[0]?.id);
    }
  });
});

describe("store-level in-activation re-derivation (InMemory twin)", () => {
  it("refuses an activation whose re-derived stored hash differs and inserts nothing", async () => {
    const store = createInMemoryBundleRecordStore();
    const good = bundleAt(1, T0);
    const goodHash = bundleHashOf(good);
    const goodResult = await store.activate(good, goodHash, TEST_TENANT_ID);
    expect(goodResult.ok).toBe(true);

    const candidate = bundleAt(2, T0 + 60_000);
    const wrongHash = "9".repeat(64);
    const pointer = await store.getPointer(TEST_TENANT_ID);
    const outcome = await store.activate(candidate, wrongHash, TEST_TENANT_ID);
    expect(outcome).toEqual({ ok: false, reason: "hash_mismatch", pointer });
    expect(await store.getPointer(TEST_TENANT_ID)).toEqual(pointer);
    expect(await store.pinnedBundle(wrongHash)).toBeNull();
    expect(await store.pinnedBundle(bundleHashOf(candidate))).toBeNull();
    expect(await store.listRefusals()).toEqual([]);
  });
});

describe("staleness view and observations", () => {
  const TWO_HOURS = 2 * 60 * 60 * 1000;

  it("reports no_active_bundle before any activation", async () => {
    const store = createInMemoryBundleRecordStore();
    const state = await bundledState(store, TEST_TENANT_ID, iso(T0));
    expect(state).toEqual({ ok: false, reason: "no_active_bundle" });
    const observed = await observeStaleness(store, TEST_TENANT_ID, iso(T0));
    expect(observed).toEqual({ recorded: false, state: null, reason: "no_active_bundle" });
  });

  it("records a staleness row with hash, sequence and age, and the view reports stale", async () => {
    const url = await stubVendorUrl();
    const signed = bundleAt(1, T0 - 3 * TWO_HOURS, { stalenessHours: 2 });
    handler = (_req, res) => {
      serveJson(res, 200, signed);
    };
    const store = createInMemoryBundleRecordStore();
    await cycle(store, url);
    const state = await bundledState(store, TEST_TENANT_ID, iso(T0));
    expect(state.ok).toBe(true);
    if (!state.ok) return;
    expect(state.state.stale).toBe(true);
    expect(state.state.frozen).toBe(false);
    expect(state.state.stalenessHours).toBe(2);
    expect(state.state.ageSeconds).toBeCloseTo((3 * TWO_HOURS) / 1000, 0);
    expect(state.state.sequence).toBe(1);
    expect(state.state.hash).toMatch(/^[0-9a-f]{64}$/);

    const observed = await observeStaleness(store, TEST_TENANT_ID, iso(T0));
    expect(observed.recorded).toBe(true);
    if (observed.recorded) {
      expect(observed.observation.hash).toBe(state.state.hash);
      expect(observed.observation.sequence).toBe(1);
      expect(observed.observation.stale).toBe(true);
      expect(observed.observation.ageSeconds).toBeCloseTo((3 * TWO_HOURS) / 1000, 0);
    }
    expect(await store.listStalenessObservations(TEST_TENANT_ID)).toHaveLength(1);
  });

  it("adds no row for an identical repeated observation", async () => {
    const url = await stubVendorUrl();
    const signed = bundleAt(1, T0 - 3 * TWO_HOURS, { stalenessHours: 2 });
    handler = (_req, res) => {
      serveJson(res, 200, signed);
    };
    const store = createInMemoryBundleRecordStore();
    await cycle(store, url);
    const first = await observeStaleness(store, TEST_TENANT_ID, iso(T0));
    expect(first.recorded).toBe(true);
    const second = await observeStaleness(store, TEST_TENANT_ID, iso(T0));
    expect(second).toMatchObject({ recorded: false, reason: "unchanged" });
    expect(await store.listStalenessObservations()).toHaveLength(1);
  });

  it("records no row while the bundle is fresh, and a new one when a different bundle goes stale", async () => {
    const url = await stubVendorUrl();
    const fresh = bundleAt(1, T0, { stalenessHours: 2 });
    const stale = bundleAt(2, T0 - 5 * TWO_HOURS, { stalenessHours: 2 });
    const store = createInMemoryBundleRecordStore();
    handler = (_req, res) => {
      serveJson(res, 200, fresh);
    };
    await cycle(store, url);
    const freshObservation = await observeStaleness(store, TEST_TENANT_ID, iso(T0));
    expect(freshObservation).toMatchObject({ recorded: false, reason: "not_stale" });
    expect(await store.listStalenessObservations()).toHaveLength(0);

    handler = (_req, res) => {
      serveJson(res, 200, stale);
    };
    const swapped = await cycle(store, url);
    expect(swapped.ok).toBe(true);
    const staleObservation = await observeStaleness(store, TEST_TENANT_ID, iso(T0));
    expect(staleObservation.recorded).toBe(true);
    expect(await store.listStalenessObservations()).toHaveLength(1);
  });

  it("keeps the dedup last row per tenant so tenants never suppress each other (InMemory twin)", async () => {
    const store = createInMemoryBundleRecordStore();
    const tenantB = OTHER_TENANT_ID;
    const hashAny = "b".repeat(64);

    // Tenant B's latest recorded observation is stale on hashAny.
    const firstB = await store.recordStalenessObservation({
      tenantId: tenantB,
      hash: hashAny,
      sequence: 1,
      stale: true,
      ageSeconds: 3600,
    });
    expect(firstB.recorded).toBe(true);

    // Tenant A's identical-looking observation must still record: the InMemory
    // twin compares only against its tenant's last row, like the Postgres twin.
    const firstA = await store.recordStalenessObservation({
      tenantId: TEST_TENANT_ID,
      hash: hashAny,
      sequence: 1,
      stale: true,
      ageSeconds: 3600,
    });
    expect(firstA.recorded).toBe(true);

    // Tenant B's identical repeat still adds no row.
    const repeatB = await store.recordStalenessObservation({
      tenantId: tenantB,
      hash: hashAny,
      sequence: 1,
      stale: true,
      ageSeconds: 3601,
    });
    expect(repeatB.recorded).toBe(false);
  });

  it("records no row for a frozen bundle however old it is", async () => {
    const url = await stubVendorUrl();
    const frozen = bundleAt(1, T0 - 10 * TWO_HOURS, { stalenessHours: 1, frozen: true });
    handler = (_req, res) => {
      serveJson(res, 200, frozen);
    };
    const store = createInMemoryBundleRecordStore();
    await cycle(store, url);
    const state = await bundledState(store, TEST_TENANT_ID, iso(T0));
    if (!state.ok) throw new Error("state should exist");
    expect(state.state.frozen).toBe(true);
    expect(state.state.stale).toBe(false);
    const observed = await observeStaleness(store, TEST_TENANT_ID, iso(T0));
    expect(observed).toMatchObject({ recorded: false, reason: "not_stale" });
    expect(await store.listStalenessObservations()).toHaveLength(0);
  });
});
