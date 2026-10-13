---
title: 'Story 5.2: Evaluate Deviations in the core'
type: feature
created: '2026-10-13'
status: done
review_loop_iteration: 0
followup_review_recommended: true
baseline_revision: '6061af063682746c00611a34815f76f6628aaa89'
context:
  - _bmad-output/implementation-artifacts/epic-5-context.md
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** Story 5.1 delivered the deterministic fact extractor and `packages/core` already resolves the Effective Standard set, but nothing compares a revision's facts against that set. The CI Gate (5.3/5.4) and the CLI Gate (Epic 8) both need this comparison to exist only in the core.

**Approach:** Define `Deviation` and `AcceptedDeviation` types in `packages/contract`, then implement a pure `evaluateDeviations` in `packages/core` that consumes revision facts, the Effective Standard set (wire form), accepted deviations, an Application id and a clock input, and returns deterministically ordered Deviations with match keys, Correction instructions, checked/open counts and an Adherence fraction.

## Boundaries & Constraints

**Always:**
- Evaluation is pure: identical inputs produce an identical result; the core performs no I/O and never reads a clock — the adapter supplies `now` as a UTC ISO-8601 string.
- Each Deviation carries the match key (Standard id, conflict slot, subject) plus Standard version, a `kind`, a `status` of `open` or `accepted`, and exactly one Correction instruction: the authored `correctionInstruction` verbatim when non-empty, otherwise the generated one-sentence template for its kind.
- Output Deviations are sorted by (standardId, moduleKind, slotKind, name, subject, kind) and deduplicated by (match key, kind).
- An acceptance matches a finding only on exact equality of application id, standard id, standard version, slot (all three fields, normalized) and subject, and only while `start <= now < end` (UTC instants; an unparseable date never matches — fail closed). Expired acceptances leave the finding open with no other input change (AD-7).
- Code-stack matching (all three categories map onto dependency facts by exact name): prohibited entry + fact present → Deviation; required entry + fact absent → missing-required Deviation; approved/required entry + fact present with a non-empty `versionConstraint` the fact's concrete version fails, or a fact version that cannot be resolved to a concrete version → version-constraint Deviation (fail closed). An absent approved entry is compliant.
- Design-system matching: token facts vs token entries and import facts vs import entries (prohibited present, required missing); component names are detected from import specifiers — a specifier equal to the component name or ending with `/<name>` (case-insensitive) counts as usage — and any detected component not named by a component entry is a component-outside-allow-list Deviation. With zero component entries in the set, the allow-list constrains nothing.
- `checked` = distinct Standards evaluated from the effective set; `open` = distinct Standards carrying at least one unaccepted Deviation; `adherence` = `(checked - open) / checked`, `0` when `checked` is 0 (no evidence of compliance earns no credit).
- Malformed inputs return `{ ok: false, error: ErrorEnvelope }` following the existing result-union pattern; a duplicate conflict slot inside the effective set is `SLOT_CONFLICT`.

**Never:**
- No visual-fidelity scoring.
- No new runtime dependencies in `packages/core` or `packages/contract` beyond `@domain-harness/contract`; no Node built-in imports in core/contract src (boundary rule `core-imports-only-contract`).
- No bundle pull/verify/activate/staleness logic (Epic 4 + story 5.3), no registry acceptance store (story 5.5), no re-implementation of effective-set resolution (reuse the existing resolver in tests).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Prohibited dependency present | facts contain `lodash 4.17.21`, set holds prohibited library `lodash` | one open `prohibited` Deviation, subject `lodash` | None |
| Missing required | required token `--color-bg`, no matching token fact | one open missing-required Deviation, subject `--color-bg` | None |
| Version violation | approved library `react` constraint `^18`, fact version `16.8.0` | one open version-constraint Deviation | None |
| Accepted match | acceptance whose five key fields equal a finding, `now` inside `[start, end)` | that finding `status: accepted`, not counted in `open` | None |
| Acceptance expiry | same key, `now >= end` | finding is `open` again | None |
| Different subject | acceptance subject `lodash`, prohibited fact `ramda` | finding stays `open` | None |
| Duplicate slot | effective set with two entries in one slot | `{ ok: false }` with `SLOT_CONFLICT` envelope | error, no deviations |
| Empty Correction instruction | entry without authored instruction | generated one-sentence instruction naming the Standard id, the status/slot and the first approved entry in the same slot kind when one exists | None |
| Malformed facts or set | object failing `isRevisionFacts` / `isEffectiveStandardSet` | `{ ok: false }` with an invalid-input envelope | error, no deviations |

