/**
 * Offline bundle-file loader (Story 8.1): reads a bundle file and a
 * trust-keys file from paths, verifies with the service's fixed order and
 * rules against the local last-seen state, applies the staleness bound to
 * the bundle issue time, and persists the verified pointer for story 8.2.
 *
 * Mirrors `apps/service/src/bundles/verify.ts` without importing it
 * (no-cross-app-imports; the story 4.2 precedent): the hash/verify/stale
 * primitives are re-implemented from `contract` plus `node:crypto`, while
 * shape and canonical bytes stay single-sourced in `contract` and the
 * failure sentences stay single-sourced in `gate`.
 *
 * Verification order is fixed: `shape` → `unknown_key` → `signature_failed`
 * → `tenant_mismatch` → `hash_mismatch` → `stale_sequence`, then the
 * staleness guard (runner semantics against `payload.issuedAt` and
 * `payload.stalenessHours`; `frozen: true` suspends the bound; future or
 * unparseable issue times are stale). The state is written only on success;
 * an equal-sequence identical-hash re-verification is idempotent and does
 * not rewrite the file. Nothing here throws and nothing touches the
 * network.
 */
import { createHash, verify as cryptoVerify } from "node:crypto";
import { readFileSync } from "node:fs";
import type { SignedStandardBundle, StandardBundlePayload } from "@domain-harness/contract";
import { canonicalJson, DEFAULT_STALENESS_HOURS, isSignedStandardBundle } from "@domain-harness/contract";
import { BUNDLE_STALE, BUNDLE_VERIFICATION_FAILED } from "@domain-harness/gate";
import { readTrustKeysFile } from "./trust-keys.ts";
import { readStateEntry, writeStateEntry } from "./bundle-state.ts";

export interface LoadBundleFileInput {
  readonly bundlePath: string;
  readonly trustKeysPath: string;
  readonly tenantId: string;
  readonly statePath: string;
  /** Run-clock ISO string; the caller supplies it (`--now` or the current time). */
  readonly now: string;
}

export type LoadBundleFileOutcome =
  | {
      readonly ok: true;
      readonly signed: SignedStandardBundle;
      readonly hash: string;
      readonly sequence: number;
      readonly exitCode: 0;
    }
  | {
      readonly ok: false;
      readonly reason: "verify-failed" | "stale";
      readonly sentence: typeof BUNDLE_VERIFICATION_FAILED | typeof BUNDLE_STALE;
      readonly exitCode: 1;
    };

/** SHA-256 hex of UTF-8 bytes. */
export function sha256Hex(bytes: Uint8Array | Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * The bundle hash: SHA-256 hex of the canonical bytes of the whole signed
 * object. Mirrors the registry/service rule.
 */
export function bundleHashOf(signed: SignedStandardBundle): string {
  return sha256Hex(Buffer.from(canonicalJson(signed), "utf8"));
}

function verifyFailed(): LoadBundleFileOutcome {
  return { ok: false, reason: "verify-failed", sentence: BUNDLE_VERIFICATION_FAILED, exitCode: 1 };
}

function stale(): LoadBundleFileOutcome {
  return { ok: false, reason: "stale", sentence: BUNDLE_STALE, exitCode: 1 };
}

/**
 * True when the bundle is stale under the runner guard applied to the
 * payload: `frozen: true` suspends the bound; otherwise age = now −
 * issuedAt must satisfy `now >= issued` and `age <= bound`, where bound
 * comes from `payload.stalenessHours`. Future or unparseable issue times
 * (or an unparseable clock) are stale. Never throws.
 */
export function isBundleStale(payload: StandardBundlePayload, now: string): boolean {
  try {
    if (payload.frozen) return false;
    const issuedMs = Date.parse(payload.issuedAt);
    const nowMs = Date.parse(now);
    if (!Number.isFinite(issuedMs) || !Number.isFinite(nowMs)) return true;
    if (nowMs < issuedMs) return true;
    const hours =
      typeof payload.stalenessHours === "number" &&
      Number.isInteger(payload.stalenessHours) &&
      payload.stalenessHours >= 1 &&
      payload.stalenessHours <= 720
        ? payload.stalenessHours
        : DEFAULT_STALENESS_HOURS;
    const boundMs = hours * 60 * 60 * 1000;
    return nowMs - issuedMs > boundMs;
  } catch {
    return true;
  }
}

/**
 * Load and verify one bundle file offline. Never throws. Every verification
 * defect (unreadable bundle or trust file, malformed JSON, guard failure,
 * unknown key, bad signature, tenant mismatch, equal-sequence hash change,
 * lower sequence) yields the verification-failed sentence with exit 1; a
 * bundle past its bound yields the stale sentence with exit 1. Success
 * records the pointer in the state file (best-effort persist) and returns
 * the signed bundle with its hash and sequence.
 */
export function loadBundleFile(input: LoadBundleFileInput): LoadBundleFileOutcome {
  try {
    const bundlePath = input.bundlePath;
    const trustKeysPath = input.trustKeysPath;
    const tenantId = input.tenantId;
    const statePath = input.statePath;
    const now = input.now;
    if (typeof bundlePath !== "string" || bundlePath === "") return verifyFailed();
    if (typeof trustKeysPath !== "string" || trustKeysPath === "") return verifyFailed();
    if (typeof tenantId !== "string" || tenantId === "") return verifyFailed();
    if (typeof statePath !== "string" || statePath === "") return verifyFailed();
    if (typeof now !== "string" || now === "") return stale();

    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(bundlePath, "utf8"));
    } catch {
      return verifyFailed();
    }

    const trust = readTrustKeysFile(trustKeysPath);
    if (!trust.ok) return verifyFailed();

    if (!isSignedStandardBundle(raw)) return verifyFailed();
    const signed = raw;

    const trusted = trust.trustSet.get(signed.keyId);
    if (trusted === undefined) return verifyFailed();

    let signatureOk: boolean;
    try {
      const payloadBytes = Buffer.from(canonicalJson(signed.payload), "utf8");
      signatureOk = cryptoVerify(null, payloadBytes, trusted, Buffer.from(signed.signature, "base64"));
    } catch {
      signatureOk = false;
    }
    if (!signatureOk) return verifyFailed();

    if (signed.payload.tenantId !== tenantId) return verifyFailed();

    let hash: string;
    try {
      hash = bundleHashOf(signed);
    } catch {
      return verifyFailed();
    }
    const sequence = signed.payload.sequence;

    const active = readStateEntry(statePath, tenantId);
    if (active !== null && sequence === active.sequence && hash !== active.hash) {
      return verifyFailed();
    }
    if (active !== null && sequence < active.sequence) {
      return verifyFailed();
    }

    if (isBundleStale(signed.payload, now)) return stale();

    if (active !== null && sequence === active.sequence && hash === active.hash) {
      return { ok: true, signed, hash, sequence, exitCode: 0 };
    }

    try {
      writeStateEntry(statePath, tenantId, { sequence, hash });
    } catch {
      // Best-effort persist: verification already passed.
    }
    return { ok: true, signed, hash, sequence, exitCode: 0 };
  } catch {
    return verifyFailed();
  }
}
