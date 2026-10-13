---
title: 'Story 2.5: Child-Project creation requires a Buyer-granted permission'
type: 'feature'
created: '2026-10-12'
status: 'done'
baseline_commit: 'c7e89444a09f09800d6e6b0d170b1a78e5cdf69d'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-4-buyer-marks-locked-rules-that-descendants-cannot-override.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** Only the Buyer can create Projects today, so teams cannot extend the Project tree themselves (FR-7).

**Approach:**
- The Buyer grants or revokes, per account and per Project, the permission to create child Projects directly under that Project. Each grant and revoke is stored append-only, with who made the change and when.
- An account holding the grant on P may create a child of P. Without it, the account gets a denial and nothing is created.
- A child created this way inherits every Locked rule of P and of P's ancestors through the existing resolver.

## Boundaries & Constraints

**Always:**
- **Storage.** Add migration `0008_child_permissions.sql` with table `child_permission_changes`:
  - Columns: `id`, `tenant_id`, `project_id`, `account_id`, `sequence` (per tenant, max + 1 under the bundle lock), `granted boolean`, `changed_by`, and `changed_at` (default `now()`).
  - Same-tenant FKs to `projects` (`project_id`) and `accounts` (`account_id`, `changed_by`), and `UNIQUE (tenant_id, sequence)`.
  - RLS enabled and forced with the `tenant_isolation` policy. Grant only `SELECT, INSERT` to `dh_registry_app`.
  - The current state of a (Project, account) pair is its highest-sequence row. No row means not granted.
  - Mirror the table in `schema.ts` and add it to `TENANT_TABLES`.
- **Scope of a grant.** A grant on P covers creating direct children of P only, not grandchildren. Re-parenting stays Buyer-only. The Buyer never needs a grant.
- **Contract** (new `child-permissions.ts`, re-exported from `index.ts`, no plan names):
  - `ChildPermission { account: AccountRef & { role: Role }, grantedAt, grantedBy: AccountRef }`.
  - `ChildPermissionList { project: ProjectRef, grants: ChildPermission[], eligibleAccounts: (AccountRef & { role })[] }`.
    - `grants` holds only the current grants, ordered by account name, then id.
    - `eligibleAccounts` holds every non-Buyer account of the tenant, ordered by name, then id.
  - `ChildPermissionRequest { accountId, granted: boolean }` and `ChildPermissionState { project: ProjectRef, account, granted, changedAt: string | null, changedBy: AccountRef | null }`.
  - `childPermissionsPath(projectId)` = `/v1/projects/{id}/child-permissions`.
  - `CHILD_PERMISSION_DENIED = "child_permission_denied"`, mapped to 403.
  - Guards for the response types.
- **`GET /v1/projects/{id}/child-permissions`** is open to every role:
  1. 401 without a session.
  2. A malformed, unknown or other tenant's Project → `404 project_not_found`, subject `projectId`.
  3. Otherwise 200 `ChildPermissionList`.
- **`POST /v1/projects/{id}/child-permissions`** takes exactly `{ accountId, granted }`. Checks run under the bundle lock, first failure wins, and nothing is written on a failure:
  1. The Project is the tenant's → `404 project_not_found`, subject `projectId`.
  2. Any role but the Buyer → `403 role_denied`, message "only the Buyer can grant or revoke the permission to create child Projects; nothing was changed".
  3. An invalid body → `400 invalid_input`, subject `accountId`, `granted` or the extra key.
  4. The account is not one of this tenant's accounts (including a malformed id) → `400 invalid_input`, subject `accountId`, message "accountId must be the id of an account of this Company that is not the Buyer; nothing was changed". This is the same treatment as an ineligible Module owner in `modules/service.ts:54`.
  5. The account is the Buyer → the same `400 invalid_input`, subject `accountId`.
  6. The same state as now → 200 and nothing is written.
  7. Insert the row and return 200 `ChildPermissionState`.
- **`createProject`** is no longer Buyer-only. The HTTP layer stops calling `requireBuyer` before reading the body. The service checks, first failure wins, with nothing written:
  1. The body → 400.
  2. The parent is the tenant's → 404, subject `parentId`.
  3. The caller is the Buyer, or holds a current grant on the parent; otherwise `403 child_permission_denied`, subject `parentId`, message "you have no permission to create a child Project under this Project; nothing was created".
  4. Core whole-bundle validation.
  5. Insert, as today. `created_by` and `changed_by` are the caller.

  This runs under the bundle lock, so a revoke that commits first wins.
