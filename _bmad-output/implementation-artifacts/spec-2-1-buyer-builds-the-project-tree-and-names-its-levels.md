---
title: 'Story 2.1: Buyer builds the Project tree and names its levels'
type: 'feature'
created: '2026-10-12'
status: 'done'
baseline_commit: '636f8894e8705825913744f989aad0c692e3819c'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-6-standard-owner-publishes-design-system-components-tokens-and-imports.md'
warnings: ['oversized']
deferred:
  - summary: >-
      Level names (and Standard text) in another language are not marked with their language.
    evidence: |-
      The epic 2 context and UX-DR26 say other-language text is marked with its language. Story 2.1 renders level names with no lang attribute and no way to supply one. Story 1.5 excluded language tagging for Standard text too, so this is a cross-cutting gap rather than a 2.1 regression.
    location: >-
      apps/panel/src/components/project-tree.tsx
    severity: low
---

<intent-contract>

## Intent

**Problem:** Each Company has exactly one Project, the root that Story 1.2 provisions, so Standards cannot be organised the way the Company is organised (FR-5).

**Approach:** The Buyer creates Projects under a parent, names each Project's level (stored exactly as typed), and changes a Project's parent. Every change is validated as a whole proposed bundle input through a new pure `core` validator, which checks the tree shape and runs the existing slot rule. The change is recorded append-only. The panel gains a "Project tree" surface with an accessible tree, a create form, a change-parent form, and cold-load and empty states.

## Boundaries & Constraints

**Always:**
- **One root.** Story 1.2's root Project is the only Project with zero parents (DB index `projects_one_root_per_tenant`; the root scope of Stories 1.5 and 1.6). Every created Project has exactly one parent, which is a Project of the same tenant. The root's parent cannot be changed.
- **Fields:**
  - `name`: trimmed, 1–200 characters.
  - `levelName`: stored exactly as typed (no trimming, no case change), 1–200 characters, and must contain at least one non-whitespace character.
  - `parentId`: a Project id of this tenant.
  - The root's `levelName` is `null` until a later story lets the Buyer set it.
  - Domain Harness never interprets a level name.
- **Append-only.** `projects` keeps `SELECT, INSERT` only. A new table `project_parent_changes` records every create and every parent change: id, tenant_id, project_id, sequence (per tenant, 1, 2, 3, … as max + 1 under the lock), parent_id, changed_by, changed_at. A Project's current parent is the `parent_id` of its highest-sequence change row; the root has no rows and its parent stays NULL. Rows are never updated or deleted.
- **Whole-bundle validation (AD-13).** Before any write, the registry builds the proposed bundle input: every Project with its proposed current parent, plus every live Standard as `SlotHolder`s (Stories 1.5/1.6). It calls `core`'s `validateBundleInput`, which returns `ok` or the first error:
  - exactly one root;
  - every parent exists;
  - no cycle: code `project_cycle`, subject = the id of the proposed parent that closes the cycle, message naming that parent;
  - then the slot rule (`validatePublication` semantics over the whole set).
  Core does no I/O and reads no clock. A refused change writes nothing and leaves the tree unchanged.
- **Check order** for create (`POST /v1/projects`) and change parent (`POST /v1/projects/{id}/parent`), first failure wins:
  1. Bearer session (401).
  2. Project exists in this tenant (`404 project_not_found`, subject `projectId`, malformed ids included).
  3. The session's role is Buyer (`403 role_denied`, subject `role`).
  4. Body valid: exactly `{name, levelName, parentId}` / `{parentId}`, otherwise `400 invalid_input` with subject = the field or extra key.
  5. Parent exists in this tenant (`404 project_not_found`, subject `parentId`).
  6. The root's parent cannot be changed (`409 root_project_fixed`, subject `projectId`).
  7. Core validation (`409 project_cycle`).
  Tree mutations take the same transaction advisory lock as Standards publishes (`standards:<rootId>`).
- **Reads.** `GET /v1/projects` (the tree) and `GET /v1/projects/{id}` (one Project) are open to every role of the tenant. Another tenant's or an unknown id → `404 project_not_found`. All queries go through `withTenant`. The new table has RLS enabled and forced, composite FKs, and is in `TENANT_TABLES`.
- **Panel.** Imports `contract` only. Controls are shown to every role, and refusals appear as a `denial` in the `role="status"` region. Gold appears only on "Create Project"; "Change parent" uses `button-inverse`. The nav gains "Project tree". Glossary terms are used exactly, no all-caps, and an invalid submit keeps every value and puts ink text under the field.

