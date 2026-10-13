import {
  EXTRACTOR_VERSION,
  FACT_SCHEMA_MAJOR,
  FACT_SCHEMA_VERSION,
  type DependencyFact,
  type ImportFact,
  type RevisionFacts,
  type TokenFact,
  type UnreadableFile,
} from "@domain-harness/contract";

/** Workspace name of this unit. */
export const packageName = "@domain-harness/extractor";

/** A plain object (not null, not an array). Kept local so the extractor never imports internals of contract. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Classification helpers that use only string operations on paths. */
function isPackageJson(path: string): boolean {
  return path === "package.json" || path.endsWith("/package.json");
}

function isPnpmLock(path: string): boolean {
  return path === "pnpm-lock.yaml" || path.endsWith("/pnpm-lock.yaml");
}

function isSourceFile(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    lower.endsWith(".ts") ||
    lower.endsWith(".tsx") ||
    lower.endsWith(".js") ||
    lower.endsWith(".jsx") ||
    lower.endsWith(".mjs") ||
    lower.endsWith(".cjs") ||
    lower.endsWith(".mts") ||
    lower.endsWith(".cts")
  );
}

function isCssFile(path: string): boolean {
  return path.toLowerCase().endsWith(".css");
}

/** Collects a dependency fact, keyed for deduplication. */
function addDependency(name: string, version: string, target: Set<string>): void {
  target.add(JSON.stringify({ name, version }));
}

function dependenciesFromSet(facts: Set<string>): DependencyFact[] {
  return Array.from(facts)
    .map((item) => JSON.parse(item) as DependencyFact)
    .sort((a, b) => (a.name === b.name ? a.version.localeCompare(b.version) : a.name.localeCompare(b.name)));
}

/** Extract dependency names and versions from a package.json string. */
function extractManifestDependencies(
  content: string,
  manifestFacts: Set<string>,
  unreadable: UnreadableFile[],
  path: string,
): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    unreadable.push({ path, reason: "package.json is not valid JSON" });
    return;
  }

  if (!isRecord(parsed)) {
    unreadable.push({ path, reason: "package.json must contain a JSON object" });
    return;
  }

  for (const section of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    const group = parsed[section];
    if (!isRecord(group)) continue;
    for (const [name, version] of Object.entries(group)) {
      if (typeof name !== "string" || typeof version !== "string") {
        unreadable.push({ path, reason: "package.json dependency version must be a string" });
        return;
      }
      manifestFacts.add(JSON.stringify({ name, version }));
    }
  }
}

/* --------------------------------------------------------------------------
 * Small subset YAML reader for pnpm-lock.yaml v9. Only block mappings, flow
 * mappings/sequences and quoted/plain scalars are supported; anything else is
 * a parse error so the lockfile is reported as unreadable rather than guessed.
 * -------------------------------------------------------------------------- */

interface ParsedBlock {
  readonly value: Record<string, unknown>;
  readonly nextIdx: number;
}

interface YamlLine {
  readonly indent: number;
  readonly content: string;
}

function stripTrailingComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (c === '"' && !inSingle) {
      if (inDouble && line[i - 1] === "\\") continue;
      inDouble = !inDouble;
      continue;
    }
    if (c === "#" && !inSingle && !inDouble) {
      return line.slice(0, i);
    }
  }
  return line;
}

function splitLines(text: string): (YamlLine | undefined)[] {
  return text.split("\n").map((raw) => {
    const line = stripTrailingComment(raw.replace(/\r$/, ""));
    const leading = (line.match(/^( *)/)?.[1] ?? "").length;
    const content = line.slice(leading);
    if (content.length === 0) return undefined;
    return { indent: leading, content };
  });
}

function findUnquotedColon(text: string): number {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (c === '"' && !inSingle) {
      if (inDouble && text[i - 1] === "\\") continue;
      inDouble = !inDouble;
      continue;
    }
    if (c === ":" && !inSingle && !inDouble) return i;
  }
  return -1;
}

