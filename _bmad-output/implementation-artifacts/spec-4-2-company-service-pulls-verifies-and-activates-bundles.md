---
title: 'Story 4.2: Company service pulls, verifies and activates bundles'
type: feature
created: '2026-10-14'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
baseline_revision: '3e2cbdf3f35b31b5f809bbe4339d2d5a8332916c'
context:
  - _bmad-output/implementation-artifacts/epic-4-context.md
  - _bmad-output/implementation-artifacts/spec-4-1-registry-compiles-and-signs-standard-bundles.md
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** The registry (story 4.1) compiles and serves signed Standard bundles behind per-tenant service credentials, but nothing in the Company environment pulls them: `apps/service` has no bundle puller, verifier, active-bundle store or deployment story, so no Guidance/Gate surface has a trusted active version to pin.

**Approach:** Add a bundles unit to `apps/service` that, configured only from the environment (vendor URL, tenant id, tenant service credential, trust set), pulls the tenant's latest signed bundle over outbound HTTPS, verifies it strictly on the wire, records every refusal with its reason in the record store, and activates a verified bundle by swapping the tenant's active-bundle pointer in one record-store transaction; a staleness view marks the service stale past the Buyer-set bound with no freeze and records the active hash, sequence and age. Ship it as one container image with its own PostgreSQL 18 record store behind a compose file, driven by a pull daemon entry.

## Boundaries & Constraints

**Always:**
- Verification mirrors the pinned 4.1 rules exactly: hash = SHA-256 hex of `canonicalJson` over the whole signed bundle object; signature is Ed25519 (base64) over the canonical bytes of the payload; the received bundle must pass the contract guards (`isSignedStandardBundle`) — the wire is exact-shape-strict (4.1 left this to the service).
- Verification order is fixed and every refusal is a recorded, append-only store row (tenant id, reason, received sequence/hash) plus a never-throwing outcome: `shape` (does not pass the contract guards, including unknown format major), `unknown_key` (key id not in the trust set), `signature_failed`, `tenant_mismatch` (payload tenant ≠ configured tenant), `hash_mismatch` (recomputed hash ≠ an available expectation), `stale_sequence` (sequence lower than the active pointer's).
- The active-bundle pointer lives in the record store (one row per tenant, never process memory) and is swapped in one transaction that inserts the hash-keyed bundle row, re-reads it, re-derives the hash from the stored bytes and refuses (refusing this activation only) on mismatch; the swap is guarded on sequence so a concurrent older activation can never win; two replicas activating anything report the same active hash.
- Staleness: age = now − `payload.issuedAt` against `payload.stalenessHours`; `payload.frozen` true suspends the bound entirely. Observing staleness records an append-only row (hash, sequence, age) only when the observation differs from the last recorded one (fail-closed: identical observations add no row).
- Pull is one outbound `GET` per cycle to `standardBundleLatestPath(tenantId)` under the configured base URL with `Authorization: Bearer <service credential>`; registry envelopes (401/403/404) and transport failures surface as pull outcomes, touching nothing in the store; there is no retry, queue, inbound listener or TLS termination in this unit.
- The daemon entry reads `SERVICE_VENDOR_URL`, `SERVICE_TENANT_ID`, `SERVICE_TENANT_CREDENTIAL`, `SERVICE_BUNDLE_TRUST_KEYS` (trust set: JSON object of keyId → Ed25519 PEM public key) and `SERVICE_RECORD_DATABASE_URL` (shared with the CI Gate store), pulls every `SERVICE_PULL_INTERVAL_MS` (optional, positive integer, default 60 000), and any start-up error (missing/invalid env, malformed trust set, bad PEM) prints exactly one envelope to stderr and exits 1.
- Service-internal refusal reason codes are inline in the unit (house precedent: no contract changes for service-only codes).

**Never:**
- No MCP tools or tool descriptors, no Application binding (4.3), no Guidance serving (4.4), no Read API (4.6), no Collector/Compilation payloads (Epic 6) — this story only records rows.
- No change to the CI Gate runner's `BundleSource` contract or its file seam (wiring the puller into `runGate` is a later story's work).
- No registry, `contract`, `core`, `extractor` or panel changes; no new runtime dependencies; no cross-app imports (the service re-implements the small hash/verify primitives it needs from `contract` + `node:crypto`).
- No pushing; no change to root `compose.yaml` or the registry's compose usage.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First activation | pull 200, verifies ok, no active pointer | pointer row created; one hash-keyed bundle row; outcome ok with hash + sequence | Never throws |
| Newer bundle | verifying bundle with sequence > active | pointer swapped to the new hash in one transaction; old bundle row remains | Never throws |
| Equal-sequence re-pull, same bytes | sequence == active, identical content | pointer unchanged, no second bundle row, no refusal row | Never throws |
| Equal-sequence re-pull, different bytes | sequence == active, recomputed hash ≠ pointer hash | refused `hash_mismatch`; refusal row recorded; pointer unchanged | Never throws |
| Lower sequence | sequence < active | refused `stale_sequence`; refusal row recorded | Never throws |
| Tampered content | any payload/signature byte altered, key id in trust set | refused `signature_failed`; refusal row recorded | Never throws |
| Unknown key id | keyId absent from trust set | refused `unknown_key` before any signature work; refusal row recorded | Never throws |
| Tenant mismatch | payload.tenantId ≠ configured tenant | refused `tenant_mismatch`; refusal row recorded | Never throws |
| Malformed body | body fails the contract guards / unknown format version | refused `shape`; refusal row recorded; pointer unchanged | Never throws |
| Pull denial | 401/403/404 envelope from the registry | pull outcome carries the envelope; store untouched; daemon logs one line | Never crash |
| Transport failure | connection refused / closed mid-read | pull outcome carries a transport reason; store untouched | Never crash |
| Two replicas activate concurrently | two stores over one database, same newer bundle | both report the same active hash; one pointer row; bundle row inserted once | Never throws |
| Stale observed | active bundle age past bound, frozen false | staleness row (hash, sequence, age); the pinned state view reports stale | Never throws |
| Frozen or fresh | frozen true, or age within bound | not stale; no staleness row | Never throws |
| Repeat observation | same (hash, stale) as the last recorded observation | no new staleness row | Never throws |
| Malformed trust set / missing env at start | invalid JSON, wrong PEM type, unset variable | exactly one envelope to stderr, exit 1 | Never a partial start |

