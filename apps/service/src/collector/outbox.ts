/**
 * The Postgres collector outbox twin (Story 6.3): the `0005_collector_outbox`
 * tables behind the collector's `CollectorOutbox` interface, in the
 * `PostgresGuidanceEventStore` style — pooled client, explicit transaction,
 * `pg_advisory_xact_lock` on the Application id. Allocation and insert share
 * one transaction, so a crash between them can never burn a sequence and
 * fake a gap. Validation still runs before the transaction (a schema failure
 * drops whole without touching the watermark).
 */
import type pg from "pg";
import type { Compilation, UuidV7 } from "@domain-harness/contract";
import { isCompilation } from "@domain-harness/contract";
import type {
  CollectorOutbox,
  EnqueueOutcome,
  OutboxStats,
  QueueGap,
  QueuedCompilation,
} from "@domain-harness/collector";
import { validateForSend } from "@domain-harness/collector";

function hashLock(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

function readEntry(row: Record<string, unknown>): QueuedCompilation {
  const payload = row["payload"];
  if (!isCompilation(payload)) throw new Error("collector: outbox holds a row that is not a Compilation");
  return {
    idempotencyKey: String(row["idempotency_key"]) as UuidV7,
    applicationId: String(row["application_id"]) as UuidV7,
    sequence: Number(row["sequence"]),
    compilation: payload,
    attempts: Number(row["attempts"]),
    nextAttemptAt: isoTimestamp(row["next_attempt_at"]),
    status: row["status"] === "sent" ? "sent" : "queued",
  };
}

function isoTimestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return "";
}

export class PostgresCollectorOutbox implements CollectorOutbox {
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

  private static async allocate(
    client: pg.PoolClient,
    applicationId: UuidV7,
  ): Promise<number> {
    await client.query("select pg_advisory_xact_lock($1)", [hashLock(applicationId)]);
    const current = await client.query(
      "select allocated_upto::bigint as allocated from collector_sequences where application_id = $1",
      [applicationId],
    );
    const next = (current.rows.length === 0 ? 0 : Number((current.rows[0] as { allocated: string }).allocated)) + 1;
    await client.query(
      `insert into collector_sequences (application_id, allocated_upto) values ($1, $2)
       on conflict (application_id) do update set allocated_upto = excluded.allocated_upto`,
      [applicationId, next],
    );
    return next;
  }

  async enqueue(
    applicationId: UuidV7,
    build: (sequence: number) => Compilation,
    now: string,
  ): Promise<EnqueueOutcome> {
    return await this.withClient(async (client) => {
      await client.query("begin");
      let committed = false;
      try {
        const sequence = await PostgresCollectorOutbox.allocate(client, applicationId);
        const checked = validateForSend(build(sequence));
        if (!checked.ok) {
          await client.query("rollback");
          return {
            stored: false,
            reason: checked.reason,
            subject: checked.subject,
            message: checked.message,
          } satisfies EnqueueOutcome;
        }
        await client.query(
          `insert into collector_outbox
            (idempotency_key, application_id, sequence, payload, status, attempts, next_attempt_at)
           values ($1, $2, $3, $4, 'queued', 0, $5)`,
          [
            checked.compilation.idempotencyKey,
            checked.compilation.applicationId,
            checked.compilation.sequence,
            JSON.stringify(checked.compilation),
            now,
          ],
        );
        await client.query("commit");
        committed = true;
        return {
          stored: true,
          idempotencyKey: checked.compilation.idempotencyKey,
          sequence: checked.compilation.sequence,
        } satisfies EnqueueOutcome;
      } catch (error) {
        if (!committed) await client.query("rollback");
        throw error;
      }
    });
  }

  async listDue(now: string, limit: number): Promise<readonly QueuedCompilation[]> {
    return await this.withClient(async (client) => {
      const result = await client.query(
        `select idempotency_key, application_id, sequence, payload, status, attempts, next_attempt_at
         from collector_outbox
         where status = 'queued' and next_attempt_at <= $1
         order by next_attempt_at asc limit $2`,
        [now, Math.max(0, limit)],
      );
      return (result.rows as Record<string, unknown>[]).map(readEntry);
    });
  }