interface ScalarToken {
  readonly value: string;
  readonly consumed: number;
}

function parseSingleQuoted(text: string): ScalarToken {
  let value = "";
  let i = 1;
  while (i < text.length) {
    const c = text.charAt(i);
    if (c === "'") {
      if (text.charAt(i + 1) === "'") {
        value += "'";
        i += 2;
        continue;
      }
      return { value, consumed: i + 1 };
    }
    value += c;
    i++;
  }
  throw new Error("unterminated single-quoted string");
}

function parseDoubleQuoted(text: string): ScalarToken {
  let value = "";
  let i = 1;
  while (i < text.length) {
    const c = text.charAt(i);
    if (c === "\\" && i + 1 < text.length) {
      value += text.charAt(i + 1);
      i += 2;
      continue;
    }
    if (c === '"') return { value, consumed: i + 1 };
    value += c;
    i++;
  }
  throw new Error("unterminated double-quoted string");
}

function parsePlainScalar(text: string): ScalarToken {
  let value = "";
  let i = 0;
  while (i < text.length) {
    const c = text.charAt(i);
    const next = text.charAt(i + 1);
    // A colon ends a plain scalar only when it is followed by whitespace or a
    // flow delimiter, so values like "workspace:*" stay intact. Other flow
    // delimiters and whitespace always end a scalar.
    if (
      c === " " ||
      c === "\t" ||
      c === "," ||
      c === "[" ||
      c === "]" ||
      c === "{" ||
      c === "}" ||
      (c === ":" && (next === " " || next === "\t" || next === "," || next === "[" || next === "]" || next === "{" || next === "}" || next === ""))
    ) {
      break;
    }
    value += c;
    i++;
  }
  if (value.length === 0) throw new Error(`expected scalar at "${text.slice(0, 20)}"`);
  return { value, consumed: i };
}

function parseScalarToken(text: string): ScalarToken {
  const trimmed = text.trimStart();
  const leading = text.length - trimmed.length;
  let token: ScalarToken;
  if (trimmed[0] === "'") {
    token = parseSingleQuoted(trimmed);
  } else if (trimmed[0] === '"') {
    token = parseDoubleQuoted(trimmed);
  } else {
    token = parsePlainScalar(trimmed);
  }
  return { value: token.value, consumed: leading + token.consumed };
}

function parseFlowValue(text: string, start = 0): { readonly value: unknown; readonly consumed: number } {
  let i = start;
  while (i < text.length && (text[i] === " " || text[i] === "\t")) i++;
  if (i >= text.length) throw new Error("unexpected end of flow value");

  if (text[i] === "{") return parseFlowMapping(text, i);
  if (text[i] === "[") return parseFlowSequence(text, i);

  const { value, consumed } = parseScalarToken(text.slice(i));
  return { value, consumed: i - start + consumed };
}

function parseFlowMapping(text: string, start = 0): { readonly value: Record<string, unknown>; readonly consumed: number } {
  let i = start;
  if (text[i] !== "{") throw new Error("expected '{'");
  i++;
  const result: Record<string, unknown> = {};
  while (i < text.length && text[i] !== "}") {
    while (i < text.length && (text[i] === " " || text[i] === "\t")) i++;
    if (text[i] === "}") break;

    const keyStart = i;
    const { value: key, consumed: keyConsumed } = parseScalarToken(text.slice(keyStart));
    i += keyConsumed;
    while (i < text.length && (text[i] === " " || text[i] === "\t")) i++;
    if (text[i] !== ":") throw new Error("expected ':' after flow mapping key");
    i++;
    while (i < text.length && (text[i] === " " || text[i] === "\t")) i++;

    const { value, consumed: valueConsumed } = parseFlowValue(text, i);
    i += valueConsumed;
    result[key] = value;

    while (i < text.length && (text[i] === " " || text[i] === "\t")) i++;
    if (text[i] === ",") {
      i++;
      continue;
    }
    if (text[i] === "}") break;
    throw new Error("expected ',' or '}' in flow mapping");
  }
  if (text[i] !== "}") throw new Error("unterminated flow mapping");
  i++;
  return { value: result, consumed: i - start };
}

