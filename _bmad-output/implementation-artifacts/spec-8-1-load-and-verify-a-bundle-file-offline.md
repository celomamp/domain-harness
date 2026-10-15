---
title: 'Story 8.1: Load and verify a bundle file offline'
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
baseline_commit: 'feb73b6f385a125fa58d1e59335aeaa3d6c99054'
baseline_revision: 'feb73b6f385a125fa58d1e59335aeaa3d6c99054'
---

<intent-contract>

## Intent

**Problem:** `apps/cli` is an empty scaffold (workspace name only, contract-only dependencies), so nothing loads a signed bundle file offline: Builders cannot check work anywhere without a network, and story 8.2 has no trusted bundle input to run the Gate on.

**Approach:** Add a bundle-file unit to `apps/cli` that reads a bundle file and a trust-keys file from command paths, verifies with the service's fixed order and rules against a local last-seen state, applies the staleness bound to the bundle issue time, prints exactly one shared gate sentence and exits non-zero on any failure, and persists the verified bundle pointer for story 8.2 to consume.

## Boundaries & Constraints

**Always:**
- Reuse `packages/contract` for shape and bytes: `isSignedStandardBundle` (exact keys, rejects unknown format majors), `canonicalJson` (sorted keys, undefined omission), and the payload fields (`tenantId`, `sequence`, `keyId`, `issuedAt`, `stalenessHours`, `frozen`). Never re-implement canonicalization or guards.
- Mirror `apps/service/src/bundles/verify.ts` order and rules exactly: `shape` → `unknown_key` → `signature_failed` → `tenant_mismatch` → `hash_mismatch` → `stale_sequence`. Ed25519 base64 signature over the canonical payload bytes and SHA-256 hex hash over the canonical signed object via `node:crypto`. No cross-app imports: re-implement the small hash/verify primitives inside the CLI, the story 4.2 precedent.
- Reuse the shared sentences from `@domain-harness/gate`: every verification failure prints exactly `bundle verification failed` and exits 1; a stale bundle prints exactly `bundle stale` and exits 1; success exits 0 printing the verified hash and sequence. Never invent sentence text.
- Staleness mirrors the runner guard: age = run clock − `payload.issuedAt` against `payload.stalenessHours`; `frozen: true` suspends the bound; future or unparseable `issuedAt` is stale. The adapter supplies the clock (`--now` override, default the current time); nothing here reads ambient time except the default.
- Local last-seen state is a JSON file mapping tenant id → `{ sequence, hash }`: first run records; equal sequence with identical hash is idempotent; equal sequence with a different hash and any lower sequence refuse; the state is written only on success, atomically (temp file plus rename).
- The trust-keys file is a JSON object of key id → Ed25519 public-key PEM, the file form of the service's trust set; an unreadable, malformed, or empty trust file refuses exactly like a verification failure, since nothing can be verified without trust. The loader makes no network calls.

**Never:**
- No Gate evaluation, no `extractor`/`core` run, no binding-file logic (story 8.2); no npm packaging or `--version` surface (story 8.3).
- No changes to `packages/contract`, `packages/gate`, `apps/service`, `apps/registry`, or `apps/panel`; no new runtime dependencies beyond `@domain-harness/gate` (sentences only).
- No plan names in any output; no working-tree writes outside the explicit state file (the revision under check is never touched).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Valid first run | bundle + trust files, `--tenant` matches payload, no state entry | exit 0, success line with hash and sequence, state entry recorded | No error expected |
| Newer bundle | verified bundle with sequence above the state | exit 0, state advanced to the new sequence and hash | No error expected |
| Equal sequence, same bytes | recomputed hash equals the state hash | exit 0, idempotent, state unchanged | No error expected |
| Equal sequence, different bytes | recomputed hash differs from the state hash | `bundle verification failed`, exit 1, state unchanged | Fail closed, never a pass |
| Lower sequence | sequence below the state | `bundle verification failed`, exit 1, state unchanged | Fail closed |
| Tampered content | any payload or signature byte altered, key id trusted | `bundle verification failed`, exit 1 | Fail closed |
| Unknown key id | key id absent from the trust file | `bundle verification failed`, exit 1, no signature work | Fail closed |
| Tenant mismatch | payload tenant differs from `--tenant` | `bundle verification failed`, exit 1 | Fail closed |
| Malformed body | bad JSON, guard failure, or unknown format major | `bundle verification failed`, exit 1 | Fail closed |
| Missing input | unreadable bundle path, trust path, or malformed trust file | `bundle verification failed`, exit 1 | Fail closed |
| Stale past bound | issue time older than the bound, `frozen: false` | `bundle stale`, exit 1 | Fail closed |
| Frozen or fresh | `frozen: true`, or age within or exactly at the bound | exit 0 | No error expected |
| Untrusted clock edge | future or unparseable `issuedAt` | `bundle stale`, exit 1 | Fail closed |

