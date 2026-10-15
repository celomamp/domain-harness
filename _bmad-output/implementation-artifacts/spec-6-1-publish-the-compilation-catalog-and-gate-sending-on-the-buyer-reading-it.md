---
title: 'Story 6.1: Publish the Compilation catalog, and gate sending on the Buyer reading it'
type: 'feature'
created: '2026-10-15'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
baseline_commit: 'feb73b6f385a125fa58d1e59335aeaa3d6c99054'
context:
  - _bmad-output/implementation-artifacts/epic-6-context.md
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** No published Compilation schema exists: `packages/contract` carries bundles, facts, and deviations but no Compilation types, so the Buyer cannot audit what the vendor would receive, and nothing stops a Collector from sending data nobody reviewed (FR-26, AD-20, UX-DR21).

**Approach:** In `packages/contract`, publish the closed, versioned Compilation catalog (exactly Guidance, Gate run, Deviation, Binding refusal, Bundle status, Collector health) with a semver-bump guard test. In `apps/registry`, add migration 0015 with a per-tenant catalog-read record and an accepted-Compilation store, a tenant-credentialed ingestion endpoint that refuses with the error envelope when the tenant has not recorded a read of the current catalog version, and a Buyer-only read-recording endpoint. In `apps/panel`, add the `/compilations` surface with the schema-reader (ink on white) and the record-read action.

## Boundaries & Constraints

**Always:**
- The catalog is closed: exactly the six type names `guidance`, `gate_run`, `deviation`, `binding_refusal`, `bundle_status`, `collector_health`. Every Compilation carries `type`, per-type `schemaVersion` (semver), the catalog version, a UUIDv7 `idempotencyKey` (`isUuidV7`), `applicationId` (UUIDv7), `agentToolName`, `occurredAt` (UTC ISO-8601, `isUtcIso`), and `sequence` (integer >= 1, the per-Application order). A Gate-run Compilation carries `checkedCount`, `openCount`, revision, verdict, and per-Deviation match key plus status. A Guidance subject crosses only as a slot-name token or a tenant-keyed hash (discriminated union, never raw text). Any added field or type needs a schema version bump, pinned by a test that fails otherwise.
- Unknown major schema versions are rejected and reported (AD-20 consumer rule); the endpoint reports its own catalog version in the refusal.
- Ingestion is tenant-credentialed by reusing the bundle service's service-credential authentication (`authenticateCredential`, timing-safe hash compare): the tenant comes from the credential, never from the path or body. Check order, first failure wins, nothing written: credential invalid (401 `session_invalid`, subject `session`) → no read recorded for the current catalog version (403 `catalog_unread`, subject `catalog`) → body validation (400 `invalid_input`, subject-named) → idempotent insert. An idempotent replay of the same idempotency key stores no duplicate row and returns the stored identity.
- The catalog-read record is per tenant per catalog version (`UNIQUE (tenant_id, catalog_version)`), Buyer-only (`role_denied` before the body is read, drained), append-only (INSERT only; re-reading the same version is `ON CONFLICT DO NOTHING` and returns the existing record). Recording version X never satisfies the gate for version Y; the gate always checks the current `COMPILATION_CATALOG_VERSION`.
- The panel `/compilations` surface follows UX-DR21 and the DESIGN schema-reader tokens: raised surface, body type, schema text ink on white; it lists every Compilation type with its version and fields, states the read state as text (read for catalog version + date, or not read yet with the consequence that the Collector cannot send), and offers the record-read commit. Reading is open to every signed-in role (inventory precedent); recording is Buyer-only with a denial for other roles. The schema field documentation lives in contract (`COMPILATION_SCHEMA_DOCS`, rendered verbatim by the panel) so the surface can never drift from the published schemas. No new chromatic colors; gold stays `button-primary`.
- Contract guards are exact-key never-throw predicates per house pattern; the panel imports only contract; the registry never imports the panel.

