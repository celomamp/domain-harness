---
title: 'Story 5.4: Prove Gate determinism across adapters'
type: 'feature'
created: '2026-10-14'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
baseline_revision: '3e2cbdf3f35b31b5f809bbe4339d2d5a8332916c'
context:
  - _bmad-output/implementation-artifacts/epic-5-context.md
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** The extractor (5.1), the core evaluator (5.2) and the CI Gate (5.3) exist, but nothing proves NFR-1: that the same revision and bundle always produce byte-identical Gate results no matter which adapter runs the Gate. Only isolated per-case tests guard each path today, and the fixture set Epic 8's CLI Gate must reuse lives nowhere shared.

**Approach:** Add a new workspace package `@domain-harness/gate` — the Gate surface every adapter shares: the fixed UX-DR29 sentences (moved verbatim from `apps/service/src/ci-gate/sentences.ts`, which re-exports them so the landed surface and its pinning test keep working unchanged), a canonical Gate result (kind, exit code, sentence, deviation lines, Deviations, counts, pinned hash) with a byte serializer, the direct in-process Gate adapter (peer tokens: extractor facts + `evaluateDeviations` on a supplied clock, with the refusal classification mirrored from the service runner), and the deterministic fixture suite (revisions, bundle snapshots, clock inputs) covering every Deviation type, acceptance before/within/after the acceptance window, and every refusal both compared paths share. `apps/service` then runs every fixture through the service runner path (`runGate`) and the direct adapter and asserts byte-identical canonical results; the workspace test job already runs on every push, so the suite rides existing CI with no new workflow wiring.

## Boundaries & Constraints

