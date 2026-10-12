---
title: 'Story 2.3: Resolve and preview the Effective Standard set for a Project'
type: 'feature'
created: '2026-10-12'
status: 'done'
baseline_commit: '54367117784d96c45ff5dca22691868c2d9114c8'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-2-standard-owner-scopes-a-standard-to-any-project.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** Standards can now be scoped to any Project (Story 2.2), but nothing computes which Standards a Project actually receives. Owners and the Buyer cannot check precedence before Guidance and the Gate rely on it (FR-6).

**Approach:** Add a pure resolver `resolveEffectiveSet` to `packages/core`. Given (Project tree, live Standards, Locked rules, Project), it returns the Effective Standard set: walking from the Project up to the root, the closest Standard wins in each Conflict slot, and an ancestor's Locked rule is never replaced. The registry serves it at `GET /v1/projects/{id}/effective-standards` to every role. Selecting a Project on the Project tree surface shows its set in a table.

## Boundaries & Constraints

**Always:**
- **Core purity (AD-1).** `resolveEffectiveSet` lives only in `packages/core`. It does no I/O, reads no clock, and imports only `contract`.
  - Input: `{ projects: TreeNode[], standards: SlotHolder[], lockedStandardIds: readonly string[], projectId }`.
  - Output: `{ ok: true, set: EffectiveEntry[] }` or `{ ok: false, error: ErrorEnvelope }`.
  - `EffectiveEntry` is `{ standardId, slot, sourceProjectId, locked }`.
- **Rules**, applied in this order:
  1. `validateProjectTree(projects)` must pass, otherwise its error is returned.
  2. `projectId` must be in the tree, otherwise `project_not_found` with subject `projectId`.
  3. Only Standards whose scope is the Project or one of its ancestors are considered.
  4. If two considered Standards share a slot (`sameSlot`) at one scope, return `slot_conflict`. The message names both Standard ids, the subject is the smaller id, and the result is order-independent. It is never a guess. Standards off the path are never checked.
  5. Per slot, if any considered holder is locked, the locked holder nearest the root wins. Otherwise the holder nearest the Project wins.
  6. Slots that differ never compete: a token and a library both stay.
- **Determinism (NFR-1).** The output is sorted by moduleKind, then slotKind, then `normalizeSlotName(name)`, then standardId (code-unit order). The same input in any order gives a `JSON.stringify`-identical result. A property test over seeded random trees proves this, with no new dependency (a small seeded PRNG in the test). The test also checks the result against a brute-force oracle.
- **Locked rules.** No Locked rules are stored yet (Story 2.4), so the registry passes `lockedStandardIds: []`. Core still implements and tests rule 5.
- **Contract** (`effective.ts`):
  - `EffectiveStandard` has these fields:
    - `slot { moduleKind, slotKind, name }`;
    - `status`: the entry's `status`, or `null` for a component;
    - `standard`: the live `StandardInfo`;
    - `sourceProject`: a `ProjectRef`;
    - `locked`: boolean.
  - `EffectiveStandardSet` is `{ project: ProjectRef, standards: EffectiveStandard[] }`, in core's order.
  - Also add `effectiveStandardsPath(id)` and the `isEffectiveStandardSet` guard. No plan names.
