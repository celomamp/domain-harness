// End-to-end suite for apps/service/src/ci-gate/gate-cli.ts against scratch
// git repositories and a throwaway PostgreSQL 18 database.
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { formatIdentificationFile, IDENTIFICATION_FILE_NAME } from "@domain-harness/contract";
import type { EffectiveStandardSet, UuidV7 } from "@domain-harness/contract";
import { migrate } from "../db/migrate.ts";
import { mintUuidV7 } from "./ids.ts";
import {
  BUNDLE_STALE,
  DUPLICATE_APPLICATION_ID,
  EFFECTIVE_STANDARD_SET_COULD_NOT_BE_READ,
  FAIL,
  MISSING_IDENTIFICATION_FILE,
  PASS,
  RUN_DID_NOT_COMPLETE,
  STEP_CANNOT_RUN,
  UNBOUND,
} from "./sentences.ts";
import { createPool, createPostgresGateRecordStore } from "./store.ts";
import type { GateRecordStore } from "./store.ts";
import {
  FIXTURE_PROJECT_ID,
  FIXTURE_STD_PROHIBITED_ID,
  fixtureProjectRef,
  makeSnapshotFixture,
} from "./test-fixtures.ts";

const ENV = "SERVICE_TEST_DATABASE_URL";
const adminUrl = process.env[ENV];
const inCi = process.env["CI"] !== undefined && process.env["CI"] !== "" && process.env["CI"] !== "false";
const CLI_ENTRY = resolve(import.meta.dirname, "./gate-cli.ts");

if (adminUrl === undefined || adminUrl === "") {
  if (inCi) {
    describe("gate-cli end-to-end suite", () => {
      it(`requires ${ENV} when CI is set`, () => {
        expect.fail(`${ENV} is not set; CI must run the gate-cli suite against PostgreSQL 18`);
      });
    });
  } else {
    process.stderr.write(`gate-cli.test.ts skipped: ${ENV} is not set\n`);
  }
}

function withDatabase(url: string, database: string): string {
  const next = new URL(url);
  next.pathname = `/${database}`;
  return next.toString();
}

function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createScratchDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

interface ScratchRepoOptions {
  readonly applicationId?: UuidV7 | null;
  readonly projectId?: UuidV7;
  readonly files?: Readonly<Record<string, string>>;
}

