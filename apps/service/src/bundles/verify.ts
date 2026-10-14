/**
 * Pure received-bundle verification (Story 4.2). The wire is exact-shape
 * strict: the received body must pass the shared contract guards
 * (`isSignedStandardBundle`), which reject unknown keys and unknown format
 * majors. Hash and signature rules mirror the pinned Story 4.1 rules exactly
 * (`canonJson` over the whole signed object; Ed25519 base64 over the canonical
 * payload bytes) without importing the registry.
 *
 * Verification order is fixed and every outcome is a value, never a throw:
 * `shape`, `unknown_key`, `signature_failed`, `tenant_mismatch`,
 * `hash_mismatch`, `stale_sequence`.
 */
import { createHash, createPublicKey, verify as cryptoVerify } from "node:crypto";
import type { KeyObject } from "node:crypto";
import type { SignedStandardBundle } from "@domain-harness/contract";
import { canonicalJson, isSignedStandardBundle } from "@domain-harness/contract";

/** The fixed refusal reason codes, in verification order. */
export const BUNDLE_REFUSAL_REASONS = [
  "shape",
  "unknown_key",
  "signature_failed",
  "tenant_mismatch",
  "hash_mismatch",
  "stale_sequence",
] as const;
export type BundleRefusalReason = (typeof BUNDLE_REFUSAL_REASONS)[number];

/** One trusted key of the trust set: an Ed25519 public key. */
export type TrustedBundleKey = KeyObject;

/**
 * The trust set: keyId → Ed25519 public key. Rotation overlaps by key id, so
 * the set may hold more than one key.
 */
export type BundleTrustSet = ReadonlyMap<string, TrustedBundleKey>;

/** The tenant's active-bundle pointer, as read from the record store. */
export interface ActiveBundlePointer {
  readonly hash: string;
  readonly sequence: number;
}

export interface VerifyPulledBundleInput {
  /** The pulled body as parsed JSON (or anything the wire delivered). */
  readonly raw: unknown;
  /** The configured tenant id; the payload's must equal it. */
  readonly tenantId: string;
  readonly trustSet: BundleTrustSet;
  /** The active pointer when one exists; its hash is the equal-sequence expectation. */
  readonly active: ActiveBundlePointer | null;
}

export type VerifyOutcome =
  | {
      readonly ok: true;
      readonly signed: SignedStandardBundle;
      readonly hash: string;
      readonly sequence: number;
    }
  | {
      readonly ok: false;
      readonly reason: BundleRefusalReason;
      /** The received sequence/hash when either could be identified from the body. */
      readonly sequence: number | null;
      readonly hash: string | null;
      readonly detail: string;
    };

/** SHA-256 hex of UTF-8 bytes. */
export function sha256Hex(bytes: Uint8Array | Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Story 4.1's bundle hash, recomputed from a complete signed bundle: SHA-256
 * hex of the canonical bytes of the whole signed object.
 */
export function bundleHashOf(signed: SignedStandardBundle): string {
  return sha256Hex(Buffer.from(canonicalJson(signed), "utf8"));
}

function refusal(reason: BundleRefusalReason, sequence: number | null, hash: string | null, detail: string): VerifyOutcome {
  return { ok: false, reason, sequence, hash, detail };
}

/**
 * Verify one pulled body against the configured tenant, the trust set and the
 * active pointer. Never throws. The order is fixed:
 * `shape` → `unknown_key` → `signature_failed` → `tenant_mismatch` →
 * `hash_mismatch` → `stale_sequence`.
 */
export function verifyPulledBundle(input: VerifyPulledBundleInput): VerifyOutcome {
  const { raw, tenantId, trustSet, active } = input;

  if (!isSignedStandardBundle(raw)) {
    const received = bestEffortIdentity(raw);
    return refusal(
      "shape",
      received.sequence,
      received.hash,
      "the received body does not pass the signed Standard bundle contract guards",
    );
  }
  const signed = raw;

  const trusted = trustSet.get(signed.keyId);
  if (trusted === undefined) {
    return refusal(
      "unknown_key",
      signed.payload.sequence,
      bundleHashOf(signed),
      "the bundle's key id is not in the trust set; no signature work was done",
    );
  }

  const payloadBytes = Buffer.from(canonicalJson(signed.payload), "utf8");
  let signatureOk: boolean;
  try {
    signatureOk = cryptoVerify(null, payloadBytes, trusted, Buffer.from(signed.signature, "base64"));
  } catch {
    signatureOk = false;
  }
  if (!signatureOk) {
    return refusal(
      "signature_failed",
      signed.payload.sequence,
      bundleHashOf(signed),
      "the Ed25519 signature does not verify over the canonical payload bytes",
    );
  }

  if (signed.payload.tenantId !== tenantId) {
    return refusal(
      "tenant_mismatch",
      signed.payload.sequence,
      bundleHashOf(signed),
      "the payload's tenant id is not the configured tenant",
    );
  }

  const hash = bundleHashOf(signed);
  if (active !== null && signed.payload.sequence === active.sequence && hash !== active.hash) {
    return refusal(
      "hash_mismatch",
      signed.payload.sequence,
      hash,
      "the pulled sequence equals the active pointer's but the recomputed hash differs from the active hash",
    );
  }
  if (active !== null && signed.payload.sequence < active.sequence) {
    return refusal(
      "stale_sequence",
      signed.payload.sequence,
      hash,
      "the pulled sequence is lower than the active pointer's sequence",
    );
  }

  return { ok: true, signed, hash, sequence: signed.payload.sequence };
}

/** Parse one PEM public key of the trust set; false when it is not an Ed25519 public key. */
export function isEd25519PublicKeyPem(pem: string): boolean {
  let key;
  try {
    key = createPublicKey(pem);
  } catch {
    return false;
  }
  return key.asymmetricKeyType === "ed25519";
}

/** Best-effort identity of an unusable body, for the refusal record only. Never throws. */
function bestEffortIdentity(raw: unknown): { sequence: number | null; hash: string | null } {
  let sequence: number | null = null;
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    const payload = (raw as Record<string, unknown>)["payload"];
    if (typeof payload === "object" && payload !== null && !Array.isArray(payload)) {
      const candidate = (payload as Record<string, unknown>)["sequence"];
      if (typeof candidate === "number" && Number.isInteger(candidate) && candidate >= 1) {
        sequence = candidate;
      }
    }
  }
  let hash: string | null;
  try {
    hash = sha256Hex(Buffer.from(canonicalJson(raw), "utf8"));
  } catch {
    hash = null;
  }
  return { sequence, hash };
}
