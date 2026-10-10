# Rubric review — Architecture Spine, Domain Harness

Reviewed: `ARCHITECTURE-SPINE.md` (draft, updated 2026-10-10) against `prd.md` (FR-1..FR-29, NFR-1..5). Read-only; neither file was edited.

## Verdict

The paradigm (pure core, signed bundle, single projection chokepoint) is sound and most ADs are enforceable, but the spine is not ready to hand down: it leaves the Project binding open to a Locked-rule bypass, never fixes the revision-facts extractor or the MCP/repository identity path, and is silent on authentication and on how bundles reach and activate in the Company environment.

## Findings

### F1 — critical — AD-6 / FR-10 / FR-6, FR-7: Project id in the identification file is client-controlled
AD-6 owns the Application id <-> repository binding (trust on first use) but nothing owns Application id -> Project. FR-10 says the Project is resolved "from that file and from nowhere else". A Builder can edit the Project id in the hidden file to a looser ancestor or sibling and escape Locked rules, which defeats FR-7 and the product bet. The ER diagram shows Application bound to Project in the registry, yet BUNDLE contains only STANDARD_VERSION and ACCEPTED_DEVIATION (the tree, Modules, Locked rules and Application records are claimed in prose but absent from the model).
Fix: bundle carries Application -> Project; core refuses (unbound/conflict) when the file's Project id differs from the bundle's binding for that Application id; an Application id not in the bundle is refused. State this as a rule, and add Project, Module, Locked flag and Application to the bundle entity list.

### F2 — high — AD-1 / AD-5 / AD-8 / AD-6: revision-fact extraction has no owner
Core is I/O-free and takes "a revision's facts", but nothing says who turns a working tree into facts (lockfile/manifest parsing across ecosystems, import scanning, token/CSS scanning). That work is I/O and cannot live in core, so `apps/cli` and `apps/service` (CI runner) will each write one, and NFR-1 (CLI Gate == CI Gate) breaks at the extractor, not the resolver. The package layout has no extractor package, and AD-5 forbids only "Gate-check logic" outside core.
Fix: add a shared `packages/facts` (or a fact-extractor module in `contract`+core boundary), versioned, with the fact schema in `contract`; both Gate adapters must call it. Add an AD for it.

### F3 — high — AD-15 / AD-2 / AD-6 / FR-10: how Guidance learns the repository identity and who the caller is is undefined
The MCP server runs in the Company service and never sees the repository. FR-10 requires Guidance to refuse "a second repository that presents an Application id already bound to another repository". The spine does not say what the MCP call carries (id, repo identity, proof), nor the MCP transport (stdio vs streamable HTTP), the endpoint exposure, or how Builders' agents and the CI step authenticate to the service. The Read API (FR-25: "with credentials") and CI runner have no authN decision either. Security is a silent dimension at the consumer boundary: only vendor<->Company (AD-11, AD-17) is covered.
Fix: add AD on caller identity and auth for MCP, Read API and CI step (credential type, where it is minted, how Boilerplate injects it), and what repository identity the binding keys on.

### F4 — high — AD-17 / FR-28 / FR-29: no owner for role-gated reads of Guidance events
Guidance events live only in the Company store (AD-9), so panel and registry cannot enforce "a role without the grant receives a denial on Guidance event content" (FR-28) or "a person without an account cannot read Guidance events" (FR-29). AD-17 says the Company service "enforces only what a bundle and a binding permit", and the map lists FR-28 under Deployment boundary with AD-2/3/9/10, none of which covers it. FR-28's grant is a Buyer-configured setting: where it is stored and how it reaches the service is undecided.
Fix: decide that the service enforces FR-28 grants, carried in the bundle or a signed config, and say where the record-read surface is.

### F5 — high — Deferred "Bundle signing key custody and rotation" / AD-11: deferral can make units diverge
AD-11 makes verifier behavior depend on a "known key", but how the service and the offline CLI obtain and trust the key set, how a key is revoked, and how a bundle file reaches the CLI (the diagram has a dotted "bundle file" arrow only) are cross-unit contracts between registry, service and CLI. Deferring them lets each unit invent its own trust-anchor format. Also unspecified: bundle pull trigger/cadence and delivery of an activated bundle (AD-14 shows staleness but sets no bound), so FR-1's "after publication, a new Guidance request resolves that version" is not guaranteed and accepted deviations (FR-15) take effect only at the next pull.
Fix: fix the trust-anchor format and a revocation/rotation hook in `contract`; defer only the KMS choice. Add a pull/activation rule (poll interval or push signal, maximum staleness, behavior when stale).

### F6 — high — AD-9 / FR-26 / FR-28: "subject" is both a forbidden prompt-derived field and an allowed Compilation field
FR-26 permits "the subject asked" in Compilations; FR-3 lets `design_component` take "a usage situation", which is free text and often prompt-derived. AD-9's test ("no sensitive record field can reach a Compilation") cannot hold while subject is both. The Logging convention forbids "subject text from prompts" in logs but not in Compilations. AD-15 `miss (subject)` has no normalization.
Fix: define subject as a normalized closed form (name/specifier, max length, charset, otherwise hashed or bucketed), enforced in `contract`, and state which free-text inputs are never projected.

