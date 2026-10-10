---
title: 'Story 1.1: Scaffold the monorepo from a researched open-source starter'
type: 'chore'
created: '2026-10-10'
status: 'done'
baseline_commit: '943eec1047ad28e2e37017fb28f9a2579c024946'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-domain harness-2026-10-09/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The repository holds only planning docs. Every later story needs a TypeScript monorepo with the spine's layout, tooling-enforced dependency boundaries, CI, and the shared `contract` error envelope and UUIDv7 id type.

**Approach:** Record a starter comparison and the deferred scaffold choices in `docs/decisions/starter-template.md`, apply the chosen starter (planning research favours Turborepo `examples/basic` at `create-turbo@2.11.7`, MIT), trim it to `packages/{core,extractor,contract,collector}` + `apps/{registry,panel,service,cli}` as `@domain-harness/*`, add a boundary check, a GitHub Actions CI workflow, and the `contract` types.

## Boundaries & Constraints

**Always:** Root `engines.node` is `>=24`. Typecheck/build use TypeScript 7.0.2 (native `tsc -b`); lint tooling that needs the compiler API uses TypeScript 6.0.3 through an npm alias, recorded in the decision doc. Every package/app builds, typechecks and has at least one passing test. Telemetry disabled (turbo `TURBO_TELEMETRY_DISABLED=1` in CI, documented locally). Keep upstream license notices as MIT requires. Boundary rules: `core`/`extractor` → only `@domain-harness/contract`; `panel` → `contract` only; no package or app imports `apps/*`; adapters/registry → `core` + `contract`. Error type is exactly `{ code, message, subject }`; ids are UUIDv7.

**Never:** No sample apps (`web`, `docs`, `@repo/ui`), no Next.js/eslint-next/prettier presets the record did not approve, no remote cache or Vercel link, no `AGENTS.md` from the starter. No database, ORM, web framework, MCP SDK or auth dependency installed yet — only recorded. No business logic beyond the `contract` types. No secrets in the repo.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Clean workspace | fresh clone, install, build/typecheck/test/lint | all pass | N/A |
| core imports non-contract | `packages/core` file imports `@domain-harness/collector` or a third-party package | boundary check fails | message names the file and offending specifier |
| panel imports core | `apps/panel` imports `@domain-harness/core` | boundary check fails | names the import |
| import from apps | any package/app imports an `apps/*` module | boundary check fails | names the import |
| UUIDv7 guard | v7 string / v4 string / garbage | `true` / `false` / `false` | no throw |

**Decisions (human, 2026-10-10):**
- Package manager: pnpm 12, pinned via `packageManager` and corepack.
- MCP SDK line recorded for Epic 4: v2 `@modelcontextprotocol/server@2.3.1`; amend the spine's Stack row (was `@modelcontextprotocol/sdk` 1.x).
- Panel web framework recorded for Story 1.3: React Router 8.

</frozen-after-approval>

## Code Map

- `docs/` -- existing product PDFs/markdown; add `docs/decisions/starter-template.md` beside them, touch nothing else.
- `.gitignore` -- extend with `node_modules`, `dist`, `.turbo`, coverage.
- `_bmad-output/planning-artifacts/architecture/.../ARCHITECTURE-SPINE.md` -- source of layout (Structural Seed), dependency rules (AD-5, layer table), Stack table, Deferred list. Read only.
- Upstream: `github.com/vercel/turborepo/tree/v2.11.7/examples/basic` -- layout `apps/*` + `packages/*`, shared tsconfig/eslint packages; its ESLint config uses `@babel/eslint-parser` (replace with typescript-eslint on TS 6.0.3).
- Research facts (2026-10-10): typescript 7.0.2 latest (no compiler API until 7.1; typescript-eslint 8.71.1 peers `<6.1`), 6.0.3; vitest 5.0.3; dependency-cruiser 18.5.0 (reports `from → to`); turbo 2.11.7; eslint 10.12.0; actions/checkout@v7.0.1, actions/setup-node@v7.1.0; Nx 23.3.0 alternative (Cloud/analytics to strip); NiGhTTraX/ts-monorepo and Quramy/npm-ts-workspaces-example (MIT, minimal); Drizzle 0.45.4 (Apache-2.0, native RLS policies), Kysely 0.29.6, Prisma `latest` is an 8.0 RC.

## Tasks & Acceptance