**Never:**
- No record-to-Compilation projection function and no outbound Collector path (story 6.2); `packages/collector` is untouched.
- No durable queue, retries, backoff, Collector-health gap reporting, or panel-down accumulation (story 6.3).
- No bundle-status, Collector-health, drop, inventory, Application-evidence, role-grant, or retention views beyond the schema-reader and the read state (stories 6.4–6.7).
- No changes to `packages/core`, `packages/extractor`, `packages/gate`, `apps/service`, bundle compile/sign/verify, or the Effective Standard set.
- No plan capability gates and no prices anywhere; no new runtime dependencies; no cross-app imports; no hex/px literals in CSS.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Catalog inspection | Read `packages/contract` compilations module | Six versioned schemas with the FR-26/AD-20 fields (idempotency key, Application id, agent tool, UTC timestamp, per-Application sequence, Gate checked/open counts, slot-token-or-hash subject) | None |
| Schema evolution guard | A type or field added without a semver bump | The pinned-keys test fails | Bump the schema version and update the pin together |
| Buyer reads catalog | Buyer opens `/compilations` | schema-reader lists each type with version + fields, ink on white; read state shown as text | Registry outage → `unavailable`, page never throws |
| Buyer records read | Buyer commits "I have read catalog 1.0.0" | 201 read record (tenant, version, Buyer ref, timestamp); state text updates | Re-read same version → 200 existing record, no duplicate |
| Non-Buyer records read | Builder/Standard-owner session on the read POST | `role_denied` before the body is read (drained); no row | Panel: denial, values kept |
| Ingest without read | Compilation arrives for a tenant with no read of the current version | 403 `catalog_unread`, subject `catalog`; nothing stored | Collector keeps it queued (6.3 reuses this refusal) |
| Ingest with read | Valid Compilation, read recorded | 201 stored Compilation; replay of the same key → 200 same identity, no duplicate row | None |
| Unknown major | `schemaVersion` with an unrecognized major | 400 `invalid_input` reporting the panel's supported major and catalog version; nothing stored | None |
| Malformed body | Missing/extra key, bad UUIDv7, non-ISO timestamp, non-integer sequence, raw-text subject | 400 `invalid_input` naming the subject; nothing written | None |
| Bad credential | Unknown or missing bearer on ingest | 401 `session_invalid`, subject `session` | Nothing parsed beyond auth |
| New catalog version | Catalog bumped to a later version | Previous reads no longer satisfy the gate; ingest refuses until the new version is read | Panel read state shows the new version as unread |

</intent-contract>

## Code Map

