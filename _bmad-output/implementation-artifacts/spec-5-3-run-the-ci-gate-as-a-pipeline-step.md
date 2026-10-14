---
title: 'Story 5.3: Run the CI Gate as a pipeline step'
type: feature
created: '2026-10-13'
status: done
review_loop_iteration: 0
followup_review_recommended: true
baseline_revision: 'ffa6aeb8bd4f2438b891e9089d4e789a11ab4077'
context:
  - _bmad-output/implementation-artifacts/epic-5-context.md
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** The extractor (5.1) and the core evaluator (5.2) exist, but nothing runs them as the Company pipeline step: no surface reads the identification file, computes the repository fingerprint, pins a bundle, stores a Gate-run record or fails the pipeline on an open Deviation.

**Approach:** Add a Gate runner to `apps/service` that, called with identity facts and revision files, pins the bundle snapshot it was given, evaluates through `@domain-harness/core` on the service clock with the extractor's facts, records the Gate run (with the per-Application sequence) and a Binding refusal where identity fails, and classifies the outcome so a runner adapter can print it. Ship a GitHub Action composite (`apps/service/ci-gate/action.yml`) whose entry (`gate-cli.ts`) reads the identification file, computes the fingerprint per AD-19 from git, collects tracked files for the extractor, calls the runner, prints the UX-DR29 sentence(s) plus one line per Deviation, and exits non-zero exactly when an open Deviation or a refusal exists. The service records the runs in its own Postgres-backed record store (the seam the CI job reaches by database URL; the Company runner protocol from Epic 4 will replace the snapshot-file seam).

## Boundaries & Constraints

