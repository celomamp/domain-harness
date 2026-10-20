/**
 * The Guidance MCP server's configuration (Stories 4.4 + 4.6, extended by
 * 6.7): it comes only from the environment; every failure throws one
 * envelope-shaped error the entry prints once to stderr before exiting 1 —
 * never a partial start. The `SERVICE_TENANT_ID` and
 * `SERVICE_RECORD_DATABASE_URL` names follow the bundles daemon
 * (`apps/service/src/bundles/env.ts`); the port is optional with the
 * documented default. The Read API credential (Story 4.6) is the one opaque
 * shared secret, required, and never logged. Story 6.7 adds the vendor
 * registry address plus the tenant credential (the retention sweep's
 * authenticated fetch; same names as the bundles daemon) and the role-token
 * trust set (the registry's Ed25519 public keys, same JSON shape as the
 * bundle trust keys). The optional MCP access token gates `/mcp` with a
 * Bearer check when the endpoint is exposed outside the Company network
 * (the pilot's hosted Guidance endpoint).
 */
import type { ErrorEnvelope, UuidV7 } from "@domain-harness/contract";
import { isUuidV7 } from "@domain-harness/contract";
import { parseTrustKeys } from "../bundles/env.ts";
import type { BundleTrustSet } from "../bundles/verify.ts";

/** The port the Guidance MCP server listens on when `SERVICE_GUIDANCE_PORT` is not set. */
export const DEFAULT_GUIDANCE_PORT = 8080;

/** One envelope-shaped start-up error of the Guidance MCP server. */
export class GuidanceConfigError extends Error implements ErrorEnvelope {
  readonly code: string;
  readonly subject: string;

  constructor(envelope: ErrorEnvelope) {
    super(envelope.message);
    this.name = "GuidanceConfigError";
    this.code = envelope.code;
    this.subject = envelope.subject;
  }
}

/** The Guidance MCP server's environment configuration. */
export interface GuidanceServiceConfig {
  /** The Company's tenant id this server serves; every identity call resolves against its bundles. */
  readonly tenantId: UuidV7;
  /** Connection string of the record store, shared with the bundles and CI Gate stores. */
  readonly recordDatabaseUrl: string;
  /** The Read API's opaque shared secret (`Authorization: Bearer`), from required `SERVICE_READ_CREDENTIAL`. */
  readonly readCredential: string;
  /** The inbound port; the server is reachable only inside the Company network, with no authentication. */
  readonly port: number;
  /** Outbound base URL of the vendor registry (http or https, no trailing slash), from required `SERVICE_VENDOR_URL`. */
  readonly registryUrl: string;
  /** The tenant's registry service credential (the sweep's authenticated fetch), from required `SERVICE_TENANT_CREDENTIAL`. */
  readonly registryCredential: string;
  /** keyId → Ed25519 public key of the vendor registry, from required `SERVICE_ROLE_TOKEN_TRUST_KEYS`. */
  readonly tokenTrustSet: BundleTrustSet;
  /** `/mcp` requires `Authorization: Bearer <token>` when set, from optional `SERVICE_GUIDANCE_ACCESS_TOKEN`; `null` serves it open. */
  readonly mcpAccessToken: string | null;
}

function required(env: Record<string, string | undefined>, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim() === "") {
    throw new GuidanceConfigError({ code: "missing_configuration", message: `${name} is not set`, subject: name });
  }
  return value.trim();
}

function tenantId(env: Record<string, string | undefined>): UuidV7 {
  const name = "SERVICE_TENANT_ID";
  const raw = required(env, name);
  if (!isUuidV7(raw)) {
    throw new GuidanceConfigError({
      code: "invalid_configuration",
      message: `${name} must be a UUIDv7 tenant id`,
      subject: name,
    });
  }
  return raw;
}

function port(env: Record<string, string | undefined>): number {
  const name = "SERVICE_GUIDANCE_PORT";
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return DEFAULT_GUIDANCE_PORT;
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new GuidanceConfigError({
      code: "invalid_configuration",
      message: `${name} must be a port number of 1..65535`,
      subject: name,
    });
  }
  return value;
}

/**
 * Read the Guidance MCP server's configuration from the environment. Throws
 * exactly one {@link GuidanceConfigError} per failure, checked in the
 * declared-variable order; nothing is started with multiple errors.
 */
export function guidanceServiceConfigFromEnv(env: Record<string, string | undefined>): GuidanceServiceConfig {
  return {
    tenantId: tenantId(env),
    recordDatabaseUrl: required(env, "SERVICE_RECORD_DATABASE_URL"),
    readCredential: required(env, "SERVICE_READ_CREDENTIAL"),
    port: port(env),
    registryUrl: registryUrl(env),
    registryCredential: required(env, "SERVICE_TENANT_CREDENTIAL"),
    tokenTrustSet: tokenTrustSet(env),
    mcpAccessToken: mcpAccessToken(env),
  };
}

function mcpAccessToken(env: Record<string, string | undefined>): string | null {
  const name = "SERVICE_GUIDANCE_ACCESS_TOKEN";
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return null;
  const value = raw.trim();
  if (value.length < 32 || /\s/.test(value)) {
    throw new GuidanceConfigError({
      code: "invalid_configuration",
      message: `${name} must be at least 32 characters with no whitespace`,
      subject: name,
    });
  }
  return value;
}

function registryUrl(env: Record<string, string | undefined>): string {
  const name = "SERVICE_VENDOR_URL";
  const raw = required(env, name);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new GuidanceConfigError({ code: "invalid_configuration", message: `${name} must be a URL`, subject: name });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new GuidanceConfigError({
      code: "invalid_configuration",
      message: `${name} must be an http or https URL`,
      subject: name,
    });
  }
  return raw.replace(/\/+$/, "");
}

function tokenTrustSet(env: Record<string, string | undefined>): BundleTrustSet {
  const name = "SERVICE_ROLE_TOKEN_TRUST_KEYS";
  const raw = required(env, name);
  return parseTrustKeys(
    raw,
    (message) => new GuidanceConfigError({ code: "invalid_configuration", message, subject: name }),
    name,
  );
}