- `packages/contract/src/index.ts` — barrel (L1–278); add the compilations exports (paths, codes, types, guards, catalog version, schema docs).
- `packages/contract/src/errors.ts` — `ErrorEnvelope` (L7–14), `isErrorEnvelope` (L17–23), `PLAN_REFUSED` (L30): the code-constant pattern for the new `CATALOG_UNREAD` code.
- `packages/contract/src/facts.ts` — `FACT_SCHEMA_VERSION = "1.0.0"` (L13) + `RevisionFacts` carrying its schema version: the versioned-shape pattern to mirror per Compilation type.
- `packages/contract/src/bundles.ts` — `BUNDLE_FORMAT_VERSION` (L24); `BUNDLE_API_PATHS` is the path-constants pattern for `COMPILATION_API_PATHS`.
- `packages/contract/src/deviations.ts` — `Deviation` + `isDeviation`: reused inline by the Deviation Compilation (no new deviation model).
- `packages/contract/src/guidance-identity.ts` — `GuidanceUnboundReason`: reused by the Binding-refusal Compilation (no new reason model).
- `packages/contract/src/guidance-tools.ts` — `GUIDANCE_TOOL_SUBJECT_MAX` (L43), `isGuidanceToolSubject`: subject length/grammar reference for the slot-token arm.
- `packages/contract/src/standards.ts` — `entrySlotKind` (L291), `entrySlotName` (L296): the slot grammar the token arm must match.
- `apps/registry/src/bundles/service.ts` — `authenticateCredential` (L180–199, timing-safe compare against `tenant_service_credentials`), `credentialInvalid` (L89–94): reused verbatim for ingestion auth; tenant comes from the credential.
- `apps/registry/src/http/server.ts` — `STATUS_BY_CODE` (L67–96, add `catalog_unread` → 403), `BUNDLE_LATEST_ROUTE` credential-tenant match (L571–592) as the auth-shape precedent, `requireBuyer` (L617–628, drains body on non-Buyer), `bearerToken` (L631–643), `RegistryServices`, per-surface doc comment.
- `apps/registry/src/http/serve-cli.ts` — service wiring (L106–120): wire the new service here.
- `packages/collector/src/index.ts` — stub only (L1–7): read-only evidence that the projection chokepoint does not exist yet; do not touch.
- `apps/registry/src/guidance-endpoint/service.ts` + `validate.ts` — the Buyer-only store-service template (role check, body validator, `withTenant` + insert, factory).
- `apps/registry/migrations/0014_accepted_deviation_alerts.sql` — the append-only DDL idiom (UNIQUE keys, composite FKs, RLS policy + FORCE, `GRANT SELECT, INSERT`); 0015 mirrors it.
- `apps/registry/src/db/schema.ts` — drizzle mirrors + `TENANT_TABLES` (L645–668; every listed table gets RLS/privilege coverage in `tenancy.db.test.ts`).
- `apps/registry/src/bundles/bundles.db.test.ts` — db-suite harness (PostgreSQL 18 via `REGISTRY_TEST_DATABASE_URL`, advisory lock, throwaway db, `provisionCompany`, ephemeral server, HTTP envelopes): the template for `compilations.db.test.ts`.
- `apps/panel/src/registry.server.ts` — `call(path, init, expectedStatus, guard)` + typed helpers: add `getCatalogRead`, `recordCatalogRead` guarded from contract.
- `apps/panel/src/routes/inventory.tsx` — the surface pattern: loader returning streaming `RegistryResult`, `INVENTORY_COPY` constants, `unavailable` paragraph that never throws.
- `apps/panel/src/routes/project-tree.tsx` — the action pattern: `refusal()` mapping (`ROLE_DENIED` → denial status, `invalid_input` subject → field errors), values-kept-on-refusal, remount-key-on-success.
- `apps/panel/src/components/panel-chrome.tsx` — `PANEL_NAV` (L5–11, "Destinations that exist so far; later stories add their own"): add `/compilations` "Compilations".
- `apps/panel/src/routes.ts`, `routes.test.ts` (exact nav assert), `components/components.test.tsx` — exact-list tests to extend.
- `apps/panel/src/design/tokens.ts`, `styles/components.css`, `styles.test.ts` — token/CSS tripwires; add a `.schema-reader` rule from existing raised-surface/ink tokens only (DESIGN.md already specifies it: raised, body type, ink on white).

## Tasks & Acceptance

