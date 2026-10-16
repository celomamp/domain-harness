---
title: 'Story 6.7: Buyer controls who reads Guidance records, and how long they are kept'
type: 'feature'
created: '2026-10-16'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
baseline_commit: '2e6e41f52ecf'
context:
  - _bmad-output/implementation-artifacts/epic-6-context.md
  - _bmad-output/implementation-artifacts/spec-6-1-publish-the-compilation-catalog-and-gate-sending-on-the-buyer-reading-it.md
  - _bmad-output/implementation-artifacts/spec-6-2-project-records-into-compilations-through-one-collector-chokepoint.md
  - _bmad-output/implementation-artifacts/spec-4-5-record-guidance-events-and-gaps-in-the-company-store.md
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** Stored Guidance events (4.5) have no access control and no expiry: any role could read what Builders asked agents, and rows live forever despite the specified 90-day default (FR-28, FR-20, AD-22, UX-DR22).

**Approach:** In `packages/contract`, version the Guidance-access shape (grant, retention bounds, role-token contract). In `apps/registry`, store the Buyer's per-role grant plus retention setting (migration 0016, Buyer-only writes) and mint short-lived tenant-scoped Ed25519 role tokens (reusing the bundle signer) only for granted roles. In `apps/service`, serve a token-gated Guidance-event read endpoint inside the Company network plus a scheduled retention sweep that enforces the registry-held setting with a 90-day fallback. In `apps/panel`, add the `/guidance-access` grant/retention surface that never renders Guidance content.

## Boundaries & Constraints

**Always:**
- The Buyer is implicitly granted and can never be revoked; grantable roles are exactly `Standard owner` and `Builder`. Grant and retention writes are Buyer-only (`role_denied` before the body is read, drained); reads of the access state are open to every role.
- The grant is append-only change rows (`guidance_role_grant_changes`, latest per role wins) and retention is append-only change rows (`guidance_retention_changes`, latest wins, default `GUIDANCE_EVENT_RETENTION_DAYS = 90` when no row exists). Retention bounds are 1..3650 days, pinned in contract, validator, and DB CHECK. Same-state POST is 200 with nothing written. Both tables join `TENANT_TABLES` with RLS/FORCE and `GRANT SELECT, INSERT` only, per the 0015 idiom.
- Role tokens are stateless Ed25519 signatures from the registry's existing bundle signer over canonical JSON `{tenantId, role, issuedAt, expiresAt}` with `GUIDANCE_ROLE_TOKEN_TTL_MINUTES = 5`; the token carries its `keyId`. Minting is session-authed for the caller's own role only and refuses with `role_denied` when that role lacks the grant. No token table exists; grant revocation takes effect for new mints immediately and for outstanding tokens at expiry (5-minute bound, documented).
- The service verifies tokens offline against a trust set from new `SERVICE_ROLE_TOKEN_TRUST_KEYS` env (same JSON shape as the bundle trust keys): shape → tenant equals `SERVICE_TENANT_ID` → `issuedAt`/`expiresAt` sane with `expiresAt - issuedAt <= TTL` → key known → signature verifies. Every failure answers one indistinguishable 401 `session_invalid` (subject `session`); no content is ever attached to a denial. Method other than GET answers 405.
- The service read endpoint is `GET /v1/guidance-events` with optional `applicationId` (UUIDv7, else 400 `invalid_input` subject `applicationId`) and optional `gaps=true` (miss projection); unknown applications answer 200 with an empty list. Every request logs ids/codes only, never subject text.
- The retention sweep runs in the guidance-server process (immediate catch-up at start plus a 24h tick, failures logged with codes only and retried next tick). Each sweep fetches the current retention from the registry over the tenant-credential-authed `GET /v1/guidance-access/retention` (bounded timeout, never throws); on any failure it enforces the 90-day default and logs the fallback. Deletion is `delete from guidance_events where created_at < now - days`, returning the count; service migration 0005 adds the `created_at` index (the 4.5-deferred retention hook). The service store is single-tenant plain tables (no RLS), so DELETE needs no grant change.
- The panel `/guidance-access` surface configures the grant and retention and shows the current values only: role rows with granted yes/no (Buyer fixed as always-granted text), retention number input plus current-value text, Buyer-only save with denial for other roles, `unavailable` on registry outage, values kept on refusal, remount on success. The panel never proxies, caches, or renders Guidance-event content or role-token strings beyond the mint response it just created; no fetch to the service read endpoint exists anywhere in the panel (pinned by a text scan test).
- Contract guards are exact-key never-throw predicates; the panel imports only contract; the registry never imports the panel; the service never imports the registry.

