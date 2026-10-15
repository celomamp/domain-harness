---
title: 'Story 6.2: Project records into Compilations through one Collector chokepoint'
type: 'feature'
created: '2026-10-15'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
baseline_commit: '7f06576adb85499abfe4eecfdffe441e09710409'
context:
  - _bmad-output/implementation-artifacts/epic-6-context.md
  - _bmad-output/implementation-artifacts/spec-6-1-publish-the-compilation-catalog-and-gate-sending-on-the-buyer-reading-it.md
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** Company records (Guidance events, Gate runs, Deviations, binding refusals, bundle state) have no audited path to the Buyer: no single function turns them into Compilations, so prompt text, Standard content, or source code could leak outbound and no choke point exists to prove otherwise (FR-26, AD-9).

**Approach:** In `packages/collector`, build the only record-to-Compilation projection (one pure function per Compilation type, output validated against the 6.1 catalog), the tenant-keyed subject hash, whole-payload drops with per-reason counts, the single outbound push to the panel ingest endpoint, and a repo-wide scan test proving no other unit holds such a path. Queueing, retries, and backoff stay in 6.3.

## Boundaries & Constraints

**Always:**
- `packages/collector` is the only code with a record-to-Compilation function. Every projected Compilation is validated with the published contract guards before it may leave; anything failing validation is dropped whole (no partial payload survives) and counted by reason.
- A Guidance subject crosses as `{kind: "slot-token"}` only when the subject already satisfies the catalog grammar, decided by feeding the slot-token candidate through the contract's own `isGuidanceCompilationSubject` (the guard IS the grammar, so projector and registry validator can never drift); otherwise it crosses as `{kind: "subject-hash"}` carrying HMAC-SHA256 keyed by the tenant service credential, 64 lowercase hex. Raw subject text never crosses.
- The Compilation `sequence` is an explicit caller-supplied input drawn from one global per-Application counter owned by the collector (the registry 0015 `UNIQUE (tenant_id, application_id, sequence)` spans all types, so a record store's per-type sequence must never be reused); `occurredAt` always equals the record's `createdAt`; `idempotencyKey` is a fresh UUIDv7 minted per projection by the collector-local minter.
- `agentToolName` is an explicit caller-supplied input: Guidance projections default to `event.agentTool` verbatim when non-null, otherwise the caller supplies it (Gate runs, Deviations, refusals, bundle status, and health carry no agent tool of their own; the vocabulary is accepted verbatim, never normalized, per 6.1).
- Binding-refusal projections take the live `{reason, sentence}` outcome as input, never the stored fingerprint rows (those rows carry fingerprints but no reason or sentence); bundle-status projections take explicit `{bundleHash, bundleSequence, issuedAt}` (6.3 wires them to the bundle store); collector-health projections take explicit `{pendingCount, droppedByReason}` (no queue exists yet, so callers pass pending 0 until 6.3).
- The outbound push mirrors the service puller pattern: one POST of exactly one validated Compilation to the ingest path with the tenant bearer credential and a bounded timeout, never throwing (typed results for sent, catalog-unread, unauthorized, invalid, and transport failure). No retries, no backoff, no queue, no wiring into `apps/service` (all 6.3).
- Drop-reason vocabulary starts closed as exactly `schema_failed`; 6.3 extends it with transport reasons. The 6.1-blessed verbatim evidence fields (`revision`, `deviation.subject`, `deviation.correction`, refusal `sentence`) cross unchanged by 6.1 design and are the only free-text channels, enumerated in the leak test allowlist.
- Contract guards are reused, never duplicated; `packages/contract` is untouched (no catalog change, so no semver bump is triggered). Collector imports contract plus `node:crypto` only; no new runtime or dev dependencies; the `no-imports-from-apps` boundary holds (record shapes cross as structural inputs, the service-local UUID minter pattern is mirrored, not imported).

**Never:**
- No durable queue, retries, backoff, resend logic, or Collector-health gap reporting (story 6.3).
- No service wiring (no calls from Guidance serve paths or Gate runner into the collector), no panel or registry changes, no migration.
- No new dependency-cruiser rule (the cruiser models imports, not URL targets; the text scan observes the actual surface).
- No plan capability gates and no prices anywhere; no cross-app imports; no hex/px literals in CSS (no UI in this story).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Project guidance hit | `GuidanceEvent` (hit) + ctx | `guidance` Compilation with tool, outcome hit, subject token-or-hash | None |
| Project guidance miss | `GuidanceEvent` (miss) + ctx | `guidance` Compilation with outcome miss | None |
| Grammar subject | Subject already `moduleKind/slotKind/name` per the catalog grammar | `{kind: "slot-token", slotToken}` verbatim | None |
| Non-grammar subject | Any other subject (prompt text, code, unicode) | `{kind: "subject-hash", hash}` HMAC-SHA256 hex; raw text nowhere | None |
| Project gate run | `GateRunRecord` + ctx | `gate_run` with revision, verdict (open>0 → fail), checked/open counts, per-Deviation match keys (standardId, slot, subject, status) | None |
| Project deviation | `Deviation` + ctx | `deviation` Compilation reusing the Deviation inline | None |
| Project binding refusal | Live `{reason, sentence}` + ctx | `binding_refusal` Compilation | None |
| Project bundle status | `{bundleHash, bundleSequence, issuedAt}` + ctx | `bundle_status` Compilation | None |
| Project collector health | `{pendingCount, droppedByReason}` + ctx | `collector_health` Compilation | None |
| Schema-failing payload | Any object failing `validateForSend` | Dropped whole; ledger `schema_failed` count +1; no partial value returned | Drop result naming the reason |
| Leak corpus | Records seeded with prompt-like text, Standard content, source snippets | No seeded string appears in any projected Compilation outside the enumerated verbatim allowlist | Test failure listing the offending field |
| Push accepted | 201/200 from ingest | `{sent: true}` | None |
| Push refused unread | 403 `catalog_unread` | Typed refusal (6.3 reuses it to keep queueing) | No throw, no retry |
| Push refused auth/input | 401 / 400 | Typed refusal naming the class | No throw |
| Push transport failure | Timeout, reset, unreachable panel | Typed transport failure | No throw, nothing lost (caller queues in 6.3) |
| Chokepoint scan | Repo tree as-is | Pass: only `packages/collector` holds a panel-push path | Any new fetch-to-ingest site outside collector fails with file + line |

</intent-contract>

## Code Map

- `packages/collector/src/index.ts` — stub only (L1–7, `packageName` + `CollectorError`); becomes the barrel re-exporting project/validate/push.
- `packages/collector/src/index.test.ts` — the single existing test (workspace-name assert); keep green, extend the suite around it.
- `packages/collector/package.json` — deps: `@domain-harness/contract` only (L23–25); no new dependency is needed (`node:crypto` is a builtin, vitest already a devDep).
- `packages/contract/src/compilations.ts` — the reuse surface: `isCompilation` + per-type guards (L466–561, exact-key never-throw), `isGuidanceCompilationSubject` (L135–141, doubles as the slot-token grammar check), `isSupportedCompilationSchemaVersion` (L74–79), `COMPILATION_CATALOG_VERSION`/`COMPILATION_CATALOG_MAJOR` (L35–38), `COMPILATION_API_PATHS.compilations` (L59–64), `isGuidanceToolName` for the guidance tool arm.
- `packages/contract/src/guidance-events.ts` — `GuidanceEvent` input shape (L35–50): id, applicationId, store-assigned sequence (NOT reused for the Compilation sequence), tool, subject as asked, hit/miss outcome, agentTool (nullable → the agentToolName default rule), bundleHash, createdAt (→ occurredAt).
- `packages/contract/src/deviations.ts` — `Deviation` (standardId, slot, subject, kind, status, correction) + `DeviationMatchKey` (L153–156): the gate-run summary is a direct projection of these fields.
- `packages/contract/src/guidance-identity.ts` — `GuidanceUnboundReason` (L50–58): the binding-refusal input reason; sentences come from the live outcome, never from stored rows.
- `apps/service/src/ci-gate/store.ts` — `GateRunRecord` (L32–44: id, sequence, applicationId, revision, bundleHash, extractorVersion, deviations, checked, open, adherence, createdAt) and `BindingRefusalRecord` (L13–19, fingerprints only — hence the live-outcome input rule); read-only reference, never imported.
- `apps/service/src/guidance/store.ts` — `GuidanceBindingRefusal`/`GuidanceProjectMismatchRecord` shapes (same fingerprint-only limitation); read-only reference.
- `apps/service/src/ci-gate/ids.ts` — `encodeUuidV7`/`mintUuidV7` (monotonic, `getRandomValues`-backed, L9–47): the pattern to mirror inside the collector (importing it would violate `no-imports-from-apps`).
- `apps/service/src/bundles/service-cli.ts` — `SERVICE_TENANT_CREDENTIAL` (the tenant's registry service credential, the only tenant secret in the Company environment): the HMAC key material, passed in as an explicit `tenantKey` param, never logged or emitted.
- `apps/registry/src/compilations/validate.ts` — the strict-check reference to mirror in `validateForSend` (unknown-major rejection L199–204, catalog-version pin L205–207, calendar-real instant round-trip L28–35, int4 `SEQUENCE_MAX` L39–40/61–63, first-failure-wins ordering); read-only reference, never imported.
- `apps/service/src/bundles/puller.ts` — the outbound-call pattern to mirror in push (bounded timeout, never-throws typed failures, L59–69); the pre-existing registry bundle-pull fetch is allowlisted in the scan with this citation.
- `tooling/boundaries/boundaries.test.ts` — the repo-wide check pattern (`checkBoundaries(repoRoot)` L42–46, `tempTree` helper L22–35 for negative tests): the scan module follows the same shape with its own temp-tree helper.
- `.dependency-cruiser.cjs` — unchanged; `pnpm run boundaries` must stay green (collector gains no new import edges beyond contract + builtins).

## Tasks & Acceptance

**Execution:**
- `packages/collector/src/ids.ts` — NEW: collector-local `encodeUuidV7`/`mintUuidV7` mirroring `apps/service/src/ci-gate/ids.ts` (monotonic_concat, `node:crypto getRandomValues`, self-check via `isUuidV7`) -- the minter cannot be imported (apps are leaves).
- `packages/collector/src/project.ts` — NEW: the only record-to-Compilation functions — `projectGuidanceCompilation(event, ctx)`, `projectGateRunCompilation(run, ctx)`, `projectDeviationCompilation(deviation, ctx)`, `projectBindingRefusalCompilation({ reason, sentence }, ctx)`, `projectBundleStatusCompilation({ bundleHash, bundleSequence, issuedAt }, ctx)`, `projectCollectorHealthCompilation({ pendingCount, droppedByReason }, ctx)` sharing one envelope builder (`type`, per-type schema version, catalog version, minted idempotencyKey, applicationId, caller `agentToolName`, `occurredAt = record.createdAt`, caller `sequence`); `projectGuidanceSubject(subject, hashSubject)` trying the slot-token candidate through `isGuidanceCompilationSubject` first, else the HMAC arm; every result asserted through the matching contract guard before return (a guard failure throws an internal error, never a partial Compilation) -- rationale: single audited chokepoint with grammar-drift-proof subjects.
- `packages/collector/src/validate.ts` — NEW: `validateForSend(value)` (contract `isCompilation` + mirrored strict checks: supported major, exact catalog version, calendar-real instants, int4 sequence cap; returns the Compilation or a `{dropped: true, reason: "schema_failed"}` naming the first failure, never a partial value), `DROP_REASONS = ["schema_failed"]` (closed; 6.3 extends), `DropLedger` (`record(reason)`, `snapshot()` → the `droppedByReason` map) -- rationale: whole-payload drops with countable reasons feeding collector health.
- `packages/collector/src/push.ts` — NEW: `pushCompilation({ fetchImpl, baseUrl, credential, compilation, timeoutMs })` POSTing one validated Compilation to the ingest path with bearer credential and bounded timeout; typed never-throw results (`sent` on 201/200, `catalog_unread` on 403, `unauthorized` on 401, `invalid` on 400, `transport_failed` on timeout/network/abort) -- rationale: the single outbound path, mirroring the puller pattern, with refusals typed for 6.3's queue.
- `packages/collector/src/index.ts` — re-export project/validate/push API (keep `packageName` + `CollectorError`); no other file in the repo may construct these projections.
- `packages/collector/src/project.test.ts` — NEW: per-type projection tests (envelope fields, verdict derivation, match-key mapping, token-vs-hash arms with grammar edge cases like import-specifier slashes, agentToolName default/fallback, occurredAt/sequence/idempotencyKey rules) -- pins every happy-path matrix row.
- `packages/collector/src/leak.test.ts` — NEW: seeded-corpus test (no new deps; deterministic PRNG + hostile corpus of prompt-like text, Standard content, source snippets, unicode) asserting no seeded string occurs in any projected Compilation outside the verbatim allowlist (`revision`, `deviation.subject`, `deviation.correction`, refusal `sentence`, each asserted field-by-field) -- pins the leak matrix row and the 6.1 residual-risk boundary.
- `packages/collector/src/validate.test.ts`, `packages/collector/src/push.test.ts` — NEW: drop-whole + ledger-count tests (unknown major, wrong catalog version, Feb-30 instant, int4-overflow sequence, extra key); push tests against a local `node:http` stub (201/200 sent, 403/401/400 typed refusals, abort → transport failure, credential header + timeout asserted).
- `tooling/boundaries/collector-chokepoint.ts` — NEW: `scanOutboundPushPaths(root)` text scan (sources under `apps/*/src`, `packages/*/src`, tests/fixtures excluded) reporting files that (a) call `fetch(`/`Request(` toward the compilations ingest path or (b) reference the ingest path literal/constant together with an outbound call, outside `packages/collector/src`; the service bundle puller is hard-allowlisted with its 4.2 citation -- rationale: the cruiser models imports, not URL targets, so the scan observes the actual network surface.
- `tooling/boundaries/collector-chokepoint.test.ts` — NEW: real-tree pass assertion + temp-tree negative test (planted offender outside collector fails naming file + line) with a local temp-tree helper mirroring `boundaries.test.ts`.

**Acceptance Criteria:**
- Given `packages/collector`, when a record is projected, then the projection is the only record-to-Compilation function in the repo and every result validates against the published catalog schema.
- Given a Guidance subject, when projected, then it crosses as a slot-name token only when it matches the slot grammar, otherwise as a tenant-keyed hash, with no raw text crossing.
- Given a payload that fails its schema, when validated for send, then it is dropped whole with no partial payload and the dropped count for its reason increases.
- Given records seeded with prompt-like text, Standard content, and source snippets, when projected, then none of that text appears in any Compilation outside the enumerated verbatim evidence fields.
- Given the repo's dependency graph and network call sites, when checked, then only `packages/collector` holds an outbound path to the vendor panel.

## Spec Change Log

## Review Triage Log

### 2026-10-15 — Review pass (four layers: blind-hunter 15, edge-case-hunter 15, verification-gap 3, intent-alignment 7)
- verdicts: 40 findings — high 1, medium 2, low 16, false 21, maybe-false 0
- findings:
  - `[low]` `[patch]` minter without direct tests (blind) — Verified: only indirect minting inside projection tests. Fix applied: focused `ids.test.ts` (deterministic vector, RangeError bounds, monotonic same-ms, canonical shape) — test-only.
  - `[low]` `[patch]` empty tenantKey HMACs silently (blind) — Verified `createHmac` accepts `""`, collapsing cross-tenant hashes. Same root cause as the edge-case empty-key row; grouped. Fix applied: both subject functions throw on empty key (fail-closed); pinned for token, non-token, and full-projection paths.
  - `[false]` `[reject]` caller context unvalidated (blind) — Refuted: the spec mandates the generic internal error on guard failure; guards ARE the validation, and nothing partial ever returns.
  - `[false]` `[reject]` bundleHash and hit linkage discarded (blind) — Refuted: the closed 6.1 catalog has no such fields, so the linkage is absent by catalog design (adding fields is a semver bump owned by 6.1, not this story).
  - `[false]` `[reject]` verdict inconsistent with deviations list (blind) — Refuted: the `open > 0 → fail` derivation is spec-mandated verbatim and gate-store records are consistent by construction; the projector trusts typed inputs. Same root cause as the edge-case negative-open row; grouped.
  - `[false]` `[reject]` deviation spread forwards future fields (blind) — Refuted: the exact-key guard fails closed (throws) on any unknown field, so nothing can smuggle through the spread.
  - `[false]` `[reject]` hardcoded reasons and int4 cap (blind) — Refuted: mirrors the 6.1 registry validator verbatim, and sharing would need new contract exports the spec forbids adding (contract untouched).
  - `[false]` `[reject]` health reason keys open (blind) — Refuted: keys must stay open for 6.3's transport reasons by spec design (`DROP_REASONS` correctly governs only the ledger input). Same root cause as the edge-case and claim rows; grouped.
  - `[false]` `[reject]` push skips validation and input checks (blind) — Refuted: ledger-counted validation must happen at the caller by design (push-side drops would evade counting); ingest re-validates remotely fail-closed, and every malformed input maps to a typed never-throw failure. Same root cause as the edge-case and claim rows; grouped.
  - `[low]` `[reject]` 403/redirect/5xx mapping and unbounded 400-body read (blind) — Verified mappings match the route's only 403 and the documented retryable fallback; the body read is time-boxed by the mandated 30s timeout. Small residual, not worth restructuring.
  - `[low]` `[reject]` scan evasion surface (blind) — Verified residual (comments FP loudly; axios/.js/dynamic paths need malice). Same root cause as the edge-case scan rows and the coverage claim; grouped: the mandated tripwire shape is implemented and catches accidents, which is its design target — adversarial evasion is review's job.
  - `[false]` `[reject]` puller allowlist and exclusion gaps (blind) — Same scan entry; grouped. Verifying puller behavior inside the scan is scope creep (own tests cover it); TS-only repo has no .js sources.
  - `[low]` `[reject]` leak seeding variety gaps (blind) — Verified partial coverage, but typed fields cannot carry text, verbatim fields are exempt by design, and key-absence follows from HMAC construction; residual variety is harness nicety beyond the matrix row.
  - `[false]` `[reject]` hardcoded versions in fixtures (blind) — Refuted: a bump either still validates (old major supported) or fails loudly at the right place; literals-vs-constants is style with no silent harm.
  - `[false]` `[reject]` missing package/engines/CI/handoff tasks (blind) — Refuted: Node 24+ supports the used APIs, the scan runs in the standard suite (CI-wired), and the DropLedger/counter handoff is 6.3's design space (recorded below).
  - `[low]` `[patch]` empty tenantKey collides hashes (edge-case) — Same defect as the blind empty-key row; grouped and shares its patch route.
  - `[low]` `[reject]` negative open count derives pass (edge-case) — Same defect as the blind verdict row; grouped and shares its route (typed gate-store inputs are consistent by construction).
  - `[false]` `[reject]` open health keys (edge-case) — Same defect as the blind health-keys row; grouped and shares its route.
  - `[false]` `[reject]` bundleSequence without int4 cap (edge-case) — Refuted: the field lives in jsonb (arbitrary-precision numeric), not an int4 column — no 500 exists to escape to.
  - `[low]` `[reject]` push without pre-validation (edge-case) — Same defect as the blind push row; grouped and shares its route.
  - `[false]` `[reject]` unreadable file aborts scan (edge-case) — Refuted: the abort is a loud test failure, never silent hiding; repo files are readable.
  - `[low]` `[reject]` non-fetch clients evade detection (edge-case) — Same scan entry; grouped.
  - `[false]` `[reject]` .js offenders excluded (edge-case) — Same scan entry; grouped (TS-only repo, dist excluded).
  - `[low]` `[reject]` symlinked offenders skipped (edge-case) — Same scan entry; grouped (deliberate node_modules-symlink exclusion).
  - `[low]` `[reject]` concatenated paths evade regex (edge-case) — Same scan entry; grouped (needs deliberate obfuscation).
  - `[low]` `[reject]` push-validates claim (edge-case claim) — Same defect as the blind push row; grouped and shares its route.
  - `[low]` `[reject]` no durable per-app counter (edge-case claim) — Verified true, but durability requires a runtime/store that only 6.3 owns; 6.2 delivers the explicit caller-supplied-input half. Handoff to 6.3 recorded below — the counter must exist before first send or idempotency keys collide under the UNIQUE constraint.
  - `[false]` `[reject]` health vocabulary claim (edge-case claim) — Same defect as the blind health-keys row; grouped and shares its route.
  - `[low]` `[reject]` scan coverage claim (edge-case claim) — Same scan entry; grouped.
  - `[false]` `[reject]` projection impurity claim (edge-case claim) — Refuted: the fresh-key mandate entails non-identical replay; "pure" means no record I/O, and all content fields are deterministic.
  - `[high]` `[patch]` HMAC key-sensitivity self-compared (verification-gap) — Pre-verified gap accepted as filed: an unkeyed hash passes the suite while breaking tenant isolation. Fix applied: key-inequality assertion plus an independent fixed HMAC vector.
  - `[medium]` `[patch]` non-guidance drop coverage missing (verification-gap) — Pre-verified gap accepted as filed: five of six per-type branches unexercised. Fix applied: one exact-shape drop case per non-guidance type.
  - `[medium]` `[patch]` unexpected-status push coverage missing (verification-gap) — Pre-verified gap accepted as filed: the retryable fallback unpinned. Fix applied: stubbed-500 `transport_failed` case.
  - `[low]` `[patch]` all-six round-trip through validateForSend (intent-alignment divergence 2) — Verified only one guidance case bridged projection to validation. Fix applied: each projected type round-tripped expecting `{ ok: true }` (test-only; catches project/validate skew).
  - `[low]` `[reject]` exclusivity proven by push-scan only (intent-alignment divergence 1) — Verified, but the spec mandates exactly the push-path scan; constructor exclusivity is convention plus review (fixtures necessarily construct literals).
  - `[false]` `[reject]` guard-is-grammar selection (intent-alignment divergence 3) — Refuted: the spec selects guard-is-grammar verbatim with edge cases pinned.
  - `[false]` `[reject]` HMAC narrowing (intent-alignment divergence 4) — Refuted: the spec mandates HMAC-SHA256 with the tenant credential verbatim.
  - `[false]` `[reject]` unit-level drop counting (intent-alignment divergence 5) — Refuted: the spec scopes to the in-memory ledger; durability is 6.3.
  - `[false]` `[reject]` allowlist plus deterministic corpus (intent-alignment divergence 6) — Refuted: the spec mandates both verbatim (no new deps, deterministic PRNG).
  - `[false]` `[reject]` narrow scan shape (intent-alignment divergence 7) — Refuted: the spec mandates the text-scan shape and forbids a cruiser rule; residual evasion needs malice.

## Auto Run Result

- Summary: story 6.2 makes `packages/collector` the sole record-to-Compilation chokepoint. Six pure projection functions (guidance, gate run, deviation, binding refusal, bundle status, collector health) share one envelope builder (catalog version, fresh UUIDv7 idempotency key from the collector-local minter, caller agentToolName, occurredAt = record createdAt, caller sequence) and assert every result through the 6.1 contract guards before return. Guidance subjects cross as slot tokens only through the contract guard itself, else as HMAC-SHA256 tenant-keyed hashes (empty keys now throw). `validateForSend` mirrors the registry strict checks with first-failure-wins whole-payload drops into a closed-vocabulary `DropLedger`; `pushCompilation` is the single bounded-timeout outbound POST with never-throw typed results for 6.3's queue. A repo-wide text scan plus suite proves only the collector holds a panel-push path. No queue, no retries, no service wiring, no migration — all 6.3.
- Files:
  - `packages/collector/src/ids.ts` (NEW) + `ids.test.ts` (NEW, review patch) — collector-local UUIDv7 minter, mirrored not imported.
  - `packages/collector/src/project.ts` (NEW) + `project.test.ts` (NEW) — six projections, envelope, HMAC subject arm; review patches: empty-key throw, key-sensitivity pins, fixed vector.
  - `packages/collector/src/validate.ts` (NEW) + `validate.test.ts` (NEW) — whole-drop validation, closed ledger; review patches: all-six round-trip, per-type drop cases.
  - `packages/collector/src/push.ts` (NEW) + `push.test.ts` (NEW) — single outbound POST; review patch: stubbed-500 fallback case.
  - `packages/collector/src/leak.test.ts` (NEW) — deterministic hostile corpus with verbatim allowlist, field-by-field.
  - `packages/collector/src/index.ts` — barrel (keeps `packageName` + `CollectorError`); package.json unchanged.
  - `tooling/boundaries/collector-chokepoint.ts` (NEW) + `collector-chokepoint.test.ts` (NEW) — push-path scan, real-tree pass, temp-tree negative.
  - `_bmad-output/implementation-artifacts/spec-6-2-project-records-into-compilations-through-one-collector-chokepoint.md` — this spec (status done).
- Findings breakdown: 40 findings — 7 patched across 6 entries (1 high: HMAC key-sensitivity; 2 medium: non-guidance drop coverage, unexpected-status push coverage; 4 low: minter suite, empty-key throw, all-six round-trip), 0 deferred, 33 rejected (21 false with refuting evidence — generic internal error by mandate, closed-catalog linkage, spec-verbatim verdict derivation, exact-key fail-closed spread, contract-untouched mirroring, jsonb numerics, loud scan aborts, TS-only sources, style-only literals, guard-is-grammar/HMAC/ledger/corpus/scan selections all spec-mandated; 12 low — 403/body mapping, scan tripwire limits, leak seed variety, negative-open typing, push-at-caller design, counter handoff, exclusivity convention).
- Follow-up review recommendation: true — one patched high entry. Named unverified risk: the HMAC pin proves key-sensitivity at unit level, but 6.3's real-credential threading (sourcing the live `SERVICE_TENANT_CREDENTIAL`, never empty, never logged) is unexercised — an empty/miswired key at the 6.3 boundary would now throw loudly rather than silently link, which is exactly what the new guard is for, but the threading itself awaits 6.3.
- Verification: `pnpm install --frozen-lockfile` clean; `pnpm -r run build` exit 0; `pnpm -r run typecheck` exit 0; `pnpm -r run lint` exit 0; `pnpm run boundaries` no violations; per-package `pnpm test` with both DB URLs on postgres 18 — contract 365, collector 40, cli 45, boundaries-self 20, extractor 16, core 95, gate 15, mcp-bridge 11, panel 436 passed + 1 pre-existing skip, registry 847, service 191 (2081 passed total, 0 failed; sequential isolation runs after re-verification). Matrix audit: all 16 spec I/O rows covered by named tests that ran and passed (project 13+, leak 2, validate 8+, push 5+, chokepoint 3).
- Residual risks: (1) real-credential threading — see follow-up note above. (2) Durable per-Application counter does not exist: 6.3 must build it before first send or idempotency keys/sequences collide under the registry UNIQUE constraint (explicit handoff). (3) Verbatim free-text channels cross by 6.1 design (revision, deviation subject/correction, refusal sentence, gate-run subjects) — allowlisted and pinned, but content safety of future evidence stays with review. (4) Scan is an accident-tripwire, not adversarial coverage (axios/.js/dynamic paths, dependency-introduced egress outside the observed surface). (5) Same-key divergent-body handling stays ingest-side; unexpected push statuses map retryable-ward by documented choice for 6.3 to refine.

## Verification

**Commands:**
- `pnpm --filter @domain-harness/collector test` -- expected: project/validate/push/leak suites green (needs no database)
- `pnpm --filter @domain-harness/collector typecheck && pnpm --filter @domain-harness/collector lint` -- expected: clean
- `pnpm --filter @domain-harness/boundaries test` -- expected: chokepoint scan suite green (real-tree pass + temp-tree negative)
- `pnpm run boundaries` -- expected: no violations (no new import edges beyond contract + builtins)
- `pnpm --filter @domain-harness/contract test` -- expected: untouched catalog suites still green (contract unchanged, no semver-bump trigger)