</intent-contract>

## Code Map

- `packages/contract/src/bundles.ts` -- reuse: `canonicalJson` (L180), `isSignedStandardBundle` (L159, exact key sets), `isStandardBundlePayload` (L123), `standardBundleLatestPath` (L70), `DEFAULT_STALENESS_HOURS` (L26), payload fields `stalenessHours`/`frozen`. Import only.
- `apps/registry/src/bundles/sign.ts` -- the rules to mirror (cannot import cross-app): `bundleHash` (L15: sha256hex of canonical bytes of the signed object), signature = `cryptoSign(null, bytes, key).toString("base64")` over `canonicalJson(payload)` bytes.
- `apps/registry/src/bundles/service.ts` -- pull semantics the client meets: `latestFor` (bare `SignedStandardBundle` JSON via `sendJson`), 404 `not_found` before the first mutation, 401 `session_invalid` / 403 `role_denied` envelopes; credential format `<tenantId>.<43 base64url>` is registry-internal — the service treats the credential opaquely and takes the tenant from env.
- `apps/service/src/ci-gate/store.ts` -- the store pattern to mirror WITHOUT importing: `InMemoryGateRecordStore` + `PostgresGateRecordStore` twins, `createPool` (L334), `mintUuidV7`, advisory-lock sequence style (`hashLock`, L322), pg row mapping. New unit lives beside it under `apps/service/src/bundles/`.
- `apps/service/src/db/migrate.ts` -- `migrate(client)` applies the migrations ledger idempotently; a new `0002_*.sql` file is picked up automatically.
- `apps/service/migrations/0001_ci_gate.sql` -- service tables are plain (no RLS/grants mirroring needed; service store style), snake_case columns, text ids.
- `apps/service/src/ci-gate/store.postgres.test.ts` -- db-suite harness pattern (`SERVICE_TEST_DATABASE_URL`, throwaway database, `describe.skipIf`); L58 `expect(firstReport).toEqual({ applied: ["0001_ci_gate.sql"], alreadyApplied: 0 })` and L100–102 idempotence counts are the ONLY existing expectations touching migration counts and must be updated for 0002 (compatibility touch).
- `apps/service/src/index.ts` + `apps/service/src/index.test.ts` -- keep `packageName`/`ServiceError` untouched; the bundles unit adds its barrel exports here.
- `apps/registry/src/http/serve-cli.ts` -- start-up pattern to mirror: `required(name)` + one envelope on absence/invalidity; the service has no `EnvelopeError` class, the daemon prints one envelope and exits 1.
- `apps/service/package.json`, `turbo.json`, `.github/workflows/ci.yml` -- `SERVICE_TEST_DATABASE_URL` already wired for db suites; no changes expected. `pg` is the only runtime client.
- Node globals: `fetch` (Node 24+) for the outbound pull; `node:crypto` (`verify`, `createPublicKey`, `createHash`) is allowed in apps (registry precedent).

