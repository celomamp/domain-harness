---
title: 'Story 2.4: Buyer marks Locked rules that descendants cannot override'
type: 'feature'
created: '2026-10-12'
status: 'done'
baseline_commit: '1b35ff2ec80da650fd4e734710012fb655030243'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-3-resolve-and-preview-the-effective-standard-set-for-a-project.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** Core already resolves Locked rules (Story 2.3 rule 5: the locked holder nearest the root wins). But nothing stores a Locked rule, so the registry always passes `lockedStandardIds: []`. As a result, a descendant Project can still replace any Standard (FR-6).

**Approach:**
- The Buyer marks or unmarks a Standard as a Locked rule on its own Project. Each mark is stored append-only.
- Core gets a whole-bundle Locked-rule check. It rejects two Locked rules in one Conflict slot where one Project is an ancestor of the other.
- The registry passes the current marks to every bundle validation and to the resolver.
- The Project tree surface shows the marks on the tree nodes and in the Effective Standard set table. Rows scoped to the selected Project get a mark/unmark button there.

## Boundaries & Constraints

**Always:**
- **Core (pure, AD-1/AD-13).**
  - `BundleInput` gains `lockedStandardIds?: readonly string[]` and `lockProposal?: string`. `lockProposal` is the id of the Standard that is being marked.
  - `validateBundleInput` checks, in order: the tree rule, the slot rule, then the new `validateLockedRules`.
  - `validateLockedRules` fails when two different locked holders satisfy `sameSlot`, and one holder's Project is a strict ancestor of the other's in the tree (with the `change` applied).
  - On failure it returns `locked_rule_conflict`. The message names both Standard ids, both Project ids and `formatSlot`.
  - The subject is the other Standard when the pair involves `lockProposal`, and such a pair is reported first. Otherwise the subject is the ancestor's Standard. Pairs are checked in Standard-id order, so the answer is independent of input order.
  - Locked ids that match no holder are ignored. Marks on unrelated branches, such as siblings, never conflict.
- **Storage.** Add migration `0007_locked_rules.sql` with table `locked_rule_changes`:
  - Columns: `id`, `tenant_id`, `standard_id`, `sequence` (per tenant, max + 1 under the bundle lock), `locked boolean`, `changed_by`, and `changed_at` (default `now()`).
  - Same-tenant FKs to `standards` and `accounts`, `UNIQUE (tenant_id, sequence)`, and RLS enabled and forced with the `tenant_isolation` policy.
  - Grant only `SELECT, INSERT` to `dh_registry_app`.
  - A Standard's current state is its highest-sequence row. No row means not locked.
  - Mirror the table in `schema.ts` and add it to `TENANT_TABLES`.
- **Mark endpoint.** `POST /v1/standards/{id}/locked-rule` takes exactly `{ "locked": boolean }`. Checks run under the bundle lock, first failure wins, and nothing is written on a failure:
  1. A malformed, unknown or other tenant's id → `404 standard_not_found`.
  2. Any role but the Buyer → `403 role_denied`, message "only the Buyer can mark or remove a Locked rule; nothing was changed".
  3. An invalid body → `400 invalid_input`, subject `locked` or the extra key.
  4. The same state as now → `200` and nothing is written.
  5. `locked: true` → `validateBundleInput` (current tree, `liveSet`, current locked ids plus this one, `lockProposal`) → `409 locked_rule_conflict`.
  6. Insert the row and return `200 LockedRuleState`.

  Unmarking never conflicts.
- **Every other bundle validation passes the current locked ids.** This covers `createProject`, `changeParent` and publishing:
  - A re-parent that puts a Locked rule under a contradicting ancestor Locked rule is rejected with 409.
  - Publishing runs `validatePublication` first. Then it runs `validateBundleInput` over the tree and the proposed live set, with the published version replacing its Standard's holder.
  - So a locked Standard whose new version moves into a contradicting slot is rejected.
  - To read the tree without an import cycle, move `currentProjects`, `treeNodes` and the `CurrentProject` type into `apps/registry/src/projects/current.ts`. Add `currentLockedIds(tx, tenantId)` (in `apps/registry/src/locked-rules/service.ts`).
