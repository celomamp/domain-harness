import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  BUNDLE_FORMAT_VERSION,
  BUNDLE_TYPE,
  canonicalJson,
  formatIdentificationFile,
  IDENTIFICATION_FILE_NAME,
} from "@domain-harness/contract";
import type { SignedStandardBundle, StandardBundlePayload, UuidV7 } from "@domain-harness/contract";
import { runGateCommand } from "./gate.ts";

const TENANT = "018f3d2a-7000-7000-8000-000000000100" as UuidV7;
const ROOT_PROJECT = "018f3d2a-7000-7000-8000-000000000110" as UuidV7;
const MODULE_ID = "018f3d2a-7000-7000-8000-000000000120" as UuidV7;
const STD_LODASH = "018f3d2a-7000-7000-8000-000000000130" as UuidV7;
const ACCOUNT_ID = "018f3d2a-7000-7000-8000-000000000140" as UuidV7;
const APP_ID = "018f3d2a-7000-7000-8000-000000000150" as UuidV7;
const NOW = "2026-10-14T12:00:00.000Z";

function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

describe("gate end-to-end on scratch repositories", () => {
  it("pass and fail runs print the CI-identical lines and exit codes with the tree and HEAD untouched", async () => {
    const signer = (() => {
      const pair = generateKeyPairSync("ed25519");
      const privateKey: KeyObject = pair.privateKey;
      return { keyId: "key-1", publicPem: String(pair.publicKey.export({ type: "spki", format: "pem" })), privateKey };
    })();

    const buildSigned = (payload: StandardBundlePayload): SignedStandardBundle => {
      const finalPayload = { ...payload, keyId: signer.keyId };
      const signature = cryptoSign(null, Buffer.from(canonicalJson(finalPayload), "utf8"), signer.privateKey).toString("base64");
      return { payload: finalPayload, keyId: signer.keyId, signature };
    };

    const basePayload = (): StandardBundlePayload => ({
      format: { type: BUNDLE_TYPE, version: BUNDLE_FORMAT_VERSION },
      tenantId: TENANT,
      sequence: 1,
      keyId: signer.keyId,
      issuedAt: "2026-10-14T10:00:00.000Z",
      stalenessHours: 24,
      frozen: false,
      standards: [
        {
          id: STD_LODASH,
          version: 1,
          module: { id: MODULE_ID, kind: "code-stack", name: "Backend" },
          project: { id: ROOT_PROJECT, name: "Root" },
          entry: { category: "library", name: "lodash", versionConstraint: null, status: "prohibited", correctionInstruction: null },
          publishedAt: "2026-10-01T00:00:00.000Z",
          publishedBy: { accountId: ACCOUNT_ID, name: "Bea" },
        },
      ],
      tree: {
        rootId: ROOT_PROJECT,
        projects: [
          { id: ROOT_PROJECT, name: "Root", levelName: null, parentId: null, createdAt: "2026-10-14T00:00:00.000Z" },
        ],
        lockedRules: [],
      },
      applications: [{ id: APP_ID, projectId: ROOT_PROJECT, fromFlow: false, agentTool: null }],
      acceptedDeviations: [],
    });

    const setupRepo = (files: Record<string, string>): { repoDir: string; head: string } => {
      const repoDir = realpathSync(mkdtempSync(join(tmpdir(), "dh-gate-e2e-repo-")));
      git(repoDir, ["init", "-q"]);
      git(repoDir, ["config", "user.email", "e2e@test"]);
      git(repoDir, ["config", "user.name", "E2E"]);
      writeFileSync(join(repoDir, IDENTIFICATION_FILE_NAME), formatIdentificationFile(APP_ID, ROOT_PROJECT));
      for (const [relative, content] of Object.entries(files)) {
        const abs = join(repoDir, relative);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, content);
      }
      git(repoDir, ["add", "."]);
      git(repoDir, ["commit", "-q", "-m", "initial"]);
      return { repoDir, head: git(repoDir, ["rev-parse", "HEAD"]) };
    };

    const setupArtifacts = (signed: SignedStandardBundle): { dir: string; bundle: string; trust: string; state: string; binding: string } => {
      const dir = realpathSync(mkdtempSync(join(tmpdir(), "dh-gate-e2e-state-")));
      const bundle = join(dir, "bundle.json");
      const trust = join(dir, "trust.json");
      const state = join(dir, "state.json");
      const binding = join(dir, "binding.json");
      writeFileSync(bundle, JSON.stringify(signed));
      writeFileSync(trust, JSON.stringify({ [signer.keyId]: signer.publicPem }));
      return { dir, bundle, trust, state, binding };
    };

    // Pass run: no lodash in the revision.
    {
      const { repoDir, head } = setupRepo({ "package.json": JSON.stringify({ dependencies: { remeda: "2.1.0" } }) });
      const art = setupArtifacts(buildSigned(basePayload()));
      const result = await runGateCommand([
        "gate",
        "--bundle", art.bundle,
        "--trust-keys", art.trust,
        "--tenant", TENANT,
        "--root", repoDir,
        "--binding", art.binding,
        "--state", art.state,
        "--now", NOW,
      ]);
      expect(result.exitCode).toBe(0);
      expect(result.lines).toEqual(["pass"]);
      expect(git(repoDir, ["status", "--porcelain"])).toBe("");
      expect(git(repoDir, ["rev-parse", "HEAD"])).toBe(head);
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(art.dir, { recursive: true, force: true });
    }

    // Fail run: prohibited lodash in the revision.
    {
      const { repoDir, head } = setupRepo({ "package.json": JSON.stringify({ dependencies: { lodash: "4.17.21" } }) });
      const art = setupArtifacts(buildSigned(basePayload()));
      const result = await runGateCommand([
        "gate",
        "--bundle", art.bundle,
        "--trust-keys", art.trust,
        "--tenant", TENANT,
        "--root", repoDir,
        "--binding", art.binding,
        "--state", art.state,
        "--now", NOW,
      ]);
      expect(result.exitCode).toBe(1);
      expect(result.lines[0]).toBe("fail");
      expect(result.lines).toHaveLength(2);
      expect(result.lines[1]).toContain(STD_LODASH);
      expect(result.lines[1]).toContain("code-stack/library/lodash");
      expect(git(repoDir, ["status", "--porcelain"])).toBe("");
      expect(git(repoDir, ["rev-parse", "HEAD"])).toBe(head);
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(art.dir, { recursive: true, force: true });
    }
  });
});