</intent-contract>

## Code Map

- `packages/contract/src/facts.ts` -- consumed input shape: `RevisionFacts` (L53-68), `isRevisionFacts` (L101), `EXTRACTOR_VERSION` (L19); dependencies are `{ name, version }`, imports `{ specifier }`, tokens `{ name }` (leading `--`).
- `packages/contract/src/effective.ts` -- the wire form the evaluator consumes: `EffectiveSlot` (L21-26), `EffectiveStandard` (L29-39, carries `status`, full `StandardInfo`, `locked`), `EffectiveStandardSet` (L42-46), guards `isEffectiveStandard` (L67), `isEffectiveStandardSet` (L80).
- `packages/contract/src/standards.ts` -- `CODE_STACK_STATUSES` (L23: approved/prohibited/required), `CodeStackEntry` (L54-61: `versionConstraint`, `correctionInstruction`), `ComponentEntry` (L105-113: no status), `TokenEntry`/`ImportEntry` (L116-129: no `correctionInstruction`), `StandardInfo` (L189-201: `id`, `version`), `entrySlotKind` (L291), `entrySlotName` (L296), `SLOT_CONFLICT` (L243).
- `packages/contract/src/errors.ts` -- `ErrorEnvelope`, `isErrorEnvelope`, exported-code-const pattern (`PLAN_REFUSED`).
- `packages/contract/src/ids.ts` -- `UuidV7`, `isUuidV7` for id validation.
- `packages/core/src/resolve.ts` -- the result-union pattern to follow (`{ ok: true, ... } | { ok: false, error }`); do not modify.
- `packages/core/src/slots.ts` -- `ConflictSlot`, `sameSlot`, `normalizeSlotName` for slot comparison.
- `packages/contract/src/deviations.ts` -- NEW: `DeviationKind`, `Deviation`, `AcceptedDeviation`, `isDeviation`, `isAcceptedDeviation`.
- `packages/contract/src/deviations.test.ts` -- NEW: guard tests.
- `packages/core/src/evaluate.ts` -- NEW: `evaluateDeviations`, version-constraint comparator, generated-instruction templates.
- `packages/core/src/evaluate.test.ts` -- NEW: behavior tests for the matrix and ACs.
- `packages/core/src/evaluate.property.test.ts` -- NEW: order-independence determinism (mirrors `resolve.property.test.ts`).
- `packages/core/src/index.ts`, `packages/contract/src/index.ts` -- add re-exports.
- `.dependency-cruiser.cjs` -- `core-imports-only-contract` (L15-21) already covers the new core module; no change needed.
- `packages/core/package.json` -- runtime deps stay `@domain-harness/contract` only.

## Tasks & Acceptance

**Execution:**
- `packages/contract/src/deviations.ts` -- Define `DeviationKind` (`prohibited`, `missing-required`, `version-constraint`, `prohibited-token`, `missing-required-token`, `prohibited-import`, `missing-required-import`, `component-outside-allow-list`), `Deviation { standardId, standardVersion, slot: EffectiveSlot, subject, kind, status, correction }`, `AcceptedDeviation { applicationId, standardId, standardVersion, slot, subject, start, end }` (ids `UuidV7`, dates UTC ISO-8601 strings), and strict guards built like `facts.ts` guards (exact key sets, never throw).
- `packages/contract/src/index.ts` -- Export the new symbols.
- `packages/contract/src/deviations.test.ts` -- Guard tests: round-trip of a valid Deviation/AcceptedDeviation, rejection of missing/extra fields and bad types.
- `packages/core/src/evaluate.ts` -- Implement `evaluateDeviations(input: { applicationId, facts, effectiveSet, accepted, now })`: validate inputs with guards (fail with envelopes), reject duplicate slots with `SLOT_CONFLICT`, run code-stack and design-system checks, build authored-or-generated Correction instructions, apply acceptance matching, sort and dedupe, compute `checked`/`open`/`adherence`, and return the result union. Include the pure version-constraint comparator.
- `packages/core/src/evaluate.test.ts` -- Cover every I/O matrix row plus: prohibited/required import and token entries, component detection via specifier segments (equal and trailing `/<name>`, case-insensitive), component allow-list deviations, authored instruction used verbatim, adherence arithmetic including the checked=0 case, and acceptance date-boundary (`start <= now < end`).
- `packages/core/src/evaluate.property.test.ts` -- Determinism: reordering the effective set, the accepted list and the facts maps yields a byte-identical result.
- `packages/core/src/index.ts` -- Export `evaluateDeviations` and its types.

