/**
 * The Guidance identity store (Story 4.3): InMemory and Postgres twins.
 * Bindings and binding refusals are written to the SHARED
 * `application_bindings` and `binding_refusals` tables of the record store
 * (0001_ci_gate.sql) — Guidance and the Gate use ONE check, one
 * id→fingerprint binding per Application, and either unit's store sees the
 * other surface's rows; only the mismatch ledger is new
 * (0003_guidance_identity.sql, append-only). The SQL semantics mirror the CI
 * Gate store: the TOFU insert is `on conflict do nothing` re-read, so the
 * first presented fingerprint wins under concurrency.
 */
import type pg from "pg";
import type { UuidV7 } from "@domain-harness/contract";
import { mintUuidV7 } from "../ci-gate/ids.ts";

/** An Application's repository fingerprint binding (shared with the Gate). */
export interface GuidanceBinding {
  readonly applicationId: UuidV7;
  readonly fingerprint: string;
  readonly createdAt?: string;
}

/** The record one copied-identity refusal produces (shared with the Gate). */
export interface GuidanceBindingRefusal {
  readonly id: string;
  readonly applicationId: UuidV7;
  readonly presentedFingerprint: string;
  readonly boundFingerprint: string;
  readonly createdAt?: string;
}

/** The input of one recorded advisory Project mismatch. */
export interface GuidanceProjectMismatchInput {
  readonly applicationId: UuidV7;
  readonly presentedProjectId: string;
  readonly bundleProjectId: string;
  readonly bundleHash: string;
}

/** One recorded advisory Project mismatch row. */
export interface GuidanceProjectMismatchRecord {
  readonly id: string;
  readonly applicationId: UuidV7;
  readonly presentedProjectId: string;
  readonly bundleProjectId: string;
  readonly bundleHash: string;
  readonly createdAt?: string;
}

/**
 * The store surface the guidance identity resolves against. The binding half
 * is structurally the Gate's binding surface (one check on every surface);
 * `recordProjectMismatch` and `listProjectMismatches` are the guidance-only
 * mismatch ledger.
 */
export interface GuidanceIdentityStore {
  getBinding(applicationId: UuidV7): Promise<GuidanceBinding | null>;
  bindApplication(applicationId: UuidV7, fingerprint: string): Promise<GuidanceBinding>;
  recordBindingRefusal(input: {
    applicationId: UuidV7;
    presentedFingerprint: string;
    boundFingerprint: string;
  }): Promise<GuidanceBindingRefusal>;
  listBindingRefusals(applicationId?: UuidV7): Promise<readonly GuidanceBindingRefusal[]>;
  recordProjectMismatch(input: GuidanceProjectMismatchInput): Promise<GuidanceProjectMismatchRecord>;
  listProjectMismatches(applicationId?: UuidV7): Promise<readonly GuidanceProjectMismatchRecord[]>;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** A timestamptz column as delivered, mapped to UTC ISO text. */
function isoTimestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return "";
}

// ---------------------------------------------------------------------------
// InMemory twin (bindings and refusals are named by the same identities the
// Postgres twin writes to the shared tables; insert-once with re-read).
// ---------------------------------------------------------------------------

export class InMemoryGuidanceIdentityStore implements GuidanceIdentityStore {
  private readonly bindings = new Map<string, GuidanceBinding>();
  private readonly refusals: GuidanceBindingRefusal[] = [];
  private readonly mismatches: GuidanceProjectMismatchRecord[] = [];

  async getBinding(applicationId: UuidV7): Promise<GuidanceBinding | null> {
    await Promise.resolve();
    return this.bindings.get(applicationId) ?? null;
  }

  async bindApplication(applicationId: UuidV7, fingerprint: string): Promise<GuidanceBinding> {
    await Promise.resolve();
    const existing = this.bindings.get(applicationId);
    if (existing !== undefined) return existing;
    const binding: GuidanceBinding = {
      applicationId,
      fingerprint,
      createdAt: nowIso(),
    };
    this.bindings.set(applicationId, binding);
    return binding;
  }

  async recordBindingRefusal(input: {
    applicationId: UuidV7;
    presentedFingerprint: string;
    boundFingerprint: string;
  }): Promise<GuidanceBindingRefusal> {
    await Promise.resolve();
    const record: GuidanceBindingRefusal = {
      id: mintUuidV7(),
      applicationId: input.applicationId,
      presentedFingerprint: input.presentedFingerprint,
      boundFingerprint: input.boundFingerprint,
      createdAt: nowIso(),
    };
    this.refusals.push(record);
    return record;
  }
  async listBindingRefusals(applicationId?: UuidV7): Promise<readonly GuidanceBindingRefusal[]> {
    await Promise.resolve();
    if (applicationId === undefined) return [...this.refusals];
    return this.refusals.filter((refusal) => refusal.applicationId === applicationId);
  }

  async recordProjectMismatch(input: GuidanceProjectMismatchInput): Promise<GuidanceProjectMismatchRecord> {
    await Promise.resolve();
    const record: GuidanceProjectMismatchRecord = {
      id: mintUuidV7(),
      applicationId: input.applicationId,
      presentedProjectId: input.presentedProjectId,
      bundleProjectId: input.bundleProjectId,
      bundleHash: input.bundleHash,
      createdAt: nowIso(),
    };
    this.mismatches.push(record);
    return record;
  }

  async listProjectMismatches(applicationId?: UuidV7): Promise<readonly GuidanceProjectMismatchRecord[]> {
    await Promise.resolve();
    if (applicationId === undefined) return [...this.mismatches];
    return this.mismatches.filter((mismatch) => mismatch.applicationId === applicationId);
  }
}

export function createInMemoryGuidanceIdentityStore(): GuidanceIdentityStore {
  return new InMemoryGuidanceIdentityStore();
}