**Execution:**
- [x] `docs/decisions/starter-template.md` -- compare ≥3 candidates (Turborepo basic, Nx TS preset, NiGhTTraX/ts-monorepo, Quramy example) on license, last release/commit, Node ≥24 + TS 7/6 support, layout/boundary fit, and what each adds that the design forbids; name adopted template + exact tag + license; decide monorepo tool, test runner (Vitest), ORM (Drizzle, recorded only), web framework, package manager, MCP SDK line, TS dual-version strategy, boundary tool — one-line reason each -- satisfies AC 1–2.
- [x] root `package.json`, `turbo.json`, lockfile, workspace config, `LICENSE`/`THIRD_PARTY_NOTICES` -- apply the starter, rename to `@domain-harness/*`, `engines.node >=24`, scripts `build`, `typecheck`, `test`, `lint`, `boundaries` -- workspace root.
- [x] `packages/{tsconfig,eslint-config}` (or equivalent shared config) -- TS 7 strict base with project references; typescript-eslint flat config on aliased TS 6.0.3 -- shared tooling.
- [x] `packages/{core,extractor,contract,collector}/`, `apps/{registry,panel,service,cli}/` -- minimal `package.json`, `tsconfig.json`, `src/index.ts`, one Vitest test each; declared deps follow the boundary rules -- spine layout.
- [x] `packages/contract/src/{errors,ids}.ts` + tests -- `ErrorEnvelope { code: string; message: string; subject: string }` (readonly), `UuidV7` branded type with `isUuidV7` guard -- AC 6; registry mints ids later, so no generator here.
- [x] `.dependency-cruiser.cjs` + `tooling/boundaries/*.test.ts` with violating fixtures -- encode the rules; tests assert each matrix violation fails and the output names the offending import -- AC 5.
- [x] `.github/workflows/ci.yml` -- on every push: checkout, setup-node 24 (+26 matrix if available), install, build, typecheck, lint + boundaries, test; telemetry off -- AC 6.
- [x] `_bmad-output/planning-artifacts/architecture/architecture-domain harness-2026-10-09/ARCHITECTURE-SPINE.md` -- Stack table only: replace the `@modelcontextprotocol/sdk` 1.x row with `@modelcontextprotocol/server` 2.x (decided 2026-10-10, see decision record) -- keep the spine truthful.
- [x] `README.md` -- install/build/test commands, telemetry opt-out, `corepack enable` note.

**Acceptance Criteria:**
- Given the decision record, when read, then it compares ≥3 permissively licensed candidates on the required axes, names the adopted template with exact tag and license, and decides the four deferred scaffold choices with one-line reasons.
- Given the repo after trimming, when listed, then only the spine's packages/apps plus shared config exist, with no starter samples, telemetry, or hosted integrations.
- Given CI on push, when it runs, then build, typecheck, lint/boundaries and tests all execute and pass.

## Implementation Notes

- Shared config lives in `tooling/{tsconfig,eslint-config,boundaries}` (the "equivalent shared config" option), so `packages/` holds only the four spine packages.
- TS dual version: default pnpm catalog pins `typescript` 7.0.2; named catalog `compiler-api` aliases `npm:typescript@6.0.3` for `@domain-harness/eslint-config` (typescript-eslint peer), and `packageExtensions` gives dependency-cruiser the same alias.
- Boundary check is `tooling/boundaries/check.ts` (dependency-cruiser API, rules in `/.dependency-cruiser.cjs`); output is `rule: file imports "specifier" (resolves to path)`. Workspace packages expose source under the `@domain-harness/source` export condition so the check runs before any build. dependency-cruiser normalizes `node:fs` to `fs` in the reported specifier.
- Unit rules apply to `src/`; per-package `eslint.config.js` may import `@domain-harness/eslint-config`.
- `isUuidV7` accepts canonical lowercase only (uppercase v7 is rejected) so ids compare by string equality.
- turbo 2.11 writes a root `AGENTS.md` when it detects an agent; `turbo.json` sets `"agentGuidance": false` and the file was removed.
- CI installs corepack from npm because Node 25+ no longer bundles it.
- No project `LICENSE` was added (the product license is a human decision); upstream MIT notice is in `THIRD_PARTY_NOTICES`.

## Spec Change Log

## Review Triage Log

Pass 1 (blind-hunter BH, edge-case-hunter EC, verification-gap VG):

