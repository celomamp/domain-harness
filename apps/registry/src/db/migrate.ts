import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type pg from "pg";
import { EnvelopeError } from "../errors.ts";

/** apps/registry/migrations, from both src/db and dist/db. */
export const MIGRATIONS_DIR = resolve(import.meta.dirname, "../../migrations");

const MIGRATION_FILE = /^\d{4}_[a-z0-9_]+\.sql$/;
// Serialises concurrent runners; any constant works as long as it is shared.
const LOCK_KEY = 7_202_610_101;

export interface MigrationReport {
  /** Files applied by this run, in order. */
  readonly applied: readonly string[];
  /** Files that were already recorded and skipped. */
  readonly alreadyApplied: number;
}

/**
 * Apply `migrations/*.sql` in name order, each in its own transaction, and
 * record each in `registry_migrations`. Re-running applies nothing new.
 * Must run as the migrator (owner) connection, never as the runtime role.
 */
export async function migrate(client: pg.ClientBase, dir: string = MIGRATIONS_DIR): Promise<MigrationReport> {
  const sqlFiles = (await readdir(dir)).filter((name) => name.endsWith(".sql"));
  // A misnamed migration is an error, never silently skipped.
  const misnamed = sqlFiles.find((name) => !MIGRATION_FILE.test(name));
  if (misnamed !== undefined) {
    throw new EnvelopeError({
      code: "invalid_migration_name",
      message: "a .sql file in the migrations directory is not named NNNN_lowercase_name.sql; nothing was applied",
      subject: misnamed,
    });
  }
  const files = sqlFiles.sort();

  await inTransaction(client, async () => {
    await client.query("select pg_advisory_xact_lock($1)", [LOCK_KEY]);
    await client.query(
      "create table if not exists registry_migrations (name text primary key, applied_at timestamptz not null default now())",
    );
  });

  const applied: string[] = [];
  let alreadyApplied = 0;
  for (const name of files) {
    const text = await readFile(join(dir, name), "utf8");
    await inTransaction(client, async () => {
      await client.query("select pg_advisory_xact_lock($1)", [LOCK_KEY]);
      const seen = await client.query("select 1 from registry_migrations where name = $1", [name]);
      if (seen.rowCount !== null && seen.rowCount > 0) {
        alreadyApplied += 1;
        return;
      }
      // No parameters: the simple query protocol runs the whole multi-statement file.
      await client.query(text);
      await client.query("insert into registry_migrations (name) values ($1)", [name]);
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
