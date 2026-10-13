---
title: 'Story 2.6: Community plan refuses tree capabilities in place'
type: 'feature'
created: '2026-10-13'
status: 'done'
baseline_commit: 'bb71c65497b7dea33d3fc4a284e06a2362858ab5'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-5-child-project-creation-requires-a-buyer-granted-permission.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** A tenant on the Community (free) plan can currently create Projects, set parents and mark Locked rules, but those are Team capabilities. The panel never tells a Community Buyer which plan includes them (tiers, UX-DR18).

**Approach:** The registry refuses these three tree writes for a Community tenant with `403 plan_refused` and writes nothing. The panel shows a plan-refusal in place, inside the form or section that was submitted. The refusal names Team (first sale), shows no price and is announced as a status. Team, Business and Enterprise tenants are unaffected.

## Boundaries & Constraints

**Always:**
- **Rule (registry only).** The tenant's `tenants.plan` is read inside the request's tenant transaction (`withTenant`; RLS already scopes `tenants`). Three writes are refused for `Community` and allowed for any other plan:
  - creating a Project: `POST /v1/projects`, by anyone, including a grant holder;
  - changing a parent: `POST /v1/projects/{id}/parent`;
  - marking a Locked rule: `POST /v1/standards/{id}/locked-rule` with `locked: true`.

  Every read, unmarking (`locked: false`) and child-permission grants stay allowed. A downgraded tenant can still read its tree and remove marks.
- **Refusal.** `PLAN_REFUSED = "plan_refused"` in `contract`, mapped to 403.
  - Subject `plan`.
  - The message names the capability, never a plan name or a price. For example: "this Company's plan does not include creating another Project; nothing was changed". The parent and lock refusals use "setting a parent" and "marking a Locked rule".
  - No plan name appears in any `contract` type, code or message.
- **Check order** (first failure wins, nothing written):
  - **create:** 401 → plan (403 `plan_refused`) → body → parent → permission → core. The plan check runs before the body, because the capability does not exist at all on this plan.
  - **parent change:** 401 → Project 404 → role 403 → plan 403 → body → the rest as today.
  - **lock:** 401 → Standard 404 → role 403 → body 400 → same state (200, no write) → plan 403, for `locked: true` only → core → insert.
  - Transport refusals (415/413/malformed JSON) keep coming first, as the README already states for these routes.
- **Plan reads.** Each check reads the plan inside the same transaction as the write. Create and parent change read it after `lockBundle`. Put the read in one helper, e.g. `assertTreePlan(tx, tenantId, capability)` in `apps/registry/src/tenancy/plan.ts`.
- **Panel** (imports `contract` only, never hides a control by plan or role):
  - On `plan_refused`, the action returns status 403 with `status: null`, which leaves the top status region empty, and `planRefusal: <text>`. Field values are kept.
  - The refusal renders in place as a new `PlanRefusal` component: `<div class="plan-refusal" role="status"><p>…</p></div>`, with a raised surface, ink text and a hairline border, using tokens only.
  - Placement:
    - for create, inside the Create a Project form, under its button;
    - for parent, inside the Change parent form;
    - for lock, inside the Effective Standard set section, above the table.
  - Texts:
    - create: "Creating another Project is included in Team (first sale). Nothing was changed."
    - parent: "Setting a parent is included in Team (first sale). Nothing was changed."
    - lock: "Marking a Locked rule is included in Team (first sale). Nothing was changed."

    No price and no other plan names.
- **README.** Add Plans: what Community refuses, the code and the check orders.

