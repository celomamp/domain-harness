import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema.ts";

export type RegistrySchema = typeof schema;

/** The registry's database handle (Drizzle over a node-postgres pool). */
export type RegistryDb = NodePgDatabase<RegistrySchema> & { $client: pg.Pool };

/** A transaction opened by {@link RegistryDb.transaction}. */
export type RegistryTx = Parameters<Parameters<RegistryDb["transaction"]>[0]>[0];

/** Wrap a pool. The pool's connection string comes from the environment, never from source. */
export function createRegistryDb(pool: pg.Pool): RegistryDb {
  return drizzle({ client: pool, schema });
}

/** A pool for `connectionString`; the caller ends it. */
export function createPool(connectionString: string): pg.Pool {
  const pool = new pg.Pool({ connectionString, max: 4 });
  // An idle client that loses its connection emits "error" on the pool; without
  // a listener Node crashes with a raw stack. The pool drops that client and the
  // next query reconnects or fails with an envelope. Driver text is not logged.
  pool.on("error", () => undefined);
  return pool;
}
