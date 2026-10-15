---
title: 'Story 4.4: Serve Document response through the four MCP tools'
type: 'feature'
created: '2026-10-14'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
baseline_commit: '6871297893866fda5816dd23faadc08d5a55c9f7'
context:
  - _bmad-output/implementation-artifacts/epic-4-context.md
  - _bmad-output/implementation-artifacts/spec-4-3-identify-the-application-on-every-guidance-call.md
warnings: ['oversized']
deferred:
  - summary: >-
      The perf p95 assertion may flake on CPU-constrained CI runners (wall-clock measurement).
    evidence: |-
      The 50-worker shape passed repeatedly under full parallel turbo load locally, but no
      CI-like constrained-CPU repetition has verified the current shape; if true, the flake
      would grade medium (unverified). Settle by rerunning the perf suite repeatedly (~20x)
      under CPU-constrained parallel turbo before trusting CI.
    location: >-
      apps/service/src/guidance/perf.test.ts
    severity: medium (unverified)
---

<intent-contract>

## Intent

**Problem:** The Company service binds an Application identity on every Guidance call (4.3) but answers nothing: a Builder's agent has no tools to call, no `hit`/`miss`/`unbound` answer, no staleness flag — Document response (FR-11) does not exist yet.

**Approach:** Version the four granular tools and their typed result in `packages/contract`; resolve each tool call in a new never-throwing serving unit that reuses 4.3's identity decision, answers through `core` against the pinned active bundle (staleness flags every response), and host the tools over Streamable HTTP with the MCP SDK behind a new guidance server entry.

## Boundaries & Constraints

**Always:**
- Tool names, descriptions (UX-DR30 product copy stating the decision each serves and its input) and the request schema are versioned in a NEW `contract` module: exactly `code_stack_rule` (input: a language, framework or library name), `design_component` (input: a component name or usage situation), `design_token` (input: a token name), `design_import` (input: a module specifier). All four take ONE required string param `subject` (1..1000 chars). Descriptions state decision + input and are reviewed as copy.
- Every tool returns a typed result in that same module: exactly one of `hit` (tool, asked subject, Standard id, version, deterministic content including the Correction instruction, bundle hash, `stale`), `miss` (tool, asked subject, one sentence including it, bundle hash, `stale`) or `unbound` (reason + fixed sentence). `stale` is `true` and the response says `bundle stale` when the pinned bundle is past its bound and not frozen (from `bundledState`): a stale service still answers from the active bundle.
- Decision order is fixed: (1) identity first via `resolveGuidanceIdentity` — anything but `bound` answers `unbound` with that outcome's sentence (commit-once, missing/unreadable file, `unbound Application`, `duplicate Application id`, `run did not complete`); its records (refusals, mismatches) are 4.3's existing behavior, unchanged; (2) `bundledState` for the staleness flag; (3) core resolution. No store/bundle read that fails throws: a failing identity answer is `unbound`/`run did not complete`.
- The Effective Standard set is resolved ONLY from the bundle payload through `resolveEffectiveSet`: standards mapped to `SlotHolder`s via core's `entrySlot` (projectId = the Standard's `project.id`), tree = `payload.tree.projects`, locked ids = `payload.tree.lockedRules` entries (dedup `standardId`). The Project resolved from the bundle is the only Project used — the advisory Project id never influences serving. A set that cannot be resolved (invalid payload, `resolveEffectiveSet` error — project not found, slot conflict, invalid tree) answers `unbound` with the fixed `Effective Standard set could not be read` sentence.
- Matching is deterministic and documented in `contract` (rule text next to the tool descriptors): casefold (trim, NFC, lowercase) equality of the subject against the winning set's slot names — for `code_stack_rule` any code-stack category, for `design_token` token names, for `design_import` module specifiers; for `design_component` first the casefolded component name, else the casefolded subject occurring inside a component's casefolded `usageRule` (containment); the first match in `core`'s deterministic order wins; no match is a `miss`.
- `hit` content is one deterministic text rendering of the Standard's live entry, built from its fields (what the entry requires, allows or prohibits; a component's usage rule and tokens; a code-stack entry's constraint) and — when `correctionInstruction` is non-null — ending with `Correction: <instruction>`. The result text sent to the MCP client is the typed result serialized deterministically (canonical JSON).
- Serving is stateless per request: the adapter reads the identity headers from EVERY HTTP request (GUIDANCE_IDENTITY_HEADERS), needs no prior briefing call, never blocks the agent's turn, and caches nothing about identity across requests.
- Sentences: import the versioned constants from `@domain-harness/gate`; the per-tool `miss` sentence template and the `bundle stale` line follow 4.3's precedent — new-reason constants live in the serving unit.