**Never:**
- No plan gating of reads, unmarking, grants, Standards publishing or Modules.
- No band or seat logic (band-banner belongs to Epic 7).
- No plan names in `contract` or in registry messages.
- No hiding of controls, no new dependency, and no change to how a tenant's plan is set (provisioning already takes it).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Community create | Community Buyer creates a Project under the root | — | 403 `plan_refused`, subject `plan`; no Project and no change row |
| Community grant holder | Community Builder with a grant on the root creates | — | 403 `plan_refused` |
| Community bad body | Community Buyer POSTs an invalid create body | — | 403 `plan_refused` (plan before body) |
| Community parent | A downgraded Community tenant with a tree changes a parent | — | 403 `plan_refused`; parent unchanged |
| Community mark | Community Buyer marks a Standard | — | 403 `plan_refused`; no row |
| Community unmark / no-op | A downgraded tenant unmarks an existing mark; marks an already locked one | 200; unmark writes a row; no-op writes nothing | none |
| Community reads | GET tree, effective set, permissions | 200 as before | none |
| Non-Buyer on Community | Builder changes a parent / marks a rule | — | 403 `role_denied` (role before plan) |
| Team | Same three actions on a Team tenant | Succeed as before | none |
| Panel create / parent / lock | The registry answers `plan_refused` | The in-place `role="status"` block with the matching text inside that form/section; the top status stays empty; the tree and forms stay; no price | panel maps it |

</intent-contract>

## Code Map

