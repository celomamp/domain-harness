// Unit tests for received-bundle verification (Story 4.2): every I/O matrix
// row of the verification order, with bundles signed by generated Ed25519
// keys. The wire is exact-shape strict; the refusal order is
// shape → unknown_key → signature_failed → tenant_mismatch → hash_mismatch →
// stale_sequence.
import { createPublicKey } from "node:crypto";
import type { SignedStandardBundle, UuidV7 } from "@domain-harness/contract";
import { isSignedStandardBundle } from "@domain-harness/contract";
import { describe, expect, it } from "vitest";
import { bundleHashOf, verifyPulledBundle } from "./verify.ts";
import golden from "./golden-signed-bundle.json" with { type: "json" };
import type { ActiveBundlePointer, BundleTrustSet } from "./verify.ts";
import {
  makeBundlePayload,
  makeSigningKey,
  signPayload,
  TEST_TENANT_ID,
} from "./test-fixtures.ts";

const ISSUED_NOW = "2026-10-14T00:00:00.000Z";
const ISSUED_LATER = "2026-10-14T06:00:00.000Z";

const signer = makeSigningKey("key-1");
const secondSigner = makeSigningKey("key-2");

const TRUST_SET: BundleTrustSet = new Map([
  ["key-1", createPublicKey(signer.publicKeyPem)],
  ["key-2", createPublicKey(secondSigner.publicKeyPem)],
]);

function verifyWith(
  raw: unknown,
  active: ActiveBundlePointer | null = null,
  trustSet: BundleTrustSet = TRUST_SET,
): ReturnType<typeof verifyPulledBundle> {
  return verifyPulledBundle({ raw, tenantId: TEST_TENANT_ID, trustSet, active });
}

