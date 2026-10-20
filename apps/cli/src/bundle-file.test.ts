import { describe, expect, it } from "vitest";
import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BUNDLE_FORMAT_VERSION,
  BUNDLE_TYPE,
  canonicalJson,
  isSignedStandardBundle,
} from "@domain-harness/contract";
import type { SignedStandardBundle, StandardBundlePayload, UuidV7 } from "@domain-harness/contract";
import { BUNDLE_STALE, BUNDLE_VERIFICATION_FAILED } from "@domain-harness/gate";
import { bundleHashOf, isBundleStale, loadBundleFile } from "./bundle-file.ts";
import { readStateEntry } from "./bundle-state.ts";

const TENANT = "018f3d2a-7000-7000-8000-000000000100" as UuidV7;
const OTHER_TENANT = "018f3d2a-7000-7000-8000-000000000101" as UuidV7;
const ROOT_PROJECT = "018f3d2a-7000-7000-8000-000000000110" as UuidV7;
const MODULE_ID = "018f3d2a-7000-7000-8000-000000000120" as UuidV7;
const STANDARD_ID = "018f3d2a-7000-7000-8000-000000000130" as UuidV7;
const ACCOUNT_ID = "018f3d2a-7000-7000-8000-000000000140" as UuidV7;

interface TestKey {
  readonly keyId: string;
  readonly publicPem: string;
  readonly privateKey: KeyObject;
}

function makeKey(keyId: string): TestKey {
  const pair = generateKeyPairSync("ed25519");
  return {
    keyId,
    publicPem: String(pair.publicKey.export({ type: "spki", format: "pem" })),
    privateKey: pair.privateKey,
  };
}

function makePayload(overrides: {
  keyId: string;
  sequence: number;
  issuedAt: string;
  tenantId?: UuidV7;
  stalenessHours?: number;
  frozen?: boolean;
}): StandardBundlePayload {
  return {
    format: { type: BUNDLE_TYPE, version: BUNDLE_FORMAT_VERSION },
    tenantId: overrides.tenantId ?? TENANT,
    sequence: overrides.sequence,
    keyId: overrides.keyId,
    issuedAt: overrides.issuedAt,
    stalenessHours: overrides.stalenessHours ?? 24,
    frozen: overrides.frozen ?? false,
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
        {
          id: ROOT_PROJECT,
          name: "Root",
          levelName: null,
          parentId: null,
          createdAt: "2026-10-14T00:00:00.000Z",
        },
      ],
      lockedRules: [],
    },
    applications: [],
    acceptedDeviations: [],
  };
}

function signPayload(payload: StandardBundlePayload, signer: TestKey): SignedStandardBundle {
  const finalPayload = { ...payload, keyId: signer.keyId };
  const signature = cryptoSign(null, Buffer.from(canonicalJson(finalPayload), "utf8"), signer.privateKey).toString(
    "base64",
  );
  return { payload: finalPayload, keyId: signer.keyId, signature };
}

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "dh-bundle-"));
}

function writeInputs(dir: string, signed: unknown, trust: Record<string, string>): {
  bundlePath: string;
  trustPath: string;
  statePath: string;
} {
  const bundlePath = join(dir, "bundle.json");
  const trustPath = join(dir, "trust.json");
  const statePath = join(dir, "state.json");
  writeFileSync(bundlePath, typeof signed === "string" ? signed : JSON.stringify(signed));
  writeFileSync(trustPath, JSON.stringify(trust));
  return { bundlePath, trustPath, statePath };
}

const FRESH_ISSUED = "2026-10-14T10:00:00.000Z";
const FRESH_NOW = "2026-10-14T12:00:00.000Z";

