// I/O matrix edge-case tests for the `pnpm local:*` helpers (offline: no
// Docker, no network, no database). Pins the fail-closed behavior from the
// spec: missing Docker, missing URL, and CI-without-URL.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  dockerDownMessage,
  isCi,
  mailChoiceError,
  missingTestUrls,
  plainTestOutcome,
  serviceCredentialRefusal,
} from "./env.ts";

const HERE = import.meta.dirname;

function readShell(name: string): string {
  return readFileSync(join(HERE, name), "utf8");
}

describe("CI rule (matches every db suite)", () => {
  it.each([
    ["unset", {}, false],
    ["blank", { CI: "" }, false],
    ["false", { CI: "false" }, false],
    ["set", { CI: "1" }, true],
    ["true", { CI: "true" }, true],
  ])("CI %s -> isCi %s", (_label, env, expected) => {
    expect(isCi(env)).toBe(expected);
  });
});

describe("plain `pnpm test` without DB URLs", () => {
  it("skips with reasons when no URLs and no CI", () => {
    expect(missingTestUrls({})).toEqual(["REGISTRY_TEST_DATABASE_URL", "SERVICE_TEST_DATABASE_URL"]);
    expect(plainTestOutcome({})).toEqual({ run: "skip" });
  });

  it("fails when CI is set without URLs, as today", () => {
    expect(plainTestOutcome({ CI: "1" })).toEqual({ run: "fail" });
    expect(plainTestOutcome({ CI: "true" })).toEqual({ run: "fail" });
  });

  it("runs the DB suites when both URLs are set", () => {
    const env = { REGISTRY_TEST_DATABASE_URL: "postgres://localhost/x", SERVICE_TEST_DATABASE_URL: "postgres://localhost/x" };
    expect(missingTestUrls(env)).toEqual([]);
    expect(plainTestOutcome(env)).toEqual({ run: "run" });
  });

  it("blank URLs count as missing", () => {
    expect(missingTestUrls({ REGISTRY_TEST_DATABASE_URL: " ", SERVICE_TEST_DATABASE_URL: "" })).toEqual([
      "REGISTRY_TEST_DATABASE_URL",
      "SERVICE_TEST_DATABASE_URL",
    ]);
  });
});

describe("missing Docker", () => {
  it("is one sentence naming Docker", () => {
    const message = dockerDownMessage("local:up");
    expect(message).toContain("Docker");
    expect(message.trim().split("\n")).toHaveLength(1);
    expect(message).toMatch(/local:up/);
  });

  it("local-up and local-test refuse when Docker is down", () => {
    for (const script of ["local-up.sh", "local-test.sh"]) {
      const body = readShell(script);
      expect(body).toContain("docker info");
      expect(body).toContain("exit 1");
      expect(body).toContain("Docker");
    }
  });
});

describe("missing URL", () => {
  it("serve refuses with one sentence when neither SMTP nor the outbox is set", () => {
    const message = mailChoiceError({});
    expect(message).not.toBeNull();
    expect(String(message).trim().split("\n")).toHaveLength(1);
    expect(message).toContain("REGISTRY_SMTP_URL");
    expect(message).toContain("REGISTRY_MAIL_OUTBOX_DIR");
  });

  it("serve refuses when both SMTP and the outbox are set", () => {
    expect(mailChoiceError({ REGISTRY_SMTP_URL: "smtp://x", REGISTRY_MAIL_OUTBOX_DIR: "./.outbox" })).not.toBeNull();
  });

  it("serve accepts exactly one mail choice", () => {
    expect(mailChoiceError({ REGISTRY_MAIL_OUTBOX_DIR: "./.outbox" })).toBeNull();
    expect(mailChoiceError({ REGISTRY_SMTP_URL: "smtp://x" })).toBeNull();
  });

  it("blank counts as unset", () => {
    expect(mailChoiceError({ REGISTRY_SMTP_URL: " ", REGISTRY_MAIL_OUTBOX_DIR: "" })).not.toBeNull();
  });

  it("the serve wrapper passes explicit empties through so the registry still refuses", () => {
    const body = readShell("local-serve-registry.sh");
    // `:-` fallbacks without assignment: unset takes the local default,
    // explicit empty stays empty.
    expect(body).toMatch(/REGISTRY_MAIL_OUTBOX_DIR=[^:]/);
  });

  it("the serve wrapper generates the dev signing key outside the repo when unset, never using a committed key", () => {
    const body = readShell("local-serve-registry.sh");
    expect(body).toContain("registry-signing-key.pem");
    expect(body).toContain("$HOME/.domain-harness");
  });
});