**Always:**
- Evaluation comes only from `@domain-harness/core` (`evaluateDeviations`) and facts only from `@domain-harness/extractor`; the service never re-implements either and never reads or re-sorts their output.
- The runner pins the bundle snapshot once at start (hash + effective set + applications list + accepted deviations + staleness bound and freeze from the snapshot) and evaluates and reports only what it pinned; a later activation of a different snapshot never leaks into the finished run.
- The service clock (one `new Date().toISOString()` per run) is the `now` passed to `evaluateDeviations`; the core never reads a clock.
- The service record store owns the per-Application sequence: append-only `gate_runs` with (Application id, revision, pinned bundle hash, extractor version, Deviations, checked and open counts), and the sequence is store-assigned, monotonic per Application, starting at 1.
- Identity follows AD-19 exactly: Application id from `.domain-harness.json` (parsed with `parseIdentificationFile`), fingerprint = SHA-256 of the root commit SHA (`git rev-list --max-parents=0 HEAD`), TOFU binding in the record store; a bound id presented with a different fingerprint is refused, recorded as a Binding-refusal record and fails the step.
- Fail closed: every refusal (missing/unreadable identification file, unbound Application id, duplicate Application id, Effective Standard set that fails `isEffectiveStandardSet`, stale past the snapshot's bound with no live freeze, evaluation that does not complete) prints its single UX-DR29 sentence and exits non-zero, never a pass; a failure of the step itself (unreachable record store, missing/unparseable bundle snapshot, missing environment) prints one text reason and exits non-zero, never a silent skip.
- The step never writes the working tree or HEAD; the never-throws result-union style and `ErrorEnvelope` errors govern, and exact UX-DR29 sentences live in one constants module with no plan name in any printed text.

**Never:**
- No bundle pull, signature verification, key/trust-set logic or active-pointer activation (Epic 4); the runner consumes the pinned snapshot handed to it.
- No accepted-deviation authoring, no acceptance store (story 5.5), no MCP/HTTP serving, no CLI Gate (Epic 8), no fixture-determinism suite (story 5.4).
- No contract or core/extractor package changes; no registry changes; no new runtime dependencies beyond `pg` and `drizzle-orm` (as in `apps/registry`).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Pass | Valid identity, bound ok, valid set, no open Deviation | `pass` sentence, exit 0, gate-run record stored with pinned hash | None |
| Fail (open Deviation) | One or more Deviations with `status: open` | `fail` sentence, one log line per Deviation (Standard id + correction), exit non-zero, record stored | None |
| Accepted only | All findings accepted and unexpired at the snapshot's acceptances | `pass` sentence, exit 0, record stores the accepted statuses | None |
| Missing id file | No `.domain-harness.json` at the root | refusal sentence, exit non-zero, no gate-run record | None |
| Unbound id | Id absent from the pinned snapshot's applications | refusal sentence, exit non-zero, no gate-run record | None |
| Duplicate id | Bound id presented with a different fingerprint | refusal sentence, exit non-zero, Binding-refusal record stored | None |
| First use | Id seen for the first time | binding created (TOFU), run proceeds | None |
| Set unreadable | The pinned set fails `isEffectiveStandardSet` | refusal sentence, exit non-zero, no gate-run record | None |
| Stale | Snapshot older than its bound with no live freeze | stale sentence, exit non-zero, no gate-run record | None |
| Frozen | Freeze covering `now` past the bound | run proceeds (not stale) | None |
| Mid-run activation | The bundle source returns a newer snapshot after pinning | hash evaluated and recorded is the pinned one | None |
| Run did not complete | `evaluateDeviations` returns `ok: false` or throws | refusal sentence, exit non-zero, no gate-run record | caught, never crash |
| Step cannot run | Record store unreachable, bad snapshot file, missing env | one text reason, exit non-zero | caught, never crash |

</intent-contract>

## Code Map

- `packages/core/src/evaluate.ts` -- `evaluateDeviations({ applicationId, facts, effectiveSet, accepted, now })`; reuse point: `EvaluateResult { ok, deviations, checked, open, adherence }`.
- `packages/extractor/src/index.ts` -- `extractRevisionFacts(files: Record<path, content>)` (L598); the entry supplies tracked-file contents and appends `{ path, reason }` rows to `facts.unreadable` for files it could not read (fail closed, never skip silently).
- `packages/contract/src/identification-file.ts` -- `parseIdentificationFile`, `IDENTIFICATION_FILE_NAME`; missing/unreadable map to the matching refusal.
- `packages/contract/src/effective.ts` -- `isEffectiveStandardSet` (L80) gates the pinned set ("Effective Standard set could not be read").
- `apps/registry/src/db/{client,migrate}.ts` and `src/tenancy/tenancy.db.test.ts` -- the store/test style to mirror but NOT import (cross-app imports are forbidden): own `pg` pool, throwaway database per suite, `describe.skipIf` + CI-fails-when-unset; the service's tables get plain names (registry db suites use throwaway per-test databases, so there is no name collision).
- `apps/service/src/index.ts` -- keep `packageName`/`ServiceError`; do not disturb.
- `apps/service/ci-gate/action.yml` -- NEW: composite action; exactly one run step invoking the entry with `node --conditions=@domain-harness/source`, plus the engine/pnpm setup steps a fresh runner needs; inputs mirror the environment (`SERVICE_RECORD_DATABASE_URL`, `SERVICE_ACTIVE_BUNDLE_FILE`).
- `pnpm-workspace.yaml` / `turbo.json` / `.github/workflows/ci.yml` -- the registry pattern for a DB-env var (`REGISTRY_TEST_DATABASE_URL`); the service store's tests use `SERVICE_TEST_DATABASE_URL` in the same style (CI sets it to the same Postgres 18 URL).

## Tasks & Acceptance

**Execution:**
- `apps/service/src/ci-gate/sentences.ts` -- One constants module: the fixed UX-DR29 sentence for pass, fail, unbound, missing or unreadable identification file, duplicate Application id, run did not complete, Effective Standard set could not be read, bundle stale, bundle verification failed, and one plain reason line for "the step cannot run". No sentence names a plan.
- `apps/service/src/ci-gate/bundle.ts` -- `ActiveBundleSnapshot { hash, issuedAt, applications, effectiveSet, accepted, stalenessBoundHours, frozenUntil }` (the bound defaults to 24 h per AD-21 when the snapshot omits it) and `BundleSource` (async supplier with `verify-failed` and missing-set outcomes). First-cut seam only; Epic 4 owns the real bundle format in `contract`.
- `apps/service/src/ci-gate/fingerprint.ts` -- `computeRepositoryFingerprint(root)`: root-commit SHA via one git call, SHA-256; no commit yields the unbound outcome; never throws.
- `apps/service/src/ci-gate/store.ts` -- `GateRecordStore` (in-memory implementation exported) and the Postgres implementation: append-only `gate_runs`, TOFU `application_bindings`, `binding_refusals`; store-assigned per-Application sequence; migration file `apps/service/migrations/0001_ci_gate.sql`; mint record ids locally as UUIDv7.
- `apps/service/src/ci-gate/runner.ts` -- `runGate(input { applicationId, repoFingerprint, facts, revision, now?, source, store })`: pin the snapshot (exactly one `source()` call), validate identity and set, evaluate via core on the service clock, bind/record as needed, persist completed runs, return a never-throwing outcome union carrying the exact sentence, exit-code disposition, the deviation log lines (each with Standard id, conflict slot and subject in a paste-friendly fixed format) and the recorded fields.
- `apps/service/src/ci-gate/gate-cli.ts` -- The Action entry: resolve repository root, read and parse the identification file, compute the fingerprint, revision = the gated repository's current HEAD SHA (`git rev-parse HEAD`), collect tracked files (`git ls-files`), run the extractor, load the bundle snapshot from `SERVICE_ACTIVE_BUNDLE_FILE`, call `runGate` with a Postgres store from `SERVICE_RECORD_DATABASE_URL`, print exactly what the outcome says, exit per disposition.
- `apps/service/ci-gate/action.yml` -- Composite action wiring the entry as one step with the documented inputs and default env names.
- `apps/service/src/ci-gate/*.test.ts` -- Unit tests for the I/O matrix rows (runner in-memory store + fake bundle source + fake clock), sentence-constant pinning, fingerprint (scratch git fixture with and without commits), and the db suite for the Postgres store (sequences per Application, append-only, TOFU binding, duplicate refusal recorded) using `SERVICE_TEST_DATABASE_URL` in the registry db-suite style (skipped locally without it; fails CI when CI is set without it).
- `apps/service/src/ci-gate/gate-cli.test.ts` -- End-to-end test against a scratch git repository: running the entry produces the right sentence and exit code for pass / fail / refusal causes, leaves `git status --porcelain` and HEAD unchanged, and for a small tracked reference revision completes in under 60 s; printed output never names a plan.
- `apps/service/package.json`, `turbo.json`, `.github/workflows/ci.yml` -- add `pg`/`drizzle-orm` dependencies, `SERVICE_TEST_DATABASE_URL` to the test env and CI env.

**Acceptance Criteria:**
- Given a revision and a pinned bundle snapshot, when the action runs, then it reads the identification file, computes the repository fingerprint per AD-19, extracts facts with the extractor, and calls the service's Gate runner, which evaluates with `core` on the service clock and stores a Gate-run record (Application id, revision, pinned bundle hash, extractor version, Deviations, checked and open counts, store-assigned per-Application sequence).
- Given the evaluated result, when it is printed to the step log, then each Deviation shows its Standard id and one Correction instruction naming the Standard and a compliant alternative, and the step exits non-zero exactly when an open Deviation exists.
- Given a missing or unreadable identification file, an unbound id, a duplicate id from another fingerprint, an unreadable Effective Standard set, a stale snapshot without a live freeze, or a run that did not complete, when the step runs, then it prints the matching single UX-DR29 sentence and exits non-zero, never a pass.
- Given a newer bundle becomes available after the runner pinned its snapshot, when the run finishes, then it evaluated, reported and recorded the hash it pinned at start.
- Given any run, when it finishes, then the working tree and HEAD are unchanged, and a small tracked reference revision completes in under 60 s; the log never names a plan.
- Given the step cannot run (unreachable record store, missing or unparseable snapshot file, missing environment), when the pipeline executes it, then it prints one text reason and exits non-zero, never a silent skip.
- Given `pnpm test`, `pnpm run build`, `pnpm run lint` and `pnpm run boundaries`, when they run, then the full workspace suite passes with no boundary violations and the service db suite runs against the provided PostgreSQL 18.

## Spec Change Log

## Review Triage Log

### 2026-10-14 — Review pass
- verdicts: 26 findings — high 0, medium 7, low 16, false 3, maybe-false 0
- findings:
  - `[medium]` `[patch]` action.yml cannot run on a fresh runner: the composite invokes gate-cli.ts, which imports workspace packages and pg, but installs no dependencies (blind-hunter, intent-alignment) — fixed by adding corepack pnpm enablement and `pnpm install --frozen-lockfile` from the repo root before the gate step.
  - `[medium]` `[patch]` First-use TOFU binding trusts without verifying: bindApplication's returned binding is ignored, so a concurrent first-use run with a different fingerprint can win the slot while this run proceeds, and identity state is touched before facts are validated (blind-hunter, edge-case-hunter ×2) — fixed by verifying the returned binding (refusing with a recorded Binding-refusal when a concurrent run won the slot) and moving facts validation before any store identity call; negative tests added (in-memory store double returning a different fingerprint).
  - `[low]` `[patch]` gate-cli hardcodes the "unbound Application" string on the no-commit path instead of the shared constant (blind-hunter) — fixed to print the UNBOUND sentence constant.
  - `[low]` `[patch]` `git ls-files` without `-z` mis-parses quoted/non-ASCII paths and per-line trim mangles real filenames (blind-hunter, edge-case-hunter) — fixed with `ls-files -z` split on NUL, no trim.
  - `[low]` `[patch]` `facts.unreadable` merge sorted with locale-dependent `localeCompare` (blind-hunter) — fixed with code-point comparison.
  - `[low]` `[reject]` A malformed snapshot's fields (accepted/stalenessBoundHours) map to "bundle stale" instead of "bundle verification failed" (blind-hunter, edge-case-hunter) — fail-closed holds (non-zero, never pass); the sentence distinction is cosmetic, Epic 4's verifier owns bundle-field integrity, and adding snapshot-field validation adds guard logic for no shown defect.
  - `[low]` `[reject]` hashLock could overflow int4 or cause lock collisions (blind-hunter) — refuted: `pg_advisory_xact_lock` takes bigint so the absolute value is accepted, and a collision only merges advisory-lock contention between two Applications; the sequence is still computed inside the lock, per Application.
  - `[low]` `[patch]` A recordBindingRefusal failure is swallowed while the duplicate refusal still prints (blind-hunter) — fixed by propagating the failure into the existing run-did-not-complete path.
  - `[medium]` `[patch]` Alias bloat across sentences/store/bundle/runner (multiple names for the same constants, methods and outcome fields) plus the unused db/client.ts and drizzle-orm dependency (blind-hunter) — fixed by trimming every alias export/method/field to the primary surface, deleting client.ts and removing drizzle-orm from package.json.
  - `[low]` `[patch]` gate-cli skips migration and connectivity checks, so an unmigrated or unreachable record store surfaces as "run did not complete" instead of the step-cannot-run reason (blind-hunter, edge-case-hunter, intent-alignment ×2) — fixed with a pre-flight idempotent migrate plus `select 1`, mapping infrastructure failures to STEP_CANNOT_RUN on stderr; in-run store failures keep their existing mapping.
  - `[low]` `[reject]` TOFU binding would be permanently persisted for runs later aborted on invalid facts (edge-case-hunter) — fixed as part of the binding-decisions fix above (facts validation now precedes identity state), so the remaining claim is moot.
  - `[false]` A snapshot dated in the future with a live freeze proceeds to evaluate (edge-case-hunter) — refuted: freeze covering `now` exempts the bundle from the bound regardless of age, which is the freeze's semantics; without a freeze the same snapshot refuses with bundle-stale.
  - `[low]` `[patch]` An empty-string GITHUB_WORKSPACE is accepted as the root (edge-case-hunter) — fixed with trim plus cwd fallback.
  - `[low]` `[reject]` migrate's rollback failure masks the original transaction error (edge-case-hunter) — mirrors the registry migrate's existing inTransaction shape; the fix would deviate from sibling code for an edge requiring a dropped connection exactly between failure and rollback.
  - `[low]` `[patch]` The default 24-hour staleness bound is untested when `stalenessBoundHours` is omitted or null (verification-gap) — added cases pinning pass within 24 h and bundle-stale past it for both variants.
  - `[low]` `[patch]` The unreadable-tracked-file fail-closed path is untested end-to-end and the fail case never asserts the Correction instruction on the CLI's stdout (verification-gap, intent-alignment) — added an e2e case (chmod 000 / unparseable package.json) asserting "run did not complete", non-zero exit and no run record, and extended the fail case to assert the correction text.
  - `[false]` The runner stays internal to index.ts with the active bundle/stale modeled as file fields, diverging from the "service" surface (intent-alignment) — refuted: the plan pins the in-process reading; the spec's Design Notes document the in-process step and the BundleSource seam, Epic 4 owns HTTP serving and the real bundle, and nothing in the intent demands a network surface in 5.3.
  - `[false]` Mid-run activation is exercised only at unit level (intent-alignment) — refuted: the pinned-hash guarantee lives in the runner contract (exactly one source call; recorded hash = pinned hash), and the CLI reads the snapshot file once by design, so a mid-run file swap is unobservable at that surface.
  - `[medium]` `[patch]` Store-unreachable failures print "run did not complete" rather than the step-cannot-run reason (edge-case-hunter, intent-alignment) — fixed in the store-readiness group above.

## Design Notes

- **Why a snapshot-file seam.** Story 5.3 lands before Epic 4, which owns pull/verify/activate. The runner's `BundleSource` abstraction is the seam: Epic 4's puller becomes the production `BundleSource` and the file seam stays for fixtures and story 5.4's direct adapter. The snapshot already carries the acceptance list, staleness bound and freeze the core needs, so 5.5 can thread its store through the existing inputs without a new seam.
- **In-process step.** The pilot action runs the service's Gate runner in-process inside the CI job against the Company record database; the record store is the Company-owned Postgres, so the run record lives inside the Company environment per AD-3/AD-16.
- **Paste format for 5.5.** Deviation log lines are one line each in a fixed format carrying (Standard id, conflict slot, subject), so the Accepted-deviation surface can pre-fill from a pasted CI line.

## Verification

**Commands:**
- `pnpm --filter @domain-harness/service test` -- expected: new and existing service tests pass; the db suite runs against PostgreSQL 18 (`SERVICE_TEST_DATABASE_URL`).
- `pnpm test` -- expected: the full workspace suite passes.
- `pnpm run build` -- expected: the workspace builds (service included).
- `pnpm run typecheck` -- expected: no type errors.
- `pnpm run lint` -- expected: no violations (zero warnings).
- `pnpm run boundaries` -- expected: no boundary violations.

**Manual checks (if no CLI):**
- `apps/service/ci-gate/action.yml` references the entry file and both documented inputs; no printed sentence names a plan.

## Auto Run Result

**Summary:** Implemented Story 5.3: a CI Gate for the pilot GitHub pipeline. `apps/service/src/ci-gate/runner.ts` runs the Gate: it pins the bundle snapshot exactly once from a `BundleSource` seam (the file snapshot carried by the action today, Epic 4's puller later), validates identity per AD-19 (identification file + SHA-256 root-commit fingerprint, TOFU binding with duplicate-id refusal recorded as a Binding refusal), checks staleness past the snapshot bound (default 24 h, AD-21) with freeze handling, evaluates through `@domain-harness/core` on the service clock, persists the Gate run (Application id, revision, pinned bundle hash, extractor version, Deviations, checked/open counts, store-assigned per-Application sequence) into a Postgres-backed record store (`gate_runs`, `application_bindings`, `binding_refusals` via `apps/service/migrations/0001_ci_gate.sql`), and returns a never-throwing outcome carrying the exact UX-DR29 sentence, exit disposition and paste-friendly deviation lines. `gate-cli.ts` is the Action entry (identification file, fingerprint, `git ls-files -z` revision collection, extractor, snapshot file, record store readiness, printing and exit codes) wired through the composite action `apps/service/ci-gate/action.yml`.

**Files changed:**
- `apps/service/src/ci-gate/sentences.ts` — the fixed UX-DR29 sentence constants and the step-cannot-run reason.
- `apps/service/src/ci-gate/bundle.ts` — `ActiveBundleSnapshot`, `BundleSource`, `loadBundleSnapshot`, `applicationIdsOf`, `DEFAULT_STALENESS_BOUND_HOURS`.
- `apps/service/src/ci-gate/fingerprint.ts` — `computeRepositoryFingerprint` (SHA-256 of the root commit; unbound without a commit; never throws).
- `apps/service/src/ci-gate/ids.ts` — local UUIDv7 minting for record ids.
- `apps/service/src/ci-gate/store.ts` — `GateRecordStore` with in-memory and Postgres implementations (TOFU bindings, binding refusals, append-only gate runs with per-Application sequences).
- `apps/service/src/ci-gate/runner.ts` — `runGate` orchestration, outcome union and deviation line formatting.
- `apps/service/src/ci-gate/gate-cli.ts` — the Action entry script.
- `apps/service/ci-gate/action.yml` — composite GitHub Action (Node 24, pnpm install, gate run).
- `apps/service/src/db/migrate.ts`, `apps/service/migrations/0001_ci_gate.sql` — idempotent schema ledger and the three tables.
- `apps/service/src/ci-gate/{sentences,fingerprint,runner,store.postgres,gate-cli}.test.ts`, `test-fixtures.ts` — unit, db and end-to-end suites; fixtures shared.
- `apps/service/package.json`, `apps/service/tsconfig.build.json`, `turbo.json`, `.github/workflows/ci.yml`, `pnpm-lock.yaml` — new runtime deps (pg), project references, DB env wiring for `SERVICE_TEST_DATABASE_URL` / `SERVICE_RECORD_DATABASE_URL` and the CI env.
- `_bmad-output/implementation-artifacts/spec-5-3-run-the-ci-gate-as-a-pipeline-step.md` — this spec.

**Review findings:** 26 findings — 7 medium, 16 low, 3 false. Nineteen findings across eleven grouped patch entries were patched (composite-action dependency install, TOFU race + validation ordering + refusal persistence, store-readiness pre-flight mapping infra failures to the step-cannot-run reason, alias/dead-code trimming with client.ts and drizzle-orm removed, ls-files -z, code-point sort, UNBOUND constant reuse, empty-workspace fallback, default-bound and unreadable-file/correction-line test coverage). Six low findings were rejected with recorded reasons (malformed-snapshot sentence distinction, hashLock overflow/collisions, rollback masking); three findings were refuted as false (freeze semantics with a future issue date, in-process seam vs remote service, unit-level mid-run activation). Nothing deferred. Verdict-count note: the patch entries group 19 rows into 11 distinct fixes.

**Follow-up review recommendation:** `true` — four medium patch entries were applied. Unverified risks: the composite action's full runtime path (pnpm install step + gate run) has never executed on a real GitHub runner (no test executes `action.yml`), and the TOFU race is pinned only through an in-memory store double, not a concurrent Postgres-level test.

**Verification performed:**
- `pnpm run build` — all 8 build tasks successful (service now depends on contract, core and extractor).
- `pnpm run typecheck` — all 12 tasks successful.
- `pnpm test` (full workspace, with `SERVICE_TEST_DATABASE_URL` and `REGISTRY_TEST_DATABASE_URL` against PostgreSQL 18) — 12/12 tasks successful; service suite: 6 files, 38 tests passed (registry 738, panel 374, contract 272, core 95, extractor 16, boundaries 17 also green).
- `pnpm run lint` — clean at zero warnings.
- `pnpm run boundaries` — no violations.
- Matrix test audit: all 13 I/O matrix rows verified against named, freshly-run passing tests (runner unit rows, gate-cli end-to-end rows, db suite); none skipped or filtered.

**Residual risks:**
- The action's step runs the Gate in-process against the record database, so migration is applied by the pre-flight check; a database the CI job cannot reach still fails the step loudly (never a silent skip).
- The bundle snapshot file seam is pilot-only; Epic 4 must replace it with pull/verify/activate and the real `contract` bundle format, and fingerprint/binding conventions that Epic 4 versioned in `contract` are currently local-first-cut implementations in `apps/service`.
- `gate-cli.ts` supplies all tracked files to the extractor; very large repositories pay that read cost against the 60 s target.
- Component detection remains the permissive 5.2 heuristic; this story adds no scoping of which specifiers are design-system references.
