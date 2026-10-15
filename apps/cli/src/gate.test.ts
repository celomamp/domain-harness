import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import type { KeyObject } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  BUNDLE_FORMAT_VERSION,
  BUNDLE_TYPE,
  canonicalJson,
  formatIdentificationFile,
  IDENTIFICATION_FILE_NAME,
} from "@domain-harness/contract";
import type {
  SignedStandardBundle,
  StandardBundlePayload,
  StandardInfo,
  UuidV7,
} from "@domain-harness/contract";
import {
  canonicalGateBytes,
  createInMemoryBindingLedger,
  gateFixtures,
  REFUSAL_SENTENCE_BY_REASON,
  runGateDirect,
} from "@domain-harness/gate";
import { readBinding, readBindingFile, writeBindingFile } from "./binding-file.ts";
import { bundleHashOf } from "./bundle-file.ts";
import { runCli } from "./cli.ts";
import { adaptWireBundleToSnapshot } from "./gate-snapshot.ts";
import {
  collectRevisionFiles,
  computeLocalFingerprint,
  defaultBindingPath,
  defaultGateStatePath,
  parseGateArgs,
  runGateCommand,
} from "./gate.ts";

const TENANT = "018f3d2a-7000-7000-8000-000000000100" as UuidV7;
const OTHER_TENANT = "018f3d2a-7000-7000-8000-000000000101" as UuidV7;
const ROOT_PROJECT = "018f3d2a-7000-7000-8000-000000000110" as UuidV7;
const MODULE_ID = "018f3d2a-7000-7000-8000-000000000120" as UuidV7;
const STD_LODASH = "018f3d2a-7000-7000-8000-000000000130" as UuidV7;
const STD_OTHER = "018f3d2a-7000-7000-8000-000000000131" as UuidV7;
const ACCOUNT_ID = "018f3d2a-7000-7000-8000-000000000140" as UuidV7;
const APP_ID = "018f3d2a-7000-7000-8000-000000000150" as UuidV7;
const OTHER_APP = "018f3d2a-7000-7000-8000-000000000151" as UuidV7;

const NOW = "2026-10-14T12:00:00.000Z";
const FRESH_ISSUED = "2026-10-14T10:00:00.000Z";

function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

function scratch(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  return dir;
}

function lodashStandard(): StandardInfo {
  return {
    id: STD_LODASH,
    version: 1,
    module: { id: MODULE_ID, kind: "code-stack", name: "Backend" },
    project: { id: ROOT_PROJECT, name: "Root" },
    entry: { category: "library", name: "lodash", versionConstraint: null, status: "prohibited", correctionInstruction: null },
    publishedAt: "2026-10-01T00:00:00.000Z",
    publishedBy: { accountId: ACCOUNT_ID, name: "Bea" },
  };
}

interface WireOptions {
  readonly standards?: readonly StandardInfo[];
  readonly applications?: StandardBundlePayload["applications"];
  readonly acceptedDeviations?: StandardBundlePayload["acceptedDeviations"];
  readonly issuedAt?: string;
  readonly stalenessHours?: number;
  readonly frozen?: boolean;
  readonly sequence?: number;
  readonly tenantId?: UuidV7;
  readonly keyId?: string;
  readonly tree?: StandardBundlePayload["tree"];
}

function makePayload(signerKeyId: string, options: WireOptions = {}): StandardBundlePayload {
  return {
    format: { type: BUNDLE_TYPE, version: BUNDLE_FORMAT_VERSION },
    tenantId: options.tenantId ?? TENANT,
    sequence: options.sequence ?? 1,
    keyId: options.keyId ?? signerKeyId,
    issuedAt: options.issuedAt ?? FRESH_ISSUED,
    stalenessHours: options.stalenessHours ?? 24,
    frozen: options.frozen ?? false,
    standards: options.standards ?? [lodashStandard()],
    tree:
      options.tree ?? {
        rootId: ROOT_PROJECT,
        projects: [
          { id: ROOT_PROJECT, name: "Root", levelName: null, parentId: null, createdAt: "2026-10-14T00:00:00.000Z" },
        ],
        lockedRules: [],
      },
    applications: options.applications ?? [{ id: APP_ID, projectId: ROOT_PROJECT, fromFlow: false, agentTool: null }],
    acceptedDeviations: options.acceptedDeviations ?? [],
  };
}

function makeSigner(keyId: string): { keyId: string; publicPem: string; privateKey: KeyObject } {
  const pair = generateKeyPairSync("ed25519");
  return { keyId, publicPem: String(pair.publicKey.export({ type: "spki", format: "pem" })), privateKey: pair.privateKey };
}