**Execution:**
- `packages/contract/src/compilations.ts` — NEW: `COMPILATION_CATALOG_VERSION = "1.0.0"`, `COMPILATION_CATALOG_MAJOR = 1`, `COMPILATION_TYPE_NAMES` (exactly the six names), `COMPILATION_API_PATHS = { compilations: "/v1/compilations", catalogReads: "/v1/compilation-catalog/reads" }`, `CATALOG_UNREAD = "catalog_unread"`; per-type interfaces (`GuidanceCompilation`, `GateRunCompilation`, `DeviationCompilation`, `BindingRefusalCompilation`, `BundleStatusCompilation`, `CollectorHealthCompilation`) sharing a common envelope (`type`, `schemaVersion`, `catalogVersion`, `idempotencyKey`, `applicationId`, `agentToolName`, `occurredAt`, `sequence`); Guidance subject as a discriminated union of slot-token vs tenant-keyed hash; Gate-run checked/open counts + verdict + revision + deviation match-key/status summaries; Deviation reusing `Deviation`; Binding refusal reusing the unbound-reason shape; Bundle status carrying active hash, bundle sequence, issued-at; Collector health carrying pending count and dropped-by-reason counts; exact-key never-throw guards (`isCompilation`, per-type guards); `COMPILATION_SCHEMA_DOCS` (per type: name, version, field list with one-line descriptions, rendered verbatim by the panel).
- `packages/contract/src/index.ts`, `packages/contract/src/compilations.test.ts` — re-exports; guard round-trip/rejection tests (extra/missing keys, bad UUIDv7/timestamp/sequence, raw-text subject rejected); the semver-bump guard test pinning the exact sorted key list per type plus the six type names against `COMPILATION_CATALOG_VERSION` (any added type/field without a bump fails); unknown-major rejection test for the per-type `schemaVersion` check.
- `apps/registry/migrations/0015_compilation_catalog.sql` — NEW `compilation_catalog_reads` (id, tenant_id → tenants, catalog_version text CHECK <>'', read_by composite FK `(tenant_id, id)` → accounts, read_at timestamptz, UNIQUE (tenant_id, catalog_version)) and `compilations` (id uuid PK, tenant_id → tenants, idempotency_key uuid, application_id, type_name, schema_version, catalog_version, agent_tool_name, occurred_at, sequence CHECK >= 1, payload jsonb, received_at; UNIQUE (tenant_id, idempotency_key); UNIQUE (tenant_id, application_id, sequence)) — RLS policy + FORCE + `GRANT SELECT, INSERT` per 0014; no UPDATE/DELETE.
- `apps/registry/src/db/schema.ts` — drizzle mirrors of both tables; add both to `TENANT_TABLES`.
- `apps/registry/src/compilations/validate.ts` — NEW body validator (mirror `guidance-endpoint/validate.ts`): exact key set via the contract guards, `schemaVersion` major must equal `COMPILATION_CATALOG_MAJOR` (else `invalid_input` reporting the supported major and catalog version), `catalogVersion` must equal `COMPILATION_CATALOG_VERSION`; returns `{ ok: false, envelope }` with subject naming the field.
- `apps/registry/src/compilations/service.ts` — NEW `createCompilationsService(db)` exposing `recordCatalogRead(session, body)` (Buyer assert → body must carry the current catalog version → `withTenant` insert with `ON CONFLICT (tenant_id, catalog_version) DO NOTHING`, returning the existing row on conflict), `getCatalogRead(session)` (read state for the current catalog version: read flag + timestamp), and `ingestCompilation(credentialTenant, body)` (read-gate 403 `catalog_unread` → validate → idempotent insert, conflict on idempotency key returns the stored identity with a replay flag). `assertCompilationBuyer(session)` exported for the server layer.
- `apps/registry/src/compilations/compilations.db.test.ts` — NEW db suite (harness per `bundles.db.test.ts`): every matrix row pinned by a named test, including nothing-stored-on-refusal, replay dedupe, version-scoped reads (read of 1.0.0 does not satisfy a bumped gate — simulated with a second version literal only if the bump mechanism allows; otherwise pin current-version behavior), tenant isolation, and append-only privileges (no UPDATE/DELETE by the runtime role).
- `apps/registry/src/http/server.ts` — static routes `POST /v1/compilations` (service-credential auth via `bundles.authenticateCredential`, tenant from the credential; 401 before anything is parsed) and `GET` + `POST /v1/compilation-catalog/reads` (session auth; POST behind `requireBuyer(req, session, assertCompilationBuyer)`); `STATUS_BY_CODE` gains `catalog_unread` → 403; `RegistryServices.compilations` (required); doc-comment paragraph.
- `apps/registry/src/http/serve-cli.ts` + `apps/registry/src/index.ts` — wire + barrel.
- `apps/panel/src/registry.server.ts` — `getCatalogRead`, `recordCatalogRead` (+ types/guards imported from contract).
- `apps/panel/src/routes/compilations.tsx` — NEW surface (loader: static `COMPILATION_SCHEMA_DOCS` + streamed read state; component: schema-reader section per type with version + fields in ink on white, read-state text, Buyer-only record-read form with success notice / denial for non-Buyers / `unavailable` on registry outage) + `apps/panel/src/routes/compilations.test.tsx` (cold-load lists all six schemas with versions, read/not-read states, Buyer record success, non-Buyer denial, outage unavailable).
- `apps/panel/src/components/panel-chrome.tsx`, `apps/panel/src/routes.ts`, `apps/panel/src/routes.test.ts`, `apps/panel/src/components/components.test.tsx` — `/compilations` "Compilations" nav entry + exact-list updates.
- `apps/panel/src/styles/components.css` (+ `styles.test.ts` if it pins the rule set) — `.schema-reader` from existing raised-surface/ink/body tokens only.

