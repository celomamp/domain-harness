// Spawn-style suite for the Guidance server entry (Story 4.4): with a bad
// SERVICE_TENANT_ID, exactly one parseable envelope on stderr, exit code 1
// and nothing on stdout — no database needed, in the bundles daemon's
// service-cli suite style.
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);
const CLI_PATH = path.resolve(import.meta.dirname, "./server-cli.ts");
const TENANT = "018f3d2a-7000-7000-8000-000000000100";

function entryEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    SERVICE_TENANT_ID: TENANT,
    SERVICE_RECORD_DATABASE_URL: "postgres://postgres:postgres@localhost/dh_never_used",
    ...overrides,
  };
}

describe("guidance server-cli: start failure", () => {
  it("prints exactly one parseable envelope on stderr for a bad tenant id, exits 1 and writes nothing to stdout", async () => {
    try {
      await run(process.execPath, [CLI_PATH], { env: entryEnv({ SERVICE_TENANT_ID: "not-a-uuid" }) });
      throw new Error("the guidance server entry did not exit 1");
    } catch (error) {
      const failure = error as { code?: number; stdout?: string; stderr?: string };
      expect(failure.code).toBe(1);
      const lines = (failure.stderr ?? "").split("\n").filter((line) => line.trim() !== "");
      expect(lines).toHaveLength(1);
      const envelopeLine = lines[0];
      if (envelopeLine === undefined) {
        throw new Error("stderr carried no line", { cause: error });
      }
      const envelope = JSON.parse(envelopeLine) as { code?: unknown; message?: unknown; subject?: unknown };
      expect(envelope.code).toBe("invalid_configuration");
      expect(envelope.subject).toBe("SERVICE_TENANT_ID");
      expect(typeof envelope.message === "string" && envelope.message.length > 0).toBe(true);
      expect(failure.stdout ?? "").toBe("");
    }
  }, 60_000);

  it("reports a missing variable as missing_configuration", async () => {
    try {
      await run(process.execPath, [CLI_PATH], { env: entryEnv({ SERVICE_RECORD_DATABASE_URL: undefined }) });
      throw new Error("the guidance server entry did not exit 1");
    } catch (error) {
      const failure = error as { code?: number; stdout?: string; stderr?: string };
      expect(failure.code).toBe(1);
      const lines = (failure.stderr ?? "").split("\n").filter((line) => line.trim() !== "");
      expect(lines).toHaveLength(1);
      const envelope = JSON.parse(lines[0] ?? "") as { code?: unknown; subject?: unknown };
      expect(envelope.code).toBe("missing_configuration");
      expect(envelope.subject).toBe("SERVICE_RECORD_DATABASE_URL");
      expect(failure.stdout ?? "").toBe("");
    }
  }, 60_000);
});
