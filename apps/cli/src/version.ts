/**
 * Distribution surface (Story 8.3): `domain-harness --version` and
 * `domain-harness --help`.
 *
 * Version truth is single-sourced: the extractor and fact-schema versions
 * plus the supported bundle wire-contract major come from
 * `@domain-harness/contract`, and `CLI_VERSION` mirrors the CLI package
 * manifest (pinned by `version.test.ts`). Pure and never throwing.
 */
import { BUNDLE_FORMAT_VERSION, EXTRACTOR_VERSION, FACT_SCHEMA_VERSION } from "@domain-harness/contract";

/**
 * The CLI package version. Mirrors `apps/cli/package.json`; bumped by the
 * release flow, never hand-edited out of band.
 */
export const CLI_VERSION = "0.0.0";

/** True when argv is exactly the version flag. Never throws. */
export function isVersionArgs(argv: readonly string[]): boolean {
  try {
    return argv.length === 1 && argv[0] === "--version";
  } catch {
    return false;
  }
}

/** True when argv is exactly the help flag. Never throws. */
export function isHelpArgs(argv: readonly string[]): boolean {
  try {
    return argv.length === 1 && argv[0] === "--help";
  } catch {
    return false;
  }
}

/**
 * One version line carrying all four versions. `contract` is the bundle
 * wire-contract major this CLI supports; bundles with any other major are
 * refused by the loader. Never throws.
 */
export function formatVersionLine(): string {
  try {
    return `domain-harness ${CLI_VERSION} (extractor ${EXTRACTOR_VERSION}, fact-schema ${FACT_SCHEMA_VERSION}, contract ${String(BUNDLE_FORMAT_VERSION)})`;
  } catch {
    return "domain-harness";
  }
}

/** One usage line naming the CLI surface. Never throws. */
export function formatHelpLine(): string {
  try {
    return "domain-harness bundle verify --bundle <path> --trust-keys <path> --tenant <id> | domain-harness gate --bundle <path> --trust-keys <path> --tenant <id> | domain-harness --version";
  } catch {
    return "domain-harness";
  }
}
