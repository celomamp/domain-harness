---
title: 'Story 5.5: Buyer records an Accepted deviation'
type: 'feature'
created: '2026-10-14'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
baseline_revision: '9e216b01bf0f426e50a720f523c82994fbb21f0e'
context:
  - _bmad-output/implementation-artifacts/epic-5-context.md
warnings: ['oversized']
deferred:
  - summary: >-
      A Deviation whose subject contains ": " cannot be represented in the pinned CI line
      grammar (the parser ends the subject at the first ": "; a paste of such a line truncates).
    evidence: |-
      The grammar is 5.4's pinned format (`formatDeviationLine`, byte-stable across adapters);
      an escaping scheme is a contract change with a semver bump, beyond this story. Settle by
      pinning core's subject composition (identifier-like subjects make the case unreachable)
      or by a grammar escape decision with a format version bump.
    location: >-
      packages/contract/src/deviations.ts (parseDeviationLine) / packages/gate/src/result.ts
    severity: low
---

<intent-contract>

## Intent

**Problem:** Core's evaluator (5.2) already consumes an `accepted: AcceptedDeviation[]` list and the bundle payload already carries an `acceptedDeviations` field, but no acceptance source exists: the registry's bundle compile hardcodes `acceptedDeviations: []` (4.1 pinned this until 5.5), the Buyer has no surface to accept a Deviation (FR-15), and the Buyer cannot therefore ship a known, deemed-acceptable exception without changing the Standard.

**Approach:** In `packages/contract`, extend the deviation contract with the registry's acceptance surfaces: the `/v1/accepted-deviations` API paths, a parser for the CI deviation log line grammar (the inverse of `packages/gate`'s `formatDeviationLine`, in contract because the panel may import only contract), and the stored-record wire shape. In `apps/registry`, add migration 0013 for an append-only `accepted_deviation_records` table, a Buyer-only acceptance service that resolves the Standard version authoritatively from the Application's current Effective Standard set, `POST`/`GET /v1/accepted-deviations` with role-before-plan ordering, and the `compile.ts` read that makes the next bundle carry the acceptance through 4.1's pinned post-mutation hook. In `apps/panel`, add the `/accepted-deviation` surface per UX-DR16/DR18: paste a CI log line or enter the match key, choose the Application, see the resolved Standard version, record justification/start/end/alert interval — with the end-before-start field error, the Builder denial, and the Community plan-refusal naming Team (first sale).

## Boundaries & Constraints