**Never:**
- No guidance-event records, no gap persistence (4.5); no Read API (4.6); no registry, `extractor`, panel, CI-Gate, boilerplate or bridge changes — the bridge already forwards every message; its endpoint URL simply points at the guidance server.
- No new migration or record table; no caching of resolved sets; no second resolver implementation anywhere (core is the only one — export its EXISTING slot helpers rather than copying them).
- No MCP SDK major other than `@modelcontextprotocol/sdk` 1.32.1 — exactly what the bridge pins and what this story's AC names (`1.x`; the spine review's v2 suggestion is superseded by this AC).
- Nothing logs or metricizes subject text; service logs carry ids and codes only.
- Nothing a tool call makes persistent (4.4 writes no row of its own).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| tools/list | client lists tools | exactly the four tools with the contract descriptions | Never throws |
| Bound, exact name | `code_stack_rule` "react" vs slot "React" | `hit`: id, version, content incl. Correction, bundleHash | Never throws |
| Component by usage situation | subject not naming a component but inside a `usageRule` | `hit` per the containment rule | Never throws |
| Component no match | subject matches no name or rule | `miss`, one sentence including the subject | Never throws |
| Unbound caller | no commit / missing file / unknown id / copied fingerprint | `unbound` fixed sentence; nothing resolved beyond identity; no other Project's Standards | Never throws |
| Advisory mismatch | advisory ≠ bundle Project | served for the BUNDLE Project only; mismatch already recorded by 4.3's unit | Never throws |
| Stale service | bundle past bound, not frozen | still answered from the active bundle; `stale: true` + `bundle stale` in the response | Never throws |
| Unreadable set | payload invalid or `resolveEffectiveSet` error | `unbound`, sentence `Effective Standard set could not be read` | Never throws |
| Store failure | pointer/pinned/identity read throws | `unbound`, sentence `run did not complete` | Never throws |
| Blank/absent subject | subject `""` or whitespace, or param missing | schema minLength 1 rejects truly absent/empty at the protocol layer; whitespace-only still reaches the unit and answers `miss` | MCP invalid-params or `miss` |

</intent-contract>

## Code Map

