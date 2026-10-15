---
title: 'Story 4.6: Read the Effective Standard set through the Read API'
type: 'feature'
created: '2026-10-15'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
baseline_commit: '7f06576adb85499abfe4eecfdffe441e09710409'
context:
  - _bmad-output/implementation-artifacts/epic-4-context.md
  - _bmad-output/implementation-artifacts/spec-4-5-record-guidance-events-and-gaps-in-the-company-store.md
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** Tools that never run the Gate have no trusted way to read the Company's Standards: Guidance serves answers per call over MCP but exposes no read surface, so a Company system cannot fetch the published Standards or a Project's Effective Standard set from the same source of truth.

**Approach:** Serve a credentialed, read-only HTTP Read API from the Company service that answers from the pinned active bundle through the same core resolution Guidance uses (shared derivation, never a second resolver), quoting the bundle hash on every response; missing/invalid credentials are refused with the error envelope, and no write path exists on any Read API route.

## Boundaries & Constraints

**Always:**
- NEW `contract` module `packages/contract/src/read-api.ts` versions the surface: `READ_API_PATHS = { standards: "/v1/standards" }` plus reuse of `effectiveStandardsPath(projectId)` (`/v1/projects/{id}/effective-standards`, same spelling as the registry — same truth, different host); `ReadStandardsResponse { bundleHash, standards: StandardInfo[] }` and `ReadEffectiveSetResponse { bundleHash, project, standards }` (the `{project, standards}` half is the `EffectiveStandardSet` shape) with exact-key never-throw guards composing `isBundleHash` (64-hex, `guidance-tools.ts` precedent) and `isEffectiveStandard`/`isStandardInfo`; exported from the barrel in house style.
- One shared derivation `apps/service/src/read/effective.ts` (NEW): `effectiveSetInputOf(payload, projectId)` (holders via core `entrySlot` at `standard.project.id`, tree from `payload.tree.projects`, locked ids deduped by `standardId` in payload order — the `serve.ts` derivation verbatim) plus `joinEffectiveSet(payload, projectId)` (core `resolveEffectiveSet`, then the registry `resolveEffectiveStandards` join verbatim: `standard` = live `StandardInfo`, `sourceProject` = `{id, name}` from the payload tree, `status` null for components, `locked` from the entry; core order never re-sorted). `serve.ts` imports it (its private copy is removed) so Guidance and the Read API resolve through one function by construction.
- `GET /v1/standards` (credentialed) answers 200 with the pinned bundle's `standards` array plus its hash. `GET /v1/projects/{id}/effective-standards` (credentialed) answers 200 with `joinEffectiveSet` of the pinned bundle plus its hash; the quoted hash is the active-pointer hash and the payload is that hash's row, so hash and set are consistent by construction.
- Credential check runs before anything is parsed (registry compilations-route precedent): `Authorization: Bearer <SERVICE_READ_CREDENTIAL>` (scheme case-insensitive, registry `bearerToken` precedent), constant-time compare (`timingSafeEqual`, registry `authenticateCredential` precedent), single tenant from `SERVICE_TENANT_ID`. Missing, malformed or wrong credentials all answer 401 with one indistinguishable envelope `{ code: "session_invalid", message, subject: "session" }` (registry `credentialInvalid` verbatim). The secret comes from required env `SERVICE_READ_CREDENTIAL` threaded through `GuidanceServiceConfig`; a missing/blank value fails start with `missing_configuration` (house pattern) and is never logged.
- Check order per read route: credential (401) → bundle presence (404 `not_found`, subject `bundle`, registry `BUNDLE_LATEST_ROUTE` precedent) → payload guard (500 `bundle_unreadable`, subject `bundle`) → project/core (unknown or malformed id → 404 `project_not_found` subject `projectId`; core's error as is, e.g. 409 `slot_conflict`; a resolved Standard/source missing from the payload → 500 `bundle_unreadable`). Method check is orthogonal: any POST/PUT/PATCH/DELETE to a Read API path answers 405 `method_not_allowed` (MCP-layer precedent) and the router holds no write handler for any Read API path.
- Mounted in `createGuidanceHttpServer` (AD-2, one service): `/mcp` unchanged and unauthenticated; read routes credentialed; every other path keeps the existing 404. Per-request log lines stay ids/codes-only with read route labels; no subject text, no credential, no Standard content in logs.

**Never:**
- No second resolver and no re-sorting/filtering of core's order; no registry, panel, bridge, boilerplate, bundle-format, migration, compose/Dockerfile, or Collector/Compilation changes (the guidance server is not composed — 4.4/4.5 precedent — so no deployment wiring).
- No stale flag and no age propagation on Read responses (service-side age propagation is later-epic work per the epic context; Guidance's stale behavior is untouched).
- No per-Application binding on reads (reads are Project-scoped, not identity-scoped); no event/gap recording on reads; no retention surface (6.7).
- No session/token minting: one opaque shared secret from the environment, not the registry's session or tenant-credential scheme.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Effective set read | credential + project P, active bundle | 200 `{ bundleHash, project, standards }`, set equals Guidance's resolution for an app on P, hash quoted | No error expected |
| Published standards read | credential, active bundle | 200 `{ bundleHash, standards }` = bundle's standards array | No error expected |
| Guidance parity | bound app on P, same pinned bundle | every Guidance `hit` standard is in the read set for P; full-set equality with the shared derivation | Test failure if diverged |
| Missing credential | no Authorization header | 401 `session_invalid` envelope | Envelope only |
| Malformed credential | non-Bearer / blank token | 401 `session_invalid`, same bytes as missing | Indistinguishable |
| Wrong credential | Bearer wrong-secret | 401 `session_invalid`, same bytes as missing | Indistinguishable, timing-safe compare |
| Write refused | POST/PUT/PATCH/DELETE on either read path | 405 `method_not_allowed`; router has no write handler | Nothing written |
| Unknown project | credential + unknown UUID | 404 `project_not_found`, subject `projectId` | Envelope only |
| Malformed project id | credential + non-UUID segment | 404 `project_not_found`, subject `projectId` | Envelope only |
| No active bundle | credential, no pointer/row | 404 `not_found`, subject `bundle` | Envelope only |
| Invalid stored payload | credential, guard fails | 500 `bundle_unreadable`, subject `bundle` | Envelope only |
| Slot conflict in bundle | credential + P, conflicting scopes | core's 409 `slot_conflict` as is | Envelope only |
| Unmatched path | any other path | existing 404 (MCP surface unchanged) | Envelope only |

</intent-contract>

## Code Map

- `apps/service/src/guidance/server-cli.ts:95-142` -- MOUNT POINT: `createGuidanceHttpServer` builds bundle/identity/event stores over one pool (L96-110) and routes `GUIDANCE_MCP_PATH` vs `notFound` (L112-141). Add the read router + credential gate here; `pinnedActiveBundle` (L78-87) is the payload source; `respondEnvelope`/`notFound` (L144-162) are the response precedents.
- `apps/service/src/guidance/serve.ts:284-298` -- MOVE SOURCE: private `effectiveSetInputOf` moves verbatim into the shared module; `decide` (L138-231) keeps matching/recording, importing the shared derivation. Join precedent: `standardsById` (L196).
- `apps/registry/src/projects/service.ts:204-242` -- JOIN PRECEDENT: `resolveEffectiveStandards` (holders L213-218, core call L219-225, join L227-241, status-null-for-component L235). Adapted to payload inputs in the shared module.
- `packages/core/src/resolve.ts:71` -- `resolveEffectiveSet`; `packages/core/src/slots.ts:70` -- `entrySlot` (slot derivation both surfaces share).
- `packages/contract/src/effective.ts:28-51` -- `EffectiveStandard`/`EffectiveStandardSet` + `effectiveStandardsPath` (path spelling reused); guards L67-88. `packages/contract/src/guidance-tools.ts:183-194` -- subject/hash field-rule precedent. Barrel: `packages/contract/src/index.ts:119-120` effective exports; service barrel `apps/service/src/index.ts` unit sections (add a `// Story 4.6` section).
- `apps/registry/src/bundles/service.ts:89-94,180-201` -- AUTH PRECEDENT: `credentialInvalid` (401 `session_invalid`) + `timingSafeEqual` compare. `apps/registry/src/http/server.ts:591-608` -- no-bundle precedent (404 `not_found`/`bundle`); `STATUS_BY_CODE` precedent: `session_invalid`→401, `project_not_found`→404, `slot_conflict`→409 (the service pins these codes directly in the read handler, MCP-style — no registry change).
- `apps/service/src/guidance/mcp.ts:36-37,79-86,200-208` -- `GUIDANCE_MCP_PATH`, 405 `method_not_allowed` precedent, `respondEnvelope` (reuse, not a copy).
- `apps/service/src/guidance/config.ts:28-85` -- add `readCredential` to `GuidanceServiceConfig` + required `SERVICE_READ_CREDENTIAL` read (checked after `recordDatabaseUrl`, before optional `port`).
- `apps/service/src/guidance/mcp.http.test.ts:64-130` -- TEST HARNESS: `payloadOf` bundle fixture + in-process `node:http` server behind the real handler; mirror for `apps/service/src/read/read.http.test.ts` (InMemory twins, `fetch`, no DB).
- `apps/service/src/guidance/server-cli.test.ts:38-80` -- `entryEnv` + spawn-style start-failure pins; `entryEnv` gains `SERVICE_READ_CREDENTIAL` and a missing-credential pin. Deployed-wiring precedent (4.5 patch): throwaway-DB suite through `createGuidanceHttpServer`.
- `README.md` -- after `## Guidance records` (L429 area): new `## Company Read API` section (endpoints, credential env, hash quote, Guidance-parity, refusal table), same documentation pattern as the Effective-Standard-set table.

## Tasks & Acceptance

**Execution:**
- `packages/contract/src/read-api.ts` (+ `read-api.test.ts`, NEW) -- paths, `ReadStandardsResponse`/`ReadEffectiveSetResponse` types, exact-key never-throw guards, new error codes if any; barrel export. Tests pin round-trip, extra-key rejection, 64-hex hash rule.
- `apps/service/src/read/effective.ts` (NEW, + unit `effective.test.ts`) -- shared `effectiveSetInputOf` + `joinEffectiveSet`; unit pins equality with the registry join shape on a fixture payload (locked winner, component null-status, core order) plus core-error passthrough.
- `apps/service/src/guidance/serve.ts` -- delete the private `effectiveSetInputOf`, import the shared one; no behavior change (`serve.test.ts` untouched and green).
- `apps/service/src/read/server.ts` (NEW, + `read.http.test.ts`) -- credential gate + the two GET handlers + 405-on-write + error mapping per the Always order; full matrix pinned over `fetch` against the in-process server (InMemory twins), including the Guidance-parity test (bound app `hit` ∈ read set; full-set equality with the shared derivation).
- `apps/service/src/guidance/server-cli.ts` (+ `server-cli.test.ts`) -- mount read routes in `createGuidanceHttpServer`, thread `readCredential`; `entryEnv` gains the credential, missing-credential start-failure pin, throwaway-DB suite proving a credentialed GET returns 200 with the active hash quoted (covers threading, 4.5-patch style).
- `apps/service/src/guidance/config.ts` (+ `config.test.ts`) -- `readCredential` field + env read + failure pins.
- `apps/service/src/index.ts` -- `// Story 4.6` barrel section for the read unit.
- `README.md` -- `## Company Read API` section per the Code Map.

**Acceptance Criteria:**
- Given valid credentials, when the system GETs the Effective Standard set for Project P, then the 200 response equals what Guidance would resolve for an Application on P against the same pinned bundle hash, and quotes that hash.
- Given valid credentials, when the system GETs the published Standards, then the 200 response carries the bundle's standards plus the bundle hash.
- Given missing or invalid credentials, when any Read API request is made, then it is refused 401 with the error envelope.
- Given a write method (POST, PUT, PATCH, DELETE) sent to any Read API path, when it arrives, then it is refused 405 and no write handler exists for that path in the router.
- Given an unknown or malformed Project id, when it is read, then the answer is 404 `project_not_found`; given no active bundle, 404 `not_found` subject `bundle`.
- Given `pnpm test`, `pnpm run boundaries`, `pnpm run build`, `pnpm run typecheck`, `pnpm run lint`, when they run (DB suite against PostgreSQL 18), then all pass with zero warnings and every matrix row is pinned by a named test that actually ran.

## Spec Change Log

## Review Triage Log

### 2026-10-15 — Review pass (four layers: blind-hunter 12, edge-case-hunter 4, verification-gap 1, intent-alignment 0)
- verdicts: 17 findings — high 0, medium 1, low 6, false 10, maybe-false 0
- findings:
  - `[low]` `[patch]` blank read credential unpinned (blind) — Verified: `required()` already rejects blanks, but only removal was tested. Fix applied: empty/whitespace cases asserting `missing_configuration` naming `SERVICE_READ_CREDENTIAL` (test-only).
  - `[false]` `[reject]` length-short-circuit leaks secret length (blind) — Refuted: distinguishing skipped-compare timing over HTTP is infeasible, length alone yields no oracle (equal lengths still go through `timingSafeEqual`), and the construction is the spec-mandated verbatim precedent.
  - `[false]` `[reject]` unreachable project-missing `bundle_unreadable` branch (blind) — Verified unreachable via the same payload (core reports first), but kept as defense against future core drift; no bad outcome.
  - `[low]` `[reject]` outer catch logs without responding (blind) — Verified pre-existing 4.4 pattern shared with the MCP path; the read handler answers all its known failure modes, and a 500-fallback would invent unsettled semantics for by-definition unexpected throws.
  - `[false]` `[reject]` error bodies cacheable by intermediaries (blind) — Refuted: every envelope path goes through `respondEnvelope`, which sets `Cache-Control: no-store` alongside the 200s; the premise is wrong.
  - `[low]` `[reject]` 405 subject echoes the path (blind) — Verified caller-supplied echo with no leak; the fixed-subject vocabulary for 405 is spec-unsettled and the test pins the code.
  - `[false]` `[reject]` percent-encoded paths fall to generic 404 (blind) — Verified consistent with the specified unmatched-path 404 at the same status; no access or information difference.
  - `[false]` `[reject]` query-string and trailing-slash paths unpinned (blind) — Verified 404 via the unmatched-path row, which covers "any other path"; no bad outcome.
  - `[low]` `[reject]` HEAD/OPTIONS answered as writes (blind) — Verified 405 fail-closed preserved; no CORS or bandwidth scope exists, and the HEAD-body nuance has no consumer impact.
  - `[low]` `[patch]` parity test double-signs with fresh keys (blind) — Verified the acknowledged weakening. Fix applied: one shared signed bundle across the Guidance call and the read fixture with the SAME hash asserted on both sides (test-only).
  - `[low]` `[patch]` `project_cycle`/`locked_rule_conflict` mappings untested (blind) — Verified `project_cycle` is live (the bundle guard passes cycles, core reports them) while `locked_rule_conflict` is unreachable in the read path. Fix applied: HTTP 409 `project_cycle` case with a cyclic-tree bundle (test-only); the dead mapping left untouched.
  - `[false]` `[reject]` empty project name accepted (blind) — Refuted: `ProjectRef` IS the shared shape (StandardInfo uses it too), so no stricter precedent exists; responses echo stored tree names with zero runtime effect.
  - `[false]` `[reject]` duplicate project ids answer 400 (edge-case) — Verified, but spec-compliant: the spec mandates "core's error as is", and the 500 row covers guard failures, which this isn't.
  - `[false]` `[reject]` dangling parent normalized to unknown-project (edge-case) — Verified, but follows the spec's project/core mapping rule verbatim; corrupt trees are un-storable through validated registry writes and fail closed at 404 either way.
  - `[false]` `[reject]` duplicate standard ids silently served (edge-case) — Verified mechanism, but Standard ids are unique by construction and un-storable duplicated through validated writes; dup-rejection would be spec-unsettled validation.
  - `[false]` `[reject]` encoded paths skip the credential check (edge-case) — Verified, but only public route spellings are distinguishable and nothing is served unauthenticated; consistent with unmatched-path handling.
  - `[medium]` `[patch]` store-transport failure unpinned (verification-gap) — Pre-verified gap accepted as filed: a throwing `getPinnedBundle` had no Read-path test, risking hang or wrong code on DB outage. Fix applied: rejecting-store case asserting 500 `bundle_unreadable` on both read routes.
- Note: the first intent-alignment pass ran against a corrupted prompt (4.5 criteria pasted under the 4.6 title) and was discarded; the rerun with the true epics.md intent reports the maximal HTTP-specific reading implemented with no prescriptive findings — parity-via-shared-derivation is the spec's own construction, and the double-sign observation duplicates the patched parity row above.

## Auto Run Result

- Summary: story 4.6 serves a credentialed, read-only Company Read API from the guidance server. `GET /v1/standards` returns the pinned bundle's standards and `GET /v1/projects/{id}/effective-standards` returns the Project's Effective set, both quoting the active-pointer hash, both resolved through the new shared derivation (`effectiveSetInputOf` + `joinEffectiveSet`) that `serveGuidanceCall` also adopts, so Guidance-read parity holds by construction. Credentials are the required `SERVICE_READ_CREDENTIAL` env secret (Bearer, case-insensitive, constant-time, one indistinguishable 401 `session_invalid`); check order is credential → bundle 404 → payload 500 → project/core with core errors as is; any write method answers 405 with `Allow: GET` and no write handler exists in the router. Per-request logs stay ids/codes-only with read route labels.
- Files:
  - `packages/contract/src/read-api.ts` (NEW) + `read-api.test.ts` (NEW) + `index.ts` — paths, response shapes, 64-hex hash rule, `BUNDLE_UNREADABLE`.
  - `apps/service/src/read/effective.ts` (NEW) + `effective.test.ts` (NEW) — shared derivation moved verbatim from serve.ts plus the registry join verbatim.
  - `apps/service/src/read/server.ts` (NEW) + `read.http.test.ts` (NEW) — credential gate, two GET handlers, 405/error mapping, full matrix incl. Guidance parity; review patches: single-signed parity, 409 cycle case, transport-failure case.
  - `apps/service/src/guidance/serve.ts` — private derivation removed, shared import (no behavior change).
  - `apps/service/src/guidance/server-cli.ts` + `server-cli.test.ts` — read-route mounting, credential threading, missing-credential pin, throwaway-DB threaded GET.
  - `apps/service/src/guidance/config.ts` + `config.test.ts` — `readCredential` env read; review patch: blank-value pins.
  - `apps/service/src/index.ts` — `// Story 4.6` barrel section.
  - `README.md` — `## Company Read API` section.
  - `_bmad-output/implementation-artifacts/spec-4-6-read-the-effective-standard-set-through-the-read-api.md` — this spec (status done).
- Findings breakdown: 17 findings — 4 patched (1 medium: transport-failure 500 pin; 3 low: blank-credential pin, single-signed parity, cycle-409 pin), 0 deferred, 13 rejected (10 false with refuting evidence — verbatim timing-safe construction, no-store on all envelopes, ProjectRef shared shape, core-error-as-is compliance, unmatched-path consistency, un-storable corrupt trees; 3 low — shared catch pattern, 405 subject echo, HEAD/OPTIONS handling).
- Follow-up review recommendation: false — first pass with no patched high and one patched medium.
- Verification: `pnpm install --frozen-lockfile` clean; `pnpm -r run build` exit 0; `pnpm -r run typecheck` exit 0; `pnpm -r run lint` exit 0; `pnpm run boundaries` no violations; per-package `pnpm test` with both DB URLs on postgres 18 — contract 372, collector 1, cli 45, boundaries-self 17, extractor 16, core 95, gate 15, mcp-bridge 11, panel 436 passed + 1 pre-existing skip, registry 847, service 212 (2067 passed total, 0 failed; sequential isolation runs after re-verification). Matrix audit: all 13 spec I/O rows covered by named tests that ran and passed (read HTTP suite incl. parity/401/405/404/500/409 rows, effective unit suite, config suite, server-cli threading suite).
- Residual risks: (1) production topology/latency unmeasured (same standing caveat as 4.5). (2) Method checked before credential (orthogonal per MCP precedent — POST without credential answers 405, not 401; spec-disclosed judgment call). (3) `locked_rule_conflict` mapping unreachable in the read path (dead defensive config mirroring the registry table). (4) Corrupt stored bundles (dup ids, dangling parents, cycles) report core's codes as-is rather than `bundle_unreadable` — spec-compliant, fail-closed, un-storable through validated writes.

## Verification

**Commands:**
- `pnpm test` -- expected: new contract read-api + shared-effective unit + read HTTP matrix (incl. Guidance-parity) + config + server-cli (incl. throwaway-DB threading) suites pass; serve/mcp suites green unchanged.
- `pnpm run boundaries` -- expected: no violations (service still imports only core/contract/gate + intra-app; contract-internal guard reuse).
- `pnpm run build` / `pnpm run typecheck` / `pnpm run lint` -- expected: clean, zero warnings.

**Manual checks (if no CLI):**
- `README.md` documents the two endpoints, `SERVICE_READ_CREDENTIAL`, the hash quote, the Guidance-parity claim, and the refusal table.
- Router holds exactly two GET read routes (credentialed) plus `/mcp`; no POST/PUT/PATCH/DELETE handler references a Read API path.