// ---------------------------------------------------------------------------
// Postgres twin: the shared 0001 tables for bindings and refusals (the Gate
// store's exact SQL) plus the 0003 mismatch ledger.
// ---------------------------------------------------------------------------

export class PostgresGuidanceIdentityStore implements GuidanceIdentityStore {
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

  async getBinding(applicationId: UuidV7): Promise<GuidanceBinding | null> {
    return await this.withClient(async (client) => {
      const result = await client.query(
        "select application_id, fingerprint, created_at from application_bindings where application_id = $1",
        [applicationId],
      );
      return PostgresGuidanceIdentityStore.readBinding(result.rows[0] as Record<string, unknown> | undefined);
    });
  }

  async bindApplication(applicationId: UuidV7, fingerprint: string): Promise<GuidanceBinding> {
    return await this.withClient(async (client) => {
      // Trust on first use is insert-once with re-read: under two concurrent
      // first calls the surviving row is the first insert, and the caller
      // that presented a different fingerprint reads it and is refused —
      // the same race semantics as the Gate's store.
      await client.query(
        "insert into application_bindings (application_id, fingerprint) values ($1, $2) on conflict (application_id) do nothing",
        [applicationId, fingerprint],
      );
      const result = await client.query(
        "select application_id, fingerprint, created_at from application_bindings where application_id = $1",
        [applicationId],
      );
      const binding = PostgresGuidanceIdentityStore.readBinding(result.rows[0] as Record<string, unknown> | undefined);
      if (binding === null) {
        // Never fabricate a verdict from the PRESENTED fingerprint: with no
        // row the outcome is unknown, so raise — resolveGuidanceIdentity's
        // catch converts this to the `unavailable` result. A fabricated
        // `bound` would hand a TOFU race loser a bound answer.
        throw new Error("binding re-read returned no row");
      }
      return binding;
    });
  }

  private static readBinding(row: Record<string, unknown> | undefined): GuidanceBinding | null {
    if (!row) return null;
    return {
      applicationId: row["application_id"] as UuidV7,
      fingerprint: String(row["fingerprint"]),
      createdAt: isoTimestamp(row["created_at"]),
    };
  }

  async recordBindingRefusal(input: {
    applicationId: UuidV7;
    presentedFingerprint: string;
    boundFingerprint: string;
  }): Promise<GuidanceBindingRefusal> {
    return await this.withClient(async (client) => {
      const result = await client.query(
        `insert into binding_refusals (id, application_id, presented_fingerprint, bound_fingerprint)
         values ($1,$2,$3,$4) returning id, created_at`,
        [mintUuidV7(), input.applicationId, input.presentedFingerprint, input.boundFingerprint],
      );
      const row = result.rows[0] as Record<string, unknown>;
      return {
        id: String(row["id"]),
        applicationId: input.applicationId,
        presentedFingerprint: input.presentedFingerprint,
        boundFingerprint: input.boundFingerprint,
        createdAt: isoTimestamp(row["created_at"]),
      };
    });
  }

  async listBindingRefusals(applicationId?: UuidV7): Promise<readonly GuidanceBindingRefusal[]> {
    return await this.withClient(async (client) => {
      const result =
        applicationId === undefined
          ? await client.query(
              "select id, application_id, presented_fingerprint, bound_fingerprint, created_at from binding_refusals order by created_at asc, id asc",
            )
          : await client.query(
              "select id, application_id, presented_fingerprint, bound_fingerprint, created_at from binding_refusals where application_id = $1 order by created_at asc, id asc",
              [applicationId],
            );
      return (result.rows as Record<string, unknown>[]).map((row) => ({
        id: String(row["id"]),
        applicationId: row["application_id"] as UuidV7,
        presentedFingerprint: String(row["presented_fingerprint"]),
        boundFingerprint: String(row["bound_fingerprint"]),
        createdAt: isoTimestamp(row["created_at"]),
      }));
    });
  }

  async recordProjectMismatch(input: GuidanceProjectMismatchInput): Promise<GuidanceProjectMismatchRecord> {
    return await this.withClient(async (client) => {
      const id = mintUuidV7();
      const result = await client.query(
        `insert into guidance_project_mismatches
           (id, application_id, presented_project_id, bundle_project_id, bundle_hash)
         values ($1,$2,$3,$4,$5) returning created_at`,
        [id, input.applicationId, input.presentedProjectId, input.bundleProjectId, input.bundleHash],
      );
      const row = result.rows[0] as Record<string, unknown>;
      return { ...input, id, createdAt: isoTimestamp(row["created_at"]) };
    });
  }

  async listProjectMismatches(applicationId?: UuidV7): Promise<readonly GuidanceProjectMismatchRecord[]> {
    return await this.withClient(async (client) => {
      const result =
        applicationId === undefined
          ? await client.query(
              "select id, application_id, presented_project_id, bundle_project_id, bundle_hash, created_at from guidance_project_mismatches order by created_at asc, id asc",
            )
          : await client.query(
              "select id, application_id, presented_project_id, bundle_project_id, bundle_hash, created_at from guidance_project_mismatches where application_id = $1 order by created_at asc, id asc",
              [applicationId],
            );
      return (result.rows as Record<string, unknown>[]).map((row) => ({
        id: String(row["id"]),
        applicationId: row["application_id"] as UuidV7,
        presentedProjectId: String(row["presented_project_id"]),
        bundleProjectId: String(row["bundle_project_id"]),
        bundleHash: String(row["bundle_hash"]),
        createdAt: isoTimestamp(row["created_at"]),
      }));
    });
  }
}

export function createPostgresGuidanceIdentityStore(pool: pg.Pool): GuidanceIdentityStore {
  return new PostgresGuidanceIdentityStore(pool);
}