- `apps/service/src/guidance/identity.ts` -- REUSE verbatim: `resolveGuidanceIdentity` (L85, decision table + never-throw catch), `GuidanceIdentityHeaders` (L51), `PinnedActiveBundle` (L58). Step (1) of every tool call is exactly this function.
- `apps/service/src/guidance/store.ts` -- the 4.3 store twins; InMemory twin for unit/perf/MCP-HTTP suites; Postgres twin unchanged, no migration.
- `apps/service/src/bundles/puller.ts` -- REUSE `bundledState` (L185: `stale` = past `payload.stalenessHours`, frozen suspends) for the staleness flag.
- `apps/service/src/bundles/store.ts` -- `BundleRecordStore` (L74: `getPointer`/`pinnedBundle`), `createPostgresBundleRecordStore`, `createPool` — the guidance server opens one pool, runs `migrate` (../db/migrate.ts), and hands the bundles + guidance identity stores to the resolver.
- `packages/contract/src/bundles.ts` -- `StandardBundlePayload` (L42), `canonicalJson` (L180) for the deterministic result text.
- `packages/contract/src/standards.ts` -- `StandardInfo` (L189: `id`, `version`, `entry`, `project`), `entrySlotKind`/`entrySlotName`, `CODE_STACK_*`/`DESIGN_SYSTEM_*` entry shapes — the hit content's source fields.
- `packages/core/src/resolve.ts` -- `resolveEffectiveSet` (L71): THE resolution; `ResolveInput` (L24), `EffectiveEntry` (L35). `packages/core/src/slots.ts` -- `normalizeSlotName` (L52), `entrySlot` (L70) exist but are NOT exported from `packages/core/src/index.ts` yet (L9–26) — export, don't copy.
- `packages/gate/src/sentences.ts` -- the fixed UX-DR29 constants to import: `EFFECTIVE_STANDARD_SET_COULD_NOT_BE_READ` (L29), `BUNDLE_STALE` (L32), `RUN_DID_NOT_COMPLETE` (L26), `UNBOUND`, `MISSING_IDENTIFICATION_FILE`, `DUPLICATE_APPLICATION_ID`; 4.3's service unit imports this way.
- `apps/service/src/ci-gate/runner.ts` -- behavioral mirror: refusal sentences before resolution, staleness math at L106–121 (bounds vs issuedAt; different field names than 4.2 — the bundles unit is the source for 4.4), `RUN_DID_NOT_COMPLETE` on store failures (L144).
- `packages/mcp-bridge/src/bridge.ts` + `packages/mcp-bridge/package.json` -- the SDK pin (`1.32.1`) and the header names the server must read (via `GUIDANCE_IDENTITY_HEADERS`); the bridge is read-only for this story.
- `apps/service/src/bundles/env.ts` + `bundles/service-cli.ts` -- the config-from-env (L58 header comment) and one-envelope-start-failure (L181) patterns for the new guidance server entry.
- `apps/registry/src/http/server.ts` -- house `node:http` serving pattern (createServer, stdoutLogger L66, ids-and-codes-only log events).
- `apps/service/src/guidance/identity.test.ts` / `guidance.db.test.ts`, `packages/contract/src/guidance-identity.test.ts` -- suite styles to mirror.
- `README.md` L393 "Guidance identity" -- the section pattern for the new "Guidance tools" section.

## Tasks & Acceptance

**Execution:**
- `packages/contract/src/guidance-tools.ts` -- NEW: `GUIDANCE_TOOLS` (four entries: `name`, `description`, `inputSchema` `{ subject: string, 1..1000 }`), the typed `GuidanceToolResult` (`hit`/`miss`/`unbound` exactly as pinned) + `isGuidanceToolResult` guard, the documented deterministic matching rule (casefold names; `design_component` containment in `usageRule`), test file alongside; exported from `packages/contract/src/index.ts`.
- `packages/core/src/index.ts` -- export the EXISTING `normalizeSlotName` and `entrySlot` (compat touch, no behavior change) -- one implementation of slot matching.
- `apps/service/src/guidance/serve.ts` -- NEW `serveGuidanceCall({ headers, tool, subject, tenantId, now, identityStore, getBundledState, getPinnedBundle })`: identity first (via `resolveGuidanceIdentity`) → `bundledState` staleness → bundle payload → core inputs → `resolveEffectiveSet` → deterministic match → typed result; never throws; miss/stale sentence constants in this unit; unit tests in `serve.test.ts` pinning every matrix row (InMemory twins, synthetic bundles).
- `apps/service/src/guidance/mcp.ts` -- NEW: the MCP adapter — builds the SDK server registering exactly the four contract tools; reads the identity headers from each HTTP request per call; answers each tool with the typed result serialized via `canonicalJson` as text content; no state kept between requests. HTTP test in `mcp.http.test.ts`: in-process `node:http` server (no DB) + SDK client pinning tools/list, a hit, a miss, an unbound flow, and the stale flag.
- `apps/service/src/guidance/config.ts` + `server-cli.ts` -- NEW env config (`SERVICE_TENANT_ID`, `SERVICE_RECORD_DATABASE_URL`, `SERVICE_GUIDANCE_PORT` optional default 8080) after `bundles/env.ts`; entry wires auth-free in-network `node:http` serving the SDK's Streamable HTTP endpoint at `/mcp`, opens pool → migrate → stores, one-envelope start failure, stdout logs ids/codes only.
- `apps/service/package.json` + `pnpm-lock.yaml` -- add `@modelcontextprotocol/sdk` pinned `1.32.1` -- same major/version as the bridge; one SDK in the lockfile.
- `apps/service/src/index.ts` -- export the serving unit's public symbols (4.2/4.3 pattern).
- `apps/service/src/guidance/perf.test.ts` -- load test: many concurrent `serveGuidanceCall`s over InMemory stores with a realistically-sized bundle; assert p95 < 500 ms with generous headroom (NFR-6) -- the no-blocking/p95 AC.
- `README.md` -- "Guidance tools" section: the four tools, the result kinds, staleness behavior, the matching rule, how to run the server and point `@domain-harness/mcp-bridge` at it.

