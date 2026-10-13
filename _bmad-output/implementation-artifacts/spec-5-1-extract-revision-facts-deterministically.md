---
title: 'Story 5.1: Extract revision facts deterministically'
type: feature
created: '2026-10-13'
status: done
baseline_revision: '9498fae5705b001cd48784330f1b496afb6c208e'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - _bmad-output/implementation-artifacts/epic-5-context.md
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** The Gate needs a deterministic, adapter-independent view of a code revision's dependency coordinates, import specifiers and design-token names, but `packages/extractor` is currently an empty shell.

**Approach:** Define a versioned fact schema in `packages/contract` and implement a pure, I/O-free extractor in `packages/extractor` that consumes file contents as strings, emits sorted/deduplicated facts, and reports any file it cannot parse.

## Boundaries & Constraints

**Always:**
- The extractor receives file contents only (`Record<string, string>`); it performs no file system or network I/O.
- Output is byte-identical for the same input regardless of key order or repeated calls.
- Facts are sorted and deduplicated within each category.
- The extractor imports only `@domain-harness/contract` and Node built-ins are also forbidden by `core-imports-only-contract`.
- Unreadable files are reported in the result, never thrown or silently dropped.

**Never:**
- Do not add runtime dependencies to `packages/extractor` other than `@domain-harness/contract`.
- Do not use TypeScript compiler APIs or AST parsers (TypeScript 7.0 lacks the compiler API in this workspace).
- Do not parse lockfile ecosystems other than npm/pnpm for the first cut.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Manifest + lockfile | `package.json` + `pnpm-lock.yaml` | Dependency facts (name + resolved version) for every named dependency | Unparseable JSON/YAML recorded as unreadable |
| Source files | `.ts`/`.js` files with imports | Import-specifier facts for each specifier | Unreadable only on parse failure (not expected for regex path) |
| Style files | `.css` with custom properties and `var()` | Token facts for each `--token-name` | Unreadable only on parse failure |
| Reordered files | Same contents in different key order | Byte-identical output | None |
| Duplicate inputs | Same specifier/token appearing twice | Single fact in output | None |
| Unsupported lockfile | `yarn.lock` present | Ignored (not in pilot scope) or unreadable | No crash |

</intent-contract>

## Code Map

- `packages/contract/src/facts.ts` -- New fact-schema contract: version constants, fact types, runtime guards and the extractor-version constant.
- `packages/contract/src/index.ts` -- Re-exports the new public contract symbols.
- `packages/extractor/src/index.ts` -- `extractRevisionFacts(files)` implementation and any file-type dispatch helpers.
- `packages/extractor/src/index.test.ts` -- Tests for deterministic extraction, sorting/dedup, and unreadable-file reporting.
- `packages/contract/src/facts.test.ts` -- Tests for guards and version constants.
- `packages/extractor/package.json` -- No new runtime dependencies; only `@domain-harness/contract` is allowed.
- `.dependency-cruiser.cjs` -- Boundary rule `core-imports-only-contract` already enforces extractor imports; no change needed.

## Tasks & Acceptance

**Execution:**
- `packages/contract/src/facts.ts` -- Define `FACT_SCHEMA_VERSION`, `FACT_SCHEMA_MAJOR`, `EXTRACTOR_VERSION`, `RevisionFacts`, `DependencyFact`, `ImportFact`, `TokenFact`, `UnreadableFile`, and `isRevisionFacts` runtime guard. Keep the shape flat and versioned.
- `packages/contract/src/index.ts` -- Export the new fact types, constants and guard.
- `packages/extractor/src/index.ts` -- Implement `extractRevisionFacts(files)` that classifies files by name/extension, dispatches to pure parsers for manifests, `pnpm-lock.yaml`, TS/JS imports and CSS tokens, and returns a deterministic `RevisionFacts` object. Include a small subset YAML reader for `pnpm-lock.yaml` importers and package keys, plus robust regex-based import/token extraction.
- `packages/extractor/src/index.test.ts` -- Replace the placeholder test. Cover: (1) manifest + lockfile produce sorted dependency facts, (2) TS/JS files produce sorted import facts, (3) CSS produces sorted token facts, (4) unreadable JSON/YAML is reported without throwing, (5) swapping input key order yields byte-identical output, (6) duplicate values are deduplicated.
- `packages/contract/src/facts.test.ts` -- Add tests verifying constants, round-trip serialization of a valid facts object through `isRevisionFacts`, and that `isRevisionFacts` rejects malformed objects.

**Acceptance Criteria:**
- Given `packages/extractor` is called with `Record<string, string>` file contents, when extraction runs, then it returns a `RevisionFacts` object containing sorted, deduplicated dependency, import and token facts and a list of unreadable files.
- Given the same file contents in any key order, when extraction runs repeatedly, then the output is byte-identical and includes the extractor version and schema version.
- Given a malformed `package.json` or `pnpm-lock.yaml`, when extraction runs, then the file is reported as unreadable with a reason and extraction continues for the remaining files.
- Given the workspace boundary check, when it runs, then `packages/extractor` imports nothing but `@domain-harness/contract` and Vitest in tests.
- Given `pnpm test`, when it runs, then `packages/contract` and `packages/extractor` tests pass.

## Spec Change Log

## Review Triage Log