function parseFlowSequence(text: string, start = 0): { readonly value: unknown[]; readonly consumed: number } {
  let i = start;
  if (text[i] !== "[") throw new Error("expected '['");
  i++;
  const result: unknown[] = [];
  while (i < text.length && text[i] !== "]") {
    while (i < text.length && (text[i] === " " || text[i] === "\t")) i++;
    if (text[i] === "]") break;
    const { value, consumed } = parseFlowValue(text, i);
    i += consumed;
    result.push(value);
    while (i < text.length && (text[i] === " " || text[i] === "\t")) i++;
    if (text[i] === ",") {
      i++;
      continue;
    }
    if (text[i] === "]") break;
    throw new Error("expected ',' or ']' in flow sequence");
  }
  if (text[i] !== "]") throw new Error("unterminated flow sequence");
  i++;
  return { value: result, consumed: i - start };
}

function parseInlineValue(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  const first = trimmed.charAt(0);
  // Reject YAML constructs the lockfile subset parser does not understand.
  if (["|", ">", "&", "*", "!", "%", "?", "@"].includes(first)) {
    throw new Error(`unsupported YAML construct: ${first}`);
  }
  if (first === "{") return parseFlowMapping(trimmed).value;
  if (first === "[") return parseFlowSequence(trimmed).value;
  const { value, consumed } = parseScalarToken(trimmed);
  if (consumed < trimmed.trimEnd().length) {
    throw new Error(`unexpected trailing characters in scalar: ${trimmed.slice(consumed)}`);
  }
  return value;
}

function parseBlock(lines: (YamlLine | undefined)[], start: number, baseIndent: number): ParsedBlock {
  const result: Record<string, unknown> = {};
  let i = start;
  let childIndent: number | null = null;

  while (i < lines.length) {
    const line = lines[i];
    if (!line) {
      i++;
      continue;
    }
    if (line.indent <= baseIndent) break;

    if (childIndent === null) {
      childIndent = line.indent;
    }
    if (line.indent !== childIndent) {
      throw new Error(`inconsistent indentation`);
    }

    const colonIdx = findUnquotedColon(line.content);
    if (colonIdx === -1) {
      throw new Error(`expected ':' on mapping line`);
    }

    const rawKey = line.content.slice(0, colonIdx).trim();
    const key = parseScalarToken(rawKey).value;
    const afterColon = line.content.slice(colonIdx + 1).trim();

    if (afterColon !== "") {
      result[key] = parseInlineValue(afterColon);
      i++;
    } else {
      let j = i + 1;
      while (j < lines.length && !lines[j]) j++;
      if (j === lines.length || (lines[j] as YamlLine).indent <= line.indent) {
        result[key] = null;
        i++;
      } else {
        const nested = parseBlock(lines, j, line.indent);
        result[key] = nested.value;
        i = nested.nextIdx;
      }
    }
  }

  return { value: result, nextIdx: i };
}

function parseYamlSubset(text: string): unknown {
  const lines = splitLines(text);
  let i = 0;
  while (i < lines.length && !lines[i]) i++;
  const firstLine = lines[i];
  if (firstLine && firstLine.content === "---") i++;
  const parsed = parseBlock(lines, i, -1);
  return parsed.value;
}

