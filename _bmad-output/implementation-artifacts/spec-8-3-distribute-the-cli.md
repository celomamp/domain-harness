---
title: 'Story 8.3: Distribute the CLI'
type: 'feature'
created: '2026-10-16'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - _bmad-output/implementation-artifacts/epic-8-context.md
warnings: []
deferred: []
baseline_commit: '2e6e41f'
baseline_revision: '2e6e41f'
---

<intent-contract>

## Intent

**Problem:** `apps/cli` runs the offline Gate (stories 8.1, 8.2) but is not installable: `package.json` is `private: true` with no published-files list, and there is no `--version` surface, so a Builder cannot install it with one command or trust which extractor and contract it uses.

**Approach:** Make `@domain-harness/cli` publishable (public scoped package, `bin` plus `files` already wired), add a top-level `domain-harness --version` line printing the CLI, extractor, fact-schema and contract versions from the already-linked `@domain-harness/contract` constants, document the one-command install in an `apps/cli` README, and pin the unknown-major-bundle refusal at the CLI surface (already enforced by the contract guard through 8.1's loader).

## Boundaries & Constraints

**Always:**
- Reuse version truth from `@domain-harness/contract`: `EXTRACTOR_VERSION`, `FACT_SCHEMA_VERSION` (facts.ts L13/L19), `BUNDLE_FORMAT_VERSION` (bundles.ts L26). The CLI package version is surfaced via a `CLI_VERSION` constant mirroring `apps/cli/package.json`, pinned by a test that reads the manifest.
- `contract` in the version line means the bundle wire-contract major the CLI supports (`BUNDLE_FORMAT_VERSION`), the same major whose unknown values the loader refuses; this ties the two acceptance criteria together.
- Route `--version` (exact argv `["--version"]`) and `--help` (exact argv `["--help"]`) in `runCli` before verify/gate dispatch; exit 0, never touch state, binding, or the working tree. Any other flag shape keeps current fail-closed behavior.
- Unknown-major bundles keep refusing with exactly `bundle verification failed`, exit 1, state unchanged (contract `isBundleFormat` L122 rejects non-current majors; 8.1's loader maps guard failure to that sentence). No new sentence text anywhere.
- Publishability only: remove `"private": true`, add scoped-public `publishConfig` plus `files` (`dist`, `README`), keep `bin` (`domain-harness` → `./dist/cli.js`), keep version `0.0.0` (release flow owns bumps).

**Never:**
- No changes to `packages/contract`, `packages/core`, `packages/extractor`, `packages/gate`, `apps/service`, `apps/registry`, `apps/panel`, or verify/gate behavior; no new runtime dependencies; CLI imports stay `contract` + `gate` + `core` + Node built-ins.
- No plan names in any output; no network calls; no working-tree writes.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Version | `domain-harness --version` | exit 0, one line containing CLI, extractor, fact-schema and contract versions | No error expected |
| Help | `domain-harness --help` | exit 0, usage line naming `bundle verify`, `gate`, `--version` | No error expected |
| Version precedence | `--version` with extra args, or under `gate` | not treated as version; current fail-closed sentences kept | Fail closed |
| Unknown major bundle | bundle with `format.version` != current major, valid signature shape | `bundle verification failed`, exit 1, state unchanged | Fail closed |
| Publish metadata | `npm pack --dry-run` shape | `private` absent, `dist` + `bin` + `README` in files | No error expected |

</intent-contract>

## Code Map

- `apps/cli/package.json` -- publish edit target: `private: true` (L4) removed, scoped-public `publishConfig`, `files` added; `bin` (L18) already correct; version stays `0.0.0` (L3).
- `apps/cli/src/version.ts` -- NEW: `CLI_VERSION` (mirrors package manifest), `formatVersionLine()` from `EXTRACTOR_VERSION`/`FACT_SCHEMA_VERSION`/`BUNDLE_FORMAT_VERSION`; never throws.
- `apps/cli/src/cli.ts` -- extend: `runCli` (L187) checks exact `--version`/`--help` before gate/verify dispatch; `isCliEntryPoint` (L167) and defaults untouched; `run()` stays verify-only.
- `apps/cli/src/index.ts` -- barrel: re-export version helpers (L15 pattern).
- `apps/cli/README.md` -- NEW: `npm install -g @domain-harness/cli` one-liner (engines: node >= 24 per root package.json L6), `--version`, verify + gate usage, offline note.
- `packages/contract/src/facts.ts` -- reuse only: `FACT_SCHEMA_VERSION` (L13), `EXTRACTOR_VERSION` (L19). Read-only.
- `packages/contract/src/bundles.ts` -- reuse only: `BUNDLE_FORMAT_VERSION` (L26), `isBundleFormat` (L122) unknown-major rejection. Read-only.
- `apps/cli/src/bundle-file.ts` -- consume only: `loadBundleFile` guard-failure mapping already yields verification-failed; unchanged.
- `apps/cli/src/version.test.ts`, `cli.test.ts` -- version-line exact pin (built from imported constants, not the formatter), manifest-mirror pin, help pin, unknown-major surface refusal via `run()`.

## Tasks & Acceptance

**Execution:**
- `apps/cli/src/version.ts` -- NEW pure unit: `CLI_VERSION`, `formatVersionLine()` (`domain-harness <cli> (extractor <e>, fact-schema <f>, contract <c>)`), `VERSION_HELP_LINE` usage text; never throws.
- `apps/cli/src/cli.ts`, `index.ts` -- route exact `--version`/`--help` in `runCli` (exit 0, no side effects); re-export version unit.
- `apps/cli/package.json` -- publishable metadata (drop `private`, add `publishConfig.access: public`, `files`); no dependency changes, no lockfile churn.
- `apps/cli/README.md` -- NEW one-command install + version + offline verify/gate usage.
- `apps/cli/src/version.test.ts`, `cli.test.ts` -- matrix pins: exact version line, CLI_VERSION equals manifest version, help exit 0 with command names, unknown-major bundle refuses at `run()` surface with state unchanged, `gate --version` is not a version answer.

**Acceptance Criteria:**
- Given a release, when the Builder runs `npm install -g @domain-harness/cli` then `domain-harness --version`, then one line prints the CLI, extractor, fact-schema and contract versions with exit 0.
- Given a bundle with an unknown major format version, when the CLI loads it, then it prints exactly `bundle verification failed` and exits non-zero with state unchanged.
- Given `pnpm --filter @domain-harness/cli test`, `pnpm run build`, `pnpm run typecheck`, `pnpm run lint`, and `pnpm run boundaries`, when they run, then all pass, CLI imports stay `contract` + `gate` + `core` + Node built-ins, and no CLI test touches the network or a database.

## Spec Change Log

## Auto Run Result

- Summary: story 8.3 makes `@domain-harness/cli` installable with one command and adds the version surface. `domain-harness --version` prints `domain-harness <cli> (extractor <e>, fact-schema <f>, contract <c>)` with exit 0, where `contract` is the supported bundle wire-format major; `domain-harness --help` prints the usage line. Both answer only as the exact sole flag and are side-effect free; all other shapes keep the existing fail-closed sentences. Unknown-major bundles refuse at the CLI surface with exactly `bundle verification failed`, exit 1, state untouched. Package is publishable (scoped-public, `files: dist + README`, `bin` kept, version stays `0.0.0` for the release flow).
- Files:
  - `apps/cli/src/version.ts` (NEW) -- `CLI_VERSION`, `formatVersionLine`, `formatHelpLine`, exact-match `isVersionArgs`/`isHelpArgs`; never throws.
  - `apps/cli/src/cli.ts` -- `runCli` routes exact `--version`/`--help` before verify/gate dispatch; verify/gate paths untouched.
  - `apps/cli/src/index.ts` -- re-exports version unit.
  - `apps/cli/package.json` -- publishable metadata (no `private`, public access, `files`); no dependency changes, lockfile untouched.
  - `apps/cli/README.md` (NEW) -- one-command install, version, offline verify/gate usage.
  - `apps/cli/src/version.test.ts` (NEW, 8 tests), `cli.test.ts` (+1 unknown-major surface test).
- Verification: `pnpm install --frozen-lockfile` clean; `pnpm run build` 10/10; `pnpm run typecheck` 15/15; `pnpm run lint` 15/15; `pnpm run boundaries` no violations; built binary smoke-tested (`--version`/`--help` exit 0, `--version extra` exit 1); `npm pack --dry-run` ships dist + README (38 files). Per-package tests with both DB URLs on postgres 18 — contract 372, collector 40, cli 102, boundaries 20, extractor 16, core 95, gate 15, mcp-bridge 11, registry 847, service 212, panel 436+1 skip (2166 passed, 0 failed). Full-parallel `pnpm test` showed the known parallelism flakes (boundaries self-test 5s timeout, one service perf test); both pass in isolation. Matrix audit: all 5 rows covered by named tests that ran and passed.
- Deviation: no subagent tool is available in this execution context, so the plan/implement/review subagent dispatches were executed inline by the single agent instead of the three-thread pattern; verification was done directly against the diff and test output.
- Residual risks: (1) `CLI_VERSION` is a hand-mirrored constant — drift from `package.json` fails the manifest-mirror test loudly, but the bump itself is a manual release step. (2) No install-from-registry round trip was performed (no publish from this branch); the pack shape is verified dry-run only.

## Review Triage Log

## Design Notes

- **Why `contract` is the bundle-format major.** All workspace package versions are `0.0.0` placeholders owned by the release flow, so printing the contract package version would print noise. The trust-relevant contract is the wire format major the CLI accepts; showing it lets a Builder see why an unknown-major bundle refuses.
- **Exact-match flag routing.** `--version`/`--help` answer only as the sole argv word. Any longer shape falls through to the existing parsers and fails closed, so no usage defect can be masked as a version answer.

## Verification

**Commands:**
- `pnpm --filter @domain-harness/cli test` -- expected: version, loader, trust, state, command, snapshot, binding, gate suites pass with no database and no network.
- `pnpm run build` -- expected: workspace builds including the CLI bin wiring.
- `pnpm run typecheck && pnpm run lint && pnpm run boundaries` -- expected: clean, no boundary violations, CLI imports only contract, gate, core, and Node built-ins.
- `pnpm test` -- expected: full workspace suite passes.

**Manual checks (if no CLI):**
- `apps/cli/src/version.ts` imports versions from `@domain-harness/contract`; no `apps/*` import appears.
- `node apps/cli/dist/cli.js --version` prints the four versions with exit 0; an unknown-major bundle copy refuses with exactly `bundle verification failed` and exit 1.
