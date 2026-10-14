// Unit tests for the daemon's environment configuration (Story 4.2): every
// start-up failure is exactly one envelope (missing_configuration or
// invalid_configuration) naming the offending variable.
import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { BundleConfigError, bundleServiceConfigFromEnv, parseTrustKeys } from "./env.ts";
import { makeSigningKey, TEST_TENANT_ID } from "./test-fixtures.ts";

const signer = makeSigningKey("key-1");
const TRUST_KEYS_JSON = JSON.stringify({ "key-1": signer.publicKeyPem });
const INVALID_TENANT = "not-a-uuid";

function baseEnv(): Record<string, string | undefined> {
  return {
    SERVICE_VENDOR_URL: "https://registry.example",
    SERVICE_TENANT_ID: TEST_TENANT_ID,
    SERVICE_TENANT_CREDENTIAL: "cred",
    SERVICE_BUNDLE_TRUST_KEYS: TRUST_KEYS_JSON,
    SERVICE_RECORD_DATABASE_URL: "postgres://postgres:postgres@localhost:5432/postgres",
  };
}

function configErrorOf(fn: () => unknown): BundleConfigError {
  try {
    fn();
  } catch (error) {
    if (error instanceof BundleConfigError) return error;
    throw new Error(`the call did not throw a BundleConfigError: ${String(error)}`, { cause: error });
  }
  throw new Error("the call did not throw");
}

describe("bundleServiceConfigFromEnv", () => {
  it("reads the full valid configuration with a default pull interval", () => {
    const config = bundleServiceConfigFromEnv(baseEnv());
    expect(config.vendorUrl).toBe("https://registry.example");
    expect(config.tenantId).toBe(TEST_TENANT_ID);
    expect(config.credential).toBe("cred");
    expect(config.recordDatabaseUrl).toBe("postgres://postgres:postgres@localhost:5432/postgres");
    expect(config.pullIntervalMs).toBe(60_000);
    expect(config.trustSet.get("key-1")).toBeDefined();
  });

  it("honours a configured pull interval and strips the vendor URL's trailing slashes", () => {
    const config = bundleServiceConfigFromEnv({
      ...baseEnv(),
      SERVICE_VENDOR_URL: "http://127.0.0.1:4100/",
      SERVICE_PULL_INTERVAL_MS: "1500",
    });
    expect(config.vendorUrl).toBe("http://127.0.0.1:4100");
    expect(config.pullIntervalMs).toBe(1500);
  });

  it("requires each variable with one envelope", () => {
    for (const name of [
      "SERVICE_VENDOR_URL",
      "SERVICE_TENANT_ID",
      "SERVICE_TENANT_CREDENTIAL",
      "SERVICE_BUNDLE_TRUST_KEYS",
      "SERVICE_RECORD_DATABASE_URL",
    ]) {
      const env = baseEnv();
      env[name] = undefined;
      const removed = configErrorOf(() => bundleServiceConfigFromEnv(env));
      expect(removed.code).toBe("missing_configuration");
      expect(removed.subject).toBe(name);
      expect(removed.message.length > 0).toBe(true);

      const blank = configErrorOf(() => bundleServiceConfigFromEnv({ ...baseEnv(), [name]: "   " }));
      expect(blank.code).toBe("missing_configuration");
      expect(blank.subject).toBe(name);
    }
  });

  it("refuses a vendor URL that is not an http or https URL", () => {
    for (const raw of ["not a url", "ftp://registry.example"]) {
      const error = configErrorOf(() => bundleServiceConfigFromEnv({ ...baseEnv(), SERVICE_VENDOR_URL: raw }));
      expect(error.code).toBe("invalid_configuration");
      expect(error.subject).toBe("SERVICE_VENDOR_URL");
    }
  });

  it("refuses a tenant id that is not a UUIDv7", () => {
    const error = configErrorOf(() =>
      bundleServiceConfigFromEnv({ ...baseEnv(), SERVICE_TENANT_ID: INVALID_TENANT }),
    );
    expect(error.code).toBe("invalid_configuration");
    expect(error.subject).toBe("SERVICE_TENANT_ID");
  });

  it("refuses an invalid pull interval", () => {
    for (const raw of ["0", "-1", "1.5", "soon", "2147483648"]) {
      const error = configErrorOf(() =>
        bundleServiceConfigFromEnv({ ...baseEnv(), SERVICE_PULL_INTERVAL_MS: raw }),
      );
      expect(error.code).toBe("invalid_configuration");
      expect(error.subject).toBe("SERVICE_PULL_INTERVAL_MS");
    }
    // The largest accepted interval is one below Node's setTimeout clamp.
    const config = bundleServiceConfigFromEnv({ ...baseEnv(), SERVICE_PULL_INTERVAL_MS: "2147483647" });
    expect(config.pullIntervalMs).toBe(2147483647);
  });

  it("refuses a malformed trust set or a wrong PEM type with one envelope", () => {
    for (const raw of ["not json", '{"key-1":', "[]", "null", JSON.stringify([])]) {
      const error = configErrorOf(() =>
        bundleServiceConfigFromEnv({ ...baseEnv(), SERVICE_BUNDLE_TRUST_KEYS: raw }),
      );
      expect(error.code).toBe("invalid_configuration");
      expect(error.subject).toBe("SERVICE_BUNDLE_TRUST_KEYS");
    }
    const wrongType = configErrorOf(() =>
      bundleServiceConfigFromEnv({
        ...baseEnv(),
        SERVICE_BUNDLE_TRUST_KEYS: JSON.stringify({
          "key-1": "-----BEGIN PUBLIC KEY-----\nbanana\n-----END PUBLIC KEY-----",
        }),
      }),
    );
    expect(wrongType.code).toBe("invalid_configuration");
    expect(wrongType.subject).toBe("SERVICE_BUNDLE_TRUST_KEYS");
  });

  it("refuses an empty key id", () => {
    const error = configErrorOf(() =>
      bundleServiceConfigFromEnv({
        ...baseEnv(),
        SERVICE_BUNDLE_TRUST_KEYS: JSON.stringify({ "": signer.publicKeyPem }),
      }),
    );
    expect(error.code).toBe("invalid_configuration");
    expect(error.subject).toBe("SERVICE_BUNDLE_TRUST_KEYS");
  });
});

