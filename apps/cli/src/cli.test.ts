import { describe, expect, it } from "vitest";
import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { BUNDLE_FORMAT_VERSION, BUNDLE_TYPE, canonicalJson } from "@domain-harness/contract";
import type { SignedStandardBundle, StandardBundlePayload, UuidV7 } from "@domain-harness/contract";
import { defaultStatePath, isCliEntryPoint, parseVerifyArgs, run } from "./cli.ts";
import { bundleHashOf } from "./bundle-file.ts";

const TENANT = "018f3d2a-7000-7000-8000-000000000100" as UuidV7;
const ROOT_PROJECT = "018f3d2a-7000-7000-8000-000000000110" as UuidV7;
const MODULE_ID = "018f3d2a-7000-7000-8000-000000000120" as UuidV7;
const STANDARD_ID = "018f3d2a-7000-7000-8000-000000000130" as UuidV7;
const ACCOUNT_ID = "018f3d2a-7000-7000-8000-000000000140" as UuidV7;

function makeKey(keyId: string): { keyId: string; publicPem: string; privateKey: KeyObject } {
  const pair = generateKeyPairSync("ed25519");
  return {
    keyId,
    publicPem: String(pair.publicKey.export({ type: "spki", format: "pem" })),
    privateKey: pair.privateKey,
  };
}

function makePayload(keyId: string, sequence: number, issuedAt: string, frozen = false): StandardBundlePayload {
  return {
    format: { type: BUNDLE_TYPE, version: BUNDLE_FORMAT_VERSION },
    tenantId: TENANT,
    sequence,
    keyId,
    issuedAt,
    stalenessHours: 24,
    frozen,
    standards: [
      {
        id: STANDARD_ID,
        version: 1,
        module: { id: MODULE_ID, kind: "code-stack", name: "Backend" },
        project: { id: ROOT_PROJECT, name: "Root" },
        entry: {
          category: "library",
          name: "lodash",
          versionConstraint: null,
          status: "prohibited",
          correctionInstruction: null,
        },
        publishedAt: "2026-10-14T00:00:00.000Z",
        publishedBy: { accountId: ACCOUNT_ID, name: "Bea" },
      },
    ],
    tree: {
      rootId: ROOT_PROJECT,
      projects: [
        { id: ROOT_PROJECT, name: "Root", levelName: null, parentId: null, createdAt: "2026-10-14T00:00:00.000Z" },
      ],
      lockedRules: [],
    },
    applications: [],
    acceptedDeviations: [],
  };
}

function signPayload(payload: StandardBundlePayload, signer: { keyId: string; privateKey: KeyObject }): SignedStandardBundle {
  const finalPayload = { ...payload, keyId: signer.keyId };
  const signature = cryptoSign(null, Buffer.from(canonicalJson(finalPayload), "utf8"), signer.privateKey).toString("base64");
  return { payload: finalPayload, keyId: signer.keyId, signature };
}

const FRESH_ISSUED = "2026-10-14T10:00:00.000Z";
const FRESH_NOW = "2026-10-14T12:00:00.000Z";