### F7 — medium — Capability map / FR-21, FR-23 vs FR-26 field list: panel cannot compute Adherence or the consulted-but-deviated join from the listed Compilation fields
FR-21 needs the count of checked Standards (denominator); FR-26 lists only pass/fail plus deviations. FR-23 needs "a revision after that event"; the field list has no revision ordering (commit timestamp, parent, or sequence). The spine neither adds fields nor notes the gap, and the panel imports `contract` only, so it cannot recompute the Effective set. Who owns the Adherence formula is not stated (AD-1 covers Deviations only).
Fix: add the denominator and revision ordering key to the Compilation schema (and amend FR-26), or state that the panel derives them from the bundle.

### F8 — medium — AD-13: slot namespace and Locked-vs-Locked precedence unspecified
AD-13 guarantees uniqueness "within a Module", but FR-6 says Standards compete when they "share a conflict slot" and Glossary slots are plain strings. Code-stack "library" names and design-system "import specifier" may collide, or differ only by case or scope (`React`/`react`, `@scope/pkg`). Not specified: slot key shape, normalization, and cross-Module behavior. Also not specified: two Locked rules from different ancestors in one slot, a Locked rule published at a parent that contradicts an existing child Standard (validation runs only at "the same Project scope"), and re-parenting of a Project.
Fix: define slot key as (module kind, slot kind, normalized name) in `contract`, and extend publish validation across ancestors and descendants and on tree edits.

### F9 — medium — AD-10 / Consistency Conventions: no idempotency for Compilations
A durable queue with retries will duplicate payloads. No Compilation id/idempotency key, ordering, queue bound or retention is set, so gap counts (FR-22) and Adherence series can inflate or diverge between Collector versions. The count shown in the Buyer view ("pending count") is also unbounded.
Fix: add an idempotency key and de-duplication rule in the schema; set queue retention behavior.

### F10 — medium — Operations / deployment: dimension partly silent
The "Operational envelope" paragraph covers vendor regions and Company packaging, then defers provider, SLOs, DR. Not decided, deferred, or raised as an open question: Company-side upgrade path and version skew between service, CLI and bundle contract (semver rule exists, rollout does not), database migration ownership, backup of the Company record store (append-only evidence), HA for the active-bundle pointer with multiple replicas (AD-14 assumes one pointer), secrets handling (per-tenant credential in AD-17, storage/rotation absent), the product's own CI/CD and release signing, and who operates the Company environment. Only dev/staging/prod on the vendor side is named. Alert delivery for FR-15 (recurring alert on the Buyer's interval) has no scheduler, channel or owner anywhere.
Fix: add an Operations section listing each as decided, deferred with reason, or open question; give FR-15 alerts a home.

### F11 — medium — Capability map: orphans and mismatches
- FR-15 alerts and "Builder cannot accept own Deviation" (enforcement point: registry per AD-3, but Deviations are found in the Company environment) are not mapped.
- FR-20 records are written by `apps/service`, but the Intelligence row lists only collector and panel.
- FR-4, FR-12, FR-16..19, FR-24, FR-27 are not in the map; FR-19 and FR-27 are not named in Deferred (FR-27 only indirectly via "Decision agent placement").
- NFR-1..5 appear in `binds` and ADs but have no map rows (NFR-5 only appears as a cell in FR-10).
- FR-29 provisioning mechanism ("an operator provisions named accounts") is not located.

### F12 — low — Stack: version claims are plausible but not verified here
I could not confirm live: Node 26 is "LTS target" and not yet LTS on 2026-10-10 (spine says so correctly, with `engines >=24`), TypeScript "7.x, fall back to 6.x" is a two-way choice that must be settled at scaffold to avoid unit divergence, MCP SDK 1.x vs v2 is hedged with a dated note, PostgreSQL 18 is consistent. The spine instructs `npm view` at scaffold; that check should be a recorded gate. MCP transport and spec revision to target are not named.

### F13 — low — PRD amendments / Dependency diagram
- Amendment list should also record that Accepted-deviation justifications (Company-authored text) are vendor-held under AD-3, and that FR-26's "Standard content runs in the Company environment" now means cached bundle only.
- `packages/collector` is shown among "Adapters" that import core; the stated dependency rule and the fixed field set suggest it should import `contract` only, like the panel. State it.

## Checklist summary

| Check | Result |
| --- | --- |
| Fixes real divergence points for the level below, misses none | Partial: F1, F2, F3, F8, F9 are unfixed divergence points |
| Every AD Rule enforceable and prevents its divergence | Mostly. AD-6 (F1), AD-9 (F6), AD-17 (F4), AD-2 (no verification test for "outbound only") are weak |
| Nothing in Deferred lets units diverge | Fails: key custody / trust anchor (F5). Others are safe |
| Technology verified-current | Not verifiable here; hedged appropriately (F12) |
| Capability -> Architecture map, no orphan | Fails: F11 |
| Every owned dimension decided/deferred/open | Fails: authentication at consumer boundary (F3), operations (F10), bundle distribution/activation (F5) |
