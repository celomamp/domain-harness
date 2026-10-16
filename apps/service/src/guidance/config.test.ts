// Unit tests for the Guidance server's environment configuration (Stories
// 4.4 + 4.6, extended by 6.7): every start-up failure is exactly one envelope
// (missing_configuration or invalid_configuration) naming the offending
// variable, checked in the declared-variable order — the bundles daemon's
// env-suite pattern.
import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DEFAULT_GUIDANCE_PORT, GuidanceConfigError, guidanceServiceConfigFromEnv } from "./config.ts";

const TENANT = "018f3d2a-7000-7000-8000-000000000100";
const INVALID_TENANT = "not-a-uuid";
const TRUST_KEYS = JSON.stringify({
  "registry-key-2026-10": generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }),
});

function baseEnv(): Record<string, string | undefined> {
  return {
    SERVICE_TENANT_ID: TENANT,
    SERVICE_RECORD_DATABASE_URL: "postgres://postgres:postgres@localhost:5432/postgres",
    SERVICE_READ_CREDENTIAL: "read-secret-4-6-opaque",
    SERVICE_VENDOR_URL: "http://registry.test",
    SERVICE_TENANT_CREDENTIAL: "tenant-credential",
    SERVICE_ROLE_TOKEN_TRUST_KEYS: TRUST_KEYS,
  };
}

function configErrorOf(fn: () => unknown): GuidanceConfigError {
  try {
    fn();
  } catch (error) {
    if (error instanceof GuidanceConfigError) return error;
    throw new Error(`the call did not throw a GuidanceConfigError: ${String(error)}`, { cause: error });
  }
  throw new Error("the call did not throw");
}

describe("guidanceServiceConfigFromEnv", () => {
  it("reads the full valid configuration with the default port", () => {
    const config = guidanceServiceConfigFromEnv(baseEnv());
    expect(config.tenantId).toBe(TENANT);
    expect(config.recordDatabaseUrl).toBe("postgres://postgres:postgres@localhost:5432/postgres");
    expect(config.readCredential).toBe("read-secret-4-6-opaque");
    expect(config.port).toBe(DEFAULT_GUIDANCE_PORT);
    expect(config.registryUrl).toBe("http://registry.test");
    expect(config.registryCredential).toBe("tenant-credential");
    expect([...config.tokenTrustSet.keys()]).toEqual(["registry-key-2026-10"]);
    expect(DEFAULT_GUIDANCE_PORT).toBe(8080);
  });

  it("honours a configured port within 1..65535", () => {
    expect(guidanceServiceConfigFromEnv({ ...baseEnv(), SERVICE_GUIDANCE_PORT: "18080" }).port).toBe(18080);
    expect(guidanceServiceConfigFromEnv({ ...baseEnv(), SERVICE_GUIDANCE_PORT: " 1 " }).port).toBe(1);
    expect(guidanceServiceConfigFromEnv({ ...baseEnv(), SERVICE_GUIDANCE_PORT: "65535" }).port).toBe(65535);
  });

  it("requires each variable with one envelope", () => {
    for (const name of [
      "SERVICE_TENANT_ID",
      "SERVICE_RECORD_DATABASE_URL",
      "SERVICE_READ_CREDENTIAL",
      "SERVICE_VENDOR_URL",
      "SERVICE_TENANT_CREDENTIAL",
      "SERVICE_ROLE_TOKEN_TRUST_KEYS",
    ]) {
      const env = baseEnv();
      env[name] = undefined;
      const removed = configErrorOf(() => guidanceServiceConfigFromEnv(env));
      expect(removed.code).toBe("missing_configuration");
      expect(removed.subject).toBe(name);
      expect(removed.message.length > 0).toBe(true);

      const blank = configErrorOf(() => guidanceServiceConfigFromEnv({ ...baseEnv(), [name]: "   " }));
      expect(blank.code).toBe("missing_configuration");
      expect(blank.subject).toBe(name);
    }
  });

  it("rejects an empty or whitespace-only read credential as missing_configuration", () => {
    for (const raw of ["", "   ", "\t\n "]) {
      const error = configErrorOf(() => guidanceServiceConfigFromEnv({ ...baseEnv(), SERVICE_READ_CREDENTIAL: raw }));
      expect(error.code).toBe("missing_configuration");
      expect(error.subject).toBe("SERVICE_READ_CREDENTIAL");
    }
  });

  it("refuses a tenant id that is not a UUIDv7", () => {
    const error = configErrorOf(() => guidanceServiceConfigFromEnv({ ...baseEnv(), SERVICE_TENANT_ID: INVALID_TENANT }));
    expect(error.code).toBe("invalid_configuration");
    expect(error.subject).toBe("SERVICE_TENANT_ID");
  });

  it("refuses a vendor URL that is not an http(s) URL and trust keys that are not Ed25519 PEMs", () => {
    for (const raw of ["not-a-url", "ftp://registry.test", ""]) {
      const url = configErrorOf(() => guidanceServiceConfigFromEnv({ ...baseEnv(), SERVICE_VENDOR_URL: raw }));
      expect(url.subject).toBe("SERVICE_VENDOR_URL");
    }
    for (const raw of ["not-json", "[]", '{"": "x"}', '{"key": "not-a-pem"}']) {
      const keys = configErrorOf(() => guidanceServiceConfigFromEnv({ ...baseEnv(), SERVICE_ROLE_TOKEN_TRUST_KEYS: raw }));
      expect(keys.code).toBe("invalid_configuration");
      expect(keys.subject).toBe("SERVICE_ROLE_TOKEN_TRUST_KEYS");
    }
  });

  it("refuses a port outside 1..65535 or not a number", () => {
    for (const raw of ["0", "-1", "65536", "soon", "1.5"]) {
      const error = configErrorOf(() =>
        guidanceServiceConfigFromEnv({ ...baseEnv(), SERVICE_GUIDANCE_PORT: raw }),
      );
      expect(error.code).toBe("invalid_configuration");
      expect(error.subject).toBe("SERVICE_GUIDANCE_PORT");
    }
  });

  it("throws exactly one envelope, in declared-variable order", () => {
    // Missing tenant id wins over every later failure.
    const first = configErrorOf(() => guidanceServiceConfigFromEnv({ SERVICE_RECORD_DATABASE_URL: "   " }));
    expect(first.subject).toBe("SERVICE_TENANT_ID");
    // With the tenant id fine, an unset database URL is next.
    const second = configErrorOf(() => guidanceServiceConfigFromEnv({ SERVICE_TENANT_ID: TENANT }));
    expect(second.subject).toBe("SERVICE_RECORD_DATABASE_URL");
    // With both fine, a missing read credential is next (checked before the optional port).
    const credential = configErrorOf(() =>
      guidanceServiceConfigFromEnv({ SERVICE_TENANT_ID: TENANT, SERVICE_RECORD_DATABASE_URL: "postgres://x" }),
    );
    expect(credential.code).toBe("missing_configuration");
    expect(credential.subject).toBe("SERVICE_READ_CREDENTIAL");
    // With all required fine, a bad port is the only failure left.
    const third = configErrorOf(() => guidanceServiceConfigFromEnv({ ...baseEnv(), SERVICE_GUIDANCE_PORT: "0" }));
    expect(third.subject).toBe("SERVICE_GUIDANCE_PORT");
  });
});
