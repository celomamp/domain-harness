---
title: 'Story 3.1: Builder places a new Application on a Project'
type: 'feature'
created: '2026-10-13'
status: 'in-progress'
baseline_commit: '1ae86aba10c95533a43181018bfd49f0e71f3fb5'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-5-child-project-creation-requires-a-buyer-granted-permission.md'
warnings: ['oversized']
deferred: []
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
- [ ] `packages/contract/src/build-grants.ts`, `applications.ts` (+ `index.ts`, tests) -- types, paths, codes, limits, guards.
- [ ] `packages/core/src/tree.ts` (+ test) -- the Applications rule in `validateBundleInput`.
- [ ] `apps/registry/migrations/0009_build_grants.sql` (both tables), `src/db/schema.ts` -- tables, RLS, grants, mirrors, `TENANT_TABLES`.
- [ ] `apps/registry/src/build-grants/{current,service}.ts` -- grant reads, list, set.
- [ ] `apps/registry/src/applications/service.ts` (+ `validate`) -- list and create in the specified order.
- [ ] `apps/registry/src/http/server.ts`, `src/index.ts`, `serve-cli.ts` -- routes, statuses, wiring.
- [ ] registry tests -- `server.test.ts` routes/methods/statuses; `build-grants/build-grants.db.test.ts` and `applications/applications.db.test.ts` over HTTP covering every matrix row, RLS, refused UPDATE/DELETE, tenant isolation; bump `tenancy.db.test.ts`.
- [ ] `apps/panel/src/registry.server.ts` (+ test) -- four calls.
- [ ] `apps/panel/src/routes/new-application.tsx` (+ `components/new-application.tsx`), `routes.ts`, `panel-chrome.tsx` -- the surface, action and nav.
- [ ] `apps/panel/src/routes/project-tree.tsx`, `components/project-tree.tsx` -- build grant section and `build` intent.
- [ ] `apps/panel/src/routes/inventory.tsx` -- the Applications list with its states.
- [ ] panel tests -- form, placeholder, field errors keeping the description, denial, success notice, busy/unavailable; build grant section states and notices; Inventory list/empty/failure without Builder names; nav entry.
- [ ] `README.md` -- build grant and Applications sections.

**Acceptance Criteria:**
- Given a Builder with a build grant on P on the New-application flow surface, when they submit a description and P, then a success notice names P, and the Buyer's Inventory lists the Application with Project P and Placement "New-application flow", before any Guidance event or Gate run.
- Given the Buyer on the Project tree surface with P selected, when they grant a Builder the build grant, then the notice names the Builder and P and the section lists the grant with the Buyer and date.
- Given a fresh clone without `REGISTRY_TEST_DATABASE_URL`, when build, typecheck, lint, boundaries and test run, then all pass with the DB suites skipped.

## Spec Change Log

## Review Triage Log

## Design Notes

- **Description as the Application's label.** Story 3.1 asks only for a description; Inventory shows it in the Application column. Story 3.5's "name" can fill the same column; no separate name field now.
- **Why a separate grant table.** The epic requires the build grant to be distinct from the child-Project permission; sharing a table would let one grant imply the other.
- **Why core sees Applications.** AD-13 makes every Application change pass whole-bundle validation. Other mutations do not pass `applications` yet: no Project can be deleted, so they cannot orphan one; Epic 4's bundle compiler will pass the full list.

## Verification

**Commands:**
- `docker compose up -d --wait postgres` then `REGISTRY_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres pnpm test` -- expected: all suites pass with the DB suites run.
- `pnpm run build && pnpm run typecheck && pnpm run lint && pnpm run boundaries` -- expected: exit 0.
- `pnpm test` -- expected: passes, DB suites skipped.
