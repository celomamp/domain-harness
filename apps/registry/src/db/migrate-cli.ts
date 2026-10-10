// `pnpm --filter @domain-harness/registry migrate`: apply pending migrations as
// the migrator (owner) role from REGISTRY_MIGRATION_DATABASE_URL.
import pg from "pg";
import { EnvelopeError } from "../errors.ts";
import { reportFailure } from "../operator/output.ts";
import { migrate } from "./migrate.ts";

const ENV = "REGISTRY_MIGRATION_DATABASE_URL";

async function main(): Promise<void> {
  const connectionString = process.env[ENV];
  if (connectionString === undefined || connectionString === "") {
    throw new EnvelopeError({ code: "missing_configuration", message: `${ENV} is not set`, subject: ENV });
  }
  const client = new pg.Client({ connectionString });
  // A connection lost between queries emits "error"; the next query then fails
  // and is reported as an envelope. Driver text is not logged.
  client.on("error", () => undefined);
  try {
    await client.connect();
  } catch (cause) {
    throw new EnvelopeError(
      { code: "database_unavailable", message: "could not connect to the migration database", subject: ENV },
      { cause },
    );
  }
  try {
    const report = await migrate(client);
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  const sqlState = error instanceof pg.DatabaseError && error.code !== undefined ? ` (SQLSTATE ${error.code})` : "";
  reportFailure(error, {
    code: "migration_failed",
    message: `a migration failed and its transaction was rolled back${sqlState}; earlier migrations stay applied`,
    subject: "migrations",
  });
});