/** Extract dependency names and resolved versions from a pnpm-lock.yaml string. */
function extractPnpmLockDependencies(
  content: string,
  lockDeps: Map<string, string>,
  unreadable: UnreadableFile[],
  path: string,
): void {
  let parsed: unknown;
  try {
    parsed = parseYamlSubset(content);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "pnpm-lock.yaml is not valid YAML";
    unreadable.push({ path, reason });
    return;
  }

  if (!isRecord(parsed)) {
    unreadable.push({ path, reason: "pnpm-lock.yaml must contain a YAML mapping" });
    return;
  }

  const importers = parsed["importers"];
  if (importers === undefined) {
    unreadable.push({ path, reason: "pnpm-lock.yaml is missing the importers section" });
    return;
  }
  if (!isRecord(importers)) {
    unreadable.push({ path, reason: "pnpm-lock.yaml importers section must be a mapping" });
    return;
  }

  for (const importer of Object.values(importers)) {
    if (!isRecord(importer)) continue;
    for (const section of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      const group = importer[section];
      if (!isRecord(group)) continue;
      for (const [name, meta] of Object.entries(group)) {
        if (!isRecord(meta)) continue;
        const version = meta["version"];
        if (typeof version === "string") {
          lockDeps.set(name, version);
        }
      }
    }
  }
}

/** Strip C-style and C++-style comments so regexes do not match imports/tokens inside them. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function isIdentifierChar(c: string): boolean {
  return /[A-Za-z0-9_$]/.test(c);
}

/**
 * Returns true when the quote at `start` belongs to an import/require specifier
 * (e.g. after `from`, `import`, `require(` or dynamic `import(`). In that case
 * the string must not be masked, because its contents are the real facts.
 */
function isImportSpecifierQuote(source: string, start: number): boolean {
  let i = start - 1;
  while (i >= 0 && (source.charAt(i) === " " || source.charAt(i) === "\t")) i--;
  if (i < 0) return false;
  if (source.charAt(i) === "(") return true;
  if (!isIdentifierChar(source.charAt(i))) return false;
  const end = i;
  while (i >= 0 && isIdentifierChar(source.charAt(i))) i--;
  const word = source.slice(i + 1, end + 1);
  return word === "from" || word === "import" || word === "require";
}

/**
 * Replace the contents of quoted strings with spaces so import/token regexes
 * do not see import-like text inside string literals. Handles single, double
 * and backtick quotes, including escaped quotes and `${...}` expressions in
 * template literals. Import/require specifiers are left intact.
 */
function removeQuotedStrings(source: string, preserveImportSpecifiers: boolean): string {
  const chars = source.split("");
  let i = 0;
  while (i < chars.length) {
    const c = chars[i] ?? "";
    if (c === "'" || c === '"' || c === "`") {
      const quote = c;
      const preserve = preserveImportSpecifiers && isImportSpecifierQuote(source, i);
      i++;
      while (i < chars.length) {
        const ch = chars[i] ?? "";
        if (ch === "\\" && i + 1 < chars.length) {
          if (!preserve) {
            chars[i] = " ";
            chars[i + 1] = " ";
          }
          i += 2;
          continue;
        }
        if (ch === quote) {
          i++;
          break;
        }
        if (quote === "`" && ch === "$" && (chars[i + 1] ?? "") === "{") {
          if (!preserve) {
            chars[i] = " ";
            chars[i + 1] = " ";
          }
          i += 2;
          let depth = 1;
          while (i < chars.length && depth > 0) {
            const inner = chars[i] ?? "";
            if (inner === "{") {
              depth++;
              if (!preserve) chars[i] = " ";
              i++;
            } else if (inner === "}") {
              depth--;
              if (!preserve) chars[i] = depth === 0 ? "}" : " ";
              i++;
            } else if (inner === "'" || inner === '"' || inner === "`") {
              const nestedQuote = inner;
              if (!preserve) chars[i] = " ";
              i++;
              while (i < chars.length) {
                const nch = chars[i] ?? "";
                if (nch === "\\" && i + 1 < chars.length) {
                  if (!preserve) {
                    chars[i] = " ";
                    chars[i + 1] = " ";
                  }
                  i += 2;
                  continue;
                }
                if (nch === nestedQuote) {
                  if (!preserve) chars[i] = " ";
                  i++;
                  break;
                }
                if (!preserve) chars[i] = " ";
                i++;
              }
            } else {
              if (!preserve) chars[i] = " ";
              i++;
            }
          }
          continue;
        }
        if (!preserve) chars[i] = " ";
        i++;
      }
    } else {
      i++;
    }
  }
  return chars.join("");
}