**Acceptance Criteria:**
- Given facts, an effective set and a clock input, when the evaluator runs, then it emits a Deviation for each prohibited code-stack match, each missing required entry, each version-constraint violation, each prohibited or missing required token, each prohibited or missing required import, and each component outside the allow-list, each carrying the match key (Standard id, conflict slot, subject); visual fidelity is never evaluated.
- Given an entry with an empty Correction instruction, when its Deviation is emitted, then the instruction is one generated sentence built from the status, the conflict slot and the approved entry in the same slot kind when one exists.
- Given the result, when it is returned, then it includes checked and open counts, and Adherence equals checked minus open, divided by checked.
- Given an Accepted deviation in the input, when the clock input is before its end, then a finding with exactly that acceptance key is marked accepted and a different subject on the same Standard stays open; and when the clock input is after the end, the same finding is open again with no other input change.
- Given malformed facts or an effective set with a duplicate slot, when the evaluator runs, then it returns `{ ok: false }` with an ErrorEnvelope and no deviations.
- Given any reordering of the effective set, accepted list or facts, when the evaluator runs, then the deviations output is byte-identical.
- Given `pnpm test` and `pnpm run boundaries`, when they run, then the contract and core suites pass with no boundary violations.

## Spec Change Log

## Review Triage Log

### 2026-10-13 — Review pass
- verdicts: 22 findings — high 0, medium 6, low 12, false 4, maybe-false 0
- findings:
  - `[medium]` `[patch]` The version-constraint check ran for every entry status, so a prohibited entry with a constraint emitted two Deviations (blind-hunter, edge-case-hunter, verification-gap) — fixed by gating the check to approved/required entries; test added pinning exactly one Deviation for a prohibited entry carrying a constraint.
  - `[medium]` `[patch]` Acceptance-key equality had no negative coverage beyond subject (applicationId, standardVersion, slot untested), so regressions there would ship green (blind-hunter, verification-gap pre-verified) — fixed by adding negative cases for applicationId, standardVersion and a genuinely different slot name (each stays open) plus a positive case where the slot name differs only in spelling/whitespace and normalizes to accepted, pinning that the normalized comparison is exercised; the subagent's first patch used raw equality and was corrected back to `sameSlot` per the spec.
  - `[medium]` `[patch]` `~` with a partial constraint required the padded triple's exact minor (`~18` matched only 18.0.x and rejected 18.9.0), diverging from the npm convention (verification-gap) — fixed by treating parts missing from a tilde constraint as wild (`~18` ≡ `>=18.0.0 <19.0.0`, `~18.2` ≡ `>=18.2.0 <18.3.0`); tests added.
  - `[low]` `[patch]` The UTC-ISO guard was duplicated as a local regex in core, a drift risk (blind-hunter) — fixed by exporting the contract's `isUtcIso` through the barrel and reusing it.
  - `[low]` `[patch]` `deviations.ts` re-implemented the EffectiveSlot shape validation instead of reusing `effective.ts` (blind-hunter) — fixed by exporting `isEffectiveSlot` and reusing it; consequence noted: the shared guard does not reject extra keys inside a slot.
  - `[low]` `[patch]` An import specifier ending in `/` yielded an empty trailing segment and a component Deviation with an empty subject (edge-case-hunter) — fixed by skipping empty segment keys; test added.
  - `[low]` `[patch]` No test proved an authored instruction wins over a generated instruction that would have included the "; use the approved …" clause (blind-hunter) — authored-verbatim test extended to a set carrying an approved alternative.
  - `[low]` `[patch]` `parseConcreteVersion` was exported from the core barrel beyond the spec's stated surface (blind-hunter) — removed from the barrel; the unpinned grammar trivia (leading zeros, trailing dash) was left as-is.
  - `[low]` `[patch]` Guard tests were thin on the positive side: no accepted-status or per-kind round-trip, no missing-slot-keys rejection (blind-hunter) — assertions added.
  - `[low]` `[reject]` `isAcceptedDeviation` accepts inverted/empty windows that fail closed only by arithmetic (blind-hunter) — the evaluator is fail-closed by spec and unharmed; record-shape validation belongs to story 5.5's acceptance store; the fix would add guard logic for no shown defect.
  - `[low]` `[reject]` Property-test acceptance windows are hardcoded live, so expiry is exercised only by unit tests (blind-hunter) — expiry is pinned by two unit tests including a byte-identical run against a no-acceptance evaluation; extending the property suite adds little.
  - `[low]` `[reject]` The property oracle mirrors the implementation (Date.parse, trim/lowercase) rather than being independent (blind-hunter) — a fully independent oracle would re-implement the evaluator; no demonstrated bug.
  - `[low]` `[reject]` The duplicate-slot scan is O(n²) though sorted adjacency would suffice (blind-hunter) — effective sets are small by construction and duplicates cannot arise from the resolver; no observable harm.
  - `[low]` `[reject]` NFC/NFD Unicode normalization is unhandled in component matching (edge-case-hunter) — undemonstrated path, unlikely in everyday use, and the fix adds normalization complexity with no shown defect.
  - `[low]` `[reject]` A leading-"v" fact version (`v18.2.0`) fails closed, unpinned by test (verification-gap) — npm manifests and lockfiles emit plain versions; fail-closed is the pinned policy.
  - `[false]` Component detection is broader than the spec's pinned heuristic (blind-hunter) — refuted: the implementation matches the spec's pinned trailing-segment heuristic verbatim; the stricter reading cannot detect outside components at all, contradicting the intent's "each component outside the allow-list"; bare and subpath specifiers are exercised by the property suite's SPECIFIERS set.
  - `[false]` Shape-only date validation launders calendar-invalid dates (blind-hunter) — refuted: the evaluator fails closed on unparseable instants (NaN never matches) and a test pins the invalid-calendar clock staying open; the spec pins the fail-closed behavior.
  - `[false]` Token/import matching is case-sensitive while slots and components normalize (blind-hunter) — refuted: the spec pins exact-name matching for token/import facts and separately pins case-insensitive component detection; npm specifiers and CSS custom properties are case-sensitive.
  - `[false]` Two entries sharing a Standard id in distinct slots would blur the checked count (edge-case-hunter) — refuted: one published Standard carries exactly one entry/slot, so the situation cannot arise from the resolver, and a same-id same-slot pair is caught by SLOT_CONFLICT.