**Never:** No Standards scoped to non-root Projects (Story 2.2), no resolver or preview (Story 2.3), no Locked rules (Story 2.4), no child-creation permission for non-Buyers (Story 2.5), and no plan gating (Story 2.6). No Project rename, deletion or level-name edit. No UPDATE or DELETE grants. No client-minted ids. No `core` import in the panel.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Create | Buyer posts `{name:" Web ",levelName:"  Product line ",parentId:<root>}` | 201 `ProjectInfo {id (UUIDv7), name:"Web", levelName:"  Product line " (exact), parentId:<root>, createdAt}`; the tree shows Web under the root | none |
| Re-parent | Projects A and C under the root; Buyer posts `{parentId:C}` to `/v1/projects/{A}/parent` | 200 `ProjectInfo` with `parentId:C`; the tree shows A under C; a new change row is added and earlier rows are unchanged | none |
| Cycle | B is a child of A; Buyer sets A's parent to B (also A's parent to A) | Nothing is written and the tree is unchanged; the panel denial names B ("B is a descendant of A …") and asks the Buyer to choose another parent | 409 `project_cycle`, subject B.id |
| Root re-parent | Buyer posts `{parentId:X}` to the root's `/parent` | Nothing is written | 409 `root_project_fixed` |
| Not Buyer | Standard owner or Builder creates or re-parents | Nothing is written; panel denial "Only the Buyer can change the Project tree. Nothing was changed." | 403 `role_denied` |
| Invalid | Blank or 201-char name; blank or whitespace-only or 201-char levelName; missing, malformed or null parentId; extra key | Nothing is written; the panel keeps the values and shows ink text under the field | 400 `invalid_input`, subject = field |
| Foreign / unknown | Another tenant's Project id as `projectId` or `parentId`; GET of another tenant's id | Nothing is written; that Project is never listed | 404 `project_not_found` |
| Isolation | Companies A and B each have Projects | A's tree lists only A's Projects; with the tenant filter omitted, RLS still hides B's rows | none |
| Bundle check | Re-parent while live Standards exist at the root | Core validates tree + Standards together; a valid re-parent passes | none |
| Concurrent | Two re-parents that together would form a cycle (A→B, B→A) | Exactly one succeeds; the other is `project_cycle` | none |
| Empty | Only the root exists | The tree shows the root; the text "No Project yet beyond the root Project." | none |
| Cold-load | The tree has not arrived yet | h1 "Project tree", a tree region with `aria-busy="true"` and "Loading the Project tree…", no forms | none |
| Registry down | The tree call fails | The structure stays; "The Project tree is unavailable right now…" | panel catches |

</intent-contract>

## Code Map

- `packages/contract/src/modules.ts` -- `ROLE_DENIED`, `AccountRef`, the paths pattern, the guards pattern; `standards.ts` `ProjectRef`. Add `projects.ts` beside them and re-export it from `index.ts`.
- `packages/core/src/slots.ts` -- `SlotHolder`, `validatePublication`, `conflict()`. Add `tree.ts` with `validateProjectTree` and `validateBundleInput`; export from `index.ts`.
- `apps/registry/migrations/0001_tenancy.sql:40-53` -- `projects` (id, tenant_id, parent_id, name with `btrim(name) <> ''`, created_at), the one-root index, the not-own-parent check, `SELECT, INSERT` grant. 0006 adds `level_name text NULL` with a check (`level_name IS NULL OR (char_length BETWEEN 1 AND 200 AND btrim(level_name) <> '')`), a `projects.created_by uuid NULL` column (the provisioned root has none), and `project_parent_changes` with the 0003 table/RLS/grant shape.
- `apps/registry/migrations/0003_modules.sql` -- the `module_owner_assignments` shape (sequence, composite FKs, RLS, grant) to copy.
- `apps/registry/src/db/schema.ts` -- the `projects` mirror plus `TENANT_TABLES`; add the new table and columns.
- `apps/registry/src/tenancy/queries.ts` -- the root Project lookup; `provisionCompany` creates the root (unchanged).
- `apps/registry/src/standards/service.ts` -- `publish()` takes `pg_advisory_xact_lock(hashtextextended('standards:'||root.id,0))`; `liveSet()` (export it, or move it to a shared helper, for the bundle input); `projectsById`.
- `apps/registry/src/modules/service.ts` -- the `withTenant` + role check (`ROLE_DENIED`) + `EnvelopeError` service pattern; `toId`, `accountNames`.
- `apps/registry/src/http/server.ts` -- `ROUTES`, `matchRoute`, `STATUS_BY_CODE`, `RegistryServices`; `serve-cli.ts` wiring; `src/index.ts` exports.
- `apps/registry/src/standards/standards.db.test.ts`, `modules/modules.db.test.ts`, `tenancy/tenancy.db.test.ts` (asserts the exact table list and migration list) -- DB suite patterns; `server.test.ts` -- fake-service pattern (the constructor takes `RegistryServices`, so every fake needs a `projects` member).
- `apps/panel/src/registry.server.ts` -- `call()`, `bearer`, `json`, `RegistryResult`.
- `apps/panel/src/routes.ts` + `routes.test.ts` -- the children list is asserted exactly; `components/panel-chrome.tsx` `PANEL_NAV` (+ its test).
- `apps/panel/src/routes/module-standards.tsx` -- the deferred-loader `Suspense`/`Await` cold-load pattern, the `refusal()` mapping, the `Status` usage; `components/standard-form.tsx` field markup, `Button` variants.
- `apps/panel/src/styles/components.css` + `styles.test.ts` -- tokens only; the 16px indent is `--space-4` if that is 16px (check `design/tokens`).