describe("verifyPulledBundle", () => {
  it("accepts a correctly signed bundle with no active pointer (first activation)", () => {
    const signed = signPayload(makeBundlePayload({ keyId: signer.keyId, sequence: 1, issuedAt: ISSUED_NOW }), signer);
    const outcome = verifyWith(signed);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.signed).toEqual(signed);
      expect(outcome.sequence).toBe(1);
      expect(outcome.hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("gives the same hash for byte-identical bundles (canonical determinism)", () => {
    const first = signPayload(makeBundlePayload({ keyId: signer.keyId, sequence: 1, issuedAt: ISSUED_NOW }), signer);
    const second = signPayload(makeBundlePayload({ keyId: signer.keyId, sequence: 1, issuedAt: ISSUED_NOW }), signer);
    const firstOutcome = verifyWith(first);
    const secondOutcome = verifyWith(second);
    expect(firstOutcome.ok).toBe(true);
    expect(secondOutcome.ok).toBe(true);
    if (firstOutcome.ok && secondOutcome.ok) {
      expect(firstOutcome.hash).toBe(secondOutcome.hash);
    }
  });

  it("accepts a newer sequence against an active pointer regardless of its hash", () => {
    const active: ActiveBundlePointer = { hash: "0".repeat(64), sequence: 1 };
    const signed = signPayload(makeBundlePayload({ keyId: signer.keyId, sequence: 2, issuedAt: ISSUED_LATER }), signer);
    expect(verifyWith(signed, active).ok).toBe(true);
  });

  it("accepts an equal-sequence re-pull with identical content", () => {
    const signed = signPayload(makeBundlePayload({ keyId: signer.keyId, sequence: 1, issuedAt: ISSUED_NOW }), signer);
    const accepted = verifyWith(signed);
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    const active: ActiveBundlePointer = { hash: accepted.hash, sequence: 1 };
    const repulled = signPayload(makeBundlePayload({ keyId: signer.keyId, sequence: 1, issuedAt: ISSUED_NOW }), signer);
    expect(verifyWith(repulled, active).ok).toBe(true);
  });

  it("refuses an equal-sequence re-pull with different bytes as hash_mismatch", () => {
    const active: ActiveBundlePointer = { hash: "1".repeat(64), sequence: 1 };
    const signed = signPayload(makeBundlePayload({ keyId: signer.keyId, sequence: 1, issuedAt: ISSUED_NOW }), signer);
    const outcome = verifyWith(signed, active);
    expect(outcome).toMatchObject({ ok: false, reason: "hash_mismatch", sequence: 1 });
    if (!outcome.ok) {
      expect(outcome.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(outcome.detail).toBe(
        "the pulled sequence equals the active pointer's but the recomputed hash differs from the active hash",
      );
    }
  });

  it("refuses a lower sequence as stale_sequence and reports the received identity", () => {
    const active: ActiveBundlePointer = { hash: "2".repeat(64), sequence: 2 };
    const signed = signPayload(makeBundlePayload({ keyId: signer.keyId, sequence: 1, issuedAt: ISSUED_NOW }), signer);
    const outcome = verifyWith(signed, active);
    expect(outcome).toMatchObject({ ok: false, reason: "stale_sequence", sequence: 1 });
    if (!outcome.ok) {
      expect(outcome.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(outcome.detail).toBe("the pulled sequence is lower than the active pointer's sequence");
    }
  });

  it("refuses tampered payload bytes as signature_failed while the guards still pass", () => {
    const base = makeBundlePayload({ keyId: signer.keyId, sequence: 1, issuedAt: ISSUED_NOW });
    const signed = signPayload(base, signer);
    const original = base.standards[0];
    if (original === undefined) throw new Error("the fixture bundle carries no Standard");
    const tamperedPayload = {
      ...base,
      keyId: signer.keyId,
      standards: [{ ...original, module: { ...original.module, name: "Frontend" } }],
    };
    const forged: SignedStandardBundle = { payload: tamperedPayload, keyId: signer.keyId, signature: signed.signature };
    const outcome = verifyWith(forged);
    expect(outcome).toMatchObject({ ok: false, reason: "signature_failed" });
    if (!outcome.ok) {
      expect(outcome.hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("refuses a tampered signature as signature_failed", () => {
    const signed = signPayload(makeBundlePayload({ keyId: signer.keyId, sequence: 1, issuedAt: ISSUED_NOW }), signer);
    const flipped: SignedStandardBundle = { ...signed, signature: `${signed.signature.startsWith("B") ? "C" : "B"}${signed.signature.slice(1)}` };
    const outcome = verifyWith(flipped);
    expect(outcome).toMatchObject({ ok: false, reason: "signature_failed", sequence: 1 });
  });

  it("refuses an unknown key id before any signature work, even when the signature is also broken", () => {
    const rogue = makeSigningKey("rogue-key");
    const signed = signPayload(makeBundlePayload({ keyId: rogue.keyId, sequence: 1, issuedAt: ISSUED_NOW }), rogue);
    const broken: SignedStandardBundle = { ...signed, signature: "not-a-signature" };
    const outcome = verifyWith(broken);
    expect(outcome).toMatchObject({
      ok: false,
      reason: "unknown_key",
      sequence: 1,
    });
    if (!outcome.ok) {
      expect(outcome.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(outcome.detail).toBe("the bundle's key id is not in the trust set; no signature work was done");
    }
  });

  it("accepts a bundle whose key id belongs to a second trusted key (rotation overlap)", () => {
    const signed = signPayload(makeBundlePayload({ keyId: secondSigner.keyId, sequence: 1, issuedAt: ISSUED_NOW }), secondSigner);
    expect(verifyWith(signed).ok).toBe(true);
  });

  it("refuses a payload tenant mismatch with a valid signature", () => {
    const foreign = signPayload(
      makeBundlePayload({ keyId: signer.keyId, sequence: 1, issuedAt: ISSUED_NOW, tenantId: "018f3d2a-7000-7000-8000-000000000101" as UuidV7 }),
      signer,
    );
    const outcome = verifyWith(foreign);
    expect(outcome).toMatchObject({ ok: false, reason: "tenant_mismatch", sequence: 1 });
  });

  it("refuses a bundle in an unknown format major as shape", () => {
    const signed = signPayload(makeBundlePayload({ keyId: signer.keyId, sequence: 1, issuedAt: ISSUED_NOW }), signer);
    const wrongMajor = {
      ...signed,
      payload: { ...signed.payload, format: { type: signed.payload.format.type, version: 99 } },
    };
    const outcome = verifyWith(wrongMajor);
    expect(outcome).toMatchObject({ ok: false, reason: "shape", sequence: 1 });
    if (!outcome.ok) {
      expect(outcome.hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("refuses malformed bodies of many kinds as shape with best-effort identity", () => {
    const unsigned = makeBundlePayload({ keyId: signer.keyId, sequence: 7, issuedAt: ISSUED_NOW });
    const cases: unknown[] = [
      null,
      "the bundle",
      42,
      [],
      {},
      { ...unsigned, extra: true },
      { payload: unsigned, keyId: signer.keyId },
      { ...unsigned },
      { ...unsigned, payload: 7 },
      { tenantId: TEST_TENANT_ID },
    ];
    for (const raw of cases) {
      const outcome = verifyWith(raw);
      expect(outcome.ok, JSON.stringify(raw)).toBe(false);
      if (!outcome.ok) {
        expect(outcome.reason).toBe("shape");
        expect(typeof outcome.detail).toBe("string");
      }
    }
  });

  it("never throws on cyclic or non-numerical input", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    const cyclicOutcome = verifyWith(cyclic);
    expect(cyclicOutcome).toMatchObject({ ok: false, reason: "shape", hash: null });

    const nonFinite = verifyWith({ payload: { sequence: Number.POSITIVE_INFINITY } });
    expect(nonFinite).toMatchObject({ ok: false, reason: "shape" });
  });

  it("accepts the golden bundle signed by the registry's real signer and re-derives its recorded hash", () => {
    const signed = golden.signed as unknown as SignedStandardBundle;
    expect(isSignedStandardBundle(signed)).toBe(true);

    const trustSet: BundleTrustSet = new Map([[signed.keyId, createPublicKey(golden.publicKeyPem)]]);
    const outcome = verifyPulledBundle({
      raw: signed,
      tenantId: signed.payload.tenantId,
      trustSet,
      active: null,
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.hash).toBe(golden.hash);
      expect(outcome.sequence).toBe(signed.payload.sequence);
    }
    expect(bundleHashOf(signed)).toBe(golden.hash);
  });
});
