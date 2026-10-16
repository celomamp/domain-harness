---
title: 'Story 6.6: Buyer reads one Application''s evidence and accepts from a Deviation row'
type: 'feature'
created: '2026-10-16'
status: 'done'
baseline_commit: 'c31f1c6f1a4c580080e4f01b46415b4da75d0fb6'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - _bmad-output/implementation-artifacts/epic-6-context.md
  - _bmad-output/implementation-artifacts/spec-6-1-publish-the-compilation-catalog-and-gate-sending-on-the-buyer-reading-it.md
  - _bmad-output/implementation-artifacts/spec-6-2-project-records-into-compilations-through-one-collector-chokepoint.md
  - _bmad-output/implementation-artifacts/spec-6-3-deliver-compilations-durably-without-touching-the-builder.md
  - _bmad-output/implementation-artifacts/spec-5-5-buyer-records-an-accepted-deviation.md
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** Stored Compilations have no per-Application read path: the Buyer cannot open one Application and see its Adherence, Deviations and whether Guidance was consulted, and cannot act on a Deviation without opening the repository (FR-20, FR-21, UX-DR10).

**Approach:** In `packages/contract`, add the `ApplicationEvidence` wire shape (`{ application, compilations }`) with its path helper and exact-key guard. In `apps/registry`, add session-authed `GET /v1/applications/:id/evidence` (every role, tenant-scoped, 404 `application_not_found`) reading the existing `compilations` table — no migration. In `apps/panel`, add the `/applications/:id` surface (latest Adherence as text, deviation rows with cream-inset copyable Corrections, Guidance-consulted flag, unbound failure text with EXPERIENCE recovery), link Inventory rows to it, and pre-fill the Epic 5 acceptance form from the Deviation row with Esc returning focus.

## Boundaries & Constraints

**Always:**
- The registry read derives nothing new: it returns the stored `compilations.payload` rows for the tenant's Application ordered by `sequence`, plus the `ApplicationInfo`. No projection, no content change, no Guidance content beyond what Compilations already carry (token-or-hash subjects stay opaque; deviation subjects/Corrections are the 6.1-blessed verbatim evidence).
- Evidence route is session-authed, open to every role; a malformed, unknown or other tenant's id is 404 `application_not_found`, subject `applicationId` (the identification-file precedent). No plan gates, no prices.
- Adherence is text: "Adherence {checked-open} of {checked} checked Standards on the last Gate run." plus "Gate run: {verdict}." and "Guidance was consulted: yes/no." Deviation rows carry Standard id, conflict slot, subject, status word open/accepted, and the Correction in a cream inset with a Copy button; the match key is (Standard id, slot, subject). Accepting from an open row opens `/accepted-deviation` pre-filled with the Application and match key; Esc returns focus to the row.
- Unbound failure: the latest `binding_refusal` sentence is shown as a failure with the EXPERIENCE recovery (missing/unreadable file or absent id → restore the file or ask the Buyer to place the Application; `commit_first` → commit once and retry).
- Panel imports only contract; no new runtime dependencies; no hex/px literals in CSS; gold stays `button-primary`. No `PANEL_NAV` change (the surface is reached through Inventory rows and direct URL).

**Never:**
- No catalog, Compilation schema or guard change (the semver-bump guard stays green); no migration; no collector/service/ingest change; no reimplementation of the 5.5 acceptance form or its registry semantics (prefill only, the registry still resolves the version).
- No Builder names anywhere on the surface; no Guidance content rendering; no inventory regrouping (6.5 owns grouping — rows only gain a link).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Evidence read | Session GET evidence of the tenant's Application | 200 `{ application, compilations }` in sequence order | Unknown/other-tenant/malformed id → 404 `application_not_found` |
| Application surface | Latest gate_run + guidance + deviation compilations | Adherence text, verdict, Guidance consulted yes, deviation rows with Corrections and Copy, accept links on open rows | None |
| Empty application | No guidance and no gate_run compilations | "Listed and has no Guidance event and no Gate run" text, no table | None |
| Unbound application | Latest evidence is a binding_refusal | Failure sentence + recovery text shown as a failure | None |
| Accept from row | Activate Accept on an open row | Acceptance form pre-filled (Application, Standard id, slot, subject); Esc returns focus to the row | None |
| Outage | Registry unreachable on the surface | Structure stays, evidence region says the Compilation did not arrive | Never throws |
| Accepted row detail | Accepted summary matches a stored acceptance record | Row names end date and alert interval | Falls back to "Deviation accepted." |

</intent-contract>

## Code Map

