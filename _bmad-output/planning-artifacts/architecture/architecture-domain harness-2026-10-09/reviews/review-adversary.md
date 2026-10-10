# Adversarial review: Architecture Spine, Domain Harness (2026-10-10 draft)

Scope: ARCHITECTURE-SPINE.md read against prd.md. Method: for each hole, two units one level down (apps/packages, or two agents) that each follow every AD and convention literally, and still disagree. AD-n means an Architecture Decision in the spine, FR/NFR are PRD ids.

## Verdict

The spine pins the shapes inside one environment well (single core, signed bundle, typed results), but it leaves the seam between the vendor-held registry and the Company-run Gate under-specified: what *enters* the core (revision facts, Application-to-Project truth, binding), what *orders* bundles and events (no sequence, no revision/time domain), and what *the panel is allowed to know* (closed Compilation list that cannot support the PRD's own views). Eighteen holes below; three are critical.

---

## Critical

### H1. No authoritative Application -> Project binding on the Gate path
- **Pair:** `apps/registry` stores APPLICATION under PROJECT (ER diagram; AD-16 mints the id). `apps/service` resolves the Project from the Project identification file (FR-10) and keeps only an `Application id <-> repository` table (AD-6). The bundle carries tree, Standards, acceptances, but no Applications.
- **Why both comply:** AD-6 gives the Company service ownership of id<->repo only; AD-16 gives minting to the registry; FR-10 says "resolve the Project from that file and nowhere else". Nobody owns "this Application id really belongs to Project P".
- **Slip:** a Builder edits the Project id in the file to a sibling or ancestor with fewer Locked rules, or invents a UUIDv7 (trust on first use binds it). The Gate passes against the wrong Effective Standard set. Locked rules (the paid wall, SM-7) are bypassed by a one-line edit. FR-8 "Application visible before first Gate run" also cannot be met by the Company service, which has never heard of the id.
- **ADs:** AD-6, AD-16, AD-12; FR-10, FR-7.
- **Rule:** The bundle MUST carry the minted Application list (id, Project id). The core MUST refuse (`unbound`) any Application id absent from the bundle, and MUST derive the Project from the bundle entry, treating the file's Project id as a hint that must equal it.

### H2. Owner of "revision facts" extraction is undefined
- **Pair:** `apps/cli` and `apps/service` (CI Gate runner) each write the extractor that turns a checkout into facts (lockfile/manifest parsing, import scanning, token usage) for the core's Module checkers.
- **Why both comply:** AD-1 and AD-5 forbid re-implementing *resolution* and *Gate-check logic* outside core, but parsing a lockfile is neither; the core "takes a revision's facts" and is I/O-free so it cannot read files. One extractor reads declared ranges from `package.json`, the other resolved versions from the lockfile, one follows re-exports, the other not.
- **Slip:** CLI exits 0, CI exits 1 on the same commit and same bundle hash, violating NFR-1/FR-14 while every AD is met.
- **ADs:** AD-1, AD-5, AD-6, AD-8; NFR-1.
- **Rule:** A single `packages/extract` (pure over a file-tree snapshot) owns revision-fact extraction; adapters only hand it bytes. The fact schema is a versioned type in `contract` and the Gate result quotes the extractor version.

### H3. Acceptance (and revocation) latency is unbounded; stale bundle fails open
- **Pair:** `apps/registry` (Buyer records an Accepted deviation, or revokes one; bundle builder emits on its own cadence) versus `apps/service` puller (polls on its own interval; no trigger).
- **Why both comply:** AD-6 says acceptance reaches the Gate "via bundle only"; AD-7 only promises *expiry* needs no new bundle; Deferred table concedes "an acceptance change already means a new bundle". Nothing bounds build, pull or activation time, and AD-14 only *displays* staleness.
- **Slip:** Buyer accepts at 10:00, pipeline still red until the next pull (Builder blocked: the bottleneck the product removes). Worse, Buyer *revokes* an acceptance and a stale service keeps passing for hours. Both are spec-compliant.
- **ADs:** AD-6, AD-7, AD-14; FR-15, NFR-3.
- **Rule:** Define a bundle freshness contract: registry MUST emit a bundle within N seconds of any acceptance/revocation/publication, puller MUST poll at most every M seconds and MUST expose "acceptance-effective-at" in results; a service whose active bundle is older than T MUST return `stale` (not a pass) for Gates, and revocations are only enforceable after activation of a bundle at or above the revocation's sequence.

---

## High

### H4. Bundle identity has no ordering: rollback, replay, and mixed pulls
- **Pair:** registry bundle builder (hash-addressed, signed) versus puller/verifier in service and CLI.
- **Why both comply:** AD-11 verifies signature, known key and hash only. A hash has no order. A cached, CDN-served or attacker-replayed older signed bundle is valid and, activated, silently re-enables a revoked acceptance or an old Standard version.
- **Slip:** puller A pulls N+1, a retry returns N, pointer swaps back (atomic and verified). The Gate result is still "deterministic for (revision, hash, time)".
- **ADs:** AD-11, AD-14.
- **Rule:** Every bundle carries a per-tenant monotonically increasing `sequence` and `built_at`; the verifier MUST refuse a sequence lower than the active one, and records both with the hash.

### H5. Acceptance match key lacks Application scope and Standard version
- **Pair:** `apps/registry` (stores Accepted deviation keyed per FR-15: Buyer, justification, start, end, match key) versus `packages/core` (evaluates "a later finding with that match key is accepted").
- **Why both comply:** Glossary/AD convention define the key as (Standard id, conflict slot, subject). Nothing says the acceptance is Application-scoped, Project-scoped, or version-pinned.
- **Slip:** core applies Ana's acceptance of `lodash` on App-1 to every Application in the tenant (key matches); or registry pins to Application and core ignores the Application field. Separately, the Standard owner publishes v4 that tightens the rule and the v3 acceptance silently covers it (FR-17 is out of scope, so nothing defines the behavior in the pilot).
- **ADs:** AD-6, AD-7; "Deviation match key" convention; FR-15.
- **Rule:** Accepted deviation = (Application id, Standard id, Standard version, slot, subject, start, end); core MUST NOT match across Applications; a new Standard version lapses the acceptance unless the registry re-issues it.

### H6. Consulted-but-deviated join has no common revision or clock domain
- **Pair:** `packages/collector` (Guidance Compilation: Standard id/version, slot, subject, timestamp, no revision) and `apps/panel` (joins on "Guidance returned S, later Gate Deviation on S, same Application, a revision after that event", FR-23).
- **Why both comply:** FR-26's closed field list has no revision on Guidance events and no commit time on Gate runs. Guidance timestamp is the service clock; Gate time is "supplied by the adapter" (CI runner or developer machine, AD-7). Git revisions are not totally ordered (branches, rebase, force push).
- **Slip:** panel A joins on timestamp (false positives across branches and clock skew), panel B on revision ancestry it cannot compute (no ancestry data) and so never fires; SM-6 is unprovable. Also: join on Standard id or match key? Version v3 returned, deviation on v4 counts? Duplicate delivery on queue retry (AD-10) double-counts; Ghost application is false-positive when the Gate Compilation lands before the buffered Guidance one.
- **ADs:** AD-9, AD-10, AD-7; FR-23, FR-26.
- **Rule:** Compilations carry `event_id` (UUIDv7, idempotency key), `seq` per Application, `occurred_at` from one clock authority (the service), and Gate runs carry `revision`, `parent_revisions[]` and `ref`; the join is defined only on (Application id, Standard id, slot, subject) plus revision ancestry, with versions compared explicitly.

### H7. The closed Compilation field list cannot support the views or the spine's own duties
- **Pair:** `packages/collector`/`contract` (emits exactly the FR-26 list) versus `apps/panel` (must show Adherence, staleness AD-14, pending/drop counts AD-10/FR-26).
- **Why both comply:** panel "imports `contract` only" and cannot run the core, so it cannot resolve an Effective set; FR-26 has no "checked Standards count", no bundle hash, no active-hash heartbeat, no pending/dropped counters, no trigger kind. FR-21 Adherence = share of *checked* Standards, a denominator nobody sends.
- **Slip:** panel team computes the denominator from the registry's full Standard list (wrong: ignores scope, Locked, version); collector team ships the numerator only. AD-14/AD-10 "panel shows X" are met only if some unlisted Compilation type exists, and OQ5 forbids new fields without a security review.
- **ADs:** AD-9, AD-10, AD-14; FR-21, FR-22, FR-26.
- **Rule:** Enumerate Compilation types in `contract`: `GuidanceEvent`, `GateRun` (adds bundle hash, sequence, checked Standard ids per Module, trigger/ref), `ServiceHealth` (active hash/sequence, pending, dropped); a panel metric MUST be derivable from these alone.

### H8. AD-13 uniqueness scope is narrower than what the resolver needs; tree edits bypass validation
- **Pair:** `apps/registry` validate-on-publish ("within a Module, same Project scope") versus `packages/core` (raises an error on a violation).
- **Why both comply:** AD-13 validates only Standard publishes, per Module. Gaps: (a) two Modules of the same kind (two owners, FR-4) each holding a live `react` slot at one scope: each valid, the union is not; (b) a Locked rule at ancestor A and a contradicting Locked rule at descendant B (A: required X, B: prohibited X): different scopes, both pass; (c) a Buyer re-parents a subtree or toggles Locked (FR-5/FR-6): no Standard published, no validation, and the resolver now sees a conflict.
- **Slip:** core "raises an error, not a guess" and, because errors are never partial (error envelope), one bad merge bricks the Gate for every Application in the tenant (also see H16).
- **ADs:** AD-13, AD-1; envelope convention; FR-5, FR-6.
- **Rule:** Validation runs on the whole proposed bundle (any registry mutation: Standard, Module, Lock, tree) and rejects it if the core cannot resolve every (Project, slot) pair; a Locked/Locked contradiction is a publish-time error.

### H9. Nobody owns "who sets Locked" or whether a Locked rule can be accepted
- **Pair:** `apps/registry` (Standard owner publishes, so Lock is an attribute of a Standard version) versus `apps/panel` (Buyer manages the Project tree and "Project marks a Locked rule", FR-6; roles per FR-4/FR-7).
- **Why both comply:** AD-6 lists "Locked rules" as one registry-owned row; Glossary says "a Project marks". Two data shapes: attribute on StandardVersion vs overlay on Project.
- **Slip:** two roles can lock/unlock, history diverges; and `core` has no stated answer on whether an Accepted deviation may apply to a Locked rule (that is the escape hatch the Lock exists to deny, and SM-7 depends on it).
- **ADs:** AD-6, AD-17, AD-13; FR-6, FR-15.
- **Rule:** Locked is a Project-scoped overlay set only by the Buyer and stored in one schema; core MUST evaluate acceptance on a Locked rule only if the acceptance is recorded with `override_locked: true` by a Buyer role.

### H10. Boilerplate generation needs resolution that AD-1 and the dependency rule forbid
- **Pair:** `apps/registry` Boilerplate generator (AD-16: "dependency pins that satisfy the code-stack Module, design references that satisfy the design-system Module", FR-9) versus the architecture's "registry imports core ... never to resolve for a Builder".
- **Why both comply:** one team imports core and resolves the Effective set for the Project (breaks the "never to resolve" sentence, still AD-16 compliant); another reads raw Standards at the Project scope and re-derives precedence (breaks AD-1 "no adapter re-implements" only if the registry counts as an adapter; AD-16 says it "is not an adapter").
- **Slip:** a freshly generated Application fails its first Gate (pin a prohibited-by-ancestor library), killing SM-1 and the "starting inside the Standards" claim.
- **ADs:** AD-1, AD-16, dependency-direction paragraph.
- **Rule:** Boilerplate generation MUST call `core.resolve` on the same bundle the Company will serve, and a CI test MUST assert `gate(boilerplate, bundle)` is clean for every Project.

### H11. Role enforcement has no home for Guidance-event content or self-acceptance
- **Pair:** `apps/registry`/`apps/panel` (roles, per AD-17) versus `apps/service` (holds Guidance events, "enforces only what a bundle and a binding permit").
- **Why both comply:** FR-28 ("a role without the grant is denied Guidance event content") and FR-29 target data that lives *only* in the Company store (AD-3). AD-17 says the Company service does not do role checks; AD-6's bundle table carries no role grants. Likewise "a Builder cannot accept their own Deviation": the registry has neither the deviation author (individual naming is off, FR-20) nor a guarantee Buyer and Builder are different people.
- **Slip:** both requirements are untestable as built; every unit is spec-compliant and the Guidance records are readable by anyone with DB or API access.
- **ADs:** AD-17, AD-3, AD-6.
- **Rule:** Role grants over Company-held data are a bundle section signed by the registry and enforced by the service; Compilations/GateRuns carry an opaque `actor_ref`, and the registry MUST reject an acceptance whose actor_ref equals the run's.

---

## Medium

### H12. "Repository identity" and binding semantics differ between CLI and service
- **Pair:** `apps/cli` (local binding file) versus `apps/service` (binding table).
- **Slip:** CLI keys on local path or `origin` URL, the service on CI's checkout URL (forks, mirrors, renames, PR-from-fork); a fresh developer machine has an empty file so "id bound to another repository" never fires offline; there is no re-bind operation for a legitimate rename or fork. Also AD-6 says the Gate is a pure function of (facts, hash, clock) yet lists the binding lookup as a Gate input, so two surfaces can differ on the same triple (NFR-1).
- **ADs:** AD-6, AD-8; FR-10.
- **Rule:** Define repository identity as a canonicalized remote URL plus root commit hash; pass binding outcome to core as an explicit input; specify the Company-admin re-bind operation and its audit record.

### H13. Schema major skew between a vendor-evolved contract and Company-paced deployments
- **Pair:** `apps/registry` bundle builder / `apps/panel` (vendor, deploy daily) versus `apps/service`, `packages/collector`, `apps/cli` (Company, upgrade on Company schedule).
- **Slip:** "consumer rejects an unknown major" is obeyed by all: registry ships bundle v2, every service refuses it and pins the old active bundle (stale, H3); panel upgrades to Compilation v2 and drops v1 Collectors' data. Nothing says who supports N-1.
- **ADs:** Schemas convention, AD-11, AD-9.
- **Rule:** Registry MUST serve each tenant the highest bundle major its service declared at pull time; panel MUST accept N and N-1 Compilation majors for at least one release.

### H14. Time semantics: end date vs instant, CLI clock, boundary
- **Pair:** `apps/registry` UI (Buyer picks "end date") versus `packages/core` (compares with run time) and `apps/cli` (supplies local wall clock).
- **Slip:** registry stores 2026-11-01 as `T00:00Z` (expires a day early) while core treats the date as end-of-day; the offline CLI uses a developer-controlled clock, so rolling the clock back extends any acceptance, and CLI/CI then disagree (NFR-1). Boundary inclusivity unspecified.
- **ADs:** AD-7, Time convention; FR-15.
- **Rule:** `end` is an instant (UTC ISO-8601), valid while `now < end`; the CLI MUST take run time from a clock input signed or bounded by the bundle's `built_at` (reject a clock older than it).

### H15. Alert emission has no owner
- **Pair:** `apps/panel`/registry (owns acceptances and Buyer interval) versus `apps/service` (knows Applications and runs).
- **Slip:** FR-15's "recurring alert" is either sent by the vendor (needs Application names the vendor may not hold beyond Compilations) or by the Company service (needs the Buyer's interval and Buyer contact, which live in the registry). Two schedulers both emit, or neither does; the core cannot read a clock (AD-7) so neither is the core.
- **ADs:** AD-6, AD-7, AD-17.
- **Rule:** The vendor panel owns alert scheduling from Compilation state; alert payloads carry ids only; the service never alerts.

