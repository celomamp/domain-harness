/**
 * Environment configuration of the bundle service (Story 4.2). Configuration
 * comes only from the environment; every failure throws one
 * {@link BundleConfigError} envelope (`missing_configuration` or
 * `invalid_configuration`) that the daemon prints once to stderr before
 * exiting 1 — never a partial start.
 */
import { createPublicKey } from "node:crypto";
import type { ErrorEnvelope, UuidV7 } from "@domain-harness/contract";
import { isUuidV7 } from "@domain-harness/contract";
import { isEd25519PublicKeyPem } from "./verify.ts";
import type { BundleTrustSet, TrustedBundleKey } from "./verify.ts";

/** The default pull cycle interval, in milliseconds. */
export const DEFAULT_PULL_INTERVAL_MS = 60_000;
/** One above the largest setTimeout delay: a larger interval clamps to 1 ms. */
export const MAX_PULL_INTERVAL_MS = 2_147_483_647;

/** One envelope-shaped start-up error of the bundle service. */
export class BundleConfigError extends Error implements ErrorEnvelope {
  readonly code: string;
  readonly subject: string;

  constructor(envelope: ErrorEnvelope) {
    super(envelope.message);
    this.name = "BundleConfigError";
    this.code = envelope.code;
    this.subject = envelope.subject;
  }
}

export interface BundleServiceConfig {
  /** Outbound base URL of the vendor registry (http or https, no trailing slash). */
  readonly vendorUrl: string;
  readonly tenantId: UuidV7;
  /** The tenant's registry service credential, treated opaquely. */
  readonly credential: string;
  /** keyId → Ed25519 public key. */
  readonly trustSet: BundleTrustSet;
  readonly pullIntervalMs: number;
  /** Connection string of the record store, shared with the CI Gate store. */
  readonly recordDatabaseUrl: string;
}

function required(env: Record<string, string | undefined>, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim() === "") {
    throw new BundleConfigError({ code: "missing_configuration", message: `${name} is not set`, subject: name });
  }
  return value.trim();
}

function vendorUrl(env: Record<string, string | undefined>): string {
  const name = "SERVICE_VENDOR_URL";
  const raw = required(env, name);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BundleConfigError({ code: "invalid_configuration", message: `${name} must be a URL`, subject: name });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BundleConfigError({
      code: "invalid_configuration",
      message: `${name} must be an http or https URL`,
      subject: name,
    });
  }
  return raw.replace(/\/+$/, "");
}

function tenantId(env: Record<string, string | undefined>): UuidV7 {
  const name = "SERVICE_TENANT_ID";
  const raw = required(env, name);
  if (!isUuidV7(raw)) {
    throw new BundleConfigError({
      code: "invalid_configuration",
      message: `${name} must be a UUIDv7 tenant id`,
      subject: name,
    });
  }
  return raw;
}

function pullIntervalMs(env: Record<string, string | undefined>): number {
  const name = "SERVICE_PULL_INTERVAL_MS";
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return DEFAULT_PULL_INTERVAL_MS;
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value <= 0 || value > MAX_PULL_INTERVAL_MS) {
    throw new BundleConfigError({
      code: "invalid_configuration",
      message: `${name} must be a positive integer number of milliseconds of at most ${String(MAX_PULL_INTERVAL_MS)}`,
      subject: name,
    });
  }
  return value;
}

function trustKeys(env: Record<string, string | undefined>): BundleTrustSet {
  const name = "SERVICE_BUNDLE_TRUST_KEYS";
  const raw = required(env, name);
  return parseTrustKeys(raw, (message) => new BundleConfigError({ code: "invalid_configuration", message, subject: name }));
}

/**
 * Parse the trust set: a JSON object of keyId → Ed25519 PEM public key.
 * Rotation overlaps by key id, so multiple entries are normal. Throws the
 * caller's invalid-configuration error once, naming the variable, on invalid
 * JSON, a non-object, an empty or whitespace key id, or any value that is not
 * an Ed25519 PEM public key. An empty object is a valid (deny-all) trust set.
 */
export function parseTrustKeys(json: string, invalid: (message: string) => Error, name: string = "SERVICE_BUNDLE_TRUST_KEYS"): BundleTrustSet {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw invalid(`${name} must be a JSON object of keyId → Ed25519 PEM public key`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw invalid(`${name} must be a JSON object of keyId → Ed25519 PEM public key`);
  }
  const entries = Object.entries(parsed as Record<string, unknown>);
  const trustSet = new Map<string, TrustedBundleKey>();
  for (const [keyId, value] of entries) {
    if (keyId.trim() === "") {
      throw invalid(`${name} carries an empty key id`);
    }
    if (typeof value !== "string") {
      throw invalid(`${name} must map the key id "${keyId}" to an Ed25519 PEM public key string`);
    }
    if (!isEd25519PublicKeyPem(value)) {
      throw invalid(`${name} must map the key id "${keyId}" to an Ed25519 PEM public key`);
    }
    trustSet.set(keyId, createPublicKey(value));
  }
  return trustSet;
}

/**
 * Read the daemon's configuration from the environment. Throws exactly one
 * {@link BundleConfigError} per failure, checked in the declared-variable
 * order; nothing is crashed with multiple errors.
 */
export function bundleServiceConfigFromEnv(env: Record<string, string | undefined>): BundleServiceConfig {
  return {
    vendorUrl: vendorUrl(env),
    tenantId: tenantId(env),
    credential: required(env, "SERVICE_TENANT_CREDENTIAL"),
    trustSet: trustKeys(env),
    recordDatabaseUrl: required(env, "SERVICE_RECORD_DATABASE_URL"),
    pullIntervalMs: pullIntervalMs(env),
  };
}

