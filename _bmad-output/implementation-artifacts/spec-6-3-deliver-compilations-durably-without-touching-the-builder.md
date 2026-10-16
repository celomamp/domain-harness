---
title: 'Story 6.3: Deliver Compilations durably without touching the Builder'
type: 'feature'
created: '2026-10-16'
status: 'in-review'
baseline_commit: '2e6e41f52ecf631652f7fd1335732147f718b24c'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - _bmad-output/implementation-artifacts/epic-6-context.md
  - _bmad-output/implementation-artifacts/spec-6-2-project-records-into-compilations-through-one-collector-chokepoint.md
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** The 6.2 Collector can project and push one Compilation but has no queue, no retries, and no durable per-Application sequence counter, so any panel outage would either slow/fail Builder Guidance calls and Gate runs or silently lose evidence (NFR-8, AD-10).

**Approach:** In `packages/collector`, add the durable outbox (enqueue with whole-payload validation, durable per-Application sequence allocation, backoff scheduling) plus a never-throws `flushOnce` that reuses the 6.2 typed push results; in `apps/service`, add the Postgres outbox twin with migration, a never-throws Collector client, and fire-and-forget wiring on the Guidance and Gate record paths so Builder latency and results never depend on the panel.

## Boundaries & Constraints

**Always:**
- The Builder hot path never touches the network: Guidance serve and Gate runner only await a local outbox enqueue (same cost class as the existing awaited record appends); every push happens in a background flush that never throws into serve/runner results.
- Every enqueued Compilation is validated with `validateForSend` first; a schema failure is dropped whole into the ledger, never enqueued.
- The Compilation `sequence` comes from the outbox's durable per-Application allocator (single ordering across all types, closing the 6.2 handoff); callers never choose it. `occurredAt` still equals the record's `createdAt`; `idempotencyKey` is still a fresh UUIDv7 per projection.
- Push outcomes reuse the 6.2 typed results: `sent` marks the entry sent; `catalog_unread` keeps the entry queued with a read-gate retry delay and no attempt penalty; `transport_failed` and `unauthorized` keep the entry queued with capped exponential backoff; `invalid` drops the entry whole into the ledger except a sequence-taken refusal, which resequences (fresh durable sequence, same idempotency key) and records a queue gap.
- Resends are idempotent by the registry's `(tenant_id, idempotency_key)` unique key (replay answers 200 with the stored row); an unknown major schema version is refused 400 and reported as a `rejected` drop, never retried.
- Queue loss is never silent: each flush derives missing sequences per Application from the durable allocation watermark versus queued/sent rows; any gap is counted under the `queue_gap` reason and carried on the next collector-health projection (`pendingCount` plus `droppedByReason` from outbox stats).
- Collector imports contract plus `node:crypto` only; the `no-imports-from-apps` boundary holds (record shapes cross as structural inputs); `packages/contract` is untouched.

**Never:**
- No builder-facing behavior change: no new latency on Guidance/Gate results, no new failure modes on those paths, no builder CLI or boilerplate changes.
- No registry changes: ingest already answers replay/idempotent insert, `catalog_unread` 403, and unknown-major 400 (6.1); 6.3 only interacts with it and pins the interaction in tests.
- No panel changes, no retention expiry (6.7 owns retention; sent rows are kept for gap derivation), no plan capability gates, no new runtime dependencies.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Enqueue guidance/Reflex | Bound hit/miss event + tenantKey + agentTool | Validated Compilation enqueued with allocated sequence, fresh key, occurredAt = createdAt | Schema failure → whole drop + `schema_failed`; never throws |
| Enqueue gate run | Appended GateRunRecord + agentToolName | `gate_run` Compilation enqueued (verdict open>0 → fail, match keys) | Same as above |
| Panel down | Transport failure on flush | Entries stay queued, attempts+1, nextAttemptAt backs off; serve/runner results unchanged | Never throws; panel-stopped test pins unchanged latency shape |
| Catalog unread | 403 `catalog_unread` on flush | Entries kept queued, retried after read-gate delay without attempt penalty; sent once the read is recorded | No drop, no throw |
| Resend same key | Same idempotencyKey pushed twice | Registry stores one row; second answers 200 replay; entry marked sent | None |
| Unknown major | Payload with unsupported schema major | Registry refuses 400; entry dropped whole, `rejected` +1, visible on health | No retry, no throw |
| Restored backup | Queued rows lost, counter restarted, sequence refused as taken | Entry resequenced with fresh sequence (same key), gap counted under `queue_gap` | Gap reported on next health Compilation, never silent |
| Deleted row gap | Watermark above present queued/sent sequences | Missing sequences counted as `queue_gap` on next stats/health read | Never throws |
| Unauthorized | 401 on flush | Entry kept queued with backoff (credential rotation may fix); surfaced via pendingCount | No silent drop |
| Backoff schedule | attempts = 0,1,2,… | nextAttemptAt = now + min(BASE * 2^attempts, MAX), deterministic (no wall-clock jitter in unit tests) | None |

</intent-contract>

## Code Map