- **Inheritance.** No new resolution code. The existing resolver and the 2.4 locked ids already give C every Locked rule of P and its ancestors. Prove it with a test.
- **Panel** (imports `contract` only, never hides a control by role):
  - The `/projects` loader defers `permissions` for the selected Project, chained off the tree in the same way as `effective`.
  - Under the Effective set, a section with h2 "Child-Project permission for <name>":
    - **Grant list.** It shows each current grant as "<account> (<role>), granted by <Buyer> on <date>", where `<date>` is the UTC date from the ISO string, YYYY-MM-DD. Each grant has a "Revoke" button (`intent=permission`, hidden `accountId`, hidden `granted=false`).
    - **Empty grant list.** It reads "No account has this permission yet. The Buyer can always create child Projects."
    - **Grant form.** An "Account" select lists `eligibleAccounts` that are not yet granted, as "<name> (<role>)". The submit button is "Grant permission" (`granted=true`). When none is left, show "Every account already has this permission." instead of the form.
    - **States.** The section has its own Suspense with `aria-busy` and "Loading the child-Project permission…". On failure it shows "The child-Project permission is unavailable right now. Try again in a few minutes." The tree, the table and the forms stay.
  - **Action results.**
    - Success notices: "<account> can now create child Projects under <Project>." and "<account> can no longer create child Projects under <Project>."
    - `role_denied` → "Only the Buyer can grant or revoke the permission to create child Projects. Nothing was changed."
    - `invalid_input` with subject `accountId` → "Choose an account of this Company other than the Buyer. Nothing was changed."
    - `project_not_found` → the existing `projectNotFound`.
    - `session_invalid` → a redirect to sign-in.
    - Anything else → `actionUnavailable`.
  - **Create refusal.** The create intent maps `child_permission_denied` to "You do not have permission to create a child Project under <parent name>. Ask the Buyer for it. Nothing was created."
- **README.** Add Child-Project permission: the endpoints, the check orders, the scope of a grant, and the change to create.

**Never:** No plan gating (2.6) and no per-Project build grant (Epic 3). No grant inheritance down the tree. No UPDATE or DELETE on the table, no `core` import in the panel, and no new dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Grant | Buyer grants Builder on P | 200 `granted: true`; the GET lists the Builder with grantedBy = Buyer and grantedAt; one row | none |
| Revoke | Buyer revokes it | A new row `granted: false`; the GET no longer lists the grant; history holds 2 rows | none |
| Same state | Grant twice / revoke a never-granted pair | 200, no row written | none |
| Builder without grant | Builder creates a child of P | — | 403 `child_permission_denied`; no Project and no change row |
| Builder with grant | Builder creates C under P | 201, C's parent is P, `created_by` = Builder | none |
| Grant not inherited | Builder granted on P creates under P's child C | — | 403 `child_permission_denied` |
| Revoked | Builder creates after the revoke | — | 403 |
| Inherits Locks | Locked "X" at root R and locked "Y" at P; Builder creates C under P | C's Effective set holds both, `locked: true`, sources R and P | none |
| Owner/Builder writes grant | Non-Buyer POSTs a grant | — | 403 `role_denied`; nothing written |
| Bad input | Unknown/foreign/malformed Project; foreign/malformed account; the Buyer as account; bad body | — | 404 `project_not_found` / 400 `invalid_input` (subject `accountId` or the body field) |
| Buyer create | Buyer creates anywhere with no grants | 201, as before | none |
| Panel | Builder submits create without grant; Buyer grants from the section | Create denial naming the parent; grant notice, and the list shows the grant | panel maps it |

</intent-contract>

## Code Map