### H16. One invalid Standard or unknown Module kind fails the entire Gate
- **Pair:** `packages/core` (raises on AD-13 violation, no partial success) versus `apps/service` (maps to the error envelope "never partial").
- **Slip:** a new Module kind (the next Module is Information sources) appears in a bundle at a minor version; core has no checker and either errors the whole run or silently skips it, and two adapters choose differently. Same for one malformed Standard.
- **ADs:** AD-13, error convention, AD-1.
- **Rule:** The bundle declares required checker capabilities; core MUST fail closed with `unsupported_module` at bundle load (not at Gate time), and the service MUST refuse activation instead of bricking runs.

### H17. "One active-bundle pointer" is ambiguous under replicas
- **Pair:** two replicas of `apps/service` (compose/Helm, same image).
- **Slip:** each holds an in-memory pointer, swaps after its own pull; mid-rollout one Guidance call and the next CI step see different hashes; the panel "active hash" is per replica. Or a shared pointer in the Company DB written by whichever replica pulls first (fine) versus per-replica (also compliant).
- **ADs:** AD-14, AD-2.
- **Rule:** The active pointer lives in the Company Postgres, advanced by compare-and-swap on `sequence`; replicas MUST read it per request.

### H18. Tenant and Application authenticity of Compilations
- **Pair:** `apps/panel` ingestion (tenant from credential, AD-17) versus Compilation payload (Application id, Project id; no tenant id).
- **Slip:** one panel implementation trusts the payload's Application id and Project id (a spoofed or mis-bound id lands in another Project's inventory); another cross-checks against registry Applications. Both honor AD-12's "tenant id supplied by the access layer".
- **ADs:** AD-12, AD-17, AD-9.
- **Rule:** Ingestion MUST reject any Compilation whose Application id is not minted for the credential's tenant and whose Project id differs from the registry's Application record.