function signPayload(payload: StandardBundlePayload, signer: { keyId: string; privateKey: KeyObject }): SignedStandardBundle {
  const finalPayload = { ...payload, keyId: signer.keyId };
  const signature = cryptoSign(null, Buffer.from(canonicalJson(finalPayload), "utf8"), signer.privateKey).toString("base64");
  return { payload: finalPayload, keyId: signer.keyId, signature };
}

function createRepo(options: {
  readonly applicationId?: UuidV7 | null;
  readonly projectId?: UuidV7;
  readonly files?: Readonly<Record<string, string>>;
  readonly commit?: boolean;
}): { repoDir: string; applicationId: UuidV7; head: string } {
  const repoDir = scratch("dh-gate-repo-");
  const applicationId = options.applicationId === undefined ? APP_ID : (options.applicationId ?? APP_ID);
  const projectId = options.projectId ?? ROOT_PROJECT;
  git(repoDir, ["init", "-q"]);
  git(repoDir, ["config", "user.email", "cli@test"]);
  git(repoDir, ["config", "user.name", "CLI"]);
  if (options.applicationId !== null) {
    writeFileSync(join(repoDir, IDENTIFICATION_FILE_NAME), formatIdentificationFile(applicationId, projectId));
  }
  const files = options.files ?? { "package.json": JSON.stringify({ dependencies: { remeda: "2.1.0" } }) };
  for (const [relative, content] of Object.entries(files)) {
    const abs = join(repoDir, relative);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  if (options.commit ?? true) {
    git(repoDir, ["add", "."]);
    git(repoDir, ["commit", "-q", "-m", "initial"]);
  }
  let head: string;
  try {
    head = git(repoDir, ["rev-parse", "HEAD"]);
  } catch {
    head = "";
  }
  return { repoDir, applicationId, head };
}

function writeBundleArtifacts(
  signed: SignedStandardBundle,
  signer: { keyId: string; publicPem: string },
): { dir: string; bundlePath: string; trustPath: string; statePath: string; bindingPath: string } {
  const dir = scratch("dh-gate-artifacts-");
  const bundlePath = join(dir, "bundle.json");
  const trustPath = join(dir, "trust.json");
  const statePath = join(dir, "state.json");
  const bindingPath = join(dir, "binding.json");
  writeFileSync(bundlePath, JSON.stringify(signed));
  writeFileSync(trustPath, JSON.stringify({ [signer.keyId]: signer.publicPem }));
  return { dir, bundlePath, trustPath, statePath, bindingPath };
}

function gateArgv(parts: {
  readonly bundlePath: string;
  readonly trustPath: string;
  readonly tenant?: UuidV7;
  readonly root?: string;
  readonly bindingPath?: string;
  readonly statePath?: string;
  readonly now?: string;
}): string[] {
  const argv = [
    "gate",
    "--bundle",
    parts.bundlePath,
    "--trust-keys",
    parts.trustPath,
    "--tenant",
    parts.tenant ?? TENANT,
  ];
  if (parts.root !== undefined) argv.push("--root", parts.root);
  if (parts.bindingPath !== undefined) argv.push("--binding", parts.bindingPath);
  if (parts.statePath !== undefined) argv.push("--state", parts.statePath);
  if (parts.now !== undefined) argv.push("--now", parts.now);
  return argv;
}

describe("domain-harness gate command", () => {
  it("pass: clean revision prints pass with exit 0 and binds on first use", async () => {
    const { repoDir, head } = createRepo({ files: { "package.json": JSON.stringify({ dependencies: { remeda: "2.1.0" } }) } });
    const signer = makeSigner("key-1");
    const signed = signPayload(makePayload(signer.keyId), signer);
    const art = writeBundleArtifacts(signed, signer);
    const result = await runGateCommand(
      gateArgv({ bundlePath: art.bundlePath, trustPath: art.trustPath, root: repoDir, bindingPath: art.bindingPath, statePath: art.statePath, now: NOW }),
    );
    expect(result.exitCode).toBe(0);
    expect(result.lines).toEqual(["pass"]);
    const fingerprint = computeLocalFingerprint(repoDir);
    expect(fingerprint.ok).toBe(true);
    if (!fingerprint.ok) throw new Error("the scratch repo had no fingerprint");
    expect(readBinding(art.bindingPath, APP_ID)?.fingerprint).toBe(fingerprint.fingerprint);
    expect(git(repoDir, ["status", "--porcelain"])).toBe("");
    expect(git(repoDir, ["rev-parse", "HEAD"])).toBe(head);
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(art.dir, { recursive: true, force: true });
  });

  it("fail open: prohibited dependency prints fail plus the Deviation line with exit 1", async () => {
    const { repoDir, head } = createRepo({ files: { "package.json": JSON.stringify({ dependencies: { lodash: "4.17.21" } }) } });
    const signer = makeSigner("key-1");
    const signed = signPayload(makePayload(signer.keyId), signer);
    const art = writeBundleArtifacts(signed, signer);
    const result = await runGateCommand(
      gateArgv({ bundlePath: art.bundlePath, trustPath: art.trustPath, root: repoDir, bindingPath: art.bindingPath, statePath: art.statePath, now: NOW }),
    );
    expect(result.exitCode).toBe(1);
    expect(result.lines[0]).toBe("fail");
    expect(result.lines).toHaveLength(2);
    expect(result.lines[1]).toContain(STD_LODASH);
    expect(result.lines[1]).toContain("code-stack/library/lodash");
    expect(result.lines[1]).toContain("lodash");
    expect(result.lines.join("\n")).not.toMatch(/Community plan|Team plan|Business plan|Enterprise plan/i);
    expect(git(repoDir, ["status", "--porcelain"])).toBe("");
    expect(git(repoDir, ["rev-parse", "HEAD"])).toBe(head);
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(art.dir, { recursive: true, force: true });
  });

  it("accepted only: live acceptance turns the violation into pass", async () => {
    const { repoDir } = createRepo({ files: { "package.json": JSON.stringify({ dependencies: { lodash: "4.17.21" } }) } });
    const signer = makeSigner("key-1");
    const signed = signPayload(
      makePayload(signer.keyId, {
        acceptedDeviations: [
          {
            applicationId: APP_ID,
            standardId: STD_LODASH,
            standardVersion: 1,
            slot: { moduleKind: "code-stack", slotKind: "library", name: "lodash" },
            subject: "lodash",
            start: "2026-10-01T00:00:00.000Z",
            end: "2026-11-01T00:00:00.000Z",
          },
        ],
      }),
      signer,
    );
    const art = writeBundleArtifacts(signed, signer);
    const result = await runGateCommand(
      gateArgv({ bundlePath: art.bundlePath, trustPath: art.trustPath, root: repoDir, bindingPath: art.bindingPath, statePath: art.statePath, now: NOW }),
    );
    expect(result.exitCode).toBe(0);
    expect(result.lines).toEqual(["pass"]);
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(art.dir, { recursive: true, force: true });
  });

  it("missing identification file prints its sentence with exit 1", async () => {
    const { repoDir } = createRepo({ applicationId: null });
    const signer = makeSigner("key-1");
    const signed = signPayload(makePayload(signer.keyId), signer);
    const art = writeBundleArtifacts(signed, signer);
    const result = await runGateCommand(
      gateArgv({ bundlePath: art.bundlePath, trustPath: art.trustPath, root: repoDir, bindingPath: art.bindingPath, statePath: art.statePath, now: NOW }),
    );
    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual(["missing or unreadable identification file"]);
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(art.dir, { recursive: true, force: true });
  });

  it("unreadable identification content prints the same sentence", async () => {
    const { repoDir } = createRepo({});
    writeFileSync(join(repoDir, IDENTIFICATION_FILE_NAME), "{not json");
    git(repoDir, ["add", "."]);
    git(repoDir, ["commit", "-q", "-m", "break ident"]);
    const signer = makeSigner("key-1");
    const signed = signPayload(makePayload(signer.keyId), signer);
    const art = writeBundleArtifacts(signed, signer);
    const result = await runGateCommand(
      gateArgv({ bundlePath: art.bundlePath, trustPath: art.trustPath, root: repoDir, bindingPath: art.bindingPath, statePath: art.statePath, now: NOW }),
    );
    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual(["missing or unreadable identification file"]);
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(art.dir, { recursive: true, force: true });
  });

  it("unbound: application absent from the bundle prints unbound Application", async () => {
    const { repoDir } = createRepo({});
    const signer = makeSigner("key-1");
    const signed = signPayload(makePayload(signer.keyId, { applications: [{ id: OTHER_APP, projectId: ROOT_PROJECT, fromFlow: false, agentTool: null }] }), signer);
    const art = writeBundleArtifacts(signed, signer);
    const result = await runGateCommand(
      gateArgv({ bundlePath: art.bundlePath, trustPath: art.trustPath, root: repoDir, bindingPath: art.bindingPath, statePath: art.statePath, now: NOW }),
    );
    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual(["unbound Application"]);
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(art.dir, { recursive: true, force: true });
  });

  it("unbound: a repository with no commit prints unbound Application", async () => {
    const { repoDir } = createRepo({ commit: false });
    const signer = makeSigner("key-1");
    const signed = signPayload(makePayload(signer.keyId), signer);
    const art = writeBundleArtifacts(signed, signer);
    const result = await runGateCommand(
      gateArgv({ bundlePath: art.bundlePath, trustPath: art.trustPath, root: repoDir, bindingPath: art.bindingPath, statePath: art.statePath, now: NOW }),
    );
    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual(["unbound Application"]);
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(art.dir, { recursive: true, force: true });
  });

  it("duplicate: a bound id with a different fingerprint is refused and recorded", async () => {
    const { repoDir } = createRepo({});
    const signer = makeSigner("key-1");
    const signed = signPayload(makePayload(signer.keyId), signer);
    const art = writeBundleArtifacts(signed, signer);
    writeBindingFile(art.bindingPath, { bindings: { [APP_ID]: "f".repeat(64) }, refusals: [] });
    const result = await runGateCommand(
      gateArgv({ bundlePath: art.bundlePath, trustPath: art.trustPath, root: repoDir, bindingPath: art.bindingPath, statePath: art.statePath, now: NOW }),
    );
    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual(["duplicate Application id"]);
    const file = readBindingFile(art.bindingPath);
    expect(file.refusals).toHaveLength(1);
    expect(file.refusals[0]).toMatchObject({ applicationId: APP_ID, boundFingerprint: "f".repeat(64) });
    expect(file.refusals[0]?.presentedFingerprint).not.toBe("f".repeat(64));
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(art.dir, { recursive: true, force: true });
  });

  it("set unreadable: slot conflict and off-tree project each refuse", async () => {
    const conflictA = lodashStandard();
    const conflictB: StandardInfo = { ...conflictA, id: STD_OTHER };
    for (const payload of [
      makePayload("key-1", { standards: [conflictA, conflictB] }),
      makePayload("key-1", { applications: [{ id: APP_ID, projectId: "018f3d2a-7000-7000-8000-000000000199" as UuidV7, fromFlow: false, agentTool: null }] }),
    ]) {
      const { repoDir } = createRepo({});
      const signer = makeSigner("key-1");
      const signed = signPayload({ ...payload, keyId: signer.keyId }, signer);
      const art = writeBundleArtifacts(signed, signer);
      const result = await runGateCommand(
        gateArgv({ bundlePath: art.bundlePath, trustPath: art.trustPath, root: repoDir, bindingPath: art.bindingPath, statePath: art.statePath, now: NOW }),
      );
      expect(result.exitCode).toBe(1);
      expect(result.lines).toEqual(["Effective Standard set could not be read"]);
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(art.dir, { recursive: true, force: true });
    }
  });

  it("stale bundle prints bundle stale (past bound and future issue time)", async () => {
    for (const issuedAt of ["2026-10-12T12:00:00.000Z", "2026-10-14T13:00:00.000Z"]) {
      const { repoDir } = createRepo({});
      const signer = makeSigner("key-1");
      const signed = signPayload(makePayload(signer.keyId, { issuedAt }), signer);
      const art = writeBundleArtifacts(signed, signer);
      const result = await runGateCommand(
        gateArgv({ bundlePath: art.bundlePath, trustPath: art.trustPath, root: repoDir, bindingPath: art.bindingPath, statePath: art.statePath, now: NOW }),
      );
      expect(result.exitCode, issuedAt).toBe(1);
      expect(result.lines, issuedAt).toEqual(["bundle stale"]);
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(art.dir, { recursive: true, force: true });
    }
  });

  it("frozen bundle with an old issue time still runs", async () => {
    const { repoDir } = createRepo({});
    const signer = makeSigner("key-1");
    const signed = signPayload(makePayload(signer.keyId, { issuedAt: "2026-10-12T12:00:00.000Z", frozen: true, standards: [] }), signer);
    const art = writeBundleArtifacts(signed, signer);
    const result = await runGateCommand(
      gateArgv({ bundlePath: art.bundlePath, trustPath: art.trustPath, root: repoDir, bindingPath: art.bindingPath, statePath: art.statePath, now: NOW }),
    );
    expect(result.exitCode).toBe(0);
    expect(result.lines).toEqual(["pass"]);
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(art.dir, { recursive: true, force: true });
  });

  it("bad bundles print verification failed and leave state unchanged", async () => {
    const { repoDir } = createRepo({});
    const signer = makeSigner("key-1");
    const good = signPayload(makePayload(signer.keyId), signer);
    const art = writeBundleArtifacts(good, signer);
    const before = await runGateCommand(
      gateArgv({ bundlePath: art.bundlePath, trustPath: art.trustPath, root: repoDir, bindingPath: art.bindingPath, statePath: art.statePath, now: NOW }),
    );
    expect(before.exitCode).toBe(0);
    const stateBefore = readFileSync(art.statePath, "utf8");

    const tampered: SignedStandardBundle = { ...good, signature: `B${good.signature.slice(1)}` };
    writeFileSync(art.bundlePath, JSON.stringify(tampered));
    const tamperedResult = await runGateCommand(
      gateArgv({ bundlePath: art.bundlePath, trustPath: art.trustPath, root: repoDir, bindingPath: art.bindingPath, statePath: art.statePath, now: NOW }),
    );
    expect(tamperedResult).toMatchObject({ exitCode: 1, lines: ["bundle verification failed"] });
    expect(readFileSync(art.statePath, "utf8")).toBe(stateBefore);

    const rogue = makeSigner("rogue");
    const unknownKey = signPayload(makePayload(rogue.keyId), rogue);
    writeFileSync(art.bundlePath, JSON.stringify(unknownKey));
    const unknownResult = await runGateCommand(
      gateArgv({ bundlePath: art.bundlePath, trustPath: art.trustPath, root: repoDir, bindingPath: art.bindingPath, statePath: art.statePath, now: NOW }),
    );
    expect(unknownResult.lines).toEqual(["bundle verification failed"]);

    const mismatch = signPayload(makePayload(signer.keyId, { tenantId: OTHER_TENANT }), signer);
    writeFileSync(art.bundlePath, JSON.stringify(mismatch));
    const mismatchResult = await runGateCommand(
      gateArgv({ bundlePath: art.bundlePath, trustPath: art.trustPath, root: repoDir, bindingPath: art.bindingPath, statePath: art.statePath, now: NOW }),
    );
    expect(mismatchResult.lines).toEqual(["bundle verification failed"]);

    writeFileSync(art.bundlePath, "{not json");
    const malformed = await runGateCommand(
      gateArgv({ bundlePath: art.bundlePath, trustPath: art.trustPath, root: repoDir, bindingPath: art.bindingPath, statePath: art.statePath, now: NOW }),
    );
    expect(malformed.lines).toEqual(["bundle verification failed"]);
    expect(readFileSync(art.statePath, "utf8")).toBe(stateBefore);
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(art.dir, { recursive: true, force: true });
  });

  it("replayed sequence prints verification failed", async () => {
    const { repoDir } = createRepo({});
    const signer = makeSigner("key-1");
    const art = writeBundleArtifacts(signPayload(makePayload(signer.keyId, { sequence: 2 }), signer), signer);
    const first = await runGateCommand(
      gateArgv({ bundlePath: art.bundlePath, trustPath: art.trustPath, root: repoDir, bindingPath: art.bindingPath, statePath: art.statePath, now: NOW }),
    );
    expect(first.exitCode).toBe(0);
    writeFileSync(art.bundlePath, JSON.stringify(signPayload(makePayload(signer.keyId, { sequence: 1 }), signer)));
    const replay = await runGateCommand(
      gateArgv({ bundlePath: art.bundlePath, trustPath: art.trustPath, root: repoDir, bindingPath: art.bindingPath, statePath: art.statePath, now: NOW }),
    );
    expect(replay.lines).toEqual(["bundle verification failed"]);
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(art.dir, { recursive: true, force: true });
  });

  it("unreadable tracked file forces run did not complete on an otherwise passing run", async () => {
    const { repoDir } = createRepo({
      files: {
        "package.json": JSON.stringify({ dependencies: { remeda: "2.1.0" } }),
        "src/unreadable.ts": "export const x = 1;\n",
      },
    });
    const target = join(repoDir, "src/unreadable.ts");
    chmodSync(target, 0o000);
    try {
      const readable: boolean = (() => {
        try {
          readFileSync(target, "utf8");
          return true;
        } catch {
          return false;
        }
      })();
      if (!readable) {
        const signer = makeSigner("key-1");
        const signed = signPayload(makePayload(signer.keyId, { standards: [] }), signer);
        const art = writeBundleArtifacts(signed, signer);
        const result = await runGateCommand(
          gateArgv({ bundlePath: art.bundlePath, trustPath: art.trustPath, root: repoDir, bindingPath: art.bindingPath, statePath: art.statePath, now: NOW }),
        );
        expect(result.exitCode).toBe(1);
        expect(result.lines).toEqual(["run did not complete"]);
        rmSync(art.dir, { recursive: true, force: true });
      }
    } finally {
      chmodSync(target, 0o644);
    }
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("unreadable file loses to an earlier refusal (CI precedence)", async () => {
    const { repoDir } = createRepo({
      files: {
        "package.json": JSON.stringify({ dependencies: { remeda: "2.1.0" } }),
        "src/unreadable.ts": "export const x = 1;\n",
      },
    });
    const target = join(repoDir, "src/unreadable.ts");
    chmodSync(target, 0o000);
    try {
      const signer = makeSigner("key-1");
      const signed = signPayload(
        makePayload(signer.keyId, { applications: [{ id: OTHER_APP, projectId: ROOT_PROJECT, fromFlow: false, agentTool: null }] }),
        signer,
      );
      const art = writeBundleArtifacts(signed, signer);
      const result = await runGateCommand(
        gateArgv({ bundlePath: art.bundlePath, trustPath: art.trustPath, root: repoDir, bindingPath: art.bindingPath, statePath: art.statePath, now: NOW }),
      );
      expect(result.exitCode).toBe(1);
      expect(result.lines).toEqual(["unbound Application"]);
      rmSync(art.dir, { recursive: true, force: true });
    } finally {
      chmodSync(target, 0o644);
    }
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("stale wins over unbound (verify-layer precedence)", async () => {
    const { repoDir } = createRepo({});
    const signer = makeSigner("key-1");
    const signed = signPayload(
      makePayload(signer.keyId, {
        issuedAt: "2026-10-12T12:00:00.000Z",
        applications: [{ id: OTHER_APP, projectId: ROOT_PROJECT, fromFlow: false, agentTool: null }],
      }),
      signer,
    );
    const art = writeBundleArtifacts(signed, signer);
    const result = await runGateCommand(
      gateArgv({ bundlePath: art.bundlePath, trustPath: art.trustPath, root: repoDir, bindingPath: art.bindingPath, statePath: art.statePath, now: NOW }),
    );
    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual(["bundle stale"]);
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(art.dir, { recursive: true, force: true });
  });

  it("usage defects print run did not complete and write nothing", async () => {
    const dir = scratch("dh-gate-usage-");
    const statePath = join(dir, "state.json");
    const bindingPath = join(dir, "binding.json");
    expect((await runGateCommand(["gate", "--bundle", "a"])).lines).toEqual(["run did not complete"]);
    expect((await runGateCommand(["gate", "--bundle", "a", "--trust-keys", "b"])).lines).toEqual(["run did not complete"]);
    // A pure parse defect that still names explicit state/binding paths: the
    // failed parse must write neither.
    expect(
      (
        await runGateCommand([
          "gate",
          "--bundle",
          "a",
          "--trust-keys",
          "b",
          "--tenant",
          TENANT,
          "--bogus",
          "x",
          "--state",
          statePath,
          "--binding",
          bindingPath,
        ])
      ).lines,
    ).toEqual(["run did not complete"]);
    expect(
      (await runGateCommand(["gate", "--bundle", "a", "--trust-keys", "b", "--tenant", TENANT, "--now", "not-a-clock"])).lines,
    ).toEqual(["run did not complete"]);
    expect((await runGateCommand(["bundle", "verify"])).lines).toEqual(["run did not complete"]);
    expect(existsSync(statePath)).toBe(false);
    expect(existsSync(bindingPath)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it("a git ls-files failure prints run did not complete", async () => {
    const { repoDir } = createRepo({});
    const signer = makeSigner("key-1");
    const signed = signPayload(makePayload(signer.keyId), signer);
    const art = writeBundleArtifacts(signed, signer);
    const result = await runGateCommand(
      gateArgv({ bundlePath: art.bundlePath, trustPath: art.trustPath, root: repoDir, bindingPath: art.bindingPath, statePath: art.statePath, now: NOW }),
      {
        collectRevisionFiles: () => ({ ok: false as const, sentence: "run did not complete", exitCode: 1 as const }),
      },
    );
    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual(["run did not complete"]);
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(art.dir, { recursive: true, force: true });
  });

  it("an unreadable tracked file forces run did not complete on an otherwise passing run (seam)", async () => {
    const { repoDir } = createRepo({ files: { "package.json": JSON.stringify({ dependencies: { remeda: "2.1.0" } }) } });
    const signer = makeSigner("key-1");
    const signed = signPayload(makePayload(signer.keyId), signer);
    const art = writeBundleArtifacts(signed, signer);
    const result = await runGateCommand(
      gateArgv({ bundlePath: art.bundlePath, trustPath: art.trustPath, root: repoDir, bindingPath: art.bindingPath, statePath: art.statePath, now: NOW }),
      {
        collectRevisionFiles: () => ({
          ok: true as const,
          applicationId: APP_ID,
          fingerprint: "f".repeat(64),
          files: { "package.json": JSON.stringify({ dependencies: { remeda: "2.1.0" } }) },
          unreadable: [{ path: "src/locked.ts", reason: "could not read file" }],
        }),
      },
    );
    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual(["run did not complete"]);
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(art.dir, { recursive: true, force: true });
  });

  it("an unreadable tracked file loses to an earlier refusal over the seam", async () => {
    const { repoDir } = createRepo({});
    const signer = makeSigner("key-1");
    const signed = signPayload(
      makePayload(signer.keyId, { applications: [{ id: OTHER_APP, projectId: ROOT_PROJECT, fromFlow: false, agentTool: null }] }),
      signer,
    );
    const art = writeBundleArtifacts(signed, signer);
    const result = await runGateCommand(
      gateArgv({ bundlePath: art.bundlePath, trustPath: art.trustPath, root: repoDir, bindingPath: art.bindingPath, statePath: art.statePath, now: NOW }),
      {
        collectRevisionFiles: () => ({
          ok: true as const,
          applicationId: APP_ID,
          fingerprint: "f".repeat(64),
          files: { "package.json": JSON.stringify({ dependencies: { remeda: "2.1.0" } }) },
          unreadable: [{ path: "src/locked.ts", reason: "could not read file" }],
        }),
      },
    );
    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual(["unbound Application"]);
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(art.dir, { recursive: true, force: true });
  });

  it("parses equals-form flags and applies cache-dir defaults", () => {
    const parsed = parseGateArgs(["gate", "--bundle=/b.json", "--trust-keys=/t.json", "--tenant", TENANT]);
    expect(parsed?.bundlePath).toBe("/b.json");
    expect(parsed?.trustKeysPath).toBe("/t.json");
    expect(parsed?.tenantId).toBe(TENANT);
    expect(typeof parsed?.root).toBe("string");
    expect(typeof parsed?.bindingPath).toBe("string");
    expect(typeof parsed?.statePath).toBe("string");
    expect(typeof parsed?.now).toBe("string");
    expect(parseGateArgs(["gate", "--bundle", "a"])).toBeNull();
    expect(parseGateArgs(["gate", "--bundle", "a", "--trust-keys", "b", "--tenant", TENANT, "--now", "bad"])).toBeNull();
  });

  it("defaults live under the cache dir beside each other, never the working tree", () => {
    const state = defaultGateStatePath();
    const binding = defaultBindingPath();
    expect(binding).toBe(join(dirname(state), "binding.json"));
    expect(state.endsWith(join("domain-harness", "bundle-state.json"))).toBe(true);
    expect(binding.endsWith(join("domain-harness", "binding.json"))).toBe(true);
  });

  it("collectRevisionFiles mirrors the CI entry and never throws", () => {
    const { repoDir } = createRepo({});
    const collected = collectRevisionFiles(repoDir);
    expect(collected.ok).toBe(true);
    if (collected.ok) {
      expect(collected.applicationId).toBe(APP_ID);
      expect(collected.fingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(collected.files["package.json"]).toContain("remeda");
    }
    expect(collectRevisionFiles("").ok).toBe(false);
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("every story 5.4 fixture matches its pinned kind, sentence, and exit through the file ledger", async () => {
    let compared = 0;
    for (const fixture of gateFixtures) {
      const dir = scratch("dh-gate-fixture-");
      const bindingPath = join(dir, "binding.json");
      if (fixture.boundFingerprint !== null) {
        writeBindingFile(bindingPath, { bindings: { [fixture.applicationId]: fixture.boundFingerprint }, refusals: [] });
      }
      const fileOutcome = await runGateDirect({
        applicationId: fixture.applicationId,
        repoFingerprint: fixture.repoFingerprint,
        files: { ...fixture.files },
        bundle: fixture.bundle,
        ledger: (await import("./binding-file.ts")).createFileBindingLedger(bindingPath),
        now: fixture.now,
      });
      const memoryOutcome = await runGateDirect({
        applicationId: fixture.applicationId,
        repoFingerprint: fixture.repoFingerprint,
        files: { ...fixture.files },
        bundle: fixture.bundle,
        ledger: createInMemoryBindingLedger(
          fixture.boundFingerprint === null
            ? []
            : [{ applicationId: fixture.applicationId, fingerprint: fixture.boundFingerprint }],
        ),
        now: fixture.now,
      });
      expect(canonicalGateBytes(fileOutcome), `fixture ${fixture.name}: file vs memory ledger`).toBe(
        canonicalGateBytes(memoryOutcome),
      );
      expect(fileOutcome.kind, `kind of ${fixture.name}`).toBe(fixture.expectation.kind);
      if (fixture.expectation.refusalReason === null) {
        expect(fileOutcome.exitCode, `exit of ${fixture.name}`).toBe(fixture.expectation.kind === "pass" ? 0 : 1);
        expect(fileOutcome.sentence, `sentence of ${fixture.name}`).toBe(
          fixture.expectation.kind === "pass" ? "pass" : "fail",
        );
      } else {
        expect(fileOutcome.exitCode, `exit of ${fixture.name}`).toBe(1);
        expect(fileOutcome.sentence, `sentence of ${fixture.name}`).toBe(
          REFUSAL_SENTENCE_BY_REASON[fixture.expectation.refusalReason],
        );
      }
      if (fixture.expectation.kind === "pass" && fixture.bundle.variant === "snapshot") {
        expect(fileOutcome.pinnedHash, `pinnedHash of ${fixture.name}`).toBe(fixture.bundle.snapshot.hash);
      }
      compared += 1;
      rmSync(dir, { recursive: true, force: true });
    }
    expect(compared).toBe(gateFixtures.length);
  });

  it("wire-bundle parity: adapted wire cases match runGateDirect on the equivalent snapshot byte for byte", async () => {
    const cases: ReadonlyArray<{ name: string; payload: StandardBundlePayload; files: Record<string, string>; now: string }> = [
      {
        name: "pass",
        payload: makePayload("key-1", { standards: [lodashStandard()] }),
        files: { "package.json": JSON.stringify({ dependencies: { remeda: "2.1.0" } }) },
        now: NOW,
      },
      {
        name: "fail",
        payload: makePayload("key-1", { standards: [lodashStandard()] }),
        files: { "package.json": JSON.stringify({ dependencies: { lodash: "4.17.21" } }) },
        now: NOW,
      },
      {
        name: "accepted",
        payload: makePayload("key-1", {
          standards: [lodashStandard()],
          acceptedDeviations: [
            {
              applicationId: APP_ID,
              standardId: STD_LODASH,
              standardVersion: 1,
              slot: { moduleKind: "code-stack", slotKind: "library", name: "lodash" },
              subject: "lodash",
              start: "2026-10-01T00:00:00.000Z",
              end: "2026-11-01T00:00:00.000Z",
            },
          ],
        }),
        files: { "package.json": JSON.stringify({ dependencies: { lodash: "4.17.21" } }) },
        now: NOW,
      },
      {
        name: "frozen",
        payload: makePayload("key-1", { standards: [], issuedAt: "2026-10-12T12:00:00.000Z", frozen: true }),
        files: {},
        now: NOW,
      },
    ];
    for (const example of cases) {
      const signed = { payload: example.payload, keyId: example.payload.keyId, signature: "s" } as SignedStandardBundle;
      const hash = bundleHashOf(signed);
      const adapted = adaptWireBundleToSnapshot({ signed, hash, applicationId: APP_ID, now: example.now });
      expect(adapted.ok, example.name).toBe(true);
      if (!adapted.ok) continue;
      const dir = scratch("dh-gate-parity-");
      const viaFile = await runGateDirect({
        applicationId: APP_ID,
        repoFingerprint: "f".repeat(64),
        files: { ...example.files },
        bundle: { variant: "snapshot", snapshot: adapted.snapshot },
        ledger: (await import("./binding-file.ts")).createFileBindingLedger(join(dir, "binding.json")),
        now: example.now,
      });
      const viaMemory = await runGateDirect({
        applicationId: APP_ID,
        repoFingerprint: "f".repeat(64),
        files: { ...example.files },
        bundle: { variant: "snapshot", snapshot: adapted.snapshot },
        ledger: createInMemoryBindingLedger(),
        now: example.now,
      });
      expect(canonicalGateBytes(viaFile), `parity of ${example.name}`).toBe(canonicalGateBytes(viaMemory));
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("runCli dispatch (the shipped binary's path)", () => {
  it("routes gate argv to the gate command with matching exit and lines (pass and fail)", async () => {
    const signer = makeSigner("key-1");
    const signed = signPayload(makePayload(signer.keyId), signer);

    // Pass: runCli(["gate", ...]) matches runGateCommand's exit/lines.
    {
      const { repoDir } = createRepo({ files: { "package.json": JSON.stringify({ dependencies: { remeda: "2.1.0" } }) } });
      const art = writeBundleArtifacts(signed, signer);
      const argv = gateArgv({ bundlePath: art.bundlePath, trustPath: art.trustPath, root: repoDir, bindingPath: art.bindingPath, statePath: art.statePath, now: NOW });
      const viaCli = await runCli(argv);
      const direct = await runGateCommand(argv);
      expect(viaCli).toEqual({ exitCode: direct.exitCode, lines: [...direct.lines] });
      expect(viaCli).toEqual({ exitCode: 0, lines: ["pass"] });
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(art.dir, { recursive: true, force: true });
    }

    // Fail: the sentence plus one Deviation line survive the dispatch.
    {
      const { repoDir } = createRepo({ files: { "package.json": JSON.stringify({ dependencies: { lodash: "4.17.21" } }) } });
      const art = writeBundleArtifacts(signed, signer);
      const argv = gateArgv({ bundlePath: art.bundlePath, trustPath: art.trustPath, root: repoDir, bindingPath: art.bindingPath, statePath: art.statePath, now: NOW });
      const viaCli = await runCli(argv);
      expect(viaCli.exitCode).toBe(1);
      expect(viaCli.lines[0]).toBe("fail");
      expect(viaCli.lines).toHaveLength(2);
      expect(viaCli.lines[1]).toContain(STD_LODASH);
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(art.dir, { recursive: true, force: true });
    }
  });

  it("maps a gate usage defect to run did not complete, distinct from the verify path", async () => {
    expect(await runCli(["gate", "--bundle", "a"])).toEqual({ exitCode: 1, lines: ["run did not complete"] });
    // The verify path keeps its own sentence for the same shape of defect.
    const verify = await runCli(["bundle", "verify"]);
    expect(verify.exitCode).toBe(1);
    expect(verify.lines).toEqual(["bundle verification failed"]);
  });
});