- intent-alignment auditor reported no findings; it described the diff as faithfully realizing the embedded intent-contract under its pinned design readings.

## Design Notes

- **Component attribution.** The allow-list is the union of component-entry names across the effective set. A detected component outside that union is attributed to the design-system Standard with the lexicographically lowest id among those contributing component entries; with no component entries the allow-list constrains nothing and no Deviation is emitted. Components are detected only from import specifiers because `ImportFact` stores specifiers alone — this heuristic is the pinned first-cut rule.
- **Version comparator (pure, no semver library).** Constraint grammar: `*`, exact `MAJOR.MINOR.PATCH`, `^`, `~`, `=`, `>`, `>=`, `<`, `<=`, space-separated conjunctions, `||` alternatives. Fact versions must resolve to a concrete triple; prerelease/build tags are ignored. A range fact version (e.g. `^18.0.0` from a manifest) under a non-null constraint is a violation — fail closed, since the Gate must not pass what it cannot verify.
- **Generated instruction templates** (one sentence, always naming the Standard id; `{alternative}` = first approved entry with the same moduleKind + slotKind in effective-set order, clause dropped when none exists — only code-stack entries can be approved):
  - prohibited: `The Standard {standardId} prohibits {subject}; use the approved {slotKind} {alternative} instead.`
  - missing required: `The Standard {standardId} requires the {slotKind} {subject}.`
  - version-constraint: `The Standard {standardId} requires {subject} to satisfy {constraint}; found {version}.`
  - token/import: `The Standard {standardId} {prohibits|requires} the {token|import} {subject}.`
  - component: `The Standard {standardId} allows only listed components; {subject} is not in the allow-list.`
