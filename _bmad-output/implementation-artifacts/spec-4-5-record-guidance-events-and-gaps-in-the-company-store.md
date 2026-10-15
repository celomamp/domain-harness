---
title: 'Story 4.5: Record Guidance events and gaps in the Company store'
type: 'feature'
created: '2026-10-15'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
baseline_commit: 'feb73b6f385a125fa58d1e59335aeaa3d6c99054'
context:
  - _bmad-output/implementation-artifacts/epic-4-context.md
  - _bmad-output/implementation-artifacts/spec-4-4-serve-document-response-through-the-four-mcp-tools.md
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** The Company service answers every Guidance tool call (4.4) but remembers nothing: each `hit`/`miss` evaporates, so a Standard owner learns about gaps only if an agent chooses to report them.

**Approach:** Version the Guidance event shape in `packages/contract`; persist every bound tool outcome service-side in a new append-only Company-store table with a per-Application sequence assigned by the record store; carry the agent tool name in the bundle's application entries so the service can record it; misses are the gap records (one table, miss projection — no second write).

## Boundaries & Constraints

**Always:**
- A NEW `contract` module versions the event: `GuidanceEvent` carries exactly `id`, `applicationId`, `sequence` (per-Application, store-assigned), `tool`, `subject` (as asked), outcome (`hit` with `standardId` + `version`, or `miss`), `agentTool` (`BoilerplateTarget` or `null`), `bundleHash`, `createdAt` (UTC ISO-8601), plus an `isGuidanceEvent` guard mirroring the 4.4 field rules (subject 1..1000 code points, 64-hex `bundleHash`, non-empty `standardId`, integer `version` >= 1) and `GUIDANCE_EVENT_RETENTION_DAYS = 90` (the default lifetime; scheduled enforcement is 6.7).
- `BundleApplication` gains `agentTool: BoilerplateTarget | null`, filled by the registry compile from `currentAgentTools` (`null` when the Application never generated a Boilerplate). The guard stays backward compatible: a missing key is accepted (reads as `null`, so pre-4.5 stored bundles keep serving through `bundledState`'s exact-guard check); any other unknown key is still rejected. Format version stays 1 (additive nullable field, same-repo atomic update).
- Migration `0004_guidance_events.sql` creates append-only `guidance_events` (`id` pk, `application_id`, `sequence`, `UNIQUE(application_id, sequence)`, `tool`, `subject`, `outcome`, nullable `standard_id`/`standard_version`, nullable `agent_tool`, `bundle_hash`, `created_at default now()`) with an index on `application_id`. No prompt-text column exists anywhere.
- Recording rides on the serving unit: `serveGuidanceCall` takes a required `GuidanceEventStore` (InMemory + Postgres twins, house pattern) and, on the bound path only (`hit`/`miss`), appends one event after the decision, awaited but never throwing — a record failure returns the already-computed typed result unchanged and fires an optional ids-only `onRecordError` hook (default no-op; the entry wires it to the stdout logger with application id + tool, never subject text).
- Only bound outcomes produce event rows. `unbound`/`refused`/unavailable calls record nothing here: unknown or missing Application ids have no attributable row, and copied fingerprints are already ledgered as binding refusals by 4.3. The agent tool name comes ONLY from the pinned bundle's application entry — never from headers or client claims.
- A `miss` row IS the gap: no second table, no dual write; `listGuidanceGaps(applicationId)` reads the miss projection (service-side persistence, never agent-reported).
- Per-Application sequence is `max + 1` under `pg_advisory_xact_lock` on the Application id (the `gate_runs` pattern); the InMemory twin mirrors it.
- Privacy (NFR-9): the record holds the asked subject term only — never raw prompt text; every log/metric event carries ids and counts, never subject text.

**Never:**
- No read HTTP surface for events/gaps (6.7); no retention scheduler, setting, or role-grant surface (6.7 owns configurability and scheduled deletion; `created_at` is this story's only hook).
- No Collector, Compilation, panel, or registry-API changes (Epic 6); no bridge, boilerplate, or identification-file changes.
- No bundle rebuild on Boilerplate generation (pinned 4.1/3.x behavior): an Application's freshly generated tool appears in records only after the next bundle — records carry the tool known to the PINNED bundle, `null` before that.
- No format-major bump; no second resolver (core is untouched); no recording failure ever changes the typed answer; no Read API (4.6).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Bound hit | bound app, subject matches | typed `hit` (4.4 shape, unchanged) + one event row with all FR-20 fields, per-app sequence | Never throws |
| Bound miss | bound app, no match | typed `miss` + one event row; the row is listed by `listGuidanceGaps` against app, tool, subject | Never throws |
| Service-side persistence | plain MCP tool call, no agent cooperation | record exists after the call; no agent-controlled path skips it | Never throws |
| Copied fingerprint | bound id, wrong fingerprint | `unbound` refusal, refusal ledger row (4.3); NO event row | Never throws |
| Unbound caller | no commit / missing file / unknown id | `unbound` fixed sentence; NO event row | Never throws |
| Record failure | event insert throws | typed `hit`/`miss` still returned unchanged; ids-only error hook fires | Never throws |
| Old-shape bundle | payload application entry without `agentTool` | bundle still guards valid, serves, and records with `agentTool: null` | Never throws |
| Concurrent calls | N parallel bound calls, one app | N rows, distinct sequences max+1, no duplicates | Advisory-lock serialization |
| Per-app sequencing | apps A (2 rows) and B (0 rows) | next A row is sequence 3; first B row is sequence 1 | No error expected |
| Privacy | distinctive subject recorded | subject appears in the row and NOWHERE else: schema has no prompt column, captured log/metric sinks carry only ids/codes | Test failure if leaked |

</intent-contract>

## Code Map

- `apps/service/src/guidance/serve.ts` -- RECORDING HOOK: `serveGuidanceCall` (L112, never-throw catch L114-118) + `decide` (L120: identity → staleness → core → hit/miss). Append the event after `decide` yields `hit`/`miss`, inside the never-throw boundary; the bound `applicationId` comes from the identity step, `agentTool` from the pinned payload entry.
- `apps/service/src/guidance/store.ts` -- TWIN PATTERN: `GuidanceIdentityStore` + InMemory/Postgres twins sharing tables (L56-67, L160-302); `mintUuidV7` from `../ci-gate/ids.ts` (L14). New `events.ts` mirrors this file; Postgres per-app sequence mirrors `apps/service/src/ci-gate/store.ts` `appendGateRun` advisory-lock + max+1 (L244-293).
- `apps/service/src/guidance/mcp.ts` -- PASS-THROUGH: `GuidanceMcpDeps` (L42-52) gains the event store (+ error hook); `toolCallResult` (L129) forwards into `serveGuidanceCall` (L154-163). No schema/header change.
- `apps/service/src/guidance/server-cli.ts` -- WIRING: `createGuidanceHttpServer` builds bundle + identity stores over one pool (L92-100); add the Postgres event store the same way and wire `onRecordError` to `stdoutLogger` (L38-40, ids/codes-only `LogEvent`); `pinnedActiveBundle` (L75-84) is the payload source for `agentTool`.
- `apps/service/src/bundles/puller.ts` -- BACKWARD-COMPAT READER: `bundledState` re-guards the STORED payload with `isStandardBundlePayload` (L195); the new guard must accept stored pre-4.5 payloads (missing `agentTool` key).
- `apps/service/src/bundles/verify.ts` -- `isSignedStandardBundle` exact-keys (L96) rejects unknown keys: registry + service ship together, no mixed-version wire to guard.
- `packages/contract/src/bundles.ts` -- `BundleApplication` (L28-33, keys L78, guard L96-106) gains `agentTool`; `BoilerplateTarget` + `isBoilerplateTarget` live in `packages/contract/src/boilerplate.ts` (L37-41). Note the blessed applications↔boilerplate import cycle (dependency-cruiser `no-circular` exception) — `bundles.ts` must import the target type/guard from `boilerplate.ts` without widening the cycle (call-time use only, same as the blessed pair).
- `packages/contract/src/guidance-tools.ts` -- field-rule precedent: `isGuidanceToolSubject` code-point count (L183-189), `isBundleHash` 64-hex (L192-194), `isGuidanceToolResult` (L200-234). The new event guard mirrors these.
- `packages/contract/src/index.ts` -- barrel: bundles exports (L233-250), guidance-tools exports (L256-273); add the new module in the same style.
- `apps/registry/src/bundles/compile.ts` -- FILL POINT: `applicationsPayload` (L170-176) maps registry rows; `currentAgentTools(tx, tenantId)` from `../applications/agent-tool.ts` (L25-35, one query, latest-sequence per app) supplies the map — same-tx read, no import cycle (agent-tool.ts imports only contract/schema/ids/client).
- `apps/service/src/guidance/serve.test.ts` -- fixture `setup`/`call` (L152-175) and `payloadOf` default applications (L134); `mcp.http.test.ts` deps (L102-108) + `payloadOf` (L86); `perf.test.ts` shared inputs (L107-121) + applications (L88); `identity.test.ts` helper (L30, L48) — all construct `{ id, projectId, fromFlow }` literals that gain `agentTool`.
- `apps/service/migrations/0001_ci_gate.sql` -- `gate_runs` sequence pattern (`unique (application_id, sequence)`, L19) reused for `guidance_events`; `apps/service/migrations/0003_guidance_identity.sql` -- migration style precedent (plain, snake_case, append-only ledger + index).
- `apps/service/src/guidance/guidance.db.test.ts` -- asserts migration list (L65-69) and full table list (L82-99): both gain the 0004 entry/entries.
- `apps/registry/src/bundles/bundles.db.test.ts` -- exact-match pins on compiled application entries (L601-610) gain `agentTool`; generation-not-rebuilding pin (L671-672) stays untouched.
- `packages/contract/src/bundles.test.ts` -- `validApplication` (L65-69), exact-key rejection pins (L135-136), payload-shape rewrite (L215-216) gain `agentTool` cases + a missing-key-accepted pin.
- `README.md` -- `## Guidance tools` (L429, after `## Guidance identity` L393): new `## Guidance records` section follows the same documentation pattern.

## Tasks & Acceptance

**Execution:**
- `packages/contract/src/guidance-events.ts` -- NEW: `GuidanceEvent` type (id, applicationId, sequence, tool, subject, outcome hit{standardId, version} | miss, agentTool null|target, bundleHash, createdAt), `isGuidanceEvent` guard, `GUIDANCE_EVENT_RETENTION_DAYS = 90`, test file alongside; exported from `packages/contract/src/index.ts`.
- `packages/contract/src/bundles.ts` (+ `bundles.test.ts`) -- `BundleApplication` gains `agentTool: BoilerplateTarget | null`; guard accepts a MISSING key (reads null) while still rejecting other unknown keys; tests pin new-shape round-trip, old-shape (missing key) acceptance, and still-rejected extras.
- `apps/registry/src/bundles/compile.ts` (+ `bundles.db.test.ts`) -- compile fills `agentTool` from `currentAgentTools(tx, tenantId)` (`?? null`); db test pins an app with a generated boilerplate carrying its target and an app without one carrying `null`; generation-still-does-not-rebuild pin unchanged.
- `apps/service/migrations/0004_guidance_events.sql` -- NEW: append-only `guidance_events` per the Always clause (unique per-app sequence, index on `application_id`, no prompt-text column).
- `apps/service/src/guidance/events.ts` -- NEW: `GuidanceEventStore` (`appendGuidanceEvent` with store-assigned per-app sequence, `listGuidanceEvents`, `listGuidanceGaps` miss projection, `countGuidanceEvents` if needed by tests) with InMemory + Postgres twins (`pg_advisory_xact_lock` + max+1, gate_runs pattern); exported from `apps/service/src/index.ts`.
- `apps/service/src/guidance/events.db.test.ts` -- NEW: real-Postgres suite (4.3 harness style): migration report includes 0004, append assigns per-app sequences, hit/miss shapes persist, gaps projection returns misses only, concurrent appends serialize to distinct sequences, old-shape payloads need no store change.
- `apps/service/src/guidance/serve.ts` (+ `serve.test.ts`) -- `ServeGuidanceCallInput` gains required `eventStore` + optional `onRecordError`; bound `hit`/`miss` appends exactly one event (agentTool from the pinned payload entry, `null` when the entry predates it) inside the never-throw boundary; unbound/refused append nothing; record failure still returns the typed result + fires the hook; every matrix row pinned (InMemory twin).
- `apps/service/src/guidance/mcp.ts` (+ `mcp.http.test.ts`) -- deps gain event store (+ hook passthrough); HTTP suite pins end-to-end recording over a real SDK client (hit records, miss records AND appears in gaps, refused call records nothing) and that the wire text is byte-identical to 4.4.
- `apps/service/src/guidance/server-cli.ts` (+ `server-cli.test.ts`) -- entry builds the Postgres event store over the shared pool, threads it into the MCP handler, wires `onRecordError` to the ids-only stdout logger; spawn-style suite covers wiring + one-envelope start behavior unchanged.
- Existing fixtures -- add `agentTool` to every bundle-application literal (`serve.test.ts`, `mcp.http.test.ts`, `perf.test.ts`, `identity.test.ts`, `guidance.db.test.ts` L207) and thread an InMemory event store through `serve.test.ts` `call`, `mcp.http.test.ts` deps, and `perf.test.ts` shared inputs (p95 covers the recording path); update `guidance.db.test.ts` migration/table-list pins for 0004.
- `README.md` -- `## Guidance records` section: recorded fields, gaps-are-misses, per-app sequence, 90-day default (enforcement 6.7), generation-to-bundle agent-tool lag, how to run.

**Acceptance Criteria:**
- Given any bound Guidance call, when it completes, then one append-only row stores exactly the Application id, tool, asked subject, Standard id/version or miss, agent tool name (or null when the pinned bundle predates the generation), bundle hash, UTC timestamp, and a store-assigned per-Application sequence — persisted by the service, with no agent cooperation required.
- Given a `miss`, when it is recorded, then it is listed as a gap against the Application, the tool and the subject with no second write.
- Given a refused, unbound, or failed call, when it completes, then no Guidance-event row exists for it.
- Given a record-store failure, when a bound tool is called, then the typed answer is byte-identical to the no-recording answer.
- Given a pre-4.5 active bundle, when the upgraded service serves, then it still serves and records with a null agent tool.
- Given the stored schema and captured service logs/metrics, when a test inspects them with a distinctive subject, then the subject appears in the event row and nowhere else.
- Given `pnpm test`, `pnpm run boundaries`, `pnpm run build`, `pnpm run typecheck`, `pnpm run lint`, when they run (DB suite against PostgreSQL 18), then all pass with zero warnings and every matrix row is pinned by a named test that actually ran; the load test still shows p95 under 500 ms with recording in the path.

## Spec Change Log

## Review Triage Log

### 2026-10-15 — Review pass (four layers: blind-hunter 14, edge-case-hunter 5, verification-gap 2, intent-alignment 4)
- verdicts: 25 findings — high 2, medium 0, low 7, false 15, maybe-false 1
- findings:
  - `[low]` `[reject]` migration without CHECK constraints (blind) — Verified: no CHECKs on outcome/sequence/null-consistency/hash/agent_tool. House service style is plain DDL (0001–0003 carry none; CHECKs live in registry migrations); the sole writer constructs typed values and readers guard with `isGuidanceEvent`. Defense-in-depth only.
  - `[low]` `[reject]` missing composite and created_at indexes (blind) — Verified single-column index only, matching the spec's migration clause exactly. The composite gaps shape and the retention sweep belong to 6.7, which owns deletion and can add its index; premature at pilot scale.
  - `[false]` `[reject]` hashLock collisions cause UNIQUE violations (blind) — Refuted: colliding ids serialize on the shared lock (correct, microsecond-scale), and same-app appends always share one lock key, so the violation path does not exist; the -2^31 edge cannot overflow an advisory key since the key space is signed.
  - `[low]` `[reject]` count-via-list and unbounded list queries (blind) — Verified. No production caller lists or counts today (serve calls append only); pagination and the 90-day bound belong to 6.7's retention design.
  - `[false]` `[reject]` InMemory twin races and ordering drift (blind) — Refuted: single-threaded microtask serialization makes same-sequence interleaving impossible in practice, spread-Max needs 100k+ rows in a test-only double, and ordering is equivalent for every caller.
  - `[false]` `[reject]` isoTimestamp empty-string and unvalidated passthrough (blind) — Refuted: `created_at` is NOT NULL timestamptz and the pg driver always delivers Date, so the fallback is unreachable; no bad outcome. Shares root cause with the edge-case timestamp finding; grouped.
  - `[false]` `[reject]` unknown agentTool silently maps to null (blind) — Refuted: the upstream bundle guard rejects unknown values before recording (unbound path, no row), and same-repo atomic updates exclude target skew; the null mapping is unreachable for corrupt input. Shares root cause with the edge-case agent_tool finding; grouped.
  - `[false]` `[reject]` event omits the stale flag; outcome type inlined (blind) — Refuted: the 8-field shape is spec-exact (stale rides the wire result, joinable via bundleHash), and the inline union is structurally identical with zero runtime effect.
  - `[maybe-false]` `[defer]` Postgres insert latency unmeasured against the 500ms p95 (blind) — Could not verify: the p95 suite covers the InMemory twin only, and production per-call Postgres latency is unmodeled. If true, agent turns breach NFR-6: medium (unverified). Settles with a Postgres-backed p95 probe (N concurrent bound calls through the Postgres twin). The mandated awaited-recording design cannot take a timeout without a spec change, so no patch routes from this entry.
  - `[low]` `[reject]` hook payload too small; empty catch swallows hook bugs (blind) — Verified minimal `{applicationId, tool, error}`. The shape is spec-sufficient ids-only surface, and hook-silencing is the deliberate never-throw pattern; more context would be new surface.
  - `[false]` `[reject]` retention constant unread; no 6.7 plumbing (blind) — Refuted: the spec mandates versioning the 90-day default only; enforcement, its index and its sweep are 6.7's story.
  - `[false]` `[reject]` agentTools lookup misses on raw driver keys (blind) — Refuted: the map is string-keyed and the bundle-16 db pin proves the lookup end-to-end (`claude-code` for the generated app, null elsewhere); same-tx snapshot reads are consistent.
  - `[false]` `[reject]` vacuous second-app counter test (blind) — Refuted: the very next test pins single-store per-app independence (A=[1,2,3], B=[1]) through one fixture; the redundant tail is harmless.
  - `[low]` `[patch]` deployed wiring and log line untested (blind) — Same defect as the verification-gap wiring rows; grouped and shares their patch route (the mcp-assertion half is already covered by full-field serve-layer pins).
  - `[false]` `[reject]` corrupt outcome surfaces as miss (edge-case) — Refuted: only typed `hit`/`miss` values are ever written; any other outcome requires out-of-band SQL tampering.
  - `[false]` `[reject]` unknown agent_tool string returned as valid (edge-case) — Same defect as the blind null-mapping row; grouped and shares its route.
  - `[low]` `[reject]` append without input validation (edge-case) — Verified unvalidated store input. All production inputs are pre-validated upstream (subject at the protocol layer, hash by the bundle guard, version by the Standard record); store-level validation would invent an unsettled error contract.
  - `[false]` `[reject]` timestamp fallback on null/number/object (edge-case) — Same defect as the blind isoTimestamp row; grouped and shares its route.
  - `[false]` `[reject]` hashLock -2^31 edge overflows (edge-case) — Refuted: advisory-lock keys are signed, so the edge value is a legal key, not an out-of-range error.
  - `[high]` `[patch]` deployed server threads the Postgres store with no wiring test (verification-gap) — Pre-verified gap accepted as filed: an InMemory swap or dropped threading typechecks and passes every suite while production records nothing durable. Fix applied: throwaway-DB suite through `createGuidanceHttpServer` asserting one `guidance_events` row per bound MCP hit (plus the `isDirectEntry` guard making the entry importable, bridge.ts precedent). Shares the blind wiring row.
  - `[high]` `[patch]` hook forwarding and ids-only log untested (verification-gap) — Pre-verified gap accepted as filed: dropped forwarding or a subject leak into logs ships undetected (the log type cannot enforce ids-only, the hook is optional). Fix applied: rejecting-store MCP case asserting unchanged wire answer plus one subject-free hook firing, and an exact-match log-capture assertion on the `guidance_record_error` line.
  - `[false]` `[reject]` any-call versus bound-only scope (intent-alignment divergence 1) — Refuted: the intent-contract Always clause pins bound-only explicitly and tests pin the negatives; "any" is shorthand resolved by the field list.
  - `[false]` `[reject]` 8 listed fields versus 9-key event (intent-alignment divergence 2) — Refuted: store plumbing (`id`, `created_at`) is entailed by append-only plus sequencing, and the spec versions the 9-key shape with tests pinning both.
  - `[low]` `[reject]` no end-to-end metric-export subject sweep (intent-alignment divergence 3) — Verified three-surface coverage (hook payload, no-prompt-column, logger call) with no repo-wide stdout sweep. The gap patch pins the one log line; a global sweep is harness beyond a direct correction.
  - `[false]` `[reject]` gap as projection versus second write (intent-alignment divergence 4) — Refuted: the spec mandates the projection explicitly and tests pin id-set equality with the miss subset.

## Auto Run Result

- Summary: story 4.5 makes the Company service remember every bound Guidance answer. `packages/contract` versions `GuidanceEvent` (id, applicationId, store-assigned per-app sequence, tool, asked subject, hit{standardId,version}|miss outcome, agentTool, bundleHash, UTC createdAt) with exact-key never-throw guards plus `GUIDANCE_EVENT_RETENTION_DAYS = 90`, and `BundleApplication` gains nullable `agentTool` with a missing-key-tolerant guard so pre-4.5 bundles keep serving. The registry compile fills `agentTool` from `currentAgentTools` same-tx. The service gains migration 0004 (`guidance_events`, append-only, unique per-app sequence, no prompt column) and the InMemory/Postgres twin store (`max+1` under `pg_advisory_xact_lock`, miss projection as the gap list); `serveGuidanceCall` appends exactly one event on the bound path — awaited but never throwing, typed answer unchanged on record failure with an ids-only `onRecordError` hook wired to the stdout logger — and records nothing for unbound/refused/unavailable calls. Agent tool comes only from the pinned bundle entry, with documented generation-to-bundle lag. README gains `## Guidance records`.
- Files:
  - `packages/contract/src/guidance-events.ts` (NEW) + `guidance-events.test.ts` (NEW) + `index.ts` — event shape, guards, retention default.
  - `packages/contract/src/bundles.ts` + `bundles.test.ts` — `agentTool` field, missing-key tolerance.
  - `apps/registry/src/bundles/compile.ts` + `bundles.db.test.ts` — same-tx fill, bundle-16 generation-lag pin.
  - `apps/service/migrations/0004_guidance_events.sql` (NEW) — append-only table, per-app unique sequence, no prompt column.
  - `apps/service/src/guidance/events.ts` (NEW) + `events.db.test.ts` (NEW) — twin store, gaps projection, concurrency serialization.
  - `apps/service/src/guidance/serve.ts` + `serve.test.ts` — recording hook in the serving unit, full matrix pins.
  - `apps/service/src/guidance/mcp.ts` + `mcp.http.test.ts` — pass-through plus hook forwarding; review patch: rejecting-store hook case.
  - `apps/service/src/guidance/server-cli.ts` + `server-cli.test.ts` — Postgres wiring with ids-only error log; review patches: throwaway-DB deployed-wiring suite, exact log-line assertion, `isDirectEntry` import guard (bridge.ts precedent).
  - `apps/service/src/index.ts` — store barrel exports.
  - Fixture updates: `agentTool` literals and InMemory store threading across serve/mcp/perf/identity/guidance.db/bundles.db/store.postgres/service-cli suites.
  - `README.md` — `## Guidance records` section.
  - `_bmad-output/implementation-artifacts/spec-4-5-record-guidance-events-and-gaps-in-the-company-store.md` — this spec (status done).
- Findings breakdown: 25 findings — 3 patched across 2 entries (both high: deployed-wiring suite + hook/log pins), 1 deferred (Postgres p95 latency probe, medium-if-true with named settler), 21 rejected (15 false with refuting evidence — lock/sequencing claims, twin races, timestamp fallbacks, guard-upstream rejection, spec-exact shape, end-to-end lookup proof, single-store counter pins, intent readings already pinned by the intent-contract; 6 low — CHECKs, indexes, count/pagination, hook payload size, input validation, metric-sweep harness).
- Follow-up review recommendation: true — two patched high entries. Named unverified risks: (1) the production-database run-path (real `SERVICE_RECORD_DATABASE_URL`, pre-4.5 databases migrating 0004 under load, pool behavior under burst) is unexercised — throwaway-DB tests prove the wiring shape, not the production topology. (2) Per-call Postgres insert latency against the 500ms NFR-6 bound is unmeasured — the deferred probe (N concurrent bound calls through the Postgres twin) settles it; the InMemory p95 the spec acceptance pins is green with recording in the path.
- Verification: `pnpm install --frozen-lockfile` clean; `pnpm -r run build` exit 0; `pnpm -r run typecheck` exit 0; `pnpm -r run lint` exit 0 (max-warnings 0 embedded); `pnpm run boundaries` no violations; per-package `pnpm test` with both `REGISTRY_TEST_DATABASE_URL` and `SERVICE_TEST_DATABASE_URL` on postgres 18 — contract 351, collector 1, cli 1, boundaries-self 17, extractor 16, core 95, gate 15, mcp-bridge 11, panel 420 passed + 1 pre-existing skip, registry 826, service 191 (1944 passed total, 0 failed; sequential isolation runs after re-verification, given the established full-parallelism flake). Matrix audit: all 10 spec I/O rows plus the p95-with-recording acceptance covered by named tests that ran and passed (serve recording suite, events.db Postgres suite incl. N-parallel serialization, mcp.http wire suites, server-cli deployed-wiring suite 4/4 with DB).
- Residual risks: (1) production topology/latency — see follow-up notes above. (2) Write-path defense in depth deliberately minimal (no CHECKs, no store-level input validation, count-via-list) — single trusted writer, typed inputs, guarded readers; 6.7 owns retention/index design. (3) Agent-tool lag (generation visible only after next bundle) and pre-4.5 null tools are by-design documented behavior the 6.2 projection inherits. (4) `server-cli.test.ts` still relies on spawn for the failure envelopes; the new import guard is covered by the wiring suite importing the module (a guard regression would fail loudly).

## Design Notes

- **Agent tool rides the bundle because nothing else in the Company knows it.** The registry's agent-tool table never leaves the registry except inside bundles; the bridge cannot know the agent tool (its argv is only the endpoint URL, and per-call client claims would be spoofable where the Application record is authoritative). The cost is a documented lag: Boilerplate generation is not a bundle-rebuilding mutation (pinned), so a fresh generation's tool appears in records only after the next bundle — records carry the tool known to the pinned bundle.
- **Gaps are a read of misses, not a second write.** One append-only table with an outcome discriminator keeps hit and gap consistent by construction; a separate gaps table could diverge (miss recorded, gap lost) with no intent-named surface to detect it.
- **Recording sits in the serving unit, not the adapter**, because `serveGuidanceCall` is the single funnel every tool call passes through — one hook records exactly once for every present and future caller, and the unit suites pin it without HTTP.

## Verification

**Commands:**
- `pnpm test` -- expected: new contract (events + agentTool guard incl. old-shape acceptance) + events DB + recording unit + MCP-HTTP + p95-with-recording suites pass; nothing existing regresses (updated pins only).
- `pnpm run boundaries` -- expected: no violations (contract-internal type/guard use; registry still imports only core/contract + intra-app; service unchanged in layering).
- `pnpm run build` / `pnpm run typecheck` / `pnpm run lint` -- expected: clean, zero warnings, new modules typecheck.

**Manual checks (if no CLI):**
- `README.md` documents the recorded fields, gaps-are-misses, per-app sequence, 90-day default with 6.7 enforcement, and the generation-to-bundle agent-tool lag.
- `apps/service/migrations/0004_guidance_events.sql` has no prompt-text column; service logs carry ids and codes only.