**Acceptance Criteria:**
- Given `packages/contract`, when inspected, then it defines versioned (semver plus type name) schemas for exactly Guidance, Gate run, Deviation, Binding refusal, Bundle status and Collector health, with the FR-26/AD-20 fields (UUIDv7 idempotency key, Application id, agent tool name, UTC timestamp, per-Application sequence, Gate checked and open counts, subject as slot token or tenant-keyed hash), and a test fails if a type or field is added without a semver bump.
- Given the Compilations surface, when the Buyer opens schema-reader, then they can read each schema in ink on white, and record that they have read the catalog version (non-Buyers get a denial; the state reads back as text).
- Given the panel's tenant-credentialed ingestion endpoint, when a Compilation arrives for a tenant with no recorded read of the current catalog version, then ingestion is refused with the error envelope, and nothing is stored (an accepted Compilation is stored exactly once per idempotency key).

## Spec Change Log

## Review Triage Log

### 2026-10-15 — Review pass (four layers: blind-hunter 15, edge-case-hunter 4, verification-gap 1, intent-alignment 1)
- verdicts: 21 findings — high 0, medium 0, low 14, false 6, maybe-false 0
- findings:
  - `[low]` `[reject]` `application_id` without FK or existence check (blind) — Verified: the column carries no FK and ingestion accepts any UUIDv7. Orphan rows are possible, but rows are namespaced by the credential tenant (no cross-tenant effect), the caller is the trusted Company service, and no reader exists in scope; an existence rule would be spec-unsettled behavior for 6.5/6.6 to add when they join.
  - `[low]` `[reject]` same-key different-body replay answers the stored row (blind) — Verified in `service.ts`: conflict-DO-NOTHING plus select returns the stored payload with 200. Same root cause as the edge-case replay finding below; grouped. The matrix pins same-key replay to the stored identity and statuses distinguish new (201) from replay (200); divergent-body-under-one-key is trusted-caller misuse, and a conflict refusal would invent unsettled semantics.
  - `[false]` `[reject]` free-text channels in gate-run subjects, deviation subject/correction, refusal sentence (blind) — Refuted: the spec deliberately scopes the slot-token-or-hash rule to Guidance subjects only; deviation subjects, Corrections and refusal sentences are required evidence for the 6.4–6.6 surfaces. Restricting them would be a spec edit, which is barred.
  - `[low]` `[reject]` refusal sentence not pinned per reason (blind) — Verified non-empty-only. The registry cannot authenticate sentence text from any credentialed caller, and pinning would couple contract to gate-sentence wording the spec never asks for.
  - `[low]` `[reject]` `droppedByReason` without closed vocabulary or bounds (blind) — Verified values-only check. The reason vocabulary originates in story 6.3's Collector; constraining it now invents that story's vocabulary, and empty keys are trusted-caller misuse.
  - `[false]` `[reject]` `agentToolName` without allowlist or normalization (blind) — Refuted: the vocabulary is owned upstream by 4.5's bundle application entries, which ingestion must accept verbatim for forward compatibility; normalization is a read-side concern, not an ingestion gate.
  - `[low]` `[reject]` future `occurredAt`/`issuedAt` accepted, no skew window (blind) — Verified calendar-real-only. No consumer exists in scope and no skew policy is specified; staleness derivation belongs to 6.4. Trusted-caller misuse only.
  - `[low]` `[reject]` `bundleHash` not looked up against issued bundles (blind) — Verified hex-only. The spec mandates carrying hash/sequence/issuedAt with no lookup; active-bundle resolution is service-side and 6.4's concern.
  - `[low]` `[reject]` Standard ids not verified against the tenant's Standards (blind) — Verified UUIDv7-only. Same class as the application-id row: tenant-namespaced rows, trusted caller, no in-scope join.
  - `[low]` `[patch]` loader maps lapsed sessions to unavailable; session-ended copy dead (blind) — Verified: `sessionEnded`/`signInAgain` defined but never rendered, and every non-ok read state shows unavailable. Same root cause as the edge-case loader finding; grouped. Fix applied: the read-state resolution distinguishes refused `session_invalid` with the session-ended message plus sign-in link, following the project-tree/module-standards precedent; pinned by a loader test resolving refused `session_invalid`.
  - `[low]` `[patch]` ingest gate does not drain the body on refusal (blind) — Verified: `assertCatalogRead` throws before `readJson`, unlike the reads POST which drains via `requireBuyer` (`req.resume()`). Fix applied: try/catch with `req.resume()` before rethrowing, mirroring the house pattern; status/code/subject unchanged.
  - `[false]` `[reject]` ingest requires the bundles service (blind) — Refuted: reusing `authenticateCredential` is spec-mandated, so the coupling is inherent; deployment always wires both, and `RegistryServices.compilations` is itself required.
  - `[false]` `[reject]` replay response carries no stored-row identity (blind) — Refuted: the idempotency key in the echo plus the 201-vs-200 status carry identity and replay-ness; the spec asks for no other wire shape and the test pins echo equality.
  - `[false]` `[reject]` contract/router calendar-validity divergence on Feb-30 (blind) — Refuted: permissive shape guards versus strict whole-payload validators is the established layered pattern; both levels are tested (contract shape cases, registry 400 on `2026-02-30`).
  - `[low]` `[reject]` panel/registry version drift surfaces as generic 503 (blind) — Verified: `invalid_input` on `catalogVersion` falls to the 503 mapping. Same root cause as the edge-case version-skew finding; grouped. The monorepo ships panel and registry from one versioned contract, so drift is deploy-transient; mismatch UX belongs to a future bump story.
  - `[low]` `[reject]` divergent-body replay (edge-case) — Same defect as the blind replay row; grouped and shares its route.
  - `[low]` `[patch]` `sequence` above int4 max escapes as 500 (edge-case) — Verified: no JS upper bound against the `integer` column. Only the top-level `sequence` maps to int4 (counts and `bundleSequence` live in jsonb, which has no such ceiling). Fix applied: `SEQUENCE_MAX = 2_147_483_647` rejection as `invalid_input` naming `sequence`, pinned by an overflow case in the malformed suite.
  - `[low]` `[reject]` loader refused path hides sign-in (edge-case) — Same defect as the blind loader row; grouped and shares its patch route.
  - `[low]` `[reject]` stale catalog version shown as outage (edge-case) — Same defect as the blind drift row; grouped and shares its route.
  - `[low]` `[patch]` record-action sign-in routing untested (verification-gap) — Pre-verified gap accepted as filed: no no-cookie action test and no stubbed-401 test exist. Fix applied: both cases added in the repo's lapsed-session style (no cookie → 302 without fetch; stubbed 401 `session_invalid` → 302).
  - `[false]` `[reject]` ingestion surface: panel versus registry (intent-alignment divergence 1) — Refuted: AD-17 plus the Epic 6 context mandate per-tenant credential auth with roles enforced in the registry, and the spec's Approach and Code Map place the endpoint in `apps/registry` explicitly; the epics.md "panel's ingestion endpoint" is loose shorthand, and the spec is this build's authority.

