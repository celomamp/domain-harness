---
id: SPEC-domain-harness
companions:
  - ../../planning-artifacts/architecture/architecture-domain harness-2026-10-09/ARCHITECTURE-SPINE.md
  - ../../planning-artifacts/prds/prd-domain harness-2026-10-09/prd.md
  - ../../planning-artifacts/ux-designs/ux-domain harness-2026-10-09/EXPERIENCE.md
  - ../../planning-artifacts/ux-designs/ux-domain harness-2026-10-09/DESIGN.md
sources:
  - ../../planning-artifacts/prds/prd-domain harness-2026-10-09/addendum.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Domain Harness — First Cut (Team-shaped pilot)

Companion roles: the PRD holds the Glossary, FR/NFR ids with testable consequences, tiers (§6) and success metrics. ARCHITECTURE-SPINE holds AD-1..AD-21, conventions, stack and diagrams. EXPERIENCE and DESIGN hold panel and host text. **Precedence on conflict: this SPEC > ARCHITECTURE-SPINE > PRD.** FR ids below cite PRD requirements.

## Why

A Company building software with AI agents either reviews every business-built Application by hand and becomes the bottleneck, or lets each person point an agent at a private setup; nobody holds one set of Standards for every agent. Domain Harness is the system of record for those Standards, with proof of Adherence: it delivers the Standard at the moment an agent decides, checks before production, and joins Guidance to the later Gate result. Serves the Buyer (holds Standards without being the bottleneck), the Builder (moves fast in the agent tool they use) and the Standard owner (gets their Module followed). Opportunity window 2026–2028, as agent use is ordinary and governance is not a settled category.

## Capabilities

- **CAP-1** Standard Registry
  - **intent:** A Standard owner can create, edit and publish versioned Standards in the code-stack and design-system Modules, with exactly one accountable owner per Module (FR-1–FR-4).
  - **success:** A published Standard carries id, Module, Project scope, version and timestamp; a Module with no owner, or a non-owner publisher, is rejected; after publication a new Guidance call and a new Gate run resolve it, while an in-flight run keeps the version it started with.
- **CAP-2** Project tree and precedence
  - **intent:** The Buyer can shape a Project tree where the closest Project wins a conflict slot and a Locked rule cannot be dropped by any descendant, including a child created with permission (FR-5–FR-7).
  - **success:** Tests show child-prohibits-over-parent-allows, Locked parent over child-allows, no competition across different slots, cycle rejection, denial without the create-child permission, and cross-Company invisibility. A registry mutation proposing a second live Standard in one slot at one scope, or a descendant Locked rule contradicting an ancestor's, is rejected.
- **CAP-3** New-application flow
  - **intent:** A Builder can describe an Application, place it on one Project, and receive a Boilerplate for Claude Code and Cursor that already satisfies the code-stack and design-system Modules (FR-8, FR-9).
  - **success:** The Application is listed for the Buyer before any Guidance event or Gate run; a description with no Project creates nothing; the Boilerplate archive contains the identification file, compliant dependency pins and design-system references, MCP configuration pointing at the Company Guidance endpoint, and generated skills files (no vendor hook). Placing an Application requires a per-Project build grant from the Buyer (FR-8 "allowed to build there"). The Buyer can also register an existing Application (id and identification file only, no Boilerplate, flagged not-from-flow) so it can run the Gate and form the FR-23 baseline set.
- **CAP-4** Application identification
  - **intent:** Guidance, the Gate and Collectors identify an Application by the Application id in the repository identification file, resolve its Project from the active bundle, and refuse any other identification (FR-10, NFR-5).
  - **success:** A missing or unreadable file makes Guidance refuse and the Gate fail with explicit `unbound`; an id absent from the bundle yields `unbound`; a mismatching file Project id is reported and never used; a second repository fingerprint presenting a bound id is refused by every surface and visible as a Binding refusal. Every surface reads identity the same way: the Application id from the identification file, and the repository fingerprint = SHA-256 of the root commit SHA. Guidance receives both as `X-DH-Application-Id` / `X-DH-Repo-Fingerprint` headers from the Boilerplate's stdio MCP bridge, computed at call time. A repository with no commit is `unbound`.
- **CAP-5** Guidance (Document response)
  - **intent:** An agent on any MCP client can call granular tools (`code_stack_rule`, `design_component`, `design_token`, `design_import`) and receive the Standard for the Effective Standard set of its Project (FR-11).
  - **success:** Every call returns exactly one of `hit` (Standard id, version, content), `miss` (subject) or `unbound`; the service, not the agent, stores each miss as a gap; no tool needs a session briefing or blocks turn end; calls are served over Streamable HTTP and flagged stale when the stale rule applies.
