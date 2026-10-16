---
title: 'Story 6.5: Buyer sees the inventory by Project and agent tool'
type: 'feature'
created: '2026-10-16'
status: 'done'
baseline_commit: 'c31f1c6f1a4c580080e4f01b46415b4da75d0fb6'
followup_review_recommended: false
review_loop_iteration: 0
followup_review_recommended: false
context:
  - _bmad-output/implementation-artifacts/epic-6-context.md
  - _bmad-output/implementation-artifacts/spec-6-1-publish-the-compilation-catalog-and-gate-sending-on-the-buyer-reading-it.md
  - _bmad-output/implementation-artifacts/spec-6-2-project-records-into-compilations-through-one-collector-chokepoint.md
  - _bmad-output/implementation-artifacts/spec-6-3-deliver-compilations-durably-without-touching-the-builder.md
warnings: ['oversized']
deferred:
  - summary: >-
      Inventory db-suite cases need a live Postgres to run; skipped locally, CI runs them.
    evidence: |-
      compilations.db.test.ts inventory evidence describe skips without REGISTRY_TEST_DATABASE_URL per house pattern; HTTP Fake tests pin the same envelope.
    location: >-
      apps/registry/src/compilations/compilations.db.test.ts
    severity: low (unverified)
---

<intent-contract>

## Intent

**Problem:** Inventory is one flat registry-only table: rows are not grouped by agent tool, there is no Project filter, and no Compilation evidence reaches the page, so the Buyer cannot see what the business builds by Project and agent tool (FR-22 inventory, FR-20, UX-DR7/DR8).

**Approach:** In `apps/registry`, add a session-authenticated, read-only `GET /v1/inventory` evidence read joining the tenant's Compilations per Application (distinct agent tool names, latest first). In `apps/panel`, `/inventory` loads structure (Applications plus the Project tree) first and Compilation evidence second, grouping application-rows under an agent-tool heading with a Project filter, and degrading honestly when evidence does not arrive.

## Boundaries & Constraints

**Always:**
- Contract (`packages/contract/src/compilations.ts`, the evidence is derived from the compilations store): new `InventoryApplicationEvidence` (`applicationId`, `agentTools` latest-first, may be empty only in the guard sense — rows exist only for Applications with >= 1 Compilation), `InventoryEvidence` (`applications` array), exact-key never-throw guards, and `INVENTORY_API_PATHS = { inventory: "/v1/inventory" }`. The closed catalog is untouched: no new Compilation type or field, no catalog/schema version bump; the semver-guard path pin is updated alongside.
- Registry (`apps/registry/src/compilations/service.ts`): `getInventoryEvidence(db, session)` under `withTenant` (RLS stays the second guard), open to every role, no catalog-read gate on reads, no bundle rebuild, no migration (reads the existing `compilations` table). One grouped SQL read per tenant: `(applicationId, agentToolName, max(sequence))`, grouped in JS to latest-first tool lists, rows ordered by `applicationId` for determinism. Only the tenant's own rows can appear; the wire never carries who created an Application.
- HTTP (`apps/registry/src/http/server.ts`): `GET` on the inventory path authenticates the session exactly like `GET /v1/applications` and answers 200; the `CompilationsService` interface gains the read and `FakeCompilations` mirrors it.
- Panel (`apps/panel/src/routes/inventory.tsx` + `registry.server.ts` `getInventoryEvidence`): the loader defers three reads — Applications, the Project tree, the evidence. Cold-load first (heading, then structure), evidence second (UX-DR24). Group key per row is compilation evidence first, the registry `agentTool` second, the none-group last; registry order (`createdAt`, then id) is preserved everywhere, groups in first-appearance order. Each group renders its agent-tool heading plus its own table with header cells (existing columns Application/Project/Placement/Listed, captions distinct per group). Rows never name a Builder and do not link anywhere (activation is 6.6).
- project-filter (UX-DR8) is a native single-select labelled `Project` with an `All Projects` default plus one option per tree Project in tree order; selection filters by exact Project id (the descendant rule belongs to Adherence only). A Project with no Application shows the empty-project state. The evidence region on failure says the Compilation evidence did not arrive while the structure stays; an Applications failure keeps the existing unavailable paragraph.
- Styles reuse tokens only (no hex/px literals): `.project-filter` follows the standard-form select language (raised, 8px radius, ink focus ring); rows keep `standards-table`. No nav change: Inventory is already listed.