- **Scope edges.** `AcceptedDeviation` carries only the key + `start`/`end` (the evaluator's needs); justification, alert interval and Buyer belong to story 5.5's acceptance store. `facts.unreadable` is out of evaluator scope (no match key can be formed); Gate refusal for unreadable revision files is story 5.3's concern.

## Verification

**Commands:**
- `pnpm --filter @domain-harness/contract test` -- expected: contract tests pass including the new guards.
- `pnpm --filter @domain-harness/core test` -- expected: core tests pass including the new evaluator and property tests.
- `pnpm run boundaries` -- expected: no boundary violations.
- `pnpm test` -- expected: full workspace suite passes.
- `pnpm run build` -- expected: workspace builds.

## Auto Run Result

**Summary:** Implemented Story 5.2: a versioned Deviation and AcceptedDeviation contract in `packages/contract` and a pure `evaluateDeviations` in `packages/core` that compares revision facts against the Effective Standard set, emitting deterministically sorted, deduplicated Deviations with match keys, authored-or-generated Correction instructions, acceptance matching over a normalized slot key and a caller-supplied clock, and checked/open counts with the Adherence fraction.

**Files changed:**
- `packages/contract/src/deviations.ts` — `DeviationKind`, `Deviation`, `AcceptedDeviation` and strict never-throwing guards.
- `packages/contract/src/deviations.test.ts` — guard round-trip and rejection tests.
- `packages/contract/src/effective.ts` — exported `isEffectiveSlot` for reuse.
- `packages/contract/src/guards.ts` — `isUtcIso` exported through the barrel.
- `packages/contract/src/index.ts` — re-exports the new contract symbols.
- `packages/core/src/evaluate.ts` — `evaluateDeviations`, the version-constraint comparator (caret/tilde/exact/comparison operators, conjunctions, alternatives, wild partial tilde parts, fail-closed on unresolvable versions), component detection from import specifiers, acceptance matching, counts and Adherence.
- `packages/core/src/evaluate.test.ts` — behavior tests covering every I/O matrix row, the acceptance criteria and the patch cases.
- `packages/core/src/evaluate.property.test.ts` — 300-seed order-independence and internal-consistency property suite.
- `packages/core/src/index.ts` — re-exports `evaluateDeviations`, `satisfiesVersionConstraint` and the evaluator types.
- `_bmad-output/implementation-artifacts/spec-5-2-evaluate-deviations-in-the-core.md` — this spec.

**Review findings:** 22 findings — 6 medium, 12 low, 4 false. All 6 medium and 6 low findings were patched (constraint check gated to approved/required, acceptance-key negative and normalized-positive tests, npm-convention partial tilde, UTC guard and EffectiveSlot guard reuse instead of duplication, empty-segment skip, over-export removal, authored-over-generated test, positive guard coverage). 6 low findings rejected with recorded reasons; 4 findings refuted as false; nothing deferred. Verdict-count note: one grouped defect (version-constraint not status-gated) holds 3 of the medium rows, and the acceptance-key test gap holds 2 — 3 distinct medium patch entries total.

**Follow-up review recommendation:** `true` — three medium patch entries were applied. Unverified risk: the shared `isEffectiveSlot` guard is more permissive than the previous local guard (extra keys inside a Deviation's `slot` are no longer rejected by the deviation guards, only by the effective-set guard), and the wild-partial tilde paths are covered by unit tests only, not by the property suite's constraint list.

**Verification performed:**
- `pnpm --filter @domain-harness/contract test` — 272 passed (17 files, forced re-run after patching).
- `pnpm --filter @domain-harness/core test` — 95 passed (8 files, forced re-run after patching).
- `pnpm run boundaries` — no violations.
- `pnpm test` — full workspace suite passes (11 tasks).
- `pnpm run build` — all 8 tasks successful.
- Matrix test audit: all 9 I/O matrix rows verified against named, freshly-run passing tests; none skipped or filtered.

**Residual risks:**
- Component detection remains the pinned permissive first-cut heuristic: with component entries in the set, trailing segments of ordinary library specifiers become candidate components; story 5.3 may need to scope which specifiers reference the design system.
- Version-constraint comparison is a bespoke pure comparator (no semver library allowed by the boundary rules); exotic range syntaxes fail closed.
- `AcceptedDeviation` intentionally carries only the key plus `start`/`end`; the full acceptance record (justification, alert interval, Buyer) arrives with story 5.5.
- `facts.unreadable` is out of evaluator scope by design; Gate refusal for unreadable revision files belongs to story 5.3.