describe("cli bundle verify", () => {
  it("success prints the verified hash and sequence with exit 0 and records state", () => {
    const signer = makeKey("key-1");
    const dir = mkdtempSync(join(tmpdir(), "dh-cli-"));
    const signed = signPayload(makePayload(signer.keyId, 1, FRESH_ISSUED), signer);
    const bundlePath = join(dir, "bundle.json");
    const trustPath = join(dir, "trust.json");
    const statePath = join(dir, "state.json");
    writeFileSync(bundlePath, JSON.stringify(signed));
    writeFileSync(trustPath, JSON.stringify({ [signer.keyId]: signer.publicPem }));
    const result = run(["bundle", "verify", "--bundle", bundlePath, "--trust-keys", trustPath, "--tenant", TENANT, "--state", statePath, "--now", FRESH_NOW]);
    expect(result.exitCode).toBe(0);
    const expectedHash = bundleHashOf(signed);
    expect(result.line).toBe(`bundle verified ${expectedHash} 1`);
    expect(result.line).toContain(expectedHash);
    expect(result.line).toContain("1");
    expect(existsSync(statePath)).toBe(true);
    expect(JSON.parse(readFileSync(statePath, "utf8"))).toEqual({ [TENANT]: { sequence: 1, hash: bundleHashOf(signed) } });
  });

  it("tampered bundle prints exactly verification-failed with exit 1 and leaves state unchanged", () => {
    const signer = makeKey("key-1");
    const dir = mkdtempSync(join(tmpdir(), "dh-cli-"));
    const signed = signPayload(makePayload(signer.keyId, 1, FRESH_ISSUED), signer);
    const bundlePath = join(dir, "bundle.json");
    const trustPath = join(dir, "trust.json");
    const statePath = join(dir, "state.json");
    writeFileSync(bundlePath, JSON.stringify(signed));
    writeFileSync(trustPath, JSON.stringify({ [signer.keyId]: signer.publicPem }));
    const first = run(["bundle", "verify", "--bundle", bundlePath, "--trust-keys", trustPath, "--tenant", TENANT, "--state", statePath, "--now", FRESH_NOW]);
    expect(first.exitCode).toBe(0);
    const before = readFileSync(statePath, "utf8");
    const tampered = { ...signed, signature: `B${signed.signature.slice(1)}` };
    writeFileSync(bundlePath, JSON.stringify(tampered));
    const result = run(["bundle", "verify", "--bundle", bundlePath, "--trust-keys", trustPath, "--tenant", TENANT, "--state", statePath, "--now", FRESH_NOW]);
    expect(result.exitCode).toBe(1);
    expect(result.line).toBe("bundle verification failed");
    expect(readFileSync(statePath, "utf8")).toBe(before);
  });

  it("stale bundle prints exactly bundle-stale with exit 1", () => {
    const signer = makeKey("key-1");
    const dir = mkdtempSync(join(tmpdir(), "dh-cli-"));
    const signed = signPayload(makePayload(signer.keyId, 1, "2026-10-12T12:00:00.000Z"), signer);
    const bundlePath = join(dir, "bundle.json");
    const trustPath = join(dir, "trust.json");
    const statePath = join(dir, "state.json");
    writeFileSync(bundlePath, JSON.stringify(signed));
    writeFileSync(trustPath, JSON.stringify({ [signer.keyId]: signer.publicPem }));
    const result = run(["bundle", "verify", "--bundle", bundlePath, "--trust-keys", trustPath, "--tenant", TENANT, "--state", statePath, "--now", FRESH_NOW]);
    expect(result.exitCode).toBe(1);
    expect(result.line).toBe("bundle stale");
    expect(existsSync(statePath)).toBe(false);
  });

  it("unknown-major bundle refuses at the command surface with state unchanged", () => {
    const signer = makeKey("key-1");
    const dir = mkdtempSync(join(tmpdir(), "dh-cli-"));
    const payload = makePayload(signer.keyId, 1, FRESH_ISSUED);
    const future = signPayload({ ...payload, format: { type: BUNDLE_TYPE, version: BUNDLE_FORMAT_VERSION + 1 } }, signer);
    const bundlePath = join(dir, "bundle.json");
    const trustPath = join(dir, "trust.json");
    const statePath = join(dir, "state.json");
    writeFileSync(bundlePath, JSON.stringify(future));
    writeFileSync(trustPath, JSON.stringify({ [signer.keyId]: signer.publicPem }));
    const result = run(["bundle", "verify", "--bundle", bundlePath, "--trust-keys", trustPath, "--tenant", TENANT, "--state", statePath, "--now", FRESH_NOW]);
    expect(result.exitCode).toBe(1);
    expect(result.line).toBe("bundle verification failed");
    expect(existsSync(statePath)).toBe(false);
  });

  it("usage defects fail closed with verification-failed", () => {
    expect(run(["bundle", "verify"]).line).toBe("bundle verification failed");
    expect(run(["bundle", "verify"]).exitCode).toBe(1);
    expect(run(["bundle"]).exitCode).toBe(1);
    expect(run([]).line).toBe("bundle verification failed");
    expect(run(["bundle", "verify", "--bundle", "a", "--trust-keys", "b"]).exitCode).toBe(1);
    expect(run(["bundle", "verify", "--bundle", "a", "--trust-keys", "b", "--tenant", TENANT, "--bogus", "x"]).exitCode).toBe(1);
  });

  it("parses equals-form flags and applies defaults", () => {
    const parsed = parseVerifyArgs([
      "bundle",
      "verify",
      "--bundle=/b.json",
      "--trust-keys=/t.json",
      "--tenant",
      TENANT,
    ]);
    expect(parsed?.bundlePath).toBe("/b.json");
    expect(parsed?.trustKeysPath).toBe("/t.json");
    expect(parsed?.tenantId).toBe(TENANT);
    expect(typeof parsed?.statePath).toBe("string");
    expect(typeof parsed?.now).toBe("string");
    expect(parseVerifyArgs(["bundle", "verify", "--bundle", "a"])).toBeNull();
  });

  it("rejects an unparseable --now clock as a usage defect", () => {
    expect(
      parseVerifyArgs(["bundle", "verify", "--bundle", "a", "--trust-keys", "b", "--tenant", TENANT, "--now", "not-a-clock"]),
    ).toBeNull();
    expect(
      run(["bundle", "verify", "--bundle", "a", "--trust-keys", "b", "--tenant", TENANT, "--now", "not-a-clock"]).line,
    ).toBe("bundle verification failed");
  });

  it("detects the entry point on posix and Windows argv forms", () => {
    expect(isCliEntryPoint("/repo/apps/cli/dist/cli.js")).toBe(true);
    expect(isCliEntryPoint("/repo/apps/cli/src/cli.ts")).toBe(true);
    expect(isCliEntryPoint("C:\\repo\\apps\\cli\\dist\\cli.js")).toBe(true);
    expect(isCliEntryPoint("C:\\repo\\apps\\cli\\src\\cli.ts")).toBe(true);
    expect(isCliEntryPoint("/repo/node_modules/vitest/vitest.mjs")).toBe(false);
    expect(isCliEntryPoint("C:\\repo\\node_modules\\vitest\\vitest.mjs")).toBe(false);
    expect(isCliEntryPoint(undefined)).toBe(false);
  });

  it("pins the default state path under the cache dir, never the working tree", () => {
    const saved = process.env["XDG_CACHE_HOME"];
    try {
      const xdgDir = join(tmpdir(), "dh-xdg-cache");
      process.env["XDG_CACHE_HOME"] = xdgDir;
      const viaXdg = defaultStatePath();
      expect(isAbsolute(viaXdg)).toBe(true);
      expect(viaXdg).toBe(join(xdgDir, "domain-harness", "bundle-state.json"));

      process.env["XDG_CACHE_HOME"] = "relative/cache";
      const fallback = defaultStatePath();
      expect(isAbsolute(fallback)).toBe(true);
      expect(fallback.endsWith(join("domain-harness", "bundle-state.json"))).toBe(true);
      expect(fallback).not.toContain("relative/cache");

      delete process.env["XDG_CACHE_HOME"];
      const osDefault = defaultStatePath();
      expect(isAbsolute(osDefault)).toBe(true);
      expect(osDefault.endsWith(join("domain-harness", "bundle-state.json"))).toBe(true);
    } finally {
      if (saved === undefined) {
        delete process.env["XDG_CACHE_HOME"];
      } else {
        process.env["XDG_CACHE_HOME"] = saved;
      }
    }
  });

  it("resolves the default state path when --state is omitted", () => {
    const saved = process.env["XDG_CACHE_HOME"];
    try {
      const xdgDir = join(tmpdir(), "dh-xdg-parse");
      process.env["XDG_CACHE_HOME"] = xdgDir;
      const parsed = parseVerifyArgs(["bundle", "verify", "--bundle", "a", "--trust-keys", "b", "--tenant", TENANT]);
      expect(parsed?.statePath).toBe(join(xdgDir, "domain-harness", "bundle-state.json"));
    } finally {
      if (saved === undefined) {
        delete process.env["XDG_CACHE_HOME"];
      } else {
        process.env["XDG_CACHE_HOME"] = saved;
      }
    }
  });
});