function extractImports(source: string, target: Set<string>): void {
  const withoutStrings = removeQuotedStrings(source, true);
  const clean = stripComments(withoutStrings);

  const staticImport = /\b(?:import|export)\s+(?:[^'";]*?\s+from\s+)?["']([^"']+)["']/g;
  const requireCall = /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;
  const dynamicImport = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

  for (const pattern of [staticImport, requireCall, dynamicImport]) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(clean)) !== null) {
      const specifier = match[1];
      if (specifier) target.add(specifier);
    }
  }
}

function importsFromSet(facts: Set<string>): ImportFact[] {
  return Array.from(facts)
    .sort((a, b) => a.localeCompare(b))
    .map((specifier) => ({ specifier }));
}

function extractTokens(source: string, target: Set<string>): void {
  const withoutStrings = removeQuotedStrings(source, false);
  const clean = stripComments(withoutStrings);
  const pattern = /var\(\s*(--[\w-]+)\s*(?:,|\))|(--[\w-]+)\s*:/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(clean)) !== null) {
    const name = match[1] ?? match[2];
    if (name) target.add(name);
  }
}

function tokensFromSet(facts: Set<string>): TokenFact[] {
  return Array.from(facts)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ name }));
}

function unreadablesFromSet(items: UnreadableFile[]): UnreadableFile[] {
  return items
    .slice()
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((item) => ({ path: item.path, reason: item.reason }));
}

/**
 * Deterministically extract revision facts from a map of file paths to contents.
 *
 * The function performs no I/O. It classifies files by path, parses manifests,
 * pnpm-lock.yaml v9, TypeScript/JavaScript imports and CSS custom properties,
 * then returns sorted, deduplicated facts plus a list of any unreadable files.
 */
export function extractRevisionFacts(files: Record<string, string>): RevisionFacts {
  const manifestFacts = new Set<string>();
  const lockDeps = new Map<string, string>();
  const importSet = new Set<string>();
  const tokenSet = new Set<string>();
  const unreadable: UnreadableFile[] = [];

  // Iterate in a fixed order so key ordering cannot affect the output.
  const paths = Object.keys(files).sort((a, b) => a.localeCompare(b));

  for (const path of paths) {
    const content = files[path] ?? "";

    if (isPackageJson(path)) {
      extractManifestDependencies(content, manifestFacts, unreadable, path);
    } else if (isPnpmLock(path)) {
      extractPnpmLockDependencies(content, lockDeps, unreadable, path);
    } else if (isSourceFile(path)) {
      extractImports(content, importSet);
    } else if (isCssFile(path)) {
      extractTokens(content, tokenSet);
    }
  }

  // Lockfile versions are the resolved versions; fall back to the manifest only
  // when a dependency is named in the manifest but absent from the lockfile.
  const dependencySet = new Set<string>();
  for (const [name, version] of lockDeps) {
    addDependency(name, version, dependencySet);
  }
  for (const fact of manifestFacts) {
    const { name, version } = JSON.parse(fact) as DependencyFact;
    if (!lockDeps.has(name)) {
      addDependency(name, version, dependencySet);
    }
  }

  return {
    extractorVersion: EXTRACTOR_VERSION,
    schemaVersion: FACT_SCHEMA_VERSION,
    schemaMajor: FACT_SCHEMA_MAJOR,
    dependencies: dependenciesFromSet(dependencySet),
    imports: importsFromSet(importSet),
    tokens: tokensFromSet(tokenSet),
    unreadable: unreadablesFromSet(unreadable),
  };
}
