---
title: 'Story 1.2: Operator provisions a Company and its role-named accounts'
type: 'feature'
created: '2026-10-10'
status: 'done'
baseline_commit: '54a52365f45d5e9063c5de95de4d3a360dced5a5'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/docs/decisions/starter-template.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** No Company, account or Project exists anywhere, so sign-in (1.3), Module ownership (1.4) and every later role check have nothing to stand on, and the vendor database has no tenant guard.

**Approach:** In `apps/registry`, add the first SQL migration (tenant, account, root-Project tables; RLS on all three; a non-owner app role), a tenant-scoped data layer that refuses to query without a tenant id, and an operator command that provisions one Company from a JSON file in a single transaction. Shared `Role`/`Plan` vocabularies go in `contract`.

## Boundaries & Constraints

**Always:**
- PostgreSQL 18. Migrations run as an owner (migrator) connection; the registry runtime uses group role `dh_registry_app` (NOLOGIN, created by the migration if absent), which gets only `SELECT, INSERT` on the three tables and owns nothing.
- `ENABLE` and `FORCE ROW LEVEL SECURITY` on `tenants`, `accounts`, `projects`. Policies key on `nullif(current_setting('app.tenant_id', true), '')::uuid`, so an unset tenant context sees zero rows.
- Every data-access function takes `tenantId` first and throws `{ code: "tenant_required", ... }` (the `contract` envelope) before any query when it is missing or not a canonical UUIDv7. Each call runs in one transaction that first does `set_config('app.tenant_id', $id, true)` (transaction-local).
- Ids are UUIDv7 minted in the registry (TypeScript), validated with `isUuidV7`. Timestamps `timestamptz` defaulting to `now()`, surfaced as UTC ISO-8601.
- Roles are exactly `Buyer`, `Standard owner`, `Builder`; plans exactly `Community`, `Team`, `Business`, `Enterprise`, default `Team`. Emails are trimmed and lower-cased before uniqueness checks and storage.
- Validation of the whole input happens before any write; the write is one transaction. Any error → envelope, exit code 1, nothing written.
- Operator output and logs carry ids and counts only (no names or emails).
- Connection strings come from environment variables only.

