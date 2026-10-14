// The Company Standards service bundle-pull daemon (Story 4.2). Run with
// `node --conditions=@domain-harness/source src/bundles/service-cli.ts`.
// Configuration comes only from the environment:
//   SERVICE_VENDOR_URL            outbound base URL of the vendor registry (http/https)
//   SERVICE_TENANT_ID             this Company's tenant id (UUIDv7)
//   SERVICE_TENANT_CREDENTIAL     the tenant's registry service credential (opaque bearer)
//   SERVICE_BUNDLE_TRUST_KEYS     JSON object of keyId → Ed25519 PEM public key
//   SERVICE_RECORD_DATABASE_URL   connection string of the record store (shared with the CI Gate store)
//   SERVICE_PULL_INTERVAL_MS      optional; positive integer, default 60 000
//
// The daemon only calls outbound: it listens on no port and the container
// publishing none publishes nothing toward the vendor. Every cycle does one
// pull, verifies, activates or records the refusal, then observes staleness;
// it logs one line per cycle (ids and codes only). Any start-up error prints
// exactly one { code, message, subject } envelope to stderr and exits 1.
import type { ErrorEnvelope } from "@domain-harness/contract";
import type { Pool } from "pg";
import { migrate } from "../db/migrate.ts";
import { bundleServiceConfigFromEnv } from "./env.ts";
import type { BundleServiceConfig } from "./env.ts";
import { createPool } from "./store.ts";
import type { BundleRecordStore } from "./store.ts";
import { createPostgresBundleRecordStore } from "./store.ts";
import { observeStaleness, pullAndActivate } from "./puller.ts";

function writeLine(line: unknown): void {
  process.stdout.write(`${JSON.stringify(line)}\n`);
}

function envelopeOf(error: unknown, fallback: ErrorEnvelope): ErrorEnvelope {
  if (
    typeof error === "object" &&
    error !== null &&
    typeof (error as Record<string, unknown>)["code"] === "string" &&
    typeof (error as Record<string, unknown>)["subject"] === "string" &&
    typeof (error as Record<string, unknown>)["message"] === "string"
  ) {
    const record = error as Record<string, unknown>;
    return { code: String(record["code"]), message: String(record["message"]), subject: String(record["subject"]) };
  }
  return fallback;
}

async function openRecordStore(config: BundleServiceConfig): Promise<{ store: BundleRecordStore; pool: Pool }> {
  const name = "SERVICE_RECORD_DATABASE_URL";
  const pool = createPool(config.recordDatabaseUrl);
  let client;
  try {
    client = await pool.connect();
    try {
      await migrate(client);
    } finally {
      client.release();
    }
  } catch (cause) {
    try {
      await pool.end();
    } catch {
      // The connection failure is the one reported.
    }
    throw new BundleStartError(
      envelopeOf(cause, {
        code: "database_unavailable",
        message: "could not connect to the record store",
        subject: name,
      }),
    );
  }
  return { store: createPostgresBundleRecordStore(pool), pool };
}

class BundleStartError extends Error implements ErrorEnvelope {
  readonly code: string;
  readonly subject: string;
  readonly envelope: ErrorEnvelope;

  constructor(envelope: ErrorEnvelope) {
    super(envelope.message);
    this.name = "BundleStartError";
    this.code = envelope.code;
    this.subject = envelope.subject;
    this.envelope = envelope;
  }
}

/** One pull cycle: pull → verify → activate/record, then the staleness observation. */
async function runCycle(store: BundleRecordStore, config: BundleServiceConfig, now: string): Promise<void> {
  const outcome = await pullAndActivate(store, {
    target: {
      vendorUrl: config.vendorUrl,
      tenantId: config.tenantId,
      credential: config.credential,
    },
    trustSet: config.trustSet,
  });

  const line: {
    event: string;
    bundle: string;
    staleness: string;
    hash?: string;
    sequence?: number;
    activated?: boolean;
    status?: number;
    observedHash?: string;
    observedSequence?: number;
  } = { event: "bundle_cycle", bundle: "", staleness: "" };

  if (outcome.ok) {
    line.bundle = outcome.activated ? "activated" : "pinned";
    line.hash = outcome.pointer.hash;
    line.sequence = outcome.pointer.sequence;
    line.activated = outcome.activated;
  } else if (outcome.stage === "pull") {
    line.bundle = `pull:${outcome.outcome.reason}`;
    if (outcome.outcome.reason === "registry_envelope") {
      line.status = outcome.outcome.status;
    }
  } else if (outcome.stage === "verify") {
    line.bundle = `refused:${outcome.reason}`;
  } else {
    line.bundle = `activation_refused:${outcome.reason}`;
  }

  const staleness = await observeStaleness(store, config.tenantId, now);
  line.staleness = staleness.recorded ? "recorded" : staleness.reason;
  if (staleness.recorded) {
    line.observedHash = staleness.state.hash;
    line.observedSequence = staleness.state.sequence;
  }

  writeLine(line);
}

async function main(): Promise<void> {
  const config = bundleServiceConfigFromEnv(process.env);
  const { store, pool } = await openRecordStore(config);

  const daemon = { stopping: false, wake: null as (() => void) | null };
  const stop = (): void => {
    daemon.stopping = true;
    // A pending interval sleep ends immediately so the daemon exits promptly.
    const wake = daemon.wake;
    daemon.wake = null;
    wake?.();
  };
  const shouldStop = (): boolean => daemon.stopping;
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  while (!shouldStop()) {
    const now = new Date().toISOString();
    try {
      await runCycle(store, config, now);
    } catch (error) {
      // One line, codes only; the daemon keeps cycling.
      process.stderr.write(`${JSON.stringify({ event: "cycle_failed", code: envelopeOf(error, { code: "cycle_failed", message: "the pull cycle failed", subject: "cycle" }).code })}\n`);
    }
    if (shouldStop()) break;
    await new Promise<void>((resolveInterval) => {
      const timer = setTimeout(() => {
        daemon.wake = null;
        resolveInterval();
      }, config.pullIntervalMs);
      daemon.wake = (): void => {
        clearTimeout(timer);
        resolveInterval();
      };
    });
  }

  process.off("SIGINT", stop);
  process.off("SIGTERM", stop);
  try {
    await pool.end();
  } catch {
    // The process is exiting regardless.
  }
}

main().catch((error: unknown) => {
  const envelope = envelopeOf(error, {
    code: "service_start_failed",
    message: "the bundle service could not start",
    subject: "bundles",
  });
  // Exit only once the flush completes, so piped stderr cannot lose the one
  // required envelope.
  process.stderr.write(`${JSON.stringify(envelope)}\n`, () => {
    process.exit(1);
  });
});