## Tasks & Acceptance

**Execution:**
- [ ] `packages/contract/src/projects.ts` (+ `index.ts`, `projects.test.ts`) -- limits `PROJECT_NAME_MAX=200` and `LEVEL_NAME_MAX=200`; `ProjectInfo {id, name, levelName: string|null, parentId: UuidV7|null, createdAt}`; `ProjectTree {rootId, projects}` with projects in depth-first order, children ordered by `createdAt` then id; `ProjectCreateRequest`, `ProjectParentRequest`; paths `PROJECT_API_PATHS.projects`, `projectPath(id)`, `projectParentPath(id)`; codes `PROJECT_NOT_FOUND`, `PROJECT_CYCLE`, `ROOT_PROJECT_FIXED`; guards `isProjectInfo` and `isProjectTree`.
- [ ] `packages/core/src/tree.ts` (+ `index.ts`, `tree.test.ts`) -- `TreeNode {id, parentId|null}`; `validateProjectTree(nodes, change?)` returns ok or an envelope for: no root / two roots (`invalid_input`, subject `parentId`), an unknown parent (`project_not_found`, subject `parentId`), or a cycle (`project_cycle`, subject = the parent id that closes it, message naming it). `validateBundleInput({projects, standards})` runs the tree check, then the slot rule over every pair at the same scope. Tests: self-parent, a 2- and 3-node cycle naming the right parent, two roots, a valid deep tree, conflicting Standards in the bundle, and determinism (the same input in shuffled order gives the same result).
- [ ] `apps/registry/migrations/0006_project_tree.sql` + `src/db/schema.ts` -- as in the Code Map; forced RLS with the 0001 policy shape; `SELECT, INSERT` only; `TENANT_TABLES` extended.
- [ ] `apps/registry/src/projects/{validate,service}.ts` -- `validateCreateBody` and `validateParentBody`; `getTree`, `getProject`, `createProject`, `changeParent` with the check order above, the shared lock, and the proposed bundle input from the current tree (latest change rows) plus the live Standards; `createProjectService(db)`.
- [ ] `apps/registry/src/http/{server,serve-cli}.ts`, `src/index.ts` -- `GET|POST /v1/projects`, `GET /v1/projects/{id}`, `POST /v1/projects/{id}/parent` (201 on create, 200 on parent change); map `project_not_found` 404, `project_cycle` / `root_project_fixed` 409; wire `projects`.
- [ ] registry tests -- `validate.test.ts`; `server.test.ts` routes and statuses with a fake service; `projects/projects.db.test.ts` covering every registry matrix row end to end over HTTP, including: append-only proof (runtime UPDATE/DELETE on `project_parent_changes` and `projects` → permission denied); RLS cross-tenant read with the tenant filter omitted; the concurrent opposite re-parents; the tree unchanged after a refused cycle; and existing root-scoped publishes still working after Projects exist. Update the `tenancy.db.test.ts` table and migration lists and every fake `RegistryServices`.
- [ ] `apps/panel/src/registry.server.ts` (+ tests) -- `getProjectTree`, `createProject`, `changeProjectParent`.
- [ ] `apps/panel/src/routes/project-tree.tsx`, `components/project-tree.tsx`, `routes.ts`, `panel-chrome.tsx` (+ CSS) -- the route `projects` and the nav item "Project tree" (after Standards).
  - Loader: defer `getProjectTree`; `?project=<id>` selects a node (default: the root).
  - Tree: `role="tree"` with `aria-label="Project tree"`, nested `role="group"` lists, and `role="treeitem"` nodes with `aria-level` and `aria-selected`. Each node's accessible text is "<name>, level <levelName>" (the root without a level reads "<name>, root Project, no level name"). Children are indented 16px; the selected node is at weight 600, never gold. Roving tabindex: Up/Down/Home/End move focus and Enter/Space select (navigates to `?project=`).
  - Under the tree: "Create a Project" `standard-form` with Name, Level name and Parent (a select of every Project, default the selected one), then the gold "Create Project" button. Then "Change the parent of <selected>", which is shown only when the selected Project is not the root, with a Parent select and the `button-inverse` "Change parent".
  - Action `intent=create|parent` maps every refusal in the matrix. The cycle copy is: "Nothing was changed. <parent name> is a descendant of <project name>, so it cannot be its parent. Choose another parent." On success, a status names the Project, its level name and its parent.
  - Empty, cold-load and unavailable states as in the matrix.
