import { describe, expect, it } from "vitest";
import { EXTRACTOR_VERSION, FACT_SCHEMA_MAJOR, FACT_SCHEMA_VERSION } from "@domain-harness/contract";
import { extractRevisionFacts, packageName } from "./index.ts";

describe("@domain-harness/extractor", () => {
  it("exposes its workspace name", () => {
    expect(packageName).toBe("@domain-harness/extractor");
  });

  it("produces sorted dependency facts from a manifest and lockfile", () => {
    const files = {
      "package.json": JSON.stringify({
        dependencies: {
          react: "^18.0.0",
          "@scope/shared": "workspace:*",
        },
        devDependencies: {
          typescript: "^5.0.0",
        },
      }),
      "pnpm-lock.yaml": [
        "lockfileVersion: '9.0'",
        "",
        "importers:",
        "  .:",
        "    dependencies:",
        "      '@scope/shared':",
        "        specifier: workspace:*",
        "        version: link:../shared",
        "      react:",
        "        specifier: ^18.0.0",
        "        version: 18.2.0",
        "    devDependencies:",
        "      typescript:",
        "        specifier: ^5.0.0",
        "        version: 5.1.6",
      ].join("\n"),
    };

    const result = extractRevisionFacts(files);

    expect(result.extractorVersion).toBe(EXTRACTOR_VERSION);
    expect(result.schemaVersion).toBe(FACT_SCHEMA_VERSION);
    expect(result.schemaMajor).toBe(FACT_SCHEMA_MAJOR);
    expect(result.dependencies).toEqual([
      { name: "@scope/shared", version: "link:../shared" },
      { name: "react", version: "18.2.0" },
      { name: "typescript", version: "5.1.6" },
    ]);
  });

  it("falls back to manifest versions when no lockfile is present", () => {
    const files = {
      "package.json": JSON.stringify({
        dependencies: { zod: "^3.0.0", alpha: "^1.0.0" },
      }),
    };

    const result = extractRevisionFacts(files);

    expect(result.dependencies).toEqual([
      { name: "alpha", version: "^1.0.0" },
      { name: "zod", version: "^3.0.0" },
    ]);
  });

  it("produces sorted import facts from TypeScript and JavaScript files", () => {
    const files = {
      "src/Button.tsx": [
        "import React from 'react';",
        "import { clsx } from 'clsx';",
        "import './Button.css';",
        "export * from './types';",
        "const helper = require('../helper');",
      ].join("\n"),
      "src/app.ts": [
        "import { dynamic } from './dynamic';",
        "const mod = import('./lazy');",
        "// import ignored from 'comment';",
        "/* import ignored2 from 'block'; */",
      ].join("\n"),
    };

    const result = extractRevisionFacts(files);

    expect(result.imports).toEqual([
      { specifier: "../helper" },
      { specifier: "./Button.css" },
      { specifier: "./dynamic" },
      { specifier: "./lazy" },
      { specifier: "./types" },
      { specifier: "clsx" },
      { specifier: "react" },
    ]);
  });

  it("does not emit imports from inside strings or comments", () => {
    const files = {
      "src/a.ts": [
        `const s = "import foo from 'bar';";`,
        `const t = 'import baz from "qux";';`,
        "// import ignored from 'comment';",
        "/* import ignored2 from 'block'; */",
        `import real from 'real';`,
      ].join("\n"),
    };

    expect(extractRevisionFacts(files).imports).toEqual([{ specifier: "real" }]);
  });

  it("produces sorted token facts from CSS files", () => {
    const files = {
      "src/theme.css": [
        ":root {",
        "  --color-primary: #007bff;",
        "  --spacing-md: 1rem;",
        "}",
        ".button { color: var(--color-primary); margin: var(--spacing-md); }",
      ].join("\n"),
    };

    const result = extractRevisionFacts(files);

    expect(result.tokens).toEqual([{ name: "--color-primary" }, { name: "--spacing-md" }]);
  });

  it("extracts tokens from var() with fallbacks and ignores comments/strings", () => {
    const files = {
      "src/theme.css": [
        "/* --ignored-comment: red; */",
        ":root { --color-primary: #007bff; }",
        ".x { color: var(--color-primary, #000); border: var(--spacing-md); }",
        '.y { content: "--not-a-token"; }',
      ].join("\n"),
    };

    expect(extractRevisionFacts(files).tokens).toEqual([{ name: "--color-primary" }, { name: "--spacing-md" }]);
  });

  it("reports malformed JSON and YAML as unreadable without throwing", () => {
    const files = {
      "package.json": "{ not json",
      "pnpm-lock.yaml": "importers: [unclosed",
    };

    const result = extractRevisionFacts(files);

    expect(result.unreadable).toHaveLength(2);
    expect(result.unreadable[0]).toEqual({ path: "package.json", reason: "package.json is not valid JSON" });
    const second = result.unreadable[1];
    expect(second).toBeDefined();
    if (!second) return;
    expect(second.path).toBe("pnpm-lock.yaml");
    expect(typeof second.reason).toBe("string");
    expect(second.reason.length).toBeGreaterThan(0);
    expect(result.dependencies).toEqual([]);
  });

  it("returns byte-identical output regardless of input key order", () => {
    const filesA = {
      "src/a.ts": "import 'z';\nimport 'a';",
      "src/b.css": ".x { --token-b: 1; --token-a: 2; }",
    };
    const filesB = {
      "src/b.css": ".x { --token-b: 1; --token-a: 2; }",
      "src/a.ts": "import 'z';\nimport 'a';",
    };

    const resultA = extractRevisionFacts(filesA);
    const resultB = extractRevisionFacts(filesB);

    expect(JSON.stringify(resultA)).toBe(JSON.stringify(resultB));
  });

  it("deduplicates repeated facts", () => {
    const files = {
      "a/package.json": JSON.stringify({ dependencies: { lodash: "^4.0.0" } }),
      "b/package.json": JSON.stringify({ dependencies: { lodash: "^4.0.0" } }),
      "src/a.ts": "import 'react';\nimport 'react';",
      "src/b.ts": "import 'react';",
      "src/a.css": ".a { --x: 1; }",
      "src/b.css": ".b { --x: 2; }",
    };

    const result = extractRevisionFacts(files);

    expect(result.dependencies).toEqual([{ name: "lodash", version: "^4.0.0" }]);
    expect(result.imports).toEqual([{ specifier: "react" }]);
    expect(result.tokens).toEqual([{ name: "--x" }]);
  });

  it("collects all name/version pairs from multiple manifests", () => {
    const files = {
      "a/package.json": JSON.stringify({ dependencies: { lodash: "^4.0.0" } }),
      "b/package.json": JSON.stringify({ dependencies: { lodash: "^4.17.0" } }),
    };

    expect(extractRevisionFacts(files).dependencies).toEqual([
      { name: "lodash", version: "^4.0.0" },
      { name: "lodash", version: "^4.17.0" },
    ]);
  });

  it("marks a manifest unreadable when a dependency version is not a string", () => {
    const files = {
      "package.json": JSON.stringify({ dependencies: { lodash: 42 } }),
    };

    const result = extractRevisionFacts(files);

    expect(result.unreadable).toEqual([
      { path: "package.json", reason: "package.json dependency version must be a string" },
    ]);
    expect(result.dependencies).toEqual([]);
  });

  it("extracts peerDependencies from pnpm-lock.yaml", () => {
    const files = {
      "pnpm-lock.yaml": [
        "lockfileVersion: '9.0'",
        "",
        "importers:",
        "  .:",
        "    peerDependencies:",
        "      react:",
        "        specifier: ^18.0.0",
        "        version: 18.2.0",
      ].join("\n"),
    };

    expect(extractRevisionFacts(files).dependencies).toEqual([{ name: "react", version: "18.2.0" }]);
  });

  it("recognises additional JavaScript/TypeScript extensions", () => {
    const files = {
      "a.mjs": "import 'mjs';",
      "b.cjs": "require('cjs');",
      "c.mts": "import 'mts';",
      "d.cts": "import 'cts';",
    };

    expect(extractRevisionFacts(files).imports).toEqual([
      { specifier: "cjs" },
      { specifier: "cts" },
      { specifier: "mjs" },
      { specifier: "mts" },
    ]);
  });

  it("marks lockfiles with unsupported YAML constructs as unreadable", () => {
    const blockScalar = [
      "lockfileVersion: '9.0'",
      "importers:",
      "  .:",
      "    script: |",
      "      echo hello",
    ].join("\n");
    const anchor = [
      "lockfileVersion: '9.0'",
      "importers:",
      "  .:",
      "    dep: &anchor",
      "      version: 1.0.0",
    ].join("\n");

    const blockResult = extractRevisionFacts({ "pnpm-lock.yaml": blockScalar });
    const anchorResult = extractRevisionFacts({ "pnpm-lock.yaml": anchor });

    expect(blockResult.unreadable).toHaveLength(1);
    expect(blockResult.unreadable[0]?.path).toBe("pnpm-lock.yaml");
    expect(anchorResult.unreadable).toHaveLength(1);
    expect(anchorResult.unreadable[0]?.path).toBe("pnpm-lock.yaml");
  });

  it("ignores unsupported lockfiles without crashing", () => {
    const files = {
      "yarn.lock": "# THIS IS AN AUTOGENERATED FILE\nlodash@^4.0.0:\n  version \"4.17.21\"",
      "package.json": JSON.stringify({ dependencies: { lodash: "^4.0.0" } }),
    };

    const result = extractRevisionFacts(files);

    expect(result.unreadable).toEqual([]);
    expect(result.dependencies).toEqual([{ name: "lodash", version: "^4.0.0" }]);
  });
});
