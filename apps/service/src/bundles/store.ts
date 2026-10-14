/**
 * The bundle record store (Story 4.2): the active-bundle pointer, the
 * hash-keyed bundle rows and the two append-only ledgers (verification
 * refusals and staleness observations). InMemory and Postgres twins mirror
 * the service CI Gate store pattern without importing it.
 *
 * Never process memory: the pointer lives in the store, so two replicas over
 * one record store always report the same active hash. The pointer swap is
 * one transaction: the hash-keyed bundle row is inserted with `on conflict do
 * nothing`, re-read, re-hashed from the stored bytes (refusing this
 * activation only on mismatch), and the swap is guarded on sequence so a
 * concurrent older activation can never win.
 */
import pg from "pg";
import type { SignedStandardBundle, UuidV7 } from "@domain-harness/contract";
import { bundleHashOf } from "./verify.ts";
import type { ActiveBundlePointer, BundleRefusalReason } from "./verify.ts";
import { mintUuidV7 } from "../ci-gate/ids.ts";

export interface BundleRefusalInput {
  readonly tenantId: UuidV7;
  readonly reason: BundleRefusalReason;
  readonly sequence: number | null;
  readonly hash: string | null;
  readonly detail: string;
}

export interface BundleRefusalRecord {
  readonly id: string;
  readonly tenantId: UuidV7;
  readonly reason: BundleRefusalReason;
  readonly sequence: number | null;
  readonly hash: string | null;
  readonly detail: string;
  readonly createdAt?: string;
}

export interface BundleStalenessObservationInput {
  readonly tenantId: UuidV7;
  readonly hash: string;
  readonly sequence: number;
  readonly stale: boolean;
  readonly ageSeconds: number;
}

export interface BundleStalenessObservation {
  readonly id: string;
  readonly tenantId: UuidV7;
  readonly hash: string;
  readonly sequence: number;
  readonly stale: boolean;
  readonly ageSeconds: number;
  readonly createdAt?: string;
}

/** Result of one staleness observation: identical observations add no row. */
export type StalenessRecordingResult =
  | { readonly recorded: true; readonly observation: BundleStalenessObservation }
  | { readonly recorded: false; readonly observation: null };

export type ActivationOutcome =
  | {
      readonly ok: true;
      /** True when the pointer now names the activated bundle's hash. */
      readonly activated: boolean;
      readonly pointer: ActiveBundlePointer;
    }
  | {
      readonly ok: false;
      readonly reason: "hash_mismatch" | "stale_sequence";
      readonly pointer: ActiveBundlePointer | null;
    };

export interface BundleRecordStore {
  getPointer(tenantId: UuidV7): Promise<ActiveBundlePointer | null>;
  activate(signed: SignedStandardBundle, hash: string, tenantId: UuidV7): Promise<ActivationOutcome>;
  recordRefusal(input: BundleRefusalInput): Promise<BundleRefusalRecord>;
  listRefusals(tenantId?: UuidV7): Promise<readonly BundleRefusalRecord[]>;
  recordStalenessObservation(input: BundleStalenessObservationInput): Promise<StalenessRecordingResult>;
  listStalenessObservations(tenantId?: UuidV7): Promise<readonly BundleStalenessObservation[]>;
  /** The stored signed bundle for one hash, or null. */
  pinnedBundle(hash: string): Promise<SignedStandardBundle | null>;
}

// ---------------------------------------------------------------------------
// Shared activation decision (used by both twins).
// ---------------------------------------------------------------------------

type ActivationDecision =
  | { readonly kind: "proceed" }
  | { readonly kind: "noop"; readonly pointer: ActiveBundlePointer }
  | { readonly kind: "refuse"; readonly reason: "hash_mismatch" | "stale_sequence"; readonly pointer: ActiveBundlePointer };

const REFUSAL_REASONS: readonly string[] = ["shape", "unknown_key", "signature_failed", "tenant_mismatch", "hash_mismatch", "stale_sequence"];

/**
 * Compare a candidate activation against the current pointer. Equal sequence
 * with identical content is the no-op re-pull; a lower sequence or an
 * equal-sequence different-content verification failure never swaps.
 */
function decideActivation(
  current: ActiveBundlePointer | null,
  sequence: number,
  hash: string,
): ActivationDecision {
  if (current === null) return { kind: "proceed" };
  if (sequence > current.sequence) return { kind: "proceed" };
  if (sequence === current.sequence) {
    if (hash === current.hash) return { kind: "noop", pointer: current };
    return { kind: "refuse", reason: "hash_mismatch", pointer: current };
  }
  return { kind: "refuse", reason: "stale_sequence", pointer: current };
}