## Tasks & Acceptance

**Execution:**
- `apps/service/src/bundles/verify.ts` -- NEW pure verification: trust-set type + `bundleHashOf` + `verifyPulledBundle({ raw, tenantId, trustSet, active })` → never-throw outcome (ok with signed bundle/hash/sequence, or a refusal reason from the fixed order); hashes and verifies per the pinned 4.1 rules; strict shape on the wire.
- `apps/service/src/bundles/store.ts` -- NEW `BundleRecordStore` with InMemory + Postgres twins: `getPointer(tenantId)`, `activate(signed, ...)` (one transaction: hash-keyed insert with `on conflict do nothing`, in-transaction hash re-derivation refusing `hash_mismatch`, sequence-guarded pointer swap), `recordRefusal`, `listRefusals`, `recordStalenessObservation`, `listStalenessObservations`, `pinnedBundle(hash)`.
- `apps/service/migrations/0002_standard_bundles.sql` -- NEW `service_bundles` (hash primary key, tenant id, sequence, payload jsonb, key id, signature, issued at), `active_bundle_pointers` (tenant id primary key, hash, sequence), `bundle_refusals` (append-only: id, tenant id, reason, sequence, hash, detail, created at), `bundle_staleness_observations` (append-only: id, tenant id, hash, sequence, stale, age seconds, created at).
- `apps/service/src/bundles/puller.ts` -- NEW pull + orchestration: `pullLatest` (one outbound GET, envelope/transport outcomes), `pullAndActivate` (pull → verify against pointer → record refusal / activate → pinned outcome), `bundledState(store, tenantId, now)` pinned stale/age view (hash, sequence, age, bound, frozen, stale), `observeStaleness` recording per the dedup rule.
- `apps/service/src/bundles/env.ts` -- NEW `bundleServiceConfigFromEnv(env)` + `parseTrustKeys`: required variables, URL validation (http/https), trust set parsing with Ed25519 PEM validation; one envelope-style error per failure (codes `missing_configuration` / `invalid_configuration`).
- `apps/service/src/bundles/service-cli.ts` -- NEW daemon entry: migrate + cycle loop (pull → verify → activate/record → staleness observation), one log line per cycle outcome (ids/codes only), start-up error = one envelope to stderr, exit 1.
- `apps/service/src/index.ts` -- export the bundles unit's public symbols; `index.test.ts` untouched.
- `apps/service/src/ci-gate/store.postgres.test.ts` -- update the two migration-count expectations for 0002 (only compat touch; no runner/seam changes).
- `apps/service/Dockerfile` + `apps/service/compose.yaml` -- NEW one container image (node 24/26 base, pnpm install from the repo-root build context with `--frozen-lockfile`, runs the daemon) plus its own `postgres:18` with a data volume and healthcheck; build context `../..` so workspace imports resolve; the service container publishes NO ports (NFR-12: no inbound toward the vendor); postgres reachable from localhost only, mirroring root compose's local-only-credential comment.
- `README.md` -- short "Service (bundles)" section documenting the daemon env table, compose usage and the store variables.
- `apps/service/src/bundles/verify.test.ts` -- unit tests pinning every verification matrix row (crafted bundles signed with generated Ed25519 keys).
- `apps/service/src/bundles/puller.test.ts` -- outcome tests against a local `node:http` stub serving canned bodies (200/404/401/403/transport/tampered/unknown key), `pullAndActivate` with the InMemory store, staleness + dedup rows.
- `apps/service/src/bundles/bundles.db.test.ts` -- db suite in the ci-gate harness style: migration report, pointer semantics (first/newer/equal/lower/tampered refusal rows persisted), concurrent two-replica same-hash activation and sequence-guard monotonicity, staleness observation rows.