describe("parseTrustKeys", () => {
  const invalid = (message: string): Error => new Error(message);

  it("builds a deny-all trust set from an empty JSON object", () => {
    const trustSet = parseTrustKeys("{}", invalid);
    expect(trustSet.size).toBe(0);
  });

  it("builds one entry per key id, accepting rotation overlap", () => {
    const second = makeSigningKey("key-2");
    const trustSet = parseTrustKeys(JSON.stringify({ "key-1": signer.publicKeyPem, "key-2": second.publicKeyPem }), invalid);
    expect(trustSet.size).toBe(2);
    expect(trustSet.has("key-1")).toBe(true);
    expect(trustSet.has("key-2")).toBe(true);
  });

  it("refuses a non-object, invalid JSON or empty key id", () => {
    expect(() => parseTrustKeys("{", invalid)).toThrow(Error);
    expect(() => parseTrustKeys("[]", invalid)).toThrow(Error);
    expect(() => parseTrustKeys(JSON.stringify({ " ": signer.publicKeyPem }), invalid)).toThrow(/empty key id/);
  });

  it("refuses a value that is a wrong-type key", () => {
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = String(rsa.publicKey.export({ type: "spki", format: "pem" }));
    expect(() => parseTrustKeys(JSON.stringify({ "key-1": pem }), invalid)).toThrow(/Ed25519/);
    expect(() => parseTrustKeys(JSON.stringify({ "key-1": 7 }), invalid)).toThrow(Error);
  });
});
