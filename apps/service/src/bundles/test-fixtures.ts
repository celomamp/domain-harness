/**
 * Test fixtures for the bundles unit (Story 4.2): crafted signed bundles
 * signed with generated Ed25519 keys, mirroring the registry's pinned signing
 * rule (Ed25519 base64 over the canonical payload bytes) without importing it.
 * Test file only — never imported by shipped code.
 */
import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { BUNDLE_FORMAT_VERSION, BUNDLE_TYPE, canonicalJson } from "@domain-harness/contract";
import type { SignedStandardBundle, StandardBundlePayload, UuidV7 } from "@domain-harness/contract";

export const TEST_TENANT_ID = "018f3d2a-7000-7000-8000-000000000100" as UuidV7;
export const OTHER_TENANT_ID = "018f3d2a-7000-7000-8000-000000000101" as UuidV7;

const ROOT_PROJECT_ID = "018f3d2a-7000-7000-8000-000000000110" as UuidV7;
const MODULE_ID = "018f3d2a-7000-7000-8000-000000000120" as UuidV7;
const STANDARD_ID = "018f3d2a-7000-7000-8000-000000000130" as UuidV7;
const ACCOUNT_ID = "018f3d2a-7000-7000-8000-000000000140" as UuidV7;

export interface BundleOverrides {
  /** The payload's key id; `signPayload` normally replaces it with the signer's. */
  readonly keyId: string;
  readonly sequence: number;
  /** UTC ISO-8601. */
  readonly issuedAt: string;
  readonly tenantId?: UuidV7;
  readonly stalenessHours?: number;
  readonly frozen?: boolean;
}

export function makeBundlePayload(overrides: BundleOverrides): StandardBundlePayload {
  return {
    format: { type: BUNDLE_TYPE, version: BUNDLE_FORMAT_VERSION },
    tenantId: overrides.tenantId ?? TEST_TENANT_ID,
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
        project: { id: ROOT_PROJECT_ID, name: "Root" },
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
      rootId: ROOT_PROJECT_ID,
      projects: [
        {
          id: ROOT_PROJECT_ID,
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

export interface TestSigningKey {
  readonly keyId: string;
  readonly publicKeyPem: string;
  readonly privateKey: KeyObject;
}

export function makeSigningKey(keyId: string): TestSigningKey {
  const pair = generateKeyPairSync("ed25519");
  return {
    keyId,
    publicKeyPem: String(pair.publicKey.export({ type: "spki", format: "pem" })),
    privateKey: pair.privateKey,
  };
}

/** Sign one payload per the pinned 4.1 rule; the payload's key id becomes the signer's. */
export function signPayload(payload: StandardBundlePayload, signer: TestSigningKey): SignedStandardBundle {
  const signed = { ...payload, keyId: signer.keyId };
  const signature = cryptoSign(null, Buffer.from(canonicalJson(signed), "utf8"), signer.privateKey).toString("base64");
  return { payload: signed, keyId: signer.keyId, signature };
}