function createScratchRepo(options: ScratchRepoOptions = {}): {
  readonly repoDir: string;
  readonly applicationId: UuidV7;
  readonly head: string;
} {
  const repoDir = createScratchDir("dh-gate-repo-");
  const applicationId = options.applicationId === undefined ? mintUuidV7() : (options.applicationId ?? mintUuidV7());
  const projectId = options.projectId ?? FIXTURE_PROJECT_ID;

  git(repoDir, ["init", "-q"]);
  git(repoDir, ["config", "user.email", "ci@acme.test"]);
  git(repoDir, ["config", "user.name", "CI Runner"]);

  if (options.applicationId !== null) {
    writeFileSync(join(repoDir, IDENTIFICATION_FILE_NAME), formatIdentificationFile(applicationId, projectId));
  }

  const files = options.files ?? {
    "package.json": JSON.stringify({ name: "sample-app", version: "1.0.0", dependencies: { remeda: "2.1.0" } }, null, 2),
    "src/index.ts": 'import { pipe } from "remeda";\nexport const run = pipe;\n',
  };

  for (const [relativePath, content] of Object.entries(files)) {
    const abs = join(repoDir, relativePath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }

  git(repoDir, ["add", "."]);
  git(repoDir, ["commit", "-q", "-m", "initial commit"]);
  const head = git(repoDir, ["rev-parse", "HEAD"]);
  return { repoDir, applicationId, head };
}

function writeSnapshotFile(snapshot: unknown): string {
  const dir = createScratchDir("dh-gate-bundle-");
  const file = join(dir, "active-bundle.json");
  writeFileSync(file, JSON.stringify(snapshot, null, 2));
  return file;
}

describe.skipIf(adminUrl === undefined || adminUrl === "")("gate-cli end-to-end against scratch git repositories", () => {
  const database = `dh_service_cli_${randomBytes(6).toString("hex")}`;
  let admin: pg.Client;
  let owner: pg.Client;
  let pool: pg.Pool;
  let store: GateRecordStore;
  let dbUrl: string;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`create database ${database}`);

    dbUrl = withDatabase(adminUrl ?? "", database);
    owner = new pg.Client({ connectionString: dbUrl });
    await owner.connect();
    await migrate(owner);

    pool = createPool(dbUrl);
    store = createPostgresGateRecordStore(pool);
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await owner.end();
    await admin.query(`drop database if exists ${database} with (force)`);
    await admin.end();
  }, 60_000);

  function invokeGateCli(repoDir: string, envOverrides: Record<string, string | undefined>) {
    const env: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (key === "GITHUB_WORKSPACE") continue;
      if (key in envOverrides) continue;
      env[key] = value;
    }
    for (const [key, value] of Object.entries(envOverrides)) {
      if (value !== undefined) {
        env[key] = value;
      }
    }
    return spawnSync(process.execPath, ["--conditions=@domain-harness/source", CLI_ENTRY], {
      cwd: repoDir,
      env,
      encoding: "utf8",
    });
  }

  it("1) pass: no deviating facts -> prints pass, exits 0, stores sequence 1 with HEAD revision and pinned hash, leaves tree/HEAD unchanged, and never names a plan", async () => {
    const { repoDir, applicationId, head } = createScratchRepo();
    const pinnedHash = "sha256:cli-pass-bundle";
    const bundleFile = writeSnapshotFile(
      makeSnapshotFixture({
        hash: pinnedHash,
        issuedAt: new Date().toISOString(),
        applications: [applicationId],
      }),
    );

    const res = invokeGateCli(repoDir, {
      SERVICE_RECORD_DATABASE_URL: dbUrl,
      SERVICE_ACTIVE_BUNDLE_FILE: bundleFile,
    });

    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe(PASS);
    expect(res.stdout).not.toMatch(/Community plan|Team plan|Business plan|Enterprise plan/i);
    expect(res.stderr).not.toMatch(/Community plan|Team plan|Business plan|Enterprise plan/i);

    const runs = await store.listGateRuns(applicationId);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      sequence: 1,
      applicationId,
      revision: head,
      bundleHash: pinnedHash,
      open: 0,
    });

    expect(git(repoDir, ["status", "--porcelain"])).toBe("");
    expect(git(repoDir, ["rev-parse", "HEAD"])).toBe(head);
  });

  it("2) fail: prohibited dependency in package.json -> prints fail + deviation line (Standard id, slot, subject, Correction instruction), exits non-zero, stores open=1, and leaves tree/HEAD unchanged", async () => {
    const { repoDir, applicationId, head } = createScratchRepo({
      files: {
        "package.json": JSON.stringify(
          { name: "violating-app", version: "1.0.0", dependencies: { lodash: "4.17.21" } },
          null,
          2,
        ),
      },
    });
    const bundleFile = writeSnapshotFile(
      makeSnapshotFixture({
        issuedAt: new Date().toISOString(),
        applications: [applicationId],
      }),
    );

    const res = invokeGateCli(repoDir, {
      SERVICE_RECORD_DATABASE_URL: dbUrl,
      SERVICE_ACTIVE_BUNDLE_FILE: bundleFile,
    });

    expect(res.status).not.toBe(0);
    const lines = res.stdout.trim().split("\n");
    expect(lines[0]).toBe(FAIL);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(FIXTURE_STD_PROHIBITED_ID);
    expect(lines[1]).toContain("code-stack/library/lodash");
    expect(lines[1]).toContain("lodash");
    expect(lines[1]).toContain(
      `The Standard ${FIXTURE_STD_PROHIBITED_ID} prohibits lodash; use the approved library remeda instead.`,
    );

    const runs = await store.listGateRuns(applicationId);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.open).toBe(1);

    expect(git(repoDir, ["status", "--porcelain"])).toBe("");
    expect(git(repoDir, ["rev-parse", "HEAD"])).toBe(head);
  });

  it("3) missing identification file -> prints refusal sentence, exits non-zero, stores no gate-run record, and leaves tree/HEAD unchanged", async () => {
    const { repoDir, applicationId, head } = createScratchRepo({ applicationId: null });
    const bundleFile = writeSnapshotFile(
      makeSnapshotFixture({
        issuedAt: new Date().toISOString(),
        applications: [applicationId],
      }),
    );

    const res = invokeGateCli(repoDir, {
      SERVICE_RECORD_DATABASE_URL: dbUrl,
      SERVICE_ACTIVE_BUNDLE_FILE: bundleFile,
    });

    expect(res.status).not.toBe(0);
    expect(res.stdout.trim()).toBe(MISSING_IDENTIFICATION_FILE);
    expect(await store.listGateRuns(applicationId)).toEqual([]);

    expect(git(repoDir, ["status", "--porcelain"])).toBe("");
    expect(git(repoDir, ["rev-parse", "HEAD"])).toBe(head);
  });

  it("4) duplicate fingerprint: pre-bound application with a different fingerprint -> prints duplicate Application id, exits non-zero, and records a binding_refusals row", async () => {
    const { repoDir, applicationId } = createScratchRepo();
    const otherFingerprint = "f".repeat(64);
    await store.bindApplication(applicationId, otherFingerprint);

    const bundleFile = writeSnapshotFile(
      makeSnapshotFixture({
        issuedAt: new Date().toISOString(),
        applications: [applicationId],
      }),
    );

    const res = invokeGateCli(repoDir, {
      SERVICE_RECORD_DATABASE_URL: dbUrl,
      SERVICE_ACTIVE_BUNDLE_FILE: bundleFile,
    });

    expect(res.status).not.toBe(0);
    expect(res.stdout.trim()).toBe(DUPLICATE_APPLICATION_ID);
    expect(await store.listGateRuns(applicationId)).toEqual([]);

    const refusals = await store.listBindingRefusals(applicationId);
    expect(refusals).toHaveLength(1);
    expect(refusals[0]?.boundFingerprint).toBe(otherFingerprint);
    expect(refusals[0]?.presentedFingerprint).not.toBe(otherFingerprint);
  });

  it("5) unbound: bundle applications list without the repo's Application id -> prints unbound Application and exits non-zero", async () => {
    const { repoDir, applicationId } = createScratchRepo();
    const bundleFile = writeSnapshotFile(
      makeSnapshotFixture({
        issuedAt: new Date().toISOString(),
        applications: [mintUuidV7()],
      }),
    );

    const res = invokeGateCli(repoDir, {
      SERVICE_RECORD_DATABASE_URL: dbUrl,
      SERVICE_ACTIVE_BUNDLE_FILE: bundleFile,
    });

    expect(res.status).not.toBe(0);
    expect(res.stdout.trim()).toBe(UNBOUND);
    expect(await store.listGateRuns(applicationId)).toEqual([]);
  });

  it("6) unreadable/pinned set: invalid effectiveSet -> prints Effective Standard set could not be read, exits non-zero, and leaves tree/HEAD unchanged", async () => {
    const { repoDir, applicationId, head } = createScratchRepo();
    const bundleFile = writeSnapshotFile(
      makeSnapshotFixture({
        issuedAt: new Date().toISOString(),
        applications: [applicationId],
        effectiveSet: { project: fixtureProjectRef, standards: "broken" } as unknown as EffectiveStandardSet,
      }),
    );

    const res = invokeGateCli(repoDir, {
      SERVICE_RECORD_DATABASE_URL: dbUrl,
      SERVICE_ACTIVE_BUNDLE_FILE: bundleFile,
    });

    expect(res.status).not.toBe(0);
    expect(res.stdout.trim()).toBe(EFFECTIVE_STANDARD_SET_COULD_NOT_BE_READ);
    expect(await store.listGateRuns(applicationId)).toEqual([]);

    expect(git(repoDir, ["status", "--porcelain"])).toBe("");
    expect(git(repoDir, ["rev-parse", "HEAD"])).toBe(head);
  });

  it("7) stale: issuedAt 48h past the 24h bound with no freeze -> prints bundle stale and exits non-zero", async () => {
    const { repoDir, applicationId } = createScratchRepo();
    const issued48hAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const bundleFile = writeSnapshotFile(
      makeSnapshotFixture({
        issuedAt: issued48hAgo,
        applications: [applicationId],
        stalenessBoundHours: 24,
        frozenUntil: null,
      }),
    );

    const res = invokeGateCli(repoDir, {
      SERVICE_RECORD_DATABASE_URL: dbUrl,
      SERVICE_ACTIVE_BUNDLE_FILE: bundleFile,
    });

    expect(res.status).not.toBe(0);
    expect(res.stdout.trim()).toBe(BUNDLE_STALE);
    expect(await store.listGateRuns(applicationId)).toEqual([]);
  });

  it("8) step cannot run: missing SERVICE_ACTIVE_BUNDLE_FILE env -> exits non-zero with 'the step cannot run' on stderr", () => {
    const { repoDir } = createScratchRepo();

    const res = invokeGateCli(repoDir, {
      SERVICE_RECORD_DATABASE_URL: dbUrl,
      SERVICE_ACTIVE_BUNDLE_FILE: undefined,
    });

    expect(res.status).not.toBe(0);
    expect(res.stderr.trim()).toBe(STEP_CANNOT_RUN);
  });

  it("9) unreadable tracked file: chmod 000 on a tracked file or unparseable package.json fails closed with 'run did not complete', exit non-zero, and no gate-run record", async () => {
    const { repoDir, applicationId } = createScratchRepo({
      files: {
        "package.json": "{ unparseable json",
        "src/unreadable.ts": "export const x = 1;\n",
      },
    });
    const unreadableFile = join(repoDir, "src/unreadable.ts");
    chmodSync(unreadableFile, 0o000);

    const bundleFile = writeSnapshotFile(
      makeSnapshotFixture({
        issuedAt: new Date().toISOString(),
        applications: [applicationId],
      }),
    );

    try {
      const res = invokeGateCli(repoDir, {
        SERVICE_RECORD_DATABASE_URL: dbUrl,
        SERVICE_ACTIVE_BUNDLE_FILE: bundleFile,
      });

      expect(res.status).not.toBe(0);
      expect(res.stdout.trim()).toBe(RUN_DID_NOT_COMPLETE);
      expect(await store.listGateRuns(applicationId)).toEqual([]);
    } finally {
      chmodSync(unreadableFile, 0o644);
    }
  });

  it("reference revision check: evaluates a small tracked reference revision in under 60s and prints pass", () => {
    const { repoDir, applicationId, head } = createScratchRepo({
      files: {
        "package.json": JSON.stringify(
          { name: "reference-app", version: "1.0.0", dependencies: { remeda: "2.1.0" } },
          null,
          2,
        ),
        "src/index.ts": 'import { pipe } from "remeda";\nimport { helper } from "./helper.ts";\nexport const main = () => pipe(1, helper);\n',
        "src/helper.ts": "export const helper = (n: number): number => n + 1;\n",
        "src/styles.css": ":root { --surface-bg: #ffffff; --text-primary: #111111; }\n.box { background: var(--surface-bg); color: var(--text-primary); }\n",
      },
    });
    const bundleFile = writeSnapshotFile(
      makeSnapshotFixture({
        issuedAt: new Date().toISOString(),
        applications: [applicationId],
      }),
    );

    const startedAt = Date.now();
    const res = invokeGateCli(repoDir, {
      SERVICE_RECORD_DATABASE_URL: dbUrl,
      SERVICE_ACTIVE_BUNDLE_FILE: bundleFile,
    });
    const elapsedMs = Date.now() - startedAt;

    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe(PASS);
    expect(elapsedMs).toBeLessThan(60_000);
    expect(git(repoDir, ["status", "--porcelain"])).toBe("");
    expect(git(repoDir, ["rev-parse", "HEAD"])).toBe(head);
  });
});