- **Resolver input.** `getEffectiveSet` passes `currentLockedIds` to `resolveEffectiveSet`, so it no longer passes `[]`.
- **Tree response.** `ProjectTree` gains `lockedRules: LockedRuleMark[]`, holding only the Standards that are locked now:
  - `LockedRuleMark` is `{ standardId, projectId, markedAt, markedBy: AccountRef }`, from the current marking row.
  - The list is ordered by `projectId`, then `standardId`.
  - `isProjectTree` requires every mark's `projectId` to be in `projects`.
- **Contract.**
  - `LockedRuleMark` lives in `projects.ts` (it imports `AccountRef` from `modules.ts`).
  - New `locked-rules.ts` holds:
    - `LockedRuleRequest { locked }`;
    - `LockedRuleState { standard: StandardInfo, locked, changedAt: string | null, changedBy: AccountRef | null }`, where the null fields mean there is no row yet;
    - `lockedRulePath(standardId)`;
    - `LOCKED_RULE_CONFLICT = "locked_rule_conflict"`;
    - the guards `isLockedRuleMark` and `isLockedRuleState`.
  - Re-export from `index.ts` and avoid import cycles. Use no plan names.
- **Panel** (imports `contract` only, never hides a control by role):
  - **Tree nodes.** A node with marks shows "1 Locked rule" or "N Locked rules" after its level text, as part of its accessible name.
  - **Effective table.** It gains a fifth column, "Locked rule":
    - the cell reads "Locked rule" or "Not locked";
    - a row whose source is this Project also holds a form: `intent=lock`, hidden `standardId`, hidden `locked`;
    - the button is labelled "Mark as Locked rule" or "Remove Locked rule", followed by the slot as a visually hidden suffix.
  - **Action results.**
    - Success notices: "Marked <slot> on <Project> as a Locked rule." and "<slot> on <Project> is no longer a Locked rule."
    - `role_denied` → "Only the Buyer can mark or remove a Locked rule. Nothing was changed."
    - `standard_not_found` → "That Standard was not found. Nothing was changed."
    - `locked_rule_conflict` → "Nothing was changed. <slot> on <Project> contradicts the Locked rule <slot> on <Project> in the same Conflict slot." Both rules are looked up with `getStandardVersions` (latest version), falling back to the ids.
    - `invalid_input` and outages → `actionUnavailable`.
  - `module-standards` maps `locked_rule_conflict` from a publish to a denial with the registry's message wording: "Nothing was published. This version would contradict a Locked rule in the same Conflict slot."
- **README.** Add Locked rules: who may mark them, the endpoint, the contradiction rule, and how they appear in resolution and the panel.

**Never:** No child-creation permission (2.5) and no plan gating (2.6). No resolution or contradiction logic outside `core`, and no re-sorting of core output. No UPDATE or DELETE on the marks table. No `core` import in the panel. No new dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Mark | Buyer marks S (library "X", prohibited) at P | 200, `locked: true`, a row is stored; the tree shows "1 Locked rule" on P; P's table says "Locked rule" | none |
| Locked beats closer | S locked at P; child C has library "x" allowed | C's set: S, prohibited, source P, `locked: true` | none |
| Unmark | Buyer unmarks S | A new row `locked: false`; C's set: C's Standard wins again; the history keeps both rows | none |
| Same state | Mark an already locked S / unmark a never-locked S | 200, no row written | none |
| Contradicting descendant | S locked at P; Buyer marks C's "x" | — | 409 `locked_rule_conflict` naming both; subject S; nothing written |
| Contradicting ancestor | C's "x" locked; Buyer marks S at P | — | 409, subject = C's Standard |
| Sibling | Locked "X" at sibling S1 and S2 | both accepted | none |
| Re-parent into conflict | Locked "X" at P; locked "x" at Q (not under P); move Q under P | — | 409 `locked_rule_conflict`; parent unchanged |
| Version moves slot | Locked T at C moves to slot "X" while S locked at P | — | 409; no version written |
| Role | Standard owner / Builder mark or unmark | — | 403 `role_denied`; nothing written |
| Not found / body | foreign, unknown or malformed id; body `{}`, `{locked:"yes"}`, extra key | — | 404 `standard_not_found` / 400 `invalid_input` |
| Panel | Owner submits Mark | Denial status; the tree and table stay | panel maps it |

