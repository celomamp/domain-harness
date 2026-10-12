---
title: 'Story 2.2: Standard owner scopes a Standard to any Project'
type: 'feature'
created: '2026-10-12'
status: 'done'
baseline_commit: '65edcd5ad36f2e542695c2f5ef6f01bbbba0bd77'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-1-buyer-builds-the-project-tree-and-names-its-levels.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** Every Standard is published at the Company's root Project (Stories 1.5 and 1.6), so different parts of the Project tree from Story 2.1 cannot hold different Standards (FR-1, FR-6).

**Approach:** Publishing version 1 of a new Standard takes an optional `projectId` that sets its Project scope (missing means the root). The scope is fixed for the Standard's life. The Conflict slot rule keeps running per (slot, Project scope), so the same slot at a child Project is accepted and a second Standard in one slot at one scope is still refused, naming both Standards. In the panel, standard-form and the design-system form gain a "Project scope" picker for a new Standard. Every place that shows a Standard shows its scope by name.

## Boundaries & Constraints

**Always:**
- **Body.** `POST /v1/modules/{id}/standards` takes exactly `{ entry, projectId? }`. `projectId` may be missing, which means the root Project. If present, it must be a string; any other type → `400 invalid_input`, subject `projectId`. A malformed, unknown or another tenant's id → `404 project_not_found`, subject `projectId`. `POST /v1/standards/{id}/versions` stays exactly `{ entry }`. A `projectId` key there → `400 invalid_input`, subject `projectId`, with a message saying a Standard's Project scope is fixed. The new version keeps the Standard's scope.
- **Check order** (first failure wins, nothing written): session (401) → Module/Standard exists (404) → `module_has_no_owner` (409) → `not_module_owner` (403) → body and entry valid (400; `projectId` type is checked after `entry`) → Project scope exists in this tenant (404 `project_not_found`) → `slot_conflict` (409).
- **Slot rule.** `core`'s `validatePublication` runs over the live set of every scope, so its pair check covers the whole set, plus the proposed holder at its scope. `conflicts()` already compares `projectId`, so equal slots at different scopes never conflict. The error envelope still names both Standards, with the existing message and subject. Publishes keep the `lockBundle` lock.
- **No migration.** `standards.project_id` already has the composite FK to `projects (tenant_id, id)`; `standards` stays append-only.
- **Panel.** It imports `contract` only. The Module page's loader defers one promise that resolves to the Standards list and the Project tree (`getProjectTree`).
  - When there is no Standard being edited, both forms show a "Project scope" `<select name="projectId">` (id `standard-project`) before the entry fields. It has one option per Project in tree order, labelled `<name>` for the root and `<name> (level <levelName>)` otherwise, and the root is selected by default.
  - When editing, the form shows the scope as text instead: "Project scope: <name> (fixed for this Standard)".
  - A refused submit keeps the chosen scope. `project_not_found` or `invalid_input` with subject `projectId` puts ink text under the picker: "Choose a Project in this Company's Project tree."
  - If the tree call fails while the list loads, the picker is replaced by the text "The Project tree is unavailable right now, so this Standard will be published at the root Project." and no `projectId` is sent.
  - Both Standards tables gain a "Project scope" column (also in the cold-load headers) after the Standard column. The published facts and the success status name the scope Project. The conflict copy names the holder's Project instead of "the root Project".
- Glossary terms exactly: Project, Project tree, Project scope, Conflict slot.

**Never:** No re-scoping an existing Standard, no Standard deletion, no resolver or Effective Standard set (Story 2.3), no Locked rules (2.4), no plan gating (2.6). No change to `validateBundleInput` or the tree endpoints. No `core` import in the panel. No UPDATE or DELETE grants.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Scoped publish | Owner posts `{entry: library "X", projectId: P}` | 201 `StandardInfo` with `project: {id: P, name}`; listed with that scope | none |
| Default scope | Owner posts `{entry}` | 201 at the root Project (unchanged behaviour) | none |
| Same slot, child scope | Live library "X" at P; owner publishes library "x" at P's child C | 201: the scopes differ | none |
| Same slot, same scope | Live library "X" at P; a second Standard library "X" at P | Nothing written; the panel names both Standards and Project P | 409 `slot_conflict`, subject = the live Standard's id; message names both ids |
| New version | Standard S at C; owner publishes version 2 with `{entry}` | 201, version 2, still at C; the slot is checked at C | none |
| Version with scope | `{entry, projectId}` to `/versions` | Nothing written | 400 `invalid_input`, subject `projectId` |
| Bad scope | `projectId` is another tenant's or an unknown or malformed id; `projectId: 7` or `null` | Nothing written; the panel shows ink text under the picker | 404 `project_not_found` / 400 `invalid_input`, subject `projectId` |
| Order | Non-owner sends a foreign `projectId` | Denial, not 404 | 403 `not_module_owner` |
| Picker | Owner opens a Module page with Projects Root > A > C | The picker lists Root, A, C in tree order, with Root selected; editing shows the fixed scope as text | none |
| Tree down | The tree call fails, the list loads | Forms show the root-only note; a submit goes to the root | panel catches |

