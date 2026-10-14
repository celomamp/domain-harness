import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { parseIdentificationFile, IDENTIFICATION_FILE_NAME } from "@domain-harness/contract";
import { extractRevisionFacts } from "@domain-harness/extractor";
import { migrate } from "../db/migrate.ts";
import { computeRepositoryFingerprint } from "./fingerprint.ts";
import { runGate } from "./runner.ts";
import { createPool, createPostgresGateRecordStore } from "./store.ts";
import { MISSING_IDENTIFICATION_FILE, STEP_CANNOT_RUN, UNBOUND } from "./sentences.ts";

function failStep(reason: string): never {
  process.stderr.write(`${reason}\n`);
  process.exit(1);
  throw new Error(reason);
}

async function main(): Promise<void> {
  const workspaceEnv = process.env["GITHUB_WORKSPACE"]?.trim();
  const root = workspaceEnv !== undefined && workspaceEnv !== "" ? workspaceEnv : process.cwd();

  // Identification file.
  const identPath = join(root, IDENTIFICATION_FILE_NAME);
  let content: string | null;
  if (!existsSync(identPath)) {
    content = null;
  } else {
    try {
      content = readFileSync(identPath, "utf8");
    } catch {
      process.stdout.write(`${MISSING_IDENTIFICATION_FILE}\n`);
      process.exit(1);
      return;
    }
  }
  const parsed = parseIdentificationFile(content);
  if (parsed.kind === "missing" || parsed.kind === "unreadable") {
    process.stdout.write(`${MISSING_IDENTIFICATION_FILE}\n`);
    process.exit(1);
    return;
  }
  const applicationId = parsed.file.applicationId;

  // Fingerprint.
  const fp = computeRepositoryFingerprint(root);
  if (!fp.ok) {
    process.stdout.write(`${UNBOUND}\n`);
    process.exit(1);
    return;
  }

  // Revision.
  let revision: string;
  try {
    revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  } catch {
    failStep(STEP_CANNOT_RUN);
    return;
  }
  if (revision === "") failStep(STEP_CANNOT_RUN);

  // Tracked files.
  let tracked: string[];
  try {
    tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
      .split("\u0000")
      .filter((p) => p !== "");
  } catch {
    failStep(STEP_CANNOT_RUN);
    return;
  }

  const files: Record<string, string> = {};
  const unreadable: Array<{ path: string; reason: string }> = [];
  for (const relative of tracked) {
    const absolute = join(root, relative);
    try {
      files[relative] = readFileSync(absolute, "utf8");
    } catch {
      unreadable.push({ path: relative, reason: "could not read file" });
    }
  }

  const factsBase = extractRevisionFacts(files);
  const facts = {
    ...factsBase,
    unreadable: [...factsBase.unreadable, ...unreadable].sort((a, b) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
    ),
  };

  // Bundle snapshot.
  const bundleFile = process.env["SERVICE_ACTIVE_BUNDLE_FILE"];
  if (!bundleFile) failStep(STEP_CANNOT_RUN);
  if (!existsSync(bundleFile)) failStep(STEP_CANNOT_RUN);
  let snapshot: unknown;
  try {
    snapshot = JSON.parse(readFileSync(bundleFile, "utf8"));
  } catch {
    failStep(STEP_CANNOT_RUN);
    return;
  }

  const dbUrl = process.env["SERVICE_RECORD_DATABASE_URL"];
  if (!dbUrl) failStep(STEP_CANNOT_RUN);
  const pool = createPool(dbUrl);

  try {
    const client = await pool.connect();
    try {
      await migrate(client);
      await client.query("select 1");
    } finally {
      client.release();
    }
  } catch {
    try { await pool.end(); } catch { /* ignore */ }
    failStep(STEP_CANNOT_RUN);
    return;
  }

  const store = createPostgresGateRecordStore(pool);

  let outcome;
  try {
    outcome = await runGate({
      applicationId,
      repoFingerprint: fp.fingerprint,
      facts,
      revision,
      source: async () => {
        await Promise.resolve();
        return snapshot;
      },
      store,
    });
  } catch {
    try { await pool.end(); } catch { /* ignore */ }
    failStep(STEP_CANNOT_RUN);
    return;
  }

  // Print.
  process.stdout.write(`${outcome.sentence}\n`);
  for (const line of outcome.deviationLines) process.stdout.write(`${line}\n`);
  try { await pool.end(); } catch { /* ignore */ }

  process.exit(outcome.exitCode);
}

main().catch(() => {
  process.stderr.write(`${STEP_CANNOT_RUN}\n`);
  process.exit(1);
});