**Acceptance Criteria:**
- Given the service's MCP adapter on Streamable HTTP using `@modelcontextprotocol/sdk` 1.x, when a client lists tools, then it sees exactly `code_stack_rule`, `design_component`, `design_token` and `design_import` with the contract-versioned descriptions stating the decision each serves and its input.
- Given a bound Application, when a tool is called with a subject, then the response is exactly one of `hit` (Standard id, version, content including the Correction instruction), `miss` (the asked-for subject, one sentence) or `unbound`, resolved through `core` against the pinned active bundle hash, which the response quotes; given an unbound or refused caller, the answer is `unbound` and no other Project's Standards are returned.
- Given `design_component` called with a usage situation instead of a name, when it is resolved, then matching is the documented deterministic text match against component names and usage rules, and no match returns `miss`.
- Given a stale service, when any tool answers, then it still answers from the active bundle and the response says it is stale.
- Given an unreadable Effective Standard set, when a tool is called, then it returns the one sentence that the set could not be read.
- Given any tool, when it is called, then it requires no prior briefing call and never blocks the agent's turn, and the load test against the bundle cache shows p95 under 500 ms.
- Given `pnpm test`, `pnpm run boundaries`, `pnpm run build`, `pnpm run typecheck`, `pnpm run lint`, when they run, then all pass with zero warnings and every matrix row is pinned by a named test that actually ran.

## Spec Change Log

## Review Triage Log