- [ ] panel tests -- the loader returns a pending promise. Component: the tree roles, levels, names and `aria-selected`; keyboard movement and selection; the forms shown to a Builder too; a denial in `role="status"`; values kept with ink text on an invalid submit; the empty state; the cold-load state (no forms, `aria-busy`); the unavailable state. Action: every refusal mapping, including the cycle copy naming the closing parent, and the success status. Update `routes.test.ts` and the panel-chrome nav test.
- [ ] `README.md` -- the Project tree endpoints, the refusals and their order, the one-root rule, append-only parent changes, and migration 0006.

**Acceptance Criteria:**
- Given the Buyer on the Project tree surface, when they create a Project with a name, a level name and a parent, then the tree shows it under that parent, announcing its name and the level name exactly as typed.
- Given B is a descendant of A, when the Buyer sets A's parent to B, then the page names B as the parent that closes the cycle and the tree is unchanged after a reload.
- Given Companies A and B, when A's Buyer opens the tree or looks up a B Project id directly, then no B Project appears and the lookup is `project_not_found`.
- Given a fresh clone without `REGISTRY_TEST_DATABASE_URL` and `CI`, when build, typecheck, lint, boundaries and test run, then all pass with the DB suites skipped.

## Spec Change Log

## Review Triage Log

### 2026-10-12 — Review pass
- verdicts: 32 findings — high 0, medium 0, low 24, false 8, maybe-false 0
- findings:
  - `[low]` `[patch]` VG1: no test clicks a treeitem, so a broken mouse selection passes. Added a page test that clicks a nested node.
  - `[low]` `[patch]` VG2: the forms clearing after a successful create is untested at page level. Added a page test for a create that succeeds.
  - `[low]` `[patch]` VG3: re-sending the current parent ("writes nothing") is untested. Added a DB case asserting 200 and unchanged row counts.
  - `[low]` `[patch]` VG4: the action test's request and stubbed response disagree on the parent. They now agree.
  - `[false]` `[reject]` BH1: publishes skip `validateBundleInput`. Publishing never changes the tree, so per-scope validation over the live set gives the same verdict. AC3 covers Project changes.
  - `[low]` `[patch]` BH2: the same-parent no-op is undocumented and untested. Same root cause as VG3: the DB test now pins it, and the existing panel copy ("now has the parent Y") is still true.
  - `[low]` `[patch]` BH3: `projects.parent_id` is now "the parent at creation" but reads as the current parent, which Stories 2.2/2.3 may misread. Added a doc comment on the schema field pointing to `project_parent_changes`.
  - `[low]` `[reject]` BH4: the DB does not cap the Project name length. The service validates it (same split as 1.2/1.5), and a raw over-length insert needs DB access.
  - `[low]` `[patch]` BH5: `aria-expanded=true` on nodes that cannot collapse is misleading. Removed `aria-expanded`; Left/Right are optional when nothing collapses.
  - `[low]` `[patch]` BH6: the panel detects the root by `levelName === null`. It now uses `parentId === null`.
  - `[low]` `[reject]` BH7: the contract guards check shape only, not linkage or order. The registry is the only producer and builds the tree from one consistent read.
  - `[low]` `[reject]` BH8: the concurrent-cycle test may run sequentially. Same style as the 1.4/1.5 concurrency tests; the lock path is the same one publishes use.
  - `[low]` `[reject]` BH9: extra tree calls to turn ids into names, with an id fallback. A pilot-scale cost, and the fallback only appears during an outage.
  - `[low]` `[reject]` BH10: `getProject` loads the whole tenant tree. Pilot Companies have a handful of Projects.
  - `[low]` `[reject]` BH11: an unknown `?project=` falls back silently, a new Project is not selected after create, and the parent select offers the Project itself. UX polish beyond the ACs; the registry refuses the invalid choice.
  - `[low]` `[defer]` BH12: level names are not language-marked. This cross-cutting gap is also open for Standard text (excluded in 1.5); recorded in `deferred`.
  - `[false]` `[reject]` BH13: the spec's checkboxes and logs are out of date. The workflow fills these at finalisation; fixing it would mean editing this build's spec.
  - `[low]` `[patch]` EC1: the body is read before the 404/403 checks on `/parent`. The README now states that transport refusals come first, as the Standards section does (1.5 BH9).
  - `[low]` `[reject]` EC2: NUL or a lone surrogate in a name gives a 500. The same applies to every text field in the registry; it needs a crafted request.
  - `[false]` `[reject]` EC3: `slot_conflict` from a tree change shows as unavailable. Unreachable: a tree change does not move Standards scopes (all at the root), and the live set is consistent.
  - `[false]` `[reject]` EC4: core's two-roots `invalid_input` shows under the Parent field. Unreachable: create requires an existing parent, and the root cannot be re-parented.
  - `[low]` `[reject]` EC5: the tree guard accepts orphan nodes. Same as BH7.
  - `[low]` `[reject]` EC6: keyboard order can include unrendered nodes. Only possible with an inconsistent payload (BH7).
  - `[low]` `[reject]` EC7: non-Buyers take the bundle lock before the denial. The lock is held for milliseconds and the 1.5 check order is kept.
  - `[low]` `[patch]` EC8: the documented check order is not the order for transport errors. Same root cause as EC1; README patched.
  - `[low]` `[reject]` IA1: panel tests use a faked registry. Same split as Stories 1.3–1.6; the DB suite proves the registry over HTTP.
  - `[low]` `[reject]` IA2: the 16px indent and weight 600 exist only as CSS tokens. `--space-4` = 16px and label-strong = 600 per DESIGN.md; jsdom cannot assert layout.
  - `[false]` `[reject]` IA3: a slot conflict on a tree change says "nothing was published". Unreachable (see EC3).
  - `[low]` `[reject]` IA4: no panel test shows a created Project appearing in the tree. The loader revalidates after the action, and the DB suite proves the tree contents.
  - `[false]` `[reject]` IA5: "zero or one parent" is narrowed to "parent required". This is the only reading consistent with the one-root DB invariant and the 1.5/1.6 root scope (Design Notes).
  - `[false]` `[reject]` IA6: the root's level name cannot be set. The AC asks for a level name on create; renaming is listed under Never.
  - `[false]` `[reject]` IA7: the empty state follows the story wording, not EXPERIENCE.md. The story AC is explicit ("no Project yet beyond the root"), and the root always exists.

