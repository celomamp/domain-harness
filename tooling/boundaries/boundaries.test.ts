import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkBoundaries, formatViolation } from "./check.ts";
import type { BoundaryViolation } from "./check.ts";

const fixture = (name: string): string => resolve(import.meta.dirname, "fixtures", name);
const repoRoot = resolve(import.meta.dirname, "../..");

const lines = (violations: readonly BoundaryViolation[]): string[] => violations.map(formatViolation);

/**
 * Trees that need node_modules (symlinked workspace packages, npm packages)
 * are built at test time: node_modules is git-ignored, so it cannot be a fixture.
 */
const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempTree(files: Readonly<Record<string, string>>, links: Readonly<Record<string, string>> = {}): string {
  // realpath: on macOS the temp dir sits behind a /var -> /private/var symlink.
  const root = realpathSync(mkdtempSync(join(tmpdir(), "dh-boundaries-")));
  tempDirs.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  for (const [link, target] of Object.entries(links)) {
    mkdirSync(dirname(join(root, link)), { recursive: true });
    symlinkSync(join(root, target), join(root, link), "dir");
  }
  return root;
}

const npmPackage = (name: string): Record<string, string> => ({
  [`node_modules/${name}/package.json`]: JSON.stringify({ name, version: "1.0.0", main: "index.js" }),
  [`node_modules/${name}/index.js`]: "module.exports = 1;\n",
});

describe("boundary check on the real workspace", () => {
  it(
    "passes",
    async () => {
      expect(lines(await checkBoundaries(repoRoot))).toEqual([]);
    },
    60000,
  );
});

describe("boundary check on fixtures", () => {
  it("passes a tree that follows every rule", async () => {
    expect(lines(await checkBoundaries(fixture("clean")))).toEqual([]);
  });

  it("fails when core imports another workspace package, naming the file and import", async () => {
    expect(lines(await checkBoundaries(fixture("core-imports-collector")))).toEqual([
      'core-imports-only-contract: packages/core/src/index.ts imports "../../collector/src/index.ts" (resolves to packages/collector/src/index.ts)',
    ]);
  });

  it("fails when extractor imports another workspace package", async () => {
    expect(lines(await checkBoundaries(fixture("extractor-imports-collector")))).toEqual([
      'core-imports-only-contract: packages/extractor/src/index.ts imports "../../collector/src/index.ts" (resolves to packages/collector/src/index.ts)',
    ]);
  });

  it("fails when a core test imports anything beyond contract and vitest", async () => {
    expect(lines(await checkBoundaries(fixture("core-test-imports-collector")))).toEqual([
      'core-tests-import-only-contract: packages/core/src/index.test.ts imports "../../collector/src/index.ts" (resolves to packages/collector/src/index.ts)',
    ]);
  });

  it("fails on a dependency cycle", async () => {
    expect(lines(await checkBoundaries(fixture("core-circular")))).toContain(
      'no-circular: packages/core/src/a.ts imports "./b.ts" (resolves to packages/core/src/b.ts)',
    );
  });

  it("fails on a dependency cycle among contract files that are not the blessed pair", async () => {
    expect(lines(await checkBoundaries(fixture("contract-circular")))).toContain(
      'no-circular: packages/contract/src/a.ts imports "./b.ts" (resolves to packages/contract/src/b.ts)',
    );
  });

  it("fails when core imports a third-party package or a Node built-in", async () => {
    const found = lines(await checkBoundaries(fixture("core-imports-third-party")));
    expect(found).toContain('core-imports-only-contract: packages/core/src/index.ts imports "zod"');
    expect(found).toContain('core-imports-only-contract: packages/core/src/index.ts imports "fs"');
    expect(found).toContain('no-unresolvable-imports: packages/core/src/index.ts imports "zod"');
  });

  it("fails when the panel imports core, even type-only", async () => {
    expect(lines(await checkBoundaries(fixture("panel-imports-core")))).toEqual([
      'panel-imports-only-contract: apps/panel/src/index.ts imports "../../../packages/core/src/index.ts" (resolves to packages/core/src/index.ts)',
    ]);
  });

  it("fails when a panel .tsx source imports core", async () => {
    expect(lines(await checkBoundaries(fixture("panel-tsx-imports-core")))).toEqual([
      'panel-imports-only-contract: apps/panel/src/slot.tsx imports "../../../packages/core/src/index.ts" (resolves to packages/core/src/index.ts)',
    ]);
  });

  it("fails when the registry imports anything beyond core and contract", async () => {
    expect(lines(await checkBoundaries(fixture("registry-imports-extractor")))).toEqual([
      'registry-imports-only-core-and-contract: apps/registry/src/index.ts imports "../../../packages/extractor/src/index.ts" (resolves to packages/extractor/src/index.ts)',
    ]);
  });

  it("fails when a package imports an app", async () => {
    expect(lines(await checkBoundaries(fixture("package-imports-app")))).toEqual([
      'no-imports-from-apps: packages/collector/src/index.ts imports "../../../apps/service/src/index.ts" (resolves to apps/service/src/index.ts)',
    ]);
  });

  it("fails when an app imports another app", async () => {
    expect(lines(await checkBoundaries(fixture("app-imports-app")))).toEqual([
      'no-cross-app-imports: apps/cli/src/index.ts imports "../../service/src/index.ts" (resolves to apps/service/src/index.ts)',
    ]);
  });

  it("throws when none of the roots exist, instead of passing vacuously", async () => {
    await expect(checkBoundaries(fixture("no-such-fixture"))).rejects.toThrow(/no-such-fixture/);
  });
});