- `apps/registry/migrations/0007_locked_rules.sql` -- the exact template for the append-only table. `src/db/schema.ts` holds the mirror and `TENANT_TABLES`. `tenancy.db.test.ts` asserts the table list and the migration count, so bump them.
- `apps/registry/src/locked-rules/{current,service}.ts` -- the pattern to copy: latest row by `DISTINCT ON`, `nextSequence`, body validator, bundle lock, `toState`. Add `apps/registry/src/child-permissions/{current,service}.ts`.
- `apps/registry/src/projects/service.ts` -- `createProject` (it calls `assertTreeBuyer` first today; the new order is described in Boundaries), `projectNotFound`, `currentProjects` from `projects/current.ts`, and `assertTreeBuyer` (keep it for `changeParent`).
- `apps/registry/src/modules/service.ts` -- `accountNames`, `accountRef` and `toId`, and the `standardOwners` query (:77) as the pattern for `eligibleAccounts`. `assignModuleOwner` shows how an unknown account is refused today; reuse its `invalid_input` treatment.
- `apps/registry/src/http/server.ts` -- the `PROJECT_API_PATHS.projects` POST case: remove `requireBuyer(req, session, assertTreeBuyer)`. Add `PROJECT_CHILD_PERMISSIONS_ROUTE` (`/^\/v1\/projects\/([^/]+)\/child-permissions$/`, GET/POST) and the status mappings. `src/index.ts` and `serve-cli.ts` handle the wiring.
- Existing tests that pin "Builder → 403 before reading the body" on `POST /v1/projects` must change to the new order: `apps/registry/src/http/server.test.ts:465,716` and `projects/projects.db.test.ts:317` (a Builder without a grant now gets 403 `child_permission_denied` with a valid body, and 400 with a malformed one).
- `packages/contract/src/projects.ts` / `locked-rules.ts` -- the guard style. `modules.ts` holds `AccountRef`; `accounts.ts` holds `Role`/`isRole`.
- `apps/panel/src/registry.server.ts` -- add `getChildPermissions(token, projectId)` and `setChildPermission(token, projectId, accountId, granted)`.
- `apps/panel/src/routes/project-tree.tsx` -- the loader (`effective` chaining via `selectedProject`), `action` intents, `refusal` and the lock refusal switch. Add a `permissions` promise and `intent=permission`. `ProjectTreeActionData.intent` gains `"permission"`.
- `apps/panel/src/components/project-tree.tsx` -- `PROJECT_TREE_COPY`, `EffectiveSetSection` as the section pattern, and the `Button` variants. `styles/components.css` takes tokens only (`styles.test.ts`).
- Panel tests: `routes/project-tree.test.tsx` and `project-tree.action.test.ts` (fixtures need the `permissions` fetch), plus `registry.server.test.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contract/src/child-permissions.ts` (+ `index.ts`, test) -- the types, path, codes and guards.
- [x] `apps/registry/migrations/0008_child_permissions.sql`, `src/db/schema.ts` -- the table, RLS and grants, plus the mirror and `TENANT_TABLES`.
- [x] `apps/registry/src/child-permissions/{current,service}.ts` -- `hasChildPermission`, `listChildPermissions` and `setChildPermission`.
- [x] `apps/registry/src/projects/service.ts` -- the new `createProject` check order with the grant check.
- [x] `apps/registry/src/http/server.ts`, `src/index.ts`, `serve-cli.ts` -- the route, the statuses, and the removal of the pre-body Buyer check on create.
- [x] registry tests -- `server.test.ts`: route, methods, statuses and the new create order. A new `child-permissions/child-permissions.db.test.ts` over HTTP covering every registry row of the matrix, plus the migration's RLS and grants, refused UPDATE/DELETE, and tenant isolation. Update the existing tests listed in the Code Map.
- [x] `apps/panel/src/registry.server.ts` (+ test) -- the two calls.
- [x] `apps/panel/src/routes/project-tree.tsx`, `components/project-tree.tsx`, `styles/components.css` -- the section with its states, the permission intent, and the create mapping.
- [x] panel tests -- the loader's deferred `permissions` for the selected id, the list text and Revoke, the empty and all-granted states, the grant select options, busy/unavailable with the tree still visible, the action notices and refusals, and the create `child_permission_denied` text naming the parent.
- [x] `README.md` -- the Child-Project permission section, and the create endpoint rows updated.

**Acceptance Criteria:**
- Given the Buyer on the Project tree surface with P selected, when they grant a Builder the permission, then the notice names the Builder and P, and the permission section lists the Builder with the Buyer as granter and the date.
- Given a fresh clone without `REGISTRY_TEST_DATABASE_URL`, when build, typecheck, lint, boundaries and test run, then all pass with the DB suites skipped.

## Spec Change Log

## Review Triage Log