</intent-contract>

## Code Map

- `packages/core/src/tree.ts` -- `BundleInput` and `validateBundleInput` (the tree rule, then the slot rule). Add the locked-rule fields and the call to the new check. `slots.ts` provides `sameSlot` and `formatSlot`. Put `validateLockedRules` in a new `locked.ts` (it reuses the parent map with the `change` applied) and export it from `index.ts`. `index.test.ts` may pin the exports.
- `packages/core/src/resolve.ts` -- the resolver already honours `lockedStandardIds`. Add a test only if the coverage gap shows.
- `packages/contract/src/projects.ts` -- `ProjectTree`, `isProjectTree`; add `LockedRuleMark`. `modules.ts:72` has `AccountRef` (`isAccountRef` is private there and duplicated in `standards.ts:304`; follow that pattern). `standards.ts` has `StandardInfo`, `isStandardInfo`, `standardVersionsPath` and `STANDARD_NOT_FOUND`. Error codes: `errors.ts` / `index.ts`.
- `apps/registry/migrations/0006_project_tree.sql` -- the template for the append-only table, RLS and grants. `db/schema.ts` holds the Drizzle mirror and `TENANT_TABLES` (used by the tenancy/RLS tests).
- `apps/registry/src/projects/service.ts` -- `currentProjects`, `treeNodes`, `assertBundleValid`, `nextSequence`, `getTree`/`toTree`, `getEffectiveSet` (`lockedStandardIds: []` must change), `assertTreeBuyer`. Moving the reads to `projects/current.ts` breaks the `projects` → `standards` import cycle.
- `apps/registry/src/standards/service.ts` -- `publish` (the `validatePublication` call), `liveSet`, `lockBundle`, `findStandard`, `standardNotFound`, `toStandardInfo`. `modules/service.ts` provides `accountNames` and `accountRef`.
- `apps/registry/src/http/server.ts` -- `PARAM_ROUTES`, `ROUTES` and `STATUS_BY_CODE` (add `LOCKED_RULE_CONFLICT`: 409). The `default:` case is `STANDARD_VERSIONS_ROUTE`, so add an explicit case before it. `src/index.ts` handles the service wiring and exports.
- `apps/registry/src/http/server.test.ts` (fake services, tree fixture at :176). `projects/projects.db.test.ts` and `standards/standards.db.test.ts` hold the HTTP+DB harness (sessions per role, `publishAt`, Project creation).
- `apps/panel/src/registry.server.ts` -- the `call`/`json`/`bearer` helpers. Add `setLockedRule(token, standardId, locked)`. `getStandardVersions` already exists.
- `apps/panel/src/routes/project-tree.tsx` -- the `action` intents and `refusal`. Add `intent=lock`. `ProjectTreeActionData.intent` gains `"lock"`.
- `apps/panel/src/components/project-tree.tsx` -- `levelText`/`nodeName` (the node accessible name), `PROJECT_TREE_COPY.effective.headers`, and `EffectiveSetTable`/`EffectiveSetLoading`.
- `apps/panel/src/routes/module-standards.tsx:224` -- the `SLOT_CONFLICT` refusal mapping, next to which the new code goes.
- Fixtures that need `lockedRules: []`: `apps/panel/src/registry.server.test.ts`, `routes/project-tree*.test.*`, `routes/module-standards*.test.*`, `apps/registry/src/http/server.test.ts`, `packages/contract/src/projects.test.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/core/src/locked.ts` (+ `tree.ts`, `index.ts`, `locked.test.ts`) -- `validateLockedRules` and its `BundleInput` wiring. Tests:
  - ancestor/descendant conflict both ways;
  - the subject with and without `lockProposal`;
  - a sibling is OK;
  - different slots are OK;
  - a `change` that creates the conflict;
  - unknown locked ids are ignored;
  - shuffled input gives the identical result.