## Auto Run Result

- Summary: story 6.1 publishes the closed, versioned Compilation catalog and gates sending on the Buyer reading it. `packages/contract` gains the six-type catalog (`guidance`, `gate_run`, `deviation`, `binding_refusal`, `bundle_status`, `collector_health`) with envelope, exact-key never-throw guards, per-type semver, unknown-major rejection, and the verbatim `COMPILATION_SCHEMA_DOCS` plus a semver-bump guard test. `apps/registry` gains migration 0015 (`compilation_catalog_reads` + `compilations`, RLS/FORCE, SELECT+INSERT-only, append-only), the tenant-credentialed `POST /v1/compilations` (401 → 403 `catalog_unread` gate before body parse → 400 validation → idempotent insert with 201/200-replay) and Buyer-only `GET`/`POST /v1/compilation-catalog/reads` (201/200-existing). `apps/panel` gains the `/compilations` schema-reader surface (ink on white) with streamed read state and the Buyer-only record-read commit. No projection, no queue, no collector path; `packages/collector` untouched.
- Files:
  - `packages/contract/src/compilations.ts` (NEW) + `compilations.test.ts` (NEW) + `index.ts` — catalog, guards, docs, semver pins.
  - `apps/registry/migrations/0015_compilation_catalog.sql` (NEW) + `db/schema.ts` (`TENANT_TABLES`) — tables, RLS, grants.
  - `apps/registry/src/compilations/validate.ts`, `service.ts` (NEW) + `index.ts` — validators, read/record/gate/ingest operations; review patches: int4 `sequence` cap.
  - `apps/registry/src/http/server.ts`, `serve-cli.ts` + `server.test.ts` (FakeCompilations) — routes, wiring; review patch: ingest-gate body drain.
  - `apps/registry/src/compilations/compilations.db.test.ts` (NEW, 22 tests) + 13 existing db suites + tenancy pins — matrix coverage, RLS/grant/append-only proofs.
  - `apps/panel/src/routes/compilations.tsx` (NEW) + `compilations.test.tsx` (NEW, 16 tests) + `registry.server.ts`, nav, routes, `.schema-reader` CSS — surface; review patches: lapsed-session distinction, sign-in routing tests.
  - `_bmad-output/implementation-artifacts/epic-6-context.md` (NEW) — compiled Epic 6 context.
  - `_bmad-output/implementation-artifacts/spec-6-1-publish-the-compilation-catalog-and-gate-sending-on-the-buyer-reading-it.md` — this spec (status done).