- **CAP-6** CLI Gate
  - **intent:** A Builder or pipeline can run an offline CLI Gate against a local revision using a bundle file (FR-13).
  - **success:** The CLI verifies the bundle, applies the same core, extractor and FR-10 refusals using a local id↔repository binding file, prints each Deviation with Standard id and Correction instruction, exits non-zero on any open Deviation, never modifies the working tree, and applies the same stale bound against the bundle's issue time.
- **CAP-7** CI Gate
  - **intent:** The Company's pipeline can run a CI Gate step that returns the same Deviations as the CLI Gate for the same revision and bundle (FR-14, NFR-1).
  - **success:** The step fails the pipeline exactly when the CLI Gate would exit non-zero; each Deviation logs one Correction instruction; the commit entering is the commit leaving; past the Buyer-set bound (default 24h, unless a recorded freeze) the step returns an explicit `stale` result with non-zero exit, never a pass.
- **CAP-8** Accepted deviation
  - **intent:** The Buyer can accept a Deviation for a stated period with a justification and receive recurring alerts until it ends (FR-15).
  - **success:** An acceptance stores Buyer, justification, start, end and the key (Application id, Standard id, Standard version, conflict slot, subject); while unexpired only that key passes, a different key on the same Standard still fails; after the end date the core fails it again with no new bundle; a Builder cannot accept their own Deviation; alerts name Application, Standard and end date and are evaluated and delivered by the registry.
- **CAP-9** Intelligence panel
  - **intent:** The Buyer and Standard owners can see how Standards are consulted, followed and broken, per Application, Project and Module (FR-20–FR-23).
  - **success:** The panel shows Adherence as a time series (checked and open counts per Gate run), most frequent Deviations, gaps with counts, ignored Modules, inventory by Project and agent tool without Builder names, Ghost applications, consulted-but-deviated (ordered by per-Application sequence, never commit ancestry or host clocks), and New-application Applications beside the baseline set. A metric not derivable from the Compilation catalog is not built.
- **CAP-10** Read API
  - **intent:** A credentialed Company system can read published Standards and the Effective Standard set of a Project (FR-25).
  - **success:** The API returns the same set Guidance would return for that Project at that time; no write path exists.
- **CAP-11** Deployment boundary
  - **intent:** Guidance, the Gate and Company-derived records run in the Company environment, and a single Collector sends only fixed-schema Compilations to the vendor panel (FR-26, FR-28).
  - **success:** A test asserts no sensitive record field (prompt text, Standard content, source code) reaches a Compilation; a subject crosses only as a slot-name token or tenant-keyed hash; a schema-failing payload is dropped with a visible count; each Compilation has a UUIDv7 idempotency key and per-Application sequence; the Buyer reads every Compilation schema before the Collector may send; a Collector or panel outage never fails or delays a Guidance call or Gate run, shows a pending count, and queue loss shows as a Collector-health gap.
- **CAP-12** Signed bundle distribution
  - **intent:** The registry compiles Standards, tree, Locked rules, Applications and Accepted deviations into immutable, signed, hash-addressed bundles that the Company service pulls outbound and activates atomically (FR-1, NFR-1, NFR-3).
  - **success:** The service and CLI refuse a bundle with a bad signature, a key id outside the trust set, a tenant mismatch, a hash mismatch, or a sequence lower than the active one; the active pointer lives in the record store and swaps atomically; every Guidance call and Gate run pins and records one bundle hash, so no response mixes versions; the panel shows each service's active hash, sequence and staleness.
- **CAP-13** Access and tenancy
  - **intent:** An operator can provision named accounts for the Buyer, Standard owner and Builder of a Company, with Company data isolated from every other Company (FR-28, FR-29, NFR-4).
  - **success:** An unprovisioned person cannot publish, accept or read Guidance events; the Buyer configures which roles read Guidance events (denial otherwise) on short-lived tenant-scoped tokens; no data-layer query path exists without a tenant id and row-level security is a second guard; each Company service authenticates to the registry with its own credential. Stored Guidance-event content is readable only through the Company service's read endpoint with a registry-issued role token; the management panel never holds or renders that content, and shows only Compilation-derived evidence and the role-grant configuration.

## Constraints