/** True for the pg driver's unique-constraint violation (conflict code 23505). */
function isPgUniqueViolation(cause: unknown): boolean {
  return typeof cause === "object" && cause !== null && (cause as { code?: unknown }).code === "23505";
}

/**
 * Re-derive the hash from a bundle's stored representations (the twinned
 * halves of each twin) and refuse when it does not equal the expected hash.
 */
export function bundleHashMismatch(stored: {
  payload: unknown;
  keyId: string;
  signature: string;
}, expected: string): boolean {
  return bundleHashOf({
    payload: stored.payload as SignedStandardBundle["payload"],
    keyId: stored.keyId,
    signature: stored.signature,
  }) !== expected;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** A timestamptz column as the pg driver delivers it, mapped to UTC ISO text. */
function isoTimestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return "";
}

// ---------------------------------------------------------------------------
// InMemory twin.
// ---------------------------------------------------------------------------

export class InMemoryBundleRecordStore implements BundleRecordStore {
  private readonly bundles = new Map<string, { signed: SignedStandardBundle; createdAt: string }>();
  private readonly pointers = new Map<string, ActiveBundlePointer>();
  private readonly refusals: BundleRefusalRecord[] = [];
  private readonly observations: BundleStalenessObservation[] = [];

  async getPointer(tenantId: UuidV7): Promise<ActiveBundlePointer | null> {
    await Promise.resolve();
    return this.pointers.get(tenantId) ?? null;
  }

  async activate(signed: SignedStandardBundle, hash: string, tenantId: UuidV7): Promise<ActivationOutcome> {
    await Promise.resolve();
    const decision = decideActivation(this.pointers.get(tenantId) ?? null, signed.payload.sequence, hash);
    if (decision.kind === "refuse") {
      return { ok: false, reason: decision.reason, pointer: decision.pointer };
    }
    if (decision.kind === "noop") {
      return { ok: true, activated: false, pointer: decision.pointer };
    }
    if (
      bundleHashMismatch({ payload: signed.payload, keyId: signed.keyId, signature: signed.signature }, hash)
    ) {
      return { ok: false, reason: "hash_mismatch", pointer: this.pointers.get(tenantId) ?? null };
    }
    if (!this.bundles.has(hash)) {
      this.bundles.set(hash, { signed, createdAt: nowIso() });
    }
    const stored = this.bundles.get(hash);
    if (stored === undefined) {
      return { ok: false, reason: "hash_mismatch", pointer: this.pointers.get(tenantId) ?? null };
    }
    const current = this.pointers.get(tenantId) ?? null;
    if (current === null || current.sequence < signed.payload.sequence) {
      this.pointers.set(tenantId, { hash, sequence: signed.payload.sequence });
      return { ok: true, activated: true, pointer: { hash, sequence: signed.payload.sequence } };
    }
    const final = this.pointers.get(tenantId) ?? { hash: current.hash, sequence: current.sequence };
    return { ok: true, activated: final.hash === hash && final.sequence === signed.payload.sequence, pointer: final };
  }

  async recordRefusal(input: BundleRefusalInput): Promise<BundleRefusalRecord> {
    await Promise.resolve();
    const record: BundleRefusalRecord = {
      id: mintUuidV7(),
      tenantId: input.tenantId,
      reason: input.reason,
      sequence: input.sequence,
      hash: input.hash,
      detail: input.detail,
      createdAt: nowIso(),
    };
    this.refusals.push(record);
    return record;
  }

  async listRefusals(tenantId?: UuidV7): Promise<readonly BundleRefusalRecord[]> {
    await Promise.resolve();
    if (tenantId === undefined) return [...this.refusals];
    return this.refusals.filter((r) => r.tenantId === tenantId);
  }

  async recordStalenessObservation(input: BundleStalenessObservationInput): Promise<StalenessRecordingResult> {
    await Promise.resolve();
    if (!input.stale) return { recorded: false, observation: null };
    const last = [...this.observations].reverse().find((o) => o.tenantId === input.tenantId);
    if (last !== undefined && last.hash === input.hash && last.stale) {
      return { recorded: false, observation: null };
    }
    const observation: BundleStalenessObservation = {
      id: mintUuidV7(),
      tenantId: input.tenantId,
      hash: input.hash,
      sequence: input.sequence,
      stale: input.stale,
      ageSeconds: input.ageSeconds,
      createdAt: nowIso(),
    };
    this.observations.push(observation);
    return { recorded: true, observation };
  }

  async listStalenessObservations(tenantId?: UuidV7): Promise<readonly BundleStalenessObservation[]> {
    await Promise.resolve();
    if (tenantId === undefined) return [...this.observations];
    return this.observations.filter((o) => o.tenantId === tenantId);
  }