- `packages/contract/src/applications.ts` — `APPLICATION_API_PATHS`, `isApplicationInfo` (L71); gains the evidence path/type/guard, importing `isCompilation` from `./compilations.ts` (no cycle: compilations never imports applications).
- `packages/contract/src/compilations.ts` — `Compilation` union + `isCompilation` (L543), `GateRunDeviationSummary`, `Deviation.correction`; read-only reference for the evidence derivation.
- `apps/registry/src/compilations/service.ts` — `ingestCompilation` (L152), service interface (L206); gains `getApplicationEvidence` reading `compilations` rows by `(tenantId, applicationId)` ordered by sequence plus the Application's `ApplicationInfo` (pattern: `applications/service.ts` `toInfo` L46 + `currentProjects` + `currentAgentTools`, 404 `application_not_found` precedent L219).
- `apps/registry/src/http/server.ts` — `APPLICATION_IDENTIFICATION_FILE_ROUTE` pattern (L120/L136/L494); gains `APPLICATION_EVIDENCE_ROUTE` + param regex + `ROUTES` GET entry + session-authed case branch.
- `apps/registry/src/http/serve-cli.ts` — already wires `createCompilationsService`; no change unless the factory shape changes.
- `apps/registry/src/http/server.test.ts` — `FakeCompilations` (L598) must gain the new interface method or types break.
- `apps/registry/src/compilations/compilations.db.test.ts` — harness (provisionCompany, catalog read, ingest, ephemeral server); the new `application-evidence.db.test.ts` mirrors its evidence seeding at smaller scale.
- `apps/panel/src/registry.server.ts` — `call` + `getJson` + envelope-mapping precedent `getAcceptedDeviations` (L390); gains `getApplicationEvidence`.
- `apps/panel/src/routes/application.tsx` — NEW surface; loader pattern from `inventory.tsx` (session redirect, streaming promises) plus `getAcceptedDeviations` for accepted-row detail; copy covers EXPERIENCE Application row (cold-load structure first, empty, failure, offline).
- `apps/panel/src/routes.ts` + `routes.test.ts` (exact arrays L17-26/L38-48) — add `applications/:applicationId` under the panel layout; `panel-chrome.tsx` untouched.
- `apps/panel/src/routes/inventory.tsx` — `ApplicationsTable` (L68) gains a `Link` on the description to `/applications/:id` (pointer + keyboard activation for free).
- `apps/panel/src/routes/accepted-deviation.tsx` — `AcceptanceForm` state seeds (L417-419) gain URL-prefill (`standardId`, `slot`, `subject` alongside the existing `?application=` selection); gains a `returnTo` back link and an Escape handler navigating back so focus can return to the row.
- `apps/panel/src/styles/components.css` — gains `.correction-instruction` from existing cream/base tokens only (pattern: `.boilerplate-result pre` L522).

## Tasks & Acceptance

**Execution:**
- `packages/contract/src/applications.ts` — add `applicationEvidencePath(applicationId)`, `ApplicationEvidence { application, compilations }`, `isApplicationEvidence` (exact keys, `compilations.every(isCompilation)`) -- rationale: the wire shape the registry serves and the panel guards.
- `packages/contract/src/applications.test.ts` (or compilations-adjacent suite) — guard round-trip/rejection tests (extra/missing keys, non-Compilation entry, bad application) -- rationale: pin the matrix's wire shape.
- `apps/registry/src/compilations/service.ts` — add `getApplicationEvidence(db, session, applicationId)` (malformed/unknown/other-tenant → `application_not_found`; returns `{ application, compilations }` in sequence order) + interface + factory -- rationale: the only new read, over existing rows.
- `apps/registry/src/http/server.ts` — add the `GET /v1/applications/:id/evidence` param route, `ROUTES` entry and session-authed case -- rationale: expose the read to the panel.
- `apps/registry/src/http/server.test.ts` — extend `FakeCompilations` with the new method; add route tests (200 evidence, 404 unknown, session-invalid → sign-in/401 path per house pattern) -- rationale: keep the fake total or types break.
- `apps/registry/src/compilations/application-evidence.db.test.ts` — NEW db suite (skip-pattern when `REGISTRY_TEST_DATABASE_URL` is unset): seed catalog read + gate_run/guidance/deviation/binding_refusal compilations via `ingestCompilation`, then evidence order/content, empty application, 404 unknown/other-tenant/malformed -- rationale: pin every evidence matrix row against Postgres.
- `apps/panel/src/registry.server.ts` — add `getApplicationEvidence(sessionToken, applicationId)` guarded by `isApplicationEvidence` -- rationale: the panel's only evidence client.
- `apps/panel/src/routes/application.tsx` — NEW surface (loader: evidence + accepted-deviation records streaming; component: heading, Adherence text, verdict, Guidance-consulted flag, deviations table with cream-inset Correction + Copy + accept links on open rows, accepted-row end-date/interval detail with fallback, binding-refusal failure + recovery, empty text, unavailable region) + `application.test.tsx` (adherence text, row fields + status words, copyable inset, accept-link prefill params, consulted flag both ways, unbound failure + recovery, empty, outage) -- rationale: the story's surface.
- `apps/panel/src/routes.ts`, `routes.test.ts` — wire `applications/:applicationId` + exact-list updates -- rationale: route exists under the session-guarded layout.
- `apps/panel/src/routes/inventory.tsx` (+ `inventory.test.tsx` link assertion) — link each row's description to its Application surface -- rationale: the AC's row activation without reimplementing 6.5.
- `apps/panel/src/routes/accepted-deviation.tsx` (+ tests) — seed match-key state from `?standardId=&slot=&subject=` when present, render a back link and Escape-to-`returnTo` -- rationale: the AC's accept-from-row without touching 5.5 semantics.
- `apps/panel/src/styles/components.css` — add `.correction-instruction` (cream inset, existing tokens only) -- rationale: UX-DR10 inset.