describe("bundle-file loader", () => {
  it("pins the shared failure sentences byte-identically", () => {
    expect(BUNDLE_VERIFICATION_FAILED).toBe("bundle verification failed");
    expect(BUNDLE_STALE).toBe("bundle stale");
  });

  it("accepts a valid first run, prints hash and sequence, and records state", () => {
    const signer = makeKey("key-1");
    const dir = scratch();
    const signed = signPayload(makePayload({ keyId: signer.keyId, sequence: 1, issuedAt: FRESH_ISSUED }), signer);
    const { bundlePath, trustPath, statePath } = writeInputs(dir, signed, { [signer.keyId]: signer.publicPem });
    const outcome = loadBundleFile({ bundlePath, trustKeysPath: trustPath, tenantId: TENANT, statePath, now: FRESH_NOW });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.sequence).toBe(1);
    expect(outcome.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(outcome.hash).toBe(bundleHashOf(signed));
    expect(outcome.exitCode).toBe(0);
    expect(readStateEntry(statePath, TENANT)).toEqual({ sequence: 1, hash: outcome.hash });
  });

  it("advances state on a newer sequence", () => {
    const signer = makeKey("key-1");
    const dir = scratch();
    const first = signPayload(makePayload({ keyId: signer.keyId, sequence: 1, issuedAt: FRESH_ISSUED }), signer);
    const paths = writeInputs(dir, first, { [signer.keyId]: signer.publicPem });
    const firstOutcome = loadBundleFile({
      bundlePath: paths.bundlePath,
      trustKeysPath: paths.trustPath,
      tenantId: TENANT,
      statePath: paths.statePath,
      now: FRESH_NOW,
    });
    expect(firstOutcome.ok).toBe(true);
    const second = signPayload(
      makePayload({ keyId: signer.keyId, sequence: 2, issuedAt: "2026-10-14T11:00:00.000Z" }),
      signer,
    );
    writeFileSync(paths.bundlePath, JSON.stringify(second));
    const outcome = loadBundleFile({
      bundlePath: paths.bundlePath,
      trustKeysPath: paths.trustPath,
      tenantId: TENANT,
      statePath: paths.statePath,
      now: FRESH_NOW,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.sequence).toBe(2);
    expect(readStateEntry(paths.statePath, TENANT)).toEqual({ sequence: 2, hash: outcome.hash });
  });

  it("is idempotent for an equal sequence with identical bytes without rewriting state", () => {
    const signer = makeKey("key-1");
    const dir = scratch();
    const signed = signPayload(makePayload({ keyId: signer.keyId, sequence: 1, issuedAt: FRESH_ISSUED }), signer);
    const { bundlePath, trustPath, statePath } = writeInputs(dir, signed, { [signer.keyId]: signer.publicPem });
    const input = { bundlePath, trustKeysPath: trustPath, tenantId: TENANT, statePath, now: FRESH_NOW };
    const first = loadBundleFile(input);
    expect(first.ok).toBe(true);
    const before = readFileSync(statePath, "utf8");
    const mtime = statSync(statePath).mtimeMs;
    const second = loadBundleFile(input);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.hash).toBe(first.hash);
      expect(second.sequence).toBe(1);
    }
    expect(readFileSync(statePath, "utf8")).toBe(before);
    expect(statSync(statePath).mtimeMs).toBe(mtime);
  });

  it("refuses an equal sequence with a different hash and leaves state unchanged", () => {
    const signer = makeKey("key-1");
    const dir = scratch();
    const signed = signPayload(makePayload({ keyId: signer.keyId, sequence: 1, issuedAt: FRESH_ISSUED }), signer);
    const { bundlePath, trustPath, statePath } = writeInputs(dir, signed, { [signer.keyId]: signer.publicPem });
    expect(loadBundleFile({ bundlePath, trustKeysPath: trustPath, tenantId: TENANT, statePath, now: FRESH_NOW }).ok).toBe(
      true,
    );
    const before = readFileSync(statePath, "utf8");
    const altered = signPayload(
      makePayload({ keyId: signer.keyId, sequence: 1, issuedAt: "2026-10-14T10:30:00.000Z" }),
      signer,
    );
    writeFileSync(bundlePath, JSON.stringify(altered));
    const outcome = loadBundleFile({ bundlePath, trustKeysPath: trustPath, tenantId: TENANT, statePath, now: FRESH_NOW });
    expect(outcome).toMatchObject({ ok: false, reason: "verify-failed", sentence: "bundle verification failed", exitCode: 1 });
    expect(readFileSync(statePath, "utf8")).toBe(before);
  });

  it("refuses a lower sequence and leaves state unchanged", () => {
    const signer = makeKey("key-1");
    const dir = scratch();
    const second = signPayload(
      makePayload({ keyId: signer.keyId, sequence: 2, issuedAt: "2026-10-14T11:00:00.000Z" }),
      signer,
    );
    const { bundlePath, trustPath, statePath } = writeInputs(dir, second, { [signer.keyId]: signer.publicPem });
    expect(loadBundleFile({ bundlePath, trustKeysPath: trustPath, tenantId: TENANT, statePath, now: FRESH_NOW }).ok).toBe(
      true,
    );
    const before = readFileSync(statePath, "utf8");
    const first = signPayload(makePayload({ keyId: signer.keyId, sequence: 1, issuedAt: FRESH_ISSUED }), signer);
    writeFileSync(bundlePath, JSON.stringify(first));
    const outcome = loadBundleFile({ bundlePath, trustKeysPath: trustPath, tenantId: TENANT, statePath, now: FRESH_NOW });
    expect(outcome).toMatchObject({ ok: false, reason: "verify-failed", exitCode: 1 });
    if (!outcome.ok) expect(outcome.sentence).toBe("bundle verification failed");
    expect(readFileSync(statePath, "utf8")).toBe(before);
  });

  it("refuses tampered payload bytes with a trusted key", () => {
    const signer = makeKey("key-1");
    const dir = scratch();
    const base = makePayload({ keyId: signer.keyId, sequence: 1, issuedAt: FRESH_ISSUED });
    const signed = signPayload(base, signer);
    const firstStandard = signed.payload.standards[0];
    if (firstStandard === undefined) throw new Error("fixture carries no Standard");
    const tampered: SignedStandardBundle = {
      payload: {
        ...signed.payload,
        standards: [
          {
            ...firstStandard,
            module: { ...firstStandard.module, name: "Frontend" },
          },
        ],
      },
      keyId: signed.keyId,
      signature: signed.signature,
    };
    expect(isSignedStandardBundle(tampered)).toBe(true);
    const { bundlePath, trustPath, statePath } = writeInputs(dir, tampered, { [signer.keyId]: signer.publicPem });
    const outcome = loadBundleFile({ bundlePath, trustKeysPath: trustPath, tenantId: TENANT, statePath, now: FRESH_NOW });
    expect(outcome).toMatchObject({ ok: false, reason: "verify-failed", sentence: "bundle verification failed" });
  });

  it("refuses a tampered signature", () => {
    const signer = makeKey("key-1");
    const dir = scratch();
    const signed = signPayload(makePayload({ keyId: signer.keyId, sequence: 1, issuedAt: FRESH_ISSUED }), signer);
    const broken: SignedStandardBundle = { ...signed, signature: `${signed.signature.startsWith("B") ? "C" : "B"}${signed.signature.slice(1)}` };
    const { bundlePath, trustPath, statePath } = writeInputs(dir, broken, { [signer.keyId]: signer.publicPem });
    const outcome = loadBundleFile({ bundlePath, trustKeysPath: trustPath, tenantId: TENANT, statePath, now: FRESH_NOW });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.sentence).toBe("bundle verification failed");
  });

  it("refuses an unknown key id without signature work", () => {
    const signer = makeKey("key-1");
    const rogue = makeKey("rogue-key");
    const dir = scratch();
    const signed = signPayload(makePayload({ keyId: rogue.keyId, sequence: 1, issuedAt: FRESH_ISSUED }), rogue);
    const broken = { ...signed, signature: "not-a-signature" };
    const { bundlePath, trustPath, statePath } = writeInputs(dir, broken, { [signer.keyId]: signer.publicPem });
    const outcome = loadBundleFile({ bundlePath, trustKeysPath: trustPath, tenantId: TENANT, statePath, now: FRESH_NOW });
    expect(outcome).toMatchObject({ ok: false, sentence: "bundle verification failed" });
  });

  it("refuses a tenant mismatch", () => {
    const signer = makeKey("key-1");
    const dir = scratch();
    const signed = signPayload(
      makePayload({ keyId: signer.keyId, sequence: 1, issuedAt: FRESH_ISSUED, tenantId: OTHER_TENANT }),
      signer,
    );
    const { bundlePath, trustPath, statePath } = writeInputs(dir, signed, { [signer.keyId]: signer.publicPem });
    const outcome = loadBundleFile({ bundlePath, trustKeysPath: trustPath, tenantId: TENANT, statePath, now: FRESH_NOW });
    expect(outcome).toMatchObject({ ok: false, sentence: "bundle verification failed" });
  });

  it("refuses malformed bodies: bad JSON, guard failures, and unknown majors", () => {
    const signer = makeKey("key-1");
    const dir = scratch();
    const trust = { [signer.keyId]: signer.publicPem };
    const statePath = join(dir, "state.json");
    const trustPath = join(dir, "trust.json");
    writeFileSync(trustPath, JSON.stringify(trust));

    const badJson = join(dir, "bad.json");
    writeFileSync(badJson, "{not json");
    expect(
      loadBundleFile({ bundlePath: badJson, trustKeysPath: trustPath, tenantId: TENANT, statePath, now: FRESH_NOW }),
    ).toMatchObject({ ok: false, sentence: "bundle verification failed" });

    const signed = signPayload(makePayload({ keyId: signer.keyId, sequence: 1, issuedAt: FRESH_ISSUED }), signer);
    const wrongMajor = { ...signed, payload: { ...signed.payload, format: { type: BUNDLE_TYPE, version: 99 } } };
    const majorPath = join(dir, "major.json");
    writeFileSync(majorPath, JSON.stringify(wrongMajor));
    expect(
      loadBundleFile({ bundlePath: majorPath, trustKeysPath: trustPath, tenantId: TENANT, statePath, now: FRESH_NOW }),
    ).toMatchObject({ ok: false, sentence: "bundle verification failed" });

    const extraKey = { ...signed, extra: true };
    const extraPath = join(dir, "extra.json");
    writeFileSync(extraPath, JSON.stringify(extraKey));
    expect(
      loadBundleFile({ bundlePath: extraPath, trustKeysPath: trustPath, tenantId: TENANT, statePath, now: FRESH_NOW }),
    ).toMatchObject({ ok: false, sentence: "bundle verification failed" });
  });

  it("refuses missing inputs: unreadable bundle, trust, or malformed trust", () => {
    const signer = makeKey("key-1");
    const dir = scratch();
    const signed = signPayload(makePayload({ keyId: signer.keyId, sequence: 1, issuedAt: FRESH_ISSUED }), signer);
    const { bundlePath, trustPath, statePath } = writeInputs(dir, signed, { [signer.keyId]: signer.publicPem });
    expect(
      loadBundleFile({
        bundlePath: join(dir, "missing.json"),
        trustKeysPath: trustPath,
        tenantId: TENANT,
        statePath,
        now: FRESH_NOW,
      }),
    ).toMatchObject({ ok: false, sentence: "bundle verification failed" });
    expect(
      loadBundleFile({
        bundlePath,
        trustKeysPath: join(dir, "missing-trust.json"),
        tenantId: TENANT,
        statePath,
        now: FRESH_NOW,
      }),
    ).toMatchObject({ ok: false, sentence: "bundle verification failed" });
    const badTrust = join(dir, "bad-trust.json");
    writeFileSync(badTrust, JSON.stringify({ "key-1": "not-a-pem" }));
    expect(loadBundleFile({ bundlePath, trustKeysPath: badTrust, tenantId: TENANT, statePath, now: FRESH_NOW })).toMatchObject(
      { ok: false, sentence: "bundle verification failed" },
    );
    const emptyTrust = join(dir, "empty-trust.json");
    writeFileSync(emptyTrust, "{}");
    expect(
      loadBundleFile({ bundlePath, trustKeysPath: emptyTrust, tenantId: TENANT, statePath, now: FRESH_NOW }),
    ).toMatchObject({ ok: false, sentence: "bundle verification failed" });
  });

  it("stale edges: past bound refuses stale; frozen, fresh, and exact bound pass", () => {
    const signer = makeKey("key-1");
    const trust = { [signer.keyId]: signer.publicPem };
    const now = "2026-10-14T12:00:00.000Z";

    for (const [issuedAt, frozen, expected] of [
      ["2026-10-13T11:59:59.000Z", false, "stale"],
      ["2026-10-13T11:59:59.000Z", true, "ok"],
      ["2026-10-14T10:00:00.000Z", false, "ok"],
      ["2026-10-13T12:00:00.000Z", false, "ok"],
    ] as const) {
      const dir = scratch();
      const signed = signPayload(makePayload({ keyId: signer.keyId, sequence: 1, issuedAt, frozen }), signer);
      const { bundlePath, trustPath, statePath } = writeInputs(dir, signed, trust);
      const outcome = loadBundleFile({ bundlePath, trustKeysPath: trustPath, tenantId: TENANT, statePath, now });
      if (expected === "stale") {
        expect(outcome, issuedAt).toMatchObject({ ok: false, reason: "stale", sentence: "bundle stale", exitCode: 1 });
      } else {
        expect(outcome.ok, issuedAt).toBe(true);
      }
    }
  });

  it("honors a non-default stalenessHours bound", () => {
    const signer = makeKey("key-1");
    const trust = { [signer.keyId]: signer.publicPem };
    const now = "2026-10-14T12:00:00.000Z";

    const tight = signPayload(
      makePayload({ keyId: signer.keyId, sequence: 1, issuedAt: "2026-10-14T10:00:00.000Z", stalenessHours: 1 }),
      signer,
    );
    const dirTight = scratch();
    const tightPaths = writeInputs(dirTight, tight, trust);
    expect(
      loadBundleFile({
        bundlePath: tightPaths.bundlePath,
        trustKeysPath: tightPaths.trustPath,
        tenantId: TENANT,
        statePath: tightPaths.statePath,
        now,
      }),
    ).toMatchObject({ ok: false, reason: "stale", sentence: "bundle stale" });

    const loose = signPayload(
      makePayload({ keyId: signer.keyId, sequence: 1, issuedAt: "2026-10-13T11:00:00.000Z", stalenessHours: 48 }),
      signer,
    );
    const dirLoose = scratch();
    const loosePaths = writeInputs(dirLoose, loose, trust);
    expect(
      loadBundleFile({
        bundlePath: loosePaths.bundlePath,
        trustKeysPath: loosePaths.trustPath,
        tenantId: TENANT,
        statePath: loosePaths.statePath,
        now,
      }).ok,
    ).toBe(true);
  });

  it("treats future and unparseable issue times as stale", () => {
    const signer = makeKey("key-1");
    const trust = { [signer.keyId]: signer.publicPem };
    const now = FRESH_NOW;

    const future = signPayload(
      makePayload({ keyId: signer.keyId, sequence: 1, issuedAt: "2026-10-14T13:00:00.000Z" }),
      signer,
    );
    expect(isSignedStandardBundle(future)).toBe(true);
    const dirA = scratch();
    const a = writeInputs(dirA, future, trust);
    expect(loadBundleFile({ bundlePath: a.bundlePath, trustKeysPath: a.trustPath, tenantId: TENANT, statePath: a.statePath, now })).toMatchObject(
      { ok: false, sentence: "bundle stale" },
    );

    const base = signPayload(makePayload({ keyId: signer.keyId, sequence: 1, issuedAt: FRESH_ISSUED }), signer);
    const impossible = "2026-13-01T00:00:00.000Z";
    const signedImpossible = signPayload(makePayload({ keyId: signer.keyId, sequence: 1, issuedAt: impossible }), signer);
    expect(isSignedStandardBundle(signedImpossible)).toBe(true);
    const dirB = scratch();
    const bundlePath = join(dirB, "bundle.json");
    const trustPath = join(dirB, "trust.json");
    const statePath = join(dirB, "state.json");
    writeFileSync(bundlePath, JSON.stringify(signedImpossible));
    writeFileSync(trustPath, JSON.stringify(trust));
    expect(loadBundleFile({ bundlePath, trustKeysPath: trustPath, tenantId: TENANT, statePath, now })).toMatchObject({
      ok: false,
      reason: "stale",
      sentence: "bundle stale",
    });
    expect(isBundleStale({ ...base.payload, issuedAt: impossible }, now)).toBe(true);
  });

  it("accepts the registry golden bundle bytes with its recorded hash", () => {
    // Self-check against the committed golden fixture produced by the
    // registry's real signer. Read via fs (not an import) so the
    // no-cross-app-imports boundary stays clean; the test fails if the CLI
    // hash/verify rules drift from the registry output.
    const goldenPath = join(import.meta.dirname, "../../service/src/bundles/golden-signed-bundle.json");
    let golden: { publicKeyPem: string; hash: string; signed: unknown };
    try {
      golden = JSON.parse(readFileSync(goldenPath, "utf8")) as { publicKeyPem: string; hash: string; signed: unknown };
    } catch {
      throw new Error(`missing golden fixture at ${goldenPath}`);
    }
    expect(isSignedStandardBundle(golden.signed)).toBe(true);
    expect(bundleHashOf(golden.signed as SignedStandardBundle)).toBe(golden.hash);
    const signed = golden.signed as SignedStandardBundle;
    const dir = scratch();
    const bundlePath = join(dir, "bundle.json");
    const trustPath = join(dir, "trust.json");
    const statePath = join(dir, "state.json");
    writeFileSync(bundlePath, JSON.stringify(signed));
    writeFileSync(trustPath, JSON.stringify({ [signed.keyId]: golden.publicKeyPem }));
    // Golden issue time is 2026-10-14T18:00Z; verify inside its 24h bound.
    const outcome = loadBundleFile({
      bundlePath,
      trustKeysPath: trustPath,
      tenantId: signed.payload.tenantId,
      statePath,
      now: "2026-10-15T00:00:00.000Z",
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.hash).toBe(golden.hash);
      expect(outcome.sequence).toBe(signed.payload.sequence);
    }
  });

  it("heals a corrupt state file on a valid bundle and re-records", () => {
    const signer = makeKey("key-1");
    const dir = scratch();
    const signed = signPayload(makePayload({ keyId: signer.keyId, sequence: 1, issuedAt: FRESH_ISSUED }), signer);
    const { bundlePath, trustPath, statePath } = writeInputs(dir, signed, { [signer.keyId]: signer.publicPem });
    writeFileSync(statePath, "{corrupt");
    const outcome = loadBundleFile({ bundlePath, trustKeysPath: trustPath, tenantId: TENANT, statePath, now: FRESH_NOW });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(readStateEntry(statePath, TENANT)).toEqual({ sequence: 1, hash: outcome.hash });
  });

  it("never throws on cyclic input written as JSON failure or garbage state", () => {
    const dir = scratch();
    const trustPath = join(dir, "trust.json");
    writeFileSync(trustPath, JSON.stringify({ "key-1": makeKey("key-1").publicPem }));
    const statePath = join(dir, "state.json");
    writeFileSync(statePath, "{corrupt");
    const bundlePath = join(dir, "bundle.json");
    writeFileSync(bundlePath, "42");
    const outcome = loadBundleFile({ bundlePath, trustKeysPath: trustPath, tenantId: TENANT, statePath, now: FRESH_NOW });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.sentence).toBe("bundle verification failed");
  });
});
