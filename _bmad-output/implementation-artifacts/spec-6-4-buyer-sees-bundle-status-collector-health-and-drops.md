---
title: 'Story 6.4: Buyer sees bundle status, Collector health and drops'
type: 'feature'
created: '2026-10-16'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
baseline_commit: 'c31f1c6f1a4c580080e4f01b46415b4da75d0fb6'
context:
  - _bmad-output/implementation-artifacts/epic-6-context.md
  - _bmad-output/implementation-artifacts/spec-6-1-publish-the-compilation-catalog-and-gate-sending-on-the-buyer-reading-it.md
  - _bmad-output/implementation-artifacts/spec-6-2-project-records-into-compilations-through-one-collector-chokepoint.md
  - _bmad-output/implementation-artifacts/spec-6-3-deliver-compilations-durably-without-touching-the-builder.md
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** The Buyer has no place to see whether each service is current and whether evidence is arriving: bundle-status and Collector-health Compilations land in the registry store (6.1–6.3) but no read endpoint or surface exposes the active hash, sequence, age against the bound, freeze state, pending/dropped counts, or drops (FR-26, AD-14, UX-DR21).

**Approach:** In `packages/contract`, add the read-model views (`BundleStatusView`, `CollectorHealthView` plus `{ statuses }` / `{ reports }` envelopes, exact-key never-throw guards) and the two `GET` paths under the existing catalog (no catalog change, so no semver bump). In `apps/registry`, add session-authenticated `GET /v1/compilations/bundle-status` and `GET /v1/compilations/collector-health` (every role may read, like the catalog-read `GET`): latest stored Compilation per Application, with the staleness bound and freeze state joined from the tenant's latest bundle record. In `apps/panel`, extend the `/compilations` surface with the Bundle-status section (per row: active hash, sequence, age against the bound, freeze state, the word "stale" when past the bound), the Collector-health section (pending and dropped counts by reason), and drop announcements as status text (schema failure named, no partial payload stored). The empty state still shows the schema-reader.

## Boundaries & Constraints