- `packages/collector/src/push.ts` — the 6.2 single POST (`pushCompilation`, `PUSH_TIMEOUT_MS`, typed never-throw `PushResult`); flush reuses it unchanged, mapping each variant to a queue fate.
- `packages/collector/src/validate.ts` — `validateForSend` + `DROP_REASONS = ["schema_failed"]` (closed) + `DropLedger`; 6.3 extends the vocabulary with `rejected` and `queue_gap` (health `droppedByReason` keys are already open by 6.2 design).
- `packages/collector/src/project.ts` — the six 6.2 projection functions taking caller `sequence`; 6.3 callers pass the outbox-allocated sequence instead of choosing one.
- `packages/collector/src/ids.ts` — collector-local `mintUuidV7` reused for fresh idempotency keys.
- `apps/registry/src/compilations/service.ts` — `ingestCompilation` (idempotent insert, replay flag, sequence-taken refusal) and `assertCatalogRead` (403 gate); read-only reference, never imported; the registry HTTP layer already maps replay → 200/201, unread → 403, invalid → 400.
- `apps/service/src/guidance/serve.ts` — `recordGuidanceEvent` (L242–265, awaited-but-never-throwing append inside serve); the enqueue seam goes here via an optional collector field, never changing the typed hit/miss answers.
- `apps/service/src/ci-gate/runner.ts` — `appendGateRun` site (L185); the gate-run enqueue seam goes here via an optional collector field, never changing outcome/exit code.
- `apps/service/src/guidance/events.ts` — InMemory/Postgres twin precedent plus `pg_advisory_xact_lock` per-Application `max + 1` sequencing; the outbox Postgres twin mirrors this shape.
- `apps/service/migrations/0004_guidance_events.sql` — latest migration file; 6.3 adds `0005_collector_outbox.sql` (outbox rows + per-Application sequence watermark).
- `apps/service/src/bundles/service-cli.ts` — `SERVICE_TENANT_CREDENTIAL` (tenant HMAC key material and registry bearer credential, passed in opaquely, never logged).

## Tasks & Acceptance

**Execution:**
- `packages/collector/src/queue.ts` — NEW: `QueuedCompilation` row, `CollectorOutbox` interface (`enqueue`, `listDue`, `markSent`, `noteAttempt`, `keepForReadGate`, `resequence`, `dropEntry`, `allocateSequence`, `stats`, `detectGaps`), and `InMemoryCollectorOutbox` (durable-twin stand-in: per-app watermark counter, queued/sent maps, gap derivation of watermark minus present) -- rationale: the durable queue abstraction with the single per-Application ordering, testable with no database.
- `packages/collector/src/flush.ts` — NEW: `computeBackoffMs(attempts)` (BASE 1s, doubling, MAX 5min, deterministic), `flushOnce({ outbox, push, now })` mapping each 6.2 push fate to sent/keep/backoff/drop/resequence, plus `healthInputOf(stats, ledgerSnapshot)` building the `{pendingCount, droppedByReason}` collector-health input -- rationale: retries with backoff that never throw and never lose entries.
- `packages/collector/src/validate.ts` — extend `DROP_REASONS` with `rejected` (registry 400, e.g. unknown major) and `queue_gap` (lost sequences); ledger mechanics unchanged -- rationale: 6.2 reserved exactly this extension.
- `packages/collector/src/index.ts` — re-export queue/flush API; keep `packageName` + `CollectorError`.
- `packages/collector/src/queue.test.ts`, `flush.test.ts` — NEW: allocation monotonicity across types, enqueue-validates-first, backoff schedule vectors, catalog_unread keep-without-penalty, transport backoff, invalid-drop vs sequence-resequence, gap derivation, health input shape; stub push fns only, no network.
- `apps/service/migrations/0005_collector_outbox.sql` — NEW: `collector_outbox` rows (idempotency key PK, application id, sequence, payload jsonb, status, attempts, next_attempt_at) plus `collector_sequences` watermark (application id PK, allocated_upto), sequence allocation under `pg_advisory_xact_lock` mirroring the guidance-events pattern.
- `apps/service/src/collector/outbox.ts` — NEW: `PostgresCollectorOutbox` implementing the collector interface; `apps/service/src/collector/client.ts` — NEW: never-throws `CollectorClient` (`recordGuidance`, `recordGateRun`, `submit`, `flushOnce` driver, `onError` ids-only hook).
- `apps/service/src/guidance/serve.ts`, `apps/service/src/ci-gate/runner.ts` — thread optional `collector` into the record seams (enqueue after successful local append, inside the existing never-throw guards); no signature break for existing callers.
- `apps/service/src/collector/collector.db.test.ts` — NEW: Postgres twin parity (enqueue/due/sent/backoff/resequence/gap), panel-stopped serve+run test (Guidance and Gate results unchanged, entries accumulate), catalog_unread keep-then-send-after-read against the real registry ingest path.

**Acceptance Criteria:**
- Given the panel is unreachable, when Guidance calls and Gate runs continue, then their results are unchanged and Compilations accumulate in the durable queue with retries and backoff.
- Given ingestion refused for an unread catalog, when the flush receives the refusal, then entries stay queued and are sent once the read is recorded.
- Given a resend of the same Compilation, when the panel ingests it, then no duplicate row is stored and an unknown major version is rejected and reported.
- Given queue loss, when sending resumes, then a collector-health Compilation reports the gap and it is never silent.

## Spec Change Log

## Review Triage Log

## Verification

**Commands:**
- `pnpm --filter @domain-harness/collector test` -- expected: queue/flush/project/validate/push/leak suites green (no database)
- `pnpm --filter @domain-harness/service test` -- expected: collector outbox + panel-stopped suites green (needs SERVICE_TEST_DATABASE_URL on postgres 18)
- `pnpm --filter @domain-harness/registry test` -- expected: ingest suites still green (registry untouched; interaction pinned service-side)
- `pnpm run boundaries` -- expected: no violations (collector gains no new import edges beyond contract + builtins)
