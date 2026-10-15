/**
 * The Guidance event store (Story 4.5): InMemory and Postgres twins holding
 * one append-only row per bound Guidance tool outcome. A `miss` row IS the
 * gap: no second table, no dual write — `listGuidanceGaps` is the miss
 * projection (service-side persistence, never agent-reported).
 *
 * The per-Application sequence is `max + 1` under `pg_advisory_xact_lock` on
 * the Application id (the `gate_runs` pattern); the InMemory twin mirrors it.
 * Privacy (NFR-9): the record holds the asked subject term only — never raw
 * prompt text.
 */
import type pg from "pg";
import type { BoilerplateTarget, GuidanceEvent, GuidanceEventOutcome, GuidanceToolName, UuidV7 } from "@domain-harness/contract";
import { mintUuidV7 } from "../ci-gate/ids.ts";

/** The input of one recorded Guidance event: everything but the store-assigned fields. */
export interface GuidanceEventInput {
  readonly applicationId: UuidV7;
  readonly tool: GuidanceToolName;
  /** The subject exactly as asked (the record holds this term only). */
  readonly subject: string;
  readonly outcome: GuidanceEventOutcome;
  /** The agent tool known to the PINNED bundle's application entry, or `null`. */
  readonly agentTool: BoilerplateTarget | null;
  readonly bundleHash: string;
}

/**
 * The store surface the serving unit records against. The sequence is always
 * store-assigned; callers never choose it.
 */
export interface GuidanceEventStore {
  appendGuidanceEvent(input: GuidanceEventInput): Promise<GuidanceEvent>;
  listGuidanceEvents(applicationId?: UuidV7): Promise<readonly GuidanceEvent[]>;
  /** The gap list: the `miss` projection, no second write. */
  listGuidanceGaps(applicationId?: UuidV7): Promise<readonly GuidanceEvent[]>;
  countGuidanceEvents(applicationId: UuidV7): Promise<number>;
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
// InMemory twin (per-Application max + 1, mirroring the Postgres twin).
// ---------------------------------------------------------------------------

export class InMemoryGuidanceEventStore implements GuidanceEventStore {
  private readonly events: GuidanceEvent[] = [];

  async appendGuidanceEvent(input: GuidanceEventInput): Promise<GuidanceEvent> {
    await Promise.resolve();
    const existing = this.events.filter((event) => event.applicationId === input.applicationId);
    const sequence = existing.length === 0 ? 1 : Math.max(...existing.map((event) => event.sequence)) + 1;
    const event: GuidanceEvent = {
      id: mintUuidV7(),
      applicationId: input.applicationId,
      sequence,
      tool: input.tool,
      subject: input.subject,
      outcome: input.outcome,
      agentTool: input.agentTool,
      bundleHash: input.bundleHash,
      createdAt: nowIso(),
    };
    this.events.push(event);
    return event;
  }

  async listGuidanceEvents(applicationId?: UuidV7): Promise<readonly GuidanceEvent[]> {
    await Promise.resolve();
    const rows = applicationId === undefined ? [...this.events] : this.events.filter((event) => event.applicationId === applicationId);
    return rows.sort((a, b) => a.sequence - b.sequence);
  }

  async listGuidanceGaps(applicationId?: UuidV7): Promise<readonly GuidanceEvent[]> {
    const events = await this.listGuidanceEvents(applicationId);
    return events.filter((event) => event.outcome.kind === "miss");
  }

  async countGuidanceEvents(applicationId: UuidV7): Promise<number> {
    return (await this.listGuidanceEvents(applicationId)).length;
  }
}

export function createInMemoryGuidanceEventStore(): GuidanceEventStore {
  return new InMemoryGuidanceEventStore();
}

// ---------------------------------------------------------------------------
// Postgres twin: the 0004 `guidance_events` table, `gate_runs` sequencing.
// ---------------------------------------------------------------------------

export class PostgresGuidanceEventStore implements GuidanceEventStore {
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

