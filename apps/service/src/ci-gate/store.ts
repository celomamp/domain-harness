import pg from "pg";
import type { Deviation, UuidV7 } from "@domain-harness/contract";
import { migrate } from "../db/migrate.ts";
import type { MigrationReport } from "../db/migrate.ts";
import { mintUuidV7 } from "./ids.ts";

export interface ApplicationBinding {
  readonly applicationId: UuidV7;
  readonly fingerprint: string;
  readonly createdAt?: string;
}

export interface BindingRefusalRecord {
  readonly id: string;
  readonly applicationId: UuidV7;
  readonly presentedFingerprint: string;
  readonly boundFingerprint: string;
  readonly createdAt?: string;
}

export interface GateRunRecordInput {
  readonly applicationId: UuidV7;
  readonly revision: string;
  readonly bundleHash: string;
  readonly extractorVersion: string;
  readonly deviations: readonly Deviation[];
  readonly checked: number;
  readonly open: number;
  readonly adherence: number;
}

export interface GateRunRecord {
  readonly id: string;
  readonly sequence: number;
  readonly applicationId: UuidV7;
  readonly revision: string;
  readonly bundleHash: string;
  readonly extractorVersion: string;
  readonly deviations: readonly Deviation[];
  readonly checked: number;
  readonly open: number;
  readonly adherence: number;
  readonly createdAt?: string;
}

export interface GateRecordStore {
  getBinding(applicationId: UuidV7): Promise<ApplicationBinding | null>;
  bindApplication(applicationId: UuidV7, fingerprint: string): Promise<ApplicationBinding>;
  recordBindingRefusal(input: {
    applicationId: UuidV7;
    presentedFingerprint: string;
    boundFingerprint: string;
  }): Promise<BindingRefusalRecord>;
  listBindingRefusals(applicationId?: UuidV7): Promise<readonly BindingRefusalRecord[]>;
  appendGateRun(input: GateRunRecordInput): Promise<GateRunRecord>;
  listGateRuns(applicationId: UuidV7): Promise<readonly GateRunRecord[]>;
  countGateRuns(applicationId: UuidV7): Promise<number>;
}

export class InMemoryGateRecordStore implements GateRecordStore {
  private bindings = new Map<string, ApplicationBinding>();
  private gateRuns: GateRunRecord[] = [];
  private refusals: BindingRefusalRecord[] = [];

  async getBinding(applicationId: UuidV7): Promise<ApplicationBinding | null> {
    await Promise.resolve();
    return this.bindings.get(applicationId) ?? null;
  }

  async bindApplication(applicationId: UuidV7, fingerprint: string): Promise<ApplicationBinding> {
    await Promise.resolve();
    const existing = this.bindings.get(applicationId);
    if (existing !== undefined) return existing;
    const binding: ApplicationBinding = {
      applicationId,
      fingerprint,
      createdAt: new Date().toISOString(),
    };
    this.bindings.set(applicationId, binding);
    return binding;
  }

  async recordBindingRefusal(input: {
    applicationId: UuidV7;
    presentedFingerprint: string;
    boundFingerprint: string;
  }): Promise<BindingRefusalRecord> {
    await Promise.resolve();
    const record: BindingRefusalRecord = {
      id: mintUuidV7(),
      applicationId: input.applicationId,
      presentedFingerprint: input.presentedFingerprint,
      boundFingerprint: input.boundFingerprint,
      createdAt: new Date().toISOString(),
    };
    this.refusals.push(record);
    return record;
  }

  async listBindingRefusals(applicationId?: UuidV7): Promise<readonly BindingRefusalRecord[]> {
    await Promise.resolve();
    if (applicationId === undefined) return [...this.refusals];
    return this.refusals.filter((r) => r.applicationId === applicationId);
  }

  async appendGateRun(input: GateRunRecordInput): Promise<GateRunRecord> {
    await Promise.resolve();
    const existing = this.gateRuns.filter((run) => run.applicationId === input.applicationId);
    const sequence = existing.length === 0 ? 1 : Math.max(...existing.map((r) => r.sequence)) + 1;
    const record: GateRunRecord = {
      id: mintUuidV7(),
      sequence,
      applicationId: input.applicationId,
      revision: input.revision,
      bundleHash: input.bundleHash,
      extractorVersion: input.extractorVersion,
      deviations: input.deviations,
      checked: input.checked,
      open: input.open,
      adherence: input.adherence,
      createdAt: new Date().toISOString(),
    };
    this.gateRuns.push(record);
    return record;
  }

  async listGateRuns(applicationId: UuidV7): Promise<readonly GateRunRecord[]> {
    await Promise.resolve();
    return this.gateRuns.filter((run) => run.applicationId === applicationId);
  }

  async countGateRuns(applicationId: UuidV7): Promise<number> {
    return (await this.listGateRuns(applicationId)).length;
  }
}

export function createInMemoryGateRecordStore(): GateRecordStore {
  return new InMemoryGateRecordStore();
}

export async function migratePostgres(client: pg.ClientBase): Promise<MigrationReport> {
  return await migrate(client);
}

export class PostgresGateRecordStore implements GateRecordStore {
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

