---
title: 'Story 8.2: Run the Gate locally with the same result as CI'
type: 'feature'
created: '2026-10-15'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - _bmad-output/implementation-artifacts/epic-8-context.md
warnings:
  - oversized
deferred: []
baseline_commit: '7f06576adb85499abfe4eecfdffe441e09710409'
baseline_revision: '7f06576adb85499abfe4eecfdffe441e09710409'
---

<intent-contract>

## Intent

**Problem:** `apps/cli` verifies a bundle file offline (story 8.1) but cannot evaluate a revision against it: Builders must push to learn the CI Gate verdict, and there is no local proof that the same revision and bundle produce the same result on both paths.

**Approach:** Add a `domain-harness gate` command that reuses 8.1's verifier on the bundle file, adapts the verified wire bundle into a Gate snapshot (resolving the Effective Standard set through `core` exactly as the service does), reads the identification file, computes the repository fingerprint, collects tracked revision files, runs the shared `runGateDirect` adapter from `@domain-harness/gate` against a local binding file, prints the sentence plus one line per open Deviation, and exits like the CI step — proving parity by running the story 5.4 fixture suite through the same function.

## Boundaries & Constraints

**Always:**
- Verify first with 8.1's `loadBundleFile` (same paths, trust file, tenant, last-seen state, clock): verification failure prints exactly `bundle verification failed` exit 1; a stale bundle prints exactly `bundle stale` exit 1. The gate never evaluates an unverified bundle.
- Adapt the verified `SignedStandardBundle` into a `GateBundleSnapshot` with service-identical semantics: `hash` is 8.1's verified hash; `issuedAt` is `payload.issuedAt`; `applications` are the payload application ids; `accepted` is `payload.acceptedDeviations`; `stalenessBoundHours` is `payload.stalenessHours`; `frozen: true` maps to `frozenUntil` covering the run (the run clock), `frozen: false` maps to `null`.
- Resolve the Effective Standard set only through `core` (`resolveEffectiveSet` with holders from `entrySlot`, locked ids from `tree.lockedRules`, project id resolved from the bundle's application entry by the identification file's Application id); hydrate winners from the payload's own `StandardInfo` records in `core`'s order. Never re-sort, filter, or re-implement resolution or evaluation output.
- Evaluate only through `runGateDirect` from `@domain-harness/gate` (which runs `extractor` + `core` in process); print the outcome sentence first then one `formatDeviationLine` line per open Deviation; exit 0 only on pass (no open Deviation), exit 1 otherwise. Host output never names a plan.
- Identity mirrors the CI entry: Application id from `.domain-harness.json` via `parseIdentificationFile` (missing or unreadable prints exactly `missing or unreadable identification file`, exit 1; the advisory project id is never used); fingerprint is SHA-256 of the root-commit SHA (no commit prints exactly `unbound Application`, exit 1); the local binding file binds trust-on-first-use and a bound id presented with a different fingerprint prints exactly `duplicate Application id`, exit 1, recording the refusal.
- Revision collection mirrors the CI entry: tracked files via `git ls-files -z` under the root (default the current directory), read as UTF-8; files that cannot be read become `{ path, reason }` rows that force `run did not complete` only when the run would otherwise pass or fail (earlier refusals keep CI precedence); a `git` failure that is not the no-commit case prints `run did not complete`, exit 1.
- The working tree and HEAD are never modified; state writes (bundle pointer, binding file) go to explicit paths defaulting under the user cache dir, never the revision. Every unit never throws; every refusal is an explicit non-zero exit, never a silent pass.

