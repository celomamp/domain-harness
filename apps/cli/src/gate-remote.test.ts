import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { IncomingHttpHeaders, Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  formatIdentificationFile,
  GATE_RUN_PATH,
  IDENTIFICATION_FILE_NAME,
  isGateRunRequest,
} from "@domain-harness/contract";
import type { GateRunResult, UuidV7 } from "@domain-harness/contract";
import { MISSING_IDENTIFICATION_FILE, RUN_DID_NOT_COMPLETE, UNBOUND } from "@domain-harness/gate";
import { runCli } from "./cli.ts";
import { computeLocalFingerprint } from "./gate.ts";
import {
  gateRunUrlOf,
  GUIDANCE_TOKEN_ENV,
  isRemoteGateArgs,
  parseRemoteGateArgs,
  runRemoteGateCommand,
} from "./gate-remote.ts";

const APP_ID = "018f3d2a-7000-7000-8000-000000000150" as UuidV7;
const PROJECT_ID = "018f3d2a-7000-7000-8000-000000000110" as UuidV7;
const TOKEN = "pilot-token-never-printed-0123456789";
const SOURCE_MARKER = "const secretBusinessLogic = 42;";

const dirs: string[] = [];
let server: Server | undefined;

afterEach(async () => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  await new Promise<void>((resolve) => {
    if (server === undefined) {
      resolve();
      return;
    }
    server.close(() => {
      resolve();
    });
  });
  server = undefined;
});

function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

function createRepo(options: { readonly ident?: boolean; readonly commit?: boolean; readonly files?: Record<string, string> } = {}): {
  repoDir: string;
  head: string;
} {
  const repoDir = realpathSync(mkdtempSync(join(tmpdir(), "dh-gate-remote-")));
  dirs.push(repoDir);
  git(repoDir, ["init", "-q"]);
  git(repoDir, ["config", "user.email", "cli@test"]);
  git(repoDir, ["config", "user.name", "CLI"]);
  if (options.ident ?? true) {
    writeFileSync(join(repoDir, IDENTIFICATION_FILE_NAME), formatIdentificationFile(APP_ID, PROJECT_ID));
  }
  const files = options.files ?? {
    "package.json": JSON.stringify({ name: "portal", dependencies: { moment: "2.30.1" } }),
    "src/index.ts": `import moment from "moment";\n${SOURCE_MARKER}\n`,
  };
  for (const [relative, content] of Object.entries(files)) {
    mkdirSync(dirname(join(repoDir, relative)), { recursive: true });
    writeFileSync(join(repoDir, relative), content);
  }
  if (options.commit ?? true) {
    git(repoDir, ["add", "."]);
    git(repoDir, ["commit", "-q", "-m", "initial"]);
    return { repoDir, head: git(repoDir, ["rev-parse", "HEAD"]) };
  }
  return { repoDir, head: "" };
}