describe("service placeholders never start", () => {
  it("refuses the placeholder credential with one sentence", () => {
    const message = serviceCredentialRefusal({
      SERVICE_TENANT_CREDENTIAL: "replace-with-your-tenant-service-credential",
    });
    expect(message).not.toBeNull();
    expect(String(message).trim().split("\n")).toHaveLength(1);
    expect(message).toContain("SERVICE_TENANT_CREDENTIAL");
  });

  it("refuses the placeholder trust set with one sentence", () => {
    const message = serviceCredentialRefusal({
      SERVICE_TENANT_CREDENTIAL: "real-credential",
      SERVICE_BUNDLE_TRUST_KEYS: "replace-with-your-json-trust-set",
    });
    expect(message).not.toBeNull();
    expect(String(message)).toContain("SERVICE_BUNDLE_TRUST_KEYS");
  });

  it("accepts provided values and defers empties to the daemon envelope", () => {
    expect(
      serviceCredentialRefusal({ SERVICE_TENANT_CREDENTIAL: "cred", SERVICE_BUNDLE_TRUST_KEYS: '{"k": "v"}' }),
    ).toBeNull();
    expect(serviceCredentialRefusal({})).toBeNull();
  });

  it("compose fails fast with one sentence instead of starting on placeholders", () => {
    const compose = readFileSync(join(HERE, "..", "..", "apps", "service", "compose.yaml"), "utf8");
    expect(compose).toContain("SERVICE_TENANT_CREDENTIAL: ${SERVICE_TENANT_CREDENTIAL:?");
    expect(compose).toContain("SERVICE_BUNDLE_TRUST_KEYS: ${SERVICE_BUNDLE_TRUST_KEYS:?");
    expect(compose).not.toContain("replace-with-your-tenant-service-credential");
    expect(compose).not.toContain("replace-with-your-json-trust-set");
  });
});

describe("no committed secrets (registry tripwire)", () => {
  const PRIVATE_KEY_MARKER = /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY(?: BLOCK)?-----/;

  it("no helper, default, or example file carries private key material", () => {
    for (const name of readdirSync(HERE)) {
      if (name === ".local") continue;
      const full = join(HERE, name);
      try {
        if (!statSync(full).isFile()) continue;
      } catch {
        continue;
      }
      expect(readFileSync(full, "utf8"), name).not.toMatch(PRIVATE_KEY_MARKER);
    }
    const example = readFileSync(join(HERE, "..", "..", ".env.local.example"), "utf8");
    expect(example).not.toMatch(PRIVATE_KEY_MARKER);
  });

  it("the dev key lives gitignored under .local and the example explains generation", () => {
    const gitignore = readFileSync(join(HERE, "..", "..", ".gitignore"), "utf8");
    expect(gitignore).toContain(".local");
    const example = readFileSync(join(HERE, "..", "..", ".env.local.example"), "utf8");
    expect(example).toContain("pnpm local:keys");
  });
});