## Design Notes

- **Why a parent is required on create.** "Zero or one parent" holds for the tree as a whole: the root has zero and every other Project has one. Story 1.2's single-root DB invariant and the root scope of Stories 1.5 and 1.6 depend on there being exactly one parentless Project, so a second root is an invalid bundle input, not a choice.
- **Append-only re-parent.** `projects.parent_id` is the parent at creation, kept for the root index and the FK. The current parent comes from `project_parent_changes`. Example query: `SELECT DISTINCT ON (project_id) project_id, parent_id FROM project_parent_changes WHERE tenant_id=$1 ORDER BY project_id, sequence DESC`, overlaid on `projects`.
- **Cycle naming.** Setting A's parent to P closes a cycle exactly when P is A or a descendant of A. Walking up from P reaches A, and the error's subject is P, which is the parent that closes the cycle.
- **One lock.** Tree changes and Standards publishes both feed the bundle input, so both take the `standards:<rootId>` lock. That serialises tree and Standards validation per tenant.

## Verification

**Commands:**
- `docker compose up -d --wait postgres` then `REGISTRY_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres pnpm test` -- expected: all suites pass, with the DB suites run.
- `pnpm run build && pnpm run typecheck && pnpm run lint && pnpm run boundaries` -- expected: exit 0.
- `pnpm test` without the env var -- expected: passes, with the DB suites skipped.

## Auto Run Result

Status: done