- **Precedence of amendments.** Standard content is vendor-held for the pilot (Company-keyed encryption deferred); only Company-derived data (code, prompts, Gate logs, Guidance records) never leaves the Company environment. Supersedes PRD FR-26/§8 on Standard content.
- **Project comes from the bundle.** The identification file carries the Application id and an advisory Project id. Supersedes PRD FR-10 on "from nowhere else".
- **Match keys.** Deviation key is (Standard id, conflict slot, subject). An acceptance additionally scopes to Application id and Standard version.
- **Compilations.** The closed catalog in AD-20 (Guidance, Gate run, Deviation, Binding refusal, Bundle status, Collector health) extends FR-26. Any new field or type needs a security review and a schema semver bump. Raw prompt text never crosses.
- **"Version in force" = the active bundle**, bounded by the stale rule. Registry is built in-house (PRD OQ10 resolved); the bundle format is the only integration seam for later sources.
- **One core.** Resolution and Deviation evaluation exist only in `packages/core` (no I/O, no clock, imports only `contract`); revision-fact extraction only in `packages/extractor`; TypeScript monorepo. Surfaces are thin adapters. A Gate result is a pure function of (bundle hash, extractor version, revision, clock input) and the clock is always supplied by the adapter.
- **Network.** The Company environment makes only outbound calls to the vendor; no inbound ports. Service reachable only inside the Company network; no adapter has a network path to the vendor except the Collector.
- **Neutrality.** Guidance works through MCP and generated instruction files only; any capability requiring one agent vendor's proprietary hook is out of scope.
- **Conventions.** Opaque UUIDv7 ids minted by the registry, never client-generated; UTC ISO-8601; semver on bundle, fact schema and every Compilation type (reject unknown major); one error envelope (`code`, `message`, `subject`); logs carry ids and counts, never prompt subject text.
- **Stack.** Node 26 LTS target (`engines >=24`), TypeScript 7.x (fall back to 6.0.x), `@modelcontextprotocol/sdk` 1.x behind the MCP adapter, PostgreSQL 18 with a non-owning application role. Framework, ORM, test runner and monorepo tool chosen at scaffold within the spine's dependency rules.
- **Keys.** The pilot bundle-signing key lives in the secret manager or environment, never a repository. Revocation is a new trust set (key id) delivered to the service and CLI plus a sequence bump. KMS comes with the provider decision.
- **Frozen Compilation catalog.** No field or type beyond AD-20 in the pilot; adding one needs a security review and a semver bump.
- **Privacy.** Stored Guidance holds only FR-20 fields and never raw prompts. Default retention is 90 days, Company-configurable. Reads are Buyer-controlled (FR-28).
- **Identity.** Network trust plus repository fingerprint (AD-19: root-commit hash, sent as headers by the stdio bridge) is the pilot's identity model. Forks that share a root commit are an accepted pilot risk. Per-Application tokens and per-Builder SSO stay deferred.
- **Service targets, not an SLA.** Design goals: Guidance p95 under 500 ms from the bundle cache, CI Gate result under 60 s, panel best-effort. A formal SLO and DR plan precede any Enterprise contract.
- **Band overage is soft.** Exceeding the Active governed Application band never blocks the Gate or Guidance; the panel shows the Buyer a banner and count, and Levva is flagged for follow-up.
- **Pilot facts (2026-10-10).** The pilot Company builds only in TypeScript/npm, so the Boilerplate generator and the extractor support only that ecosystem. The pilot CI is GitHub, and the CI Gate ships as a GitHub Action. Panel sign-in is a passwordless magic link: a single-use link with a short expiry, sent to a provisioned account's email. There are no passwords, and SSO stays out.
- **Tiers.** The pilot is Team-shaped (Project tree, Locked rules, CI Gate, Accepted deviations, panel); Community CLI Gate ships only if it does not delay the pilot. Charge unit is the Active governed Application, not seats. Gating per PRD §6.

## Non-goals

- Not a coding agent: no repository edits, no pull requests.
- No vendor hooks, session-start briefing, or mandatory review before an agent finishes a turn.
- A passing Gate certifies no security, accessibility or legal compliance; no OWASP scanning, no ingestion of Snyk/Semgrep/Sonar findings in v1.
- No authoring of design systems, component libraries or data catalogs; no meaning assigned to Project tree levels; no scoring of visual fidelity.
- No per-seat pricing.
- Outside the first cut: Decision agent and Decision response (FR-12, FR-27), Impact analysis, per-change and batch acceptance (FR-16–18), work-tracker tasks (FR-19), lineage and Information sources (FR-24), SSO/SCIM, dedicated environment, SLA, Modules other than code stack and design system, tools without a repository (Lovable; Read API is the likely post-pilot feed), origin sync from Figma, and cloud provider/SLO/DR choices.

## Success signal

- At month 6 on the pilot Company, mean Adherence of Applications created through the New-application flow exceeds the baseline set by at least 20 percentage points (SM-1), the Buyer has opened at least one consulted-but-deviated or Ghost row from the panel (SM-6), and a pilot Gate run has shown a Locked rule overriding a descendant Standard in the same slot (SM-7).

## Assumptions

- MCP SDK v2 status conflicted across sources on 2026-10-09; v1.x is pinned and the npm `latest` tag is confirmed at scaffold.
- TypeScript 7 ecosystem compatibility (lint, tests, declaration emit) is unconfirmed; 6.0.x is the fallback.
- `architecture-walkthrough.html` is a team aid, not part of the contract.