describe("defaults stay in one place", () => {
  it("every shell default has a documented variable in .env.local.example", () => {
    const defaults = readShell("defaults.sh");
    const example = readFileSync(join(HERE, "..", "..", ".env.local.example"), "utf8");
    const names = [...defaults.matchAll(/:\s*"\$\{([A-Z][A-Z0-9_]*)=/g)].map((m) => m[1] ?? "");
    expect(names.length).toBeGreaterThan(10);
    for (const name of names) {
      expect(example, name).toContain(`${name}=`);
    }
  });
});

describe("script execution (offline, stubbed)", () => {
  const ROOT = join(HERE, "..", "..");

  function cleanEnv(overrides: Record<string, string | undefined>): Record<string, string> {
    const dropped = new Set(
      Object.entries(overrides)
        .filter(([, v]) => v === undefined)
        .map(([k]) => k),
    );
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined && !dropped.has(k)) out[k] = v;
    }
    for (const [k, v] of Object.entries(overrides)) {
      if (v !== undefined) out[k] = v;
    }
    return out;
  }

  function run(
    script: string,
    args: string[],
    env: Record<string, string | undefined>,
    extraPath?: string,
  ): { status: number; stdout: string; stderr: string } {
    const fullEnv = cleanEnv(env);
    if (extraPath) fullEnv["PATH"] = `${extraPath}:${process.env["PATH"] ?? ""}`;
    try {
      const stdout: string = execFileSync("sh", [join(HERE, script), ...args], {
        cwd: ROOT,
        env: fullEnv,
        encoding: "utf8",
        timeout: 15000,
      });
      return { status: 0, stdout, stderr: "" };
    } catch (err: unknown) {
      if (err !== null && typeof err === "object" && "status" in err) {
        const e = err as { status?: unknown; stdout?: unknown; stderr?: unknown };
        return {
          status: typeof e.status === "number" ? e.status : 1,
          stdout: typeof e.stdout === "string" ? e.stdout : "",
          stderr: typeof e.stderr === "string" ? e.stderr : "",
        };
      }
      throw err;
    }
  }

  function stubBin(stubs: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), "local-env-stub-"));
    for (const [name, body] of Object.entries(stubs)) {
      writeFileSync(join(dir, name), body, { mode: 0o755 });
    }
    return dir;
  }

  const FAILING_DOCKER = "#!/bin/sh\nexit 1\n";

  it("local-up refuses with one sentence when Docker is down", () => {
    const bin = stubBin({ docker: FAILING_DOCKER });
    const r = run("local-up.sh", [], {}, bin);
    expect(r.status).toBe(1);
    expect(r.stderr.trim().split("\n")).toHaveLength(1);
    expect(r.stderr).toContain("Docker");
  });

  it("local-test refuses with one sentence when Docker is down", () => {
    const bin = stubBin({ docker: FAILING_DOCKER });
    const r = run("local-test.sh", [], {}, bin);
    expect(r.status).toBe(1);
    expect(r.stderr.trim().split("\n")).toHaveLength(1);
    expect(r.stderr).toContain("Docker");
  });

  it("local-up rejects extra arguments before touching Docker", () => {
    const r = run("local-up.sh", ["a.json", "b.json"], {}, undefined);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("usage");
  });

  it("local-provision requires exactly one argument", () => {
    expect(run("local-provision.sh", [], {}, undefined).status).toBe(1);
    const r = run("local-provision.sh", ["a.json", "b.json"], {}, undefined);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("usage");
  });

  it("defaults.sh applies defaults when unset and preserves explicit empties", () => {
    const probe = '. tooling/local/defaults.sh; printf "%s|%s" "$REGISTRY_MAIL_OUTBOX_DIR" "$SERVICE_TENANT_ID"';
    const unset: string = execFileSync("sh", ["-c", probe], {
      cwd: ROOT,
      env: cleanEnv({ REGISTRY_MAIL_OUTBOX_DIR: undefined, SERVICE_TENANT_ID: undefined }),
      encoding: "utf8",
      timeout: 15000,
    });
    expect(unset).toBe("./.outbox|018f3d2a-7000-7000-8000-000000000100");
    const empty: string = execFileSync("sh", ["-c", probe], {
      cwd: ROOT,
      env: cleanEnv({ REGISTRY_MAIL_OUTBOX_DIR: "", SERVICE_TENANT_ID: undefined }),
      encoding: "utf8",
      timeout: 15000,
    });
    expect(empty).toBe("|018f3d2a-7000-7000-8000-000000000100");
  });

  it("serve-registry generates the dev key when unset and passes empties through", () => {
    const home = mkdtempSync(join(tmpdir(), "local-env-home-"));
    const capture = join(home, "captured-key.txt");
    const bin = stubBin({
      pnpm: `#!/bin/sh\nprintf 'key=<%s>\\n' "$REGISTRY_BUNDLE_SIGNING_KEY" > "${capture}"\nexit 0\n`,
    });
    const r = run("local-serve-registry.sh", [], { REGISTRY_BUNDLE_SIGNING_KEY: undefined, HOME: home }, bin);
    expect(r.status).toBe(0);
    const generated = readFileSync(join(home, ".domain-harness", "registry-signing-key.pem"), "utf8");
    expect(generated).toContain("PRIVATE KEY");
    const received = readFileSync(capture, "utf8");
    expect(received).toContain("PRIVATE KEY");
    expect(received).not.toContain("\\n");
  });

  it("serve-registry passes an explicitly empty key through so the registry refuses", () => {
    const home = mkdtempSync(join(tmpdir(), "local-env-home-"));
    const capture = join(home, "captured-key.txt");
    const bin = stubBin({
      pnpm: `#!/bin/sh\nprintf 'key=<%s>\\n' "$REGISTRY_BUNDLE_SIGNING_KEY" > "${capture}"\nexit 0\n`,
    });
    const r = run("local-serve-registry.sh", [], { REGISTRY_BUNDLE_SIGNING_KEY: "", HOME: home }, bin);
    expect(r.status).toBe(0);
    expect(readFileSync(capture, "utf8")).toBe("key=<>\n");
  });

  it("serve-registry unescapes literal backslash-n in a pasted key", () => {
    const home = mkdtempSync(join(tmpdir(), "local-env-home-"));
    const capture = join(home, "captured-key.txt");
    const bin = stubBin({
      pnpm: `#!/bin/sh\nprintf 'key=<%s>\\n' "$REGISTRY_BUNDLE_SIGNING_KEY" > "${capture}"\nexit 0\n`,
    });
    const r = run("local-serve-registry.sh", [], { REGISTRY_BUNDLE_SIGNING_KEY: "line1\\nline2", HOME: home }, bin);
    expect(r.status).toBe(0);
    const received = readFileSync(capture, "utf8");
    expect(received).toContain("line1\nline2");
    expect(received).not.toContain("\\n");
  });

  it("guidance wrapper routes to the guidance server-cli with local defaults", () => {
    const body = readShell("local-serve-guidance.sh");
    expect(body).toContain("guidance/server-cli.ts");
    expect(body).toContain("--conditions=@domain-harness/source");
    expect(body).toContain("SERVICE_READ_CREDENTIAL");
    expect(body).toContain("SERVICE_GUIDANCE_PORT");
    const root = readFileSync(join(HERE, "..", "..", "package.json"), "utf8");
    expect(root).toContain('"local:guidance"');
  });
});