- [x] `packages/contract/src/projects.ts`, `locked-rules.ts` (+ `index.ts`, tests) -- the types, path, code and guards from Boundaries.
- [x] `apps/registry/migrations/0007_locked_rules.sql`, `src/db/schema.ts` -- the table, RLS and grants, plus the mirror and `TENANT_TABLES`.
- [x] `apps/registry/src/projects/current.ts`, `locked-rules/service.ts`, `projects/service.ts`, `standards/service.ts` -- these pieces:
  - the shared reads;
  - `currentLockedIds` / `currentLockedMarks`;
  - `setLockedRule`;
  - the locked ids in every validation and in the resolver;
  - `lockedRules` in the tree.
- [x] `apps/registry/src/http/server.ts`, `src/index.ts` -- the route, status and wiring.
- [x] registry tests -- `server.test.ts`: route, methods, statuses. A DB suite over HTTP (new `locked-rules/locked-rules.db.test.ts` reusing the harness) covering every registry row of the matrix. Also check the append-only history (row count after mark → unmark), that RLS isolation holds for `locked_rule_changes`, and that a tenant-B Buyer gets 404.
- [x] `apps/panel/src/registry.server.ts` (+ test) -- `setLockedRule`.
- [x] `apps/panel/src/routes/project-tree.tsx`, `components/project-tree.tsx`, `routes/module-standards.tsx` -- the node mark, the column and form, the lock intent with its notices and refusals, and the publish mapping.
- [x] panel tests -- the node accessible name with its mark, the five header cells, "Locked rule" from the parent row with the parent as source, and the button only on this-Project rows. Action: success both ways, plus `role_denied`, `standard_not_found` and `locked_rule_conflict` naming both slots/Projects. Also the module-standards conflict mapping, and the fixtures updated.
- [x] `README.md` -- the Locked rules section.

**Acceptance Criteria:**
- Given a parent Locked rule prohibiting library X and a child Standard allowing X, when the child is selected on the Project tree surface, then the table row for X shows "prohibited", the parent as Source Project and "Locked rule".
- Given a fresh clone without `REGISTRY_TEST_DATABASE_URL`, when build, typecheck, lint, boundaries and test run, then all pass with the DB suites skipped.

## Spec Change Log

## Review Triage Log

