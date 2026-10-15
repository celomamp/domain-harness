import { describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { parseTrustKeysJson, readTrustKeysFile, isEd25519PublicKeyPem } from "./trust-keys.ts";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function makeKey() {
  const pair = generateKeyPairSync("ed25519");
  const pem = String(pair.publicKey.export({ type: "spki", format: "pem" }));
  return pem;
}

describe("trust-keys", () => {
  it("parses one key id to PEM", () => {
    const pem = makeKey();
    const outcome = parseTrustKeysJson(JSON.stringify({ "key-1": pem }));
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.trustSet.size).toBe(1);
      expect(outcome.trustSet.has("key-1")).toBe(true);
    }
  });

  it("parses rotation overlap by key id", () => {
    const outcome = parseTrustKeysJson(JSON.stringify({ a: makeKey(), b: makeKey() }));
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.trustSet.size).toBe(2);
  });

  it("rejects malformed JSON", () => {
    expect(parseTrustKeysJson("{not json").ok).toBe(false);
  });

  it("rejects non-object bodies", () => {
    for (const text of ["null", "42", '"str"', "[]", "123"]) {
      expect(parseTrustKeysJson(text).ok).toBe(false);
    }
  });

  it("rejects an empty object: nothing can be verified without trust", () => {
    expect(parseTrustKeysJson("{}").ok).toBe(false);
  });

  it("rejects blank key ids", () => {
    const pem = makeKey();
    expect(parseTrustKeysJson(JSON.stringify({ "": pem })).ok).toBe(false);
    expect(parseTrustKeysJson(JSON.stringify({ "   ": pem })).ok).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(parseTrustKeysJson(JSON.stringify({ "key-1": 42 })).ok).toBe(false);
  });

  it("rejects non-Ed25519 PEM values", () => {
    expect(parseTrustKeysJson(JSON.stringify({ "key-1": "not-a-pem" })).ok).toBe(false);
    const rsa = generateKeyPairSync("rsa", { modulusLength: 512 });
    const rsaPem = String(rsa.publicKey.export({ type: "spki", format: "pem" }));
    expect(isEd25519PublicKeyPem(rsaPem)).toBe(false);
    expect(parseTrustKeysJson(JSON.stringify({ "key-1": rsaPem })).ok).toBe(false);
  });

  it("reads a trust file from disk and refuses an unreadable path without throwing", () => {
    const dir = mkdtempSync(join(tmpdir(), "dh-trust-"));
    const path = join(dir, "trust.json");
    writeFileSync(path, JSON.stringify({ "key-1": makeKey() }));
    expect(readTrustKeysFile(path).ok).toBe(true);
    expect(readTrustKeysFile(join(dir, "missing.json")).ok).toBe(false);
  });

  it("never throws on non-string input", () => {
    expect(parseTrustKeysJson(undefined as unknown as string).ok).toBe(false);
  });
});