**Never:**
- No Adherence or Deviation columns (Epic 7 owns them), no row activation or links (Story 6.6), no bundle-status/health/drop views (Story 6.4), no Collector/`apps/service`/catalog changes, no plan capability gates or prices, no new runtime dependencies, no migration, no cross-app imports (panel imports contract only).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Evidence read | Tenant with compilations across tools, one app with none | 200: only apps with >= 1 row, `agentTools` distinct latest-first by max sequence | None |
| Multi-tool app | Two tools observed, newer sequence on tool B | Grouped under B | None |
| Tenant isolation | Tenant B reads | None of A's rows appear, even for a guessed applicationId | RLS second guard |
| No session | Missing/bad bearer on GET | Session refusal, nothing read | House session envelope |
| Evidence fails on panel | Registry outage on the evidence read | Structure stays; evidence region says the Compilation evidence did not arrive; grouping falls back to the registry agent tool | Never throws |
| Project filter | Select Project P | Only P's Applications show, grouped as before | None |
| Empty project | Select a Project with no Application | Empty-project state, no table | None |
| No application at all | Empty tenant | Existing "No Application yet." state | None |

</intent-contract>

## Code Map

- `packages/contract/src/compilations.ts` — add inventory evidence types, guards, `INVENTORY_API_PATHS`; read-only reference for the exact guard style is `isApplicationList` in `packages/contract/src/applications.ts`.
- `packages/contract/src/compilations.test.ts` — semver-guard path pin (L~272) to extend with the inventory path; guard tests to add beside it.
- `apps/registry/src/compilations/service.ts` — add `getInventoryEvidence` beside `getCatalogRead` (L99-120, the `withTenant` read template); extend `CompilationsService` + factory (L206-220).
- `apps/registry/src/db/schema.ts` — `compilations` table (L670-692): read-only evidence that `(tenant_id, application_id, agent_tool_name)` grouping needs no migration; table already in `TENANT_TABLES`.
- `apps/registry/src/http/server.ts` — `ROUTES` entry (L169-170 pattern) + `case` beside `APPLICATION_API_PATHS.applications` (L481-486, session-then-200 template).
- `apps/registry/src/http/server.test.ts` — `FakeCompilations` (L598-...) to extend; HTTP envelope tests for the new GET beside the catalog-read ones.
- `apps/registry/src/compilations/compilations.db.test.ts` — db-suite harness (skips without `REGISTRY_TEST_DATABASE_URL`): append inventory-read cases (grouping order, latest-first, tenant isolation, empty).
- `apps/panel/src/registry.server.ts` — add `getInventoryEvidence` beside `getApplications` (L330-332, `call` + guard template); `getProjectTree` (L238-240) already exists.
- `apps/panel/src/routes/inventory.tsx` — the surface: loader with three deferred reads, nested structure-then-evidence `Await`s, `INVENTORY_COPY` additions, pure `groupApplications` helper, project-filter select, per-group tables.
- `apps/panel/src/routes/inventory.test.tsx` — extend: grouping, none-group, filter, empty-project, evidence-failure, tree-failure, loader defers three reads.
- `apps/panel/src/styles/components.css` — add `.project-filter` (+ label) reusing token vars; styles tests pin tokens-only/no-px/no-accent-text.

## Tasks & Acceptance

**Execution:**
- `packages/contract/src/compilations.ts` -- add inventory evidence types/guards/path -- rationale: the panel/registry share one guarded shape, catalog untouched.
- `apps/registry/src/compilations/service.ts` -- add `getInventoryEvidence` grouped read -- rationale: the only tenant-scoped compilation-evidence query, read-only.
- `apps/registry/src/http/server.ts` (+ `server.test.ts` Fake + HTTP tests, `compilations.db.test.ts` cases) -- serve `GET /v1/inventory` -- rationale: session-authed evidence read beside the applications read.
- `apps/panel/src/registry.server.ts` -- add `getInventoryEvidence` -- rationale: guarded client helper in the panel's only registry path.
- `apps/panel/src/routes/inventory.tsx` (+ `inventory.test.tsx`, `styles/components.css`) -- structure-first inventory with agent-tool groups + project-filter -- rationale: the 6.5 read-only surface per FR-22/FR-20/UX-DR7/DR8.

**Acceptance Criteria:**
- Given Applications in the registry and Compilations from the Company, when the Buyer opens Inventory, then application-rows are grouped under an agent-tool heading in tables with header cells, including Applications with no Compilation yet, and never show a Builder name.
- Given project-filter, when the Buyer selects a Project, then the list shows that Project's Applications.
- Given the panel cannot load Compilations, when Inventory loads, then the structure stays and the evidence region says the Compilation evidence did not arrive.

## Spec Change Log

## Review Triage Log

## Review Triage Log

