// Shared settings for the end-to-end stack: the registry and the panel run on
// ports of their own, so a running `pnpm local:serve` never collides, against
// a throwaway database recreated on every run.
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const REGISTRY_DIR = join(REPO_ROOT, "apps/registry");

export const REGISTRY_PORT = Number(process.env["E2E_REGISTRY_PORT"] ?? "4110");
export const PANEL_PORT = Number(process.env["E2E_PANEL_PORT"] ?? "4173");
export const REGISTRY_URL = `http://127.0.0.1:${String(REGISTRY_PORT)}`;
export const PANEL_URL = `http://localhost:${String(PANEL_PORT)}`;

/** Admin connection (may create and drop databases); CI and local defaults match. */
export const ADMIN_DATABASE_URL =
  process.env["E2E_DATABASE_URL"] ??
  process.env["REGISTRY_TEST_DATABASE_URL"] ??
  "postgres://postgres:postgres@localhost:5432/postgres";

export const DATABASE_NAME = "dh_panel_e2e";

/** The same server with another database and, optionally, a role set per session. */
export function databaseUrl(role?: string): string {
  const url = new URL(ADMIN_DATABASE_URL);
  url.pathname = `/${DATABASE_NAME}`;
  if (role !== undefined) url.searchParams.set("options", `-c role=${role}`);
  return url.toString();
}

/** The registry's file outbox: one JSON file per sign-in mail. */
export const OUTBOX_DIR = process.env["E2E_OUTBOX_DIR"] ?? join(tmpdir(), "dh-panel-e2e-outbox");