**Never:**
- No network calls; no record store, no Gate-run recording, no per-Application sequence (Epic 6 collector scope — `runGateDirect` needs no gate-run storage by design).
- No changes to `packages/contract`, `packages/core`, `packages/extractor`, `packages/gate`, `apps/service`, `apps/registry`, or `apps/panel`; no new runtime dependencies beyond the `@domain-harness/core` workspace link (the CLI already links `contract` and `gate`).
- No npm packaging or `--version` surface (story 8.3); no bundle verify-command behavior changes (8.1 stays byte-identical).
- No plan names in any output; no evaluation of an unverified, tenant-mismatched, or replayed bundle (the 8.1 guards stay in front).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Pass | valid bundle + trust, bound ok, no open Deviation | `pass`, exit 0 | No error expected |
| Fail open | revision violates a Standard | `fail` + one line per open Deviation (Standard id, slot, subject, Correction), exit 1 | No error expected |
| Accepted only | every finding accepted and unexpired per bundle acceptances | `pass`, exit 0 | No error expected |
| Missing id file | no `.domain-harness.json` at root, or unreadable content | `missing or unreadable identification file`, exit 1 | Fail closed |
| Unbound id | id absent from bundle applications, or no root commit | `unbound Application`, exit 1 | Fail closed |
| Duplicate id | bound id presented with a different fingerprint | `duplicate Application id`, exit 1, refusal recorded in binding file | Fail closed |
| First use | id never seen in binding file | binding recorded, run proceeds | No error expected |
| Set unreadable | resolution fails (slot conflict, project not in tree) | `Effective Standard set could not be read`, exit 1 | Fail closed |
| Stale bundle | issue time past bound, `frozen: false` (incl. future/unparseable) | `bundle stale`, exit 1 | Fail closed |
| Frozen bundle | `frozen: true`, old issue time | run proceeds (not stale) | No error expected |
| Bad bundle | tampered, unknown key, tenant mismatch, replay, malformed | `bundle verification failed`, exit 1, state unchanged | Fail closed |
| Unreadable revision file | tracked file cannot be read, run otherwise pass/fail | `run did not complete`, exit 1 | Fail closed |
| Unreadable plus earlier refusal | unreadable file and unbound/stale/duplicate/set cause | the earlier refusal sentence wins (CI precedence) | Fail closed |
| Usage defect | bad flags, missing required flag, unparseable `--now` | `run did not complete`, exit 1, nothing written | Fail closed |
| Any run | scratch repo before/after | `git status --porcelain` empty and HEAD unchanged | Fail closed |

</intent-contract>

## Code Map

- `packages/gate/src/direct.ts` -- reuse only: `runGateDirect(input { applicationId, repoFingerprint, files, bundle, ledger, now })` (L86), the exact in-process adapter the command calls; refusal order source → unbound → set guard → stale → facts guard → binding/TOFU → evaluate; never throws.
- `packages/gate/src/result.ts` -- reuse only: `canonicalGateBytes` (L92) for the parity proof, `formatDeviationLine` (L112) for Deviation lines, `REFUSAL_SENTENCE_BY_REASON`.
- `packages/gate/src/sentences.ts` -- the only refusal/pass/fail strings the CLI prints; never invent sentence text.
- `packages/gate/src/fixtures.ts` -- reuse unchanged: `gateFixtures`, `isFixtureCoverageComplete`, `GATE_*` ids; the parity suite runs every fixture through the CLI's gate function.
- `packages/gate/src/binding.ts` -- `BindingLedger` (L23) interface the file store implements; `createInMemoryBindingLedger` (L34) for fixture tests.
- `packages/core/src/resolve.ts` -- `resolveEffectiveSet` (L71) for wire-to-snapshot resolution; deterministic order, never re-sorted downstream.
- `packages/core/src/slots.ts` -- `entrySlot` (L70) mapping each payload Standard to its holder slot (the `serve.ts` precedent).
- `packages/core/src/evaluate.ts` -- `evaluateDeviations` (L285) via `runGateDirect`; `accepted` windows and UTC-ISO clock rules inherited.
- `packages/extractor/src/index.ts` -- `extractRevisionFacts(files)` (L598) via `runGateDirect`; unreadable rows force `run did not complete`.
- `packages/contract/src/identification-file.ts` -- `IDENTIFICATION_FILE_NAME` (L18), `parseIdentificationFile` (L76); missing/unreadable map to the matching refusal.
- `packages/contract/src/effective.ts` -- `isEffectiveStandardSet` (L80) guard shape; `EffectiveStandard` hydration target (slot, status or null for components, standard, sourceProject, locked).
- `packages/contract/src/bundles.ts` -- wire shapes consumed read-only: `StandardBundlePayload` (L50: standards, tree, applications, acceptedDeviations, stalenessHours, frozen, issuedAt), `SignedStandardBundle` (L65).
- `apps/service/src/ci-gate/gate-cli.ts` -- the surface to mirror without importing: ident read, fingerprint, `git ls-files -z` collection with unreadable rows, snapshot load, sentence-then-lines print order (L144), exit per disposition; no DB/store/revision in the CLI.
- `apps/service/src/ci-gate/fingerprint.ts` -- `computeRepositoryFingerprint` (L8) to re-implement in the CLI (root-commit SHA via one git call, SHA-256 hex; no commit is unbound; never throws); cross-app imports are forbidden.
- `apps/service/src/ci-gate/runner.ts` -- refusal order and outcome-shape reference; the CLI path must agree per single cause.
- `apps/service/src/guidance/serve.ts:285` -- `effectiveSetInputOf`: holders/locked-dedup mapping precedent for the adaptation.
- `apps/cli/src/bundle-file.ts` -- consume only: `loadBundleFile` (L112) verification front-door, `bundleHashOf` (L63) pinned-hash source; behavior unchanged.
- `apps/cli/src/bundle-state.ts` -- atomic JSON store precedent (temp file plus rename, corrupt-tolerant reads) for the binding file.
- `apps/cli/src/cli.ts` -- extend: `domain-harness gate` dispatch beside `bundle verify`, cache-dir default-path pattern `defaultStatePath` (L39), `isCliEntryPoint` (L160) already win32-safe; `parseVerifyArgs` style (last-wins, `=` forms, Date.parse clock check) reused for gate flags.
- `apps/cli/src/index.ts` -- barrel re-exporting the new gate units (keeps `packageName`).
- `apps/cli/package.json`, `apps/cli/tsconfig.build.json`, `pnpm-lock.yaml`, root `tsconfig.json` -- add `@domain-harness/core: workspace:*` (resolution only; `extractor` stays indirect through `gate`).
- `.dependency-cruiser.cjs` -- no rule restricts `apps/cli` package imports (only panel/registry/core/extractor are pinned); CLI importing `core` plus `contract` plus `gate` stays clean under `no-cross-app-imports`.
- `apps/service/src/ci-gate/determinism.test.ts`, `gate-cli.test.ts` -- test patterns to mirror: per-fixture canonical-bytes comparison, scratch-git-repo e2e with pristine-tree pins.