**Acceptance Criteria:**
- Given an inventory application-row, when activated by pointer or keyboard, then the Application surface opens showing its latest Adherence as text, deviation rows (Standard id, conflict slot, subject, open/accepted status word, copyable cream-inset Correction) and whether any Guidance event exists.
- Given an open deviation-row, when the Buyer chooses to accept it, then the Epic 5 acceptance form opens pre-filled with the Application and the match key, and Esc returns focus to the row.
- Given the latest evidence is a binding refusal (or no gate_run/guidance exists), when the Buyer views the Application, then the failure sentence with its EXPERIENCE recovery (or the listed-without-evidence text) is shown.
- Given contract, registry, panel and workspace verification, when the contract/registry/panel/build/typecheck/lint/boundaries suites run, then all pass with no boundary violations and every matrix row pinned by a named test that ran.

## Spec Change Log

## Review Triage Log

- 2026-10-16 review (story-6-6-app-evidence @ f21256f, base c31f1c6): four-layer single-pass (blind-hunter, edge-case, verification-gap, intent-alignment). No findings requiring a patch. Tenant isolation (withTenant + tenant filter), session-auth every role, 404 application_not_found/subject applicationId, lockBundle-under-read (listApplications precedent), exact-key guard, prefill-only 5.5 wiring, no PANEL_NAV change, cream-inset tokens-only CSS all verified. Spot re-runs: contract applications 22/22, panel application+accepted-deviation+inventory 46/46, registry server 143/143. Full-suite counts trusted per implementer (contract 392, registry 888, panel 465+1 skip). Verdict: clean, status → done.

## Auto Run Result

Status: in-review

**Summary:** The Buyer can open one Application's evidence and accept from a Deviation row. `GET /v1/applications/:id/evidence` (session-authed, every role) returns the Application plus its stored Compilations in sequence order — no migration, no new derivation; unknown/other-tenant/malformed ids are 404 `application_not_found`. The panel's `/applications/:id` surface shows the description, the latest Adherence as text, the verdict, Guidance-consulted yes/no, deviation rows (Standard id, slot, subject, open/accepted, cream-inset Correction with Copy, accept link on open rows), the accepted row's end date + alert interval joined from stored acceptances, the binding-refusal failure with EXPERIENCE recovery, the listed-without-evidence empty text, and the "Compilation did not arrive" outage region. Inventory rows link to the surface; the Epic 5 form pre-fills Application + match key from the row's query, with a back link and Esc returning to the row anchor. No `PANEL_NAV` change; 5.5 registry semantics untouched.

**Verification:**
- `pnpm --filter @domain-harness/contract test` — 24 files / 392 tests green (evidence guard + semver-bump guard green)
- `pnpm --filter @domain-harness/registry test` (both DB URLs, PG18) — 31 files / 888 tests green (incl. new application-evidence db suite 7/7, server route suite 143/143)
- `pnpm --filter @domain-harness/panel test` — 23 files / 465 passed + 1 pre-existing skip (incl. new application surface 12/12, acceptance prefill/Escape, inventory link, evidence client)
- `pnpm run build` (10/10), `pnpm run typecheck`, `pnpm run lint`, `pnpm run boundaries` — clean, no violations
- Matrix audit: all 7 I/O rows pinned by named tests that ran (evidence read ×2 suites, surface, empty ×2, unbound ×2, accept-from-row ×3, outage, accepted-row detail).

## Verification

**Commands:**
- `pnpm --filter @domain-harness/contract test` -- expected: evidence guard suites green, semver-bump guard still green
- `pnpm --filter @domain-harness/registry test` -- expected: server route suites green (needs no database)
- `REGISTRY_TEST_DATABASE_URL=… pnpm --filter @domain-harness/registry test` -- expected: application-evidence db suite green (PostgreSQL 18)
- `pnpm --filter @domain-harness/panel test` -- expected: application surface, inventory link, acceptance-prefill suites green
- `pnpm -r run build && pnpm -r run typecheck && pnpm -r run lint && pnpm run boundaries` -- expected: clean, no violations