**Summary:** The Buyer can build the Company's Project tree from the new "Project tree" surface of the management panel:
- create Projects under a parent, with a name (trimmed) and a level name stored exactly as typed;
- change a non-root Project's parent.

Every change is validated as the whole proposed bundle input by the new pure `core` validator `validateBundleInput`. It checks for one root, that every parent exists, and that there is no cycle; a cycle is `project_cycle`, naming the parent that closes it. It then runs the Conflict slot rule over every live Standard.

Changes are recorded append-only in `project_parent_changes` (migration 0006: forced RLS, SELECT/INSERT only), and the current parent is the latest change row. Tree changes share the tenant's bundle lock with Standards publishes, and only the Buyer may change the tree. Reads are open to every role; another Company's Projects are never listed, and looking one up returns `project_not_found`.

The panel shows:
- an accessible tree (`role="tree"`, `aria-level`, `aria-selected`, name and level name, 16px indent, the selected node at weight 600, roving-tabindex keyboard);
- a create form with the gold button and a change-parent form with `button-inverse`;
- every refusal as a status;
- the cold-load, empty, unavailable and session-ended states.

**Files changed:**
- `packages/contract/src/projects.ts` (+ test, `index.ts`): the Project tree wire types, paths, codes and guards.
- `packages/core/src/tree.ts` (+ test, `index.ts`): `validateProjectTree` and `validateBundleInput`.
- `apps/registry/migrations/0006_project_tree.sql`, `src/db/schema.ts`: `level_name`, `created_by`, and `project_parent_changes`.
- `apps/registry/src/projects/{validate,service}.ts` (+ tests, `projects.db.test.ts`): reading the tree, creating a Project, and changing a parent.
- `apps/registry/src/standards/service.ts`: `liveSet` (all scopes) is exported, and `lockBundle` is shared with tree changes.
- `apps/registry/src/http/{server,serve-cli}.ts`, `src/index.ts`: the new routes and status mappings.
- Other registry tests: fakes and table lists updated.
- `apps/panel/src/{registry.server.ts,routes.ts,routes/project-tree.tsx,components/project-tree.tsx,components/panel-chrome.tsx,styles/components.css}` (+ tests): the Project tree surface and its nav entry.
- `README.md`: the Project tree endpoints, the refusal order (transport refusals first), the one-root rule, and migration 0006.
- `_bmad-output/implementation-artifacts/epic-2-context.md`: the compiled Epic 2 context.

**Review findings:** 32 findings: high 0, medium 0, low 24, false 8.
- **Patched (10 rows in 8 entries, all low):**
  - VG1: added a click-selection test.
  - VG2: added a page test for a successful create.
  - VG3/BH2: added a DB test for re-sending the current parent.
  - VG4: the action test's request and response now agree.
  - BH3: a schema doc comment on `projects.parentId`.
  - BH5: `aria-expanded` removed.
  - BH6: the root is detected by `parentId === null`.
  - EC1/EC8: the README states that transport refusals come first.
- **Deferred (1):** BH12, language marking of level names.
- **Rejected:** 13 low and 8 false, each with its reason in the triage log.

**Follow-up review recommended: false.** Patched counts: high 0, medium 0, low 8 entries.

**Verification:**
- `pnpm run build`, `typecheck`, `lint` and `boundaries` exit 0, re-run after the patches.
- With `REGISTRY_TEST_DATABASE_URL` (compose PG18), all pass:

  | Package | Tests passed |
  |---|---|
  | registry | 440 |
  | panel | 230, plus 1 skipped (the existing contrast exception) |
  | contract | 143 |
  | core | 32 |
  | boundaries | 16 |

- Without the database URL, all pass and the DB suites print a skip reason.
- Matrix audit: every I/O row has a covering test that ran:
  - core: `tree.test.ts`
  - registry: `projects.db.test.ts` and `validate.test.ts`
  - panel: `project-tree.test.tsx` and `project-tree.action.test.ts`

**Residual risks:**
- Choices made on the human's behalf:
  - A created Project must have a parent, because the provisioned root stays the only parentless Project.
  - The root's level name stays null, with no way to set it yet.
  - Re-sending the current parent is a 200 that writes nothing.
  - Self-parent has its own panel wording.
- Standards publishes still validate the slot rule per scope, not through `validateBundleInput`. The verdict is the same while publishes cannot move the tree.
- The tree has no Left/Right navigation and nodes cannot collapse; all nodes are always expanded.
- Keyboard, focus and layout were checked in jsdom only. No real-browser or SSR-streaming check was done for this surface.