  async appendGuidanceEvent(input: GuidanceEventInput): Promise<GuidanceEvent> {
    return await this.withClient(async (client) => {
      await client.query("begin");
      let committed = false;
      try {
        await client.query("select pg_advisory_xact_lock($1)", [hashLock(input.applicationId)]);
        const max = await client.query("select coalesce(max(sequence),0)::bigint as max from guidance_events where application_id = $1", [
          input.applicationId,
        ]);
        const sequence = (Number((max.rows[0] as { max: string }).max) || 0) + 1;
        const id = mintUuidV7();
        const outcome = input.outcome.kind;
        const standardId = input.outcome.kind === "hit" ? input.outcome.standardId : null;
        const standardVersion = input.outcome.kind === "hit" ? input.outcome.version : null;
        const result = await client.query(
          `insert into guidance_events
            (id, application_id, sequence, tool, subject, outcome, standard_id, standard_version, agent_tool, bundle_hash)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning created_at`,
          [id, input.applicationId, sequence, input.tool, input.subject, outcome, standardId, standardVersion, input.agentTool, input.bundleHash],
        );
        await client.query("commit");
        committed = true;
        const row = result.rows[0] as Record<string, unknown>;
        return {
          id,
          applicationId: input.applicationId,
          sequence,
          tool: input.tool,
          subject: input.subject,
          outcome: input.outcome,
          agentTool: input.agentTool,
          bundleHash: input.bundleHash,
          createdAt: isoTimestamp(row["created_at"]),
        };
      } catch (error) {
        if (!committed) await client.query("rollback");
        throw error;
      }
    });
  }

  private static readEvent(row: Record<string, unknown>): GuidanceEvent {
    const outcome = String(row["outcome"]);
    const standardId = row["standard_id"];
    const standardVersion = row["standard_version"];
    const agentTool = row["agent_tool"];
    return {
      id: String(row["id"]) as UuidV7,
      applicationId: row["application_id"] as UuidV7,
      sequence: Number(row["sequence"]),
      tool: String(row["tool"]) as GuidanceToolName,
      subject: String(row["subject"]),
      outcome:
        outcome === "hit"
          ? {
              kind: "hit" as const,
              standardId: String(standardId),
              version: Number(standardVersion),
            }
          : { kind: "miss" as const },
      agentTool: typeof agentTool === "string" ? (agentTool as BoilerplateTarget) : null,
      bundleHash: String(row["bundle_hash"]),
      createdAt: isoTimestamp(row["created_at"]),
    };
  }

  async listGuidanceEvents(applicationId?: UuidV7): Promise<readonly GuidanceEvent[]> {
    return await this.withClient(async (client) => {
      const result =
        applicationId === undefined
          ? await client.query(
              "select id, application_id, sequence, tool, subject, outcome, standard_id, standard_version, agent_tool, bundle_hash, created_at from guidance_events order by application_id asc, sequence asc",
            )
          : await client.query(
              "select id, application_id, sequence, tool, subject, outcome, standard_id, standard_version, agent_tool, bundle_hash, created_at from guidance_events where application_id = $1 order by sequence asc",
              [applicationId],
            );
      return (result.rows as Record<string, unknown>[]).map((row) => PostgresGuidanceEventStore.readEvent(row));
    });
  }

  async listGuidanceGaps(applicationId?: UuidV7): Promise<readonly GuidanceEvent[]> {
    return await this.withClient(async (client) => {
      const result =
        applicationId === undefined
          ? await client.query(
              "select id, application_id, sequence, tool, subject, outcome, standard_id, standard_version, agent_tool, bundle_hash, created_at from guidance_events where outcome = 'miss' order by application_id asc, sequence asc",
            )
          : await client.query(
              "select id, application_id, sequence, tool, subject, outcome, standard_id, standard_version, agent_tool, bundle_hash, created_at from guidance_events where application_id = $1 and outcome = 'miss' order by sequence asc",
              [applicationId],
            );
      return (result.rows as Record<string, unknown>[]).map((row) => PostgresGuidanceEventStore.readEvent(row));
    });
  }

  async countGuidanceEvents(applicationId: UuidV7): Promise<number> {
    return (await this.listGuidanceEvents(applicationId)).length;
  }
}

export function createPostgresGuidanceEventStore(pool: pg.Pool): GuidanceEventStore {
  return new PostgresGuidanceEventStore(pool);
}

function hashLock(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) | 0;
  return Math.abs(hash);
}