- `apps/registry/src/db/schema.ts:9` -- `tenants.plan`. `tenancy/queries.ts:38` (`getTenant`) shows the tenant read under `withTenant`.
- `apps/registry/src/tenancy/provision.ts` -- provisions a tenant with a `plan`. DB tests can provision a Community tenant through the same helpers the existing suites use (see the `provision` calls in `projects/projects.db.test.ts` and `locked-rules/locked-rules.db.test.ts`). A downgraded tenant can be simulated in tests by updating `tenants.plan` as the migration/owner role, since the app role has no UPDATE.
- `apps/registry/src/projects/service.ts` -- `createProject` (today: body → `lockBundle` → parent → permission → core) and `changeParent` (Project → `assertTreeBuyer` → body → …).
- `apps/registry/src/locked-rules/service.ts` -- `setLockedRule` (404 → role → body → same-state → core).
- `apps/registry/src/http/server.ts` -- `STATUS_BY_CODE`; add `PLAN_REFUSED: 403`.
- `packages/contract/src/accounts.ts` -- `PLANS`/`Plan`. Put `PLAN_REFUSED` in a contract module such as `errors.ts` and export it from `index.ts`.
- `apps/panel/src/routes/project-tree.tsx` -- `action`, `refusal`, and the lock refusal switch. `ProjectTreeActionData` (in `components/project-tree.tsx`) gains `planRefusal?: string`.
- `apps/panel/src/components/project-tree.tsx` -- `CreateProjectForm`, `ChangeParentForm`, `EffectiveSetSection`, `PROJECT_TREE_COPY`. `components/status.tsx` holds the denial style reference. `styles/components.css:44` (`.denial`) is the token pattern for `.plan-refusal`; `styles.test.ts` enforces tokens.
- `apps/panel/src/routes/project-tree.test.tsx` and `project-tree.action.test.ts` hold the fixtures and `registry([...])` answers.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contract/src/errors.ts` (+ `index.ts`, test) -- `PLAN_REFUSED`.
- [x] `apps/registry/src/tenancy/plan.ts` -- `assertTreePlan(tx, tenantId, capability)`: reads the plan and throws `plan_refused` on Community.
- [x] `apps/registry/src/projects/service.ts`, `locked-rules/service.ts`, `http/server.ts` -- the checks in the specified order, and the 403 mapping.
- [x] registry tests -- a new `tenancy/plan.db.test.ts` (or a block in an existing DB suite) over HTTP covering every registry row of the matrix, including "nothing written". `server.test.ts`: `plan_refused` → 403.
- [x] `apps/panel/src/components/project-tree.tsx`, `routes/project-tree.tsx`, `styles/components.css` -- `PlanRefusal`, the copy, the action mapping for the three intents, and in-place rendering.
- [x] panel tests -- for each intent, a `plan_refused` answer renders a `role="status"` block with the exact text inside that form/section. The text contains "Team (first sale)", no "$" or price, and the top status region stays empty. The tree and forms stay visible, and submitted values are kept.
- [x] `README.md` -- the Plans section and the updated check orders.

**Acceptance Criteria:**
- Given a Community tenant with only its root Project, when the Buyer submits Create a Project on the Project tree surface, then a plan-refusal naming Team (first sale) appears inside that form as a status, with no price, and the tree still holds only the root.
- Given a fresh clone without `REGISTRY_TEST_DATABASE_URL`, when build, typecheck, lint, boundaries and test run, then all pass with the DB suites skipped.

## Spec Change Log

## Review Triage Log

### 2026-10-13 — Review pass
- verdicts: 24 findings — high 0, medium 1, low 18, false 5, maybe-false 0
- findings:
  - `[medium]` `[patch]` EC1: `PlanRefusal` mounted its `role="status"` element already filled, so screen readers may not announce it (the AC says "announced as a status"). Fixed: an empty live region is always mounted in each place, and only its text appears.
  - `[low]` `[reject]` EC2: the plan could change between the read and the write. Only the operator changes plans; a refusal that races a downgrade is negligible.
  - `[low]` `[reject]` EC3: a malformed create body now takes the bundle lock on every plan. `changeParent` and the lock route already validate their bodies under the lock; pilot scale.
  - `[low]` `[reject]` EC4: `plan_refused` on an unmark would show the mark text. The registry never refuses an unmark, so this is unreachable.
  - `[low]` `[reject]` BH1: the same as EC3.
  - `[low]` `[reject]` BH2: a Community refusal still waits on the bundle lock. The same root cause as EC3; the spec chose consistent reads.
  - `[low]` `[patch]` BH3: `TREELESS_PLANS` was a denylist, so a new plan would silently get tree capabilities. Fixed: an exhaustive `Record<Plan, boolean>`.
  - `[medium]` `[patch]` BH4: the same as EC1. Fixed by the same change.
  - `[low]` `[patch]` BH5: the README said "no plan name in `contract`", but `PLANS` is exported. Fixed: the wording names the error code and the registry messages.
  - `[low]` `[patch]` BH6: the README check orders disagreed between the Locked-rule paragraph and the Plans bullet. Fixed: the per-route paragraphs are canonical, and Plans refers to them.
  - `[low]` `[patch]` BH7: the README create paragraph had a stale rationale. Fixed: transport → plan → body fields → parent → permission.
  - `[low]` `[reject]` BH8: no test of transport refusals before the plan check. `readJson` is shared and already tested on these routes.
  - `[low]` `[patch]` BH9: 404 before the plan check on the lock route was untested. Fixed: a DB test with an unknown Standard on a Community tenant.
  - `[low]` `[patch]` BH10: missing cases for a Community Builder with no grant, and for a revoke staying open. Fixed: DB tests for both.
  - `[low]` `[patch]` BH11: the no-price assertion checked the test's own input. Fixed: it asserts on `PROJECT_TREE_COPY.planRefusal` and the returned text.
  - `[low]` `[reject]` BH12: the permission intent does not map `plan_refused`. Grants are never plan-gated (spec Never), so this is unreachable.
  - `[low]` `[reject]` BH13: the lock refusal is not tied to the clicked row. The spec chose section-level placement, and the refusal holds for every row, since marking is unavailable on the plan.
  - `[low]` `[reject]` BH14: the lock panel test is thinner. The action test already asserts a single fetch and the kept values for the lock intent.
  - `[low]` `[patch]` BH15: the `topStatus()` helper was fragile and would break with the EC1 fix. Fixed: it uses a stable selector with a clear failure.
  - `[false]` `[reject]` BH16: "Team (first sale)" may be internal copy. The AC and UX-DR18 mandate exactly that name.
  - `[false]` `[reject]` BH17: the spec bookkeeping was empty. The workflow fills it at finalisation.
  - `[low]` `[reject]` BH18: the DB suite teardown is unguarded on a failed `beforeAll`. This is the same teardown pattern as every other DB suite in the repo.
  - `[false]` `[reject]` IA1: "set a parent" cannot be reached on a root-only tenant. That is correct and inherent (the root's parent is fixed); the downgraded-tenant test covers the route.
  - `[false]` `[reject]` IA2: no test joins the panel and the registry. This is the same split as every earlier story; the shared contract code `plan_refused` is the join, and both sides test it.

## Design Notes

- **Why plan before body on create.** On Community the capability does not exist, so field errors would invite the Buyer to fix input for an action that can never succeed. On routes with a resource in the path, the existing 404 → role order stays first, so a non-Buyer still learns that the action is never theirs.
- **Why unmark and grants stay open.** The AC names three actions. Leaving removal open lets a downgraded tenant reduce its locks, and a grant is useless while create is refused.

## Verification

**Commands:**
- `docker compose up -d --wait postgres` then `REGISTRY_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres pnpm test` -- expected: all suites pass, with the DB suites run.
- `pnpm run build && pnpm run typecheck && pnpm run lint && pnpm run boundaries` -- expected: exit 0.
- `pnpm test` -- expected: passes, with the DB suites skipped.

## Auto Run Result

Status: done

**Summary:** A Community tenant is now refused three Project-tree writes with `403 plan_refused` (subject `plan`), and nothing is written:
- creating a Project, including by a grant holder;
- changing a parent;
- marking a Locked rule.

The refusal comes from `assertTreePlan` (`apps/registry/src/tenancy/plan.ts`). It reads `tenants.plan` inside the request's transaction, against an exhaustive `Record<Plan, boolean>`. The registry message names only the capability: no plan name and no price.

The check order is:
- **create:** transport → plan → body → parent → permission → core;
- **parent change:** Project 404 → role → plan → body;
- **mark:** 404 → role → body → same state → plan → core.

Reads, unmarking and child-permission grants and revokes stay open, so a downgraded tenant can still read its tree and remove marks. Team, Business and Enterprise are unaffected.

In the panel, the refusal appears in place, inside the create form, the parent form or the Effective Standard set section. It says "… is included in Team (first sale). Nothing was changed." with no price. It is shown in a live region (`role="status"`, `aria-live="polite"`) that is always mounted and stays empty until a refusal, so screen readers announce it. The top status stays empty, the forms keep their values, and no control is hidden.

**Files changed:**
- `packages/contract/src/errors.ts` (+ test, `index.ts`): `PLAN_REFUSED`.
- `apps/registry/src/tenancy/plan.ts` (+ `plan.db.test.ts`): the plan rule, and the DB suite over HTTP for fresh, downgraded and Team tenants.
- `apps/registry/src/projects/service.ts`, `locked-rules/service.ts`, `http/server.ts` (+ `server.test.ts`): the checks and the 403 mapping.
- `apps/panel/src/components/project-tree.tsx`, `components/status.tsx`, `routes/project-tree.tsx`, `styles/components.css` (+ tests): `PlanRefusal`, the copy, the action mapping and the page-status hook.
- `README.md`: the Plans section and the canonical check orders.

**Review findings:** 24 findings: high 0, medium 1 (EC1 and BH4 are the same root cause), low 18, false 5.
- **Patched (10 rows in 7 entries):**
  - EC1/BH4: the always-mounted live region.
  - BH3: an exhaustive plan record.
  - BH5/BH6/BH7: README corrections.
  - BH9 and BH10: new DB tests.
  - BH11: the copy assertions.
  - BH15: a stable test hook.
- **Deferred:** none.
- **Rejected:** 9 low and 5 false, each with its reason in the triage log.

**Follow-up review recommended: false.** Patched counts: high 0, medium 1 entry, low 6 entries.

**Verification:**
- `pnpm run build`, `typecheck`, `lint` and `boundaries` exit 0 ("no violations").
- With `REGISTRY_TEST_DATABASE_URL`, all pass:

  | Package | Tests passed |
  |---|---|
  | registry | 546 |
  | panel | 301, plus 1 skipped (the existing one) |
  | contract | 187 |
  | core | 56 |
  | boundaries | 16 |

- Without the database URL, `pnpm test` passes with the DB suites skipped.
- Matrix audit: every row is covered by tests that ran:
  - `plan.db.test.ts` and `server.test.ts`
  - `project-tree.test.tsx` and `project-tree.action.test.ts`

**Residual risks:**
- Choices made on the human's behalf:
  - The plan check runs before the body on create.
  - A grant holder's create is refused on Community.
  - Unmarking, grants and reads stay open on Community.
  - Every plan other than Community includes the tree.
- The panel cannot know the plan, so the refusal appears only after a submit.
- The live-region announcement was checked in jsdom only, not with a real screen reader.