### 2026-10-12 — Review pass
- verdicts: 19 findings — high 0, medium 1, low 15, false 3, maybe-false 0
- findings:
  - `[low]` `[patch]` VG1: nothing pins the `lockedRules` order (Project id, then Standard id). Fixed: a DB test asserts the exact sorted order.
  - `[low]` `[patch]` VG2: a lapsed session on the `lock` intent is untested. Fixed: an action test expects the redirect to /sign-in.
  - `[low]` `[reject]` BH1: the route reads the body before the service checks, so 415/413 come before 404/403. That is the same transport-before-domain order as the existing parent route. 415 and 413 are transport refusals, not the domain check order the README lists.
  - `[low]` `[reject]` BH2: the panel answers 503 for a registry `invalid_input` on the lock intent. This matches the create/parent intents for an unmapped subject. The form only posts hidden true/false values, so a user cannot reach it.
  - `[low]` `[reject]` BH3: the publish refusal does not name the Locked rule. The spec fixes that wording, and naming it would add a lookup branch for a rare case (a locked Standard moving slot).
  - `[low]` `[reject]` BH4: the mark response reads the whole tenant's live set and accounts under the lock. Pilot scale, the same as 2.3 BH4.
  - `[low]` `[reject]` BH5: `isAccountRef` is duplicated a fourth time. The spec follows the existing pattern; consolidating it is a refactor with no named harm.
  - `[low]` `[reject]` BH6: `lockedRules` is required, so an older registry breaks the panel. The panel and registry ship together from one monorepo release, the same as the field additions in 2.3.
  - `[low]` `[reject]` BH7: the tree shows a count, not which rules. Selecting the Project lists them in its Effective Standard set (Design Notes).
  - `[low]` `[patch]` BH8: the visible lock count reused the level class with no separator ("level Division1 Locked rule"). Fixed: its own class and a visible separator.
  - `[low]` `[patch]` BH9: no test of create/publish with an unlocked holder under an ancestor lock. Fixed: a DB test shows the publish succeeds while the lock stays the effective winner, and the create succeeds.
  - `[false]` `[reject]` BH10: the spec checkboxes and logs are stale. The workflow fills them at finalisation.
  - `[false]` `[reject]` BH11: the conflict lookup uses the posted id, so an empty id would call `/v1/standards//versions`. An empty or malformed id is refused by the registry with 404 `standard_not_found` before any conflict, so the conflict branch never sees it.
  - `[low]` `[reject]` BH12: no concurrent-marks test. Marks take the same bundle lock whose serialisation the projects suite already proves.
  - `[low]` `[reject]` EC1: the same as BH1.
  - `[medium]` `[patch]` EC2: `getTree` read the tree and the marks in separate READ COMMITTED statements, so a Project, a Standard and a mark committed in between gave a mark for an unlisted Project, and `isProjectTree` rejected the tree. Fixed: `getTree` takes the bundle lock first.
  - `[low]` `[reject]` EC3: the same as BH2.
  - `[false]` `[reject]` IA1: the intent-alignment audit was descriptive. It confirms that the reading is the whole-bundle, symmetric, same-slot invariant shown in the registry and panel, as specified in the spec and Design Notes. The status-blind contradiction is the specified reading, not a defect.
  - `[low]` `[reject]` IA2: the end-to-end evidence sits in DB suites that skip without a database. They were run in this verification with `REGISTRY_TEST_DATABASE_URL`, and the split is the same as in earlier stories.

## Design Notes

- **Contradiction = same Conflict slot on an ancestor/descendant path.** A descendant Locked rule in an ancestor's locked slot could never take effect, because the ancestor wins (2.3 rule 5). A design-system component has no status, so "contradicts" cannot mean differing status. The check is symmetric, so the order in which the marks were made does not matter.
- **Why the effective table hosts the mark buttons.** Every Standard scoped to P that can be marked is in P's Effective Standard set with source P. A Standard shadowed by an ancestor Locked rule would be rejected anyway. So no new per-Project listing endpoint is needed.

## Verification

**Commands:**
- `docker compose up -d --wait postgres` then `REGISTRY_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres pnpm test` -- expected: all suites pass, with the DB suites run.
- `pnpm run build && pnpm run typecheck && pnpm run lint && pnpm run boundaries` -- expected: exit 0.
- `pnpm test` -- expected: passes, with the DB suites skipped.

## Auto Run Result

Status: done

