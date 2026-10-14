import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type pg from "pg";
import type { ErrorEnvelope } from "@domain-harness/contract";

const MIGRATION_FILE = /^\d{4}_[a-z0-9_]+\.sql$/;
const LOCK_KEY = 7_202_610_503;
const LEDGER = "service_migrations";

export const MIGRATIONS_DIR = resolve(import.meta.dirname, "../../migrations");

export interface MigrationReport {
  readonly applied: readonly string[];
  readonly alreadyApplied: number;
}

class MigrationError extends Error implements ErrorEnvelope {
  readonly code: string;
  readonly subject: string;

  constructor(envelope: ErrorEnvelope) {
    super(envelope.message);
    this.name = "MigrationError";
    this.code = envelope.code;
    this.subject = envelope.subject;
  }
}

export async function migrate(client: pg.ClientBase, dir: string = MIGRATIONS_DIR): Promise<MigrationReport> {
  const sqlFiles = (await readdir(dir)).filter((name) => name.endsWith(".sql"));
  const misnamed = sqlFiles.find((name) => !MIGRATION_FILE.test(name));
  if (misnamed !== undefined) {
    throw new MigrationError({
      code: "invalid_migration_name",
      message: "a .sql file in the migrations directory is not named NNNN_lowercase_name.sql; nothing was applied",
      subject: misnamed,
    });
  }
  const files = sqlFiles.sort();

  await inTransaction(client, async () => {
    await client.query("select pg_advisory_xact_lock($1)", [LOCK_KEY]);
    await client.query(
      `create table if not exists ${LEDGER} (name text primary key, applied_at timestamptz not null default now())`,
    );
  });

  const applied: string[] = [];
  let alreadyApplied = 0;
  for (const name of files) {
    const text = await readFile(join(dir, name), "utf8");
    await inTransaction(client, async () => {
      await client.query("select pg_advisory_xact_lock($1)", [LOCK_KEY]);
      const seen = await client.query(`select 1 from ${LEDGER} where name = $1`, [name]);
      if (seen.rowCount !== null && seen.rowCount > 0) {
        alreadyApplied += 1;
        return;
      }
      await client.query(text);
      await client.query(`insert into ${LEDGER} (name) values ($1)`, [name]);
      applied.push(name);
    });
  }
  return { applied, alreadyApplied };
}

async function inTransaction(client: pg.ClientBase, fn: () => Promise<void>): Promise<void> {
  await client.query("begin");
  try {
    await fn();
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}
