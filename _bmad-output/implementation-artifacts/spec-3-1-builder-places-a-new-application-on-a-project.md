---
title: 'Story 3.1: Builder places a new Application on a Project'
type: 'feature'
created: '2026-10-13'
status: 'done'
baseline_commit: '1ae86aba10c95533a43181018bfd49f0e71f3fb5'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-5-child-project-creation-requires-a-buyer-granted-permission.md'
warnings: ['oversized']
deferred:
  - summary: >-
      A U+0000 character in a free-text field reaches PostgreSQL and fails as a 500 instead of a 400.
    evidence: |-
      PostgreSQL text columns reject NUL bytes. No registry validator (Project name, level name, Standard text, and now the Application description) guards against it, so this is a project-wide pre-existing gap. The new POST /v1/applications inherits it.
    location: >-
      apps/registry/src/applications/validate.ts:32
    severity: low
  - summary: >-
      The Applications list's createdAt-then-id order, including the id tie-break, is not pinned by a test where insertion order differs.
    evidence: |-
      applications.db.test.ts inserts rows in the expected order, so dropping the orderBy or the id tie-break still passes on a small heap table. Pin it when Story 3.5 adds registrations.
    location: >-
      apps/registry/src/applications/service.ts (applicationRows)
    severity: low
  - summary: >-
      Panel forms do not focus their first field on open, move focus to an invalid field, or leave on Esc, as the epic's form rules ask.
    evidence: |-
      No existing panel form (Standards, design system, Project tree, child permission) implements these behaviours; the new New-application form follows the same pattern. A panel-wide pass should add them.
    location: >-
      apps/panel/src/components/new-application.tsx
    severity: low
---

<intent-contract>

## Intent

**Problem:** No Application exists anywhere yet: a Builder cannot place one on the Project tree, and the Buyer's Inventory is a fixed empty shell (FR-8, SPEC CAP-3).

**Approach:**
- The Buyer grants or revokes, per account and per Project, a **build grant** (append-only, the exact 2.5 pattern, separate from the child-Project permission).
- On a new **New-application flow** panel surface, a Builder submits a description and a Project. The registry mints a UUIDv7, creates the Application bound to exactly that Project, flagged as created by the New-application flow, after whole-bundle validation in core.
- Inventory lists every Application of the Company at once, with no Builder name.

## Boundaries & Constraints

**Always:**
- **Build grant storage.** Migration `0009_build_grants.sql`, table `build_grant_changes`: a copy of `child_permission_changes` (0008) in columns, FKs, `UNIQUE (tenant_id, sequence)`, pair index, RLS forced with `tenant_isolation`, `SELECT, INSERT` only to `dh_registry_app`. The current state of a (Project, account) pair is its highest-sequence row; no row = not granted. A grant covers that Project only, is never inherited, and stays with its Project through a re-parent. The Buyer never needs one.
- **Application storage.** Same migration, table `applications`: `id` (registry-minted UUIDv7), `tenant_id`, `project_id`, `description text`, `from_flow boolean`, `sequence` (per tenant, max + 1 under the bundle lock: the Application-list version of the bundle input), `created_by`, `created_at` (default `now()`). Same-tenant FKs to `projects` and `accounts`, `UNIQUE (tenant_id, id)`, `UNIQUE (tenant_id, sequence)`, RLS forced, `SELECT, INSERT` only. Mirror both tables in `schema.ts` and add them to `TENANT_TABLES`.
- **Contract.**
  - New `build-grants.ts`: `BuildGrant`, `BuildGrantList`, `BuildGrantRequest`, `BuildGrantState` with exactly the shapes of the 2.5 `ChildPermission*` types (reuse `RoledAccountRef`); `buildGrantsPath(projectId)` = `/v1/projects/{id}/build-grants`; `BUILD_GRANT_DENIED = "build_grant_denied"` (403); guards.
  - New `applications.ts`: `ApplicationInfo { id, description, project: ProjectRef, fromFlow: boolean, createdAt }`; `ApplicationList { applications: ApplicationInfo[] }` ordered by `createdAt`, then id; `ApplicationCreateRequest { description, projectId }`; `APPLICATION_API_PATHS.applications` = `/v1/applications`; `APPLICATION_DESCRIPTION_MAX = 500`; guards. No `createdBy` on the wire.
  - Re-export both from `index.ts`.