**Always:**
- Read-only surface: no new ingestion, no projection, no queue, no migration (all needed rows and grants already exist: `compilations` SELECT, `bundle_records` SELECT). No `UPDATE`/`DELETE` anywhere.
- "Per service" is one row per Application id (the application's evidence stream), carrying its `agentToolName`. The bound (`stalenessBoundHours`) and `frozen` are tenant-level facts from the tenant's latest bundle record (`DEFAULT_STALENESS_HOURS` / `false` when no bundle exists yet); age and the "stale" word are derived panel-side from `issuedAt` so the registry stays clock-free and deterministic.
- Contract guards are exact-key never-throw predicates per house pattern; the catalog itself (six type names, per-type keys/versions) is untouched, so the semver-bump guard keeps passing with only its `COMPILATION_API_PATHS` pin extended.
- The panel imports only contract; the registry never imports the panel. Every role may read both new endpoints (inventory precedent); the record-read commit stays Buyer-only and unchanged.
- Drop announcements name the reason and count: `schema_failed`/`rejected` state that the schema failed and no partial payload was stored; `queue_gap` states queued entries were lost and those sequences never arrived; unknown reasons fall back to "no partial payload was stored".

**Never:**
- No changes to `packages/collector`, `packages/core`, `packages/extractor`, `packages/gate`, `apps/service`, bundle compile/sign/verify, or the Effective Standard set.
- No nav changes (`/compilations` already exists), no new routes, no chromatic colors, no hex/px literals in CSS (no new CSS needed).
- No plan capability gates and no prices anywhere; no new runtime dependencies; no cross-app imports.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Bundle status rows | Stored `bundle_status` Compilations | One row per Application (latest by receivedAt): active hash, bundle sequence, issuedAt, bound, frozen | None |
| Stale derivation | `issuedAt` older than the bound | Row shows age against the bound plus the word "stale" | None |
| Fresh row | `issuedAt` within the bound | Row shows age against the bound, no "stale" word, freeze state as text | None |
| No bundle record yet | Compilations exist, no `bundle_records` row | Bound falls back to `DEFAULT_STALENESS_HOURS`, frozen false | None |
| Collector health rows | Stored `collector_health` Compilations | One row per Application (latest): pending count, dropped counts by reason | None |
| Drop announced | Any reason with count > 0 | Status text naming the reason and count; schema failures state the schema failed and no partial payload was stored | None |
| Empty state | No `bundle_status` / `collector_health` rows | Section shows "no ... yet" text; schema-reader still renders | None |
| Registry outage | Panel cannot reach the registry | Sections show `unavailable` text, page never throws | Never throws |
| Lapsed session | `session_invalid` on the new reads | Sections show the session-ended message plus sign-in link (read-state precedent) | Redirect only on the record action, unchanged |
| Non-Buyer reader | Builder/Standard-owner session | Both new `GET`s answer 200 (every role may read) | None |
| Tenant isolation | Two tenants with rows | Each tenant sees only its own rows (RLS + `withTenant`) | None |

</intent-contract>

## Code Map

- `packages/contract/src/compilations.ts` — `COMPILATION_API_PATHS` (L59–64, add `bundleStatus` + `collectorHealth`), `isDroppedByReason` (L527, unexported — export for the view guards), read-state guards at file end (the pattern for the new view guards).
- `packages/contract/src/index.ts` — compilations value/type re-exports (L309–357); add the new view names.
- `packages/contract/src/bundles.ts` — `DEFAULT_STALENESS_HOURS` (L28): the no-bundle-record fallback the registry imports.
- `packages/contract/src/compilations.test.ts` — `COMPILATION_API_PATHS` pin (L272–275, extend with the two paths).
- `apps/registry/src/compilations/service.ts` — `withTenant` idiom, `getCatalogRead` as the every-role read precedent; add `listBundleStatus` + `listCollectorHealth` + interface/factory entries.
- `apps/registry/src/db/schema.ts` — `compilations` (L670–695) + `bundleRecords` (L487–506) tables; no schema change, reads only.
- `apps/registry/src/http/server.ts` — `ROUTES` (L169–170), `catalogReads` GET case (L649–664) as the session-auth read precedent; add the two `GET` cases + doc-comment paragraph.
- `apps/registry/src/http/server.test.ts` — `FakeCompilations` (L598–649, add the two list methods derived from `stored`); add route tests mirroring the catalog-read GET tests.
- `apps/registry/src/compilations/compilations.db.test.ts` — harness (`provisionCompany`, ephemeral server, `validCompilation` factory with `bundle_status`/`collector_health` arms, `auth` sessions); append the 6.4 status-views describe reusing it.
- `apps/panel/src/registry.server.ts` — `getAcceptedDeviationAlerts` envelope-unwrap precedent (L452); add `getBundleStatus` + `getCollectorHealth`.
- `apps/panel/src/routes/compilations.tsx` — loader/read-state/Suspense+Await pattern; add the streamed `bundleStatus` + `collectorHealth` promises and the three new sections.
- `apps/panel/src/routes/compilations.test.tsx` — render helper + loader/action suites; extend with the 6.4 matrix rows.

## Tasks & Acceptance

**Execution:**
- `packages/contract/src/compilations.ts` — `COMPILATION_API_PATHS` gains `bundleStatus: "/v1/compilations/bundle-status"` and `collectorHealth: "/v1/compilations/collector-health"`; NEW `BundleStatusView` (`applicationId`, `agentToolName`, `bundleHash` 64-hex, `bundleSequence` >= 1 int, `issuedAt` UTC ISO, `stalenessBoundHours` 1–720 int, `frozen` boolean) + `BundleStatusList` (`{ statuses }`) and `CollectorHealthView` (`applicationId`, `agentToolName`, `occurredAt` UTC ISO, `pendingCount` non-neg int, `droppedByReason`) + `CollectorHealthList` (`{ reports }`); exact-key never-throw `isBundleStatusView`, `isBundleStatusList`, `isCollectorHealthView`, `isCollectorHealthList` (export `isDroppedByReason` for reuse).
- `packages/contract/src/index.ts`, `compilations.test.ts` — re-export the new names; extend the `COMPILATION_API_PATHS` pin; guard round-trip/rejection tests for the new views (extra/missing keys, bad hash/ISO/counts/bound).
- `apps/registry/src/compilations/service.ts` — NEW `listBundleStatus(session)` (latest `bundle_status` row per `applicationId` by `receivedAt` desc; bound + frozen from the tenant's latest `bundle_records` payload, else `DEFAULT_STALENESS_HOURS` / `false`) and `listCollectorHealth(session)` (latest `collector_health` row per `applicationId`); both open to every role, tenant-scoped via `withTenant`; extend `CompilationsService` + factory.
- `apps/registry/src/http/server.ts` — `ROUTES` gains both paths as `["GET"]`; NEW `GET` cases (session auth, `sendJson` 200, every role) + surface doc-comment paragraph.
- `apps/registry/src/http/server.test.ts` — `FakeCompilations` gains the two list methods (latest-per-application over `stored` + fixed bound/frozen); route tests: 200 envelopes for both, 405 for POST, session-invalid 401 shape.
- `apps/registry/src/compilations/compilations.db.test.ts` — NEW `describe("status views (Story 6.4)")`: per-application latest wins, bound/frozen join from a compiled bundle, fallback bound with no bundle, health pending/dropped passthrough, tenant isolation, every-role reads (Buyer + Builder + Standard owner).
- `apps/panel/src/registry.server.ts` — NEW `getBundleStatus` + `getCollectorHealth` (unwrap `{ statuses }` / `{ reports }` envelopes like the alerts precedent).
- `apps/panel/src/routes/compilations.tsx` — loader gains streamed `bundleStatus` + `collectorHealth`; NEW sections: Bundle status (per-row active hash, sequence, `Age Xh of Yh bound`, `frozen`/`not frozen`, `stale` word when age > bound; empty + unavailable + session-ended states), Collector health (pending + dropped-by-reason per row; same states), Compilation drops (one status-text announcement per reason with count > 0, schema failures named); exported pure helpers `bundleAgeHours` + `isBundleStale` + `dropAnnouncement` for tests. Empty state still shows the schema-reader (unchanged).
- `apps/panel/src/routes/compilations.test.tsx` — NEW cases: stale row shows the word "stale" with age/bound/freeze; fresh row shows no "stale"; health shows pending + dropped by reason; drop announced as status text stating the schema failed and no partial payload was stored; empty states keep the schema-reader; outage shows unavailable; loader defers all three reads.

**Acceptance Criteria:**
- Given the Compilations surface, when Bundle status and Collector health Compilations exist, then bundle-status shows, per service, the active hash, sequence, age against the bound, freeze state and the word "stale" when past the bound, and the Collector's pending and dropped counts are shown by reason.
- Given a dropped Compilation, when I view the surface, then compilation-drop is announced as a status in text, stating the schema failed and no partial payload was stored.
- Given no Compilation yet, when the surface loads, then the empty state still shows schema-reader.

## Spec Change Log

## Review Triage Log

- self-review (2026-10-16, pre-commit): 4 notes, all resolved or accepted.
  - Fixed: `compilations.test.ts` line-join mangling from an edit (`it(...) => {    expect(`) — restored, contract suite re-run green (385).
  - Fixed: panel `restrict-template-expressions` on numbers in copy functions — wrapped with `String(...)` per house precedent; panel lint clean.
  - Fixed: registry fake `_caller` unused params — dropped the parameters; registry lint clean.
  - Fixed: panel DropsSection reused the health unavailable copy, producing duplicate text — drops have their own `unavailable` copy; pinned by the outage test.
  - Accepted (no change): `receivedAt`-desc latest-wins has no tiebreaker — ties need same-millisecond ingests for one Application and both rows are same-app evidence; the db suite pins ordering explicitly via `received_at` rewrite.
  - Accepted (no change): `row.payload as {...}` casts in the list functions — every stored row passed `validateCompilationBody` on ingest, so the shapes hold; the contract guards re-check on the panel side.

## Auto Run Result

- Summary: story 6.4 gives the Buyer one place to see bundle currency and evidence arrival. `packages/contract` gains the read-model views (`BundleStatusView`/`BundleStatusList`, `CollectorHealthView`/`CollectorHealthList`, exact-key never-throw guards, two `GET` paths; the closed catalog itself is untouched, so no semver bump). `apps/registry` gains session-authenticated `GET /v1/compilations/bundle-status` and `GET /v1/compilations/collector-health` (every role; latest stored Compilation per Application; bound + freeze joined from the tenant's latest bundle record with `DEFAULT_STALENESS_HOURS`/`false` fallback). `apps/panel` extends `/compilations` with the Bundle-status section (active hash, sequence, age vs bound, freeze state, "stale" word past the bound), the Collector-health section (pending + dropped-by-reason), and drop announcements as status text (schema failures named, stored-nothing guarantee); the empty state still shows the schema-reader. No migration, no ingestion, no queue, no nav change.
- Files:
  - `packages/contract/src/compilations.ts` + `compilations.test.ts` + `index.ts` — views, guards, paths pin extended, re-exports.
  - `apps/registry/src/compilations/service.ts` — `listBundleStatus`, `listCollectorHealth`, interface + factory.
  - `apps/registry/src/http/server.ts` + `server.test.ts` — routes, Fake methods, 5 route tests.
  - `apps/registry/src/compilations/compilations.db.test.ts` — 6-test `status views (Story 6.4)` describe.
  - `apps/panel/src/registry.server.ts` — `getBundleStatus`, `getCollectorHealth`.
  - `apps/panel/src/routes/compilations.tsx` + `compilations.test.tsx` — sections, helpers (`bundleAgeHours`, `isBundleStale`, `dropAnnouncement`), 9 new tests.
  - `_bmad-output/implementation-artifacts/spec-6-4-buyer-sees-bundle-status-collector-health-and-drops.md` — this spec (status done).
- Verification: `pnpm -r run build` exit 0; `pnpm -r run typecheck` exit 0; `pnpm -r run lint` exit 0; `pnpm run boundaries` no violations; contract 385, collector 56, panel 458 passed + 1 pre-existing skip, registry 888 (all with postgres 18 on localhost:5432 where needed). Matrix audit: all 11 spec I/O rows covered by named tests that ran and passed (db suite 6 incl. bound/frozen join, fallback, latest-wins, every-role, isolation, 401; contract guards; panel surface 9 incl. stale/fresh, health, drop announcements, empty, outage, loader).
- Residual risks: (1) "per service" read as one row per Application id — documented in spec; if UX means per agent-tool aggregation, a follow-up can group. (2) `receivedAt` tie order undefined (see accepted note). (3) Drops are only as visible as the latest `collector_health` rows — registry-side ingest refusals store nothing by 6.1 design and never reach the surface.

## Auto Run Result

## Verification

**Commands:**
- `pnpm --filter @domain-harness/contract test` -- expected: compilations suites green, including the extended paths pin and the new view guards
- `pnpm --filter @domain-harness/contract typecheck && pnpm --filter @domain-harness/contract lint` -- expected: clean
- `REGISTRY_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres pnpm --filter @domain-harness/registry test` -- expected: status-views db suite green (needs the Docker PostgreSQL 18 on localhost:5432)
- `pnpm --filter @domain-harness/registry typecheck && pnpm --filter @domain-harness/registry lint` -- expected: clean
- `pnpm --filter @domain-harness/panel test` -- expected: compilations surface tests green
- `pnpm --filter @domain-harness/panel typecheck && pnpm --filter @domain-harness/panel lint` -- expected: clean