## Tasks & Acceptance

**Execution:**
- `apps/cli/src/gate-snapshot.ts` -- NEW pure adaptation `adaptWireBundleToSnapshot({ signed, hash, applicationId, now })` returning ok with a `GateBundleSnapshot` or `unbound` / `set-unreadable` with the exact shared sentence and exit 1: look up the application entry for the project id (absent is unbound); build holders and locked ids per the serve.ts precedent; resolve via `core`; hydrate winners from payload `StandardInfo` (status null for components, `sourceProject` from the winning Standard's own scope ref, set project ref from the tree by id); map `frozen: true` to `frozenUntil: now` and `false` to `null`; never throws.
- `apps/cli/src/binding-file.ts` -- NEW file-backed `BindingLedger`: JSON `{ bindings: { appId: fingerprint }, refusals: [...] }`, atomic write (temp file plus rename), corrupt or missing file reads as an empty ledger for parity with the 8.1 state precedent; `readBinding`/`writeBinding` helpers plus `createFileBindingLedger(path)`; never throws.
- `apps/cli/src/gate.ts` -- NEW `domain-harness gate --bundle <path> --trust-keys <path> --tenant <uuidv7> [--root <dir>] [--binding <path>] [--state <path>] [--now <iso>]`: plain argv parsing (same style as verify), root defaulting to cwd, binding default `domain-harness/binding.json` beside the state default, clock default the current time; `collectRevisionFiles(root)` (ident read, fingerprint, `ls-files -z`, UTF-8 reads with unreadable rows); `runGateCommand(argv, deps?)` orchestrating verify → adapt → `runGateDirect` with the unreadable-override rule (override to `run did not complete` only when the adapter passed or failed); prints sentence then open-Deviation lines; returns exit code; never throws.
- `apps/cli/src/cli.ts`, `index.ts` -- extend dispatch to route `gate` argv to the new command (verify path untouched) and re-export the new units.
- `apps/cli/src/gate-snapshot.test.ts` -- adaptation vectors with generated Ed25519 keys plus registry-signed golden shape: valid hydration (ids, accepted, bound, frozen), unknown app id (unbound), slot-conflict and off-tree project (set-unreadable), frozen-old (proceeds), custom `stalenessHours` honored, exact-boundary ages.
- `apps/cli/src/binding-file.test.ts` -- TOFU first bind, same-fingerprint pass-through, corrupt-file tolerance, atomic-write and refusal-append behavior; temp directories only.
- `apps/cli/src/gate.test.ts` -- command matrix (pass, fail with Correction lines, every refusal sentence plus exit codes, usage defects, unreadable-ordering precedence, stale-before-gate precedence), full `gateFixtures` reuse through the CLI gate function asserting pinned kind/sentence/exit, and wire-bundle parity cases proving canonical bytes equal `runGateDirect` on the equivalent snapshot; scratch git repos in temp dirs, no network, no database.
- `apps/cli/src/gate-e2e.test.ts` -- scratch-repo end-to-end: pass and fail runs print the CI-identical lines and exit codes while `git status --porcelain` stays empty and HEAD is unchanged; state and binding files live in temp dirs outside the repo.

**Acceptance Criteria:**
- Given a local revision with an identification file and a verified bundle file, when `domain-harness gate` runs fully offline, then it runs `extractor` and `core` in process, prints each Deviation with its Standard id and Correction instruction, prints pass or fail, and exits zero only when every Deviation is absent or accepted and unexpired.
- Given the local binding file, when an id is first seen, then it is bound to the repository fingerprint; a different fingerprint presenting it prints exactly `duplicate Application id` with exit 1 and records the refusal; missing, unreadable or unbound identification files each print their sentence with exit 1.
- Given the story 5.4 fixture suite, when it runs through the CLI adapter, then every fixture's canonical bytes match the pinned expectation, and wire-bundle parity cases match `runGateDirect` on the equivalent snapshot byte for byte.
- Given any run, when it finishes, then the working tree and HEAD are unchanged.
- Given `pnpm --filter @domain-harness/cli test`, `pnpm run build`, `pnpm run typecheck`, `pnpm run lint`, and `pnpm run boundaries`, when they run, then all pass with no violations, the CLI imports only `contract`, `gate`, `core` plus Node built-ins, and no CLI test touches the network or a database.

## Spec Change Log

## Review Triage Log

### 2026-10-15 — Review pass (four layers: blind-hunter 17, edge-case-hunter 6, verification-gap 3, intent-alignment 7)
- verdicts: 33 findings — high 0, medium 3, low 18, false 12, maybe-false 0
- findings:
  - `[false]` `[reject]` adaptation hash unchecked for 64-hex (blind) — Refuted: the `hash` argument is 8.1's verified `bundleHashOf` output (always 64-hex) on the only reachable call path; the defensive guard is for the exported function's own inputs.
  - `[false]` `[reject]` empty/garbage adaptation inputs conflate defects; unparseable `now` passes (blind) — Refuted: `parseGateArgs` rejects a non-finite `Date.parse(clock)` before the command reaches adaptation, and the empty-value branches are unreachable defensively.
  - `[low]` `[reject]` duplicate Standard ids collapse in the `byId` map last-wins (blind) — Verified mechanism, but duplicate ids require a corrupt/hand-crafted bundle that validated registry writes cannot produce, and core tolerates same-id holders by construction; not worth a guard.
  - `[false]` `[reject]` unknown locked ids unvalidated (blind) — Refuted: core ignores locked ids that match no Standard (documented tree rule) and the derivation is the `serve.ts` verbatim precedent.
  - `[low]` `[reject]` `sourceProject` hydrated without tree membership (blind) — Verified, but a Standard's own `project` ref is payload-authored and matches the scoping model; a dangling ref needs a corrupt bundle and fails closed downstream.
  - `[low]` `[reject]` `writeBinding` ignores a failed disk write (blind) — Same root cause as the edge-case unwritable-binding row; grouped. Requires a disk write failure; the best-effort persist is the precedent pattern and the risk is a re-bind, fail-closed on the next fingerprint mismatch.
  - `[low]` `[reject]` binding values and refusals without field validation (blind) — Verified, but fingerprints are minted internally and reads filter non-strings; malformed file entries skip rather than misbehave.
  - `[low]` `[reject]` file ledger read-modify-write without locking (blind) — Same root cause as the edge-case concurrency row; grouped. Sequential CLI use; locking is complexity beyond a direct correction.
  - `[false]` `[reject]` multi-root history fingerprints one root (blind) — Refuted: the re-implementation mirrors the service `fingerprint.ts` verbatim, which the parity mandate requires.
  - `[low]` `[reject]` every fingerprint failure maps to unbound (blind) — Verified, but the spec ties the fingerprint step to the no-commit case and any other git failure is fail-closed exit 1; distinguishing a non-repo root needs an extra git call, more than a direct correction.
  - `[low]` `[reject]` `ls-files` non-UTF8 names and stdio (blind) — Verified edge-case names; `execFileSync` captures stderr by default, and non-UTF8 tracked filenames are outside the pilot scope.
  - `[false]` `[reject]` dash-led values and tenant shape (blind) — Refuted: the parsing is the `parseVerifyArgs` precedent and a malformed tenant fails closed as a verification mismatch.
  - `[medium]` `[patch]` binary dispatch and print path untested (blind) — Same defect as the verification-gap dispatch row; grouped. Fix applied: `main` now calls `runCli` (single routing source) and a `runCli` parity test covers pass/fail/usage-defect plus the verify-path distinction.
  - `[medium]` `[patch]` pass-case binding assertion is a tautology (blind) — Same defect as the verification-gap binding row; grouped. Fix applied: assertion compares the stored fingerprint to independently computed `computeLocalFingerprint`.
  - `[low]` `[reject]` scratch helpers unpinned (blind) — Verified: tests use `git init -q` plus explicit commits; branch-name assertions are not made, so no flake path exists under the harness.
  - `[low]` `[reject]` I/O matrix prose omissions (blind) — Verified: the fixture parity runs the 5.4 suite through the shared `runGateDirect` the CI entry also uses, so byte parity is by shared adapter; matrix rows are documentation.
  - `[false]` `[reject]` lock hand-edit and missing root tsconfig reference (blind) — Refuted: the lockfile was produced by `pnpm install` (frozen-lockfile passes) and build/typecheck are green, so the workspace reference set is complete.
  - `[false]` `[reject]` unreadable-plus-duplicate precedence claim (edge-case claim) — Refuted: the spec's Design Notes pin CI guard order as "unreadable loses to unbound/set/stale/duplicate but beats a verdict", and the implementation returns the duplicate refusal exactly so.
  - `[low]` `[patch]` pass-case binding assertion tautology (edge-case) — Same defect as the blind and verification-gap rows; grouped and shares the patch.
  - `[low]` `[patch]` usage-defect writes-nothing assertion vacuous (edge-case) — Verified: the test asserted absence of paths never passed to the command. Fix applied: an explicit-`--state`/`--binding` parse defect now asserts both files stay absent.
  - `[low]` `[reject]` unwritable binding skips TOFU recording (edge-case) — Same defect as the blind best-effort row; grouped and shares its route.
  - `[low]` `[reject]` concurrent gate runs race the ledger (edge-case) — Same defect as the blind locking row; grouped and shares its route.
  - `[false]` `[reject]` adaptation vectors not signed claim (edge-case claim) — Refuted: adaptation is signature-agnostic by design (8.1 owns verification), so `signature: "test-signature"` is the correct fixture, not a gap.
  - `[medium]` `[patch]` binary dispatch/print path untested (verification-gap) — Pre-verified gap accepted as filed: the shipped `domain-harness gate` binary could print a truncated verdict while every suite stayed green. Fix applied: `runCli` now owns routing (`main` calls it) and a parity test drives it through a scratch repo, plus the verify-path sentence distinction.
  - `[medium]` `[patch]` first-use binding asserted tautologically (verification-gap) — Pre-verified gap accepted as filed: `readBinding` compared to itself, so a broken bind would pass. Fix applied: assert the stored fingerprint equals the independently computed one.
  - `[medium]` `[patch]` unreadable override covered only conditionally (verification-gap) — Pre-verified gap accepted as filed: the `chmod 0o000` test asserts nothing when the file stays readable (containers/root). Fix applied: two seam-driven cases (pass-override and refusal-precedence) with no chmod dependence.
  - `[low]` `[patch]` test surface vs intent print/exit surface (intent-alignment divergence 1) — Same defect as the dispatch row; grouped and shares its patch.
  - `[false]` `[reject]` extractor/core invocation not directly asserted (intent-alignment divergence 2) — Refuted: the spec mandates evaluation only through `runGateDirect`, whose own suite pins the extractor+core path; a direct import would violate the spec.
  - `[low]` `[reject]` deviation lines asserted by containment not byte-equality (intent-alignment divergence 3) — Verified: `formatDeviationLine` is the shared, separately-tested formatter; containment plus the shared formatter pins the line without re-asserting its internals.
  - `[low]` `[patch]` binding-value divergence (intent-alignment divergence 4) — Same defect as the binding-tautology rows; grouped and shares its patch.
  - `[false]` `[reject]` ident sentence collapse (intent-alignment divergence 5) — Refuted: the spec pins one shared `missing or unreadable identification file` sentence for both missing and unreadable, which the implementation matches.
  - `[false]` `[reject]` parity surface not CLI-vs-CI byte (intent-alignment divergence 6) — Refuted: the CLI adapter IS `runGateDirect`, the same function the service CI entry calls, so fixture canonical-bytes plus pinned kind/sentence/exit is the spec's parity proof.
  - `[false]` `[reject]` bundle inputs beyond the intent text (intent-alignment divergence 7) — Refuted: the gate consumes 8.1's verified bundle by spec design; the intent's "local revision with an identification file" is refined, not contradicted.

## Auto Run Result

- Summary: story 8.2 gives the offline CLI a `domain-harness gate` command. It re-verifies the bundle through 8.1's `loadBundleFile` (verification failures and `bundle stale` print first), adapts the verified wire bundle into a `GateBundleSnapshot` by resolving the Effective Standard set only through `core` (`entrySlot` holders + `resolveEffectiveSet`, winners hydrated from the payload's own `StandardInfo` in core order, `frozen:true → frozenUntil = run clock`), reads the `.domain-harness.json` identification file, computes the repository fingerprint (SHA-256 of the root-commit SHA), collects tracked files via `git ls-files -z` (unreadable files become rows that override pass/fail to `run did not complete`, earlier refusals keep CI precedence), and evaluates through the shared `runGateDirect` adapter against a file-backed TOFU binding ledger — printing the sentence then one `formatDeviationLine` per open Deviation, exit 0 only on pass. The working tree and HEAD are never touched; state/binding default under the cache dir.
- Files:
  - `apps/cli/src/gate-snapshot.ts` (NEW) — pure wire→snapshot adaptation via core, never throws.
  - `apps/cli/src/binding-file.ts` (NEW) — file-backed `BindingLedger` (TOFU bindings + refusals, atomic writes, corrupt-tolerant).
  - `apps/cli/src/gate.ts` (NEW) — `domain-harness gate` command: parse, verify, collect, adapt, `runGateDirect`, print/exit; unreadable-override rule.
  - `apps/cli/src/cli.ts` — `runCli` dispatch; review patch: `main` now calls `runCli` (single routing source) instead of duplicating dispatch.
  - `apps/cli/src/index.ts`, `package.json`, `tsconfig.build.json`, `pnpm-lock.yaml` — `@domain-harness/core` workspace link and barrel exports.
  - `apps/cli/src/gate-snapshot.test.ts`, `binding-file.test.ts`, `gate.test.ts`, `gate-e2e.test.ts` (NEW) — adaptation, ledger, full command matrix, 5.4 fixture parity, scratch-repo e2e; review patches: real binding assertion, seam-driven unreadable-override cases, real writes-nothing assertion, `runCli` parity suite.
  - `_bmad-output/implementation-artifacts/spec-8-2-run-the-gate-locally-with-the-same-result-as-ci.md` — this spec (status done).