**Always:**
- The match key remains exactly (Application id, Standard id, Standard version, Conflict slot, subject); `AcceptedDeviation`'s wire shape is unchanged. Acceptance expiry is live `start <= now < end` (UTC ISO-8601, inclusive start, exclusive end) — matching `evaluateDeviations`' `acceptanceCovers`; an acceptance whose end is not strictly after its start is unrecordable (`invalid_input`, subject `end`).
- The Buyer, justification, start, end, alert interval and key are stored append-only (INSERT only, never UPDATE/DELETE); the stored record's extras (identity, Buyer `AccountRef`, justification, `alertIntervalHours`, `createdAt`) live only in the registry store and its `AcceptedDeviationRecord` wire type — never inside the bundle.
- `standardVersion` is always resolved by the registry from the Application's current Effective Standard set (under the tenant's bundle lock): the only effective-set entry whose slot matches the submitted slot (core's `sameSlot` semantics: exact `moduleKind`, exact `slotKind`, normalized name) and whose `standard.id` equals the submitted `standardId`. The panel shows the resolved version for guidance but never submits a version. A key that resolves to nothing is `invalid_input` naming the field, nothing written.
- The registry's body validation is registry-internal (mirror `validateLockedRuleBody`/`validateGuidanceEndpointBody`); the CI log-line parser is the one grammar inverse, exported from `packages/contract`, with `@domain-harness/gate`'s `formatDeviationLine` pinned to it by a round-trip test — one grammar, two coordinated functions, no fork.
- POST checks, first failure wins and nothing written: the user is the Buyer (`role_denied` before the body is read, drained) → tenant plan includes recording an Accepted deviation (`plan_refused`, subject `plan`) → the body (400 `invalid_input`, subject-named) → the Application exists in the tenant (404 `application_not_found`) → the key resolves in the Effective set (400) → the window `end > start` (400, subject `end`) → INSERT under the tenant's bundle lock. GET is open to every role but carries the same plan check (`plan_refused` on Community) — it also names Team in the panel.
- The acceptance POST joins 4.1's pinned post-mutation hook list: after a successful insert, one bundle build for the tenant (existing failure semantics: `bundle_build_failed`, mutation stays committed). Until a tenant records its first acceptance its bundle keeps compiling `acceptedDeviations: []`.
- The acceptance's plan capability is named "recording an Accepted deviation"; Community is the only plan without it (Team/Business/Enterprise include it, per the first-cut plan matrix) — a new lifecycle map, the existing `TreeCapability` untouched.
- The panel surface follows UX-DR16/DR18: raised `acceptance-form` (the `standard-form` pattern), fields Justification (textarea), Start and End (date inputs, normalized to `T00:00:00.000Z`), Alert interval (integer hours 1–8760), stored as text on the record; a paste area parsing a CI deviation line to pre-fill Standard id, conflict slot and subject; an Application selector; the resolved Standard version (and a "no matching Standard" hint) from the chosen Application's Effective Standard set; the end-before-start error names the end field and keeps values; a Builder's submit is the denial "A Builder cannot accept their own Deviation. The Buyer records the acceptance."; Community shows the plan-refusal in place naming "Team (first sale)", never a price (registry envelope text stays plan-neutral; the panel copy names the plan, as `project-tree` does).

**Never:**
- No changes to `packages/core` (evaluation, `acceptanceCovers`, slot normalization), `packages/extractor`, `apps/service` (runner, `bundle.ts`, store), or the `@domain-harness/gate` package's existing exports/behavior — the service consumes the bundle's `acceptedDeviations` through the landed snapshot seam unchanged; gate gains only a test.
- No new fields on `AcceptedDeviation`, no bundle-format/contract version bump, no canonical-serialization change.
- No alert evaluation, scheduling, delivery or the gold accepted-deviation-alert band (story 5.6); no alert rendering beyond storing `alertIntervalHours`.
- No batch acceptance, no editing/rescinding/deleting an acceptance (append-only; after `end` the same finding fails again with no bundle change needed — expiry is read-time in core).
- No plan-gate on the CI Gate or any other route; no price in any plan refusal; no gold UI besides `.button-primary` (styles tripwire); no hex/px literals in CSS.
- No new runtime dependencies; the panel never imports `@domain-harness/gate` (boundary: panel imports only contract); no cross-app imports.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Buyer records (parse path) | Buyer POSTs a key that resolves in the chosen Application's Effective set; `end > start` | 201 `AcceptedDeviationRecord` (Buyer ref, justification, window, interval, canonical resolved key); append-only row; next built bundle (same hook) carries exactly this `AcceptedDeviation` | None |
| Buyer records (manual path) | Same, Standard id + slot + subject typed by hand | Same as above | None |
| Key does not resolve | slot/standardId pair absent from the Effective set | 400 `invalid_input`, subject `standardId`, "no Standard with this id in this Conflict slot"; nothing written | None |
| End before/at start | `end <= start` (any other field valid) | 400 `invalid_input`, subject `end`, nothing written | Form names the end field, keeps values |
| Builder attempts acceptance | Non-Buyer session on POST, any tenant | `role_denied` before the body is read (drained); no row | Panel: the Buyer-records-acceptance denial, status tone `denial` |
| Community Buyer opens surface | GET `/v1/accepted-deviations` on a Community tenant | 403 `plan_refused`, subject `plan`; nothing stored | Panel: plan-refusal in place naming Team (first sale) |
| Community Builder attempts | POST to `/v1/accepted-deviations` on Community | `role_denied` (role before plan) | Same denial as any Builder |
| Unknown Application | `applicationId` not the tenant's | 404 `application_not_found`, subject `applicationId` | None |
| Malformed body | missing/empty field, non-integer or out-of-range `alertIntervalHours` (1–8760), non-ISO or `isUtcIso`-failing start/end, unknown key, untrimmable empty subject/justification | 400 `invalid_input` naming the subject | Nothing written |
| Malformed CI line paste | Panel paste that `parseDeviationLine` rejects (missing slot separator, colon-less) | Pre-fill leaves fields untouched, paste field error shown; nothing sent | Client-side only |
| Bundle reflects store | After ≥1 acceptance, next mutation builds a bundle | Payload `acceptedDeviations` = stored acceptances mapped to `AcceptedDeviation`, deterministically sorted (applicationId, standardId, standardVersion, slot, subject); canonical bytes stable across rebuilds | build failure keeps 4.1 semantics |
| Stored record reads back | GET returns the tenant's records, newest sequence first; every stored field visible (DR16) | 200 `{ records: [...] }` | Non-tenant rows never leave RLS |
| Append-only enforced | UPDATE/DELETE on `accepted_deviation_records` by the runtime role | Privilege denied (mirrors TENANT_TABLES suite) | None |

</intent-contract>

## Code Map

- `packages/contract/src/deviations.ts` — `Deviation` (L38), `DEVIATION_KINDS`/`DEVIATION_STATUSES` (the model gate/carried by 5.4's package — reuse), `AcceptedDeviation` (L55) + `ACCEPTED_DEVIATION_KEYS` (L79), `isAcceptedDeviation` (L114). New members go here.
- `packages/contract/src/effective.ts` — `EffectiveSlot` (+ `isEffectiveSlot`), the exact slot shape the key carries; `sameSlot`'s name normalization lives in `packages/core/src/slots.ts` (`normalizeSlotName`).
- `packages/contract/src/bundles.ts` — `StandardBundlePayload.acceptedDeviations` field (validated `every(isAcceptedDeviation)`), `canonicalJson`; `BUNDLE_API_PATHS` is the path-constants pattern to mirror with `ACCEPTED_DEVIATION_API_PATHS`.
- `packages/gate/src/result.ts` — `formatDeviationLine` (L112–115): the CI log-line grammar `<standardId> <moduleKind>/<slotKind>/<name> <subject>: <correction>`, fixed byte-for-byte across adapters (5.4). The new contract parser must be the inverse of exactly this, pinned by a gate round-trip test over the 5.4 fixture suite's deviations.
- `packages/core/src/evaluate.ts` — `evaluateDeviations({ ..., accepted, now })` (L46–57) and `acceptanceCovers` (L244–257): the consumed key semantics and window; the whole reason bundles must now carry the real list. No change.
- `apps/registry/src/bundles/compile.ts` — `compileBundle` (L89–158): `acceptedDeviations: []` hardcoded at L147 → replace with the deterministic read/sort of the store (pattern: `currentStalenessHours`/`currentFrozen` above; sort style `compare` at L25).
- `apps/registry/src/bundles/service.ts` — `buildAndSign` under `await lockBundle(tx, tenantId)`; `assertBundleSettingsBuyer` (L24) = role-check pattern; insert must share the lock for sequence consistency.
- `apps/registry/src/http/server.ts` — `ROUTES` (L128), `STATUS_BY_CODE` (L67: `PLAN_REFUSED`→403 exists), `requireBuyer` (L538, drains body on non-Buyer), the pinned `buildBundleAfterMutation` call sites (L337–531), `RegistryServices` (L176). New static route case for GET+POST; join the hook list after the POST; extend the doc comment's per-surface paragraph.
- `apps/registry/src/http/serve-cli.ts` — services wired and passed to `createRegistryServer` (L106–120): wire the new service here.
- `apps/registry/src/guidance-endpoint/service.ts` — the template service for a Buyer-only append-only store: role check, body validator import, `withTenant` + `lockBundle` + `nextSequence` (max+1) + insert, service factory; `validate.ts` sibling is the body-validator pattern.
- `apps/registry/src/tenancy/plan.ts` — `assertTreePlan` structure to mirror for a new `assertAcceptedDeviationPlan(tx, tenantId)` (own plan map: Community false, Team/Business/Enterprise true; message "this Company's plan does not include recording an Accepted deviation; nothing was changed", subject `plan`; the existing `TreeCapability` map untouched).
- `apps/registry/migrations/0010_guidance_endpoint.sql` + `0012_standard_bundles.sql` — the append-only DDL pattern (id/tenant_id/sequence UNIQUE(tenant_id, sequence) composite FKs to `accounts (tenant_id, id)`, RLS policy, `GRANT SELECT, INSERT`); 0013 mirrors it.
- `apps/registry/src/db/schema.ts` — drizzle mirrors (`bundleSettingChanges` L521 style) + `TENANT_TABLES` (L543–563; every listed table gets RLS/privilege tested by `tenancy.db.test.ts`).
- `apps/registry/src/projects/service.ts` — `getEffectiveSet` (L177, under `lockBundle`) and `resolveEffectiveStandards` (L204): the resolution the acceptance service reuses in-transaction (caller runs it with the project looked up in `currentProjects`).
- `apps/registry/src/applications/service.ts` — lookup/shape for the Application by id in the tenant (404 `application_not_found` precedent) and its `projectId`.
- `apps/registry/src/bundles/bundles.db.test.ts` — pinned-route bundle test ("builds sequence 1..12 across every pinned domain-mutating POST route", L470) gains route 13; the `acceptedDeviations` empty-pin at L585 becomes "empty until the first acceptance is recorded" with a carry assertion after the acceptance POST. db-suite harness (advisory lock, throwaway db, `provisionCompany` Team/Community, ephemeral server, HTTP envelopes).
- `apps/panel/src/registry.server.ts` — `call(path, init, expectedStatus, guard)` + typed helpers (`getApplications` L307, `getEffectiveStandards` L223, JSON POST helpers): add `getAcceptedDeviations` + `recordAcceptance` guarded by `isAcceptedDeviationRecord`/list guard.
- `apps/panel/src/routes/project-tree.tsx` + `components/project-tree.tsx` — the surface pattern: loader with `RegistryResult` streaming, `action` + `refusal()` mapping (`PLAN_REFUSED` → in-place plan refusal naming Team (first sale) via copy constants, `ROLE_DENIED` → denial status, `invalid_input` subject → field errors), `PlanRefusal` component, `Status` component, `<Form>` + `field-error`/`aria-describedby` + values-kept-on-refusal + remount-key-on-success.
- `apps/panel/src/components/panel-chrome.tsx` (`PANEL_NAV` L5), `src/routes.ts`, `routes.test.ts` (exact nav assert L17–37), `components/components.test.tsx` — add `/accepted-deviation` "Accepted deviation" (UX-DR5 lists it) and update the exact-array tests.
- `apps/panel/src/components/status.tsx`, `design/tokens.ts`, `styles/components.css`, `styles.test.ts` tripwires — no new chromatic colors; the form reuses the raised-surface/field pattern; gold stays `button-primary`.
- `_bmad-output/planning-artifacts/ux-designs/ux-domain harness-2026-10-09/mockups/accepted-deviation.html` — field structure and copy ("Stored: Buyer, justification, start, end, match key.", end-before-start text, Builder denial) to follow.

## Tasks & Acceptance

**Execution:**
- `packages/contract/src/deviations.ts` — NEW exports: `ACCEPTED_DEVIATION_API_PATHS = { acceptedDeviations: "/v1/accepted-deviations" }`; `DeviationMatchKey { standardId, slot: EffectiveSlot, subject }`; `parseDeviationLine(line: string): DeviationMatchKey | null` (split first token = standard id, second token split into exactly 3 slot parts, subject = text between the slot and the first `: `; `null` otherwise; never throws); `AcceptedDeviationRecord { id, applicationId, standardId, standardVersion, slot, subject, start, end, buyer: AccountRef, justification, alertIntervalHours, createdAt }` + `isAcceptedDeviationRecord`, and a list record guard — exact-key never-throw guards per house pattern.
- `packages/contract/src/index.ts`, `packages/contract/src/deviations.test.ts` — re-exports; parser tests (round-trip over constructed lines incl. colons/spaces in subject and correction, acceptance of exactly the gate grammar, rejection cases), guard round-trip/rejection tests (extra/missing keys, bad buyer/justification/interval).
- `packages/gate/src/result.test.ts` (add to the existing result tests) — round-trip invariant: for every deviation in the 5.4 fixture suite, `parseDeviationLine(formatDeviationLine(d))` returns the deviation's `standardId`/`slot`/`subject` — pinning one grammar across contract and gate.
- `apps/registry/migrations/0013_accepted_deviation_records.sql` — NEW `accepted_deviation_records` (id, tenant_id → tenants, sequence CHECK ≥1 UNIQUE (tenant_id, sequence), application_id / standard_id composite FKs `(tenant_id, id)` to `applications`/`standards`, standard_version CHECK ≥1, slot_module_kind/slot_kind/slot_name, subject CHECK <>'' , buyer composite FK `(tenant_id, buyer)` → `accounts`, justification CHECK <> '', alert_interval_hours CHECK 1–8760, starts_at/ends_at timestamptz, created_at) — RLS policy + FORCE + `GRANT SELECT, INSERT` per 0010/0012.
- `apps/registry/src/db/schema.ts` — drizzle mirror; add the table to `TENANT_TABLES`.
- `apps/registry/src/tenancy/plan.ts` — `assertAcceptedDeviationPlan(tx, tenantId)` (own plan map + capability text).
- `apps/registry/src/accepted-deviations/validate.ts` — NEW body validator (mirror `guidance-endpoint/validate.ts`): exact key set; trims and checks standardId UUIDv7, slot (via `isEffectiveSlot`), subject/justification non-empty, start/end `isUtcIso`, alertIntervalHours integer 1–8760; returns `{ ok: false, envelope }` subjects naming the field.
- `apps/registry/src/accepted-deviations/service.ts` — NEW `createAcceptedDeviationsService(db)` exposing `recordAcceptance(session, body)` (withTenant: `assertAcceptedDeviationPlan` → body validation → application lookup 404 → `resolveEffectiveStandards` under `lockBundle` → key-resolve (entry where core-slot-matching slot AND `standard.id` = submitted id; store the resolved entry's canonical slot + the live `standard.version` of that entry) → `end > start` → insert with `mintUuidV7` + `nextSequence`) and `listAcceptances(session)` (withTenant: plan check, newest-first rows joined to account names). `assertAcceptedDeviationBuyer(session)` exported for the server layer.
- `apps/registry/src/accepted-deviations/accepted-deviations.db.test.ts` — NEW db suite (harness per `bundles.db.test.ts`): every matrix row pinned by a named test, including append-only privileges, tenant-B isolation, and the sequence-1..13 hook join (bundle built after acceptance through the pinned path, canonical bytes, `acceptedDeviations` carry + determinism).
- `apps/registry/src/bundles/compile.ts` — `currentAcceptedDeviations(tx, tenantId)` + payload wiring (deterministic sort).
- `apps/registry/src/bundles/bundles.db.test.ts` — pinned-route test gains route 13 (seed the Standard the match key resolves against through existing routes); L585's empty pin becomes empty-until-acceptance + post-13 carry assertion.
- `apps/registry/src/http/server.ts` — static route `ACCEPTED_DEVIATION_API_PATHS.acceptedDeviations` = GET (any role) + POST (`requireBuyer(req, session, assertAcceptedDeviationBuyer)` then service; `buildBundleAfterMutation` after POST); `RegistryServices.acceptedDeviations` (required, like `guidanceEndpoint`); doc-comment paragraph.
- `apps/registry/src/http/serve-cli.ts` + `apps/registry/src/index.ts` — wire + barrel.
- `apps/panel/src/registry.server.ts` — `getAcceptedDeviations`, `recordAcceptance` (+ types/guards imported from contract).
- `apps/panel/src/routes/accepted-deviation.tsx` — NEW surface (loader: applications + effective set of the chosen Application + stored records; component: paste area + manual match-key inputs + Application select + resolved-version display + acceptance-form fields; action: POST → success notice / end-before-start field error / Builder denial / Community plan-refusal in place, values kept on refusal, remount on success) + `apps/panel/src/routes/accepted-deviation.test.tsx` (cold-load, parse pre-fill + malformed-paste error, version-resolution display, end-before-start, Builder denial, Community refusal, success) — copy constants and `AcceptedDeviationForm`-style extraction may live in the route file or a sibling component file mirroring `project-tree`.
- `apps/panel/src/components/panel-chrome.tsx`, `apps/panel/src/routes.ts`, `apps/panel/src/routes.test.ts`, `apps/panel/src/components/components.test.tsx` — nav entry + exact-list updates.

**Acceptance Criteria:**
- Given the Buyer on the Accepted-deviation surface, when they paste a CI deviation log line or enter Standard id, conflict slot and subject and choose the Application, then the form is pre-filled with the match key and shows the Standard version resolved from that Application's current Effective Standard set (with a "no matching Standard" hint when none does).
- Given the submitted justification, start, end and alert interval, when the registry accepts the POST, then the Buyer, justification, start, end, alert interval and key (Application id, Standard id, Standard version resolved by the registry, conflict slot, subject) are stored append-only, and the next bundle built by the pinned post-mutation hook carries exactly that acceptance; while `start <= now < end` the evaluator marks the matching finding accepted, and after `end` it fails again.
- Given an end before the start, when the Buyer submits, then the form names the end field and nothing is written.
- Given a Builder attempting to accept any Deviation (including their own, on any plan), when the POST is made, then they receive the denial saying the Buyer records the acceptance and nothing is written.
- Given a Community tenant, when the Buyer opens the surface (and when they attempt to submit), then a plan-refusal naming Team (first sale) is shown in place, never a price, and nothing is stored.
- Given contract, gate, registry (PostgreSQL 18 via `REGISTRY_TEST_DATABASE_URL`), panel and full workspace verification, when `pnpm --filter @domain-harness/contract test`, `pnpm --filter @domain-harness/gate test`, `REGISTRY_TEST_DATABASE_URL=… pnpm --filter @domain-harness/registry test`, `pnpm --filter @domain-harness/panel test`, `pnpm test`, `pnpm run build`, `pnpm run typecheck`, `pnpm run lint` and `pnpm run boundaries` run, then all pass outputting no skips/filters, with the I/O matrix rows each pinned by a named energized test and no boundary violations (panel still imports only contract).

## Spec Change Log

## Review Triage Log

### 2026-10-14 — Review pass
- verdicts: 29 findings — high 0, medium 6, low 19, false 3, maybe-false 0
- findings:
  - `[medium]` `[patch]` BH1: a Community tenant's cold load rendered the generic outage copy, not the plan refusal (the AC's "opens the surface"), and no test drove that path. Fixed: the streamed sections map a refused `plan_refused` result into the in-place `PlanRefusal` (true outages stay the unavailable copy) and a cold-load Community test asserts the refusal naming Team (first sale) with no submit.
  - `[medium]` `[patch]` ECH2: same root cause as BH1 (grouped).
  - `[medium]` `[patch]` VG1: no test covered the Community cold-load path; the only plan-refusal test drove the submit. Fixed with the cold-load test above.
  - `[medium]` `[patch]` IA1: the intent's expectation lives at surface-open; the diff surfaced the refusal at submit. Fixed with the same cold-load mapping.
  - `[medium]` `[patch]` IA5: the test-surface asymmetry (the AC-observable open state unpinned). Fixed with the cold-load test (same group).
  - `[medium]` `[patch]` ECH1: `getAcceptedDeviations` validated the whole body against the bare-array guard while the registry answers `{ records: [...] }` — every real GET would fail the guard and become "unavailable" forever (the panel tests bypassed the function by feeding promises directly). Fixed: the guard checks the envelope and maps `.records` out; panel tests now drive the real function against a stubbed fetch.
  - `[low]` `[patch]` BH2 + ECH4: the panel's `parseSlot` required exactly 3 parts while contract's parser treats the slot name as the remainder, so a pasted line whose slot name contains `/` pre-filled a slot the panel then rejected. Fixed: `parseSlot` mirrors the parser (name = `parts.slice(2).join("/")`) and a paste test with a `libs/react/dom` slot passes end to end.
  - `[low]` `[patch]` BH4: `parseDeviationLine` cast the id token without validating. Fixed: `isUuidV7` → otherwise `null`, with a rejection test.
  - `[low]` `[patch]` BH6: the record guard accepted empty (or whitespace) subject/justification and an empty slot name — weaker than what the registry can store. Fixed: non-empty-after-trim required, with rejection cases.
  - `[low]` `[patch]` BH7: `recordAcceptance` re-implemented the row→record mapping instead of reusing `toRecord`. Fixed: helper reused.
  - `[low]` `[patch]` BH8 + VG2: the registry re-implemented core's slot rule as unpinned copies (a lost NFC step would be invisible: every fixture is ASCII). Fixed: `sameSlot` imported from `@domain-harness/core` and a db test pins NFC/NFD equivalence end to end.
  - `[low]` `[patch]` BH9: the panel duplicated contract's `isUtcIso` as a private regex. Fixed: the contract export is used.
  - `[low]` `[patch]` BH10: migration 0013 lacked a SQL CHECK on `slot_module_kind` (its siblings are CHECKed). Fixed: the CHECK matches the drizzle enum.
  - `[low]` `[patch]` BH11: the `bundle_build_failed` semantics were pinned only in their happy-path absence on this route. Fixed: a test forces the build to fail after the acceptance insert — 500 `bundle_build_failed`, the row REMAINS, and a later GET shows it (4.1's committed-mutation semantics).
  - `[low]` `[patch]` BH12: the stored-record line omitted the creation time, so the DR16 "every stored field visible" claim was not literal. Fixed: the recorded date renders in the line, exact-text tests updated.
  - `[low]` `[patch]` BH13: `ResolvedVersion` rendered an empty `<p>` for an untyped key. Fixed: renders `null`.
  - `[low]` `[patch]` BH14: the spec's frontmatter and empty logs described an unimplemented story while the diff shipped the implementation. Fixed: finalized by this review step (status, triage log, run result).
  - `[low]` `[patch]` ECH5: the loader's `EFFECTIVE_UNAVAILABLE` sentinel conflated no-selection with a real outage, so unselected loads permanently showed "data unavailable" in the resolved area. Fixed: a distinct no-selection state renders nothing, distinguished from outages in tests.
  - `[low]` `[patch]` ECH6: `isUtcIso` is regex-only and accepts calendar-invalid instants (2026-02-30 rolls over instead of failing), so an invalid START was misreported as an `end` error. Fixed: each instant is validated by finite-parse plus a round-trip inside the window gate, subject `start` vs `end` separately; db test added.
  - `[low]` `[patch]` VG3: a failed bundle build after a committed acceptance answers 500 with the row committed, and the panel's generic outage copy says "nothing was recorded". Fixed registry-side: the semantics are now pinned by a test (row remains, later GET shows the record, which is the source of truth); the panel's 503 copy stays generic and is recorded as a residual below.
  - `[low]` `[reject]` BH3 + ECH3: the spec's Execution text said the parser splits the slot into "exactly 3 parts" while the shipped parser (and its own docstring) uses the remainder rule. The code is the correct reading (the contract doc says the remainder, and the guard tests pin it); the buried sentence predates the refinement and no code change follows.
  - `[low]` `[reject]` VG4: the doc's remainder claim still truncates a slot name containing a space. The CI line grammar is space-delimited tokens — 5.4's pre-existing format property; a slot name with a space cannot be encoded at all, so the parser is faithful and no defect exists here.
  - `[low]` `[defer]` BH5: a Deviation whose subject itself contains `": "` cannot be represented in the pinned CI line grammar (the parser ends the subject at the first `": "`, so a paste of such a line would truncate). The grammar is 5.4's pinned format; an escaping scheme is a contract change with a semver bump, beyond this story. Settle by pinning core's subject composition (identifier-like subjects make the case unreachable) or by a grammar escape decision with a format version bump.
  - `[false]` `[reject]` IA2: the paste is two-step ("Use this line") rather than one-step auto-fill. A defensible implementation of the pre-fill reading; internally consistent and tested.
  - `[false]` `[reject]` IA3: the end-before-start check is intercepted client-side (never sent) while the AC words describe the form naming the field. The registry-side record/refusal is pinned by the db suite both ways; the client intercept is the surface optimization the spec's own plan describes.
  - `[false]` `[reject]` IA4: the displayed version is surface-time guidance while the stored version is the registry's re-resolution. The spec pins registry authority ("the panel shows the resolved version for guidance but never submits a version"); both halves are tested.

## Design Notes

- **Why the parser lives in contract, not gate.** The boundary rule `panel-imports-only-contract` forbids the panel importing `@domain-harness/gate`, and the line grammar's single source is gate's `formatDeviationLine` (pinned byte-for-byte across adapters since 5.4). A contract-side inverse plus a gate round-trip test over the fixture suite keeps one grammar with no fork, without loosening the boundary or moving gate's format.
- **Resolution authority.** The panel's displayed version is guidance; the registry derives it from the Application's current Effective Standard set under the bundle lock at POST time, matching `evaluateDeviations`' key exactly. This is also what makes the bundle-carrying path coherent: the stored acceptance's slot/version come from the same live set the future findings will carry.
- **Plan vs role.** POST checks role first (Buyer-only, body drained), so a Builder — the AC's denial case — is `role_denied` on every plan, and only a Buyer can reach a Community `plan_refusal`; GET carries the plan check so the surfacing "opening on Community shows the refusal" holds regardless of role. The registry's refusal message stays capability-named ("recording an Accepted deviation"); the panel's copy names the plan ("Team (first sale)"), exactly as `project-tree`'s refusal does today.
- **Time fields.** Dates reach the registry as full UTC ISO-8601 (`isUtcIso`); the panel normalizes `YYYY-MM-DD` form inputs to `T00:00:00.000Z`. `alertIntervalHours` is an integer (1–8760) so story 5.6's scheduler can consume it without a further schema change; hours also parallel the staleness bound's unit.
- **Consumer note.** The 4.1 residual "empty list must not read as nothing-ever-accepted" resolves here: the list is exactly the tenant's recorded, still-valid-window acceptances (expiry is read-time in core; no pruning at compile).

## Auto Run Result

Status: done

**Summary:** The Buyer can now record an Accepted deviation end to end. On the panel's `/accepted-deviation` surface they paste a CI Gate Deviation line (or type the match key), choose the Application, see the Standard version resolved from that Application's current Effective Standard set, and submit justification, start, end and alert interval. The registry stores the record append-only (migration 0013, INSERT/SELECT only, forced RLS), resolving the Standard version authoritatively from the Effective set under the bundle lock — never submitted by the panel — and the next bundle built by the pinned post-mutation hook carries the acceptance in `acceptedDeviations` (the 4.1 pinned empty default is gone), deterministically sorted so canonical bytes stay stable across rebuilds. A Builder's submit is refused before the body is read with the Buyer-records denial on every plan; a Community tenant's open and submit answer `plan_refused` naming the capability, and the panel shows the refusal naming Team (first sale), never a price — in place from the cold load on.

**Files changed:**
- `packages/contract/src/deviations.ts` (+ tests, `src/index.ts`): `ACCEPTED_DEVIATION_API_PATHS`, `DeviationMatchKey`, `parseDeviationLine` (the validated inverse of gate's `formatDeviationLine`, UUID-checked id, remainder slot name, `": "` subject separator), `AcceptedDeviationRecord` + strict guards, and the exported `isEffectiveSlot`.
- `packages/gate/src/result.test.ts` (new): the round-trip invariant — every deviation the 5.4 fixture suite yields parses back through the contract parser, pinning one grammar.
- `apps/registry/`: migration `0013_accepted_deviation_records.sql` (append-only, composite FKs, window/interval/kind CHECKs, forced RLS), drizzle mirror + `TENANT_TABLES`, `assertAcceptedDeviationPlan` (Community-only capability map), the acceptance service (role before plan → body → 404 → key-resolve under the bundle lock with core's `sameSlot` → window → insert; newest-first list), the compile read `currentAcceptedDeviations` replacing the hardcoded `[]`, the HTTP GET/POST route (Buyer drained before the body; POST joins `buildBundleAfterMutation`), and the mirrored suites: `accepted-deviations.db.test.ts` (29 tests, every matrix row) plus the extended pinned-route bundle test (route 13 carry + `bundle_build_failed` commit semantics) and every other registry db suite's service wiring.
- `apps/panel/`: `registry.server.ts` read/record clients (envelope-guarded), the new `/accepted-deviation` route (paste area, manual match key, Application select with `?application=` streaming, resolved-version display with the core slot rule, acceptance fields normalized to `T00:00:00.000Z`, field inks, Builder denial, in-place Community plan refusal naming Team (first sale), stored records with every field) + nav/routes wiring, `components.css` (the raised `acceptance-form` joins the standard-form groups; no new colors), and the route/schema tests.

**Review findings:** 29 findings: high 0, medium 6, low 19, false 3.
- **Patched (medium):** the Community cold load showed the outage copy instead of the plan refusal (BH1/ECH2/VG1/IA1/IA5); the read-back client's guard checked the bare list against the `{ records }` envelope, breaking every real GET (ECH1).
- **Patched (low):** panel `parseSlot` aligned with the contract parser's remainder rule; UUID validation in the parser; strict record guards; `toRecord` reuse; core's `sameSlot` replaces the unpinned copies with an NFC/NFD db pin; shared `isUtcIso`; the 0013 module-kind CHECK; the `bundle_build_failed` commit semantics pinned on this route; the creation time in the stored line; the empty-`<p>` and no-selection/outage conflation fixes; the instant-validation split for calendar-invalid dates.
- **Deferred:** the `": "`-in-subject grammar limitation (see the frontmatter `deferred` list).
- **Rejected:** 3 low and 3 false, each with its reason in the triage log.

**Follow-up review recommended: true.** Patched counts: high 0, medium 2 entries, low 11. The named unverified risk: the full Buyer flow has never been executed against a live registry outside the stubbed panel suites and the DB suites (browser + registry + next-bundle carry in one run); a residual UX inexactness remains in the panel's 503 copy for the committed-but-unconfirmed state (the later GET is the source of truth, pinned).

**Verification:**
- With `REGISTRY_TEST_DATABASE_URL` and `SERVICE_TEST_DATABASE_URL` (local PostgreSQL 18): contract 319, gate 15, registry 792 (29 in the new db suite), service 110, panel 400 + 1 skipped (a pre-existing declared contrast exception), core 95, boundaries 17, extractor 16, cli/collector 1 each — all green; `pnpm run boundaries` no violations; `pnpm -r run build`, `typecheck`, `lint` exit 0 (zero warnings).
- Matrix audit: every I/O-matrix row (13) is covered by a named test that ran and passed in the verification output.

**Residual risks:**
- Choices made on the human's behalf: the panel's two-step paste ("Use this line"); end-before-start intercepted client-side (the registry-side subject-`end` check is pinned); the displayed version is guidance only (the registry re-resolves authority); alert interval stored as integer hours (1–8760) for story 5.6's scheduler.
- Expiry is read-time in core: compile carries every stored record and no pruning happens (per the spec; story 5.6 owns liveness/alerting).
- The CI line grammar cannot represent a subject containing `": "` or a slot name containing a space (5.4's pinned format; the deferred finding records the decision point).
- A failed bundle build after a committed acceptance answers 500 with the row committed (4.1 semantics); the panel's generic outage copy for that state says "nothing was recorded" while the record is actually there — the next GET shows it.
- The panel db suites against a live full-service run (`SERVICE_TEST_DATABASE_URL`-driven panel) were not exercised (no service-side change in this story; the pre-existing panel skip is a declared exception).