- **Registry.** `GET /v1/projects/{id}/effective-standards` is open to every role. It checks, in order:
  1. 401 without a valid session;
  2. a malformed, unknown or other tenant's id → `404 project_not_found`, subject `projectId`;
  3. it builds the current tree (2.1's latest parent rows) and `liveSet` (every scope), and calls core;
  4. a core error is thrown as is (`slot_conflict` → 409).

  Each entry is joined to its live `StandardInfo` and its source Project's name. The order is never changed and nothing is filtered. All queries run in one `withTenant` transaction.
- **Panel.** It imports `contract` only.
  - The `/projects` loader also defers the selected Project's set: a `?project=` id in the tree, otherwise the root.
  - Under the tree, a section with h2 "Effective Standard set for <name>" holds a table with `th scope="col"` headers: "Conflict slot", "Status", "Version", "Source Project". Each row has a `th scope="row"` slot cell written as `(code stack, library, "X")` using `MODULE_KIND_LABELS`. "Status" shows "None" when the status is null. "Source Project" shows the name, with " (this Project)" when the Standard is scoped to the selected Project.
  - The set has its own `Suspense`: the tree shows first, and the section shows `aria-busy="true"` with "Loading the Effective Standard set…".
  - Empty state: "No Standard applies to <name> yet."
  - Failure: "The Effective Standard set is unavailable right now. Try again in a few minutes." The tree and forms stay.
  - At ≥1280px the table sits beside the tree (CSS grid, tokens only).
  - Use the glossary terms exactly.

**Never:** No storing or marking Locked rules, and no Locked mark in the UI (Story 2.4). No child-creation permission (2.5), no plan gating (2.6). No caching of resolved sets. No resolution logic outside `core`, and no sorting or filtering of core's output in the registry or panel. No `core` import in the panel. No new dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Closest wins | Root P: library "X" approved; child C: library "x" prohibited | C's set has one entry for that slot: C's Standard (prohibited), source C | none |
| Inherit | Same tree; resolve P | P's Standard, approved, source P; C's Standard absent | none |
| Different slots | token "primary" at P, library "React" at C | C's set holds both | none |
| Off-path | library "X" at sibling S of C | not in C's set | none |
| Locked (core only) | P's "X" locked, C's "X" not | C's set holds P's Standard, `locked: true` | none |
| Same-scope tie (core) | Two holders, one slot, both at C | `slot_conflict` naming both ids, the same for any input order | error, never a guess |
| Determinism | Random trees and holders, shuffled, resolved twice | `JSON.stringify` identical; matches the oracle | none |
| Unknown Project (core / HTTP) | id not in the tree; malformed, unknown or foreign id | — | `project_not_found` / `404`, subject `projectId` |
| Every role | Buyer, Builder, Standard owner GET | 200, identical bodies for the same state | none |
| Panel select | Buyer selects C | The table shows C's rows with header cells; the source reads "C (this Project)" or the ancestor's name | none |
| Panel empty / busy / down | No Standards / set pending / set call fails | Empty text / `aria-busy` loading row / unavailable text; the tree and forms stay | panel catches |

</intent-contract>

## Code Map

- `packages/core/src/tree.ts` -- `TreeNode` and `validateProjectTree`: reuse them for rule 1. `slots.ts` provides `SlotHolder`, `ConflictSlot`, `sameSlot`, `normalizeSlotName` and the `conflict()` message shape. Add `resolve.ts` (+ `resolve.test.ts`, `resolve.property.test.ts`) and export from `index.ts` (`index.test.ts` may pin the exports).
- `packages/contract/src/projects.ts` -- the path helpers `projectPath`, `PROJECT_NOT_FOUND`. `standards.ts` provides `StandardInfo`, `ProjectRef`, `isStandardInfo`, `SLOT_CONFLICT`. `modules.ts` provides `MODULE_KIND_LABELS`, `isModuleKind`. Add `effective.ts` and re-export it from `index.ts`.
- `apps/registry/src/projects/service.ts` -- `currentProjects(tx, tenantId)` (current parents), `treeNodes`, `projectNotFound(subject)`, the `getProject` pattern, `liveSet` imported from `../standards/service.ts`. Add `getEffectiveSet` to the functions and to the `ProjectService` interface.
- `apps/registry/src/standards/service.ts` -- `toStandardInfo`, `accountNames`, and the `selectDistinctOn` live-version query in `listStandards`. Export a helper `liveStandardInfos(tx, tenantId): Map<standardId, StandardInfo>` for the join.
- `apps/registry/src/http/server.ts:71-92` -- the `ROUTES` regex and allowed-methods table. Add `PROJECT_EFFECTIVE_ROUTE` (`/^\/v1\/projects\/([^/]+)\/effective-standards$/`, GET) and a case next to `PROJECT_ROUTE`. `slot_conflict` already maps to 409.
- `apps/registry/src/http/server.test.ts` -- the fake `ProjectService` needs `getEffectiveSet`. `projects/projects.db.test.ts` holds the HTTP harness for Buyer, Builder and owner sessions, Project creation and publishing (see `standards.db.test.ts` `publishAt` from 2.2).
- `apps/panel/src/registry.server.ts:176` -- the `getProjectTree` pattern. Add `getEffectiveStandards(token, projectId)`.
- `apps/panel/src/routes/project-tree.tsx` -- the loader (`projectParam`, the `tree` promise) and the selection logic in `Loaded` (param, then root). Add an `effective` promise: chain it off `tree` and resolve the same selected id. `Loaded` renders the new section.
- `apps/panel/src/components/project-tree.tsx` -- `PROJECT_TREE_COPY`. Add an `EffectiveSetTable` component plus copy.
- `apps/panel/src/styles/components.css:279` -- `.project-tree-section`. `styles.test.ts` enforces tokens only.
- `apps/panel/src/routes/project-tree.test.tsx`, `project-tree.action.test.ts`, `registry.server.test.ts` -- the existing fakes need the new call.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contract/src/effective.ts` (+ `index.ts`, `effective.test.ts`) -- the types, path and guard as in Boundaries.
- [x] `packages/core/src/resolve.ts` (+ `index.ts`) -- `resolveEffectiveSet` with rules 1–6 and the sort.
- [x] `packages/core/src/resolve.test.ts` -- the core rows of the matrix: closest wins, inherit, different slots, off-path, locked, a same-scope tie in two input orders, unknown Project, an invalid tree, and an empty set.
- [x] `packages/core/src/resolve.property.test.ts` -- with a seeded PRNG, 300 random trees (1–12 nodes) with random holders over a small slot pool (no same-scope duplicates, random locks). For each: shuffled inputs give identical `JSON.stringify`, two calls are identical, and the result equals the brute-force oracle (per slot, walk ancestors). Also generate cases with a same-scope duplicate on the path and expect a stable `slot_conflict`.
- [x] `apps/registry/src/standards/service.ts`, `projects/service.ts`, `http/server.ts`, `src/index.ts` -- `liveStandardInfos`, `getEffectiveSet`, the route and the wiring.
- [x] registry tests -- `server.test.ts`: route, method and status with the fake. `projects.db.test.ts` (or a new `effective.db.test.ts` using the same harness), over HTTP:
  - closest wins (the AC example: parent allows X, child prohibits X → prohibited, source child);
  - inherit;
  - token plus library both present;
  - an off-path sibling excluded;
  - every role 200 with byte-identical bodies on two GETs;
  - foreign, unknown and malformed ids → 404.
- [x] `apps/panel/src/registry.server.ts` (+ test) -- `getEffectiveStandards`.
- [x] `apps/panel/src/routes/project-tree.tsx`, `components/project-tree.tsx`, `styles/components.css` -- the deferred `effective` promise, the section with its own Suspense, the table, and the empty, busy and unavailable states, plus the ≥1280px layout.
- [x] panel tests -- the loader returns the pending `effective` promise for the selected id (param or root). The page shows header cells (`columnheader` ×4 and `rowheader`), slot text, status "None" for a component, version, and the source with "(this Project)". Also the empty text, the busy state with the tree visible, and the unavailable text with the tree and forms still visible.
- [x] `README.md` -- the Effective Standard set: precedence, the endpoint and its refusals, determinism, and the panel preview.

**Acceptance Criteria:**
- Given a parent allowing library X and a child prohibiting X, when the Buyer selects the child on the Project tree surface, then the Effective Standard set table shows X as prohibited with the child as source Project.
- Given `packages/core`, when the boundaries check runs, then `resolve.ts` imports nothing but `contract` and `core` siblings, and the panel does not import `core`.
- Given a fresh clone without `REGISTRY_TEST_DATABASE_URL` and `CI`, when build, typecheck, lint, boundaries and test run, then all pass with the DB suites skipped and the property test run.

## Spec Change Log

## Review Triage Log

### 2026-10-12 — Review pass
- verdicts: 23 findings — high 0, medium 2, low 16, false 5, maybe-false 0
- findings:
  - `[medium]` `[patch]` EC1: `liveStandardInfos` reads Projects, Modules and versions in separate READ COMMITTED statements. A Project plus a Standard committed in between makes the GET throw "is missing" (500). Fixed: `getEffectiveSet` takes `lockBundle` before any read.
  - `[medium]` `[patch]` EC2: the tree and the Standards could come from different commits, giving a set that never existed. Same root cause as EC1, fixed by the same lock.
  - `[low]` `[reject]` EC3: core output depends on order when one `standardId` appears twice with different spellings. Unreachable: the registry builds the holders from a map keyed by id, and validating the input would add branches.
  - `[low]` `[reject]` EC4: the contract guard does not check that `slot`, `status` and `standard` agree. The registry is the only producer and derives them from one row (same as 2.1 BH7).
  - `[low]` `[patch]` VG1: no test with a second version, so a broken live-version pick would pass. Added a DB test: version 2 of an on-path token shows `version: 2` and the new status.
  - `[low]` `[reject]` VG2: the registry order test compares `|`-joined strings, not core's tuple order. This only matters for fixture names that are prefixes of each other, which is not the case today.
  - `[low]` `[reject]` BH1: `slot_conflict` and `session_invalid` on the set show as "unavailable". A conflict cannot happen (AD-13 at publish), and a lapsed session already fails the tree call first, so the sessionEnded copy shows.
  - `[low]` `[reject]` BH2: the registry derives `SlotHolder`s from `StandardInfo` instead of `liveSet`. Both use the contract's `entrySlotKind`/`entrySlotName` on the same live row; one read keeps the join and the resolution consistent.
  - `[low]` `[reject]` BH3: the live-version query appears three times. A refactor with no named harm in this story.
  - `[low]` `[reject]` BH4: each GET does full-tenant reads and an O(n²) pair check. Pilot scale (same call as 2.1 BH10).
  - `[low]` `[patch]` BH5: the contract's `locked` doc said "an ancestor's Locked rule", but core sets it for any locked winner. The contract doc now matches core.
  - `[low]` `[reject]` BH6: the guard does not cross-check duplicated fields. Same as EC4.
  - `[low]` `[reject]` BH7: the panel never compares `set.project.id` with the selection. The loader derives both from the same selected id.
  - `[low]` `[reject]` BH8: the set fetch waits for the tree. The specified chaining, needed for the root fallback.
  - `[low]` `[reject]` BH9: core does not reject duplicate ids or unknown locked ids. Same as EC3; no adapter can produce them.
  - `[low]` `[reject]` BH10: the 409 is not tested over the DB; the fake "every role" test omits the owner. The 409 cannot be produced through the API (AD-13); the DB suite covers all three roles.
  - `[low]` `[reject]` BH11: `aria-busy` is set on the section, the tbody and the row. Same pattern as the existing Standards cold-load.
  - `[low]` `[reject]` BH12: quotes inside slot names are not escaped in the label. Same formatting as core's `formatSlot` and the 1.5 copy.
  - `[false]` `[reject]` BH13: the spec's checkboxes and logs are stale. The workflow fills them at finalisation.
  - `[false]` `[reject]` IA1: reads are open to every role, not only the owner and the Buyer. This matches every read since 1.5, and the story names the audience, not a restriction.
  - `[false]` `[reject]` IA2: the Locked semantics in core go beyond 2.3. The AC makes Locked rules a resolver input, and the semantics follow the epic's rule (Design Notes).
  - `[false]` `[reject]` IA3: shadowed duplicates are errors, and the "version" column shows the Standard version. Both are on the walked path and are "met"; the version matches the existing Standards tables.
  - `[low]` `[reject]` IA4: the panel AC is proven with fixture sets. This is the same split as earlier stories, with the real chain proven in the loader, client and DB suites.

## Design Notes

- **Why the Locked-rule input ships now.** The AC defines the resolver as a function of (tree, Standards, Locked rules). Putting the input and rule 5 in core now lets Story 2.4 only store and pass the marks. The rule follows the epic: a Locked rule from an ancestor stays and is never replaced, so the locked holder nearest the root wins.
- **Oracle for the property test.** For each slot key, list the holders on the path ordered from the Project to the root. The answer is the last locked holder if any exists, otherwise the first holder. This is a different algorithm from the implementation's single pass, so the two can be compared.
- **Why the registry joins but never reorders.** AD-1 forbids post-processing. Mapping ids to `StandardInfo` and Project names is presentation data. Order and membership come from core alone.

## Verification

**Commands:**
- `docker compose up -d --wait postgres` then `REGISTRY_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres pnpm test` -- expected: all suites pass, with the DB suites run.
- `pnpm run build && pnpm run typecheck && pnpm run lint && pnpm run boundaries` -- expected: exit 0.
- `pnpm test` without the env var -- expected: passes, with the DB suites skipped and the core property test run.

## Auto Run Result

Status: done

**Summary:** `packages/core` now has the pure resolver `resolveEffectiveSet`. It takes the Project tree, the live Standards, the Locked rules and one Project, and returns the Effective Standard set:
- It walks from the Project up to the root, and the closest Standard wins each Conflict slot.
- A Locked rule from an ancestor is never replaced (implemented and tested in core; the registry passes none until 2.4).
- Different slots never compete.
- Two Standards in one slot at one scope give `slot_conflict` naming both, never a guess.
- The output is order-independent and byte-identical across runs. A seeded property test over 300 random trees checks this against a brute-force oracle.

The registry serves the set at `GET /v1/projects/{id}/effective-standards` to every role:
- It reads under the bundle lock.
- It joins each entry to its live `StandardInfo` and source Project, without reordering or filtering core's output.
- A malformed, unknown or another Company's id is `404 project_not_found`.

On the Project tree surface, selecting a Project shows "Effective Standard set for <name>" in a table with header cells: Conflict slot, Status, Version, Source Project. The table has its own loading state, plus empty and unavailable states, and sits beside the tree from 1280px.

**Files changed:**
- `packages/core/src/resolve.ts` (+ `resolve.test.ts`, `resolve.property.test.ts`, `index.ts`): the resolver.
- `packages/contract/src/effective.ts` (+ test, `index.ts`): the wire types, path and guards.
- `apps/registry/src/standards/service.ts`: `liveStandardInfos`.
- `apps/registry/src/projects/service.ts`: `getEffectiveSet`, under the bundle lock.
- `apps/registry/src/http/server.ts`, `src/index.ts`: the route and exports.
- `apps/registry/src/http/server.test.ts`, `projects/projects.db.test.ts`: route tests, and the DB block over HTTP, including the live-version case.
- `apps/panel/src/registry.server.ts` (+ test): `getEffectiveStandards`.
- `apps/panel/src/routes/project-tree.tsx`, `components/project-tree.tsx`, `styles/components.css` (+ tests): the preview section.
- `README.md`: the Effective Standard set section.

**Review findings:** 23 findings: high 0, medium 2, low 16, false 5.
- **Patched (4 rows in 3 entries):**
  - EC1/EC2 (medium): the bundle lock on the GET.
  - VG1 (low): the version-2 DB test.
  - BH5 (low): the `locked` doc comment.
- **Deferred:** none.
- **Rejected:** 14 low and 5 false, each with its reason in the triage log.

**Follow-up review recommended: false.** Patched counts: high 0, medium 1 entry, low 2 entries.

**Verification:**
- `pnpm run build`, `typecheck`, `lint` and `boundaries` exit 0 ("no violations").
- With `REGISTRY_TEST_DATABASE_URL`, all pass:

  | Package | Tests passed |
  |---|---|
  | registry | 469 |
  | panel | 257, plus 1 skipped (the existing contrast exception) |
  | contract | 155 |
  | core | 44, including the property test |
  | boundaries | 16 |

- Without the database URL, all pass, the DB suites print their skip reason, and the property test runs.
- Matrix audit: every row has a covering test that ran:
  - core: `resolve.test.ts` and `resolve.property.test.ts`
  - registry: `projects.db.test.ts` and `server.test.ts`
  - panel: `project-tree.test.tsx` and `project-tree.action.test.ts`

**Residual risks:**
- Choices made on the human's behalf:
  - The Locked-rule semantics are already in core: the locked holder nearest the root wins.
  - Every role may read the set.
  - Shadowed same-scope duplicates are errors.
- The GET takes the tenant bundle lock, so it serialises with publishes and tree changes. That is fine at pilot scale.
- On navigation, the preview waits for the new set while keeping the previous view. It was checked in jsdom only.
- Guidance and Gate parity (FR-6 "two callers") will be proven only when those adapters exist (Epics 4–5).