### 2026-10-16 — Review pass
- verdicts: 9 findings — high 0, medium 1, low 2, false 5, maybe-false 1
- findings:
  - `[medium]` `[patch]` filter test title promised empty-project coverage but never selected a project with no Applications — added an Empty project to the tree fixture and assertions for the empty-project state and no tables.
  - `[low]` `[patch]` joined `() => { expect(` line wart in compilations.test.ts from an editing slip — restored the blank line.
  - `[low]` `[patch]` panel loader test passed `init` instead of `init.headers` to `Headers`, asserting null — fixed to read `.headers`.
  - `[false]` `[reject]` evidence fallback grouping by registry tool could mislead — refuted: the evidence-unavailable note names the fallback explicitly beside the groups.
  - `[false]` `[reject]` `key={group.key}` with `""` for the none-group could collide — refuted: only one none-group exists per render, keys are unique by construction.
  - `[false]` `[reject]` panel test fixture UUID with variant nibble `c` failed the real `isProjectTree` guard — found during verification (not review) and fixed to a valid UUIDv7; the guard doing its job.
  - `[false]` `[reject]` h2 heading plus `Applications — X` caption duplicates text — kept deliberately: every table needs a distinct accessible name for table navigation.
  - `[false]` `[reject]` registry `max()` nullability — refuted: `row.latest ?? 0` handles it and per-app sequences are unique, so latest-first ordering is total.
  - `[maybe-false]` `[defer]` db-suite inventory cases cannot run without `REGISTRY_TEST_DATABASE_URL` — severity: low (unverified); CI runs the database suite per the skip-guard pattern. location: apps/registry/src/compilations/compilations.db.test.ts. evidence: service query is a plain grouped read mirroring the reviewed shape; HTTP Fake tests pin the envelope.

## Verification

**Commands:**
- `pnpm --filter @domain-harness/contract test` -- expected: guard + semver-pin suites green.
- `pnpm --filter @domain-harness/registry test` -- expected: server suites green; db suite skips without `REGISTRY_TEST_DATABASE_URL` (CI runs it).
- `pnpm --filter @domain-harness/panel test` -- expected: inventory + styles suites green.
- `pnpm run boundaries` -- expected: no violations (panel imports contract only; registry service gains no new edges).
- `pnpm build` / typecheck / lint per repo root -- expected: clean.

## Auto Run Result

Status: done
Summary: Story 6.5 implemented. The registry serves a read-only, session-authenticated `GET /v1/inventory` evidence read (per-Application Compilation agent tools, latest first, tenant-scoped, no catalog-read gate on reads, no migration). The panel Inventory loads structure (Applications plus Project tree) first and Compilation evidence second, grouping application-rows under an agent-tool heading in tables with header cells, with a single-select Project filter (exact Project, All Projects default), an empty-project state, and honest degradation (structure stays plus a note) when evidence or the tree does not arrive. Applications with no Compilation yet appear under "No Compilation yet"; no Builder name appears anywhere.
Files:
- packages/contract/src/compilations.ts — InventoryEvidence types, guards, INVENTORY_API_PATHS (closed catalog untouched).
- packages/contract/src/index.ts + compilations.test.ts — exports, guard tests, inventory path pin.
- apps/registry/src/compilations/service.ts — getInventoryEvidence grouped read + service wiring.
- apps/registry/src/http/server.ts (+ server.test.ts Fake/HTTP tests, compilations.db.test.ts cases) — GET /v1/inventory route.
- apps/panel/src/registry.server.ts — getInventoryEvidence client helper.
- apps/panel/src/routes/inventory.tsx (+ inventory.test.tsx, components.test.tsx stub) — grouped, filtered, structure-first surface.
- apps/panel/src/styles/components.css — .project-filter and .application-row styles (tokens only).
Review: 9 findings — 3 patched (empty-project test gap, loader-test Headers bug, test formatting wart), 5 rejected as false with refutations in the triage log, 1 deferred (db suite needs live Postgres; CI runs it). No intent_gap or bad_spec. Patched counts by verdict: medium 1, low 2.
Follow-up review: false (no high patched; single medium was test-only).
Verification:
- contract: 24 files / 386 tests green.
- panel: 22 files / 452 tests green (1 pre-existing skip).
- registry: 15 files / 383 tests green; 15 db suites skipped without REGISTRY_TEST_DATABASE_URL (includes the 3 new inventory evidence cases).
- pnpm build: 10 tasks successful. pnpm run boundaries: no violations. pnpm typecheck: clean. pnpm lint: clean.
- Note: panel/registry suites first failed on unbuilt workspace deps (contract/core dist) in this fresh worktree; `pnpm install` + building contract/core resolved it — environmental, not code.
Residual risks: db-suite inventory cases are CI-only here; panel grouping for multi-tool Applications keys on the latest Compilation by sequence, which is the documented rule.
Blocking condition: none.
Subagent note: step-03/04 call for reviewer subagents, but this runtime offers no subagent tool, so planning, implementation and the four review layers were performed inline by the dispatched implementer; the triage log above records the pass.