**Acceptance Criteria:**
- Given the daemon configured from the environment, when it runs, then it uses only outbound HTTPS/HTTP toward `SERVICE_VENDOR_URL`, listens on no port, and every verification refusal ends with the pointer unchanged and one append-only refusal row carrying the reason code among `shape`/`unknown_key`/`signature_failed`/`tenant_mismatch`/`hash_mismatch`/`stale_sequence`.
- Given a verified bundle, when it is activated, then the record store holds it one hash-keyed row and points the tenant's active pointer at it swapped in one transaction sequence-guarded, and two service replicas over the same record store report the same active hash.
- Given the active bundle, when its age passes the Buyer-set bound with no freeze, then the pinned view reports stale and an append-only row records the active hash, sequence and age; a frozen bundle never marks stale, and identical repeated observations add no row.
- Given `apps/service` deployment artifacts, when inspected, then `apps/service/Dockerfile` plus `apps/service/compose.yaml` ship one image with its own PostgreSQL 18 record store and the four configured environment sources (vendor URL, tenant credential, tenant id, trust set), with no published port on the service container.
- Given `pnpm --filter @domain-harness/service test` (with `SERVICE_TEST_DATABASE_URL`), `pnpm run boundaries`, `pnpm test`, `pnpm run build`, `pnpm run typecheck` and `pnpm run lint`, when they run, then all pass, no boundary violations, and every I/O matrix row is pinned by a named test run in the verification output — none skipped or filtered (local db-suite skip when no URL is set and CI is unset is acceptable by house convention).

## Spec Change Log

## Review Triage Log