### 2026-10-13 — Review pass
- verdicts: 23 findings — high 0, medium 0, low 19, false 4, maybe-false 0
- findings:
  - `[low]` `[patch]` EC1: the README order for the grant POST omits the transport refusals (415/413/400 `body`) that come before 404/403. Fixed: the README states transport-first, mirroring the parent-change row.
  - `[low]` `[patch]` EC2: the same root cause as EC1 (the 400 `body` before 404 on an unknown Project). Fixed by the same README change.
  - `[low]` `[patch]` EC3: the README's 400 subjects for a grant omit `body`. Fixed: the README lists `body`.
  - `[low]` `[patch]` VG1: the real create order "parent 404 before permission 403" for non-Buyers was pinned only by a fake. Fixed: a DB test with a Builder and an owner using a foreign/unknown parent expects 404, subject `parentId`.
  - `[low]` `[patch]` VG2: the real grant order "role before body/account" was pinned only by a fake. Fixed: a DB test where a Builder sends a bad body or the Buyer's account expects 403 `role_denied`.
  - `[low]` `[reject]` VG3: no concurrency test for revoke versus create. The check runs after `lockBundle` in the same transaction (visible in review), the same lock whose serialisation the projects suite proves; a race test would be non-deterministic.
  - `[low]` `[patch]` BH1: the same as EC1. Fixed by the same README change.
  - `[low]` `[reject]` BH2: no transport-refusal test on the new POST. `readJson` is shared and already tested on the other routes; a new test would add nothing specific.
  - `[low]` `[patch]` BH3: the create order in the README omits the transport refusals. The same root cause as EC1; fixed by the same README change.
  - `[low]` `[reject]` BH4: the race claim is untested. The same as VG3.
  - `[low]` `[patch]` BH5: the README tree intro still said only the Buyer builds the tree. Fixed: it names permission holders too.
  - `[low]` `[reject]` BH6: the create form does not show where a non-Buyer may create. This is a UX enhancement nobody asked for; the permission section of each Project already lists its grants.
  - `[low]` `[reject]` BH7: `ref()` falls back to an empty name while `roledRef()` throws. `ref` follows the existing `accountRef` fallback; an account cannot disappear (FKs, no DELETE grant).
  - `[low]` `[reject]` BH8: the account/project guards are duplicated. This follows the existing pattern (same call as 2.4 BH5).
  - `[low]` `[reject]` BH9: three bundle-lock reads per page load. This is the established read-consistency pattern (2.3 EC1, 2.4 EC2), and fine at pilot scale.
  - `[low]` `[reject]` BH10: the guard would accept the Buyer in `eligibleAccounts`. The registry is the only producer and filters the Buyer out; a wrong offer would still be refused with 400.
  - `[low]` `[patch]` BH11: the Account select started on the first account, so one stray click granted it. Fixed: a placeholder "Choose an account" option (value ""), which maps to the accountId refusal text.
  - `[low]` `[reject]` BH12: the panel answers 503 for an unmapped `invalid_input`. The same as the existing intents (2.4 BH2); the form's hidden values make it unreachable for users.
  - `[false]` `[reject]` BH13: the spec checkboxes and logs are empty. The workflow fills them at finalisation.
  - `[low]` `[patch]` BH14: it is undocumented that a grant follows its Project through a re-parent. Fixed: one README sentence.
  - `[false]` `[reject]` IA1: the intent-alignment readings were descriptive. The diff implements the registry rule with a panel layer (A1 + partial A2, B1, C1, D1, E1), as specified.
  - `[false]` `[reject]` IA2: grants extend to Standard owners (B1). The story says "specific accounts"; a Builder is the example, not a restriction.
  - `[false]` `[reject]` IA3: no panel test for a granted Builder's successful create or a rendered revoke. The create success path is unchanged panel code already covered by the 2.1 tests, revoke is covered at the action level, and the panel tests use stubs, as in every earlier story.

## Design Notes

- **Why the create check order changes.** With grants, "may this account create here?" depends on the parent named in the body. So the body and the parent must be read before deciding. The permission check still comes before core validation and before any write.
- **Why a distinct code.** `role_denied` means "this role can never do this". `child_permission_denied` means "ask the Buyer", and the panel copy says so.

## Verification

**Commands:**
- `docker compose up -d --wait postgres` then `REGISTRY_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres pnpm test` -- expected: all suites pass, with the DB suites run.
- `pnpm run build && pnpm run typecheck && pnpm run lint && pnpm run boundaries` -- expected: exit 0.
- `pnpm test` -- expected: passes, with the DB suites skipped.