interface Received {
  readonly method: string | undefined;
  readonly path: string | undefined;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

/** A stand-in Guidance server answering every Gate run with `answer` (status, JSON). */
async function fakeGuidance(status: number, answer: unknown): Promise<{ endpoint: string; received: Received[] }> {
  const received: Received[] = [];
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      received.push({ method: request.method, path: request.url, headers: request.headers, body: Buffer.concat(chunks).toString("utf8") });
      const text = JSON.stringify(answer);
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(text);
    });
  });
  await new Promise<void>((resolve) => {
    server?.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });
  return { endpoint: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/mcp`, received };
}

const FAIL_RESULT: GateRunResult = {
  kind: "fail",
  exitCode: 1,
  sentence: "fail",
  deviationLines: ["018f3d2a-7000-7000-8000-000000000132 code-stack/library/moment moment: use date-fns"],
};

describe("domain-harness gate --endpoint: argv", () => {
  it("selects the hosted mode only when --endpoint is present", () => {
    expect(isRemoteGateArgs(["gate", "--endpoint", "https://g.example/mcp"])).toBe(true);
    expect(isRemoteGateArgs(["gate", "--endpoint=https://g.example/mcp"])).toBe(true);
    expect(isRemoteGateArgs(["gate", "--bundle", "b.json"])).toBe(false);
    expect(isRemoteGateArgs(["bundle", "verify", "--endpoint", "x"])).toBe(false);
  });

  it("derives the Gate-run URL from the endpoint's origin", () => {
    expect(gateRunUrlOf("https://dh-guidance-staging.fly.dev/mcp")?.href).toBe(`https://dh-guidance-staging.fly.dev${GATE_RUN_PATH}`);
    expect(gateRunUrlOf("https://g.example")?.href).toBe(`https://g.example${GATE_RUN_PATH}`);
    expect(gateRunUrlOf("http://localhost:8080/mcp")?.href).toBe(`http://localhost:8080${GATE_RUN_PATH}`);
    expect(gateRunUrlOf("http://127.0.0.1:8080")?.href).toBe(`http://127.0.0.1:8080${GATE_RUN_PATH}`);
  });

  it("refuses clear-text non-loopback endpoints, credentials in the URL and non-URLs", () => {
    expect(gateRunUrlOf("http://g.example/mcp")).toBeNull();
    expect(gateRunUrlOf("https://user:pw@g.example/mcp")).toBeNull();
    expect(gateRunUrlOf("ftp://g.example")).toBeNull();
    expect(gateRunUrlOf("g.example")).toBeNull();
  });

  it("accepts only --endpoint and --root; the offline flags are usage defects", () => {
    expect(parseRemoteGateArgs(["gate", "--endpoint", "https://g.example/mcp", "--root", "/r"])).toMatchObject({ root: "/r" });
    expect(parseRemoteGateArgs(["gate", "--endpoint=https://g.example/mcp", "--root=/r"])).toMatchObject({ root: "/r" });
    expect(parseRemoteGateArgs(["gate", "--endpoint", "https://g.example/mcp", "--bundle", "b.json"])).toBeNull();
    expect(parseRemoteGateArgs(["gate", "--endpoint", "https://g.example/mcp", "--now", "2026-10-14T12:00:00.000Z"])).toBeNull();
    expect(parseRemoteGateArgs(["gate", "--endpoint"])).toBeNull();
    expect(parseRemoteGateArgs(["gate", "--endpoint", "http://g.example/mcp"])).toBeNull();
  });
});