### 2026-10-13 — Review pass
- verdicts: 20 findings — high 0, medium 9, low 11, false 0, maybe-false 0
- findings:
  - `[medium]` `[patch]` Import regexes matched import-like text inside string literals and `stripComments` corrupted strings containing `//` or `/*` (blind-hunter #1, edge-case-hunter #1/#2/#9) — fixed by masking quoted string contents before running import regexes; tests added for imports inside strings and comments.
  - `[medium]` `[patch]` CSS token extraction scanned raw CSS and omitted tokens in `var(--token, fallback)` (blind-hunter #2, edge-case-hunter #3/#4/#10) — fixed by stripping CSS comments and string ranges and updating the `var()` regex to allow a fallback; tests added.
  - `[medium]` `[patch]` Dependency facts could be lost when multiple manifests declared the same package at different versions, lockfile parsing skipped `peerDependencies`, and non-string manifest versions were silently ignored (blind-hunter #3/#4, edge-case-hunter #5/#6) — fixed by collecting all manifest name/version pairs, including `peerDependencies`, and marking manifests with non-string versions unreadable; tests added.
  - `[low]` `[patch]` `isRevisionFacts` accepted extra properties and did not validate the schema major (blind-hunter #5, edge-case-hunter #8) — fixed to reject unknown keys and verify `schemaMajor` and major-minor `schemaVersion`.
  - `[low]` `[patch]` Source-file classification omitted `.mjs`, `.cjs`, `.mts`, `.cts` (blind-hunter #7, edge-case-hunter #7) — fixed by adding those extensions; locale-sensitivity of `toLowerCase()` is negligible for ASCII file paths.
  - `[low]` `[patch]` Missing test coverage for string/comment false positives, conflicting dependency versions, peer dependencies, and unsupported YAML constructs (blind-hunter #9/#10) — fixed by adding the corresponding extractor tests.
  - `[low]` `[defer]` npm `package-lock.json` / `npm-shrinkwrap.json` parsing is not implemented (blind-hunter #6) — the pilot stack uses pnpm; the spec already treats unsupported lockfiles as ignored/unreadable, so this is deferred for a later story.
  - `[low]` `[reject]` `extractRevisionFacts` does not validate its `files` argument (blind-hunter #8) — TypeScript types enforce the contract and all callers pass a `Record<string, string>`; adding runtime validation would add complexity with no demonstrated caller defect.

## Design Notes

- File classification uses only string operations on paths (`package.json`, `pnpm-lock.yaml`, extensions). No `node:path` import is used because the boundary rule forbids even Node built-ins in extractor source.
- Sorting uses locale-independent string comparison (`localeCompare` with `undefined` defaults is fine for ASCII identifiers; the existing codebase uses `String.prototype.localeCompare`).
- The `pnpm-lock.yaml` reader is intentionally a small subset parser: it only needs `lockfileVersion: '9.0'`-style importers and package keys. Any construct it does not understand marks the lockfile as unreadable rather than guessing.

## Verification

**Commands:**
- `pnpm --filter @domain-harness/contract test` -- expected: all contract tests pass, including new `facts.test.ts`.
- `pnpm --filter @domain-harness/extractor test` -- expected: all extractor tests pass.
- `pnpm run boundaries` -- expected: no boundary violations in `packages/extractor`.
- `pnpm test` -- expected: full workspace test suite passes.

**Manual checks (if no CLI):**
- Inspect `packages/extractor/dist/index.js` after `pnpm --filter @domain-harness/extractor build` to confirm no third-party imports.

## Auto Run Result

**Summary:** Implemented Story 5.1: a versioned revision-fact schema in `packages/contract` and a deterministic, I/O-free extractor in `packages/extractor` that parses `package.json`, `pnpm-lock.yaml` v9, TS/JS imports and CSS custom properties, returning sorted/deduplicated facts and a list of unreadable files.

**Files changed:**
- `packages/contract/src/facts.ts` — fact schema, constants and runtime guards.
- `packages/contract/src/facts.test.ts` — tests for guards and constants.
- `packages/contract/src/index.ts` — re-exports new fact symbols.
- `packages/extractor/src/index.ts` — `extractRevisionFacts` with manifest, lockfile, import and token parsers.
- `packages/extractor/src/index.test.ts` — tests covering dependencies, imports, tokens, determinism, deduplication, unreadable files and edge cases.
- `_bmad-output/implementation-artifacts/epic-5-context.md` — compiled Epic 5 context.
- `_bmad-output/implementation-artifacts/spec-5-1-extract-revision-facts-deterministically.md` — this spec.

**Review findings:** 20 findings — 9 medium, 11 low. All medium and applicable low findings were patched (import/CSS false positives, dependency version handling, guard strictness, source extensions, test coverage). One low finding deferred (npm `package-lock.json` support, out of pnpm pilot scope). One low finding rejected (input validation, covered by TypeScript contract).

**Follow-up review recommendation:** `true` — two or more medium findings were patched; a second review pass should confirm the string-masking and CSS-comment stripping changes leave no residual false positives.

**Verification performed:**
- `pnpm --filter @domain-harness/contract test` — 266 passed
- `pnpm --filter @domain-harness/extractor test` — 16 passed
- `pnpm run boundaries` — no violations
- `pnpm test` — 11 tasks successful
- `pnpm run build` — 8 tasks successful

**Residual risks:**
- The bespoke YAML reader remains a subset parser; lockfiles using unsupported YAML constructs are reported unreadable rather than parsed.
- Import and token extraction are regex-based; the added string/comment masking handles the known false-positive cases but may still be fooled by unusually nested literals.