**Never:**
- No change to bundle compile/sign/verify, the bundle payload shape, the Compilation catalog, the collector, or the Effective Standard set (no semver bumps anywhere).
- No `buildBundleAfterMutation` on guidance-access writes (nothing bundle-visible changes) and no bundle rebuild is triggered by grant, retention, or token operations.
- No per-read registry round trip from the service (verification is offline); no token revocation list; no pagination on the read endpoint (pilot scale, 90-day bound; recorded as residual risk).
- No plan capability gates and no prices anywhere; no new runtime dependencies; no cross-app imports; no hex/px literals in CSS.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Buyer sets grant + retention | Buyer POST `{grants: {"Standard owner": true, "Builder": false}, retentionDays: 30}` | 200 new state `{grantedRoles, retentionDays}`; rows appended | None |
| Non-Buyer sets | Builder/Standard-owner POST | 403 `role_denied`, body drained, nothing written | Denial, values kept |
| Same-state POST | Identical to current | 200 current state, nothing written | No error expected |
| Bad retention | 0, negative, non-integer, > 3650, missing/extra keys | 400 `invalid_input` naming the subject | Nothing written |
| Mint for granted role | Standard-owner session, grant held | 201 `{token, role, expiresAt}` verifying against the registry public key | None |
| Mint for ungranted role | Builder session, no grant | 403 `role_denied`, no token | Nothing written |
| Mint for Buyer | Buyer session, no stored row | 201 token (Buyer implicit) | None |
| Panel mint affordance | Viewer whose role holds the grant submits mint | Token text shown once with copy affordance; ungranted viewer gets denial | Outage → unavailable, nothing shown |
| Service read, valid token | Bearer token, optional filters | 200 `{events}` (filters applied) | None |
| Service read, no/bad/expired/foreign-tenant/forged token | Missing, malformed, expired, wrong tenant, wrong key | 401 `session_invalid`, no content | Nothing leaked |
| Service read, bad filter | `applicationId` not UUIDv7 | 400 `invalid_input` subject `applicationId` | No content |
| Sweep with registry value | Registry retention 30, rows at 31 and 29 days | 31-day row deleted, 29-day kept, count logged | None |
| Sweep on registry outage | Fetch fails/timeout | 90-day default enforced, fallback logged | Never throws |
| Retention default | No retention row ever written | State shows 90; sweep enforces 90 | No error expected |
| Tenant isolation | Tenant B reads/writes | Never sees tenant A's grants, retention, or events | 401/empty as appropriate |
| Compilation export | Any Compilation searched | No field defined as prompt text exists | Test failure naming the field |
| Panel content ban | Panel sources scanned | No fetch to `/v1/guidance-events`, no Guidance subject/event rendering | Test failure with file + line |

</intent-contract>

## Code Map

