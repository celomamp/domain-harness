---
title: 'Story 1.4: Buyer assigns exactly one Standard owner per Module'
type: 'feature'
created: '2026-10-11'
status: 'done'
baseline_commit: '0c52fa7a35d56cd8a86dea38b8863f5c946d9b55'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-domain harness-2026-10-09/DESIGN.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** There are no Modules: the Buyer cannot create the code-stack or design-system Module, and nobody is accountable for one, so Stories 1.5/1.6 have nothing to publish into and no owner to check (FR-4).

**Approach:** The registry gains a `modules` table and an append-only `module_owner_assignments` log (migration 0003, forced RLS), a Module service, and Bearer-authenticated JSON endpoints to list Modules, create one, and assign its Standard owner (Buyer only). The panel's Standards surface gains a Modules section: a table of Modules with their current owner, a create form, and a per-Module owner form, all calling the registry over HTTP with types and guards from `contract`.

## Boundaries & Constraints

**Always:**
- Kinds offered: exactly `code-stack` and `design-system` (labels "code stack", "design system"); any other value is `400 invalid_input` subject `kind`, and the panel kind control has exactly those two options.
- A Module has a registry-minted UUIDv7 id, a kind, a name (trimmed, 1–120 chars, unique per tenant case-insensitively → `409 module_name_taken` subject `name`), `created_by`, `created_at`, and no owner on creation.
- The owner is never a column on `modules`: the current owner is the assignment row with the highest `sequence` for that Module. Assignments are insert-only (`dh_registry_app` gets `SELECT, INSERT` only — no UPDATE/DELETE), each carrying `owner_account_id`, `assigned_by` (the Buyer's account id) and `assigned_at` (UTC). `sequence` is per-Module, `UNIQUE (module_id, sequence)`, computed as max+1 inside the transaction after `pg_advisory_xact_lock` on the Module id, so concurrent assignments serialise and the Module always has exactly one current owner.
- Only a session whose role is `Buyer` may create a Module or assign an owner; otherwise `403 role_denied` subject `role`, checked before any input validation or lookup, and nothing is written.
- An eligible owner is an account of the same tenant whose role is `Standard owner`; any other account id (unknown, other tenant, malformed, Buyer or Builder role) is `400 invalid_input` subject `accountId`, nothing written. Assigning the current owner again is a no-op `200` with no new row.
- Unknown or foreign Module id (or malformed id in the path) → `404 module_not_found` subject `moduleId`.
- Every query runs through `withTenant` with the tenant id from the session; new tables have RLS enabled + forced with the 0001 policy shape, composite FKs `(tenant_id, …)` to `accounts`/`modules`, and are added to `TENANT_TABLES`.
- Wire contract (paths, request/response types, guards, error codes) lives in `packages/contract`; the panel imports only `contract` and calls the registry over HTTP; errors are the `{ code, message, subject }` envelope; logs carry ids, codes and counts only (never names or emails).
- Panel: the controls are shown to every role (never hidden by role); a refusal is shown with the `denial` component in a `role="status"` region and the table is unchanged. Invalid submit keeps the field values and adds ink text under the field. Tables have header cells. Styling uses only existing tokens/components (gold only on button-primary: "Create Module"; "Assign Standard owner" is button-inverse). Copy uses glossary terms; no all-caps.

**Never:** No Standards, publishing, entries, versions or slot validation (Stories 1.5/1.6). No Module rename/delete or owner removal. No other Module kinds. No client-minted ids. No UPDATE/DELETE grants on the new tables. No account editing. No panel database access.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Create | Buyer posts `{kind:"code-stack", name:" Code stack "}` | 201 Module `{id(UUIDv7), kind, name:"Code stack", owner:null, createdAt}`; panel table shows the row with "No owner" and a status "Module created: Code stack." | none |
| Bad kind | `kind:"brand"` or missing | nothing stored | 400 `invalid_input` subject `kind`; panel ink text under the kind field |
| Bad / duplicate name | `""`, 121 chars; or `"code STACK"` when "Code stack" exists | nothing stored | 400 `invalid_input` / 409 `module_name_taken`, subject `name`; panel keeps value, ink text under the name field |
| Assign | Buyer posts `{accountId:<Standard owner>}` to `/v1/modules/{id}/owner` on an ownerless Module | 200 Module with `owner:{accountId,name,assignedAt,assignedBy:{accountId,name}}`; one assignment row (sequence 1) | none |
| Reassign | Module owned by A; Buyer assigns B | owner is B; rows for A (seq 1) and B (seq 2) both remain unchanged | none |
| Same owner | assign current owner again | 200, unchanged, no new row | none |
| Ineligible owner | Builder/Buyer account id, unknown id, other tenant's account, malformed | nothing written | 400 `invalid_input` subject `accountId` |
| Unknown Module | random UUIDv7, other tenant's Module, or non-UUID path segment | nothing written | 404 `module_not_found` |
| Non-Buyer | Standard owner or Builder session creates or assigns | nothing written; panel shows denial "Only the Buyer can create a Module or assign its Standard owner. Nothing was changed." | 403 `role_denied` |
| No session | missing/invalid Bearer on any Module endpoint | nothing written | 401 `session_invalid` |
| Concurrent reassign | two assignments for one Module at once | both succeed in some order; sequences 1 and 2; exactly one current owner | none |
| Registry down | panel cannot reach registry | Standards shows structure plus a denial-style status that Modules are unavailable | panel catches; no stack |

</intent-contract>

## Code Map

- `packages/contract/src/{index,sign-in,accounts,errors,ids}.ts` -- pattern for wire types + `isX` guards (`isRecord`, `UTC_ISO` in sign-in.ts); `REGISTRY_API_PATHS`, `SESSION_INVALID`, `isRole`, `isUuidV7`. Add a new `modules.ts` beside them and export from `index.ts`.
- `apps/registry/migrations/0001_tenancy.sql`, `0002_sign_in.sql` -- policy shape (`tenant_isolation` with `nullif(current_setting('app.tenant_id', true), '')::uuid`), FORCE RLS, grants; `accounts_tenant_id_id_key UNIQUE (tenant_id, id)` exists (0002) for composite FKs.
- `apps/registry/src/db/schema.ts` -- Drizzle mirror; `TENANT_TABLES` drives `assertRuntimeRoleSafe` (owns-table check). Add `modules`, `moduleOwnerAssignments`.
- `apps/registry/src/db/tenant-scope.ts` -- `withTenant(db, tenantId, fn)` is the only query path; `assertTenantId`.
- `apps/registry/src/sign-in/service.ts` -- `getSession(db, token)` returns `SessionInfo {accountId, tenantId, role}`; reuse it to authenticate Module calls. `SignInService` interface is what `createRegistryServer` takes today.
- `apps/registry/src/http/server.ts` -- fixed `ROUTES` map, `STATUS_BY_CODE`, `readJson` (415/413), `onlyField` (exactly one key), Bearer regex in the `default` branch, `HttpFailure`. Needs: a param route `/v1/modules/{id}/owner`, multi-field body reader, 403/404/409 mappings, a shared bearer→session step, and a second service.
- `apps/registry/src/http/serve-cli.ts` -- wires `createSignInService`; also wire the Module service.
- `apps/registry/src/{errors,ids}.ts` -- `EnvelopeError`, `mintUuidV7`.
- `apps/registry/src/tenancy/queries.ts` -- `toId` pattern for stored ids; account row shape (`name`, `role`).
- `apps/registry/src/tenancy/tenancy.db.test.ts` (~l.110–160) -- asserts the exact table list and per-table RLS/policy; add the two new tables. `apps/registry/src/sign-in/sign-in.db.test.ts` -- DB-suite pattern (throwaway DB, admin migrate, runtime `-c role=dh_registry_app`, CI-fail/skip rule, advisory suite lock constant, `provisionCompany` fixture, HTTP server on port 0).
- `apps/registry/src/http/server.test.ts` -- unit pattern with a fake service; update for the new constructor shape.
- `apps/panel/src/registry.server.ts` -- `call()` returning `ok | refused | unavailable`; add Module calls with Bearer.
- `apps/panel/src/session.server.ts` -- `readSessionToken(request)`.
- `apps/panel/src/routes/standards.tsx` -- current shell ("No Standard is published yet."); becomes loader + action + Modules section. `routes/panel-layout.tsx` already guards the session and supplies role.
- `apps/panel/src/components/{status,button}.tsx`, `src/styles/components.css` (`.standard-form`, `.denial`, `.field-error`), `styles.test.ts` (no hex/px literals, only defined custom properties, accent only on `.button-primary`).
- `apps/panel/src/routes/loaders.test.ts`, `routes/sign-in.test.tsx` -- loader/action and component test patterns (fetch stubbed with `vi.stubGlobal`).

## Tasks & Acceptance

**Execution:**
- [x] `packages/contract/src/modules.ts` (+ export, + `modules.test.ts`) -- `MODULE_KINDS`, `ModuleKind`, `MODULE_KIND_LABELS`, `isModuleKind`, `MODULE_NAME_MAX = 120`, paths `MODULE_API_PATHS = { modules: "/v1/modules" }` + `moduleOwnerPath(id)`, types `ModuleCreateRequest {kind,name}`, `ModuleOwnerAssignRequest {accountId}`, `ModuleOwner`, `ModuleInfo`, `ModuleList {modules, standardOwners: {accountId,name}[]}`, guards `isModuleInfo`, `isModuleList`, codes `ROLE_DENIED`, `MODULE_NOT_FOUND`, `MODULE_NAME_TAKEN` -- one wire contract for registry and panel.
- [x] `apps/registry/migrations/0003_modules.sql` + `src/db/schema.ts` -- tables, unique `lower(name)` per tenant, `UNIQUE (tenant_id, id)` on modules, composite FKs, sequence uniqueness, RLS forced + policies, `SELECT, INSERT` grants only; `TENANT_TABLES` extended -- per Boundaries.
- [x] `apps/registry/src/modules/service.ts` -- `listModules`, `createModule`, `assignModuleOwner` taking a `SessionInfo` (role check first), all via `withTenant`; `createModuleService(db)` interface for the server.
- [x] `apps/registry/src/http/server.ts`, `serve-cli.ts` -- `GET /v1/modules` (200 `ModuleList`), `POST /v1/modules` (201), `POST /v1/modules/{id}/owner` (200); Bearer → `getSession` for each; status map 403/404/409; body must have exactly the declared fields; constructor takes both services.
- [x] registry tests -- unit: server routing/status/body validation with fake services; DB suite `modules/modules.db.test.ts`: every registry-reachable matrix row, plus append-only proof (runtime role `UPDATE`/`DELETE` on both tables fails with permission denied), RLS cross-tenant read with the tenant filter omitted returns no rows, concurrent reassign, and the HTTP API end to end; update the table-list assertion in `tenancy.db.test.ts`.
- [x] `apps/panel/src/registry.server.ts` + `src/routes/standards.tsx` (+ `src/components/modules-section.tsx`, CSS only if needed) -- loader lists Modules; action with `intent` = `create-module` | `assign-owner`; UI: h2 "Modules", table (header cells: Module, Kind, Standard owner) with "No owner" or owner name plus "assigned <UTC ISO> by <name>", per-row form (select labelled "Standard owner for <Module name>" listing `standardOwners`, button-inverse "Assign Standard owner"), create form (text "Module name", select "Kind" with exactly code stack / design system, button-primary "Create Module"), status/denial region; "No Module yet." empty text.
- [x] panel tests -- loader/action for every panel matrix row (stubbed fetch: success, 400 field errors, 409, 403 denial copy, unavailable) and a component test: exactly two kind options, header cells, controls present for Builder role, denial announced in `role="status"`, values kept on invalid submit.
- [x] `README.md` -- the Modules endpoints and that only the Buyer can create Modules and assign owners.

**Acceptance Criteria:**
- Given a Buyer signed in to the panel, when they open Standards and create a Module, then the kind control offers only code stack and design system, and the new Module appears in the Modules table with its name, kind and "No owner", stored with a registry-minted UUIDv7 id.
- Given a Module and a provisioned Standard owner account, when the Buyer assigns it and later reassigns to another Standard owner account, then the table shows exactly one owner (the latest, with when and by whom), and the database holds both assignment rows unchanged with `assigned_by` and `assigned_at`, which the runtime role cannot update or delete.
- Given a Standard owner or Builder signed in, when they submit either form, then the same controls were visible, a denial is announced as a status, and the Modules and assignments are unchanged.
- Given a fresh clone without `REGISTRY_TEST_DATABASE_URL` and without `CI`, when build, typecheck, lint, boundaries and test run, then all pass with DB suites reported skipped.

## Spec Change Log

## Review Triage Log

### 2026-10-11 — Review pass
- verdicts: 24 findings — high 0, medium 0, low 18, false 6, maybe-false 0
- findings:
  - `[false]` `[reject]` BH1: the spec file is missing from the reviewed diff — excluded on purpose; the spec is the claims file given to the edge-case layer only.
  - `[low]` `[patch]` BH2: assignment time printed as a bare ISO string — now wrapped in `<time dateTime>`; UTC ISO-8601 text is the mandated format, so the text stays.
  - `[low]` `[reject]` BH3: re-assigning the current owner shows "Standard owner of X: Y." — the sentence states the current owner and is accurate; a "nothing changed" variant needs the prior owner threaded through the action.
  - `[low]` `[reject]` BH4: `owner?.name ?? ""` and `name: ""` fallbacks hide a contract breach — the assign service always returns an owner and FKs guarantee the account exists; unreachable.
  - `[low]` `[reject]` BH5: unrecognised `invalid_input` (subject body / extra field) shown as "unavailable"; unknown intent uses outage wording — the panel always sends exactly the declared fields, so these arise only from crafted requests.
  - `[low]` `[reject]` BH6: names accept control characters; no NFC normalisation; collation-dependent `lower()` — no everyday path types control characters into a text field; normalisation adds new rules.
  - `[low]` `[patch]` BH7: README endpoint table omits refusals — added 401 to GET and a line on the shared 401/405/413/415/400 refusals and what `module_not_found` covers.
  - `[low]` `[reject]` BH8: `accountNames()` loads every account; no index for the latest-assignment `DISTINCT ON` — pilot Company has a handful of accounts and Modules.
  - `[low]` `[reject]` BH9: owner-route regex hard-codes `/v1/modules` — a prefix change is a deliberate API version change that the HTTP tests would catch.
  - `[low]` `[reject]` BH10: advisory lock in the shared single-key space, taken before the existence check; unique violation would be a 500 — collision with the fixed migration keys is negligible, contention on a non-existent id is harmless, and the lock makes the unique violation unreachable.
  - `[low]` `[reject]` BH11: `ModuleCreateRequest`/`ModuleOwnerAssignRequest` unused by callers — documentation types for the wire; tying them in adds typing churn with no named failure.
  - `[low]` `[reject]` BH12: 401/403 paths drain the body without a size cap — same pattern as the pre-existing 415 path; internal API bound to 127.0.0.1.
  - `[low]` `[reject]` BH13: DB listing test depends on Modules created by an earlier block — the suite runs as a unit (same as the 1.2/1.3 suites); filtering with `-t` is not how CI runs it.
  - `[low]` `[reject]` BH14: panel tests do not cover the Standard owner role, a successful reassign render, 404 rendering, owner forms when the list is null, multi-Module error rows — denial mapping is role-agnostic and covered in the action tests; Standard owner denial is covered at the registry.
  - `[low]` `[reject]` EC1: a NUL in the name becomes a driver error (500) — only from a crafted JSON body; same class as BH6.
  - `[low]` `[reject]` EC2: a non-form body to the `/standards` action throws in `formData()` — crafted request only; React Router forms always send form data; the root error boundary shows no stack.
  - `[low]` `[reject]` EC3: kind and name both invalid show only the kind error — the kind select offers only valid values, so both cannot be invalid from the panel.
  - `[low]` `[patch]` VG1: the "keeps the choice" owner-select test cannot fail — rewritten to change an owned Module's select to another Standard owner, receive a 400 accountId refusal, and assert the chosen id is kept.
  - `[low]` `[reject]` IA1: panel tests stub the registry; no joined panel+registry test — the registry DB suite runs the HTTP API end to end with real sessions; same split as Story 1.3.
  - `[false]` `[reject]` IA2: owners restricted to `Standard owner` accounts versus "a provisioned account" — Standard owner accounts are provisioned accounts; FR-29 says the role is the one FR-4 uses; recorded in Design Notes.
  - `[false]` `[reject]` IA3: named Modules, many per kind, versus one per kind — the story limits kinds, not counts; AD-12's "across Modules" slot rule needs same-kind Modules; recorded in Design Notes.
  - `[false]` `[reject]` IA4: only the latest assignment is visible — the AC requires the change be stored append-only with who and when; the DB suite proves both rows remain and cannot be updated or deleted.
  - `[false]` `[reject]` IA5: "only that person can publish" not exercised — publishing is Story 1.5, whose ACs own those refusals.
  - `[false]` `[reject]` IA6: Standard-owner denial may be untested — `modules.db.test.ts` `it.each` covers "a Standard owner" and "a Builder" for both create and assign.

## Design Notes

- **Several Modules per kind:** the story never limits a kind to one Module, and AD-12 rejects a same-slot clash "across Modules" with Module kind in the slot, which only arises with two Modules of one kind. So Modules carry a required name, unique per tenant.
- **Eligible owners are `Standard owner` accounts:** each account has exactly one role, and the glossary defines the Standard owner as the person accountable for a Module; assigning a Builder or Buyer account would give it a second role. This also keeps the owner picker from listing (naming) Builders.
- Owner history is derived, never overwritten: `current owner = argmax(sequence)`. Example:
  ```sql
  SELECT owner_account_id FROM module_owner_assignments
  WHERE tenant_id = $t AND module_id = $m ORDER BY sequence DESC LIMIT 1;
  ```
- The role check precedes validation so a non-Buyer learns nothing about Module ids or accounts.

## Verification

**Commands:**
- `docker compose up -d --wait postgres` then `REGISTRY_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres pnpm test` -- all suites pass, DB suites not skipped.
- `pnpm run build && pnpm run typecheck && pnpm run lint && pnpm run boundaries` -- exit 0.
- `pnpm test` without the env var -- passes, DB suites skipped with a printed reason.

**Manual checks:**
- Migrate + provision a Company (Buyer, two Standard owners, Builder), run registry `serve` (outbox) and the panel; sign in as Buyer: create both kinds, assign, reassign (table shows latest owner with time and Buyer name); sign in as Builder: same controls visible, submitting shows the denial; check keyboard order and 320px width.

## Auto Run Result

Status: done

**Summary:** The Buyer can create Modules (kind code stack or design system, with a name unique per Company) and assign or reassign each one's Standard owner. The registry gains migration 0003: `modules` (no owner column) and the insert-only `module_owner_assignments` log (per-Module `sequence`, `assigned_by`, `assigned_at`), both with forced RLS and `SELECT, INSERT` grants only. A Module service (role check first, advisory lock per Module, same-owner no-op) sits behind Bearer-authenticated endpoints `GET /v1/modules`, `POST /v1/modules` and `POST /v1/modules/{id}/owner`. The panel's Standards surface gains a Modules section: a table with header cells and the current owner (with when and by whom), a per-Module owner form, and a create form. Every control is shown to every role, and a refusal is announced as a denial.

**Files changed:**
- `packages/contract/src/{modules,guards,index,sign-in}.ts` (+ `modules.test.ts`): Module wire types, guards, paths and error codes; shared guard helpers.
- `apps/registry/migrations/0003_modules.sql`, `src/db/{schema,pg-errors}.ts`: tables, RLS, grants; unique-violation helper moved out of `tenancy/provision.ts`.
- `apps/registry/src/modules/service.ts` (+ `modules.db.test.ts`): list, create and assign.
- `apps/registry/src/http/{server,serve-cli}.ts`, `src/index.ts` (+ `server.test.ts`): Module routes, 403/404/409, both services wired.
- `apps/registry/src/{sign-in/sign-in.db.test.ts,tenancy/tenancy.db.test.ts}`: new server constructor, new tables and migration count.
- `apps/panel/src/{registry.server.ts,routes/standards.tsx,components/modules-section.tsx,styles/*.css}` (+ `standards.action.test.ts`, `standards.test.tsx`, `registry.server.test.ts`, `components.test.tsx`): the Modules section.
- `README.md`: the Modules endpoints and their refusals; only the Buyer creates Modules and assigns owners.

**Review findings:** 24 findings: high 0, medium 0, low 18, false 6.
- **Patched (3, all low):** BH2 (`<time dateTime>` around the assignment time), BH7 (README refusals), VG1 (owner-select "keeps the choice" test could not fail; now changes an owned Module's select and asserts the chosen id is kept).
- **Deferred:** none.
- **Rejected:** 15 low and 6 false, each with its reason in the triage log.

**Follow-up review recommended: false.** Patched counts: high 0, medium 0, low 3.

**Verification:**
- `pnpm run build`, `typecheck`, `lint` and `boundaries` exit 0 (re-run after the patches).
- With `REGISTRY_TEST_DATABASE_URL` (compose PG18): all turbo test tasks pass. Registry 231, panel 122 passed + 1 skipped (the declared Story 1.3 contrast exception), contract 99, boundaries 16.
- Without the URL: all pass; the three DB suites print a skip reason.
- Matrix audit: every I/O row has a covering test that ran (registry rows in `modules.db.test.ts` and `server.test.ts`; panel rows in `standards.action.test.ts` and `standards.test.tsx`).
- Manual browser checks (keyboard order, 320px) were not performed in this unattended run.

**Residual risks:**
- The database does not itself require the owner account's role to be `Standard owner` or the assigner to be the Buyer; the service enforces both.
- Owner eligibility is limited to `Standard owner` accounts, and a Company may have several Modules of one kind (see Design Notes); both are readings chosen on the human's behalf.
- Module names accept control characters, and a NUL from a crafted JSON body gives a 500.
- No browser check of the new section in this run.