**Summary:** The Buyer can now mark or unmark a Standard as a Locked rule on its own Project with `POST /v1/standards/{id}/locked-rule` `{ locked }`.
- **Storage.** Each change is stored append-only in `locked_rule_changes` (migration 0007, RLS, SELECT/INSERT only). Marking an already locked Standard, or unmarking one that was never locked, writes nothing.
- **Refusals.** Standard owners and Builders get `403 role_denied`. A foreign, unknown or malformed id gets `404 standard_not_found`.
- **Contradictions.** Core's new `validateLockedRules`, run inside `validateBundleInput`, rejects two Locked rules in one Conflict slot on an ancestor/descendant path. It returns `409 locked_rule_conflict` naming both rules, in either direction. The check also runs on Project create, re-parent and publish, so a re-parent or a new version cannot create a contradiction.
- **Resolution.** The resolver now receives the stored marks, so an ancestor's Locked rule beats a closer Standard.
- **Tree response.** `GET /v1/projects` returns `lockedRules` (who marked each rule and when), read under the bundle lock.
- **Panel.**
  - Tree nodes show "N Locked rules".
  - The Effective Standard set table has a "Locked rule" column, and an ancestor's rule shows that ancestor as its source.
  - Rows scoped to the selected Project carry a "Mark as Locked rule" / "Remove Locked rule" button.
  - Denials and conflicts appear as status messages, and the conflict message names both rules and their Projects.
  - A publish that would contradict a Locked rule shows a denial on the Module page.

**Files changed:**
- `packages/core/src/locked.ts` (+ test), `tree.ts`, `index.ts`: the contradiction check and its `BundleInput` wiring.
- `packages/contract/src/locked-rules.ts` (+ test), `projects.ts`, `index.ts`: `LockedRuleMark`, `ProjectTree.lockedRules`, the request/state types, the path, `LOCKED_RULE_CONFLICT` and the guards.
- `apps/registry/migrations/0007_locked_rules.sql`, `src/db/schema.ts`: the append-only table and its mirror.
- `apps/registry/src/locked-rules/{current,service}.ts` (+ DB test): the mark reads and `setLockedRule`.
- `apps/registry/src/projects/current.ts`: the shared tree reads, moved out of the projects service to avoid an import cycle.
- `apps/registry/src/projects/service.ts`, `standards/service.ts`: Locked rules in every validation, in the resolver and in the tree.
- `apps/registry/src/http/server.ts`, `serve-cli.ts`, `index.ts` (+ tests): the route, the 409 mapping and the wiring.
- `apps/panel/src/registry.server.ts`, `routes/project-tree.tsx`, `components/project-tree.tsx`, `routes/module-standards.tsx`, `styles` (+ tests): the client call, the lock intent, the node mark, the table column and form, and the publish mapping.
- `README.md`: the Locked rules section.

**Review findings:** 19 findings: high 0, medium 1, low 15, false 3.
- **Patched (5):**
  - EC2 (medium): `getTree` reads under the bundle lock.
  - VG1: the `lockedRules` order test.
  - VG2: the lapsed-session test for the lock intent.
  - BH8: the visible lock count gets its own span and a separator.
  - BH9: tests for an unlocked publish and a create under an ancestor lock.
- **Deferred:** none.
- **Rejected:** 11 low and 3 false, each with its reason in the triage log.

**Follow-up review recommended: false.** Patched counts: high 0, medium 1, low 4.

**Verification:**
- `pnpm run build`, `typecheck`, `lint` and `boundaries` exit 0 ("no violations").
- With `REGISTRY_TEST_DATABASE_URL`, all pass:

  | Package | Tests passed |
  |---|---|
  | registry | 493 |
  | panel | 270, plus 1 skipped (the existing one) |
  | contract | 169 |
  | core | 56 |
  | boundaries | 16 |

- Without the database URL, `pnpm test` passes with the DB suites skipped.
- Matrix audit: every row has a covering test that ran:
  - `locked.test.ts`
  - `locked-rules.db.test.ts`
  - `project-tree.test.tsx` and `project-tree.action.test.ts`

**Residual risks:**
- Choices made on the human's behalf:
  - "Contradicting" means the same Conflict slot on an ancestor/descendant path, whatever the status.
  - The check is symmetric and applies to every bundle mutation.
  - Mark controls live only on this-Project rows of the Effective Standard set table.
  - Controls are shown to every role, and the registry denies non-Buyers.
- The mark, tree and effective-set reads take the tenant bundle lock, which is fine at pilot scale.
- Accessible names were checked in jsdom only.