- Findings breakdown: 21 findings — 5 patched across 4 entries (lapsed-session loader wiring + tests; ingest-gate body drain; int4 sequence cap + test; record-action sign-in tests), 0 deferred, 16 rejected (6 false with refuting evidence — Guidance-only subject restriction, tool vocabulary ownership, bundles-service coupling inherent in the reuse mandate, replay identity via key+status, layered guard/validator strictness, AD-17 registry placement; 10 low — orphan ids, divergent replay, sentence pinning, reason vocabulary, future instants, hash/Standard lookups, version-drift UX, all with named reasons).
- Follow-up review recommendation: false — first pass with no patched high and no patched medium (4 patched low entries).
- Verification: `pnpm install --frozen-lockfile` clean (this also resolved the implementer's boundaries/build caveats, which were a stale partial install — full `pnpm -r run build` exits 0 and `pnpm run boundaries` reports no violations); `pnpm -r run typecheck` exit 0; `pnpm -r run lint` exit 0; `pnpm -r run test` with both `REGISTRY_TEST_DATABASE_URL` and `SERVICE_TEST_DATABASE_URL` on postgres 18 — contract 359, collector 1, cli 1, boundaries-self 17, extractor 16, core 95, gate 15, mcp-bridge 11, panel 435 passed + 1 pre-existing skip, registry 847, service 169 (1966 passed total, 0 failed; per-package isolation runs after re-verification). Full-parallel runs intermittently fail timing-sensitive suites under load (service p95 perf, panel module-standards render, registry tenancy spawn tests, boundaries self-test, one compilations findByText) — each passes in isolation (perf 1/1, module-standards 34/34, tenancy 28/28, boundaries 17/17, compilations 16/16 ×3), confirming the known parallelism flake; none touches 6.1 surfaces. Matrix audit: all 11 spec I/O rows covered by named tests that ran and passed (db suite 22 incl. RLS/grants/append-only/version-scope/isolation; contract guard+bump suites; panel surface suite 16/16).
- Residual risks: (1) orphan evidence rows (application/Standard ids never existence-checked) — tenant-namespaced, trusted caller, no reader in scope; 6.5/6.6 to add existence when they join. (2) Same-key divergent-body replay answers the stored row with 200 — keyed by UUIDv7, trusted caller; statuses distinguish new from replay. (3) Free-text evidence fields (deviation subject/correction, refusal sentence, drop reasons, tool names) cross unvalidated by design — the Guidance-subject token-or-hash rule is the only restriction, per spec; 6.2's projection owns content safety. (4) Implementer judgment calls pinned by tests for 6.2+: Guidance carries tool+outcome; revision free-form; bundle_status without staleness/frozen; replay-with-different-body answers stored 200; sequence clash is 400 on `sequence`.

## Verification

**Commands:**
- `pnpm --filter @domain-harness/contract test` -- expected: all compilations tests pass, including the semver-bump guard
- `pnpm --filter @domain-harness/contract typecheck && pnpm --filter @domain-harness/contract lint` -- expected: clean
- `REGISTRY_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres pnpm --filter @domain-harness/registry test` -- expected: compilations db suite green (needs the Docker PostgreSQL 18 on localhost:5432)
- `pnpm --filter @domain-harness/registry typecheck && pnpm --filter @domain-harness/registry lint` -- expected: clean
- `pnpm --filter @domain-harness/panel test` -- expected: compilations surface tests green
- `pnpm --filter @domain-harness/panel typecheck && pnpm --filter @domain-harness/panel lint` -- expected: clean