- **Core.** `BundleInput` gains optional `applications?: readonly { id: string; projectId: string }[]`. `validateBundleInput` checks it right after the tree rule: duplicate id → `invalid_input` (subject `applicationId`); a `projectId` not in the proposed tree → `project_not_found` (subject `projectId`). Order-independent, pure.
- **`GET|POST /v1/projects/{id}/build-grants`.** The same checks, order, messages and same-state no-op as 2.5 `child-permissions`, with "build" wording: the role message is "only the Buyer can grant or revoke the build grant; nothing was changed".
- **`GET /v1/applications`** (every role): 401 without a session, otherwise 200 `ApplicationList` for the tenant, read under the bundle lock.
- **`POST /v1/applications`** takes exactly `{ description, projectId }`. Under the bundle lock, first failure wins, nothing written on any failure:
  1. Body not an object / extra key → 400 `invalid_input`, subject `body` / the key.
  2. `description` not a string, or trimmed empty or longer than 500 → 400, subject `description`.
  3. `projectId` absent, not a string, or empty → 400, subject `projectId`, message "choose a Project for the Application; nothing was created".
  4. `projectId` not a Project of the tenant (malformed included) → 404 `project_not_found`, subject `projectId`.
  5. Caller is not the Buyer and holds no current build grant on that Project → 403 `build_grant_denied`, subject `projectId`, message "you have no build grant on this Project; nothing was created".
  6. Core `validateBundleInput` over the tree, live Standards, current locked ids and every Application plus the new one; its error as is.
  7. Insert with `from_flow = true`, `created_by` = caller; 201 `ApplicationInfo` (description stored trimmed).
- **Panel** (imports `contract` only; never hides a control by role):
  - **Nav.** `PANEL_NAV` gains "New-application flow" → `/new-application`, appended last.
  - **`/new-application` route.** h1 "New-application flow". Form: "Description" textarea, "Project" select with a "Choose a Project" placeholder (value "") then every Project in tree order, primary (gold) button "Place the Application". Loader defers the tree; busy "Loading the Projects…", failure "The Projects are unavailable right now. Try again in a few minutes." with the form structure kept.
  - **Action results.** 201 → status notice "The Application is placed on <Project>. The Buyer sees it on Inventory now." `invalid_input` subject `projectId` → ink text under the Project field "A description with no Project is not created. Choose a Project." with the description kept. Subject `description` → under the Description field "Describe the Application in 1 to 500 characters. Nothing was created." `build_grant_denied` → denial status "You have no build grant on <Project>. Ask the Buyer for one. Nothing was created." `project_not_found` → "That Project no longer exists. Choose another Project. Nothing was created." `session_invalid` → redirect to sign-in. Anything else → the existing unavailable copy.
  - **Build grant section** on the Project tree surface, under the child-Project permission section, a copy of its structure: h2 "Build grant for <name>", list "<account> (<role>), granted by <Buyer> on <YYYY-MM-DD>" with "Revoke", empty "No account has a build grant here yet. The Buyer can always place Applications.", grant form (placeholder "Choose an account", button "Grant build"), all-granted "Every account already has a build grant here.", own Suspense/busy/unavailable. Notices "<account> can now place Applications on <Project>." / "<account> can no longer place Applications on <Project>."; `role_denied` → "Only the Buyer can grant or revoke the build grant. Nothing was changed."; `invalid_input` subject `accountId` → the 2.5 copy. Intent `build`.
  - **Inventory.** Loader defers `GET /v1/applications`. A table with caption "Applications", columns Application (description), Project, Placement ("New-application flow" when `fromFlow`, else "Registered"), Listed (YYYY-MM-DD), and the line "Listed before any Gate run. Compilation evidence fills in later." Empty: "No Application yet." Failure: "The Inventory is unavailable right now. Try again in a few minutes." No Builder name anywhere.