</intent-contract>

## Code Map

- `packages/contract/src/standards.ts` -- `StandardPublishRequest` (add `projectId?: string`, documented for new Standards only), the `StandardInfo.project` doc ("the tenant's root Project in this release" → the Standard's Project scope, fixed at version 1). `PROJECT_NOT_FOUND` comes from `projects.ts`.
- `apps/registry/src/standards/validate.ts:476` `validatePublishBody` -- today it accepts exactly `{entry}`. Extend it to take `{ allowProjectId: boolean }` and return `{ entry, projectId: string | undefined }`. Unknown keys are still refused first, with `projectId` unknown when not allowed. The entry is validated before the `projectId` type check.
- `apps/registry/src/standards/service.ts:129` `publish` -- after `validatePublishBody`, resolve the scope: `existing?.projectId`, or the given `projectId` (`isUuidV7`, then look it up in the `projectsById(tx, tenantId)` map, else `project_not_found` subject `projectId`), or `root.id`. Then call `validatePublication(await liveSet(tx, tenantId), proposed)` with no `projectId`, so the pair check covers all scopes. `toStandardInfo` already serves `project` from the row.
- `apps/registry/src/http/server.ts` -- `STATUS_BY_CODE` already maps `project_not_found` to 404 (Story 2.1); routes unchanged.
- `apps/registry/src/standards/standards.db.test.ts` -- harness: `post`, `publishNew` (~line 135), `expectRefused`, `published`, `counts`; `createProjectService` is already wired (line 216). Create child Projects via `POST /v1/projects` as the Buyer. `validate.test.ts` holds the body unit tests.
- `apps/registry/src/http/server.test.ts` -- the fake-service pattern; no route change, so it only needs touching if types break.
- `apps/panel/src/registry.server.ts:158` `publishStandard(token, moduleId, entry)` -- add an optional `projectId` and send it only when defined. `getProjectTree` is at :176.
- `apps/panel/src/routes/module-standards.tsx`:
  - The loader returns `standards: listStandards(...)`. Change it to defer `Promise<{ list, tree }>` built from both calls, or add a second deferred `tree` promise; either works if the cold-load stays the same.
  - The action reads `projectId` from the form only when it is not editing.
  - `refusal()` maps `PROJECT_NOT_FOUND`, and `invalid_input` with subject `projectId`, to a field error.
  - `PublishedFacts` hardcodes "(root Project)", and `COLD_LOAD_HEADERS` and both tables need the new column.
- `apps/panel/src/components/standard-form.tsx`:
  - `STANDARDS_COPY.published` and `.conflict` hardcode "root Project"; the conflict copy should use `holder.project.name`.
  - `StandardFormValues` and `StandardFormField` need `projectId`.
  - Add an exported `ProjectScopeField` used by both forms.
- `apps/panel/src/components/design-system-form.tsx` -- takes `StandardFormProps`; render `ProjectScopeField` before "Entry kind".
- `apps/panel/src/routes/module-standards.test.tsx`, `module-standards.action.test.ts` -- existing fakes for `listStandards` need a `getProjectTree` fake too.
- `README.md:156-180` -- the Standards section ("the Company's root Project for now", the endpoint table, the check order).

## Tasks & Acceptance

**Execution:**
- [x] `packages/contract/src/standards.ts` (+ `standards.test.ts` if it pins the type docs) -- `projectId?` on `StandardPublishRequest`; updated `project` doc.
- [x] `apps/registry/src/standards/validate.ts` (+ `validate.test.ts`) -- `validatePublishBody(body, kind, { allowProjectId })` returning `{ entry, projectId }`. Tests: allowed and missing; a string; `7` and `null` refused with subject `projectId`; refused as an unknown key when not allowed; an entry error wins over a bad `projectId`.
- [x] `apps/registry/src/standards/service.ts` -- scope resolution and the all-scope slot check as in the Code Map. Update the `publish` doc comment's check order.
- [x] `apps/registry/src/standards/standards.db.test.ts` -- every registry row of the matrix over HTTP:
  - a scoped publish, and the list and versions showing the scope;
  - the same slot at a child accepted, and the same slot at the same non-root scope refused, naming both ids;
  - a new version keeps its scope;
  - a version with `projectId` → 400;
  - a foreign, unknown or malformed `projectId` → 404, and the wrong types → 400, each with no rows written;
  - a non-owner with a foreign `projectId` → 403.
- [x] `apps/panel/src/registry.server.ts` (+ test) -- `publishStandard` with an optional `projectId`.
- [x] `apps/panel/src/components/standard-form.tsx`, `design-system-form.tsx`, `routes/module-standards.tsx` (+ CSS only if needed) -- the picker and fixed-scope text, the tree-unavailable note, the action and refusal mapping, the scope column, and the facts and copy naming the scope.
- [x] panel tests -- the picker options, order and default; editing shows the fixed scope with no picker; a refused submit keeps the chosen scope; a field error for `project_not_found`; the tree-down note; the action sends `projectId` only for new Standards; the conflict copy names the holder's Project; the tables show the scope column.
- [x] `README.md` -- the scope in the publish body, the fixed scope, `project_not_found` in the check order, and the per-scope slot rule.

**Acceptance Criteria:**
- Given a Standard owner on a Module page and a tree with several Projects, when they choose a Project scope and publish, then the published facts and the Standards table show that Project as the scope.
- Given a live Standard in slot (code stack, library, "X") at P, when the owner publishes another library "X" at P's child C, then it is accepted; and when they publish a third at P itself, then it is refused and the page names both Standards.
- Given a fresh clone without `REGISTRY_TEST_DATABASE_URL` and `CI`, when build, typecheck, lint, boundaries and test run, then all pass with the DB suites skipped.

## Spec Change Log

## Review Triage Log

### 2026-10-12 — Review pass
- verdicts: 21 findings — high 0, medium 0, low 14, false 7, maybe-false 0
- findings:
  - `[false]` `[reject]` EC1: a pre-existing conflicting pair at another scope would block every publish. Unreachable: every mutation is validated under the bundle lock, so the live set is never inconsistent; a loud refusal on an impossible state is correct.
  - `[false]` `[reject]` EC2: a pair-check conflict shows copy about an unrelated Standard. Same unreachable state as EC1.
  - `[false]` `[reject]` EC3: a kept `projectId` missing from the reloaded tree resets to the root. Projects cannot be deleted (2.1 Never), so a listed id never disappears.
  - `[false]` `[reject]` EC4: an uppercase UUIDv7 is refused. Ids are canonical lowercase by contract (`ids.ts`), and malformed ids are `not_found` everywhere since 2.1.
  - `[low]` `[reject]` EC5: the conflict copy says "at the same Project scope" when the holder lookup fails. Only during a registry outage between two calls; naming it would add branches.
  - `[low]` `[patch]` VG1: the design-system form's scope wiring (kept value, field error, fixed text when editing) was untested. Added page tests and action tests for the design-system form.
  - `[low]` `[reject]` IA1: AC2's accept-then-refuse sequence is proven at the registry (DB suite, run in CI), and the panel only against fixtures. This is the same split as Stories 1.3–2.1.
  - `[false]` `[reject]` IA2: the picker on the design-system form goes beyond "standard-form". The story says "a Standard", and the design-system form is standard-form for that Module kind (1.6).
  - `[false]` `[reject]` IA3: the fixed scope per Standard is one reading among others. The story is silent on versions, and a fixed scope contradicts no AC (Design Notes).
  - `[low]` `[patch]` BH1: a stale "exactly `{ entry }`" doc comment sat above `PublishBodyOptions`. Deleted.
  - `[low]` `[patch]` BH2: `liveSet`'s `projectId` parameter was dead. Removed the parameter, its filter and that part of the doc.
  - `[low]` `[reject]` BH3: Projects that share a name cannot be told apart in the picker or the table. The options are in tree order with level names; pilot trees are small; a path label is UX polish beyond the ACs.
  - `[low]` `[reject]` BH4: when the tree is unavailable, publishes go to the root. This is the specified fallback with a visible note, and it only happens during an outage.
  - `[low]` `[reject]` BH5: the list waits for the tree. Both are fast registry calls, and the cold-load is unchanged.
  - `[low]` `[reject]` BH6: there is no non-DB test of the standards route's 404. The `project_not_found` → 404 mapping is already pinned in `server.test.ts` (2.1), and the DB suite runs in CI.
  - `[low]` `[reject]` BH7: there is no design-system DB test of the per-scope rule. The core slot rule does not depend on the Module kind (`slots.test.ts`), and scope resolution is shared.
  - `[low]` `[patch]` BH8: the design-system action with `projectId` was untested. Same root cause as VG1, fixed by the same tests.
  - `[low]` `[reject]` BH9: `projectsById` runs twice per scoped publish. Pilot scale; same call as 2.1 BH10.
  - `[low]` `[reject]` BH10: on `/versions`, `projectId` is refused before the entry. That follows the documented rule that unknown keys are refused first (1.5).
  - `[false]` `[reject]` BH11: the spec's checkboxes and logs are stale. The workflow fills them at finalisation.
  - `[low]` `[reject]` BH12: the registry's conflict message names the Project by UUID. The panel shows names; the API message is for callers that have the ids.

## Design Notes

- **Why the scope is fixed per Standard.** The scope lives on the append-only `standards` row, not on versions. Moving a Standard would need an UPDATE, or a scope per version that 2.3's resolver would have to interpret. A different scope is a new Standard, published at that Project.
- **Why `projectId` is optional.** The root default keeps every existing client and test from Stories 1.5 and 1.6 valid, and it matches the picker's default.
- **Why the slot check runs over the whole live set.** It is the same rule that `validateBundleInput` applies, and the pair check then covers every scope, not only the proposed one. It keeps the proposed-first naming that the panel's conflict copy depends on (subject = the holder).

## Verification

**Commands:**
- `docker compose up -d --wait postgres` then `REGISTRY_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres pnpm test` -- expected: all suites pass, with the DB suites run.
- `pnpm run build && pnpm run typecheck && pnpm run lint && pnpm run boundaries` -- expected: exit 0.
- `pnpm test` without the env var -- expected: passes, with the DB suites skipped.

## Auto Run Result

Status: done

**Summary:** A Standard owner can publish a new Standard at any Project of the Company's Project tree:
- `POST /v1/modules/{id}/standards` takes an optional `projectId`; a missing `projectId` means the root Project.
- The scope is fixed for the Standard's life. A new version keeps it, and `projectId` on `/versions` is `400 invalid_input`.
- An unknown, malformed or another Company's Project id is `404 project_not_found`, checked after the owner check and the entry.

The core Conflict slot rule now runs over the live set of every scope. The same slot is accepted at a child Project and refused a second time at one scope, and the refusal names both Standards.

In the panel, both Standards forms gain a "Project scope" picker for a new Standard:
- It lists every Project in tree order, with the root selected by default.
- When editing, it shows the fixed scope as text instead.
- If the tree is unavailable, it shows the root-only note.
- A refused submit keeps the chosen scope, with a field error on a bad scope.

The tables, the published facts, the success status and the conflict copy name the scope Project.

**Files changed:**
- `packages/contract/src/standards.ts`: `projectId?` on `StandardPublishRequest`; the scope documented as fixed.
- `apps/registry/src/standards/validate.ts` (+ test): `validatePublishBody(body, kind, { allowProjectId })` returning `{ entry, projectId }`.
- `apps/registry/src/standards/service.ts`: scope resolution (`resolveScope`), the all-scope slot check, and `liveSet` simplified to every scope.
- `apps/registry/src/standards/standards.db.test.ts`, `src/http/server.test.ts`: the Project scope block over HTTP, and the fake updated.
- `apps/panel/src/registry.server.ts` (+ test): `publishStandard` takes an optional `projectId`.
- `apps/panel/src/components/{standard-form,design-system-form}.tsx`: `ProjectScopeField`, and copy naming the scope.
- `apps/panel/src/routes/module-standards.tsx` (+ tests): a deferred tree promise, the action and refusal mapping, and the scope column.
- `README.md`: the scoped publish body, the fixed scope, the check order, and the per-scope rule.

**Review findings:** 21 findings: high 0, medium 0, low 14, false 7.
- **Patched (4 rows in 3 entries, all low):**
  - BH1: the stale doc comment was deleted.
  - BH2: the dead `liveSet` parameter was removed.
  - VG1/BH8: design-system scope page and action tests were added.
- **Deferred:** none.
- **Rejected:** 10 low and 7 false, each with its reason in the triage log.

**Follow-up review recommended: false.** Patched counts: high 0, medium 0, low 3 entries.

**Verification:**
- `pnpm run build`, `typecheck`, `lint` and `boundaries` exit 0 after the patches.
- With `REGISTRY_TEST_DATABASE_URL` (compose Postgres), all pass:

  | Package | Tests passed |
  |---|---|
  | registry | 460 |
  | panel | 248, plus 1 skipped (the existing contrast exception) |
  | contract | 143 |
  | core | 32 |
  | boundaries | 16 |

- Without the database URL, all pass and the DB suites print their skip reason.
- Matrix audit: every row has a covering test that ran: `standards.db.test.ts` "Project scope (Story 2.2)", `validate.test.ts`, and `module-standards.test.tsx` / `.action.test.ts`.

**Residual risks:**
- Choices made on the human's behalf: a missing `projectId` means the root; the scope is fixed per Standard; the tree-down fallback goes to the root.
- Projects that share a name look alike in the picker.
- The panel was checked in jsdom only.
