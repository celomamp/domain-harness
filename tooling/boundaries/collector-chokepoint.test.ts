import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { formatChokepointFinding, scanOutboundPushPaths } from "./collector-chokepoint.ts";

const repoRoot = resolve(import.meta.dirname, "../..");

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Mirror of boundaries.test.ts: build a tree at test time (node_modules-free, no fixtures). */
function tempTree(files: Readonly<Record<string, string>>): string {
  // realpath: on macOS the temp dir sits behind a /var -> /private/var symlink.
  const root = realpathSync(mkdtempSync(join(tmpdir(), "dh-chokepoint-")));
  tempDirs.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

const offender = [
  'import { COMPILATION_API_PATHS } from "@domain-harness/contract";',
  "export async function rogue(baseUrl: string, body: unknown): Promise<void> {",
  "  await fetch(`${baseUrl}${COMPILATION_API_PATHS.compilations}`, { method: \"POST\", body: JSON.stringify(body) });",
  "}",
  "",
].join("\n");

describe("collector chokepoint scan on the real workspace", () => {
  it(
    "passes: only packages/collector holds a panel-push path",
    () => {
      expect(scanOutboundPushPaths(repoRoot)).toEqual([]);
    },
    30_000,
  );
});

describe("collector chokepoint scan on generated trees", () => {
  it("fails on a planted offender outside the collector, naming the file and line", () => {
    const root = tempTree({ "apps/service/src/rogue/push.ts": offender });
    const findings = scanOutboundPushPaths(root);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.file).toBe("apps/service/src/rogue/push.ts");
    expect(findings[0]?.line).toBe(3);
    expect(formatChokepointFinding(findings[0] ?? { file: "", line: 0, detail: "" })).toContain(
      "apps/service/src/rogue/push.ts:3",
    );
  });

  it("ignores the same path inside the collector, catalog reads, tests and the bundle puller", () => {
    const root = tempTree({
      "packages/collector/src/push.ts": offender,
      "apps/panel/src/registry.server.ts": [
        'import { COMPILATION_API_PATHS } from "@domain-harness/contract";',
        "export async function read(baseUrl: string): Promise<void> {",
        "  await fetch(`${baseUrl}${COMPILATION_API_PATHS.catalogReads}`, { method: \"GET\" });",
        "}",
        "",
      ].join("\n"),
      "apps/service/src/bundles/puller.ts": offender,
      "apps/service/src/rogue/push.test.ts": offender,
      "apps/service/src/fixtures/offender.ts": offender,
    });
    expect(scanOutboundPushPaths(root)).toEqual([]);
  });
});