**Always:**
- Byte-identity is asserted on one canonical serialized form (fixed key order): kind, exit code, sentence, deviation lines, Deviations (sorted core output, untouched), checked, open, adherence, pinned bundle hash. Store-assigned sequence and binding-refusal payload are record-keeping, not part of the run's observable result, and are excluded from the byte form (their behavior stays covered by 5.3's suites).
- The direct adapter reuses `@domain-harness/extractor` and `@domain-harness/core` for facts and evaluation exactly as the service path does, and never re-sorts, re-implements or post-processes the evaluator's output; its own classification logic (source outcome mapping, unbound/set/staleness refusals, binding-ledger checks) mirrors `runGate`'s order and fail-closed semantics.
- Each fixture isolates exactly one cause: no fixture combines two refusal triggers, so parity is decided by the one cause each fixture carries.
- Fixtures are plain transferred data (record of file contents, identity, snapshot-shaped bundle, clock) and the whole suite runs in-process with no database and no environment variables; it must pass anywhere, including a fresh clone before anything is built.
- Both compared paths consume identity post-parse (the resolved Application id): the identification file and its missing/unreadable refusal belong to the Action entry before either compared path starts (covered by 5.3's e2e), so parity here is judged on the runner-level surface the paths share.
- The suite also proves per-fixture expectations (kind and refusal reason) so byte-equality cannot pass vacuously, and repeats runs for pure determinism.

**Never:**
- No changes to behavior in `apps/service/src/ci-gate/` beyond `sentences.ts` re-exporting the package constants and package.json/tsconfig wiring; `runner.ts`, `gate-cli.ts`, `bundle.ts`, `store.ts` stay untouched.
- No new runtime dependency anywhere except the new workspace package; no Postgres, no database in the fixture suite; no GitHub Actions workflow changes (CI already runs the workspace tests on every push).
- No CLI Gate implementation, no offline bundle loading, no npm packaging (Epic 8); no bundle pull/verify/activate (Epic 4); no acceptance authoring or alert scheduling (5.5/5.6). The identification-file and step-cannot-run refusals of the Action entry stay where 5.3's end-to-end suites cover them (the compared paths begin after identity parsing).
- No invented bundle format: fixtures use the first-cut `ActiveBundleSnapshot` field shapes from 5.3 plus the source-outcome variants (`verify-failed`, `missing-set`).

## I/O & Edge-Case Matrix

| Fixture scenario | Input / State | Expected classification (both paths) | Error Handling |
|----------|--------------|---------------------------|----------------|
| Pass | Valid identity, fresh binding ledger, valid set, no findings, revision files clean | `pass` sentence, exit 0 | None |
| Fail — each Deviation kind | Revision files whose extracted facts violate one per case: prohibited, missing-required, version-constraint, prohibited-token, missing-required-token, prohibited-import, missing-required-import, component-outside-allow-list | `fail` sentence, exit 1, one deviation line each | None |
| Accepted live | Acceptance window containing `now` | finding is `accepted`, run can `pass` | None |
| Accepted before start / after end | `now` before `start`, and `now` at/after `end` | finding is `open` again (fail closed) | None |
| Unbound | Application id absent from the snapshot, or empty fingerprint | unbound sentence, exit 1, no run record side effects asserted | None |
| Duplicate | Ledger already bound to a different fingerprint | duplicate sentence, exit 1, binding refusal recorded on both paths | None |
| First use | Ledger empty for the id | binding created, run proceeds to its evaluation outcome | None |
| Set unreadable | Snapshot set that fails `isEffectiveStandardSet` | set-refusal sentence, exit 1 | None |
| Stale / frozen | Snapshot past its bound with no live freeze; the frozen variant covers `now` | stale sentence, exit 1; frozen variant proceeds (not stale) | None |
| Verify-failed / missing-set source outcomes | bundle source outcome variants 5.3 defines | bundle-verification-failed / set-refusal sentence, exit 1 | None |
| Run did not complete | Facts carry unreadable rows (garbage `pnpm-lock.yaml`), or the set holds two Standards in one Conflict slot (`slot_conflict`) | run-did-not-complete sentence, exit 1, never a pass | caught, never crash |

</intent-contract>

## Code Map

- `packages/contract/src/deviations.ts` — `Deviation` (7 fields), `AcceptedDeviation` key + `start`/`end` window; the byte form carries these as produced by core.
- `packages/contract/src/effective.ts` — `isEffectiveStandardSet` (L80′ish); refuses malformed sets before evaluation; note it does NOT check slot uniqueness (two Standards may legally share a slot for the guard) — that is what makes the `slot_conflict` → run-did-not-complete fixture land at evaluation.
- `packages/contract/src/standards.ts` — `CodeStackEntry` (`status` approved/prohibited/required, `versionConstraint`, `correctionInstruction`), `ComponentEntry`/`TokenEntry`/`ImportEntry` (`kind` discrimination), `isDesignSystemEntry` (L261).
- `packages/core/src/evaluate.ts` — `evaluateDeviations({ applicationId, facts, effectiveSet, accepted, now })` (L285); result `{ ok, deviations(sorted+deduped), checked, open, adherence }` (L59); `slot_conflict` rejection L309–323; acceptance matching `start <= now < end` (L254).
- `packages/extractor/src/index.ts` — `extractRevisionFacts(files: Record<path, content>)` (L598): package.json manifest (L59), pnpm-lock subset parser (L387, malformed → unreadable), TS/JS import specifiers (L544), token references `var(--x)` (L567); returns sorted facts + `unreadable` rows; never throws.
- `apps/service/src/ci-gate/runner.ts` — the service path to prove against: check order source → unbound (L98) → set guard (L102) → stale (L119) → facts guard (L123) → binding/TOFU (L127) → evaluate → `appendGateRun`; outcome union `RunGateOutcome` (L32) is the mapped source for the canonical form.
- `apps/service/src/ci-gate/sentences.ts` — the UX-DR29 strings to move verbatim into the new package; this file becomes a re-export (its `sentences`/`SentenceKey` shapes preserved) so `sentences.test.ts` and all importers keep passing.
- `apps/service/src/ci-gate/bundle.ts` — `ActiveBundleSnapshot` field shape and the `loadBundleSnapshot` outcome variants (`verify-failed`, `missing-set`) fixtures reproduce data-wise; the service test feeds them through a snapshot `BundleSource`, the direct adapter reads the same variant tagged on the fixture.
- `apps/service/src/ci-gate/store.ts` — `GateRecordStore` methods the runner uses (`getBinding`, `bindApplication`, `recordBindingRefusal`, `appendGateRun`); `createInMemoryGateRecordStore` (factory, seed bindings by pre-binding with a fingerprint) drives the service path; the new package's ledger interface mirrors the binding subset the direct adapter needs.
- `apps/service/src/ci-gate/{runner.test,test-fixtures}.ts` — fixture-building style (`buildCodeStackStandard`, `makeSnapshotFixture`, `FIXTURE_*` ids) to mirror in package-shared, richer form; `test-fixtures.ts` stays service-local (design-system fixtures move into the shared suite).
- `pnpm-workspace.yaml` (`packages/*` glob), `turbo.json` (generic tasks), root `tsconfig.json` (reference list L7-11), `apps/service/tsconfig.build.json` (references block), `apps/service/package.json` — the wiring points for a new package and the new service dependency (add `@domain-harness/gate: workspace:*`, root + service tsconfig references, `pnpm install` for the lockfile).
- `apps/cli/` — scaffolded Epic 8 home ("Offline CLI Gate"); establishing the shared package now is what makes 8.x's reuse of this suite unchanged possible (no-cross-app-imports forbids apps importing apps).

## Tasks & Acceptance


**Execution:**
- [x] `packages/gate/package.json`, `packages/gate/tsconfig.build.json`, `packages/gate/tsconfig.json`, `packages/gate/eslint.config.js` -- NEW: `@domain-harness/gate`, `exports "."` with the `@domain-harness/source` condition, runtime deps exactly `@domain-harness/contract`, `@domain-harness/core`, `@domain-harness/extractor`; mirror a sibling package's wiring lists above.
- [x] `packages/gate/src/sentences.ts` -- the fixed UX-DR29 sentence constants moved verbatim (same names, same strings, same doc comments, `sentences` map and `SentenceKey` included). `apps/service/src/ci-gate/sentences.ts` becomes a re-export of this module; the service's sentence-pinning test proves no drift.
- [x] `packages/gate/src/result.ts` -- `GateOutcome` (kind pass/fail/refusal, refusalReason or null, exitCode, sentence, deviationLines, deviations, checked, open, adherence, pinnedHash) and `canonicalGateBytes(outcome): string`: JSON.stringify over an explicitly constructed fixed-key-order object; the one serializer the byte comparison uses.
- [x] `packages/gate/src/binding.ts` -- `BindingLedger` (getBinding / bindApplication / recordBindingRefusal, structurally the store's binding subset) + `createInMemoryBindingLedger(seeded)`.
- [x] `packages/gate/src/fixtures.ts` -- the fixture suite: name, Application id, fingerprint, revision files, bundle (snapshot variant, verify-failed or missing-set), clock `now`, expectation `{ kind, refusalReason }`. Build with kebab-free plain ids: dedicated `GATE_*` UUID ids, one Standard per scenario plus acceptances, design-system fixtureStandards per 5.2's shapes.
- [x] `packages/gate/src/direct.ts` -- `runGateDirect({ applicationId, repoFingerprint, files, bundle, ledger, now })`: extract facts via the extractor, classify refusals in the runner's exact order and fail-closed semantics, evaluate via `evaluateDeviations` with the supplied clock, return `GateOutcome`; never throws.
- [x] `packages/gate/src/{fixtures.test.ts,direct.test.ts}` -- fixture self-tests: expectation guard per fixture (each expected kind/reason actually produced by the direct path), repeated-run byte equality, input-reorder equality (standards array, accepted array, files map key order), determinism of the full suite across two whole-suite runs.
- [x] `apps/service/src/ci-gate/determinism.test.ts` -- the cross-adapter proof: for every fixture, run `runGate` (in-memory store, snapshot-source, clock = fixture `now`, binding seeded from the same fixture state) and `runGateDirect`, assert `canonicalGateBytes` equal byte-for-byte, also assert classification matches the fixture expectation; verify the fixture coverage (every Deviation kind from `DEVIATION_KINDS`, both acceptance sides, every runner refusal) by enumeration so a missing scenario fails the suite.
- [x] `apps/service/package.json`, root `tsconfig.json`, `apps/service/tsconfig.build.json`, `pnpm-lock.yaml` -- dependency and reference wiring for the new package and the service's determinism test.

**Acceptance Criteria:**
- Given the fixture suite (revisions, bundle snapshots and clock inputs covering every Deviation type, acceptance before and after the end, and every refusal both compared paths share), when the suite runs through the service Gate runner path (`runGate`) and through the direct in-process adapter path, then every fixture's `canonicalGateBytes` output is byte-identical between the two paths.
- Given any fixture, when either path runs, then refusal causes print their exact UX-DR29 sentence and exit 1 (never a pass), failures exit 1 with the fail sentence and one line per open Deviation, and passes exit 0 — identical on both paths.
- Given the same fixture run twice, or any fixture input array re-ordered, when the suite runs, then the canonical bytes are unchanged (determinism is asserted, not assumed).
- Given the moved sentence module, when the service's sentence-pinning suite and every CI Gate suite run, then all pass unchanged, and the broken text cannot drift (one shared source).
- Given the workspace, when CI runs (`pnpm test` on every push, Node 24 and 26), then the new package's suites and the deterministic fixture suite run without a database or additional environment and pass alongside the existing suites, and Epic 8's CLI can drive the same suite unchanged through `runGateDirect`.
- Given `pnpm run build`, `pnpm run typecheck`, `pnpm run lint` and `pnpm run boundaries`, when they run, then the full workspace suite passes, no boundary violations, and the new package imports only contract, core and extractor.

## Spec Change Log

- [x] Fixture suite (22 fixtures) covers every matrix row; `isFixtureCoverageComplete` enforces enumeration.

## Review Triage Log

| # | Layer | Finding | Verdict (cached triage) | Evidence / route |
|---|-------|---------|--------|------------------|
| 1 | blind | `MISSING_IDENTIFICATION_FILE`/`STEP_CANNOT_RUN` absent from reasons/fixtures; test name overstates coverage | false | Those two refusals belong to the Action entry / gate-cli, not `runGate`; `runGate`'s refusal sentences are exactly the six in `REFUSAL_SENTENCE_BY_REASON`, all covered. Spec explicitly keeps the Action-entry refusals in 5.3's e2e. |
| 2 | blind | Service `appendGateRun` failure → run-did-not-complete while direct returns pass/fail (undocumented divergence) | false | Spec defines the shared ledger as the binding subset only ("no gate-run storage"); run-recording is each adapter's own side effect; `createInMemoryGateRecordStore` in the suite never throws on append, so the case is unreachable in the compared surface. |
| 3 | blind; edge ×3 | `runGateDirect` crashes (violates documented "never throws") on null bundle or `{variant:"snapshot"}` without a snapshot record: spread cannot throw, but `bundle.snapshot` is then dereferenced → `applicationIdsOf(undefined)` throws | medium (verified) — patch | Read `direct.ts` L791–807: the try/catch wraps only the spread; `{variant:"snapshot"}` without `snapshot` reaches `snapshot.applications` on undefined. Service path refuses malformed records verify-failed (`bundle.ts` L45–66). Fix: guard the snapshot record, classify like the service, extend never-throws test. |
| 4 | blind | Try/catch around `extractRevisionFacts` is dead defensive code with an unmirrored catch path | false | Spec Code Map: the extractor "never throws"; when it doesn't throw both paths behave identically; if it ever did, the direct path failing closed is the correct adapter semantics, not a divergence. |
| 5 | blind | `createInMemoryBindingLedger` refusals unobservable; four hand-rolled spy ledgers in tests | low — rejected | Refusal recording is already behavior-proven via spies; an accessor would add public package surface (not a trivial correction) and Epic 8 can add one when it needs it. |
| 6 | blind; v-gap ×2; edge | Staleness-window parity unpinned: no fixture omits `stalenessBoundHours` (the `?? 24` default exists as two independently evolvable constants), no fixture has a future `issuedAt`, an expired `frozenUntil`, or unparseable dates; demonstrated: changing the gate constant 24→48 keeps every suite green | medium (verified by v-gap's concrete demonstration) — patch | Fixture suite reaches only issuedAt-2h, issuedAt-48h-stale, issuedAt-48h-frozen. Add plain-data fixtures (omitted bound + 25h age → stale; future issuedAt → stale; expired frozenUntil → stale) flowing both byte loops. |
| 7 | blind | No multi-deviation fixture, so cross-adapter ordering/dedup unverifiable for >1 open entry | false | Matrix explicitly fixes "one deviation line each" per fail fixture; both paths copy the evaluator's output untouched (core owns sorting/dedup), so ordering parity for any count is structural, not adapter behavior. |
| 8 | blind | Vacuous trailing `toBeDefined()` loop in the byte-comparison test | low — patch | Pure test padding; deleting it is a direct correction with no behavioral surface. |
| 9 | blind | First-use binding write side effect never asserted (no `getBinding` after the run) | low — patch | True: the TOFU write is unchecked by this suite; smallest fix is a `getBinding` assertion after `first-use-binds` on both paths. |
| 10 | blind | Duplicate-binding verification asymmetric: service record only length-checked, service `bindingRefusal` payload never compared to the direct record | low — patch | True asymmetry in the same test; compare payloads on both sides. |
| 11 | blind | Mirrored helpers should be extracted/shared to close drift window | false | Spec's Design Notes mandate mirroring ("sharing one classification would make the suite vacuous") and the Never list keeps `runner.ts`/`bundle.ts` untouched. |
| 12 | blind; edge | Pre-bound empty-string fingerprint silently accepted (guard mirrored), branch untested | false | The guard is identical on both paths (copied semantics of the landed 5.3 surface); a seeded empty binding behaves identically on both adapters, so no divergence exists. |
| 13 | blind | `REFUSAL_SENTENCE_BY_REASON` not tied to the sentences map; future sentence → silently incomplete maps | false | The map's values are the imported sentence constants, so string drift propagates automatically; non-shared Action-entry sentences intentionally have no reason. Direct/coverage tests enumerate the map keys. |
| 14 | blind | `formatDeviationLine` duplicated instead of re-exported | false | Spec's Never list keeps `runner.ts` untouched; the fail fixtures compare `deviationLines` as part of the canonical bytes, so drift fails the suite. |
| 15 | blind | `RunGateDirectInput.applicationId: UuidV7 \| string` widens the typed contract | false | Exact mirror of `RunGateInput` (`runner.ts` L23) so both adapters accept the same calling conventions. |
| 16 | blind | `duplicate.boundFingerprint ?? GATE_FINGERPRINT_B` dead fallback masks a future fixture revision | low — patch | Dead expression in the same test; remove it. |
| 17 | blind | "Epic 8's CLI reuses this suite unchanged" claimed but untested | false (today) | No CLI Gate code exists yet (Epic 8); the claim describes future reuse enabled by the boundary rules, which `pnpm run boundaries` already enforces. |
| 18 | blind | `canonicalGateBytes` spreads `deviationLines` but references `deviations` — inconsistent treatment | false | Output of `JSON.stringify` is identical for both; cosmetic only, zero observable effect. |
| 19 | edge | `stalenessBoundHours` of 0/negative/non-finite silently always-stale, no guard | false | Identical expression on both paths (`runner.ts` L106 vs `direct.ts` mirror); fail-closed (stale refusal) either way, semantics that 5.4 must not change. |
| 20 | edge | Junk `getBinding` record with non-string fingerprint: refusal payload gets `boundFingerprint: undefined` | false | Same guard (`fingerprint !== "" && fingerprint !== repoFingerprint`) on both paths; a junk ledger is caller error outside both adapters' contracts; no divergence. |
| 21 | edge | Padded fingerprint (`" abc"`) evades trim guard, evading duplicate check | false | `trim() === ""` guard is identical on both paths (landed 5.3 semantics); 5.4 may not change service behavior. |
| 22 | edge | Doc claim "classification mirrors runner" weakened: no snapshot-record validation in direct adapter → malformed bundles diverge outside fixture inputs | low — rejected | A malformed *record* would diverge, but `GateBundle`'s contract hands the direct adapter an already-variant-tagged, well-formed snapshot (the fixtures' and spec's data-space); guarding deformed records adds a new branch beyond the spec's matrix. |
| 23 | edge | Acceptance "after end" strictly (now > end) never pinned; only the at-end instant | false | Core's comparator `start <= now < end` makes at-end and beyond-end the same uncovered branch; the entry instant `now < end` false is exercised by `accepted-at-end`, so no distinct behavior exists to pin. |
| 24 | v-gap | (Other) Throwing source → `run-did-not-complete` on service vs `bundle-verification-failed` mapping on direct | false | The direct catch wraps the spread, which cannot throw on plain data; no reachable input produces the divergence. The crash on missing snapshot is triaged separately (#3). |
| 25 | v-gap | (Other) Confirms record-keeping exclusion is still covered by 5.3 suites | false | Not a finding; positive confirmation. |
| 26 | v-gap | The fail-closed binding-ledger failure catch (run-did-not-complete) never exercised by any suite | medium — patch | Verified by trace: every suite supplies a healthy ledger; the catch is unreachable. Add a rejecting-ledger case in `direct.test.ts` asserting the exact sentence and exit 1 (mirror of `runner.test.ts`'s store-failure coverage). |

Routing (grouped by root cause, no intent_gap / bad_spec):
- **patch A** (#3): snapshot-record guard + never-throws test extension.
- **patch B** (#6): staleness parity fixtures (omitted bound, future issuedAt, expired frozenUntil).
- **patch C** (#26): rejecting-ledger integrity test.
- **patch D** (#9, #10, #16): binding-parity assertion strengthening in `determinism.test.ts`.
- **patch E** (#8): remove the vacuous trailing loop.

## Design Notes

- **Why a new package.** Nothing in the workspace can host shared fixtures today: `no-cross-app-imports` and `no-imports-from-apps` keep each app leaf-sized, `apps/cli` (Epic 8's home) is scaffolded with contract-only deps, and `packages/contract` must stay dependency-free (core and extractor import it; the direct adapter needs core + extractor, so contract can never host it). A package exactly on the existing layer seam (contract → core/extractor → gate → apps) keeps the CLI and service on one source of truth.
- **Why compare at the canonical result, and what "byte-identical" means.** Each path returns its own rich shape (`RunGateOutcome`, `GateOutcome`); the comparison pulls both through one serializer with fixed key order built for the observable Gate result: the printed sentence and deviation lines, the exit code, and the deviations/counts/pinned hash. The store sequence is assigned by the record store, the binding-refusal payload is record-keeping, and neither changes with adapter choice; both are excluded from the byte form but still behavior-tested per 5.3.
- **Why mirror classification instead of sharing it.** 5.4's theorem is that two independently assembled adapters agree; sharing one classification would make the suite vacuous. The suite is the guard: if either path's ordering or text drifts, every affected fixture fails byte comparison. Single-cause fixtures (one refusal trigger per fixture) make each failure point at its cause.
- **Acceptance-window fixtures** follow the core's contract: live while `start <= now < end`; the end instant itself is open again (that is part of the key's semantics in `evaluate.ts` L256 and pinned by a fixture).

## Verification

**Commands:**
- `pnpm --filter @domain-harness/gate test` -- expected: fixtures, direct adapter and determinism suites pass with no database required.
- `pnpm --filter @domain-harness/service test` -- expected: service suites pass including the new cross-adapter determinism suite, against PostgreSQL 18 via `SERVICE_TEST_DATABASE_URL` for the existing db suites.
- `pnpm test`, `pnpm run build`, `pnpm run typecheck`, `pnpm run lint`, `pnpm run boundaries` -- expected: the full workspace suite passes (12+ tasks), zero lint warnings, no boundary violations.

**Manual checks (if no CLI):**
- `apps/service/src/ci-gate/sentences.ts` contains only the re-export; `packages/gate/src/sentences.ts` holds the exact 5.3 strings (diff the texts).
- The service test enumerates `DEVIATION_KINDS` fully; every fixture appears in the byte-comparison loop.