  async markSent(idempotencyKey: UuidV7): Promise<void> {
    await this.withClient(async (client) => {
      await client.query("update collector_outbox set status = 'sent' where idempotency_key = $1", [idempotencyKey]);
    });
  }

  async noteAttempt(idempotencyKey: UuidV7, nextAttemptAt: string): Promise<void> {
    await this.withClient(async (client) => {
      await client.query(
        "update collector_outbox set attempts = attempts + 1, next_attempt_at = $2 where idempotency_key = $1 and status = 'queued'",
        [idempotencyKey, nextAttemptAt],
      );
    });
  }

  async keepForReadGate(idempotencyKey: UuidV7, nextAttemptAt: string): Promise<void> {
    await this.withClient(async (client) => {
      await client.query(
        "update collector_outbox set next_attempt_at = $2 where idempotency_key = $1 and status = 'queued'",
        [idempotencyKey, nextAttemptAt],
      );
    });
  }

  async resequence(
    idempotencyKey: UuidV7,
    build: (sequence: number) => Compilation,
    now: string,
  ): Promise<number> {
    return await this.withClient(async (client) => {
      await client.query("begin");
      let committed = false;
      try {
        const current = await client.query(
          "select application_id, status from collector_outbox where idempotency_key = $1",
          [idempotencyKey],
        );
        const row = current.rows[0] as { application_id: string; status: string } | undefined;
        if (row === undefined) throw new Error("collector: resequence of an unknown queued Compilation");
        if (row.status !== "queued") {
          throw new Error("collector: resequence of a Compilation that is no longer queued");
        }
        const sequence = await PostgresCollectorOutbox.allocate(client, row.application_id as UuidV7);
        const checked = validateForSend(build(sequence));
        if (!checked.ok) {
          await client.query("rollback");
          throw new Error(`collector: resequenced Compilation failed validation: ${checked.subject}`);
        }
        await client.query(
          `update collector_outbox
           set application_id = $2, sequence = $3, payload = $4, attempts = 0, next_attempt_at = $5
           where idempotency_key = $1`,
          [idempotencyKey, checked.compilation.applicationId, checked.compilation.sequence, JSON.stringify(checked.compilation), now],
        );
        await client.query("commit");
        committed = true;
        return sequence;
      } catch (error) {
        if (!committed) await client.query("rollback");
        throw error;
      }
    });
  }

  async dropEntry(idempotencyKey: UuidV7): Promise<void> {
    await this.withClient(async (client) => {
      await client.query("delete from collector_outbox where idempotency_key = $1 and status = 'queued'", [idempotencyKey]);
    });
  }

  async stats(): Promise<OutboxStats> {
    return await this.withClient(async (client) => {
      const result = await client.query(
        `select count(*) filter (where status = 'queued')::bigint as pending,
                count(*) filter (where status = 'sent')::bigint as sent
         from collector_outbox`,
      );
      const row = result.rows[0] as { pending: string; sent: string };
      return { pendingCount: Number(row.pending), sentCount: Number(row.sent) };
    });
  }

  async detectGaps(): Promise<readonly QueueGap[]> {
    return await this.withClient(async (client) => {
      const watermarks = await client.query(
        "select application_id, allocated_upto::bigint as allocated from collector_sequences",
      );
      const present = await client.query(
        "select application_id, sequence::bigint as sequence from collector_outbox",
      );
      const seen = new Map<string, Set<number>>();
      for (const row of present.rows as { application_id: string; sequence: string }[]) {
        let set = seen.get(row.application_id);
        if (set === undefined) {
          set = new Set<number>();
          seen.set(row.application_id, set);
        }
        set.add(Number(row.sequence));
      }
      const gaps: QueueGap[] = [];
      for (const row of watermarks.rows as { application_id: string; allocated: string }[]) {
        const allocated = Number(row.allocated);
        const have = seen.get(row.application_id) ?? new Set<number>();
        const missing: number[] = [];
        for (let sequence = 1; sequence <= allocated; sequence += 1) {
          if (!have.has(sequence)) missing.push(sequence);
        }
        if (missing.length > 0) {
          gaps.push({ applicationId: row.application_id as UuidV7, missing });
        }
      }
      return gaps;
    });
  }
}

export function createPostgresCollectorOutbox(pool: pg.Pool): CollectorOutbox {
  return new PostgresCollectorOutbox(pool);
}