- **README.** Sections for the build grant and Applications: endpoints, check orders, scope.

**Never:** No Boilerplate, identification file, endpoint URL, agent tool or registration (3.2–3.5). No plan gating, no band check. No UPDATE/DELETE on the new tables, no `createdBy` on the wire, no `core` import in the panel, no new dependency, no change to the child-permission rules.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Grant / revoke / same state | Buyer POSTs build grant for Builder on P, then revoke, then revoke again | 200 each; 2 rows total; GET lists the grant only after the first | none |
| Non-Buyer grants | Builder/Owner POSTs a build grant | — | 403 `role_denied`; nothing written |
| Bad grant input | Unknown/foreign/malformed Project; foreign/malformed/Buyer account; bad body | — | 404 `project_not_found` / 400 `invalid_input` |
| Place with grant | Builder granted on P posts `{description, projectId: P}` | 201, UUIDv7 id, project P, `fromFlow: true`; GET `/v1/applications` (as Buyer) lists it | none |
| Buyer places | Buyer, no grants | 201 | none |
| No Project | `projectId` absent or "" | — | 400 `invalid_input`, subject `projectId`; no row |
| No grant | Builder without grant on P (or grant on P's parent only, or revoked) | — | 403 `build_grant_denied`; no row |
| Child permission is not a build grant | Builder holds only the child-Project permission on P | — | 403 `build_grant_denied` |
| Unknown Project | foreign/unknown/malformed `projectId` | — | 404 `project_not_found`, subject `projectId` |
| Bad description | missing, blank, 501 chars, extra key | — | 400, subject `description` / key |
| Core apps rule | duplicate app id; app on a Project not in the tree | — | `invalid_input` subject `applicationId`; `project_not_found` subject `projectId` |
| Tenant isolation | Company B lists Applications | Only B's | RLS |

</intent-contract>

## Code Map

- `apps/registry/migrations/0008_child_permissions.sql` -- template for both new tables; `tenancy.db.test.ts` asserts the table list and migration count (bump to 9).
- `apps/registry/src/child-permissions/{current,service}.ts` -- copy for `apps/registry/src/build-grants/{current,service}.ts` (`hasBuildGrant`, `listBuildGrants`, `setBuildGrant`); reuse `toId` from `modules/service.ts`, `projectNotFound` from `projects/service.ts`, `lockBundle` / `liveSet` from `standards/service.ts`, `currentLockedIds` from `locked-rules/current.ts`, `currentProjects` / `treeNodes` from `projects/current.ts`, `mintUuidV7` from `ids.ts`.
- `apps/registry/src/projects/service.ts` -- `createProject` / `assertBundleValid` show the lock → checks → core → insert shape for the new `apps/registry/src/applications/service.ts`.
- `apps/registry/src/db/schema.ts` -- `childPermissionChanges` mirror and `TENANT_TABLES`.
- `apps/registry/src/http/server.ts` -- `PROJECT_CHILD_PERMISSIONS_ROUTE` (:82, :93, :110, :318) is the pattern for the build-grants route; `STATUS_BY_CODE` (:57) gets `build_grant_denied: 403`; add `/v1/applications` (GET/POST, 201 on create) and `applications`/`buildGrants` to the services object (:143). Wire in `src/index.ts` and `serve-cli.ts`.
- `packages/core/src/tree.ts` -- `BundleInput`, `validateBundleInput`; tests in `packages/core/src/*.test.ts`.
- `packages/contract/src/child-permissions.ts` -- guard/type style; `projects.ts` `projectPath`; `standards.ts` `ProjectRef`.
- `apps/panel/src/registry.server.ts` -- add `getBuildGrants`, `setBuildGrant`, `getApplications`, `createApplication`.
- `apps/panel/src/routes/project-tree.tsx`, `components/project-tree.tsx` -- the `permissions` deferred loader, `intent=permission` action and the child-permission section are the exact pattern for `build`.
- `apps/panel/src/routes/inventory.tsx` (shell), `routes.ts`, `components/panel-chrome.tsx` (`PANEL_NAV`), `components/status.tsx`, `components/button.tsx`, `styles/components.css` (tokens only, `styles.test.ts`).
- Panel tests: `routes/project-tree.test.tsx`, `project-tree.action.test.ts`, `loaders.test.ts`, `components.test.tsx` (nav), `registry.server.test.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contract/src/build-grants.ts`, `applications.ts` (+ `index.ts`, tests) -- types, paths, codes, limits, guards.
- [x] `packages/core/src/tree.ts` (+ test) -- the Applications rule in `validateBundleInput`.
- [x] `apps/registry/migrations/0009_build_grants.sql` (both tables), `src/db/schema.ts` -- tables, RLS, grants, mirrors, `TENANT_TABLES`.
- [x] `apps/registry/src/build-grants/{current,service}.ts` -- grant reads, list, set.
- [x] `apps/registry/src/applications/service.ts` (+ `validate`) -- list and create in the specified order.
- [x] `apps/registry/src/http/server.ts`, `src/index.ts`, `serve-cli.ts` -- routes, statuses, wiring.
- [x] registry tests -- `server.test.ts` routes/methods/statuses; `build-grants/build-grants.db.test.ts` and `applications/applications.db.test.ts` over HTTP covering every matrix row, RLS, refused UPDATE/DELETE, tenant isolation; bump `tenancy.db.test.ts`.
- [x] `apps/panel/src/registry.server.ts` (+ test) -- four calls.
- [x] `apps/panel/src/routes/new-application.tsx` (+ `components/new-application.tsx`), `routes.ts`, `panel-chrome.tsx` -- the surface, action and nav.
- [x] `apps/panel/src/routes/project-tree.tsx`, `components/project-tree.tsx` -- build grant section and `build` intent.
- [x] `apps/panel/src/routes/inventory.tsx` -- the Applications list with its states.
- [x] panel tests -- form, placeholder, field errors keeping the description, denial, success notice, busy/unavailable; build grant section states and notices; Inventory list/empty/failure without Builder names; nav entry.
- [x] `README.md` -- build grant and Applications sections.

**Acceptance Criteria:**
- Given a Builder with a build grant on P on the New-application flow surface, when they submit a description and P, then a success notice names P, and the Buyer's Inventory lists the Application with Project P and Placement "New-application flow", before any Guidance event or Gate run.
- Given the Buyer on the Project tree surface with P selected, when they grant a Builder the build grant, then the notice names the Builder and P and the section lists the grant with the Buyer and date.
- Given a fresh clone without `REGISTRY_TEST_DATABASE_URL`, when build, typecheck, lint, boundaries and test run, then all pass with the DB suites skipped.

## Spec Change Log

## Review Triage Log

### 2026-10-13 — Review pass
- verdicts: 22 findings — high 0, medium 0, low 14, false 8, maybe-false 0
- findings:
  - `[low]` `[reject]` BH1: `created_at` is the transaction start, so two concurrent placements can list out of `sequence` order. It needs two placements within the same instant; the createdAt-then-id order is the specified contract, and changing it would edit the spec.
  - `[low]` `[reject]` BH2: list reads take the bundle lock. This is the established read-consistency pattern (2.3 EC1, 2.4 EC2, 2.5 BH9), fine at pilot scale.
  - `[low]` `[reject]` BH3: each placement reads every Application row. Pilot scale; the whole bundle input is what core must validate.
  - `[low]` `[reject]` BH4: build-grant service duplicates the child-permission service. The spec asked for a copy of the 2.5 pattern; a shared abstraction is a refactor nobody asked for (same call as 2.4 BH5, 2.5 BH8).
  - `[low]` `[reject]` BH5: the contract repeats the account/project guards. The same existing per-file pattern as BH4.
  - `[low]` `[patch]` BH6: the Project select showed bare names, and `treeOrder` was an identity no-op. Fixed: options use the Project tree's `PROJECT_TREE_COPY.option` label (name plus level or root), and `treeOrder` is gone.
  - `[low]` `[defer]` BH7: no first-field focus, error focus or Esc on the form. No existing panel form does this; deferred as a panel-wide pass.
  - `[false]` `[reject]` BH8: the denial can show a raw UUID. The name comes from a fresh tree read, falling back to the id only when that read fails, exactly as the 2.5 create denial does (`project-tree.tsx:306`); the select only offers live Projects.
  - `[false]` `[reject]` BH9a: no concurrency test. Both checks run after `lockBundle` in one transaction; a race test would be non-deterministic (2.5 VG3).
  - `[low]` `[reject]` BH9b: no DB assertion on stored `sequence` values. `UNIQUE (tenant_id, sequence)` and the shared `nextSequence` pattern already guard it; no consumer reads it until Epic 4.
  - `[low]` `[reject]` BH9c: no test of a Standard owner placing with a grant. The grant check is role-agnostic (`session.role !== "Buyer"` then the grant), and the Builder path covers it.
  - `[false]` `[reject]` BH9d: no 415/413/malformed-JSON tests on the new POSTs. `readJson` is shared and already tested on the other routes (2.5 BH2).
  - `[false]` `[reject]` BH9e: the core failure path is not exercised through the API. It is unreachable there because the registry checks the Project first; core tests cover the rule.
  - `[false]` `[reject]` BH10a: core says "nothing was changed" on a create. Unreachable through `POST /v1/applications`, for the same reason as BH9e.
  - `[low]` `[reject]` BH10b: an unmapped `invalid_input` shows the unavailable copy. The form's own fields make it unreachable for users (2.4 BH2, 2.5 BH12).
  - `[low]` `[reject]` BH11: the textarea has no `maxLength`. HTML `maxLength` counts UTF-16 units, so it would wrongly block a valid 500-emoji description; the server answers with field text.
  - `[false]` `[reject]` BH12: the spec checkboxes and logs are empty. The workflow fills them at finalisation.
  - `[low]` `[defer]` EC1: a NUL character fails as a 500. No registry validator guards this; it is pre-existing across every text field.
  - `[false]` `[reject]` EC2: other mutations do not pass `applications` to core. Documented in Design Notes: no Project can be deleted, so they cannot orphan an Application.
  - `[low]` `[patch]` VG1: the description limit was untested in code points. Fixed: `applications/validate.test.ts` accepts 500 and refuses 501 astral characters.
  - `[low]` `[defer]` VG2: the list order's tie-break is not pinned. Deferred to Story 3.5, as filed.
  - `[false]` `[reject]` IA1: the readings diverge (R4: the Buyer needs no grant; the grant section lives on the Project tree; Standard owners are grantable; panel tests use stubs; no Boilerplate yet). The Buyer exemption follows EXPERIENCE ("A Builder places Applications only on Projects where the Buyer granted building") and the 2.5 precedent; the Boilerplate is Stories 3.3/3.4; stubbed panel tests are the established pattern, with the real create-then-list covered by the DB suite that CI runs.

## Design Notes

- **Description as the Application's label.** Story 3.1 asks only for a description; Inventory shows it in the Application column. Story 3.5's "name" can fill the same column; no separate name field now.
- **Why a separate grant table.** The epic requires the build grant to be distinct from the child-Project permission; sharing a table would let one grant imply the other.
- **Why core sees Applications.** AD-13 makes every Application change pass whole-bundle validation. Other mutations do not pass `applications` yet: no Project can be deleted, so they cannot orphan one; Epic 4's bundle compiler will pass the full list.

## Verification

**Commands:**
- `docker compose up -d --wait postgres` then `REGISTRY_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres pnpm test` -- expected: all suites pass with the DB suites run.
- `pnpm run build && pnpm run typecheck && pnpm run lint && pnpm run boundaries` -- expected: exit 0.
- `pnpm test` -- expected: passes, DB suites skipped.

## Auto Run Result

Status: done

**Summary:** A Builder can now place a new Application on a Project, and the Buyer sees it on Inventory right away.
- **Build grant.** The Buyer grants or revokes, per account and per Project, the build grant. Each change is stored append-only in `build_grant_changes` (migration 0009, RLS, SELECT/INSERT only). `GET|POST /v1/projects/{id}/build-grants` follows the 2.5 child-permission rules: Buyer-only writes, same-state no-op, never inherited, separate from the child-Project permission.
- **Applications.** `POST /v1/applications` with `{ description, projectId }` checks body → description → Project chosen → Project is the tenant's (404) → the Buyer or a current build grant (403 `build_grant_denied`) → core whole-bundle validation, all under the bundle lock. It mints a UUIDv7 and stores the Application bound to exactly that Project with `from_flow = true`. `GET /v1/applications` lists every Application to every role, with no creator on the wire.
- **Core.** `validateBundleInput` takes the Applications: unique ids, each on a Project of the proposed tree.
- **Panel.** A new "New-application flow" surface (Description, Project select with a placeholder and tree labels, "Place the Application"), with field text naming the Project field, the build-grant denial and a success notice. A "Build grant for <name>" section on the Project tree. Inventory now lists Applications (Application, Project, Placement, Listed), with empty, loading and failure states, and no Builder name.

**Files changed:**
- `packages/contract/src/build-grants.ts`, `applications.ts` (+ tests, `index.ts`): types, paths, `BUILD_GRANT_DENIED`, limits, guards.
- `packages/core/src/tree.ts` (+ test, `index.ts`): the Applications rule.
- `apps/registry/migrations/0009_build_grants.sql`, `src/db/schema.ts`: both tables and mirrors.
- `apps/registry/src/build-grants/{current,service}.ts`, `src/applications/{service,validate}.ts` (+ DB and unit tests): grants, list and create.
- `apps/registry/src/http/server.ts`, `index.ts`, `serve-cli.ts` (+ tests): routes, 403/201, wiring; other DB suites wire the two new services.
- `apps/panel/src/registry.server.ts`, `routes/new-application.tsx`, `components/new-application.tsx`, `routes.ts`, `components/panel-chrome.tsx`, `routes/project-tree.tsx`, `components/project-tree.tsx` (shared grant section; CSS classes renamed to `grant-section*`), `routes/inventory.tsx`, `styles/components.css` (+ tests).
- `README.md`: Build grant and Applications sections.

**Review findings:** 22 findings: high 0, medium 0, low 14, false 8.
- **Patched (2 entries, both low):** VG1, a code-point test for the description limit; BH6, the Project select uses the Project tree's option labels and the no-op `treeOrder` is gone.
- **Deferred (3, low):** NUL characters fail as 500 on every text field (pre-existing); the list order's tie-break is not pinned (until 3.5); panel-wide form focus and Esc behaviour.
- **Rejected:** 9 low and 8 false, each with its reason in the triage log.

**Follow-up review recommended: false.** Patched counts: high 0, medium 0, low 2.

**Verification:**
- `pnpm -r run build`, `typecheck`, `lint` exit 0, and `pnpm run boundaries` reports no violations. The root `turbo` commands fail in this container with "Exec format error" before any task runs (environmental), so each step ran per package.
- With `REGISTRY_TEST_DATABASE_URL` (local PostgreSQL 16; Docker is unavailable): registry 605, panel 344 + 1 skipped (pre-existing), contract 215, core 61, boundaries 16 passed.
- Without it, all pass with the DB suites skipped.
- Matrix audit: every row has a covering test that ran, in `applications.db.test.ts`, `build-grants.db.test.ts`, `tree.test.ts` and the panel suites.

**Residual risks:**
- Choices made on the human's behalf: the Buyer needs no build grant; any non-Buyer account can hold one; the grant section lives on the Project tree surface; the description is the Application's label until 3.5 adds a name; the button reads "Place the Application" until the Boilerplate arrives in 3.3.
- Tested against PostgreSQL 16 and Node 22, not the 18 and 24 the repo targets.
- No concurrency test for a revoke racing a placement; both take the same bundle lock.
- The panel was checked in jsdom only.
