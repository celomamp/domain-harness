---
title: 'Story 4.1: Registry compiles and signs Standard bundles'
type: feature
created: '2026-10-13'
status: done
review_loop_iteration: 0
followup_review_recommended: false
baseline_revision: 'ffa6aeb8bd4f2438b891e9089d4e789a11ab4077'
context:
  - _bmad-output/implementation-artifacts/epic-4-context.md
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** The registry persists every domain change (Standards, tree, Locked rules, Applications, settings) but nothing compiles those changes into the signed, immutable Standard bundle that Epic 4's Guidance depends on; there is also no per-tenant credential a Company service could pull one with, and no place to carry the staleness bound or a freeze.

**Approach:** Define the versioned bundle format and canonical serialization in `packages/contract`; in `apps/registry` add a bundles unit that compiles the tenant's whole current state into that format (validated by core's whole-bundle check), signs it with an environment-supplied Ed25519 key over a payload that includes the tenant id, a per-tenant monotonic sequence and the key id, and stores one immutable record per build; serve `GET` of the tenant's latest signed bundle behind a per-tenant service credential minted at provisioning; and let the Buyer set the staleness bound (default 24h) and record a freeze on new Buyer-only registry endpoints, both carried in the next bundle.

## Boundaries & Constraints

**Always:**
- The bundle format is pinned in `packages/contract` with a stable type name and an integer major version (semver, consumers reject unknown majors); guards follow the existing never-throw exact-key-set pattern (like `facts.ts`).
- Canonical serialization is part of the contract: recursively, object keys sorted in UTF-16 code-unit order, no insignificant whitespace, UTF-8 bytes; every adapter that hashes or signs uses it. Hash = SHA-256 hex of the canonical bytes of the signed bundle body (payload + keyId + signature); the registry stores bundles keyed by that hash.
- The signature covers the canonical bytes of the payload, and the payload itself carries the tenant id, the per-tenant monotonic sequence (`1, 2, 3…`, unique per tenant) and the key id. Signing uses Ed25519 (node:crypto, existing stdlib only); the private key never leaves the environment/secret manager.
- A bundle is built after every accepted domain-mutating POST route (the enumeration is pinned in the Code Map), synchronously in the request after the mutation committed; a build failure answers 500 with one envelope and the mutation stays committed.
- Pull: `GET` the tenant's latest signed bundle with `Authorization: Bearer <service credential>`; the credential's tenant must equal the addressed tenant (else 403) and an unknown credential is 401. Only the addressed tenant's latest bundle is ever returned.
- Staleness bound and freeze are Buyer-only registry POSTs, validated (`stalenessHours` integer 1–720; `frozen` boolean), stored append-only in the registry, and carried in the next built bundle (never read into one already built).
- Public key custody/rotation tooling, KMS choice and trust sets are AD-11's later concern; this story only signs and pins keyId.

**Never:**
- No Company-side anything (pulling, verifying, activating, MCP, binding) — that is stories 4.2–4.4; no CI Gate (5.3/5.4), no acceptance store or Buyer acceptance flow (5.5) — the bundle's `acceptedDeviations` field compiles to the empty list until a source exists, and this is pinned behavior, not a gap.
- No new runtime dependencies anywhere; `packages/contract` and `packages/core` stay free of Node built-ins (boundary rules); node:crypto appears only in `apps/registry` (and later adapters).
- No re-implementation of tree/slot/locked validation: bundle compile calls core's `validateBundleInput` with the proposed whole-bundle input, exactly as the other mutation services already do.
- No panel UI, no Boilerplate changes, no pushing.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Mutation produces bundle | accepted POST on any mutating route | 201/200 as today; one new `bundle_records` row: sequence = previous max + 1, canonical payload, signature, hash-addressed, `issuedAt` UTC ISO-8601 | build failure → 500 envelope `bundle_build_failed`, mutation remains committed |
| Canonical round trip | same payload built twice from the same state | byte-identical canonical serialization, same hash | None |
| Own tenant pulls | `GET {tenantId path}` + own service credential | 200 the latest signed bundle for that tenant only | 404 envelope when no bundle exists yet |
| Foreign credential | addressed tenant ≠ credential's tenant | 403 envelope `role_denied` | No bundle content ever |
| Unknown credential | malformed/absent bearer token | 401 envelope `session_invalid` | None |
| Buyer sets staleness | `POST` `{ stalenessHours: n }` as Buyer | stored append-only; next bundle carries it | 400 `invalid_input`; 403 `role_denied` before body read for non-Buyer |
| Buyer records freeze | `POST` `{ frozen: true\|false }` as Buyer | stored; next bundle carries `frozen` | Same as staleness |
| Compile rejects bad state | whole-bundle core validation fails | no bundle built, first core envelope surfaces | envelope surfaced to the mutation's HTTP response path |
| Key file in repository | any private-key file staged in the repo | the scan test FAILS the suite | None (this is a deliberate tripwire) |