## Auto Run Result

Status: done

**Summary:** The Buyer grants or revokes, per account and per Project, the permission to create child Projects directly under that Project.
- **Storage.** Each change is stored append-only in `child_permission_changes` (migration 0008, RLS, SELECT/INSERT only), with who made it and when.
- **Endpoints.** `GET /v1/projects/{id}/child-permissions` (every role) lists the current grants and the eligible non-Buyer accounts. `POST` with `{ accountId, granted }` is Buyer-only: other roles get `403 role_denied`, and an unknown, foreign or Buyer account gets `400 invalid_input`. Setting the same state again writes nothing.
- **Creating a Project.** `POST /v1/projects` is no longer Buyer-only. It checks body → parent → (the Buyer, or a current grant on the parent; otherwise `403 child_permission_denied`) → core validation, all under the bundle lock.
- **Scope of a grant.** It covers direct children only and is never inherited down the tree. Re-parenting stays Buyer-only.
- **Locked rules.** A child created with the permission inherits every Locked rule of P and of P's ancestors through the existing resolver, and a DB test proves it.
- **Panel.**
  - On the Project tree surface, a "Child-Project permission for <name>" section lists the grants with a Revoke button, plus a grant form with a placeholder account.
  - It has its own loading, empty, all-granted and unavailable states.
  - A Builder's create without the permission shows a denial that names the parent.

**Files changed:**
- `packages/contract/src/child-permissions.ts` (+ test, `index.ts`): the types, path, `CHILD_PERMISSION_DENIED` and the guards.
- `apps/registry/migrations/0008_child_permissions.sql`, `src/db/schema.ts`: the table and its mirror.
- `apps/registry/src/child-permissions/{current,service}.ts` (+ DB test): the grant reads, the list and the set.
- `apps/registry/src/projects/service.ts`: the new create check order with the grant check.
- `apps/registry/src/http/server.ts`, `index.ts`, `serve-cli.ts` (+ tests): the route, the 403 mapping, and no pre-body Buyer check on create.
- The existing registry tests for the old create order were updated, and `tenancy.db.test.ts` now counts 8 migrations.
- `apps/panel/src/registry.server.ts`, `routes/project-tree.tsx`, `components/project-tree.tsx`, `styles/components.css` (+ tests): the client calls, the permission intent, the section and the create denial.
- `README.md`: the Child-Project permission section, the check orders, and the tree intro.

**Review findings:** 23 findings: high 0, medium 0, low 19, false 4.
- **Patched (8 rows in 5 entries):**
  - EC1/EC2/EC3/BH1/BH3: the README transport-first orders and the `body` subject.
  - BH5/BH14: the README tree intro, and that a grant follows a re-parent.
  - VG1: a real-service test that a parent 404 beats a permission 403.
  - VG2: a real-service test that a role 403 beats a body/account 400.
  - BH11: a placeholder account option.
- **Deferred:** none.
- **Rejected:** 11 low and 4 false, each with its reason in the triage log.

**Follow-up review recommended: false.** Patched counts: high 0, medium 0, low 5 entries.

**Verification:**
- `pnpm run build`, `typecheck`, `lint` and `boundaries` exit 0 ("no violations").
- With `REGISTRY_TEST_DATABASE_URL`, all pass:

  | Package | Tests passed |
  |---|---|
  | registry | 529 |
  | panel | 294, plus 1 skipped (the existing one) |
  | contract | 186 |
  | core | 56 |
  | boundaries | 16 |

- Without the database URL, `pnpm test` passes with the DB suites skipped.
- Matrix audit: every row has a covering test that ran:
  - `child-permissions.db.test.ts`
  - `server.test.ts`
  - `project-tree.test.tsx` and `project-tree.action.test.ts`

**Residual risks:**
- Choices made on the human's behalf:
  - A grant covers direct children only.
  - Any non-Buyer account (Standard owners too) can be granted.
  - A non-Buyer's create body is validated before the permission check, so a malformed body gets 400, not 403.
  - Unknown accounts are `invalid_input`, matching the Module-owner rule.
- No concurrency test for a revoke against a create; the check runs under the same bundle lock.
- A grant stays with its Project through a re-parent, and stays with an account whatever its role.
- The panel was checked in jsdom only.