</intent-contract>

## Code Map

- `packages/contract/src/bundles.ts` -- reuse only: `isSignedStandardBundle` (L159, exact keys, rejects unknown majors via `isBundleFormat` L109), `canonicalJson` (L180, sorted keys, undefined omission), payload fields `tenantId`/`sequence`/`keyId`/`issuedAt`/`stalenessHours`/`frozen` (L42), `DEFAULT_STALENESS_HOURS` (L26). Import only.
- `apps/service/src/bundles/verify.ts` -- the rules to mirror without importing: fixed order `shape → unknown_key → signature_failed → tenant_mismatch → hash_mismatch → stale_sequence` (L87), `bundleHashOf` (L79: sha256 of canonical signed bytes), Ed25519 verify over canonical payload bytes (L117), equal-sequence hash expectation and lower-sequence refusal (L142), `isEd25519PublicKeyPem` (L164).
- `apps/service/src/bundles/env.ts` -- trust-set semantics to carry into file form: key id → Ed25519 public-key PEM map (L32), one-envelope config errors; the CLI maps trust-file failures to the verification-failed sentence instead of an envelope.
- `apps/service/src/ci-gate/bundle.ts` + `runner.ts` -- staleness guard to mirror against payload fields: `nowMs >= issuedMs` with `age <= bound` (runner L106), freeze suspension (L114), `DEFAULT_STALENESS_BOUND_HOURS` (bundle L4).
- `apps/service/src/bundles/golden-signed-bundle.json` -- a registry-signed golden fixture proving the verifier accepts real signer output; the CLI suite builds its vectors the same way (generated Ed25519 keys plus one self-check against this golden shape).
- `packages/gate/src/sentences.ts` -- `BUNDLE_VERIFICATION_FAILED` (L35), `BUNDLE_STALE` (L32): the only strings the CLI prints on failure; `apps/cli` gains `@domain-harness/gate` as a runtime dependency for these.
- `packages/gate/src/fixtures.ts` -- `GateBundle`/`GateBundleSnapshot` first-cut shapes (L117): 8.1 must not invent a bundle format; it loads the wire `SignedStandardBundle` and 8.2 adapts it to the snapshot the fixtures consume.
- `apps/cli/src/index.ts`, `index.test.ts`, `package.json`, `tsconfig.json`, `tsconfig.build.json` -- the scaffold to extend: contract-only deps today (package L13), `@domain-harness/source` condition (tsconfig L5), barrel plus package name test.
- `apps/registry/src/bundles/sign.ts` -- signing rule mirrored by verification: `bundleHash` (L15), Ed25519 PKCS8 signer with `sign(null)` base64 output (L57); reference only.
- `pnpm-workspace.yaml` (`apps/*` + `packages/*` globs), root `tsconfig.json` references, `.dependency-cruiser.cjs` (`no-cross-app-imports` L52, `no-imports-from-apps` L45): wiring and boundary points; the CLI must import `contract` and `gate` packages only, never `apps/*`.
- `package.json` scripts (`build`, `typecheck`, `test`, `lint`, `boundaries`) and `turbo.json` -- the verification surface; no workflow changes.

## Tasks & Acceptance