- Findings breakdown: 33 findings — 4 patched entries across 27 rows (3 medium: binary dispatch/print untested, first-use-binding tautology, unreadable-override conditional; 1 low: vacuous writes-nothing assertion), 0 deferred, 29 rejected (12 false with refuting evidence — verified-hash provenance, parse-layer clock validation, core locked-id tolerance, service-mirror fingerprint, parse precedent/vendor-mismatch fail-closed, lockfile provenance, spec-pinned precedence and ident sentence, signature-agnostic adaptation, runGateDirect-mandated evaluation and shared-formatter pinning, spec-refined bundle inputs; 17 low — duplicate-id/dangling-source corrupt-input guards, best-effort binding persist, no-ledger-locking, non-repo fingerprint fallback, non-UTF8 ls-files names, scratch-helper pins, matrix prose, containment formatter, all requiring environment failure or adversarial input beyond a direct correction).
- Follow-up review recommendation: true — three patched medium entries. Named unverified residual risk: combined-cause precedence is unexercised versus CI. 8.1's verifier enforces signature/sequence/staleness before the gate runs, so a bundle that is BOTH stale and (say) unbound reports `bundle stale` locally where the CI entry reports `unbound Application`; single-cause results are byte-identical to CI and every combined cause still fails closed (never passes), but the combined-cause sentence parity itself is not pinned by a fixture.
- Verification: `pnpm install --frozen-lockfile` clean; `pnpm -r run build` exit 0; `pnpm -r run typecheck` exit 0; `pnpm -r run lint` exit 0 (max-warnings 0 embedded); `pnpm run boundaries` no violations (CLI imports only contract, gate, core plus Node built-ins); per-package `pnpm test` with both DB URLs on postgres 18 — contract 365, collector 1, cli 93, boundaries-self 17, extractor 16, core 95, gate 15, mcp-bridge 11, panel 436 passed + 1 pre-existing skip, registry 847, service 191 (2085 passed total, 0 failed; sequential isolation runs after re-verification). Matrix audit: all 15 spec I/O rows covered by named tests that ran and passed (gate command matrix, snapshot adaptation, binding ledger, 5.4 fixture parity, scratch-repo e2e pristine-tree pins) plus the new runCli dispatch parity.
- Residual risks: (1) combined-cause precedence — see follow-up note above (fail-closed, single-cause parity proven). (2) A non-repo `--root` reports `unbound Application` rather than `run did not complete` (fingerprint step is tied to the no-commit case); still exit 1, out of the documented CLI scenario. (3) Binding persistence is best-effort: a failed disk write silently skips TOFU recording for that run (precedented, fail-closed on the next mismatch). (4) The file ledger has no locking — concurrent gate runs on one binding path can lose a binding/refusal (sequential CLI use assumed). (5) A literal NUL fix during development is now the escaped `"\0"` form and the file reads cleanly (flagged by the implementer, verified green).