</intent-contract>

## Code Map

- `packages/contract/src/standards.ts` -- reuse `StandardInfo` (L189: id/version/module ref/project ref/entry) as the bundle's Standards entries; `liveStandardInfos` in `apps/registry/src/standards/service.ts` (L241) already compiles tenant-wide live versions.
- `packages/contract/src/projects.ts` -- reuse `ProjectTree` (L38: rootId, ProjectInfo list, `lockedRules: LockedRuleMark[]`) verbatim for the tree + Locked rules; `LockedRuleMark` (L52) carries who/when.
- `packages/contract/src/deviations.ts` -- reuse `AcceptedDeviation` (L55) for the bundle's accepted-deviations list.
- `packages/contract/src/sign-in.ts` -- `SessionInfo` (L43: accountId, tenantId, role) for Buyer checks; envelope codes `SESSION_INVALID`, `ROLE_DENIED`.
- `packages/contract/src/guards.ts`, `ids.ts`, `errors.ts` -- `isUtcIso`, `isUuidV7`, `ErrorEnvelope`; contract guards never throw.
- `packages/core/src/tree.ts` -- `BundleInput` (L35: projects as TreeNodes, standards as SlotHolders, `change`, `lockedStandardIds`, `applications: ApplicationNode[]`) and `validateBundleInput` — the whole-bundle check compile must call (AD-13).
- `apps/registry/src/db/schema.ts` + `migrations/0001…0011_*.sql` -- table/RLS patterns to follow; `TENANT_TABLES` (L488) must gain the new tables; drizzle tables are the typed mirror of the SQL (SQL is source of truth).
- `apps/registry/src/db/tenant-scope.ts` -- `withTenant`, `assertRuntimeRoleSafe`; every read/write goes through tenant context.
- `apps/registry/src/standards/service.ts` -- `lockBundle(tx, tenantId)` (L300: tenant advisory lock pinnable per sequence allocation), `liveSet`/`liveStandardInfos`, `accountNames`, `projectsById` — compile reads these, never raw SQL.
- `apps/registry/src/projects/current.ts` -- `currentProjects` (Map incl. current parent), `treeNodes` — tree source for bundle and BundleInput.
- `apps/registry/src/locked-rules/current.ts` (+ re-export in `locked-rules/service.ts`) -- `currentLockedMarks` for LockedRuleMarks; `currentLockedIds` for BundleInput.
- `apps/registry/src/applications/service.ts` -- `listApplications` shape (rows carry `fromFlow` L57/L127/L165/212); applications come app-by-app with creation flows true (New-application flow) or false (registered, story 3.5).
- `apps/registry/src/guidance-endpoint/service.ts` -- copy pattern for append-only Buyer-only settings service + `current` helper.
- `apps/registry/src/tenancy/provision.ts` (L12 `ProvisionResult`) + `operator/provision-cli.ts` -- mint the tenant service credential (random 32 bytes base64url, store SHA-256 hex like `sessions.tokenHash`), return the token once (printed by the CLI), never stored in clear.
- `apps/registry/src/http/server.ts` -- `createRegistryServer` (L216), `ROUTES` (L121), `PARAM_ROUTES` (L106), `handle` switch (L246); `RegistryServices` (L167) gains `bundles`. Mutating routes (the pinned hook list): `modules` POST, `MODULE_OWNER_ROUTE`, `MODULE_STANDARDS_ROUTE` POST, `STANDARD_VERSIONS_ROUTE` POST, `STANDARD_LOCKED_RULE_ROUTE`, `PROJECT_API_PATHS.projects` POST, `PROJECT_PARENT_ROUTE`, `PROJECT_CHILD_PERMISSIONS_ROUTE` POST, `PROJECT_BUILD_GRANTS_ROUTE` POST, `APPLICATION_API_PATHS.applications` POST, `APPLICATION_API_PATHS.registered`, `GUIDANCE_ENDPOINT_PATH` POST — after the handler succeeds, build the bundle for `session.tenantId`. Explicitly NOT mutating: sign-in links/sessions (no bundle-visible state), boilerplate generation (read-only), all GETs.
- `apps/registry/src/http/serve-cli.ts` -- env-required pattern (`required()`, L37); gains `REGISTRY_BUNDLE_SIGNING_KEY` (PKCS8 PEM) and `REGISTRY_BUNDLE_SIGNING_KEY_ID`; builds the `Signer` handed to the bundle service.
- `apps/registry/migrations/` -- new `0012_standard_bundles.sql`: `bundle_records` (tenant_id, sequence unique-per-tenant, hash unique, key_id, payload jsonb, signature, issued_at, append-only), `tenant_service_credentials` (token_hash unique), `bundle_setting_changes` (append-only; each row `staleness_hours int null` xor `frozen bool null`, changed_by) — RLS + grants mirroring 0009/0011 style.
- `tooling/boundaries` (`pnpm run boundaries`) -- must stay green: registry may import contract+core; contract/core import no Node built-ins.