### 2026-10-14 — Review pass
- verdicts: 42 findings — high 0, medium 6, low 18, false 18, maybe-false 0
- findings (blind-hunter B1–B16, edge-case-hunter E1–E12, verification-gap V1–V4, intent-alignment IA1–IA10; shared-root groups logged jointly: B3+E7, B6+E2, B14+E8, B11+E11, E9+V-o1, E4+IA4, B13, B8/V-o2/IA1, B7+V2+IA2):
  - `[medium]` `[patch]` B1 the README's documented path is unusable: compose hardcodes placeholder literals so the README's `export`s are ignored; the daemon starts with an invalid trust set, prints one envelope, exits 1 and crash-loops under `restart: unless-stopped` — Fixed: compose interpolates `${SERVICE_TENANT_CREDENTIAL:-…}` / `${SERVICE_BUNDLE_TRUST_KEYS:-…}` so exported env wins; re-validated with `docker compose config --quiet`.
  - `[medium]` `[patch]` B5 the outbound GET has no timeout; a hung vendor connection wedges the daemon forever — Fixed: exported `PULL_TIMEOUT_MS` (30 s) via `AbortSignal.timeout`, abort maps to the existing `transport_failed` outcome; a test pins the timeout path with a tiny override.
  - `[medium]` `[patch]` B6+E2 shutdown defers a full interval after SIGINT/SIGTERM (compose stop falls to SIGKILL); the second-Ctrl-C sub-claim was refuted (the `once` listener is removed after firing) — Fixed: the interval sleep is signal-aware; the daemon spawn test measures prompt exit (≈164 ms).
  - `[medium]` `[patch]` V1 no test joins the service verifier to the registry's actual signing rule; every service suite verifies bundles produced by the service's own mirror (`test-fixtures.ts`), so mutually-consistent rule drift fails no test and the daemon could refuse every genuine bundle while all suites stay green — Fixed: a golden bundle signed by the registry's real signer (one-off script; the committed fixture carries only the signed JSON + recorded hash + public key PEM, no private key) is pin-tested for acceptance and exact hash re-derivation.
  - `[medium]` `[patch]` B7+V2+IA2 the daemon entry `service-cli.ts` is executed by no test (start-up envelope, migrate-on-start, cycle loop); B7's compose-`--wait` healthcheck sub-point was observed and left unfixed (deployment polish) — Fixed: new spawn-style `service-cli.test.ts` asserting exactly one parseable stderr envelope and exit 1 on malformed trust keys, and (db harness) both migrations applied + first cycle line + SIGTERM exit 0.
  - `[low]` `[patch]` B2 the first import line of `bundles.db.test.ts` joins two import statements on one line — Fixed: split.
  - `[low]` `[patch]` B3+E7 the InMemory twin dedups staleness against the globally last observation while the Postgres twin dedups per tenant, so an interleaved multi-tenant sequence records duplicates only in the InMemory twin — Fixed: per-tenant last-row filter; two-tenant unit test pins parity.
  - `[low]` `[patch]` B4 two replicas concurrently activating equal-sequence different-bytes bundles both pass `decideActivation` off a stale lower pointer; the `unique (tenant_id, sequence)` insert raises 23505 through the never-throw contract — Fixed: the constraint code is caught on that one insert and mapped to a refused `hash_mismatch` ActivationOutcome (rollback, pointer re-read); a Postgres test pins it.
  - `[low]` `[patch]` E1 `SERVICE_PULL_INTERVAL_MS` above 2147483647 passes validation while Node's `setTimeout` clamps such delays to 1 ms, turning the daemon into a hot loop — Fixed: values above 2147483647 are rejected as `invalid_configuration` naming the variable; env test pins the bound.
  - `[low]` `[patch]` E3 the start-failure envelope can be truncated when stderr is a pipe and `process.exit(1)` fires before the write flushes — Fixed: exit happens inside the stderr write callback.
  - `[low]` `[patch]` E4+IA4 activation-stage refusals (re-derivation mismatch, race-lost sequence guard) return outcomes without a ledger row, diverging from the recorded-reason contract — Fixed: `pullAndActivate` records the refusal row (reason, received sequence/hash, activate-stage detail) before returning; a puller test pins the row.
  - `[low]` `[patch]` B13 the `BUNDLE_STALENESS_DEFAULT_HOURS` alias duplicates the contract's `DEFAULT_STALENESS_HOURS` (B13's index-barrel doc-comment sub-point was refuted: only a comment changed, no symbol was touched) — Fixed: alias deleted; the contract constant is used directly.
  - `[low]` `[patch]` B9 no `.dockerignore`; the repo-root build context ships `node_modules`, `.git` and build output to the builder — Fixed: minimal root `.dockerignore` added; the image was rebuilt successfully with it.
  - `[low]` `[reject]` E5 the returned `pointer` of a refused/no-op activation can be a stale pre-race snapshot — race-window-only, a report value (the store's truth is always one `getPointer` away); the fix adds extra reads to two branches, more than a direct correction.
  - `[low]` `[reject]` E6 two replicas racing the first staleness observation can record duplicate rows (check-then-insert has no lock) — a sub-millisecond race yielding one extra ledger row; the fix needs schema changes (partial unique index or advisory lock), disproportionate to the harm.
  - `[low]` `[reject]` B10 the spec's Dockerfile manual-check wording ("no network installs beyond the base image") contradicts the file (corepack + pnpm install) — the only faithful fix edits this build's spec; the build itself was executed successfully twice.
  - `[low]` `[reject]` B12 `pullLatest` buffers the body without a size cap — hostile-registry/MITM on an outbound company-controlled channel; the fix requires streaming guard logic far beyond a direct correction.
  - `[low]` `[reject]` B16 the append-only ledgers have no `(tenant_id, created_at)` index and no documented retention — premature at service-record scale; no everyday harm shown.
  - `[low]` `[reject]` V4 no automated step anywhere validates the image build — the asserted harm (an unbuildable image) is refuted empirically (successful `docker build` twice in this run); CI automation of image builds is orchestration beyond 4.2's ACs.
  - `[false]` B8 the image build cannot work as written (partial manifests vs lockfile importers, corepack non-TTY prompt, dev dependencies) — refuted empirically: `docker build` completed and tagged the image twice.
  - `[false]` B11+E11 `readRefusal` relabels unknown reason strings as `shape`, masking drift — no reachable producer of an unknown reason: the unit's own code is the table's only writer and writes exactly the fixed reason set.
  - `[false]` B14+E8 sequences above 2^53 would round and corrupt the guarded comparison — unreachable: the registry mints sequences from 1 and increments once per accepted mutation of one tenant.
  - `[false]` B15 the env doc's "checked in the declared-variable order" mismatches the interface field order — the evaluation order exactly matches the documented variable order the doc refers to.
  - `[false]` E9+V-o1 a shape-valid `issuedAt` that `Date.parse` rejects (calendar-invalid) drives the Postgres insert with an Invalid Date, throwing per cycle — unreachable from the only real producer (the registry validates and stores `issuedAt` as a real timestamp); the daemon's one `cycle_failed` line keeps it cycling; the fix would add a validation layer beyond the pinned wire contract.
  - `[false]` E10 the trust-set parser accepts an Ed25519 private key PEM because `createPublicKey` extracts its public half — the verification outcome is cryptographically identical; key-type hygiene only.
  - `[false]` E12 `activate` accepts a bundle that never passed `verifyPulledBundle` — documented contract (verify first, then activate); the corruption requires a caller bypassing the delivered program's only caller.
  - `[false]` IA1 AC1 lives at the deployed-image surface which the diff only supplies as text — refuted: the image was built from the delivered artifacts in this run.
  - `[false]` IA3 the refusal cause set/order differs from the verbatim five-use list — the AC fixes no order; the six fixed reasons are anchored in 4.1's own review triage (which assigned received-shape strictness to 4.2) and all five listed causes are covered.
  - `[false]` IA5+IA6 the So-that clause and staleness have no consuming answer/Gate surface — pinned by the compiled epic context: serving surfaces are stories 4.3–4.6 and Gate staleness wiring is a later epic; the rows are recorded "for later Compilation" as the AC itself says.
  - `[false]` IA7 staleness recording withholds duplicate and non-stale observations where the AC's literal wording says record past the bound — "records the active hash, sequence and age" is satisfied on every recorded transition; the dedup is the spec's pinned fail-closed refinement, tested deliberately.
  - `[false]` IA8 the epic says outbound HTTPS but the unit accepts http or https from the environment — the spec pins the permissive scheme reading (TLS termination belongs to deployment, matching 4.1's residual note); the AC's operative phrase is outbound-only, which every test pins.
  - `[false]` IA9 the staleness bound is read in-band only — the only reading consistent with 4.1's design (the bound is compiled into the bundle payload).
  - `[false]` IA10 the "record store" is realized as sibling tables in the shared gate database rather than the gate tables — the compatibility touch (two migration-count expectations) is the spec-authorized overlay; no AC names the gate tables as the pointer's home.

## Design Notes

- **Where the hash expectation comes from.** The bundle carries no hash itself; the registry only serves the latest signed object. The verifier's `hash_mismatch` target is any expectation the service already holds: when the pulled sequence equals the active pointer's sequence, the pointer's hash is the expectation; and inside `activate`, the freshly inserted bundle row is re-read and re-hashed before the swap. A first pull of a higher sequence has no prior expectation — its hash is computed once, stored, and pinned from the store afterwards.
- **Refusal recording.** Verification refusals record rows; pull-side outcomes (envelopes, transport) do not — they are environmental, not verdicts on a bundle.
- **Trust set format.** `SERVICE_BUNDLE_TRUST_KEYS` is a JSON object mapping keyId → PEM public key (Ed25519). Rotation overlaps by key id (AD-11); multiple entries are normal.
- **Compose ports.** The record store's postgres container publishes `127.0.0.1:5433→5432` (distinct from the root compose's 5432 so both can run in one developer machine); the service container publishes nothing and reaches the vendor only over outbound calls.

## Verification

**Commands:**
- `pnpm --filter @domain-harness/service test` (with `SERVICE_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres`) -- expected: verify/puller unit suites and the new db suite pass; the existing ci-gate suites keep passing.
- `pnpm run boundaries` -- expected: no violations.
- `pnpm test` -- expected: the full workspace suite passes.
- `pnpm run build` and `pnpm run typecheck` -- expected: the workspace builds and typechecks (service included).
- `pnpm run lint` -- expected: clean, zero warnings.

**Manual checks (if no CLI):**
- `docker compose -f apps/service/compose.yaml config --quiet` -- expected: the compose file is structurally valid; the service container defines no `ports`; postgres defines only a localhost port mapping.
- `apps/service/Dockerfile` -- expected: builds the service image from a repo-root context, runs the daemon entry, requires no network installs beyond the base image.

## Auto Run Result

**Summary:** Implemented Story 4.2: the Company service's bundle epic. `apps/service` gains a bundles unit that pulls the tenant's latest signed Standard bundle over one outbound `GET` (`standardBundleLatestPath` under the configured vendor URL with the tenant service credential), verifies it strictly on the wire in a fixed order (`shape` via the exact-key contract guards → `unknown_key` → Ed25519 `signature_failed` over the canonical payload bytes → `tenant_mismatch` → `hash_mismatch` against any held expectation → `stale_sequence`), records every verification refusal append-only with its reason, and activates a verified bundle through a record store whose active-bundle pointer is swapped in one transaction (hash-keyed insert with in-transaction re-derivation of the stored bytes, sequence-guarded swap so an older activation can never win; two replicas over one store always report the same active hash). The pinned staleness view (`bundledState`) reports hash, sequence, age, bound and freeze and marks the service stale past the Buyer-set bound with no freeze; `observeStaleness` appends the hash, sequence and age for later Compilation with identical-repeat dedup. The daemon entry (`service-cli.ts`) runs migrate + pull cycles from the environment (`SERVICE_VENDOR_URL`, `SERVICE_TENANT_ID`, `SERVICE_TENANT_CREDENTIAL`, `SERVICE_BUNDLE_TRUST_KEYS`, `SERVICE_RECORD_DATABASE_URL`, optional `SERVICE_PULL_INTERVAL_MS`), signals are handled promptly, and any start-up error prints exactly one envelope and exits 1. Deployment ships one container image (`apps/service/Dockerfile`, built successfully in this run) beside its own PostgreSQL 18 record store in `apps/service/compose.yaml` with no published port on the service container (NFR-12 outbound-only). The CI Gate's `BundleSource` seam was intentionally untouched (wiring is a later story's work); compatibility touching was limited to the two migration-count expectations in its db suite.