## Design Notes

- **Why the adaptation lives in the CLI, not in `gate`.** The helper consumes 8.1's verified output plus the identification-derived project id — command-specific glue, not shared result surface. `gate` stays untouched (sentences, canonical result, direct adapter, fixtures), and the CLI's new `core` link covers resolution only, mirroring how adapters may import `core` plus `contract`.
- **Frozen mapping.** The wire carries `frozen: boolean`; the shared stale guard reads `frozenUntil`. Mapping `true` to the run clock suspends the bound exactly for the run at hand (`freezeMs >= nowMs`), which is the freeze's semantics; `false` maps to `null`. No instant is invented beyond the run's own clock.
- **Verify-layer precedence.** 8.1's loader enforces signature/sequence/staleness before the gate runs, so a bundle that is both stale and (say) unbound reports `bundle stale` where CI reports `unbound Application`. Single-cause results are byte-identical to CI; combined causes always refuse non-zero and never pass — the same single-cause rule the fixture suite proves under.
- **Unreadable-file override.** Disk-unreadable rows are applied after the adapter returns (overriding pass/fail only), reproducing the CI guard order where unreadable loses to unbound/set/stale/duplicate but beats a verdict.

## Verification

**Commands:**
- `pnpm --filter @domain-harness/cli test` -- expected: snapshot, binding, command, and e2e suites pass with no database and no network.
- `pnpm run build` -- expected: workspace builds including the CLI gate wiring.
- `pnpm run typecheck && pnpm run lint && pnpm run boundaries` -- expected: clean, no boundary violations, CLI imports only contract, gate, core, and Node built-ins.
- `pnpm test` -- expected: full workspace suite passes (CLI plus unchanged service/gate determinism suites).

**Manual checks (if no CLI):**
- `apps/cli/src/gate-snapshot.ts` imports resolution only from `@domain-harness/core` and snapshot/sentence types from `@domain-harness/gate`; no `apps/*` import appears.
- A tampered bundle refuses with exactly `bundle verification failed` exit 1; a prohibited-dependency revision prints `fail` plus the Deviation line exit 1; `git status --porcelain` in the revision stays empty.