| # | Source | Finding | Verdict | Evidence | Route |
|---|--------|---------|---------|----------|-------|
| 1 | VG1, BH3 | No fixture imports via `@domain-harness/*` specifier | medium | All violation fixtures use relative paths; manual probe showed the specifier form is caught today but nothing guards it | patch |
| 2 | VG2, BH2, EC13 | Extractor branch, `core-tests-import-only-contract`, `no-undeclared-npm-dependencies`, `no-circular` have no violating fixture | medium | Grep of `tooling/boundaries` finds no fixture for them; decision record claims "prove each rule fires" | patch |
| 3 | VG3 | Core test-file rule unexercised | medium | Same root cause as #2 | patch (grouped with #2) |
| 4 | BH1 | No boundary rule for collector/service/cli | false | Spine flowchart allows adapters → core, extractor, contract; app→app and package→app rules already cover the rest | reject |
| 5 | BH4, EC7 | Non-test `src` may import devDependencies | low | No rule for `npm-dev` from non-test src; adding one rule entry is a direct fix | patch |
| 6 | BH5 | Per-package typecheck/editor fails before `contract` is built | medium | Reproduced: fresh copy, contract `dist` removed, `tsc -p packages/core/tsconfig.json` → TS2307 | patch |
| 7 | BH6 | `@types/node` 26 while engines floor is 24 | low | Catalog pins 26.6.5; Node-26-only APIs would typecheck; 24.19.2 exists | patch |
| 8 | BH7 | Spec ACs don't match task AC numbers | low | Fix is editing this build's spec | reject |
| 9 | BH8 | sprint-status says in-progress while spec is in-review | false | Step-05 syncs the story to `review`; current state is mid-workflow | reject |
| 10 | BH9 | Spine TypeScript row still says "Confirm at scaffold" | low | Spine line 211 unchanged though 7.0.2 + 6.0.3 alias is decided; direct text correction | patch |
| 11 | BH9 | epic-1-context still says sdk 1.x | false | Cache auto-invalidates: spine is now newer than the context file, so the next story recompiles it | reject |
| 12 | BH9 | Spine sign-in row / Deferred row wording | low | Pre-existing wording, not caused by this story; negligible | reject |
| 13 | BH10, EC11 | CI only `on: push`, tags not SHA-pinned, no store cache | low | Intent says "every push"; private pilot repo; no named harm in everyday use | reject |
| 14 | BH10 | Checkout keeps `persist-credentials: true` | low | Default persists token into `.git/config`; one-line fix | patch |
| 15 | EC12 | `cancel-in-progress` cancels earlier `main` runs | low | `group: ci-${{ github.ref }}` with unconditional cancel; one-expression fix | patch |
| 16 | BH11 | No `.nvmrc` / engine-strict | low | README states requirement; pnpm/turbo fail loudly on old Node; fix adds files for marginal gain | reject |
| 17 | BH12 | Per-unit smoke tests only check a string | low | Spec asks for minimal stubs with one passing test; no harm named | reject |
| 18 | BH13 | No `isErrorEnvelope` runtime guard | low | Not in intent; new public surface | reject |
| 19 | BH14, EC9 | Cycle path dropped from `no-circular` message | low | Real but rare; fix adds a field and formatting branch | reject |
| 20 | BH15 | Decision record says Vitest needs "no transpile step" | low | Vitest transforms via Vite; type-level tests are enforced by `tsc` typecheck, not Vitest | patch |
| 21 | BH16 | Root `tsconfig.json` unused, omits tooling | low | Not used by scripts; drift only, no named failure | reject |
| 22 | EC1 | `checkBoundaries` returns `[]` when no roots exist | low | `present.length === 0` → `[]`; a misspelled fixture passes vacuously; throw is a direct fix | patch |
| 23 | EC2 | Missing roots filtered silently | false | Intentional: fixtures contain only `packages/` or `apps/`; real-tree test covers all three roots | reject |
| 24 | EC3 | `exclude` drops every `fixtures/` dir repo-wide | low | `(^|/)fixtures/` would hide future `packages/extractor/src/fixtures`; narrow to `^tooling/boundaries/fixtures/` | patch |
| 25 | EC4 | core/extractor can use Node globals (`process`, `fetch`) | low | Base sets `types: ["node"]`; override `types: []` for core and extractor | patch |
| 26 | EC5, EC6 | panel/registry rules ignore `tooling/*` targets | low | `to.path` is `^(packages|apps)/` / `^packages/`; extend to `tooling` | patch |
| 27 | EC8 | Turbo caches `@domain-harness/boundaries#test` across workspace changes | low | Its inputs are only its own package; real-tree test replays from cache locally; `cache: false` is a direct fix | patch |
| 28 | EC10 | `localeCompare` sort non-deterministic | low | Ties keep dependency-cruiser order; multi-violation test uses `toContain` | reject |
| 29 | EC14 | Local turbo telemetry on by default | false | Frozen intent: "Telemetry disabled (… in CI, documented locally)" — implemented as specified | reject |

## Verification

**Commands:**
- `pnpm install && pnpm run build && pnpm run typecheck && pnpm test` (fresh `git clean -xfd` first) -- all exit 0.
- `pnpm run lint && pnpm run boundaries` -- exit 0 on the real tree; boundary fixture tests prove failures name the offending import.
- `grep -ri -E "telemetry|vercel|@repo/" --exclude-dir=node_modules .` -- only the documented opt-out mentions remain.