describe("domain-harness gate --endpoint: one hosted run", () => {
  it("sends the SHA, the facts and the bridge's identity headers, then prints the server's answer", async () => {
    const { repoDir, head } = createRepo();
    const { endpoint, received } = await fakeGuidance(200, FAIL_RESULT);
    const result = await runRemoteGateCommand(["gate", "--endpoint", endpoint, "--root", repoDir], { env: { [GUIDANCE_TOKEN_ENV]: TOKEN } });

    expect(result).toEqual({ exitCode: 1, lines: [FAIL_RESULT.sentence, ...FAIL_RESULT.deviationLines] });
    expect(received).toHaveLength(1);
    const sent = received[0];
    expect(sent?.method).toBe("POST");
    expect(sent?.path).toBe(GATE_RUN_PATH);
    expect(sent?.headers["authorization"]).toBe(`Bearer ${TOKEN}`);
    expect(sent?.headers["content-type"]).toBe("application/json");
    expect(sent?.headers["x-dh-application-id"]).toBe(APP_ID);
    expect(sent?.headers["x-dh-advisory-project-id"]).toBe(PROJECT_ID);
    const fingerprint = computeLocalFingerprint(repoDir);
    expect(fingerprint.ok && sent?.headers["x-dh-repo-fingerprint"] === fingerprint.fingerprint).toBe(true);

    const body = JSON.parse(sent?.body ?? "null") as unknown;
    expect(isGateRunRequest(body)).toBe(true);
    expect(body).toMatchObject({ revision: head, facts: { dependencies: [{ name: "moment", version: "2.30.1" }] } });
    // Facts only: no file contents and no file paths leave the machine.
    expect(sent?.body).not.toContain(SOURCE_MARKER);
    expect(sent?.body).not.toContain("src/index.ts");
  });

  it("passes with exit 0 and sends no Authorization header when no token is set", async () => {
    const { repoDir } = createRepo();
    const { endpoint, received } = await fakeGuidance(200, { kind: "pass", exitCode: 0, sentence: "pass", deviationLines: [] });
    const result = await runRemoteGateCommand(["gate", "--endpoint", endpoint, "--root", repoDir], { env: {} });
    expect(result).toEqual({ exitCode: 0, lines: ["pass"] });
    expect(received[0]?.headers["authorization"]).toBeUndefined();
  });

  it("prints a server refusal verbatim", async () => {
    const { repoDir } = createRepo();
    const { endpoint } = await fakeGuidance(200, { kind: "refusal", exitCode: 1, sentence: "duplicate Application id", deviationLines: [] });
    expect(await runRemoteGateCommand(["gate", "--endpoint", endpoint, "--root", repoDir], { env: {} })).toEqual({
      exitCode: 1,
      lines: ["duplicate Application id"],
    });
  });

  it("refuses locally, sending nothing, for a missing identification file, no commit or an unreadable file", async () => {
    const { endpoint, received } = await fakeGuidance(200, FAIL_RESULT);
    const noIdent = createRepo({ ident: false });
    expect(await runRemoteGateCommand(["gate", "--endpoint", endpoint, "--root", noIdent.repoDir], { env: {} })).toEqual({
      exitCode: 1,
      lines: [MISSING_IDENTIFICATION_FILE],
    });
    const noCommit = createRepo({ commit: false });
    expect(await runRemoteGateCommand(["gate", "--endpoint", endpoint, "--root", noCommit.repoDir], { env: {} })).toEqual({
      exitCode: 1,
      lines: [UNBOUND],
    });
    const brokenManifest = createRepo({ files: { "package.json": "{ not json" } });
    expect(await runRemoteGateCommand(["gate", "--endpoint", endpoint, "--root", brokenManifest.repoDir], { env: {} })).toEqual({
      exitCode: 1,
      lines: [RUN_DID_NOT_COMPLETE],
    });
    const unreadableOnDisk = await runRemoteGateCommand(["gate", "--endpoint", endpoint, "--root", "/r"], {
      env: {},
      collectRevisionFiles: () => ({
        ok: true,
        applicationId: APP_ID,
        fingerprint: "1".repeat(64),
        files: {},
        unreadable: [{ path: "secret/plan.md", reason: "could not read file" }],
      }),
      readRevision: () => "a".repeat(40),
    });
    expect(unreadableOnDisk).toEqual({ exitCode: 1, lines: [RUN_DID_NOT_COMPLETE] });
    expect(received).toHaveLength(0);
  });

  it("reports a refused token on stderr without printing it", async () => {
    const { repoDir } = createRepo();
    const { endpoint } = await fakeGuidance(401, { code: "session_invalid", message: "the Guidance access token is not valid", subject: "session" });
    const result = await runRemoteGateCommand(["gate", "--endpoint", endpoint, "--root", repoDir], { env: { [GUIDANCE_TOKEN_ENV]: TOKEN } });
    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual([RUN_DID_NOT_COMPLETE]);
    expect(result.diagnostics).toEqual([`the Guidance server refused the access token; set ${GUIDANCE_TOKEN_ENV}`]);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("reports other server answers by status and envelope code", async () => {
    const { repoDir } = createRepo();
    const { endpoint } = await fakeGuidance(413, { code: "payload_too_large", message: "x", subject: "body" });
    const result = await runRemoteGateCommand(["gate", "--endpoint", endpoint, "--root", repoDir], { env: {} });
    expect(result).toEqual({ exitCode: 1, lines: [RUN_DID_NOT_COMPLETE], diagnostics: ["the Guidance server answered 413 payload_too_large"] });
  });

  it("treats a malformed 200 answer as a run that did not complete", async () => {
    const { repoDir } = createRepo();
    const { endpoint } = await fakeGuidance(200, { kind: "pass", exitCode: 1, sentence: "pass", deviationLines: [] });
    const result = await runRemoteGateCommand(["gate", "--endpoint", endpoint, "--root", repoDir], { env: {} });
    expect(result).toEqual({ exitCode: 1, lines: [RUN_DID_NOT_COMPLETE], diagnostics: ["the Guidance server answered 200"] });
  });

  it("reports an unreachable server", async () => {
    const { repoDir } = createRepo();
    const result = await runRemoteGateCommand(["gate", "--endpoint", "http://127.0.0.1:1/mcp", "--root", repoDir], { env: {} });
    expect(result).toEqual({ exitCode: 1, lines: [RUN_DID_NOT_COMPLETE], diagnostics: ["could not reach the Guidance server at http://127.0.0.1:1"] });
  });

  it("is dispatched by runCli, diagnostics included", async () => {
    const result = await runCli(["gate", "--endpoint", "http://g.example/mcp"]);
    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual([RUN_DID_NOT_COMPLETE]);
    expect(result.diagnostics).toEqual(["usage: domain-harness gate --endpoint <https-url> [--root <dir>]"]);
  });
});