**Execution:**
- `apps/cli/package.json`, `pnpm-lock.yaml`, root `tsconfig.json`, `apps/cli/tsconfig.build.json` -- add `@domain-harness/gate: workspace:*` (sentences only) with project references; `core` and `extractor` stay out until story 8.2.
- `apps/cli/src/bundle-file.ts` -- NEW pure loader: `loadBundleFile({ bundlePath, trustKeysPath, tenantId, statePath, now })` returning a never-throwing outcome (`ok` with signed bundle, hash, sequence; or `verify-failed` / `stale` with the exact shared sentence and exit 1). Reads both files, parses the trust map, runs the fixed verification order, applies the stale guard, compares against the state entry, and writes state only on success.
- `apps/cli/src/trust-keys.ts` -- NEW trust-file parser: JSON object key id → PEM string into a `ReadonlyMap`, each value validated as an Ed25519 public key; any defect reports verification failure, never throws.
- `apps/cli/src/bundle-state.ts` -- NEW state store: `readState`/`writeState` over the tenant → `{ sequence, hash }` JSON file with atomic write (temp file plus rename) and corrupt-state treated as no entry for the affected tenant only.
- `apps/cli/src/cli.ts` (+ `bin` wiring in `package.json`) -- NEW `domain-harness bundle verify --bundle <path> --trust-keys <path> --tenant <uuidv7> [--state <path>] [--now <iso>]`: plain argv parsing with no new dependencies, default state under the user cache dir, default clock the current time; prints the outcome sentence or success line and exits accordingly.
- `apps/cli/src/bundle-file.test.ts` -- matrix tests with generated Ed25519 keys (valid, tampered, unknown key, tenant mismatch, malformed body, unknown major, missing files, bad trust file) plus stale edges (past bound, frozen, exact bound, future and unparseable `issuedAt`) and sequence transitions (first, newer, equal-same, equal-different, lower); temp directories only, no network, no database.
- `apps/cli/src/cli.test.ts` -- command-level tests pinning exit codes and exact stdout sentences for the verify-failed, stale, and success paths, including state-file side effects.

**Acceptance Criteria:**
- Given a valid bundle file, its trust-keys file, and a matching `--tenant`, when the verify command runs fully offline, then it exits 0, prints the verified hash and sequence, and records them in the state file.
- Given a tampered, unknown-key, tenant-mismatched, malformed, or unknown-major bundle, or a missing file or bad trust file, when the command runs, then it prints exactly `bundle verification failed`, exits 1, and leaves the state file unchanged.
- Given a bundle past its bound with `frozen: false` (including future or unparseable issue times), when the command runs, then it prints exactly `bundle stale` and exits 1; a frozen bundle or one within or exactly at the bound exits 0.
- Given a state entry, when a lower-sequence bundle or an equal-sequence bundle with a different hash is verified, then the command refuses with the verification-failed sentence and exit 1; an equal-sequence identical bundle exits 0 without rewriting state.
- Given the same bundle bytes, when the service verifier and the CLI loader run, then both accept or both refuse, with the CLI sentence matching the service outcome class.
- Given `pnpm --filter @domain-harness/cli test`, `pnpm run build`, `pnpm run typecheck`, `pnpm run lint`, and `pnpm run boundaries`, when they run, then all pass with no violations, the CLI imports only `contract` and `gate` plus Node built-ins, and no loader test touches the network.

## Spec Change Log

## Review Triage Log