**Files changed:**
- `apps/service/migrations/0002_standard_bundles.sql` — `service_bundles` (hash primary key, unique (tenant_id, sequence)), `active_bundle_pointers`, append-only `bundle_refusals`, `bundle_staleness_observations`.
- `apps/service/src/bundles/verify.ts` — `verifyPulledBundle` (fixed refusal order, never-throw), `bundleHashOf` (4.1's hash rule mirrored via `contract.canonicalJson`), trust-set types, Ed25519 PEM check.
- `apps/service/src/bundles/store.ts` — `BundleRecordStore` with InMemory + Postgres twins: pointer get, one-transaction activate (hash-keyed insert, in-transaction re-derivation, 23505 race mapped to a refused outcome, sequence-guarded swap), refusal and staleness ledgers (per-tenant dedup in both twins), `pinnedBundle`.
- `apps/service/src/bundles/puller.ts` — `pullLatest` (one outbound GET, bounded by `PULL_TIMEOUT_MS`, envelope/transport/invalid-body outcomes), `pullAndActivate` (records refusal rows at both verify and activate stages), `bundledState` + `observeStaleness` (dedup).
- `apps/service/src/bundles/env.ts` — `bundleServiceConfigFromEnv` + `parseTrustKeys`: one envelope per start-up failure (`missing_configuration` / `invalid_configuration`; interval bounded ≤ 2147483647).
- `apps/service/src/bundles/service-cli.ts` — the daemon (migrate + cycle loop, signal-aware sleep, flush-safe one-envelope start failure, one ids/codes log line per cycle).
- `apps/service/src/bundles/test-fixtures.ts` + `golden-signed-bundle.json` — crafted-signed-bundle fixtures; the golden bundle is signed by the registry's real signer (cross-reimplementation drift pin).
- `apps/service/src/bundles/{verify,env,puller}.test.ts` — every I/O matrix row pinned (refusal order, tamper, unknown key, tenant, hash, sequence, staleness incl. frozen and dedup, timeout, twins parity, in-activation re-derivation).
- `apps/service/src/bundles/bundles.db.test.ts` — PostgreSQL-18 suite: migration report, pointer semantics with persisted refusal rows, 23505-race refusal, two-replica concurrent same-hash activation + sequence-guard monotonicity, staleness rows.
- `apps/service/src/bundles/service-cli.test.ts` — spawn suite: one-envelope exit 1 on malformed trust keys; migrate-applied first cycle + SIGTERM exit 0.
- `apps/service/src/ci-gate/store.postgres.test.ts` — migration-count/table-list expectations updated for 0002 (only compat touch).
- `apps/service/src/index.ts` — barrels the bundles unit's public symbols.
- `apps/service/Dockerfile`, `apps/service/compose.yaml`, `.dockerignore` — one image (built in this run, twice) + own `postgres:18` with localhost-only port; service container publishes no ports; env interpolation so exported configuration wins.
- `README.md` — "Service (bundles)" section: daemon env table, cycle semantics, compose usage, store variables.
- `_bmad-output/implementation-artifacts/spec-4-2-company-service-pulls-verifies-and-activates-bundles.md` — this spec.

**Review findings:** 42 findings — 6 medium, 18 low, 18 false, 0 maybe-false. Thirteen patch groups were applied after re-engaging the implementation subagent (compose exponential placeholders for the documented path; outbound fetch timeout; signal-aware shutdown; golden cross-implementation signature fixture; daemon spawn tests; InMemory per-tenant dedup; 23505 race mapped to a refused outcome; interval upper bound; flush-safe start-failure envelope; activate-stage refusal rows; joined import line; redundant alias deletion; root `.dockerignore`). Nine low findings were rejected with recorded reasons; eighteen were refuted as false — notably the image-build claims, which were tested by actually building the image twice (base image pull, corepack, `pnpm install --frozen-lockfile` all succeed). Nothing deferred. The verification-gap layer's second main finding and the intent-alignment auditor's surface divergences are folded into the grouped rows above (daemon spawn tests, golden fixture, activate-stage refusal rows); the auditor reported no misgraded intent readings.

**Follow-up review recommendation:** `true` — five medium patch groups were applied. The specific risks worth one fresh review pass: (a) the golden-fixture pin (V1 patch) binds the service verifier to one historic registry-signed bundle — a future registry-side change to the signing rule is caught only by the registry's own suites plus fixture regeneration, never by service-side tests against a live registry; (b) the daemon's long-run behavior (many cycles against a real registry, two replicas observing a staleness transition near-simultaneously) has never executed end-to-end in this run beyond a one-cycle smoke and the subagent's stub smoke; (c) compose was validated structurally and interpolated both ways, but no full `docker compose up` brought the stack live.

**Verification performed:**
- `SERVICE_TEST_DATABASE_URL=… pnpm --filter @domain-harness/service test` — 11 files / 102 tests passed (both db suites against real PostgreSQL 18 via the Docker container), re-run after the patch pass.
- `SERVICE_TEST_DATABASE_URL=… REGISTRY_TEST_DATABASE_URL=… pnpm exec turbo run test --force` — full workspace, uncached: 12/12 tasks successful, re-run after the patch pass.
- `pnpm run boundaries` — no violations.
- `pnpm exec turbo run build --force` / `typecheck --force` / `lint --force` — all clean (lint at zero warnings).
- `docker build -f apps/service/Dockerfile -t dh-service-4-2:test .` — completed and tagged (twice: before and after the `.dockerignore` patch); `docker compose -f apps/service/compose.yaml config --quiet` — valid both with and without exported env.
- Matrix test audit: all 16 I/O matrix rows mapped to named, freshly-run passing tests (verify matrix, puller cycle matrix incl. denials/transport, activation matrix in the db suite, staleness/dedup rows, env start-failure matrix + the new spawn suite); none skipped or filtered (local db-suite skip without `SERVICE_TEST_DATABASE_URL` when `CI` is unset follows the house convention; the URL was set for every run in this report).

**Residual risks:**
- No test runs against a live HTTPS registry: every suite exercises an in-process stub, and TLS termination remains deployment's job (4.1 residual note carried).
- The golden fixture pins the historic registry signing rule; registry-side rule drift is caught by the registry's own suites (regenerate the fixture if the rule ever changes, or service and registry can drift apart otherwise).
- Two replicas racing the first staleness observation can record duplicate dedup rows (rejected as sub-millisecond, one extra ledger row); activation-stage pointer values in refused outcomes may be a pre-race snapshot (rejected; `getPointer` is the truth).
- A shape-valid payload with a calendar-invalid `issuedAt` would make each Postgres activation fail with a `cycle_failed` log line instead of a refusal row (rejected as unreachable from the real producer).
- `compose up --wait` reports success while the service container has no healthcheck (observed, left unfixed); a stack with placeholder credentials crash-loops by design until configuration is supplied.
- The service record tables are plain (no RLS), mirroring the CI Gate's 0001 style; tenant scoping relies on the single-tenant credential model.
- The CI Gate's bundle seam is still the 5.3 file seam; wiring `runGate` to the active-bundle pointer and serving staleness through the Gate are later stories' work.

