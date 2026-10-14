import { createHash, createPrivateKey, sign as cryptoSign } from "node:crypto";
import type { SignedStandardBundle } from "@domain-harness/contract";
import { canonicalJson } from "@domain-harness/contract";
import { EnvelopeError } from "../errors.ts";

export interface Signer {
  readonly keyId: string;
  sign(bytes: Uint8Array | Buffer): string;
}

export function sha256Hex(bytes: Uint8Array | Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function bundleHash(signed: SignedStandardBundle): string {
  return sha256Hex(Buffer.from(canonicalJson(signed), "utf8"));
}

export function ed25519SignerFromEnv(env: Record<string, string | undefined>): Signer {
  const pem = env["REGISTRY_BUNDLE_SIGNING_KEY"];
  const keyId = env["REGISTRY_BUNDLE_SIGNING_KEY_ID"];
  if (pem === undefined || pem.trim() === "") {
    throw new EnvelopeError({
      code: "missing_configuration",
      message: "REGISTRY_BUNDLE_SIGNING_KEY is not set",
      subject: "REGISTRY_BUNDLE_SIGNING_KEY",
    });
  }
  if (keyId === undefined || keyId.trim() === "") {
    throw new EnvelopeError({
      code: "missing_configuration",
      message: "REGISTRY_BUNDLE_SIGNING_KEY_ID is not set",
      subject: "REGISTRY_BUNDLE_SIGNING_KEY_ID",
    });
  }
  const normalizedPem = pem.replace(/\\n/g, "\n").trim();
  let privateKey;
  try {
    privateKey = createPrivateKey(normalizedPem);
  } catch (cause) {
    throw new EnvelopeError(
      {
        code: "invalid_configuration",
        message: "REGISTRY_BUNDLE_SIGNING_KEY must be an Ed25519 private key in PKCS#8 PEM format",
        subject: "REGISTRY_BUNDLE_SIGNING_KEY",
      },
      { cause },
    );
  }
  if (privateKey.asymmetricKeyType !== "ed25519") {
    throw new EnvelopeError({
      code: "invalid_configuration",
      message: "REGISTRY_BUNDLE_SIGNING_KEY must be an Ed25519 private key in PKCS#8 PEM format",
      subject: "REGISTRY_BUNDLE_SIGNING_KEY",
    });
  }
  return {
    keyId: keyId.trim(),
    sign(bytes) {
      return cryptoSign(null, Buffer.from(bytes), privateKey).toString("base64");
    },
  };
}
