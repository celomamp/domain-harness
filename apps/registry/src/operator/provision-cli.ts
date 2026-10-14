// `pnpm --filter @domain-harness/registry provision <company.json>`: provision
// one Company from a JSON file. Connects as the runtime role from
// REGISTRY_DATABASE_URL (a member of dh_registry_app, never an owner or
// superuser). Prints ids and counts only; on any error prints one envelope to
// stderr, exits 1 and writes nothing.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { EnvelopeError } from "../errors.ts";
import { createPool, createRegistryDb } from "../db/client.ts";
import { assertRuntimeRoleSafe } from "../db/tenant-scope.ts";
import { writeCompany } from "../tenancy/provision.ts";
import { validateProvisionInput } from "../tenancy/validate.ts";
import { reportFailure } from "./output.ts";

const ENV = "REGISTRY_DATABASE_URL";

async function readInput(path: string | undefined): Promise<unknown> {
  if (path === undefined || path === "") {
    throw new EnvelopeError({ code: "invalid_input", message: "usage: provision <company.json>", subject: "file" });
  }
  let text: string;
  try {
    // `pnpm --filter` runs this from apps/registry; resolve a relative path
    // against the directory the operator invoked pnpm from (INIT_CWD).
    text = await readFile(resolve(process.env["INIT_CWD"] ?? process.cwd(), path), "utf8");
  } catch (cause) {
    throw new EnvelopeError({ code: "invalid_input", message: "the company file could not be read", subject: "file" }, { cause });
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new EnvelopeError({ code: "invalid_input", message: "the company file is not valid JSON", subject: "file" }, { cause });
  }
}

async function main(): Promise<void> {
  const input = await readInput(process.argv[2]);
  const validation = validateProvisionInput(input);
  if (!validation.ok) {
    throw new EnvelopeError(validation.error);
  }

  const connectionString = process.env[ENV];
  if (connectionString === undefined || connectionString === "") {
    throw new EnvelopeError({ code: "missing_configuration", message: `${ENV} is not set`, subject: ENV });
  }

  const pool = createPool(connectionString);
  try {
    const db = createRegistryDb(pool);
    try {
      await assertRuntimeRoleSafe(db);
    } catch (error) {
      if (error instanceof EnvelopeError) throw error;
      throw new EnvelopeError(
        { code: "database_unavailable", message: "could not connect to the registry database", subject: ENV },
        { cause: error },
      );
    }
    const result = await writeCompany(db, validation.value);
    // { tenantId, rootProjectId, plan, accounts: [{ id, role }], serviceCredential }: no names, no emails.
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  reportFailure(error, {
    code: "provision_failed",
    message: "provisioning failed and its transaction was rolled back; nothing was written",
    subject: "database",
  });
});