**Never:** No tables beyond `tenants`, `accounts`, `projects` (plus the migration bookkeeping table). No UI, HTTP endpoint, sign-in, sessions, SSO/SCIM or Module tables. No `BYPASSRLS`, superuser, or table owner as the runtime role. No client-supplied ids. No passwords or secrets committed (the compose file's local-only dev password is the sole exception and is labelled as such). Registry imports no workspace unit besides `contract` (and `core`, unused here).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path | `{ "company": "Acme", "accounts": [Buyer, Standard owner, Builder entries] }` | tenant (UUIDv7, plan `Team`), one root Project (name = company, no parent), 3 accounts; stdout JSON `{ tenantId, rootProjectId, plan, accounts: [{ id, role }] }`, exit 0 | none |
| Explicit plan | `"plan": "Business"` | tenant plan `Business` | none |
| Invalid role | an entry with `"role": "Admin"` | nothing written | `invalid_role`, `subject` = `accounts[i].role` |
| Duplicate email | two entries `a@x.io` and ` A@X.io ` | nothing written | `duplicate_email`, `subject` = `accounts[j].email` |
| Invalid plan / empty company / empty or malformed email / empty name / no accounts / bad JSON / missing file | — | nothing written | `invalid_input` (`invalid_plan` for plan) naming the field in `subject` |
| DB-level duplicate | unique index violation reached anyway | transaction rolled back | mapped to `duplicate_email` |
| Missing tenant id | data function called with `undefined`, `""`, or a v4 UUID | no query issued | throws `tenant_required` |
| Cross-tenant read | tenants A and B; query in A's context with the `WHERE tenant_id` filter omitted | only A's rows | — |
| No tenant context | raw `SELECT` as `dh_registry_app` without `app.tenant_id` | zero rows | — |

</intent-contract>

## Code Map

- `apps/registry/src/index.ts` -- placeholder exporting `packageName` and `RegistryError`; keep exports, add the new public functions.
- `apps/registry/package.json`, `tsconfig*.json`, `eslint.config.js` -- unit config; registry may depend on `contract`/`core` only among workspace units (`.dependency-cruiser.cjs` rule `registry-imports-only-core-and-contract`; `no-dev-dependencies-in-src` forbids devDeps in non-test `src`).
- `packages/contract/src/{index,errors,ids}.ts` -- `ErrorEnvelope` (readonly code/message/subject) and `UuidV7` + `isUuidV7` (lowercase canonical only). Reuse; no generator lives here.
- `pnpm-workspace.yaml` -- default catalog: add new third-party versions here (`catalog:` in package.json).
- `turbo.json` -- `test` task; turbo 2 strict env mode hides undeclared env vars from tasks.
- `.github/workflows/ci.yml` -- single `verify` job (Node 24/26 matrix).
- `docs/decisions/starter-template.md` -- records Drizzle 0.45.x as the Story 1.2 ORM (Kysely fallback).
- Node runs `.ts` directly (root `boundaries` script does); workspace imports need `--conditions=@domain-harness/source` to resolve to source.
- Research (2026-10-10): drizzle-orm 0.45.4, pg 8.23.1, @types/pg 8.x; local Docker present, no local `psql`; Postgres 18 has native `uuidv7()` but ids are minted in TS per the spine.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contract/src/accounts.ts` (+ export from `index.ts`, + test) -- `ROLES`/`Role`, `PLANS`/`Plan`, `DEFAULT_PLAN = "Team"`, `isRole`, `isPlan` -- shared vocabulary the panel reuses in 1.3.
- [x] `pnpm-workspace.yaml`, `apps/registry/package.json` -- add `drizzle-orm` 0.45.4 and `pg` 8.23.1 (deps), `@types/pg` (dev); scripts `migrate`, `provision` (node with source condition).
- [x] `apps/registry/migrations/0001_tenancy.sql` -- create role `dh_registry_app` if absent; tables `tenants(id, name, plan check, created_at)`, `projects(id, tenant_id fk, parent_id null self-fk, name, created_at, unique root per tenant)`, `accounts(id, tenant_id fk, name, email, role check, created_at, unique(tenant_id, email))`; enable+force RLS; one policy per table (`tenants.id`/`tenant_id` = current tenant, `USING` and `WITH CHECK`); grant `USAGE` on schema and `SELECT, INSERT` on tables to `dh_registry_app`.
- [x] `apps/registry/src/db/migrate.ts` (+ `migrate-cli.ts`) -- apply `migrations/*.sql` in name order, each in a transaction, recorded in `registry_migrations`; idempotent re-run. Env `REGISTRY_MIGRATION_DATABASE_URL`.
- [x] `apps/registry/src/db/schema.ts` -- Drizzle `pgTable` definitions mirroring the migration.
- [x] `apps/registry/src/db/tenant-scope.ts` -- `withTenant(db, tenantId, fn)`: guard (`tenant_required`) → transaction → `set_config` → fn; `assertRuntimeRoleSafe(db)` rejecting a superuser, `BYPASSRLS`, or table-owning current role (`unsafe_database_role`).
- [x] `apps/registry/src/ids.ts` -- `mintUuidV7()` (48-bit ms timestamp + random, RFC 9562) returning `UuidV7`.
- [x] `apps/registry/src/tenancy/{validate,provision,queries}.ts` -- pure input validation returning a normalized request or envelope; `provisionCompany(db, input)` mints ids, one transaction with tenant context, maps unique violation to `duplicate_email`; tenant-scoped reads `listAccounts`, `getTenant`, `getRootProject`.
- [x] `apps/registry/src/operator/provision-cli.ts` -- `provision <file.json>`: read file, validate, connect with `REGISTRY_DATABASE_URL`, `assertRuntimeRoleSafe`, provision, print ids-only JSON; envelope JSON on stderr + exit 1.
- [x] tests -- `validate.test.ts`, `ids.test.ts`, `tenant-scope.test.ts` (guard throws, no DB); `tenancy.db.test.ts` against `REGISTRY_TEST_DATABASE_URL` (creates and drops a throwaway database, migrates, runs as `SET ROLE dh_registry_app`): happy path, plan default/explicit, invalid role and duplicate email write nothing, cross-tenant RLS proof with filter omitted, no-context zero rows, app role owns nothing, CLI end-to-end via child process. Skipped with a printed reason when the env var is unset, but fails when `CI` is set and it is unset.
- [x] `turbo.json` -- declare `REGISTRY_TEST_DATABASE_URL` and `CI` for `test`.
- [x] `compose.yaml` -- local `postgres:18` service (dev-only credentials, port 5432).
- [x] `.github/workflows/ci.yml` -- `postgres:18` service container; set `REGISTRY_TEST_DATABASE_URL`.
- [x] `docs/decisions/starter-template.md`, `README.md` -- record: Drizzle for schema/queries + plain SQL migrations with a small runner (why), `pg` driver; how to start Postgres, migrate, provision; env vars.

**Acceptance Criteria:**
- Given an empty Postgres 18 database, when `pnpm --filter @domain-harness/registry migrate` runs (twice), then only `tenants`, `accounts`, `projects` (and `registry_migrations`) exist, each with RLS enabled and forced, and `dh_registry_app` owns none of them.
- Given a valid company file, when the operator runs `pnpm --filter @domain-harness/registry provision <file>`, then the matrix happy-path rows exist in the database with UUIDv7 ids and the printed JSON contains ids and counts only.
- Given any rejected input, when provisioning runs, then the row counts of all three tables are unchanged and stderr holds one envelope.
- Given `REGISTRY_TEST_DATABASE_URL` is unset and `CI` is unset, when `pnpm test` runs on a fresh clone, then it passes and reports the DB suite as skipped.

## Implementation Notes

- **Envelope as a thrown value:** `EnvelopeError` (`apps/registry/src/errors.ts`) extends `Error` and carries `code`, `message`, `subject` as own fields, so callers `catch` a `{ code, message, subject }` object while typescript-eslint's `only-throw-error` still holds. CLIs print `toEnvelope()`.
- **UUIDv7 minting is monotonic** within a process (RFC 9562 6.2, method 2): ids minted in the same millisecond increment the 74-bit random field. Needed because all rows of one provisioning share one `created_at` (transaction time), so `listAccounts` orders by `(created_at, id)` and must return input order. Side effect: ids minted together are adjacent (opaque, not secret). The pure encoder is `encodeUuidV7(ms, random)`.
- **Validation strictness:** unknown top-level or account keys (e.g. a client-supplied `id`) are rejected as `invalid_input` naming the key. Emails must match a loose `x@y.z` shape after trim + lower-case.
- **DB-level duplicate:** accounts are inserted one per statement so a `23505` on `accounts_tenant_id_email_key` maps to `duplicate_email` with the exact `accounts[j].email` subject; proven in the DB suite via the exported `writeCompany` (skips validation).
- **Projects** get an extra composite FK `(tenant_id, parent_id) -> projects(tenant_id, id)` so a parent can never belong to another tenant, plus a partial unique index for one root per tenant.
- **Runtime role in tests and locally:** a connection-string option `?options=-c%20role%3Ddh_registry_app` makes an admin connection run as the app role (equivalent to `SET ROLE`); the CLI end-to-end tests use it. `assertRuntimeRoleSafe` checks `rolsuper`, `rolbypassrls` and `pg_has_role(current_user, relowner, 'MEMBER')` on the three tables.
- **Operator output:** `provision` prints exactly `{ tenantId, rootProjectId, plan, accounts: [{ id, role }] }`. Unexpected driver errors are reported with a fixed message (driver detail can echo emails); `migrate` adds only the SQLSTATE. A relative file path is resolved against `INIT_CWD` because `pnpm --filter` runs scripts from `apps/registry`.
- **Additional env/error codes not named in the spec:** `missing_configuration` (env var unset), `database_unavailable`, `provision_failed`, `migration_failed`, `unsafe_database_role`.
- **Skip reporting:** the DB suite prints its skip reason via `process.stderr.write` (Vitest swallows `console.*` from a fully skipped file); with `CI` set and no URL a single failing test is registered instead.
- **Verified locally** (Postgres 18 via `compose.yaml`): build, typecheck, lint, boundaries exit 0; `pnpm test` with `REGISTRY_TEST_DATABASE_URL` runs 85 registry tests (22 DB) green, five consecutive runs; without it 63 pass and 22 skip with the reason printed; `CI=true` without the URL fails. `pnpm --filter @domain-harness/registry migrate` twice on an empty database applied `0001_tenancy.sql` then nothing; `provision` printed ids only. The CI workflow change (service container) is not exercised locally.

## Spec Change Log

## Review Triage Log

### 2026-10-10 — Review pass
- verdicts: 38 findings (verification-gap 3, edge-case 14, blind-hunter 15, intent-alignment 6), logged in 28 rows where findings make the same claim at the same location — rows: high 0, medium 2, low 23, false 3, maybe-false 0
- findings:
  - `[medium]` `[patch]` VG1/BH9: `assertRuntimeRoleSafe` BYPASSRLS and owner-membership branches untested; no non-superuser member of dh_registry_app shown accepted — added DB tests with throwaway NOLOGIN roles for each branch and the accepted case.
  - `[medium]` `[patch]` VG2: failed-migration rollback never exercised — added a temp-dir migration test (good + bad file) asserting rollback, bookkeeping and retry.
  - `[low]` `[patch]` VG3/BH12: INIT_CWD relative-path resolution untested — added CLI test with a bare filename and INIT_CWD.
  - `[low]` `[patch]` EC1/EC2/BH13/EC14 (unhandled-error half): pg Pool/Client lack an 'error' listener, so an idle-connection error crashes without an envelope — listeners added in `createPool` and the migrate client.
  - `[low]` `[reject]` EC3/BH1: re-running provisioning creates a second tenant — operator-run pilot command, rare; a guard needs a uniqueness/idempotency design not in the intent.
  - `[low]` `[reject]` EC4/EC14 (post-commit half): ambiguous-commit error message claims rollback — requires a lost connection between COMMIT and ack; fix adds branching.
  - `[low]` `[reject]` EC5: stale inherited INIT_CWD when the script is run with plain node inside another pnpm process — unlikely; documented invocation is the pnpm script.
  - `[low]` `[reject]` EC6/BH15 (rollback half): a throwing ROLLBACK masks the original error — needs an already-broken connection; fix adds a guard.
  - `[low]` `[patch]` EC7/BH3 (misnamed half): a `.sql` file not matching the name pattern is silently skipped — runner now fails on it.
  - `[low]` `[reject]` EC8: migration file with its own BEGIN/COMMIT — no such file exists; guard adds parsing.
  - `[low]` `[reject]` EC9: concurrent CREATE ROLE race across databases in one cluster — single DB suite per run, CI runners isolated; rare.
  - `[low]` `[patch]` EC10/BH2: pre-existing dh_registry_app with unsafe attributes accepted silently — a second DO block runs `ALTER ROLE dh_registry_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE` when the existing role has any unsafe attribute (conditional because naming SUPERUSER/BYPASSRLS in ALTER ROLE needs a superuser).
  - `[low]` `[reject]` EC11/BH6: unmigrated database yields generic `provision_failed` — still fails safely with exit 1 and nothing written; distinct envelope adds a branch.
  - `[low]` `[reject]` EC12/BH5: no length limits on company/name/email — trusted operator input in the pilot; adds validation surface not in the intent.
  - `[low]` `[reject]` EC13: `pool.end()` rejection in finally masks the envelope — rare; adds a guard.
  - `[low]` `[reject]` BH3 (checksum half): edits to applied migrations not detected — no deployed databases yet; adds a checksum column and logic.
  - `[low]` `[reject]` BH4: JS vs Postgres lower-casing differ for non-ASCII emails — fails safely via the CHECK; pilot addresses are ASCII.
  - `[low]` `[reject]` BH7: Drizzle schema can drift from SQL without a test — SQL is declared source of truth; no named failing caller.
  - `[low]` `[reject]` BH8: FORCE RLS never demonstrated against a non-superuser owner — PostgreSQL semantics; the runtime role is never the owner, which is tested.
  - `[low]` `[patch]` BH10: production login-role setup undocumented — README now shows the `CREATE ROLE ... LOGIN ... IN ROLE dh_registry_app` example and that migrate runs as the owner.
  - `[low]` `[reject]` BH11: spec AC says "ids and counts" but output has ids, plan, roles — fix edits this build's spec.
  - `[low]` `[reject]` BH15 (message half): readdir/connection failures described as a failed migration — misleading wording only, exit 1 and envelope still correct.
  - `[false]` `[reject]` BH14/IA6: epic-1-context.md change is unrelated — the workflow regenerated the stale epic cache (spine newer than cache) before planning; it is required workflow output.
  - `[low]` `[reject]` IA1: no real LOGIN member role exercised — `-c role=` is equivalent to SET ROLE; the patched test adds a non-superuser member role; production identity is guarded at runtime.
  - `[low]` `[reject]` IA2: duplicate-email "nothing written" not tested through the CLI — CLI shares `validateProvisionInput`; function-level and DB-level paths are tested.
  - `[false]` `[reject]` IA3: no structural guard forcing future functions through `withTenant` — intent requires current data-access functions to throw, which is tested; future stories add their own.
  - `[low]` `[reject]` IA4: Postgres 18 version not asserted by a test — pinned by compose and CI images.
  - `[false]` `[reject]` IA5: schema "forward-shaped" violates "only these tables" — only the three named tables exist; `parent_id` is a column, not a table.

## Design Notes

Migrations are plain SQL rather than drizzle-kit output because RLS policies, `FORCE`, role creation and grants are the point of this migration and read best as SQL; drizzle-orm still provides typed queries. The test suite proves RLS by `SET ROLE dh_registry_app` on an admin connection, so no login role or password is needed in tests; production connects as any login role that is a member of `dh_registry_app`, and `assertRuntimeRoleSafe` refuses to start otherwise-unsafe connections.

```sql
CREATE POLICY tenant_isolation ON accounts
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
```

## Verification

**Commands:**
- `docker compose up -d postgres` then `REGISTRY_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres pnpm test` -- all suites pass, DB suite not skipped.
- `pnpm run build && pnpm run typecheck && pnpm run lint && pnpm run boundaries` -- exit 0.
- `pnpm test` without the env var -- passes, DB suite skipped with reason.

## Auto Run Result

Status: done

**Summary:** `apps/registry` gains the first SQL migration (`tenants`, `accounts`, `projects`, RLS enabled and forced, non-owner group role `dh_registry_app` with SELECT/INSERT only), a tenant-scoped data layer (`withTenant` throws `tenant_required` before any query; `assertRuntimeRoleSafe` refuses superuser, BYPASSRLS and owner-member roles), registry-minted UUIDv7 ids, and an operator command `pnpm --filter @domain-harness/registry provision <company.json>` that validates everything first and writes in one transaction. `contract` gains the `Role`/`Plan` vocabulary.

**Files changed:**
- `packages/contract/src/accounts.ts` (+ test, `index.ts` export) -- roles, plans, `DEFAULT_PLAN`, guards.
- `apps/registry/migrations/0001_tenancy.sql` -- tables, RLS policies, app role and grants.
- `apps/registry/src/db/{client,schema,migrate,migrate-cli,tenant-scope}.ts` (+ test) -- pool, Drizzle schema, migration runner, tenant guard and runtime-role check.
- `apps/registry/src/{ids,errors}.ts` (+ test) -- monotonic UUIDv7 minting, `EnvelopeError`.
- `apps/registry/src/tenancy/{validate,provision,queries}.ts` (+ unit and DB tests) -- validation, provisioning, tenant-scoped reads.
- `apps/registry/src/operator/{provision-cli,output}.ts` -- operator command, single-envelope failure output.
- `apps/registry/package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml` -- drizzle-orm 0.45.4, pg 8.23.1, @types/pg; `migrate`/`provision` scripts.
- `turbo.json`, `compose.yaml`, `.github/workflows/ci.yml` -- test env vars, local and CI `postgres:18`.
- `README.md`, `docs/decisions/starter-template.md` -- database usage, production role setup, Story 1.2 addendum.
- `_bmad-output/implementation-artifacts/epic-1-context.md` -- regenerated stale epic cache (spine was newer).

**Review findings:** 38 findings in 28 rows. Patched: 2 medium (role-check branch tests; migration rollback test) and 5 low (INIT_CWD test, pg error listeners, misnamed-migration failure, unsafe pre-existing role reset, README production role). Deferred: none. Rejected: 18 low and 3 false, each with its reason in the triage log above. After patching, verification also exposed a flaky assertion (the "no names in output" regex matched `bea` inside hex ids roughly 1 run in 10); fixed by matching full names, then 20 consecutive DB-suite runs passed.

**Follow-up review recommended: true.** Patched counts: high 0, medium 2, low 5. Unverified risk: the new CI `postgres:18` service and the conditional `ALTER ROLE` path have never run against a non-superuser migrator (managed hosting), so the migration's role creation/reset may fail there.

**Verification:** `pnpm run build`, `typecheck`, `lint`, `boundaries` exit 0. With `REGISTRY_TEST_DATABASE_URL` against local Postgres 18 (compose): 91/91 registry tests pass (28 DB tests), all 10 turbo test tasks green. Without it: 63 pass, 28 skipped with a printed reason. With `CI=true` and no URL: the suite fails as required.

**Residual risks:** CI workflow change not yet run on GitHub; `dh_registry_app` is cluster-wide; production needs a login role in `dh_registry_app` (documented, not created); re-running `provision` with the same file creates a second tenant (rejected finding).