- `packages/contract/src/guidance-access.ts` — NEW: `GUIDANCE_ACCESS_API_PATHS = { access: "/v1/guidance-access", tokens: "/v1/guidance-access/tokens", retention: "/v1/guidance-access/retention" }`, `GUIDANCE_EVENT_READ_PATH = "/v1/guidance-events"`, `GRANTABLE_ROLES = ["Standard owner", "Builder"]`, `GUIDANCE_ROLE_TOKEN_TTL_MINUTES = 5`, `GUIDANCE_RETENTION_DAYS_MIN = 1`, `GUIDANCE_RETENTION_DAYS_MAX = 3650`, `GuidanceAccessState { grantedRoles: Role[]; retentionDays: number }`, `GuidanceRoleToken { token, role, expiresAt }`, token payload type, exact-key never-throw guards. Reuses `ROLES`/`isRole` from `accounts.ts`, `GUIDANCE_EVENT_RETENTION_DAYS` default from `guidance-events.ts`, `ROLE_DENIED`/`SESSION_INVALID` from `sign-in.ts`.
- `packages/contract/src/index.ts`, `packages/contract/src/guidance-access.test.ts` — barrel + guard/bound tests + the no-prompt-text catalog scan (every key of every Compilation schema and `COMPILATION_SCHEMA_DOCS` field name against /prompt/i).
- `apps/registry/migrations/0016_guidance_access.sql` — NEW `guidance_role_grant_changes` (id, tenant_id → tenants, role text CHECK in the three roles, granted bool, sequence int, changed_by composite FK, changed_at; UNIQUE (tenant_id, role, sequence)) and `guidance_retention_changes` (id, tenant_id, days int CHECK 1..3650, sequence, changed_by, changed_at; UNIQUE (tenant_id, sequence)); RLS + FORCE + policy + `GRANT SELECT, INSERT` per 0015 idiom; no UPDATE/DELETE.
- `apps/registry/src/db/schema.ts` — drizzle mirrors of both tables; append both to `TENANT_TABLES` (L693+, now covering migrations 0001–0016).
- `apps/registry/src/guidance-access/validate.ts` — NEW body validator: exact keys `{grants, retentionDays}`, grants an object with exactly the two grantable-role keys mapping to booleans, retentionDays integer 1..3650; `invalid_input` naming the subject.
- `apps/registry/src/guidance-access/service.ts` — NEW `createGuidanceAccessService(db, signer)`: `getGuidanceAccess(session)` (all roles; Buyer implied + latest-per-role grants + latest retention or 90), `setGuidanceAccess(session, body)` (Buyer assert → validate → idempotent 200 → append grant rows that changed + retention row when changed, under `lockBundle` serialization like `guidance-endpoint/service.ts` L56–77, but no bundle rebuild at the HTTP layer), `mintRoleToken(session)` (own role; Buyer or currently granted else `role_denied`; signs canonical `{tenantId, role, issuedAt, expiresAt}` with the injected bundle `Signer` from `bundles/sign.ts`), `getRetentionDays(credentialTenant)` (credential-authed read for the service sweep: latest retention or 90). Exports `assertGuidanceAccessBuyer(session)` for the server layer.
- `apps/registry/src/guidance-access/guidance-access.db.test.ts` — NEW db suite (harness per `compilations.db.test.ts`): every matrix row incl. Buyer-implicit, idempotent POST, append-only privileges, tenant isolation, token verifies with the test keypair and mint refuses ungranted, retention default/current.
- `apps/registry/src/http/server.ts` — routes `GET`+`POST /v1/guidance-access` (session auth; POST behind `requireBuyer(req, session, assertGuidanceAccessBuyer)` L672–683), `POST /v1/guidance-access/tokens` (session auth, any role; service mints-or-denies), `GET /v1/guidance-access/retention` (service-credential auth via `bundles.authenticateCredential`, tenant from credential; 401 before anything parsed); `RegistryServices.guidanceAccess` (required); doc-comment paragraph.
- `apps/registry/src/http/serve-cli.ts` + `apps/registry/src/index.ts` — wire `createGuidanceAccessService(db, signer)` (signer already built L99–105) + barrel.
- `apps/registry/src/http/server.test.ts` — FakeGuidanceAccess wiring (per FakeCompilations) + route-status pins for the three routes.
- `apps/registry/src/db/tenancy.db.test.ts` (or the tenancy suite covering TENANT_TABLES) — new tables inherit RLS/privilege coverage by listing.
- `apps/service/migrations/0005_guidance_events_retention_idx.sql` — NEW index on `guidance_events (created_at)` for the sweep (the 4.5-deferred hook).
- `apps/service/src/guidance/events.ts` — add `deleteGuidanceEventsOlderThan(cutoffIso: string): Promise<number>` to `GuidanceEventStore` + both twins (InMemory filter; Postgres `delete ... where created_at < $1`); `events.db.test.ts` pins (old deleted, boundary kept, count returned).
- `apps/service/src/guidance/role-tokens.ts` — NEW `verifyRoleToken({ token, tenantId, trustSet, nowMs })`: parse `keyId.payloadB64.sigB64` → payload guards (tenant UUIDv7, `isRole`, UTC ISO instants) → tenant equals configured → `0 <= expiresAt - issuedAt <= TTL` and `now < expiresAt` → trust-set key lookup → `node:crypto.verify`; returns `{ ok: true, role }` or `{ ok: false }` (caller maps every failure to one 401). `role-tokens.test.ts` pins valid/forged/expired/foreign-tenant/unknown-key/malformed/too-long-TTL.
- `apps/service/src/guidance/events-read.ts` — NEW `handleGuidanceEventRead(deps, req, res, path, query)`: GET-only (405 + Allow otherwise) → Bearer role token (missing/malformed → 401) → verify (fail → 401) → `applicationId` filter validation (400 naming it) → `listGuidanceEvents` / `listGuidanceGaps` → 200 `{events}`; ids/codes-only logging; never throws content-bearing errors. Route label `read_guidance_events`.
- `apps/service/src/guidance/retention.ts` — NEW `sweepGuidanceEvents({ store, retentionDays, now })` (cutoff = now − days, returns deleted count) + `fetchRetentionDays({ fetchImpl, baseUrl, credential, timeoutMs })` (credential-authed GET of the retention path, never throws: `{ ok: true, days }` on guarded 200 else `{ ok: false }` → caller falls back to 90 and logs). `retention.test.ts` pins sweep boundaries and fetch success/refusal/transport-failure mapping.
- `apps/service/src/guidance/server-cli.ts` — dispatch the read path before the 404 (`readRouteOf`-style predicate from `events-read.ts`); thread `tokenTrustSet` from config and the event store into the handler; start the sweep (catch-up once + 24h tick, failures logged and retried) only when `retentionSweep` deps are provided (default null so unit servers stay timer-free); clear on stop.
- `apps/service/src/guidance/config.ts` — `GuidanceServiceConfig` gains `tokenTrustSet` (required `SERVICE_ROLE_TOKEN_TRUST_KEYS`, parsed with bundles `parseTrustKeys`), `registryUrl` + `registryCredential` (required, for the sweep fetch); `config.test.ts` pins.
- `apps/service/src/guidance/guidance.db.test.ts` + `events.db.test.ts` — migration-list pins gain 0005.
- `apps/panel/src/registry.server.ts` — `getGuidanceAccess`, `setGuidanceAccess(token, body)`, `mintRoleToken(token)` (+ typed guards from contract), mirroring `getCatalogRead`/`recordCatalogRead`.
- `apps/panel/src/routes/guidance-access.tsx` — NEW surface (loader: streamed access state, no cookie → sign-in redirect; action intents: `save` with grants + retentionDays, and `mint` for the viewer's own role when granted, answering the token text once with a copy affordance; SESSION_INVALID → sign-in redirect; ROLE_DENIED → denial; invalid_input → field error under the named subject with values kept; success remounts form; Buyer-always row as fixed text; current retention shown as text; no event content and no service-endpoint fetch rendered anywhere) + `guidance-access.test.tsx` (Buyer save, non-Buyer denial, bad-retention field error, outage unavailable, mint success for granted role + mint denial for ungranted role, no-fetch-to-service scan, grant/retention text states).
- `apps/panel/src/components/panel-chrome.tsx`, `apps/panel/src/routes.ts`, `apps/panel/src/routes.test.ts`, `apps/panel/src/components/components.test.tsx` — `/guidance-access` "Guidance access" nav entry + exact-list updates.
- `README.md` — extend `## Guidance records` (4.5): grant model, token TTL/tenant scope, read endpoint location + auth, retention setting + sweep cadence + fallback, new env vars.

## Tasks & Acceptance

**Execution:**
- `packages/contract/src/guidance-access.ts` + test + barrel — access/token/retention vocabulary, guards, TTL and bound constants, no-prompt-text catalog scan.
- `apps/registry/migrations/0016_guidance_access.sql` + `db/schema.ts` (`TENANT_TABLES`) — append-only grant/retention tables, RLS/FORCE, SELECT+INSERT-only.
- `apps/registry/src/guidance-access/validate.ts`, `service.ts`, `index.ts` — validator, get/set/mint/retention operations; review the sign call for canonical-JSON determinism (`canonicalJson` precedent in `bundles/sign.ts`).
- `apps/registry/src/guidance-access/guidance-access.db.test.ts` — matrix pins incl. privileges, isolation, idempotent POST, mint-reflects-grant with a test Ed25519 keypair.
- `apps/registry/src/http/server.ts`, `serve-cli.ts`, `server.test.ts`, tenancy suite — three routes, wiring, fake-service route pins, RLS/grant coverage.
- `apps/service/migrations/0005_guidance_events_retention_idx.sql` + `guidance/events.ts` + `events.db.test.ts` — sweep index, delete operation on both twins.
- `apps/service/src/guidance/role-tokens.ts` + test — offline verification, every denial class.
- `apps/service/src/guidance/events-read.ts` + http tests — token-gated read, filters, 401/400/405 matrix, ids-only logs.
- `apps/service/src/guidance/retention.ts` + test, `server-cli.ts`, `config.ts` + test — sweep, authenticated fetch with fallback, dispatch, scheduler wiring, new env.
- `apps/service/src/guidance/guidance.db.test.ts` — 0005 migration pins.
- `apps/panel/src/routes/guidance-access.tsx` + test + `registry.server.ts`, nav, routes, exact-list tests — grant/retention surface without content.
- `README.md` — operator/user documentation for the new model and env.

**Acceptance Criteria:**
- Given the Guidance access surface, when the Buyer sets which roles can read Guidance events, then the grant is stored in the registry and the registry issues short-lived, tenant-scoped role tokens that reflect it.
- Given the service's Guidance-event read endpoint inside the Company network with a token whose role lacks the grant, or with no token, when it is called, then it returns a denial and the panel shows no Guidance content.
- Given retention defaulting to 90 days, when the Buyer changes it, then the service deletes Guidance records older than the setting on a schedule and the role-grant surface shows the current value.
- Given an exported Compilation, when it is searched, then no field defined as prompt text exists.

## Spec Change Log

## Review Triage Log

### 2026-10-16 — Review pass (adapted single-pass: blind read of the staged diff, edge-case path trace, verification-gap audit, intent-alignment check; no subagent tool in this worker)
- verdicts: 12 findings — high 0, medium 1, low 9, false 2, maybe-false 0
- findings:
  - `[low]` `[patch]` future-issuedAt token usable beyond the TTL — Verified: any `expiresAt - issuedAt <= 5min` window passed, so a registry clock ahead extended real lifetime. Fix applied: deny when `issuedMs > nowMs + 60s` (`ROLE_TOKEN_ISSUED_SKEW_MS`), pinned by future-issuance and expiry-boundary tests.
  - `[medium]` `[patch]` sweep scheduler path never executed in tests — Verified: all server-cli suites passed `sweep: null`, so catch-up, fetch-to-sweep-to-log and close-clearing were unexercised. Fix applied: two deployed Postgres suites (0-day catch-up deletes the row with the count logged; unreachable registry enforces the 90-day default with the fallback logged).
  - `[low]` `[patch]` tenant-B retention scoping unpinned — Verified: only tenant A's value was read back. Fix applied: per-tenant retention test (A=45, B=60).
  - `[low]` `[patch]` expiry-boundary, `gaps=false` and mint lapsed-session untested — Verified gaps in the suites. Fix applied: all three cases added.
  - `[low]` `[reject]` registry/service clock skew can early-deny valid tokens — Fail-closed by design with a 60s issuance leeway; everyday NTP-synced use unaffected and denial carries no content.
  - `[low]` `[reject]` dotted keyIds unrepresentable in the token format — Key ids are operator-controlled under the existing `registry-key-YYYY-MM` convention; no new surface needed.
  - `[low]` `[reject]` panel accepts hex-form retention (`0x1E`) client-side — The registry range-checks the numeric value, so only in-range values persist; harmless.
  - `[low]` `[reject]` read endpoint lists are unbounded — Pilot scale with the 90-day bound; pagination deliberately out of scope per the 4.5 precedent and recorded as residual risk.
  - `[low]` `[reject]` outstanding tokens survive grant revocation up to 5 minutes — The documented bound of the stateless design, chosen so Company reads work during panel outages; new mints reflect revocation immediately.
  - `[false]` `[reject]` concurrent Buyer POSTs could collide per-tenant sequences — Refuted: `lockBundle`'s advisory lock serializes writers (same as build-grants), so max+1 is safe; a same-state race only appends nothing.
  - `[false]` `[reject]` service cannot tell ungranted-role tokens — Refuted: the registry refuses to mint for ungranted roles (403 pinned in db, fake and panel suites); the service trusts the registry signature by design.
  - `[low]` `[reject]` Company-deployment threading of the new env (trust keys, tenant credential) unexercised — Misprovisioning fails closed and loud (missing_configuration or total denial); staging boot plus one minted-token read settles it.

## Auto Run Result

- Summary: story 6.7 gives the Buyer control over Guidance-record access and lifetime. `packages/contract` gains the Guidance-access vocabulary (paths, grantable roles, 5-minute TTL, 1..3650-day retention bounds, signed token payload codec) plus a no-prompt-text scan pinning the Compilation catalog. `apps/registry` gains migration 0016 (append-only grant/retention change tables, RLS/FORCE, SELECT+INSERT-only), Buyer-only grant/retention writes with idempotent POSTs, Ed25519 role-token minting for granted roles with the bundle signer, and a credential-authed retention read for the service sweep. `apps/service` gains offline token verification, the token-gated `GET /v1/guidance-events` read with application/gaps filters, store deletion on both twins, the authenticated retention fetch with 90-day fallback, and the daily sweep wired into the guidance server (catch-up plus tick), plus three new env vars. `apps/panel` gains the `/guidance-access` surface (grant checkboxes, retention input with current value, own-role token mint shown once) that never fetches the service endpoint or renders Guidance content. No bundle, catalog, collector, or Effective-set changes.
- Files:
  - `packages/contract/src/guidance-access.ts` (NEW) + `guidance-access.test.ts` (NEW) + `index.ts` — vocabulary, guards, codec, catalog scan.
  - `apps/registry/migrations/0016_guidance_access.sql` (NEW) + `db/schema.ts` (`TENANT_TABLES`) — tables, RLS, grants.
  - `apps/registry/src/guidance-access/validate.ts`, `service.ts`, `index.ts` (NEW) + `src/index.ts` — validator, get/set/mint/retention operations.
  - `apps/registry/src/guidance-access/guidance-access.db.test.ts` (NEW, 16 tests) + `http/server.ts`, `serve-cli.ts`, `server.test.ts` (FakeGuidanceAccess/FakeBundleCredential + 15 route tests) — routes and matrix coverage.
  - 14 existing registry db suites + `tenancy.db.test.ts` (0016 pins, 26-table RLS/grant lists) — wiring and tenancy coverage.
  - `apps/service/migrations/0005_guidance_events_retention_idx.sql` (NEW) — sweep index.
  - `apps/service/src/guidance/events.ts` + `events.db.test.ts` (boundary deletion, index pin) — delete on both twins.
  - `apps/service/src/guidance/role-tokens.ts` (NEW) + `role-tokens.test.ts` (NEW) — offline verification incl. skew bound.
  - `apps/service/src/guidance/events-read.ts` (NEW) + `events-read.http.test.ts` (NEW) — token-gated read, filters, denial matrix.
  - `apps/service/src/guidance/retention.ts` (NEW) + `retention.test.ts` (NEW) — sweep math, never-throw fetch.
  - `apps/service/src/guidance/server-cli.ts`, `config.ts` (+ tests), `src/index.ts` — dispatch, scheduler, new env, barrels; `server-cli.test.ts` gains the deployed token read plus two sweep suites.
  - `apps/panel/src/routes/guidance-access.tsx` (NEW) + `guidance-access.test.tsx` (NEW, 13 tests) + `registry.server.ts`, nav, routes, exact-list tests — surface without content.
  - `README.md` — Guidance access paragraph under `## Guidance records`.
  - `_bmad-output/implementation-artifacts/spec-6-7-buyer-controls-who-reads-guidance-records-and-how-long-they-are-kept.md` — this spec (status done).
- Findings breakdown: 12 findings — 4 patched across 4 entries (1 medium: sweep scheduler wiring; 3 low: issuance-skew bound, tenant-B scoping, boundary/filter/lapse tests), 0 deferred, 8 rejected (2 false with refuting evidence — advisory-lock serialization, mint-time grant enforcement; 6 low — skew fail-closed, key-id convention, hex acceptance, unbounded lists, 5-minute revocation bound, deployment threading).
- Follow-up review recommendation: false — first pass with no patched high and one patched medium.
- Verification: `pnpm install --frozen-lockfile` clean; `pnpm -r run build` exit 0; `pnpm -r run typecheck` exit 0; `pnpm -r run lint` exit 0 (max-warnings 0); `pnpm run boundaries` no violations; per-package `pnpm test` with both DB URLs on postgres 18 — contract 383, collector 40, cli 93, boundaries-self 20, extractor 16, core 95, gate 15, mcp-bridge 11, panel 449 passed + 1 pre-existing skip, registry 876, service 235 (full-parallel green on the final tree; one CLI singleton failure and the established timing-sensitive trio each passed on immediate retry, confirming the known parallelism flake). Matrix audit: all 17 spec I/O rows covered by named tests that ran and passed (db suite 16 incl. RLS/grants/append-only/isolation/mint-reflects-grant/per-tenant retention; contract codec+bounds+scan; service verify/read/sweep/fetch suites incl. deployed Postgres read-through and both sweep branches; panel surface suite 13 incl. the no-service-fetch scan).
- Residual risks: (1) unbounded read lists (no pagination) — pilot scale with the 90-day bound; revisit if event volume grows. (2) 5-minute revocation bound on outstanding tokens — documented and inherent to offline verification. (3) Registry/service clock skew beyond 60s denies valid tokens fail-closed — NTP-assumed. (4) Staging must still prove the Company deployment threading of `SERVICE_ROLE_TOKEN_TRUST_KEYS`/`SERVICE_TENANT_CREDENTIAL` against the real registry key/credential.
- Workflow deviation: step-03/04 mandate subagent dispatch, but this worker has no subagent tool, so implementation and the four review layers were executed inline; the triage above records the adapted single-pass review verbatim.

## Verification

**Commands:**
- `pnpm install --frozen-lockfile` -- expected: clean
- `pnpm -r run build` -- expected: exit 0
- `pnpm -r run typecheck` -- expected: exit 0
- `pnpm -r run lint` -- expected: exit 0
- `pnpm --filter @domain-harness/contract test` -- expected: guidance-access suite green, no semver-bump triggered
- `REGISTRY_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres pnpm --filter @domain-harness/registry test` -- expected: guidance-access db suite green (needs PostgreSQL 18 on localhost:5432)
- `SERVICE_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres pnpm --filter @domain-harness/service test` -- expected: role-token/read/sweep suites green
- `pnpm --filter @domain-harness/panel test` -- expected: guidance-access surface suite green
