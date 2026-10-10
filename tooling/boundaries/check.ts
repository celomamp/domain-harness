import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cruise } from "dependency-cruiser";
import extractDepcruiseOptions from "dependency-cruiser/config-utl/extract-depcruise-options";

/** The rules file at the repository root. */
export const RULES_FILE = fileURLToPath(new URL("../../.dependency-cruiser.cjs", import.meta.url));

/** The workspace directories the check covers. */
export const WORKSPACE_ROOTS = ["packages", "apps", "tooling"] as const;

export interface BoundaryViolation {
  /** Name of the rule in .dependency-cruiser.cjs. */
  readonly rule: string;
  /** Importing file, relative to the checked directory. */
  readonly from: string;
  /** The import specifier as written in `from` (a Node built-in loses its `node:` prefix). */
  readonly specifier: string;
  /** Where the specifier resolved to (equal to the specifier when unresolvable). */
  readonly to: string;
}

/**
 * Runs the boundary rules over `roots` inside `baseDir` and returns every
 * violation, sorted by file then rule. An empty array means the tree is clean.
 */
export async function checkBoundaries(
  baseDir: string,
  roots: readonly string[] = WORKSPACE_ROOTS,
): Promise<BoundaryViolation[]> {
  const base = resolve(baseDir);
  const present = roots.filter((root) => existsSync(join(base, root)));
  if (present.length === 0) {
    throw new Error(`boundaries: none of ${roots.join(", ")} exist in ${base}`);
  }
  const options = await extractDepcruiseOptions(RULES_FILE);
  const result = await cruise(present, { ...options, baseDir: base, validate: true });
  if (typeof result.output === "string") {
    throw new TypeError("dependency-cruiser returned a report string instead of a result object");
  }
  return result.output.summary.violations
    .map((violation) => ({
      rule: violation.rule.name,
      from: violation.from,
      specifier: violation.unresolvedTo ?? violation.to,
      to: violation.to,
    }))
    .sort((a, b) => a.from.localeCompare(b.from) || a.rule.localeCompare(b.rule));
}

/** One line per violation, naming the file and the offending import. */
export function formatViolation(violation: BoundaryViolation): string {
  const target = violation.to === violation.specifier ? "" : ` (resolves to ${violation.to})`;
  return `${violation.rule}: ${violation.from} imports "${violation.specifier}"${target}`;
}