### 2026-10-15 — Review pass (four layers: blind-hunter 14, edge-case-hunter 5, verification-gap 3, intent-alignment 6)
- verdicts: 28 findings — high 1, medium 3, low 14, false 10, maybe-false 0
- findings:
  - `[false]` `[reject]` stale-vs-verification-defect precedence undefined (blind) — Verified in `bundle-file.ts`: sequence checks run before the stale guard, exactly the spec-mandated fixed order; each single-cause matrix row behaves as specified. A combined stale-plus-old bundle reporting verification-failed is spec-compliant order, not a code defect; the only fix would be a spec edit, which is barred.
  - `[false]` `[reject]` outer `signed.keyId` never compared against `payload.keyId` (blind) — Refuted by parity: `apps/service/src/bundles/verify.ts:107` looks the trust set up by the outer key id identically and never compares the two; the CLI mirrors the mandated reference exactly, and both sides' fixtures keep them equal.
  - `[false]` `[reject]` `--tenant` without uuidv7 shape guard (blind) — Verified: a non-uuid tenant can only mismatch the payload tenant, printing verification-failed with exit 1. The outcome is identical with or without a format guard; fail-closed is preserved either way.
  - `[low]` `[patch]` unparseable `--now` surfaces as `bundle stale` (blind) — Verified: an invalid clock string reaches `isBundleStale`, which returns true, so a clock typo misreports as stale. Fix applied: `parseVerifyArgs` rejects a non-finite `Date.parse` clock, failing closed as a usage defect; pinned by a `--now` rejection case.
  - `[false]` `[reject]` failure lines go to stdout, not stderr (blind) — Refuted: the repo convention is stdout (registry `stdoutLogger`), the spec pins sentence text rather than stream, and `cli.test.ts` pins the line content. No bad outcome at the cited location.
  - `[low]` `[reject]` `--help` answers `bundle verification failed` (blind) — Verified fail-closed per the spec-pinned unknown-flag mapping (tested usage defects); exit 1, no state touched. Help/usage text is CLI-surface polish owned by story 8.3, which fences the `--version` surface; not worth a new surface here.
  - `[low]` `[patch]` success-line expectation built via `formatSuccessLine` (blind) — Verified tautological in `cli.test.ts`. Fix applied: expectation hardcoded as `` `bundle verified ${expectedHash} 1` `` assembled from `bundleHashOf` plus the sequence literal.
  - `[low]` `[reject]` state-write failure still returns ok:true (blind) — Verified best-effort persist, disclosed by the implementer. Requires a failed disk write to matter, and best-effort recording is the precedented pattern (4.5 records never-throwing); inventing failure semantics would go beyond a direct correction.
  - `[low]` `[reject]` no guard against statePath colliding with an input path (blind) — Verified unguarded, but requires explicitly passing `--state` pointing at the bundle or trust file. Self-inflicted and unlikely; a collision guard is complexity beyond a direct correction.
  - `[low]` `[reject]` unbounded file reads with no size cap (blind) — Verified: `readFileSync` plus `JSON.parse` unbounded. Local-only tool over explicit user paths; the service-side caps live at the HTTP layer, a different threat model. An arbitrary byte cap would be a spec-unsettled constant.
  - `[low]` `[reject]` state read-modify-write without locking (blind) — Verified: no lockfile around `readStateFile` plus `writeStateFile`. Same root cause as the edge-case concurrency finding below; grouped. CLI runs are sequential and 8.2 consumes the loader in-process; locking is complexity beyond a direct correction.
  - `[false]` `[reject]` default state/clock absent from Design Notes (blind) — Refuted as a code finding: Tasks pin both defaults ("default state under the user cache dir, default clock the current time"); the only fix would be a spec-prose edit, which is barred.
  - `[low]` `[reject]` padded key ids accepted; lenient base64 decode (blind) — Verified both halves: base64 uses the identical `Buffer.from(s, "base64")` as service `:120` (exact parity), and a padded key id becomes a never-matching entry so every verify fails closed and loudly. Normalization rules would be spec-unsettled.
  - `[false]` `[reject]` mtimeMs idempotency pin plus hardcoded golden clock (blind) — Refuted: the mtime assertion cannot flake-fail because the byte-equality assertion decides idempotency, and the golden clock coupling fails loudly on fixture regeneration, which is the desired golden-test behavior.
  - `[false]` `[reject]` repeated flags silently keep the last value (edge-case) — Verified last-wins in the argv loop. Last-wins is conventional CLI behavior, not a defect; no bad outcome.
  - `[high]` `[patch]` Windows path never matches the CLI entry regex, exiting 0 silently (edge-case) — Verified: `/(^|\/)cli\.(js|ts)$/` cannot match a backslash path, so on win32 (a supported target per the `LOCALAPPDATA` branch) `main()` never runs and node exits 0 without verifying — a silent pass violating fail-closed. Fix applied: `isCliEntryPoint` helper accepting both separators, exported for 8.2, pinned with posix/win32 argv cases.
  - `[low]` `[reject]` concurrent verifies interleave the state write (edge-case) — Same root cause as the blind locking finding; grouped. Verified real but sequential-use only; rejected with that row.
  - `[false]` `[reject]` `__proto__` tenant id pollutes the state object (edge-case) — Verified the assignment path, but the pollution is in-memory only within the caller's own process and dropped on serialize (own-properties-only spread plus `JSON.stringify`); no cross-tenant or cross-run effect, and the input is the caller's own flag. No reachable bad outcome.
  - `[low]` `[patch]` relative `XDG_CACHE_HOME` yields a CWD-relative state path (edge-case) — Verified: the env value is used verbatim, so a relative value would write state into the revision under check. Fix applied: non-absolute `XDG_CACHE_HOME` is ignored in favor of the OS cache-dir defaults; pinned by relative-XDG fallback cases.
  - `[medium]` `[patch]` custom `stalenessHours` bound unexercised (verification-gap) — Pre-verified gap accepted as filed: every stale test uses the 24h default, so hardcoding the bound would pass stale custom-bound bundles as verified. Fix applied: matrix case with `stalenessHours: 1` plus 2h age expecting stale, and `stalenessHours: 48` plus 25h age expecting ok.
  - `[medium]` `[patch]` default state path unpinned (verification-gap) — Pre-verified gap accepted as filed: the only default assertion is `typeof ... === "string"`, so a CWD-relative default would ship undetected against the pristine-tree contract. Fix applied: `defaultStatePath()` pinned absolute ending in `domain-harness/bundle-state.json` under XDG and OS fallbacks, plus a `parseVerifyArgs`-without-`--state` default-resolution case. Shares root cause with the intent divergence below.
  - `[low]` `[patch]` corrupt-state loader healing unproven (verification-gap) — Pre-verified gap accepted as filed: helper tests pin the helper only, and the sole loader pairing uses an invalid body. Fix applied: loader case with `"{corrupt"` state plus a valid signed bundle expecting ok:true and a re-recorded entry.
  - `[low]` `[reject]` no network-isolation or installed-binary spawn test (intent-alignment divergence 1) — Verified absent, but the property holds by construction (only `node:fs`/`node:crypto` plus `contract`/`gate` imports, enforced by boundaries) and every run uses temp dirs with generated keys. A socket-spy or binary-spawn harness is beyond a direct correction.
  - `[low]` `[reject]` no dual-verifier differential harness over a shared corpus (intent-alignment divergence 2) — Verified: coverage is generated vectors plus the golden-fixture hash/acceptance self-check. A dual runner would need importing `apps/service`, forbidden by `no-cross-app-imports`; the committed golden fixture is the sanctioned differential pin.
  - `[medium]` `[patch]` default path, clock, and bin wiring not exercised end-to-end (intent-alignment divergence 3) — Same defect as the verification-gap default-path row; grouped and shares its patch route (default-path pins applied; the injected `--now` clock is the specified seam, covered by literal-clock cases).
  - `[low]` `[reject]` `main()` output/exit and per-flag inline forms only via `run()` (intent-alignment divergence 4) — Verified: `main()` is a thin write-plus-exit wrapper and inline parsing shares one `next()` path pinned by the equals-form case. A process-spawn harness is beyond a direct correction.
  - `[false]` `[reject]` staleness tested with literal clocks, not clock manipulation (intent-alignment divergence 5) — Refuted: the injected `--now` clock is the specified seam and no Buyer-bound plumbing exists in 8.1 scope to exercise; literal clocks are the correct test form.
  - `[false]` `[reject]` planning artifacts are documentation, not runtime (intent-alignment divergence 6) — Refuted as a defect claim: context and spec files are documentation by design; the runtime behavior they describe is pinned by the suites above.