describe("boundary check on generated trees", () => {
  it("resolves a @domain-harness/* specifier through the workspace symlink and source condition", async () => {
    const root = tempTree(
      {
        "packages/core/package.json": JSON.stringify({
          name: "@domain-harness/core",
          exports: { ".": { "@domain-harness/source": "./src/index.ts", default: "./dist/index.js" } },
        }),
        "packages/core/src/index.ts": "export type Slot = string;\n",
        "apps/panel/package.json": JSON.stringify({
          name: "@domain-harness/panel",
          dependencies: { "@domain-harness/core": "workspace:*" },
        }),
        "apps/panel/src/index.ts": 'import type { Slot } from "@domain-harness/core";\nexport type PanelSlot = Slot;\n',
      },
      { "apps/panel/node_modules/@domain-harness/core": "packages/core" },
    );
    expect(lines(await checkBoundaries(root))).toEqual([
      'panel-imports-only-contract: apps/panel/src/index.ts imports "@domain-harness/core" (resolves to packages/core/src/index.ts)',
    ]);
  });

  it("fails when source imports an npm package its package.json does not declare", async () => {
    const root = tempTree({
      ...npmPackage("left-pad"),
      "package.json": JSON.stringify({ name: "root", private: true }),
      "apps/service/package.json": JSON.stringify({ name: "@domain-harness/service" }),
      "apps/service/src/index.ts": 'import pad from "left-pad";\nexport const uses = pad;\n',
    });
    expect(lines(await checkBoundaries(root))).toEqual([
      'no-undeclared-npm-dependencies: apps/service/src/index.ts imports "left-pad" (resolves to node_modules/left-pad/index.js)',
    ]);
  });

  it("fails when shipped source imports a devDependency, but not when a test does", async () => {
    const root = tempTree({
      ...npmPackage("left-pad"),
      "package.json": JSON.stringify({ name: "root", private: true }),
      "apps/service/package.json": JSON.stringify({
        name: "@domain-harness/service",
        devDependencies: { "left-pad": "1.0.0" },
      }),
      "apps/service/src/index.ts": 'import pad from "left-pad";\nexport const uses = pad;\n',
      "apps/service/src/index.test.ts": 'import pad from "left-pad";\nexport const uses = pad;\n',
    });
    expect(lines(await checkBoundaries(root))).toEqual([
      'no-dev-dependencies-in-src: apps/service/src/index.ts imports "left-pad" (resolves to node_modules/left-pad/index.js)',
    ]);
  });
});