## Tasks & Acceptance

**Execution:**
- `packages/contract/src/bundles.ts` -- NEW: `BUNDLE_TYPE` ('domain-harness/standard-bundle'), `BUNDLE_FORMAT_VERSION` = 1, `DEFAULT_STALENESS_HOURS` = 24; `StandardBundlePayload { format: { type, version }, tenantId, sequence, issuedAt, stalenessHours, frozen, standards: StandardInfo[], tree: ProjectTree, applications: { id, projectId, fromFlow }[], acceptedDeviations: AcceptedDeviation[] }`; `SignedStandardBundle { payload, keyId, signature }`; `canonicalJson(value)`, guards `isStandardBundlePayload`/`isSignedStandardBundle` (never throw, exact key sets); `BUNDLE_API_PATHS = { staleness: '/v1/standard-bundles/staleness', freeze: '/v1/standard-bundles/freeze' }` and `standardBundleLatestPath(tenantId)`.
- `packages/contract/src/index.ts` (+ `bundles.test.ts`) -- export and guard-test the new symbols.
- `apps/registry/migrations/0012_standard_bundles.sql` + `db/schema.ts` mirror -- tables/RLS per Code Map; add tables to `TENANT_TABLES`.
- `apps/registry/src/bundles/sign.ts` -- NEW pure-ish `Signer { keyId, sign(bytes) }`, `ed25519SignerFromEnv(env)`, `sha256Hex(bytes)`, `bundleHash(signed)` per the pinned hash rule.
- `apps/registry/src/bundles/compile.ts` -- NEW: one transaction read of liveStandardInfos + currentProjects/treeNodes + currentLockedMarks + applications + current setting rows → `StandardBundlePayload`, and the `BundleInput` for `validateBundleInput` (rejected with the core envelope if invalid). `acceptedDeviations` is always `[]` today.
- `apps/registry/src/bundles/service.ts` -- NEW `createBundleService`: `buildAndSign(tenantId)` (allocate sequence under `lockBundle`, compile, sign, insert, return hash+sequence), `setStaleness(session, body)` / `setFreeze(session, body)` (Buyer-only), `latestFor(tenantId)` (pull read), `authenticateCredential(bearer)` → tenant id or denial.
- `apps/registry/src/tenancy/provision.ts` + `src/operator/provision-cli.ts` -- mint + return + print the service credential once.
- `apps/registry/src/http/server.ts` + `http/serve-cli.ts` -- new routes/methods, `RegistryServices.bundles`, post-mutation hook per the pinned list, and the two signing env vars required at start.
- `apps/registry/src/bundles/bundles.db.test.ts` -- db suite (REGISTRY_TEST_DATABASE_URL harness like `applications.db.test.ts`): two tenants, mutate only A, pull/assert contents, foreign/unknown credential denials, staleness/freeze carrying, canonical determinism, sequence monotonicity, key-scan tripwire test.
- `packages/contract`, `packages/core` -- no changes beyond the new bundle module (reuse only).