## Auto Run Result

- Summary: story 8.1 gives the empty `apps/cli` scaffold a fully offline bundle-loading unit. `domain-harness bundle verify --bundle <path> --trust-keys <path> --tenant <id> [--state <path>] [--now <iso>]` reads a bundle file and a trust-keys file from paths, verifies with the service's fixed order and rules (`shape → unknown_key → signature_failed → tenant_mismatch → hash_mismatch → stale_sequence`, then the runner-style staleness guard against payload `issuedAt`/`stalenessHours` with `frozen` suspension) against a local atomic last-seen state file, prints exactly one shared gate sentence with exit 1 on any failure (`bundle verification failed`, `bundle stale`), and prints `bundle verified <hash> <sequence>` with exit 0 on success while persisting the pointer for story 8.2. No network, no `core`/`extractor` run, no changes outside the CLI (plus the workspace link it needs).
- Files:
  - `apps/cli/src/bundle-file.ts` (NEW) — pure offline loader `loadBundleFile`, fixed verification order, staleness guard `isBundleStale`, never throws.
  - `apps/cli/src/trust-keys.ts` (NEW) — trust-keys file parser (key id → Ed25519 PEM map), never throws.
  - `apps/cli/src/bundle-state.ts` (NEW) — atomic tenant → `{sequence, hash}` JSON state store, corrupt-tolerant reads.
  - `apps/cli/src/cli.ts` (NEW) — `bundle verify` argv parsing, cache-dir default state, injected clock, `run()` plus `main()`; review patches: `--now` validation, non-absolute XDG rejection, `isCliEntryPoint` accepting win32 separators.
  - `apps/cli/src/index.ts` — barrel re-exports for 8.2 (keeps `packageName`).
  - `apps/cli/src/bundle-file.test.ts`, `trust-keys.test.ts`, `bundle-state.test.ts`, `cli.test.ts` — full I/O-matrix suites (45 tests); review patches: hardcoded success string, custom-bound cases, corrupt-state healing case, default-path pins, entry-point pins.
  - `apps/cli/package.json`, `apps/cli/tsconfig.build.json`, `pnpm-lock.yaml` — `@domain-harness/gate` workspace link (sentences only) plus `bin` wiring.
  - `_bmad-output/implementation-artifacts/epic-8-context.md` (NEW) — compiled Epic 8 context (~973 tokens).
  - `_bmad-output/implementation-artifacts/spec-8-1-load-and-verify-a-bundle-file-offline.md` — this spec (status done).
