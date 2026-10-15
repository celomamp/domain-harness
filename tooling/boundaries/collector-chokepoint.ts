/**
 * The Collector chokepoint scan (Story 6.2): the only record-to-Compilation
 * path with an outbound push to the compilations ingest endpoint must live in
 * `packages/collector/src`. Dependency-cruiser models imports, not URL
 * targets, so this text scan observes the actual network surface: sources
 * under per-app `src` and per-package `src` directories (tests and fixtures
 * excluded) that
 * both call `fetch(`/`Request(` and reference the ingest path are offenders
 * outside the collector. Follows the `checkBoundaries(repoRoot)` shape with
 * its own temp-tree helper in the test.
 */
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/** One outbound push path outside the collector: the file and the call-site line. */
export interface CollectorChokepointFinding {
  /** The offending file, relative to the scanned root. */
  readonly file: string;
  /** The 1-based line of the outbound call. */
  readonly line: number;
  /** What was found: the outbound call plus the ingest-path reference. */
  readonly detail: string;
}

/**
 * The service bundle puller (Story 4.2) is the one blessed outbound GET: it
 * pulls the tenant's latest bundle and never touches the compilations ingest
 * path, so it is allowlisted by path.
 */
const ALLOWLISTED = new Set(["apps/service/src/bundles/puller.ts"]);

/** The collector owns the only outbound push path. */
const CHOKEPOINT_ROOT = "packages/collector/src";

const SOURCE_ROOTS = ["apps", "packages"] as const;

/** The ingest-path signals: the literal and the constant's compilations arm (never the catalog-reads arm). */
const INGEST_PATH = /\/v1\/compilations|COMPILATION_API_PATHS\s*\.\s*compilations|COMPILATION_API_PATHS\s*\[\s*["']compilations["']\s*\]/;

/** The outbound-call signal. */
const OUTBOUND_CALL = /\b(fetch|Request)\s*\(/;

/** Directories that are never sources: build output and installed packages. */
const SKIPPED_DIRS = new Set(["node_modules", "dist", "coverage", "build", ".react-router"]);

function isSourceFile(path: string): boolean {
  if (!(path.endsWith(".ts") || path.endsWith(".tsx"))) return false;
  if (path.endsWith(".test.ts") || path.endsWith(".test.tsx")) return false;
  const segments = path.split("/");
  return !segments.some((segment) => segment === "fixtures" || segment === "__fixtures__");
}

function collectFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    // Build output, installed packages and fixtures-adjacent artifacts are
    // not sources; node_modules also holds workspace symlinks that would
    // rescan the same trees many times over, so symlinks are never followed.
    if (SKIPPED_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = lstatSync(full);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      collectFiles(full, out);
    } else if (stat.isFile()) {
      out.push(full);
    }
  }
}

/**
 * Scan `root` for outbound push paths to the compilations ingest endpoint
 * outside `packages/collector/src`. Returns every finding as file plus line;
 * an empty array means only the collector holds such a path.
 */
export function scanOutboundPushPaths(root: string): readonly CollectorChokepointFinding[] {
  const base = resolve(root);
  const findings: CollectorChokepointFinding[] = [];
  for (const sourceRoot of SOURCE_ROOTS) {
    const dir = join(base, sourceRoot);
    if (!existsSync(dir)) continue;
    const files: string[] = [];
    collectFiles(dir, files);
    for (const full of files.sort()) {
      const file = relative(base, full).split("\\").join("/");
      if (!isSourceFile(file)) continue;
      if (file.startsWith(`${CHOKEPOINT_ROOT}/`) || file === CHOKEPOINT_ROOT) continue;
      if (ALLOWLISTED.has(file)) continue;
      // Only the service and panel leaves plus workspace packages are scanned;
      // the scan walks apps/*/src and packages/*/src by construction below.
      const parts = file.split("/");
      if (parts.length < 3 || parts[2] !== "src") continue;
      const text = readFileSync(full, "utf8");
      if (!INGEST_PATH.test(text)) continue;
      const lines = text.split("\n");
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? "";
        if (OUTBOUND_CALL.test(line)) {
          findings.push({
            file,
            line: index + 1,
            detail: `${file}:${String(index + 1)} calls ${line.trim().slice(0, 80)} toward the compilations ingest path`,
          });
          break;
        }
      }
    }
  }
  return findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

/** One line per finding, naming the file and the offending line. */
export function formatChokepointFinding(finding: CollectorChokepointFinding): string {
  return `${finding.file}:${String(finding.line)} ${finding.detail}`;
}
