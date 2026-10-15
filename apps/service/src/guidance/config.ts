/**
 * The Guidance MCP server's configuration (Stories 4.4 + 4.6): it comes only
 * from the environment; every failure throws one envelope-shaped error the
 * entry prints once to stderr before exiting 1 — never a partial start. The
 * `SERVICE_TENANT_ID` and `SERVICE_RECORD_DATABASE_URL` names follow the
 * bundles daemon (`apps/service/src/bundles/env.ts`); the port is optional
 * with the documented default. The Read API credential (Story 4.6) is the one
 * opaque shared secret, required, and never logged.
 */
import type { ErrorEnvelope, UuidV7 } from "@domain-harness/contract";
import { isUuidV7 } from "@domain-harness/contract";

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
  };
}