### H19. Free-text Guidance input vs pure core vs privacy
- **Pair:** `apps/service` MCP adapter (receives "component name or usage situation", FR-3) versus `packages/core` (pure, no I/O) and `packages/collector` (projects "subject asked").
- **Slip:** exact match is core; "usage situation" needs fuzzy or semantic lookup, which a team puts in the adapter (a post-processing step AD-1 forbids, but nobody says lookup is "resolution"). The agent fills `subject` with prompt text; the Collector's field passes the schema but breaks FR-28's no-prompt-text promise, and on a miss no conflict slot exists to send.
- **ADs:** AD-1, AD-9, AD-15; FR-3, FR-26.
- **Rule:** Name `core.lookup(subject, kind)` as part of the core with a deterministic matcher; Compilation `subject` is restricted to a normalized token or hash, and `slot` is nullable on miss.

---

## Low

### H20. CLI runs have no record path
- `apps/cli` has no network path (AD-9) and no Company store (AD-8), yet FR-20 says every Gate run is stored and FR-23 needs Gate runs for Ghost detection. Community runs are invisible to the panel; "baseline set" counts differ by team. **Rule:** CLI writes a local run log in the same `GateRun` shape and a `sync` command hands it to a Company collector.

### H21. Which Gate runs count toward Adherence
- Panel team averages every run (PR branches, main, retried), the collector team sends only main. No `trigger`/`ref` field. **Rule:** Adherence series uses the latest run per (Application, default-branch revision) only; `ref` is a required GateRun field.

### H22. Consent to send is unowned
- FR-26: "the Buyer can read the schema before the Collector is allowed to send." Is the "allowed" flag in the vendor panel (collector pulls it) or Company config? **Rule:** The flag lives in the Company service config; the Collector sends nothing until `schema_acknowledged_version` equals the published version.

### H23. Tier gating location
- Community (one Project, no tree) and Team differ; the bundle carries the whole tree and the CLI loads it. Gating either in the registry (bundle contents differ per tier) or in the adapters (bundle identical, adapter refuses) yields different offline behavior. **Rule:** Entitlements are a bundle field enforced by core (e.g., `max_projects`), never in adapters.

---

## Meta-observations
- **Single point of truth drift:** AD-6's ownership table covers mutable *state*; it does not cover derived *joins* (Application->Project, Standard->Module for a run, revision order). Each is a hole above (H1, H7, H6).
- **Cross-environment guarantees are asserted as invariants but implemented as eventual:** NFR-1 and NFR-3 are provable only within one pinned bundle; across environments the spine needs freshness and ordering rules (H3, H4, H13).
- **Closed lists vs required displays:** FR-26's closed field list contradicts at least four "panel shows" obligations (H7).