### 2026-10-15 — Review pass (four layers: blind-hunter 15, edge-case-hunter 8, verification-gap 3, intent-alignment 7)
- verdicts: 33 findings — high 0, medium 12, low 10, false 10, maybe-false 1
- findings:
  - `[false]` `[reject]` core helpers missing from diff / unexported (blind) — Refuted: `entrySlot` and `normalizeSlotName` are already exported at baseline 6871297 (`packages/core/src/index.ts` L12/L14); the spec Code Map note was stale, imports resolve, build/typecheck/tests green.
  - `[medium]` `[patch]` result guard rejects the whitespace-only miss the unit serves (blind) — `isGuidanceToolResult` requires trim-nonempty `subject`, but serve.test/mcp.http.pin the whitespace-only miss as spec behavior (matrix row pinned) — a wire consumer validating with the contract guard drops a valid pinned response. Fix: subject rule = string of 1..1000 code points (not trim-nonempty).
  - `[medium]` `[patch]` blank `design_component` subject hits via containment (blind) — `normalizeSlotName("   ")` = `""` and `includes("")` is always true, so a blank subject answers the first component instead of the pinned `miss` (spec matrix: whitespace-only answers miss). Fix: matcher returns false when the casefolded ask is empty; pin with a named test.
  - `[low]` `[patch]` miss-sentence fixture contradicts served template copy (blind) — contract test fixture quotes the subject (`named "primary-color"`) while every served template interpolates unquoted; fixture never claims canonical behavior, cosmetic consistency only. Fix: align fixture to the served shape.
  - `[medium]` `[patch]` config/server-cli start-up path tested by nothing (blind) — no test references `guidanceServiceConfigFromEnv`/`createGuidanceHttpServer`/`server-cli`; house precedent (`bundles/env.test.ts`, `bundles/service-cli.test.ts`) covers exactly this shape; a silent regression misbehaves the deployed path invisibly. Fix: config test mirror + spawn-style one-envelope exit-1 test.
  - `[low]` `[patch]` duplicate doc comment above `renderEntry` (blind) — stray repeated comment line in serve.ts; cosmetic. Fix: delete the duplicate line.
  - `[low]` `[patch]` README run line vs server-cli header cwd disagree (blind) — README documents the repo-root path, the header comment a package-relative one; house precedent wording to align to. Fix: make the header comment agree with the README path.
  - `[low]` `[patch]` "occuring" typo in README (blind) — one-word misspell in the matching-rule paragraph. Fix: correct spelling.
  - `[medium]` `[patch]` published schema `additionalProperties: false` not enforced (blind) — `toolCallResult` only validates `subject`; extra argument keys are silently served although the versioned schema forbids them. Fix: reject unknown argument keys with -32602; pin with a test.
  - `[maybe-false]` `[defer]` perf p95 wall-clock flake risk on shared runners (blind) — the 50-worker shape passed repeatedly under full parallel load, but no CI-like constrained-CPU repetition has been observed; if true the flake would grade medium (unverified). Settle: rerun the perf suite repeatedly (~20×) under CPU-constrained parallel turbo before trusting CI.
  - `[false]` `[reject]` server version literal drifts from contract semver; missing version bump (blind) — Refuted: contract publishes "0.0.0" across all workspace packages; no house versioning convention or bump practice exists to drift from; the count of "1.0.0" house literals is zero because this is the first in-tree MCP server, not because the literal violates a convention.
  - `[low]` `[reject]` SDK pinned independently in two manifests instead of a catalog (blind) — No present divergence: lockfile resolves one 1.32.1 diff line (purely additive); the spec itself mandated "pin 1.32.1, same as the bridge"; catalog migration is a repo-wide convention change beyond this story's smallest fix and guards no demonstrated state.
  - `[medium]` `[patch]` result guard looser than the system's own guarantees (blind) — Guard accepts any non-empty `bundleHash` (no 64-hex shape) and does not bound `subject` to the 1000-char contract maximum; grouped with the whitespace-subject row as one guard-fidelity entry. Fix: same guard-rule correction (subject 1..1000 code points, bundleHash 64 lowercase hex, sentence non-empty).
  - `[low]` `[reject]` unbound reason vocabulary duplicated across packages (blind) — Refuted in part: serve's `SERVE_*` literals are typed members of contract's `GuidanceToolUnboundReason` union — renames compile-error, so cross-package drift cannot happen silently; the residual union-vs-array exhaustiveness gap inside contract is latent, and enforcing type-level exhaustiveness requires contrivance beyond a direct correction (harm not met in everyday use).
  - `[medium]` `[patch]` shutdown is not graceful and POST bodies unbounded (blind) — Verified real half: `server.close()` without waiting or `closeIdleConnections()` lets keep-alive clients hold the process after `guidance_stopped` on SIGTERM/SIGINT (operational hang in containers). Fix: call `closeIdleConnections()` after `close()` in the entry. The body-size/rate-limit half is rejected: the spec places network-edge concerns outside the service ("a deployment concern the network edge handles") — not this diff's demonstrated harm.
  - `[medium]` `[patch]` blank-subject containment hit (edge, claim replaces blind's) — Same verified defect as the blind row: spec matrix promises miss for whitespace-only subjects; containment makes design_component hit. Same grouped entry.
  - `[medium]` `[patch]` `additionalProperties: false` never enforced (edge) — Same verified defect and grouped entry as the blind row; smallest fix covers both reporters.
  - `[low]` `[patch]` UTF-16 `length` vs code-point `maxLength` (edge) — JSON Schema maxLength counts code points; `subject.length` counts UTF-16 units, so schema-valid subjects with astral characters (≤1000 code points, >1000 units) are refused with -32602 that the published schema does not authorize. Fix: enforce the bound in code points; included in the protocol-fidelity grouped entry.
  - `[false]` `[reject]` duplicate Standard ids in a payload quote the wrong winner (edge) — Refuted: no demonstrated path reaches duplicate ids — the only producer is the registry compile over the tenant's record store (ids are primary-key record ids) and bundles are signature-verified at activation; the serving unit re-derives nothing from untrusted input.
  - `[medium]` `[patch]` shutdown stalls on keep-alive clients (edge) — Same verified defect and grouped entry as the blind shutdown row (shared root cause: unawaited `close()` without idle-connection handling).
  - `[low]` `[patch]` migration failures are reported as "could not connect" (edge) — Verified: `openRecordStore` wraps `pool.connect()` and `migrate()` in one try, so a migration error (DB reachable) reports `database_unavailable`/"could not connect to the record store", misdirecting startup diagnosis. Fix: separate catch with its own migration-failure envelope code.
  - `[medium]` `[patch]` (edge re-pin of the containment claim) — Same grouped blank-subject entry; carried as its own row per one-row-per-finding.
  - `[false]` `[reject]` invalid payload answered with the wrong unbound reason (edge) — Refuted: the spec's own "Always" order determines this — a failing identity answer is `unbound`/`run did not complete` (the identity step reads `payload.applications` first and crashing on an invalid payload is a failing identity read); the matrix's set-could-not-be-read row governs set-resolution failures, which the unit does answer with the set sentence (pinned by the dropped-`acceptedDeviations` test).
  - `[medium]` `[patch]` config/CLI start-up untested (verification-gap, pre-verified primary) — Same defect and grouped entry as the blind start-up row; the filed evidence (repo-wide symbol search finding zero test references, plus the bundles mirror) confirms it.
  - `[medium]` `[patch]` the 1..1000 subject bound is enforced only at runtime and never exercised (verification-gap, pre-verified primary) — Same grouped protocol-fidelity entry: no oversized-subject or boundary test exists anywhere; the filed demonstration (remove the bound clause, all suites stay green) confirms. Fix: extend the protocol suite with 1001-rejected and 1000-accepted cases.
  - `[low]` `[reject]` perf p95 measured on InMemory twins, not the full call path (verification-gap other) — The unit's load test is the AC's load test ("a load test against the bundle cache" pins the serving decision with generous headroom: single-digit ms vs 500 ms bound); production store latency is deployment-dependent and a full-HTTP perf harness adds guard complexity beyond a direct correction. Residual risk named under Auto Run Result instead.
  - `[low]` `[reject]` p95 AC exercised below the named surface (intent-alignment divergence 1) — Same root cause as the verification-gap perf row (one grouped entry): the defensible reading R7b is the consolidated spec's pinned reading; reject with the same residual-risk note.
  - `[false]` `[reject]` "never blocks the agent's turn" asserted architecturally, not end-to-end (intent-alignment divergence 2) — Refuted: the spec's intent contract pins the property as stateless per-request serving (headers re-read per request, JSON-only answers, no SSE session); the 405 pin exercises exactly that surface; no bad outcome — the property is by construction the spec's chosen reading.
  - `[false]` `[reject]` typed JSON-in-text vs prose response ambiguity (intent-alignment divergence 3) — Refuted: the consolidated spec pins the typed result "serialized deterministically (canonical JSON)" as the wire text (R2a); divergence is a reading the spec already resolved, no bad outcome.
  - `[false]` `[reject]` bundle hash absent on `unbound` (intent-alignment divergence 4) — Refuted: the spec's typed result pins `unbound` as reason + fixed sentence only; the hash-on-hit/miss mapping is the spec's own pinned shape; the AC's hash clause sits under the bound-Application Given.
  - `[false]` `[reject]` matching-rule latitude (intent-alignment divergence 5) — Refuted: the AC requires only "a deterministic text match ... documented in `contract`"; the implemented casefold-equality + documented containment rule satisfies it and is versioned in the contract module.
  - `[false]` `[reject]` the diff implements a refined intent stricter than the verbatim story (intent-alignment divergence 6) — Refuted: the refinement is the run's own step-01/02 consolidation recorded in the spec's intent contract (mid-call hash refusal is consistent with the epic's exactly-three-outcomes vocabulary), not a divergence from what this run received as its planning-complete intent.
  - `[false]` `[reject]` briefing-free satisfied by construction, not demonstrated protocol behavior (intent-alignment divergence 7) — Refuted: "requires no prior briefing call" is an architectural guarantee the spec pins (stateless per-request identity reads); nothing the client can do needs a briefing, so construction is the complete proof; no bad outcome.


## Design Notes

- **Refused → `unbound`, never a fourth kind.** Epic-4's typed-results rule admits exactly `hit`/`miss`/`unbound`, so a copied identity (4.3's `refused`) surfaces as `unbound` carrying the refusal's fixed sentence; the refusal row was already recorded by the identity unit. This keeps every tool response in the versioned three-kind vocabulary.
- **Stateless per-request serving is forced by identity:** 4.3's bridge recomputes the headers on every HTTP request, so any MCP session started earlier would answer with stale identity. A per-request transport (SDK stateless mode) also makes `tools/list` and calls trivially parallel, which is what makes the p95 target cheap.
- **One resolver overall:** the set is always `resolveEffectiveSet` over inputs derived from the pinned payload — never a bundle-specific reimplementation — so 4.6's Read API ("equals what Guidance would resolve") and the CI Gate agreement fall out for free.
- **AC wins over the spine's SDK-version note:** the architecture review recommends SDK v2 packages, but this story's AC pins `@modelcontextprotocol/sdk` 1.x and 4.3 shipped `1.32.1`; add the same version rather than introducing a second SDK family.
- **Example descriptions (copy, refine freely keeping decision+input):** `code_stack_rule`: "Returns the Company's rule for the given language, framework, or library name."

## Auto Run Result

### Summary

The Company service now answers Document response (FR-11): four granular MCP tools (`code_stack_rule`, `design_component`, `design_token`, `design_import`) are versioned in `packages/contract/guidance-tools.ts` (descriptors, typed `hit`/`miss`/`unbound` result, deterministic matching rule, subject guard); a new never-throwing serving unit `serveGuidanceCall` in `apps/service/src/guidance/serve.ts` decides identity first (4.3's `resolveGuidanceIdentity`, unchanged), then `bundledState` staleness, then resolves the Effective Standard set ONLY through core's `resolveEffectiveSet` from the pinned active bundle payload; `mcp.ts` hosts the four tools statelessly over the MCP SDK's Streamable HTTP (`1.32.1`, the bridge's pin) at `/mcp`, enforcing the published schema at the protocol layer; `config.ts` + `server-cli.ts` give the Company one auth-free in-network entry (one-envelope start-up, ids/codes-only logs, graceful idle-connection shutdown). No migration, no recording (4.5), no bridge/registry/panel changes.

### Files

- `packages/contract/src/guidance-tools.ts` — NEW: the four versioned tool descriptors (UX-DR30 copy), typed result, matching-rule text, `isGuidanceToolSubject`/`isGuidanceToolResult` guards.
- `packages/contract/src/guidance-tools.test.ts` — NEW: descriptor/serialization/guard pins.
- `packages/contract/src/index.ts` — barrel exports.
- `apps/service/src/guidance/serve.ts` — NEW: the serving unit; never-throw, per-call pinned-bundle memo, per-tool miss sentences, deterministic match, hit-content rendering.
- `apps/service/src/guidance/serve.test.ts` — NEW: every I/O-matrix row pinned on InMemory twins.
- `apps/service/src/guidance/perf.test.ts` — NEW: 400 calls / 50 workers, p95 < 500 ms (NFR-6).
- `apps/service/src/guidance/mcp.ts` — NEW: the stateless per-request MCP adapter (schema enforcement, canonical-JSON text content).
- `apps/service/src/guidance/mcp.http.test.ts` — NEW: real SDK client over in-process HTTP — tools/list, hit, usage-rule hit + miss, unbound, stale flag, schema refusals, GET 405.
- `apps/service/src/guidance/config.ts` + `config.test.ts` — NEW: env config and its suite.
- `apps/service/src/guidance/server-cli.ts` + `server-cli.test.ts` — NEW: the entry (pool → migrate → stores → HTTP at `/mcp`, one-envelope start failure, migration-failure envelope separation, `closeIdleConnections`) and its spawn-style suite.
- `README.md` — "Guidance tools" section.
- `apps/service/src/index.ts`, `apps/service/package.json`, `pnpm-lock.yaml` — exports, SDK pin `1.32.1` (additive).

### Review findings breakdown

- Patches applied (5 medium entries + 5 low items, all re-verified): guard fidelity (subject 1..1000 code points, 64-hex `bundleHash`); blank-`design_component` containment now a miss (matcher guards the empty casefold); protocol enforcement of the published schema (no argument keys beyond `subject`, code-point length bound, oversized/boundary/extra-key protocol tests); start-up path under test (`config.test` + spawn-style `server-cli.test`); migration-failure envelope split (`migration_failed`); graceful shutdown (`closeIdleConnections`); duplicate comment, fixture copy, README typo and header run-line aligned.
- Deferred (1): perf p95 wall-clock flake risk on CPU-constrained CI (maybe-false, medium unverified; settle by repeated runs under constrained parallel turbo). Recorded in `deferred`.
- Rejected: 10 false (core-export staleness, server-version drift, duplicate-id payload, identity-first invalid-payload mapping, six intent readings already pinned by the consolidated intent contract) + 5 low (SDK catalog duplication, reason-vocabulary sync — typed-union enforced, perf fidelity/p95-surface pair — residual risk below).

### Verification performed

- `pnpm install --frozen-lockfile` clean; `pnpm run build` (10/10), `pnpm run typecheck` (15/15), `pnpm run lint` (15/15, zero warnings), `pnpm run boundaries` — no violations.
- `pnpm -r run test` with both DB URLs (PostgreSQL 18, Docker, localhost:5432): 1.852 passed / 1 pre-existing skip (panel contrast) — contract 338, service 169 (19 files), registry 792, core 95, panel 400, gate 15, bridge 11, extractor 16, boundaries-tooling 17, cli 1, collector 1.
- `pnpm -r run test` without DB env: same suites green with the declared DB-suite skips (service 134+35 skipped, registry 360+432 skipped).
- Matrix audit: all 10 I/O rows of the spec plus the p95 row are pinned by named tests that ran and passed (re-audited after patches).

### Residual risks (unverified, named)

- Production p95 latency is unverified: the perf suite pins the serving decision over the InMemory twins; per-call Postgres reads (pointer + pinned bundle ×2 + binding) and CI-runner flakiness are not modeled (the deferred item). Mitigation: generous bound (single-digit ms vs 500 ms) and the 405/JSON-only surface.
- The guidance server is auth-free inside the Company network by spec; request body-size/rate limiting is deliberately deferred to the network edge.

followup_review_recommended: true (first pass, five medium patched entries; the named unverified risk is the perf/production-latency residual above).

## Verification

**Commands:**
- `pnpm test` -- expected: new contract + serving + MCP-HTTP + perf suites and the p95 assertion pass; nothing existing regresses (db suites unchanged — no migration).
- `pnpm run boundaries` -- expected: no violations (service may import core/contract/gate/extractor; core exports only its own existing helpers).
- `pnpm run build` / `pnpm run typecheck` / `pnpm run lint` -- expected: clean, zero warnings, the new modules typecheck.

**Manual checks (if no CLI):**
- `README.md` documents the four tools, the result kinds, the matching rule and the server run line.
- `packages/contract/src/guidance-tools.ts` descriptions are product copy stating decision + input (UX-DR30).
