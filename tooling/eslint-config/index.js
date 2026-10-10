import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * Shared flat config for every workspace package.
 *
 * typescript-eslint needs the TypeScript compiler API, which TypeScript 7.0
 * does not ship, so this package resolves "typescript" to 6.0.3 through an
 * npm alias (see pnpm-workspace.yaml, catalog "compiler-api").
 *
 * @param {string} tsconfigRootDir absolute directory of the package being linted
 */
export function config(tsconfigRootDir) {
  return defineConfig(
    { ignores: ["dist/**", "coverage/**", "fixtures/**"] },
    js.configs.recommended,
    {
      files: ["**/*.ts"],
      extends: [tseslint.configs.strictTypeChecked],
      languageOptions: {
        parserOptions: { projectService: true, tsconfigRootDir },
      },
      rules: {
        "@typescript-eslint/consistent-type-imports": "error",
        "@typescript-eslint/no-import-type-side-effects": "error",
      },
    },
    {
      files: ["**/*.{js,cjs,mjs}"],
      languageOptions: { globals: globals.node },
    },
  );
}
