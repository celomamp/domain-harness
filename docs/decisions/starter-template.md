# Decision: starter template and scaffold choices

- **Status:** accepted
- **Date:** 2026-10-10
- **Story:** 1.1, Scaffold the monorepo from a researched open-source starter
- **Binds:** the architecture spine's Structural Seed, layer table, AD-5 dependency rule, Stack table and Deferred row "Web framework, ORM, test runner, monorepo tool"

## Context

The repository held only planning documents. Every later story needs a TypeScript monorepo with `packages/{core,extractor,contract,collector}` and `apps/{registry,panel,service,cli}` named `@domain-harness/*`, tool-enforced dependency boundaries, CI on GitHub Actions, `engines.node >=24`, and no samples, telemetry or hosted integrations the record does not approve.

Facts checked on npm and GitHub on 2026-10-10:

- TypeScript `latest` is 7.0.2, the native compiler. It ships no JavaScript compiler API until 7.1; its root export is only a version stub. 6.0.3 is the last JavaScript-API release.
- typescript-eslint 8.71.1 peers `typescript >=4.8.4 <6.1.0`. dependency-cruiser 18.5.0 loads `typescript` at runtime to parse `.ts` files.
- Other versions: turbo 2.11.7, pnpm 12.11.2, vitest 5.0.3, eslint 10.12.0, actions/checkout v7.0.1, actions/setup-node v7.1.0.
- Node: 24 is Active LTS until 2026-10-20, and 26.11.1 is current, becoming LTS on 2026-10-28. Node 25 and later do not bundle corepack.

## Candidates

| Axis | Turborepo `examples/basic` | Nx TS preset (`create-nx-workspace`) | NiGhTTraX/ts-monorepo | Quramy/npm-ts-workspaces-example |
| --- | --- | --- | --- | --- |
| License | MIT (Vercel, Inc) | MIT | MIT (Andrei Picus) | MIT (Quramy) |
| Last release or commit | tag v2.11.7, commit 547747f, 2026-10-02 | nx 23.3.0, 2026-10-07 | commit ad356a4, 2026-10-10 (no releases; template repo) | commit 3fa93f0, 2025-01-15 |
| Node ≥24 | `engines.node >=24` already | yes | CI on Node 24 | `.node-version` 20, untested on 24 |
| TypeScript 7 / 6 | already on `typescript` 7.0.2 | does not pin TypeScript. TS 7 support for its `@nx/js` plugin and generators was not confirmed on 2026-10-10 (unverified), and it would still need the 6.0.3 alias for lint | `typescript ~5.9`; uses `baseUrl` + `paths`, which TS 7 removed | `typescript` 5.6.2, plain `tsc -b` with project references |
| Layout and boundary fit | `apps/*` + `packages/*`, shared tsconfig and ESLint packages, pnpm workspace: matches the spine almost one-to-one. No boundary tool; one must be added | `apps/` + `libs/` (renamable). Built-in `@nx/enforce-module-boundaries` with tags is the strongest native fit | `apps/*` + `packages/*`, pnpm. No boundary tool | `packages/*` only, npm workspaces. No lint, no tests, no boundary tool |
| What it adds that the design forbids | Next.js `web` and `docs` apps, `@repo/ui` React library, Next/React ESLint presets, Prettier, `eslint-plugin-turbo`, `AGENTS.md`, Babel ESLint parser, Turborepo telemetry on by default, remote-cache/Vercel link prompts | Nx Cloud connection prompt and token, Nx usage analytics, generated sample app/lib, Nx daemon, heavy plugin graph | Nine sample apps (Next.js, NestJS, Storybook, webpack, rollup, vite, Jest), sample `foo`/`bar`/`components` packages, Prettier, doctoc, Renovate config | Little beyond sample `x-core`/`x-cli` packages and Prettier, but it brings almost nothing we need (no lint, test, CI matrix or task runner) |

## Decision: adopted template

**Turborepo `examples/basic` at tag `v2.11.7` (`create-turbo@2.11.7`), MIT.** It is the only candidate already on Node ≥24 and TypeScript 7.0.2 with a pnpm `apps/*` + `packages/*` layout matching the spine. Everything it adds that we do not want sits in separable files.

What was applied and what was trimmed:

- **Kept:** pnpm workspace layout, root `turbo.json` task graph (`build`, `lint`, typecheck with `dependsOn: ["^build"]`), shared TypeScript base and shared ESLint config as workspace packages, root `engines.node >=24`, `.gitignore` entries.
- **Moved:** shared config lives under `tooling/` (`@domain-harness/tsconfig`, `@domain-harness/eslint-config`) so `packages/` holds only the four spine packages.
- **Removed:** `apps/web`, `apps/docs`, `packages/ui` (`@repo/ui`), the Next.js and React ESLint presets, `@babel/eslint-parser`, `eslint-plugin-turbo`, `eslint-plugin-only-warn`, Prettier and `eslint-config-prettier`, `AGENTS.md` (turbo 2.11 rewrites one when it detects an agent, so `turbo.json` sets `"agentGuidance": false`), `meta.json`, the `dev` task, and every `@repo/*` name.
- **Replaced:** Babel parsing with typescript-eslint (`strictTypeChecked`), and `check-types` with `typecheck`. `tsc --noEmit` became composite `tsc -b` with project references.
- **Not configured:** no remote cache, no `vercel link`, no `.vercel`. Telemetry is disabled in CI with `TURBO_TELEMETRY_DISABLED=1` and `DO_NOT_TRACK=1`, and the README documents `turbo telemetry disable` for local use.
- **License:** the upstream MIT notice is reproduced in `/THIRD_PARTY_NOTICES`.

## Decision: scaffold choices

| Choice | Decision | Reason |
| --- | --- | --- |
| Monorepo tool | Turborepo 2.11.7 | Comes with the adopted starter, has a small footprint and only runs package scripts. Boundaries are enforced separately (below), so we do not need Nx's plugin graph. |
| Package manager | pnpm 12 (`packageManager: pnpm@12.11.2`, via corepack) | Human decision 2026-10-10. Strict `node_modules` means an undeclared import does not resolve, which backs up the boundary check. Catalogs keep one version per tool. |
| Test runner | Vitest 5.0.3 | Runs `.ts` tests directly through its Vite transform with no separate build step and fits ESM + NodeNext. `contract` writes type-level assertions with `expectTypeOf`, but the `tsc` typecheck enforces them, not the test run. |
| ORM (recorded only, not installed) | Drizzle ORM 0.45.x (Apache-2.0), for Story 1.2 | Declares PostgreSQL RLS policies natively, which matches AD-12. It is SQL-first with no engine binary. Kysely 0.29.6 is the fallback. Prisma's `latest` is an 8.0 RC. |
| Web framework, panel (recorded only, not installed) | React Router 8 (8.4.0 on 2026-10-10, MIT), for Story 1.3 | Human decision 2026-10-10. |
| MCP SDK line (recorded only, not installed) | v2 `@modelcontextprotocol/server@2.3.1` (npm `latest` 2.3.1, Apache-2.0), for Epic 4 | Human decision 2026-10-10. The v1 `@modelcontextprotocol/sdk` (1.32.1) is superseded. The spine Stack row is amended to match. |
| TypeScript dual version | Build and typecheck use **7.0.2** (`tsc -b`, native). Tools that need the compiler API use **6.0.3** through the npm alias `typescript: npm:typescript@6.0.3` | typescript-eslint gets it as a dependency of `@domain-harness/eslint-config` (pnpm catalog `compiler-api`). dependency-cruiser gets it through `packageExtensions` in `pnpm-workspace.yaml`. Revisit when TypeScript 7.1 ships the API and typescript-eslint widens its peer range. |
| Boundary tool | dependency-cruiser 18.5.0, rules in `/.dependency-cruiser.cjs`, run by `pnpm run boundaries` | Rules are path-based and work for imports between packages and between apps, including type-only imports. It reports file and import, and needs no lint-time type program. Fixture tests in `tooling/boundaries/` prove each rule fires. |
| Lint | ESLint 10.12.0 + typescript-eslint 8.71.1 (`strictTypeChecked`) | Typed lint on the 6.0.3 alias, with no Prettier or other style presets. |
| CI | GitHub Actions, Node 24 and 26 matrix | Pilot target (spine Stack). 24 is the engines floor and 26 is the LTS target. |

## Boundary rules encoded

From the spine's layer table and AD-5. The rules apply to `src/`; per-package tool config may use `tooling/*`.

- `packages/core` and `packages/extractor` import only `@domain-harness/contract`. No other workspace unit, no third-party package and no Node built-in. Their tests may also import `vitest`.
- `apps/panel` imports no workspace unit except `@domain-harness/contract`.
- `apps/registry` imports no workspace package except `@domain-harness/core` and `@domain-harness/contract`.
- No package or tooling module imports from `apps/*`, and no app imports another app.
- Every import resolves. npm imports must be declared. There are no cycles.

Workspace packages expose their source under the custom export condition `@domain-harness/source`, which the boundary check resolves. The check therefore runs on a fresh clone before anything is built.

## Consequences

- Upgrading TypeScript means moving two pins: the default catalog for 7.x and `compiler-api` for 6.x. Remove the alias once typescript-eslint supports 7.1+.
- Adding a database, web framework, MCP SDK or auth library is each a later story's change. Each must respect the boundary rules above.