  async getBinding(applicationId: UuidV7): Promise<ApplicationBinding | null> {
    return await this.withClient(async (client) => {
      const result = await client.query(
        "select application_id, fingerprint, created_at from application_bindings where application_id = $1",
        [applicationId],
      );
      const row = result.rows[0] as { application_id: string; fingerprint: string; created_at: Date | string } | undefined;
      if (!row) return null;
      const createdAt = row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at;
      return {
        applicationId: row.application_id as UuidV7,
        fingerprint: row.fingerprint,
        createdAt,
      };
    });
  }

  async bindApplication(applicationId: UuidV7, fingerprint: string): Promise<ApplicationBinding> {
    return await this.withClient(async (client) => {
      await client.query(
        "insert into application_bindings (application_id, fingerprint) values ($1, $2) on conflict (application_id) do nothing",
        [applicationId, fingerprint],
      );
      const result = await client.query(
        "select application_id, fingerprint, created_at from application_bindings where application_id = $1",
        [applicationId],
      );
      const row = result.rows[0] as { application_id: string; fingerprint: string; created_at: Date | string } | undefined;
      const boundFp = row ? row.fingerprint : fingerprint;
      const createdAt = row
        ? row.created_at instanceof Date
          ? row.created_at.toISOString()
          : row.created_at
        : new Date().toISOString();
      return {
        applicationId,
        fingerprint: boundFp,
        createdAt,
      };
    });
  }

  async recordBindingRefusal(input: {
    applicationId: UuidV7;
    presentedFingerprint: string;
    boundFingerprint: string;
  }): Promise<BindingRefusalRecord> {
    return await this.withClient(async (client) => {
      const id = mintUuidV7();
      await client.query(
        "insert into binding_refusals (id, application_id, presented_fingerprint, bound_fingerprint) values ($1,$2,$3,$4)",
        [id, input.applicationId, input.presentedFingerprint, input.boundFingerprint],
      );
      return {
        id,
        applicationId: input.applicationId,
        presentedFingerprint: input.presentedFingerprint,
        boundFingerprint: input.boundFingerprint,
        createdAt: new Date().toISOString(),
      };
    });
  }

  async listBindingRefusals(applicationId?: UuidV7): Promise<readonly BindingRefusalRecord[]> {
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
      return result.rows.map((row: Record<string, unknown>) => ({
        id: String(row["id"]),
        applicationId: row["application_id"] as UuidV7,
        presentedFingerprint: String(row["presented_fingerprint"]),
        boundFingerprint: String(row["bound_fingerprint"]),
        createdAt: row["created_at"] instanceof Date ? row["created_at"].toISOString() : String(row["created_at"]),
      }));
    });
  }

  async appendGateRun(input: GateRunRecordInput): Promise<GateRunRecord> {
    return await this.withClient(async (client) => {
      await client.query("begin");
      let committed = false;
      try {
        await client.query("select pg_advisory_xact_lock($1)", [hashLock(input.applicationId)]);
        const max = await client.query(
          "select coalesce(max(sequence),0)::bigint as max from gate_runs where application_id = $1",
          [input.applicationId],
        );
        const sequence = (Number((max.rows[0] as { max: string }).max) || 0) + 1;
        const id = mintUuidV7();
        await client.query(
          `insert into gate_runs
            (id, application_id, sequence, revision, bundle_hash, extractor_version, checked_count, open_count, adherence, deviations)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            id,
            input.applicationId,
            sequence,
            input.revision,
            input.bundleHash,
            input.extractorVersion,
            input.checked,
            input.open,
            input.adherence,
            JSON.stringify(input.deviations),
          ],
        );
        await client.query("commit");
        committed = true;
        return {
          id,
          sequence,
          applicationId: input.applicationId,
          revision: input.revision,
          bundleHash: input.bundleHash,
          extractorVersion: input.extractorVersion,
          deviations: input.deviations,
          checked: input.checked,
          open: input.open,
          adherence: input.adherence,
          createdAt: new Date().toISOString(),
        };
      } catch (error) {
        if (!committed) await client.query("rollback");
        throw error;
      }
    });
  }

  async listGateRuns(applicationId: UuidV7): Promise<readonly GateRunRecord[]> {
    return await this.withClient(async (client) => {
      const result = await client.query(
        "select * from gate_runs where application_id = $1 order by sequence asc",
        [applicationId],
      );
      return result.rows.map((row: Record<string, unknown>) => ({
        id: String(row["id"]),
        sequence: Number(row["sequence"]),
        applicationId: row["application_id"] as UuidV7,
        revision: String(row["revision"]),
        bundleHash: String(row["bundle_hash"]),
        extractorVersion: String(row["extractor_version"]),
        deviations: row["deviations"] as Deviation[],
        checked: Number(row["checked_count"]),
        open: Number(row["open_count"]),
        adherence: Number(row["adherence"]),
        createdAt: row["created_at"] instanceof Date ? row["created_at"].toISOString() : String(row["created_at"]),
      }));
    });
  }

  async countGateRuns(applicationId: UuidV7): Promise<number> {
    return (await this.listGateRuns(applicationId)).length;
  }
}

function hashLock(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

export function createPostgresGateRecordStore(pool: pg.Pool): GateRecordStore {
  return new PostgresGateRecordStore(pool);
}

export { migrate };

export function createPool(connectionString: string): pg.Pool {
  const pool = new pg.Pool({ connectionString, max: 4 });
  pool.on("error", () => undefined);
  return pool;
}
