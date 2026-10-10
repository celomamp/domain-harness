// Entry point for `pnpm run boundaries`. Runs on Node's built-in type stripping.
import { resolve } from "node:path";
import { checkBoundaries, formatViolation } from "./check.ts";

const repoRoot = resolve(import.meta.dirname, "../..");
const violations = await checkBoundaries(repoRoot);

if (violations.length === 0) {
  console.log("boundaries: no violations");
} else {
  for (const violation of violations) console.error(formatViolation(violation));
  console.error(`boundaries: ${String(violations.length)} violation(s)`);
  process.exitCode = 1;
}