  async pinnedBundle(hash: string): Promise<SignedStandardBundle | null> {
    await Promise.resolve();
    return this.bundles.get(hash)?.signed ?? null;
  }
}

export function createInMemoryBundleRecordStore(): BundleRecordStore {
  return new InMemoryBundleRecordStore();
}

// ---------------------------------------------------------------------------
// Postgres twin.
// ---------------------------------------------------------------------------

export class PostgresBundleRecordStore implements BundleRecordStore {
  private readonly pool: pg.Pool;
  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  private async withClient<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }

  private static readPointer(row: Record<string, unknown> | undefined): ActiveBundlePointer | null {
    if (!row) return null;
    return { hash: String(row["hash"]), sequence: Number(row["sequence"]) };
  }

  async getPointer(tenantId: UuidV7): Promise<ActiveBundlePointer | null> {
    return await this.withClient(async (client) => {
      const result = await client.query(
        "select hash, sequence from active_bundle_pointers where tenant_id = $1",
        [tenantId],
      );
      return PostgresBundleRecordStore.readPointer(result.rows[0] as Record<string, unknown> | undefined);
    });
  }

  async activate(signed: SignedStandardBundle, hash: string, tenantId: UuidV7): Promise<ActivationOutcome> {
    return await this.withClient(async (client) => {
      await client.query("begin");
      let committed = false;
      try {
        const current = PostgresBundleRecordStore.readPointer(
          (await client.query("select hash, sequence from active_bundle_pointers where tenant_id = $1", [tenantId]))
            .rows[0] as Record<string, unknown> | undefined,
        );
        const decision = decideActivation(current, signed.payload.sequence, hash);
        if (decision.kind === "refuse") {
          await client.query("commit");
          committed = true;
          return { ok: false, reason: decision.reason, pointer: decision.pointer };
        }
        if (decision.kind === "noop") {
          await client.query("commit");
          committed = true;
          return { ok: true, activated: false, pointer: decision.pointer };
        }

        try {
          await client.query(
            `insert into service_bundles (hash, tenant_id, sequence, payload, key_id, signature, issued_at)
             values ($1, $2, $3, $4, $5, $6, $7) on conflict (hash) do nothing`,
            [hash, tenantId, signed.payload.sequence, JSON.stringify(signed.payload), signed.keyId, signed.signature, new Date(signed.payload.issuedAt)],
          );
        } catch (cause) {
          if (isPgUniqueViolation(cause)) {
            // Another replica already stored this tenant and sequence with
            // different content: the node aborted, roll back and refuse this
            // activation off the pointer as it stands now.
            await client.query("rollback");
            committed = true;
            const afterRollback = PostgresBundleRecordStore.readPointer(
              (await client.query("select hash, sequence from active_bundle_pointers where tenant_id = $1", [tenantId]))
                .rows[0] as Record<string, unknown> | undefined,
            );
            return { ok: false, reason: "hash_mismatch", pointer: afterRollback };
          }
          throw cause;
        }
        const rowResult = await client.query(
          "select payload, key_id, signature from service_bundles where hash = $1",
          [hash],
        );
        const row = rowResult.rows[0] as Record<string, unknown> | undefined;
        if (!row || bundleHashMismatch({ payload: row["payload"], keyId: String(row["key_id"]), signature: String(row["signature"]) }, hash)) {
          await client.query("rollback");
          committed = true;
          return { ok: false, reason: "hash_mismatch", pointer: current };
        }

        await client.query(
          `insert into active_bundle_pointers (tenant_id, hash, sequence) values ($1, $2, $3)
           on conflict (tenant_id) do update
             set hash = excluded.hash, sequence = excluded.sequence, updated_at = now()
             where active_bundle_pointers.sequence < excluded.sequence`,
          [tenantId, hash, signed.payload.sequence],
        );
        const final = PostgresBundleRecordStore.readPointer(
          (await client.query("select hash, sequence from active_bundle_pointers where tenant_id = $1", [tenantId]))
            .rows[0] as Record<string, unknown> | undefined,
        );
        if (final === null) {
          await client.query("rollback");
          committed = true;
          return { ok: false, reason: "hash_mismatch", pointer: current };
        }
        await client.query("commit");
        committed = true;
        return { ok: true, activated: final.hash === hash && final.sequence === signed.payload.sequence, pointer: final };
      } catch (error) {
        if (!committed) await client.query("rollback");
        throw error;
      }
    });
  }

  async recordRefusal(input: BundleRefusalInput): Promise<BundleRefusalRecord> {
    return await this.withClient(async (client) => {
      const id = mintUuidV7();
      await client.query(
        `insert into bundle_refusals (id, tenant_id, reason, sequence, hash, detail)
         values ($1, $2, $3, $4, $5, $6)`,
        [id, input.tenantId, input.reason, input.sequence, input.hash, input.detail],
      );
      return {
        id,
        tenantId: input.tenantId,
        reason: input.reason,
        sequence: input.sequence,
        hash: input.hash,
        detail: input.detail,
        createdAt: nowIso(),
      };
    });
  }

  private static readRefusal(row: Record<string, unknown>): BundleRefusalRecord {
    const sequence = row["sequence"];
    const hash = row["hash"];
    const reason = String(row["reason"]);
    const createdAt = row["created_at"];
    return {
      id: String(row["id"]),
      tenantId: row["tenant_id"] as UuidV7,
      reason: (REFUSAL_REASONS.includes(reason) ? reason : "shape") as BundleRefusalReason,
      sequence: sequence === null || sequence === undefined ? null : Number(sequence),
      hash: typeof hash === "string" ? hash : null,
      detail: String(row["detail"]),
      createdAt: isoTimestamp(createdAt),
    };
  }

  async listRefusals(tenantId?: UuidV7): Promise<readonly BundleRefusalRecord[]> {
    return await this.withClient(async (client) => {
      const result =
        tenantId === undefined
          ? await client.query(
              "select id, tenant_id, reason, sequence, hash, detail, created_at from bundle_refusals order by created_at asc, id asc",
            )
          : await client.query(
              "select id, tenant_id, reason, sequence, hash, detail, created_at from bundle_refusals where tenant_id = $1 order by created_at asc, id asc",
              [tenantId],
            );
      return (result.rows as Record<string, unknown>[]).map((row) => PostgresBundleRecordStore.readRefusal(row));
    });
  }

  private static readObservation(row: Record<string, unknown>): BundleStalenessObservation {
    return {
      id: String(row["id"]),
      tenantId: row["tenant_id"] as UuidV7,
      hash: String(row["hash"]),
      sequence: Number(row["sequence"]),
      stale: Boolean(row["stale"]),
      ageSeconds: Number(row["age_seconds"]),
      createdAt: isoTimestamp(row["created_at"]),
    };
  }

  async recordStalenessObservation(input: BundleStalenessObservationInput): Promise<StalenessRecordingResult> {
    return await this.withClient(async (client) => {
      if (!input.stale) return { recorded: false, observation: null };
      const last = await client.query(
        "select hash, stale from bundle_staleness_observations where tenant_id = $1 order by created_at desc, id desc limit 1",
        [input.tenantId],
      );
      const lastRow = last.rows[0] as { hash: string; stale: boolean } | undefined;
      if (lastRow !== undefined && lastRow.hash === input.hash && lastRow.stale) {
        return { recorded: false, observation: null };
      }
      const id = mintUuidV7();
      await client.query(
        `insert into bundle_staleness_observations (id, tenant_id, hash, sequence, stale, age_seconds)
         values ($1, $2, $3, $4, $5, $6)`,
        [id, input.tenantId, input.hash, input.sequence, input.stale, input.ageSeconds],
      );
      return {
        recorded: true,
        observation: {
          id,
          tenantId: input.tenantId,
          hash: input.hash,
          sequence: input.sequence,
          stale: input.stale,
          ageSeconds: input.ageSeconds,
          createdAt: nowIso(),
        },
      };
    });
  }

  async listStalenessObservations(tenantId?: UuidV7): Promise<readonly BundleStalenessObservation[]> {
    return await this.withClient(async (client) => {
      const result =
        tenantId === undefined
          ? await client.query(
              "select id, tenant_id, hash, sequence, stale, age_seconds, created_at from bundle_staleness_observations order by created_at asc, id asc",
            )
          : await client.query(
              "select id, tenant_id, hash, sequence, stale, age_seconds, created_at from bundle_staleness_observations where tenant_id = $1 order by created_at asc, id asc",
              [tenantId],
            );
      return (result.rows as Record<string, unknown>[]).map((row) => PostgresBundleRecordStore.readObservation(row));
    });
  }

  async pinnedBundle(hash: string): Promise<SignedStandardBundle | null> {
    return await this.withClient(async (client) => {
      const result = await client.query(
        "select payload, key_id, signature from service_bundles where hash = $1",
        [hash],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      if (!row) return null;
      return {
        payload: row["payload"] as SignedStandardBundle["payload"],
        keyId: String(row["key_id"]),
        signature: String(row["signature"]),
      };
    });
  }
}

export function createPostgresBundleRecordStore(pool: pg.Pool): BundleRecordStore {
  return new PostgresBundleRecordStore(pool);
}

export function createPool(connectionString: string): pg.Pool {
  const pool = new pg.Pool({ connectionString, max: 4 });
  pool.on("error", () => undefined);
  return pool;
}
