// Dependency-boundary rules from the architecture spine (AD-5 and the layer table).
// Run with `pnpm run boundaries`; tooling/boundaries/*.test.ts proves each rule fires.
// Paths are relative to the directory being checked (the repository root in CI).
// Unit rules govern source under src/; per-package tool config (eslint.config.js)
// may use the shared tooling packages.

/** Tests may also import their runner. */
const TEST_FILE = "\\.test\\.ts$";
const VITEST = "(^|/)node_modules/vitest/";

/** @type {import("dependency-cruiser").IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "core-imports-only-contract",
      comment:
        "packages/core and packages/extractor import nothing but @domain-harness/contract: no other workspace unit, no third-party package, no Node built-in.",
      severity: "error",
      from: { path: "^packages/(core|extractor)/src/", pathNot: TEST_FILE },
      to: { pathNot: ["^packages/contract/", "^packages/$1/"] },
    },
    {
      name: "core-tests-import-only-contract",
      comment: "Tests in packages/core and packages/extractor may add vitest, nothing else.",
      severity: "error",
      from: { path: "^packages/(core|extractor)/src/.+" + TEST_FILE },
      to: { pathNot: ["^packages/contract/", "^packages/$1/", VITEST] },
    },
    {
      name: "panel-imports-only-contract",
      comment: "apps/panel uses @domain-harness/contract and no other workspace unit.",
      severity: "error",
      from: { path: "^apps/panel/src/" },
      to: { path: "^(packages|apps|tooling)/", pathNot: ["^packages/contract/", "^apps/panel/"] },
    },
    {
      name: "registry-imports-only-core-and-contract",
      comment:
        "apps/registry uses @domain-harness/core (slot derivation, publication validation, Boilerplate resolution) and @domain-harness/contract only.",
      severity: "error",
      from: { path: "^apps/registry/src/" },
      to: { path: "^(packages|tooling)/", pathNot: ["^packages/(core|contract)/"] },
    },
    {
      name: "no-imports-from-apps",
      comment: "Nothing imports from apps/*: apps are leaves.",
      severity: "error",
      from: { path: "^(packages|tooling)/" },
      to: { path: "^apps/" },
    },
    {
      name: "no-cross-app-imports",
      comment: "An app never imports another app.",
      severity: "error",
      from: { path: "^apps/([^/]+)/" },
      to: { path: "^apps/", pathNot: "^apps/$1/" },
    },
    {
      name: "no-unresolvable-imports",
      comment: "Every import resolves; an undeclared workspace or npm dependency does not under pnpm.",
      severity: "error",
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: "no-undeclared-npm-dependencies",
      comment: "npm packages are imported only when declared in the importing unit's package.json.",
      severity: "error",
      from: {},
      to: { dependencyTypes: ["npm-no-pkg", "npm-unknown"] },
    },
    {
      name: "no-dev-dependencies-in-src",
      comment: "Shipped source never imports a devDependency; only tests may.",
      severity: "error",
      from: { path: "/src/", pathNot: TEST_FILE },
      to: { dependencyTypes: ["npm-dev"] },
    },
    {
      name: "no-circular",
      comment: "No dependency cycles.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: "(^|/)node_modules/" },
    // node_modules is not excluded (that would drop npm edges and silence the npm
    // rules); doNotFollow keeps the cruise from descending into it.
    exclude: { path: ["(^|/)(dist|coverage)/", "^tooling/boundaries/fixtures/"] },
    // Type-only imports count: a boundary holds for types as well as values.
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      // Workspace packages expose their TypeScript source under this condition,
      // so the check runs on a fresh clone before anything is built.
      conditionNames: ["@domain-harness/source", "import", "types", "default"],
      extensions: [".ts", ".js", ".cjs", ".mjs", ".json"],
    },
  },
};