**Acceptance Criteria:**
- Given `packages/contract`, when the bundle format is inspected, then it carries a stable type name and major version and contains the Standards (current versions), the Project tree with Locked rules, Applications (id → Project, created-by-flow flag), the Accepted deviations list, and the staleness bound and freeze state.
- Given any accepted registry mutation POSTed to one of the pinned routes, when the response succeeds, then exactly one new signed bundle exists for that tenant: canonical serialization, hash-addressed (SHA-256 over the canonical signed body), signed over a payload that includes the tenant id, the per-tenant monotonic sequence and the key id, and the sequence strictly increases per tenant.
- Given the signing key comes from the environment, when a key file exists anywhere in the repository, then the key-file scan test fails; with no key file it passes.
- Given tenant A's service credential, when it pulls the latest bundle, then it receives exactly tenant A's latest signed bundle; tenant B's credential is denied (403) and an unknown credential is denied (401).
- Given the Buyer sets the staleness bound or records a freeze, when the next mutation builds a bundle, then the bundle carries the new bound or frozen state, a non-Buyer session is refused with `role_denied` before the body is read, and an invalid body is `invalid_input` with nothing stored.
- Given `pnpm --filter @domain-harness/contract test`, `pnpm --filter @domain-harness/registry test` (with `REGISTRY_TEST_DATABASE_URL`), `pnpm run boundaries`, `pnpm test`, `pnpm run build`, `pnpm run typecheck` and `pnpm run lint`, when they run, then all pass with no boundary violations, matrix rows pinned by named framework tests, none skipped or filtered.

## Spec Change Log

## Review Triage Log

