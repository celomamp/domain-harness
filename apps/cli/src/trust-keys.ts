/**
 * Trust-keys file parser (Story 8.1): the file form of the service's trust
 * set. A JSON object of key id → Ed25519 public-key PEM. Any defect reports
 * verification failure; nothing here throws and nothing touches the network.
 */
import { createPublicKey } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";

/** The trust set: keyId → Ed25519 public key. Rotation overlaps by key id. */
export type BundleTrustSet = ReadonlyMap<string, KeyObject>;

export type ParseTrustKeysOutcome =
  | { readonly ok: true; readonly trustSet: BundleTrustSet }
  | { readonly ok: false };

/** True when `pem` parses as an Ed25519 public key. Never throws. */
export function isEd25519PublicKeyPem(pem: string): boolean {
  let key: KeyObject;
  try {
    key = createPublicKey(pem);
  } catch {
    return false;
  }
  return key.asymmetricKeyType === "ed25519";
}

/**
 * Parse trust-keys JSON text into a trust set. Never throws. Any defect —
 * unparseable JSON, a non-object, an empty object, a blank key id, or any
 * value that is not an Ed25519 PEM public key — reports failure. An empty
 * object fails: nothing can be verified without trust.
 */
export function parseTrustKeysJson(text: string): ParseTrustKeysOutcome {
  try {
    if (typeof text !== "string") return { ok: false };
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false };
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { ok: false };
    }
    const entries = Object.entries(parsed as Record<string, unknown>);
    if (entries.length === 0) return { ok: false };
    const trustSet = new Map<string, KeyObject>();
    for (const [keyId, value] of entries) {
      if (keyId.trim() === "") return { ok: false };
      if (typeof value !== "string") return { ok: false };
      if (!isEd25519PublicKeyPem(value)) return { ok: false };
      let key: KeyObject;
      try {
        key = createPublicKey(value);
      } catch {
        return { ok: false };
      }
      trustSet.set(keyId, key);
    }
    if (trustSet.size === 0) return { ok: false };
    return { ok: true, trustSet };
  } catch {
    return { ok: false };
  }
}

/**
 * Read and parse a trust-keys file. Never throws. An unreadable file reports
 * failure exactly like a malformed one.
 */
export function readTrustKeysFile(trustKeysPath: string): ParseTrustKeysOutcome {
  try {
    const text = readFileSync(trustKeysPath, "utf8");
    return parseTrustKeysJson(text);
  } catch {
    return { ok: false };
  }
}
