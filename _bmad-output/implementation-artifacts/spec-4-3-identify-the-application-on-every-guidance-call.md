---
title: 'Story 4.3: Identify the Application on every Guidance call'
type: 'feature'
created: '2026-10-14'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
baseline_commit: '9e216b01bf0f426e50a720f523c82994fbb21f0e'
context:
  - _bmad-output/implementation-artifacts/epic-4-context.md
  - _bmad-output/implementation-artifacts/spec-4-2-company-service-pulls-verifies-and-activates-bundles.md
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** The Company service has an active, verified bundle (4.2) but no identity story: a Builder's agent cannot present an Application id or a proof of which repository it is running in, so the service can neither trust-on-first-use bind an id to a repository, refuse a copied identity, nor answer `unbound` instead of serving another Project's Standards.

**Approach:** Ship the stdio MCP bridge package `@domain-harness/mcp-bridge` in this workspace — it reads the Project identification file and computes the repository fingerprint at call time, then forwards every MCP message to the configured service endpoint over Streamable HTTP carrying the versioned identity headers — and add the service-side identity unit that binds, refuses, resolves the Project from the active bundle, and records binding refusals and Project-id mismatches in the record store.

## Boundaries & Constraints

**Always:**
- Header names and the fingerprint algorithm are versioned in `packages/contract`: `X-DH-Application-Id`, `X-DH-Repo-Fingerprint`, and `X-DH-Advisory-Project-Id` (the advisory Project id of the parsed file — the service cannot read the Builder's file, and AC-6's mismatch report needs it), plus the algorithm version constant for SHA-256 (lowercase hex) over the root commit SHA of `git rev-list --max-parents=0 HEAD`.
- The bridge computes identity at CALL time, never at start-up: each forwarded MCP message carries the identity read from `<process cwd>/.domain-harness.json` (`parseIdentificationFile`) and the fingerprint computed then (a separate `git` subprocess per call is fine).
- Header presence is the accepted wire vocabulary: a parsed file sends `X-DH-Application-Id` + `X-DH-Advisory-Project-Id`; a computed fingerprint sends `X-DH-Repo-Fingerprint`. Absent values are simply absent headers. The bridge always forwards the call even when identity is incomplete — the service decides every identity outcome.
- Service-side decision table for `resolveGuidanceIdentity({ applicationId?, fingerprint?, advisoryProjectId? })` against the active bundle payload, in this fixed order, never throwing: (1) fingerprint absent/empty → `unbound`, sentence telling the Builder to commit once and retry (a repo with no commit is the primary defect; pinned precedence); (2) application id absent → `unbound`, sentence `missing or unreadable identification file`; (3) id not among `payload.applications` → `unbound`, sentence `unbound Application`, no binding mutated, nothing else resolved; (4) id present: look up the binding — none → bind TOFU (insert-once, re-read: the first presented fingerprint wins, mirroring the gate's Postgres insert) and return `bound` with the Project id resolved FROM THE BUNDLE; bound with a different fingerprint → record a Binding refusal row in the SHARED `binding_refusals` table and return `refused`, sentence `duplicate Application id`; bound with the same fingerprint → `bound`.
- Application-uri binding is global, not per-surface: the binding rows live in the existing `application_bindings` table of the record store — Guidance and the Gate (5.3) use ONE check (AD-19, "every surface uses this one check").
- An advisory Project id that differs from the bundle's Project id for that Application is reported in the response AND recorded (new append-only table `guidance_project_mismatches`, migration `0003_*.sql` picked up by `migrate(client)` automatically); the bundle's Project id is what is returned and what every later serving story uses.
- Guidance refusals and `unbound` sentences reuse the versioned gate sentence constants (`@domain-harness/gate`: `UNBOUND`, `MISSING_IDENTIFICATION_FILE`, `DUPLICATE_APPLICATION_ID`) — UX-DR29's fixed strings; ONLY the commit-once sentence is new (house precedent: new-reason constants inline in the service unit, like 4.2).
- The typed identity result lives in `packages/contract` (following 4.4's planned `hit`/`miss`/`unbound` results): a guard + type for exactly one of `bound` (application id, project id from the bundle, pinned bundle hash, optional advisory mismatch), `unbound` (reason + fixed sentence), `refused` (sentence + presented/bound fingerprints). Sentences inside results make the service response byte-stable.
- The bridge start-up contract: endpoint URL is argv[2]; missing/invalid URL prints exactly one envelope (GTK code `missing_configuration`/`invalid_configuration` style, `{ code, message, subject }`) to stderr and exits 1; on runtime forwarding failures it answers the stdio client with a JSON-RPC error and keeps running; stderr carries no subject text and stdout carries only the MCP stream.

**Never:**
- No MCP tool server in the service, no tool descriptors, no `hit`/`miss` resolution (4.4), no guidance-event records (4.5), no Read API (4.6), no new binding table separate from `application_bindings` for the id↔fingerprint pair (1 table, 1 check).
- No registry, `core`, `extractor`, panel, CI-Gate runner or boilerplate-rendering changes; Boilerplate generation is untouched (their `.mcp.json`/`.cursor/mcp.json` already declare `npx -y @domain-harness/mcp-bridge <url>`).
- The bridge imports only `@domain-harness/contract` (+ its SDK dependency); it mirrors the small fingerprint computation instead of importing `apps/` code (boundary rule `no-imports-from-apps`).
- No per-Application tokens, no remote-URL involvement in the fingerprint (AD-19: forks sharing a root commit stay an accepted pilot risk), no caching of identity across calls.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First call, bound folder | headers: id + fingerprint; id ∈ bundle; no binding | `bound` + Project id from the bundle + pinned bundle hash; binding row created; never throws | Never throws |
| Bound, same fingerprint | id bound to a fingerprint, same presented fingerprint | `bound`; no new binding row, no refusal | Never throws |
| Bound, different fingerprint | same id, different second fingerprint | `refused` (`duplicate Application id`); one shared `binding_refusals` row | Never throws |
| Id absent from bundle | id header present, no such `payload.applications` entry | `unbound` (`unbound Application`); binding unchanged; no other Project's Standards in the result | Never throws |
| Id header absent (file missing or unreadable) | no `X-DH-Application-Id` header (bridge could not parse) | `unbound` (`missing or unreadable identification file`); nothing is bound or recorded | Never throws |
| Repository with no commit | no `X-DH-Repo-Fingerprint` header | `unbound` with the commit-once sentence, regardless of the other headers | Never throws |
| Advisory mismatch | advisory Project id ≠ bundle's Project id for that Application | Project id from the bundle is returned; mismatch reported in the result AND one `guidance_project_mismatches` row | Never throws |
| Advisory agrees or absent | advisory == bundle, or no advisory header | no mismatch report, no row | Never throws |
| TOFU race | two first calls with different fingerprints before either binds | both land on the single surviving binding row (first insert wins, re-read decides); one presents differently → exactly one refusal row | Never throws |
| Bridge folder changes file between calls | file rewritten between two forwarded calls | second call forwards the newly read id/advisory (call-time read, no caching) | Never throws |
| No identification file at bridge call time | `.domain-harness.json` absent, client still calls | call forwarded without id/advisory headers; service answers the file sentence | Never crash |
| Bridge start-up without URL | argv empty / not http(s) | exactly one stderr envelope, exit 1; no stdout noise | Never a partial start |
| Endpoint unreachable / HTTP error | forwarding transport failure | JSON-RPC error to the stdio client; bridge keeps running; stdout stays the MCP stream | Never crash |
| Bridge naming | package name must equal `MCP_BRIDGE_PACKAGE` (`@domain-harness/mcp-bridge`) so Epic 3 boilerplates need no regeneration | pinned by test | Compile-time |

</intent-contract>

## Code Map

- `packages/contract/src/identification-file.ts` -- reuse verbatim: `IDENTIFICATION_FILE_NAME` (L18), `parseIdentificationFile` (L76: parsed/missing/unreadable), `IdentificationFile` (`applicationId`, advisory `projectId`). The bridge reads with this parser; the service never parses raw files on the Guidance path.
- `packages/contract/src/bundles.ts` -- `SignedStandardBundle`/`StandardBundlePayload` (L42/L57), `payload.applications: BundleApplication[]` (`id`/`projectId`, L29) — the resolution source ("never from the file").
- `apps/service/src/ci-gate/fingerprint.ts` -- the fingerprint rule to mirror (cannot import cross-app): `git rev-list --max-parents=0 HEAD` via `execFileSync`, first line trimmed, `createHash("sha256")` hex. The bridge copies this (~20 lines).
- `packages/gate/src/sentences.ts` + gate `binding.ts` -- the fixed UX-DR29 sentence constants to reuse (`UNBOUND` L17, `MISSING_IDENTIFICATION_FILE` L20, `DUPLICATE_APPLICATION_ID` L23) and the binding/refusal record shapes to mirror.
- `apps/service/src/ci-gate/runner.ts` (L80–131) -- the unbound check (`applicationIdsOf` + `repoFingerprint.trim() === ""` → `unbound` BEFORE any binding) and the shared-table binding sequence (`getBinding` → `bindApplication` → compare → `recordBindingRefusal`) that the guidance identity unit mirrors behaviorally.
- `apps/service/src/ci-gate/store.ts` -- `createPool` (L334), `mintUuidV7`, Postgres twin row mapping, and the `on conflict do nothing` + re-read TOFU insert (Postgres `bindApplication`, ~L177) — the race semantics to reproduce in the identity store.
- `apps/service/migrations/0001_ci_gate.sql` -- the EXISTING `application_bindings` (application_id PK, fingerprint) and `binding_refusals` tables the identity store shares; do NOT create parallel binding tables.
- `apps/service/migrations/0002_standard_bundles.sql` + `apps/service/src/bundles/store.ts` -- the bundles unit: `getPointer(tenantId)` → active hash, `pinnedBundle(hash)` → signed bundle bytes; the identity unit reads the ACTIVE bundle through these (payload.applications + hash to pin in the result). Migration-numbering + twin-store + never-throw patterns are the 4.2 template.
- `apps/service/src/bundles/env.ts`, `service-cli.ts` -- one-envelope start-failure printing pattern (flush-safe exit, one line, exit 1) for the bridge's argv validation.
- `apps/service/src/index.ts` -- barrel exports; the guidance unit's public symbols are added here as 4.2 did.
- `apps/service/src/ci-gate/store.postgres.test.ts` / `bundles.db.test.ts` -- db-suite harness (`SERVICE_TEST_DATABASE_URL`, throwaway database, `describe.skipIf`) and migration-report expectations to extend for 0003.
- `packages/contract/src/boilerplate.ts` L81 -- `MCP_BRIDGE_PACKAGE = "@domain-harness/mcp-bridge"`; the new package's `package.json` name must equal it; `boilerplate.test.ts` L37 pins the constant.
- `apps/registry/src/boilerplate/render.ts` L101/L157 -- the exact MCP configuration the boilerplates already render (`npx -y @domain-harness/mcp-bridge <url>`); reads-only proof there is nothing to regenerate.
- `.dependency-cruiser.cjs` -- boundary rules applying to the new package: no imports from `apps/`, declared npm deps only; `pnpm run boundaries` must stay clean.
- Node globals: `fetch`/`URL` for the bridge's HTTP forwarding; `node:crypto` + `node:child_process` allowed in apps (registry precedent).

## Tasks & Acceptance

**Execution:**
- `packages/contract/src/guidance-identity.ts` -- NEW: `GUIDANCE_IDENTITY_HEADERS` (`applicationId`/`repoFingerprint`/`advisoryProjectId` names), `REPOSITORY_FINGERPRINT_ALGORITHM_VERSION = 1` (documented algorithm: lowercase SHA-256 hex of the root commit SHA from `git rev-list --max-parents=0 HEAD`), `GuidanceIdentityResult` (one of `bound`/`unbound`/`refused` as pinned in Boundaries), guards `isGuidanceIdentityResult`; exported from `packages/contract/src/index.ts` (+ unit tests in `guidance-identity.test.ts`).
- `packages/mcp-bridge/package.json` (+ tsconfig/eslint wiring) -- NEW workspace package named exactly `MCP_BRIDGE_PACKAGE`; deps: `@domain-harness/contract` (workspace) + `@modelcontextprotocol/sdk` 1.x (newest 1.x the lockfile accepts); registered in `pnpm-workspace.yaml` automatically via `packages/*`.
- `packages/mcp-bridge/src/identity.ts` -- NEW call-time identity computation: `readIdentificationFile(root)` → `{ applicationId, advisoryProjectId }` present only when `parseIdentificationFile` says `parsed`; `computeBridgeFingerprint(root)` → lowercase sha256 hex of the root commit SHA or `undefined` (mirror of the gate's rule); never throws.
- `packages/mcp-bridge/src/bridge.ts` -- NEW stdio MCP stdio→Streamable-HTTP forwarding entry: argv[2] endpoint URL validated (one stderr envelope + exit 1 otherwise); every forwarded MCP message recomputes identity and injects the versioned headers on the outgoing HTTP request; forwarding/transport failures surface as JSON-RPC errors on stdout; no subject content on stderr.
- `packages/mcp-bridge/src/index.ts` + a naming pin -- barrel exports; a test (spawned process) pins that the executed package name matches `MCP_BRIDGE_PACKAGE` and that headers derive from a temp git repo with the root commit.
- `packages/mcp-bridge/src/bridge.test.ts` -- harness: temp git repos (with/without commit, with/without file, later file change) + a local `node:http` stub capturing the forwarded request's headers/message body; pins call-time re-read (two calls → two identical header sets / updated ones after the file changes), header absence vocab for no-commit/no-file, error envelope on missing argv, JSON-RPC error on transport failure.
- `apps/service/src/guidance/identity.ts` -- NEW `resolveGuidanceIdentity({ headers, tenantId, store, getPinnedBundle })` (or equivalent narrow inputs): never-throw `GuidanceIdentityResult` per the decision table; resolves Project from `payload.applications`, pins the active bundle hash in `bound` results.
- `apps/service/src/guidance/store.ts` -- NEW `GuidanceIdentityStore` InMemory + Postgres twins writing bindings/refusals to the SHARED `application_bindings`/`binding_refusals` tables (same SQL semantics as the gate store incl. 23505-race insert-once re-read) and mismatches to the new table.
- `apps/service/migrations/0003_guidance_identity.sql` -- NEW append-only `guidance_project_mismatches` (id, application_id, presented_project_id, bundle_project_id, bundle_hash, created_at), the 0001 style (plain columns, snake_case).
- `apps/service/src/guidance/identity.test.ts` + `apps/service/src/guidance/guidance.db.test.ts` -- unit suite + PostgreSQL-18 db suite in the 4.2 harness style: every decision-table row pinned (TOFU first bind, same-fingerprint, refusal + shared refusal row, advisory mismatch row + report, race on first bind, migration report incl. 0003).
- `apps/service/src/index.ts` -- export the guidance unit's public symbols.
- `apps/service/src/ci-gate/store.postgres.test.ts` -- extend the migration-count/table-list expectation for 0003 (compat touch, as 4.2 did for 0002).
- `README.md` -- "Guidance identity" section: the three headers, the fingerprint algorithm version, the bridge usage (`npx -y @domain-harness/mcp-bridge <endpoint URL>`), the decision table, the shared binding table note.

**Acceptance Criteria:**
- Given an MCP client that starts `@domain-harness/mcp-bridge <url>` in a repository, when any MCP call is forwarded, then the outgoing Streamable HTTP request carries `X-DH-Application-Id`, `X-DH-Repo-Fingerprint` (lowercase hex SHA-256 of the root commit SHA) and `X-DH-Advisory-Project-Id` exactly when each value was computable at call time, recomputed per call with no caching.
- Given a repository with no commit, a missing or unreadable identification file, or an id absent from the active bundle, when the identity is resolved, then the result is `unbound` with the matching fixed sentence and no binding, refusal or other Project's Standards; given a first-seen id from the bundle, the service binds it TOFU and resolves the Project from the bundle only; given a bound id with a different fingerprint, `refused` in the fixed sentence and one row in the shared `binding_refusals` table; given an advisory Project id disagreement, the response reports the mismatch, records one `guidance_project_mismatches` row, and the bundle's Project id is the one returned.
- Given the Epic 3 boilerplates, when rendered or inspected, then they are unchanged and need no regeneration (their declared bridge command + package name still match the shipped package).
- Given `pnpm test` (db suites with `SERVICE_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres`), `pnpm run boundaries`, `pnpm run build`, `pnpm run typecheck`, `pnpm run lint`, when they run, then all pass with zero warnings and every matrix row is pinned by a named test that actually ran.

## Spec Change Log

## Review Triage Log

### 2026-10-14 — Review pass
- verdicts: 30 findings — high 0, medium 4, low 20, false 6, maybe-false 0
- findings:
  - `[medium]` `[patch]` BH1: the package declares the `npx -y` bridge the Boilerplates ship, but had no `bin` field, so npx could not resolve an executable. Fixed: `"bin": { "mcp-bridge": "./dist/bridge.js" }` added and the compiled entry verified against the guard.
  - `[medium]` `[patch]` ECH1: same root cause as BH1's missing bin (grouped).
  - `[medium]` `[patch]` ECH2: the entry guard (`isDirectEntry`) would not fire for an executed `dist` entry, intending a silent no-op outside src. Fixed: bin points at `./dist/bridge.js`, whose `import.meta.url` satisfies the guard (verified by a real compiled run).
  - `[medium]` `[patch]` VG1: the three-call bridge test could never distinguish a caching fingerprint implementation (the root SHA never changes mid-session, so a cached value passes every assertion). Fixed: the test amends the root commit before the third ping and asserts the NEW fingerprint.
  - `[low]` `[patch]` BH2: the spec's Auto Run Result contradicted the (resumed) frontmatter. Fixed: rewritten by this review's finalize step.
  - `[low]` `[patch]` BH4: the README decision table lacked the seventh outcome (store/bundle-read failure → `unbound` "run did not complete", reason `unavailable`). Fixed: row added.
  - `[low]` `[patch]` BH5: the fingerprint rule was underspecified for multi-root histories (`rev-list --max-parents=0` may print several SHAs). Fixed: the FIRST emitted line pinned in the contract comments, the bridge module doc and a unit test over an octopus-merge repo.
  - `[low]` `[patch]` BH6 + VG3: the InMemory race test pinned `first` as the winner by microtask luck. Fixed: honest like the Postgres race test (one bound + one refused, the winner unpinned).
  - `[low]` `[patch]` BH7: the repeat-offender behavior (one binding_refusals row per refused call) was unspecified. Fixed: pinned in the README and asserted by a two-refusal test.
  - `[low]` `[patch]` BH8 + ECH5: the advisory-mismatch semantics for refused/unbound calls were decided only by code order. Fixed: pinned (evaluated only on `bound` paths) in code comments, README and a records-no-row test.
  - `[low]` `[patch]` BH9: the missing-id unbound row was only exercised with `undefined`. Fixed: the case loops `undefined`, `""` and `"   "`.
  - `[low]` `[patch]` BH10: Postgres `bindApplication`'s re-read fallback fabricated a `bound` verdict from the presented fingerprint. Fixed: throws (the decision unit's catch answers `unavailable`).
  - `[low]` `[patch]` BH11 + ECH7: the ledger listings had no ORDER BY (nondeterministic under multiple rows) and the mismatch ledger had no index on `application_id`. Fixed: `created_at asc, id asc` ordering per the Gate store's style and an index in 0003.
  - `[low]` `[patch]` BH12: the README's "imports only contract" under-described the package's SDK dependency. Fixed: "imports only contract (+ its MCP SDK)".
  - `[low]` `[reject]` BH14: no timeout on forwarded calls (a hung accepting endpoint stalls a waiting client). A blanket abort would kill the transport's long-lived SSE GET; a POST-only deadline is SDK-version-specific and has no cheap honest test. The hang state is rarer than the tested instant refusal; recorded for the serving story (4.4).
  - `[low]` `[patch]` BH15: the transport-failure test's stderr assertion was weak versus the spec's "stderr carries no subject text". Fixed: asserted exactly empty.
  - `[low]` `[reject]` BH16: `waitResponse` matches any line containing `"id":<n>`. The suite's ids are sequential 1–3, so no reachable misfire; an exact-JSON match refactor is noise.
  - `[low]` `[patch]` ECH3: a stdin `error` event never resolved the runBridge loop. Fixed: an `error` listener beside the `end` one.
  - `[low]` `[patch]` ECH4: the README's "every failure answers one JSON-RPC error" over-claimed for notifications. Fixed: only requests the client is waiting on get the error.
  - `[low]` `[patch]` ECH6: no test pinned the packaged entry. Fixed: the bin field is pinned by a bridge test with a source-existence check.
  - `[false]` `[reject]` BH3: the empty change/triage logs contradicted the self-review claim. The logs record review-loop entries only; empty at first review is the designed state.
  - `[false]` `[reject]` BH13: cross-tenant binding leakage (shared `application_bindings` without a tenant column while bundles are tenant-keyed) defers — the binding tables predate this story (0001, from 5.3) and the record store's tenancy model is a serving-story (4.4) decision; application ids are registry-minted UUIDv7s, so a cross-tenant collision is astronomically unlikely in practice.
  - `[low]` `[defer]` BH13 (ledger route): the shared binding tables' missing tenant column — same finding, routed here for the story files: recorded in the spec frontmatter `deferred` list.
  - `[false]` `[reject]` IA1: the audit's R1 reading (the wire seam tested end-to-end) — the serving surface is story 4.4, pinned by the spec; the diff deliberately ships the two identity halves.
  - `[false]` `[reject]` IA2: the "published" premise — packaging is fixed by the bin patch; publishing a distribution artifact is a deployment action outside code.
  - `[false]` `[reject]` IA3: the boilerplate no-regeneration claim is verified transitively (the registry suite pins the rendered configs; untouched code). The spec's design keeps it that way.
  - `[false]` `[reject]` IA4: the extras beyond the intent's enumerated rows (commit-first precedence, `unavailable`, tenant-scoped bundles, TOFU race semantics) are consistent extensions under readings the intent leaves open.

## Design Notes

- **Why a third header.** The AC pins the two identity headers, but AC-6's advisory mismatch needs the file's advisory Project id at the service. The service cannot read the Builder's file, so the bridge forwards the parsed advisory value as `X-DH-Advisory-Project-Id` — itself pinned in `contract` (same versioning rule, AD-19). Without it the mismatch row would be unrecordable.
- **Precedence is part of the contract.** Two absent-header combinations are ambiguous in principle (no fingerprint + no id: no commit and possibly no file?); the spec fixes fingerprint-first precedence so the first sentence always names the first thing the Builder must fix. Both-absent → commit-once sentence.
- **The identity store is deliberately a sibling twin, not an extension:** bindings/refusals reuse exact 0001 tables at the SQL level (one `application_bindings` row per application across Guidance and Gate), so either unit's store sees the other surface's bindings; only the mismatch ledger is new (0003). If the implementer instead parameterizes the guidance unit over a narrow structural `BindingLedger` interface satisfied by both stores, that satisfies the same rule.
- **Bridge transport mechanics**: the spec pins observable behavior (per-call headers, error surfacing, exit codes), not SDK internals; the implementer chooses between a persistent Streamable HTTP session with header-refresh reconnects and per-message transport cycles, guided by the SDK's versioned API. Tests assert via a stub server, never against SDK internals.

## Verification

**Commands:**
- `pnpm test` (db suites need `SERVICE_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres`) -- expected: new bridge + identity suites and the extended db suites pass; nothing existing regresses.
- `pnpm run boundaries` -- expected: no violations (the bridge imports only contract + its SDK; nothing imports apps).
- `pnpm run build` / `pnpm run typecheck` / `pnpm run lint` -- expected: clean, zero warnings, the new package typechecks/builds.
- `pnpm --filter @domain-harness/registry test` -- expected: unchanged (proves boilerplates need no regeneration).

**Manual checks (if no CLI):**
- `README.md` guidance identity section documents the three headers, algorithm version and the decision table.
- `packages/mcp-bridge/package.json` name equals `MCP_BRIDGE_PACKAGE` exactly.

## Auto Run Result

Status: done

**Summary:** A Builder's agent can now identify itself: the new `@domain-harness/mcp-bridge` package (`npx -y @domain-harness/mcp-bridge <endpoint URL>`) reads the Project identification file and computes the repository fingerprint (SHA-256 of the root commit, first-line rule) at call time — never cached — and forwards every MCP message over Streamable HTTP carrying `X-DH-Application-Id`, `X-DH-Advisory-Project-Id` and `X-DH-Repo-Fingerprint` exactly when each value was computable. On the service, `resolveGuidanceIdentity` runs the one decision every surface shares against the active bundle: commit-first precedence for a repository without commits; `missing or unreadable identification file`; `unbound Application` for ids absent from the bundle; trust-on-first-use binding (first fingerprint wins, insert-once re-read) with the Project resolved from the bundle only; a copied fingerprint `refused` in the fixed sentence with one row in the shared `binding_refusals` table; an advisory Project mismatch reported in the result and recorded in the new append-only `guidance_project_mismatches` ledger (0003). Boilerplates need no regeneration (their declared command and package name still match the shipped package).

**Files changed:**
- `packages/contract/src/guidance-identity.ts` (+ tests, `src/index.ts`): the versioned header names, the fingerprint algorithm version (first-line rule documented) and the typed `bound`/`unbound`/`refused` result with guards.
- `packages/mcp-bridge/` (new workspace package, name pinned to `MCP_BRIDGE_PACKAGE`, `bin` for the declared `npx` run): call-time identity (`identity.ts`), the stdio↔Streamable-HTTP bridge (`bridge.ts` — per-request identity via a custom fetch, one-envelope start-up, JSON-RPC errors on failed forwards, stdin end/error handling), spawn-style tests over temp git repos and a header-capturing stub.
- `apps/service/src/guidance/` (new): the decision-table `resolveGuidanceIdentity` (commit-first precedence, TOFU binding, fixed sentences from `@domain-harness/gate` plus the new `COMMIT_ONCE`), the `GuidanceIdentityStore` InMemory + Postgres twins writing to the SHARED `application_bindings`/`binding_refusals` tables and the mismatch ledger; migration `0003_guidance_identity.sql`; unit + PostgreSQL-18 db suites covering every matrix row (races included).
- Compat touches: `apps/service/src/index.ts` (public symbols), migration/table expectations of the CI-Gate and bundles db suites; `README.md` "Guidance identity" section; `pnpm-lock.yaml` (the MCP SDK, purely additive).

**Review findings:** 30 findings: high 0, medium 4, low 20, false 6.
- **Patched (medium):** the missing `bin` field behind the declared `npx` command (BH1/ECH1/ECH2/ECH6); the bridge test that could not detect a caching fingerprint implementation (VG1).
- **Patched (low):** honest race tests; throw-instead-of-fabricate on the TOFU re-read; ledger ordering + index; the multi-root first-line rule; repeat-offender and mismatch-semantics pins; the empty-id pin; README accuracy (seventh outcome, SDK dependency, notifications, the two pinned sentences); the stderr-empty and stdin-error hardening; the stale run report rewritten.
- **Deferred:** the tenant column of the shared binding tables (pre-existing 0001 tables from 5.3; the record store's tenancy decision belongs to the serving story 4.4).
- **Rejected:** 2 low and 6 false, each with its reason in the triage log.

**Follow-up review recommended: true.** Patched counts: high 0, medium 2 entries, low 11. The named unverified risk: the bridge has never been executed against a real MCP client or a live wire (SDK 1.32's transports beyond the stub suite); the compiled-entry guard was verified once manually.

**Verification:**
- With `REGISTRY_TEST_DATABASE_URL` and `SERVICE_TEST_DATABASE_URL` (local PostgreSQL 18): contract 317, bridge 11, registry 756, service 131, panel 374 + 1 skipped (pre-existing), core 95, gate 14, boundaries 17, cli/collector/extractor 1 and 16 each — all suites green; `pnpm run boundaries` reports no violations; `pnpm -r run build`, `typecheck` and `lint` exit 0 (zero warnings).
- Matrix audit: every I/O-matrix row (13) is covered by a named test that ran and passed in the verification output.

**Residual risks:**
- Choices made on the human's behalf: the third `X-DH-Advisory-Project-Id` header (the service cannot read the Builder's file; needed by the mismatch AC); fingerprint-first precedence when both identity halves are absent (the commit-once sentence names the first thing to fix); the `unavailable` store-failure sentence reuses the gate's run-did-not-complete constant; the advisory mismatch is evaluated only on bound paths, and every refused call records one shared refusal row.
- The fingerprint of a multi-root history is the first emitted `rev-list` line — deterministic per implementation but unpinned across git versions; the single-root common case is unaffected.
- The bridge runs one `git` subprocess per HTTP request (spec-deemed acceptable; traffic-only requests like the SSE GET also pay it).
- Publishing `@domain-harness/mcp-bridge` is a deployment action; within the workspace the declared `npx` command runs through the bin field, and the pilot's real distribution path is external to this story.