- Findings breakdown: 28 findings — 7 patched (1 high: win32 entry regex silent pass; 2 medium: custom-bound and default-path test gaps; 4 low: `--now` validation, success-string tautology, XDG absolutism, corrupt-state loader proof), 0 deferred, 21 rejected (10 false with refuting evidence — service parity on key-id lookup and base64, stdout convention, last-wins flags, `__proto__` in-memory-only, literal-clock seam, docs-by-design; 11 low — fail-closed `--help`, best-effort state persist, input-path collision, unbounded local reads, state locking, mtime/golden test form, network/binary-spawn and dual-runner harnesses beyond direct correction).
- Follow-up review recommendation: true — one patched high entry. Named unverified risk: the win32 entry-point fix (`isCliEntryPoint` accepting backslash separators) is pinned only by unit cases running on darwin; no run executes the built binary on an actual win32 host, so a platform-specific invocation quirk outside the regex (e.g. `.cmd` shim argv shape) would still go undetected.
- Verification: `pnpm install --frozen-lockfile` clean; `pnpm -r run build` exit 0; `pnpm -r run typecheck` exit 0; `pnpm -r run lint` exit 0 (max-warnings 0 embedded); `pnpm run boundaries` no violations; `pnpm -r run test` with both `REGISTRY_TEST_DATABASE_URL` and `SERVICE_TEST_DATABASE_URL` on postgres 18 localhost — contract 345, collector 1, core 95, boundaries-tooling 17, extractor 16, gate 15, cli 45, mcp-bridge 11, registry 826, service 169, panel 420 passed + 1 skipped (1960 passed total, 0 failed). Pre-patch full-parallel run showed panel/mcp-bridge timeouts (~512s durations); both passed in isolation (panel 420+1, mcp-bridge 11) confirming the known parallelism flake, and the post-patch full run was green in one pass. Matrix audit: all 13 spec I/O rows covered by named tests that ran and passed (cli suite 45/45).
- Residual risks: (1) win32 entry covered by unit pins only — see follow-up note above. (2) Combined-cause precedence (stale plus sequence-old reports verification-failed) follows the spec-mandated order; single-cause fixtures pin each row. (3) State-write failure stays best-effort ok (disclosed; precedented by 4.5 never-throwing records) — a failed disk write silently skips replay-pointer persistence for that run. (4) Non-ISO-but-guard-passing `issuedAt` values (e.g. impossible month) reach the stale guard as `bundle stale`; truly malformed strings fail the contract guard as verification-failed — both fail closed with exit 1.

## Design Notes

- **Why mirror instead of share.** `no-cross-app-imports` forbids the CLI from importing `apps/service` or `apps/registry`, so the ~30 lines of hash/verify/stale primitives are re-implemented from `contract` plus `node:crypto`, exactly the story 4.2 precedent; the contract guards and canonical bytes stay single-sourced so drift fails tests.
- **Trust file shape** (key id → PEM, rotation overlaps by key id):
```json
{ "2026-10-a": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n" }
```
- **State file shape** (one entry per tenant, written only on success):
```json
{ "018f3d2a-7000-7000-8000-000000000001": { "sequence": 7, "hash": "9f2c…" } }
```
- **Command shape:** `domain-harness bundle verify --bundle ./bundle.json --trust-keys ./trust.json --tenant <uuidv7>`; `--state` and `--now` exist for tests and determinism, and the verified `SignedStandardBundle` plus hash is the value story 8.2 adapts into its Gate snapshot.

## Verification

**Commands:**
- `pnpm --filter @domain-harness/cli test` -- expected: loader, trust, state, and command suites pass with no database and no network.
- `pnpm run build` -- expected: workspace builds including the CLI bin wiring.
- `pnpm run typecheck && pnpm run lint && pnpm run boundaries` -- expected: clean, no boundary violations, CLI imports only contract, gate, and Node built-ins.
- `pnpm test` -- expected: full workspace suite passes.

**Manual checks (if no CLI):**
- `apps/cli/src/bundle-file.ts` imports sentences from `@domain-harness/gate` and guards/canonicalization from `@domain-harness/contract`; no `apps/*` import appears.
- A tampered copy of a valid bundle file refuses with exactly `bundle verification failed` and exit 1; an aged copy with `frozen: false` refuses with exactly `bundle stale` and exit 1.
