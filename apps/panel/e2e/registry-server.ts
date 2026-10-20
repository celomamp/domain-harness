// The registry for the end-to-end suite (a Playwright webServer): recreate the
// throwaway database, apply every migration, then serve the registry API with
// a file outbox and a signing key generated for this run only.
import { spawn, spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { rmSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import {
  ADMIN_DATABASE_URL,
  DATABASE_NAME,
  OUTBOX_DIR,
  PANEL_URL,
  REGISTRY_DIR,
  REGISTRY_PORT,
  databaseUrl,
} from "./stack.ts";

const admin = new pg.Client({ connectionString: ADMIN_DATABASE_URL });
await admin.connect();
await admin.query(`drop database if exists ${DATABASE_NAME} with (force)`);
await admin.query(`create database ${DATABASE_NAME}`);
await admin.end();

const node = (script: string, env: Record<string, string>) =>
  spawnSync(process.execPath, ["--conditions=@domain-harness/source", join(REGISTRY_DIR, script)], {
    cwd: REGISTRY_DIR,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });

const migrated = node("src/db/migrate-cli.ts", { REGISTRY_MIGRATION_DATABASE_URL: databaseUrl() });
if (migrated.status !== 0) process.exit(migrated.status ?? 1);

rmSync(OUTBOX_DIR, { recursive: true, force: true });
const { privateKey } = generateKeyPairSync("ed25519");

const registry = spawn(process.execPath, ["--conditions=@domain-harness/source", join(REGISTRY_DIR, "src/http/serve-cli.ts")], {
  cwd: REGISTRY_DIR,
  stdio: "inherit",
  env: {
    ...process.env,
    REGISTRY_DATABASE_URL: databaseUrl("dh_registry_app"),
    REGISTRY_HTTP_HOST: "127.0.0.1",
    REGISTRY_HTTP_PORT: String(REGISTRY_PORT),
    REGISTRY_PANEL_URL: PANEL_URL,
    REGISTRY_MAIL_OUTBOX_DIR: OUTBOX_DIR,
    REGISTRY_BUNDLE_SIGNING_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    REGISTRY_BUNDLE_SIGNING_KEY_ID: "e2e-key-1",
  },
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => registry.kill(signal));
}
registry.on("exit", (code) => process.exit(code ?? 0));