### 2026-10-14 — Review pass
- verdicts: 16 findings — high 0, medium 2, low 10, false 4, maybe-false 0
- findings (blind-hunter B1–B12, edge-case-hunter E1–E4; verification-gap reported no findings; intent-alignment reported no actionable findings — it described the diff as implementing the spec-pinned readings with surface-divergence notes only):
  - `[medium]` `[patch]` B5 A malformed PEM or a non-Ed25519 `REGISTRY_BUNDLE_SIGNING_KEY` threw a raw Node crypto error at serve start instead of one envelope — pinned behavior "any start-up error prints one envelope and exits 1" — Fixed: `createPrivateKey` wrapped (try/catch + `asymmetricKeyType === "ed25519"` check) throwing `invalid_configuration` with subject `REGISTRY_BUNDLE_SIGNING_KEY`; tripwire test added in `bundles.db.test.ts`.
  - `[medium]` `[patch]` E1 Same claim from the edge-case layer (same root cause, shared route with B5) — Fixed together with B5.
  - `[low]` `[reject]` B1 The bundle guard delegates nested shapes to `isStandardInfo`/`isProjectTree`/`isLockedRuleMark`, which do not reject extra keys, so an externally crafted payload with hidden nested keys passes — no reachable construction path today: `compileBundle` is the only payload producer and builds typed state, and the pinned hash covers the actual bytes regardless; tightening the shared contract guards ripples house-wide; story 4.2's verification spec should pin received-bundle strictness there.
  - `[low]` `[patch]` B2 `canonicalJson` serialized a key whose value is `undefined` as `"key":null` instead of omitting it as JSON.stringify does (interop-divergent semantics of a public contract helper; the reviewer's Date/Map/Set sub-claim is refuted for real inputs — payloads are validated JSON-shaped data, never class instances) — Fixed: undefined-valued keys omitted in `serialize`, with omission pinned in `bundles.test.ts`.
  - `[low]` `[patch]` E2 Same finding from the edge-case layer (same root cause, shared route with B2) — Fixed together with B2.
  - `[low]` `[patch]` B3 The guard test's "a missing key" case spread an explicit `undefined` instead of genuinely omitting the key, so no test proved absent-key rejection — Fixed: the case now `delete`s the key in `bundles.test.ts`.
  - `[low]` `[reject]` B4 Missing contract types/guards for the staleness/freeze request-response shapes and an inline `bundle_build_failed` code — mixed house precedent: registry-internal codes are inline elsewhere (`missing_configuration`, `unsafe_database_role`) and per-service body validators live in the unit (`validateLockedRuleBody`); the bundle format itself is in `contract` per spec; no present-day consumer is harmed and future stories pin their own surfaces.
  - `[low]` `[patch]` B6 `bundle_build_failed` was absent from `STATUS_BY_CODE` (still answered 500 via the fallback, pinned by test) and the unexpected-failure path wrote no log event, unlike every other unexpected error — Fixed: registered `bundle_build_failed: 500` and `buildBundleAfterMutation` now logs one diagnostic event before throwing; logged-event asserted in `bundles.db.test.ts`.
  - `[false]` B7 `latestFor` serves the stored JSONB payload without re-validation and lacks partial/covering indexes — refuted: the only writer is `buildAndSign` after full guard and core validation, jsonb round-trip preserves the JSON data model, and the db suite re-derives the stored hash from the pulled object (`bundleHash(signed)`), pinning round-trip fidelity; the `(tenant_id, sequence)` unique B-tree serves the max-sequence scans fine at registry scale.
  - `[low]` `[patch]` B8 `setStaleness`/`setFreeze` appended duplicate no-op rows for an unchanged value, diverging from the `setGuidanceEndpoint` same-value short-circuit the spec cites as the pattern — Fixed: current values read under the bundle lock and unchanged POSTs return without inserting; no-duplicate-row behavior pinned in `bundles.db.test.ts`.
  - `[low]` `[patch]` B10 The repository key-file scanner missed PGP-armored private key blocks and `.p12`/`.pfx`/`.der` containers — Fixed: extension set and BEGIN-marker regex extended (`PRIVATE KEY(?: BLOCK)?` covers PGP), each newly covered pattern asserted detected.
  - `[low]` `[patch]` B11 The `serve-cli.ts` header comment documenting required environment variables omitted the two new signing variables — Fixed: both documented in the list.
  - `[low]` `[reject]` B12 The spec's task line omits `keyId` from the listed payload fields, internal to the spec text — rejected: the fix would edit this build's spec; the `<intent-contract>` (payload carries the key id) and the Code Map pin the implemented shape, which the code follows.
  - `[false]` B9 The pull route drains GET bodies nowhere and answers 403 for a valid credential matched against a non-UUID path id — refuted: unchanged house behavior (GETs carry no body; other rejection paths do not drain GETs either), and credential-vs-addressed-tenant mismatch is exactly the AC's denial; the parse-failure case answers 401 (tested).
  - `[false]` E3 `depthFirst` runs before `validateBundleInput` and would "silently overwrite root and omit disconnected subtrees" — refuted: a second root is impossible through the app (one-root unique index), and even for hand-corrupted data `validateBundleInput` receives the FULL node list and rejects the state before any record is written; a harmless payload is discarded.
  - `[false]` E4 `requireBundles` doesn't drain and `service_unavailable` is unmapped (500) — refuted: `bundles` is always wired by `serve-cli` in the delivered program (unreachable configuration), the short-circuit edge never fires there; no-drain-on-throw outside body-reading routes matches the uniform house pattern.
- intent-alignment auditor reported no findings; it described the diff as implementing the intent under the readings pinned by the spec (HTTP-boundary post-mutation hook, immediate builds for the twelve domain-mutating routes, acceptedDeviations empty until story 5.5's source exists, integer major version as the semver major, hash-keyed storage with a tenant-addressed latest pull).

## Auto Run Result

**Summary:** Implemented Story 4.1: the versioned Standard bundle wire contract in `packages/contract` (type name + integer major, canonical JSON serialization, strict never-throwing guards, registry API paths), and in `apps/registry` a bundles unit that compiles the tenant's whole current state (live Standards, Project tree with Locked rules, Applications with their created-by-flow flags, accepted deviations, staleness bound and freeze state), validates it whole with core's `validateBundleInput`, signs the canonical payload bytes with an environment-supplied Ed25519 key over a payload carrying the tenant id, a per-tenant monotonic sequence and the key id, and stores one immutable, hash-addressed record per build; per-tenant service credentials minted at provisioning authenticate `GET /v1/standard-bundles/{tenantId}` (own tenant's latest only, foreign credential denied), Buyer-only staleness/freeze endpoints store append-only changes carried into the next bundle, and every accepted domain-mutating POST route triggers a synchronous bundle build that leaves the mutation committed on failure.

**Files changed:**
- `packages/contract/src/bundles.ts` — `BUNDLE_TYPE`, `BUNDLE_FORMAT_VERSION`, `DEFAULT_STALENESS_HOURS`, `StandardBundlePayload` (format/tenantId/sequence/keyId/issuedAt/stalenessHours/frozen/standards/tree/applications/acceptedDeviations), `SignedStandardBundle`, `canonicalJson`, guards, `BUNDLE_API_PATHS`, `standardBundleLatestPath`.
- `packages/contract/src/bundles.test.ts` — format identity, guard round-trips and ~30 rejection cases, canonical-JSON key-sorting and undefined-omission determinism.
- `packages/contract/src/index.ts` — re-exports the bundle contract symbols.
- `apps/registry/migrations/0012_standard_bundles.sql` — `bundle_records` (unique hash, unique (tenant_id, sequence)), `tenant_service_credentials`, `bundle_setting_changes`; RLS + app-role grants.
- `apps/registry/src/db/schema.ts` — typed mirrors; tables added to `TENANT_TABLES`.
- `apps/registry/src/bundles/sign.ts` — `Signer`, `sha256Hex`, `bundleHash`, `ed25519SignerFromEnv` (malformed/non-Ed25519 key ⇒ `invalid_configuration` envelope).
- `apps/registry/src/bundles/compile.ts` — `compileBundle` (+`currentStalenessHours`/`currentFrozen`), deterministic depth-first tree, `acceptedDeviations: []`.
- `apps/registry/src/bundles/service.ts` — `createBundleService`: `buildAndSign` (sequence under `lockBundle`), Buyer-only `setStaleness`/`setFreeze` (same-value short-circuit, validated bodies), `latestFor`, tenant-scoped `authenticateCredential` (constant-time compare).
- `apps/registry/src/http/server.ts` — bundle routes (`GET` latest with credential↔tenant equality, `POST` staleness/freeze Buyer-gated), `RegistryServices.bundles`, `buildBundleAfterMutation` after all twelve pinned mutating routes (core envelope surfaced; unexpected failure logged then `bundle_build_failed: 500`, mutation stays committed).
- `apps/registry/src/http/serve-cli.ts` — `REGISTRY_BUNDLE_SIGNING_KEY`/`REGISTRY_BUNDLE_SIGNING_KEY_ID` required at start; bundles service wired; header documented.
- `apps/registry/src/tenancy/provision.ts` + `apps/registry/src/operator/provision-cli.ts` — service credential minted (stored SHA-256 hash only) and printed once in `ProvisionResult`.
- `apps/registry/src/index.ts` — bundles unit barrel exports.
- `apps/registry/src/bundles/bundles.db.test.ts` — key-file tripwire scanner test; PostgreSQL-18 suite: migration/RLS/grants, credential auth matrix, 404-before-first-mutation, 403/401 denials, method-not-allowed, 13 mutating routes each producing a hash-verified, signature-verified, monotonic bundle, cross-tenant non-mutation, canonical determinism, staleness/freeze storage and carry, unchanged-value no-op, build-failure 500 with committed mutation, core-validation rejection surfacing, RLS tenant isolation, serve-cli missing-key envelopes.
- `apps/registry/src/tenancy/tenancy.db.test.ts` — migration-count expectations updated for 0012 and `serviceCredential` in the printed shape.
- `_bmad-output/implementation-artifacts/epic-4-context.md` — compiled Epic 4 planning context.
- `_bmad-output/implementation-artifacts/spec-4-1-registry-compiles-and-signs-standard-bundles.md` — this spec.

**Review findings:** 16 findings — 2 medium (B5, E1), 10 low, 4 false. Patched (all 2 medium + 6 low in 6 fix groups): signing-key configuration error envelope (B5+E1), canonicalJson undefined-key omission (B2+E2), genuine missing-key guard test (B3), bundle_build_failed status+logging (B6), same-value settings short-circuit (B8), key-scanner pattern coverage (B10), serve-cli env documentation (B11). Rejected with reasons (3 low): B1 (nested guard exact-keys — no reachable producer today; 4.2 to pin), B4 (contract types for settings endpoints — mixed house precedent, no present consumer), B12 (spec-text-only fix). Refuted as false: B7, B9, E3, E4 (each with the refuting evidence above). Verification-gap layer reported no findings; intent-alignment auditor reported no actionable findings.

**Follow-up review recommendation:** `false` — one medium patch group was applied (below the two-medium threshold), all five low groups were direct corrections, and a full forced verification rerun passed 11/11 after patching; no unverified risk is carried by a patched entry.

**Verification performed:**
- `pnpm --filter @domain-harness/contract test` — 309 passed (18 files), re-run live after the patch pass.
- `REGISTRY_TEST_DATABASE_URL=... pnpm --filter @domain-harness/registry test` — 756 passed (26 files), re-run live (real PostgreSQL 18 via the Docker container) after the patch pass.
- `pnpm run boundaries` — no violations.
- `pnpm exec turbo run test --force` — full workspace suite re-executed uncached: first run 10/11 with one timing flake in `@domain-harness/panel` (passed on isolation and on the next full forced run 11/11); second forced run 11/11 successful.
- `pnpm run typecheck`, `pnpm run lint`, `pnpm run build` — all clean.
- Matrix test audit: all 9 I/O matrix rows mapped to named, freshly-run passing tests (mutation→bundle across all 12 pinned routes; canonical determinism ×2; own-tenant pull 200/404; foreign 403; unknown 401; staleness Buyer path incl. 400/403; freeze carry; core-validation rejection surfacing; repository key-file tripwire) — none skipped or filtered.

**Residual risks:**
- `acceptedDeviations` always compiles to `[]` until story 5.5 provides the acceptance source; bundle consumers must not treat the empty list as "no deviations accepted ever".
- Domain state written outside the HTTP server (operator provisioning) produces no initial bundle; a fresh tenant answers the pull with 404 `not_found` until its first mutation — story 5.5's acceptance store must join the pinned post-mutation hook list or call the builder itself.
- The pull surface is plain HTTP bound by the sample deployment story; TLS termination belongs to deployment (out of this story's scope); story 4.2's client should treat the vendor URL as registry-configured.
- Nested contract guards (`isStandardInfo`/`isProjectTree`) still accept extra keys when reached directly; story 4.2's received-bundle verification should pin exact-shape strictness on the wire.
- Team-plan staleness/freeze purchasing (plan gating beyond Buyer role) is not distinguished: any tenant's Buyer may set them, matching the epic's Buyer-only wording.

## Design Notes

- **Canonical JSON.** Recursively sort every object's keys by UTF-16 code-unit order; JSON-encode strings/numbers per JSON; no whitespace. The helpers live in `contract` because the Company service, the CLI Gate and any other adapter must produce identical bytes; only `apps/registry` is allowed node:crypto to turn them into hashes/signatures.
- **What the hash addresses.** `bundleHash = sha256hex(canonicalJson(signed))` where `signed = { payload, keyId, signature }`. Consumers recompute it from received bytes; nothing stores the hash inside the bundle. GUID stability: rebuilding from unchanged state is byte-identical, so hash equality means "same content" without timestamps inside recomputed bundles being regenerated.
- **Sequence allocation.** `nextSequence` reads max(`sequence`)+1 inside the transaction that holds `lockBundle`'s tenant advisory lock, and `bundle_records` gets a unique `(tenant_id, sequence)` index; concurrent mutations serialize exactly as the whole-bundle validations already do.
- **Hook, not services.** The mutation→bundle link is implemented as one post-success hook in the HTTP layer, so the twelve services stay untouched. Consequences pinned: (a) domain state written outside the HTTP server (operator provisioning) produces no bundle — the credential-less tenant has no bundle until its first mutation, and the pull answers a 404 envelope until then; (b) story 5.5's acceptance store must add itself to the pinned hook list or call the builder directly.
- **Credential model.** One credential per provisioning run, hashed like session tokens (SHA-256 hex, `tenant_service_credentials`), comparable with a constant-time comparison; the token is shown exactly once by the operator CLI. Pull addressing embeds the tenant id, so "another tenant's credential" fails the credential↔path equality check.
- **Signing failure semantics.** Signing material is checked at serve start (`serve-cli` requires the two env vars, one envelope on absence). A per-request build failure (e.g. unexpected invalid state) surfaces `bundle_build_failed` and the mutation stays committed — the next mutation retries the build; staleness bounds already bound how stale the served bundle can be.

## Verification

**Commands:**
- `pnpm --filter @domain-harness/contract test` -- expected: contract suites pass, including the new bundle guards and canonical-JSON determinism tests.
- `REGISTRY_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres pnpm --filter @domain-harness/registry test` -- expected: registry suites pass, including the new bundles db suite exercising every I/O matrix row.
- `pnpm run boundaries` -- expected: no violations.
- `pnpm test` -- expected: full workspace suite passes.
- `pnpm run build` -- expected: workspace builds.
- `pnpm run typecheck && pnpm run lint` -- expected: clean.

**Manual checks (if no CLI):**
- Inspect one `bundle_records` row: `payload->>'tenantId'`, keys of the payload (standards/tree/applications/acceptedDeviations/stalenessHours/frozen), signature and keyId columns populated.
- Without `REGISTRY_BUNDLE_SIGNING_KEY`, `serve-cli` exits 1 with exactly one envelope naming the missing variable.

