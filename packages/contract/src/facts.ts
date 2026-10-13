/**
 * Versioned revision-fact schema (Story 5.1): the deterministic output of the
 * extractor. The Gate stores these facts with every run so that later
 * evaluations can be replayed without re-parsing the original files.
 *
 * All fact lists are sorted and deduplicated by the extractor; consumers may
 * rely on the shape but must not assume a particular sort order beyond
 * lexicographic string comparison.
 */
import { isRecord } from "./guards.ts";

/** The version of the fact schema that the extractor writes. */
export const FACT_SCHEMA_VERSION = "1.0.0";

/** The only major version of the schema that this contract recognises. */
export const FACT_SCHEMA_MAJOR = 1;

/** The version of the extractor that produced the facts. */
export const EXTRACTOR_VERSION = "1.0.0";

/** A dependency observed in a manifest or lockfile. */
export interface DependencyFact {
  /** The package name, including scope when present. */
  readonly name: string;
  /** The resolved version string, or the manifest version when no lockfile is supplied. */
  readonly version: string;
}

/** An import specifier observed in a TypeScript or JavaScript source file. */
export interface ImportFact {
  /** The raw specifier, for example `"react"` or `"./local-module"`. */
  readonly specifier: string;
}

/** A design-token name observed in a CSS file. */
export interface TokenFact {
  /** The custom-property name, including the leading `--`. */
  readonly name: string;
}

/** A file the extractor could not parse. */
export interface UnreadableFile {
  /** The file path as supplied to the extractor. */
  readonly path: string;
  /** A stable, human-readable reason. */
  readonly reason: string;
}

/**
 * The complete deterministic output of {@link @domain-harness/extractor#extractRevisionFacts}.
 * The shape is flat, fully typed, and carries its own schema version.
 */
export interface RevisionFacts {
  /** Always {@link EXTRACTOR_VERSION}. */
  readonly extractorVersion: string;
  /** Always {@link FACT_SCHEMA_VERSION}. */
  readonly schemaVersion: string;
  /** Always {@link FACT_SCHEMA_MAJOR}. */
  readonly schemaMajor: number;
  /** Sorted, deduplicated dependency facts. */
  readonly dependencies: readonly DependencyFact[];
  /** Sorted, deduplicated import-specifier facts. */
  readonly imports: readonly ImportFact[];
  /** Sorted, deduplicated design-token facts. */
  readonly tokens: readonly TokenFact[];
  /** Files that could not be read, sorted by path. */
  readonly unreadable: readonly UnreadableFile[];
}

/** True when `value` is a {@link DependencyFact}. Never throws. */
export function isDependencyFact(value: unknown): value is DependencyFact {
  return isRecord(value) && typeof value["name"] === "string" && typeof value["version"] === "string";
}

/** True when `value` is an {@link ImportFact}. Never throws. */
export function isImportFact(value: unknown): value is ImportFact {
  return isRecord(value) && typeof value["specifier"] === "string";
}

/** True when `value` is a {@link TokenFact}. Never throws. */
export function isTokenFact(value: unknown): value is TokenFact {
  return isRecord(value) && typeof value["name"] === "string";
}

/** True when `value` is an {@link UnreadableFile}. Never throws. */
export function isUnreadableFile(value: unknown): value is UnreadableFile {
  return isRecord(value) && typeof value["path"] === "string" && typeof value["reason"] === "string";
}

const REVISION_FACTS_KEYS = new Set([
  "extractorVersion",
  "schemaVersion",
  "schemaMajor",
  "dependencies",
  "imports",
  "tokens",
  "unreadable",
]);

/** True when `value` is a complete {@link RevisionFacts} object. Never throws. */
export function isRevisionFacts(value: unknown): value is RevisionFacts {
  if (!isRecord(value)) return false;

  for (const key of Object.keys(value)) {
    if (!REVISION_FACTS_KEYS.has(key)) return false;
  }

  if (typeof value["extractorVersion"] !== "string" || typeof value["schemaVersion"] !== "string") return false;
  if (typeof value["schemaMajor"] !== "number" || value["schemaMajor"] !== FACT_SCHEMA_MAJOR) return false;
  if (!value["schemaVersion"].startsWith(`${String(FACT_SCHEMA_MAJOR)}.`)) return false;

  const dependencies = value["dependencies"];
  const imports = value["imports"];
  const tokens = value["tokens"];
  const unreadable = value["unreadable"];

  if (!Array.isArray(dependencies) || !dependencies.every(isDependencyFact)) return false;
  if (!Array.isArray(imports) || !imports.every(isImportFact)) return false;
  if (!Array.isArray(tokens) || !tokens.every(isTokenFact)) return false;
  if (!Array.isArray(unreadable) || !unreadable.every(isUnreadableFile)) return false;

  return true;
}
