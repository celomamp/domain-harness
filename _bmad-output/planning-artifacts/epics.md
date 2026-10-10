---
status: draft
stepsCompleted: [1, 2]
scope: 'First cut (Team-shaped pilot) only'
precedence: 'SPEC > ARCHITECTURE-SPINE > PRD (per SPEC.md)'
inputDocuments:
  - _bmad-output/specs/spec-domain-harness/SPEC.md
  - _bmad-output/planning-artifacts/prds/prd-domain harness-2026-10-09/prd.md
  - _bmad-output/planning-artifacts/architecture/architecture-domain harness-2026-10-09/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/ux-designs/ux-domain harness-2026-10-09/DESIGN.md
  - _bmad-output/planning-artifacts/ux-designs/ux-domain harness-2026-10-09/EXPERIENCE.md
---

# Domain Harness - Epic Breakdown

## Overview

This document breaks the first cut (Team-shaped pilot) of Domain Harness into epics and stories. It draws on the SPEC, the PRD, the Architecture Spine and the UX design contract (DESIGN.md + EXPERIENCE.md). When sources conflict, the SPEC wins, then the Architecture Spine, then the PRD. FR ids are the PRD ids. FRs outside the first cut are listed at the end of the FR section for traceability only. They have no stories.

## Requirements Inventory

### Functional Requirements

FR-1: A Standard owner can create, edit and publish a Standard in a Module they own. Publishing creates a new version with id, Module, Project scope, version and timestamp. The "version in force" is the active signed Standard bundle. Every Guidance call and Gate run pins and records one bundle hash. A new Guidance request or Gate run resolves the newly active version. An in-flight Gate run keeps the version it started with. Past the Buyer-set staleness bound (default 24h, unless the Buyer records a freeze), the CI Gate returns an explicit `stale` result with a non-zero exit. Guidance keeps serving the bundle and flags it stale.
FR-2: Code-stack Module. An entry covers a language, framework or library. Its name is the conflict slot. It has an optional version constraint, a status (approved, prohibited or required) and an optional Correction instruction. The Gate emits a Deviation for each prohibited match and each missing required entry. Two code-stack Standards conflict only when they share a name.
FR-3: Design-system Module. A component entry has a name (slot), a usage rule, the tokens it depends on and an optional Correction instruction. A token entry has a name and a status (required or prohibited). An import entry has a module specifier and a status (required or prohibited). Guidance returns component entries by name or by usage situation. The first-cut Gate evaluates token names, import specifiers and the component allow-list. It does not score visual fidelity.
FR-4: Each Module has exactly one accountable Standard owner, and the Buyer can reassign that owner. A Module with no owner cannot be published. A non-owner cannot publish into it.
FR-5: The Buyer creates Projects, sets zero or one parent and names what the level means. Domain Harness assigns no meaning to a level. A cycle is rejected, naming the parent that closes it. Companies cannot see each other's Projects.
FR-6: The Effective Standard set is resolved from the Application's Project upward. Standards compete only on a shared conflict slot, a tuple of (Module kind, slot kind, name). The closest Project wins. An ancestor's Locked rule stays in the set and is never replaced by a descendant. Guidance and the Gate return the same set for the same Application and bundle.
FR-7: Creating a child Project requires a permission the Buyer grants. Without it, the person gets a denial and no Project is created. A child created with the permission still inherits every Locked rule of its ancestors.
FR-8: A Builder submits a description and a Project. Domain Harness creates an Application bound to exactly one Project, provided the Builder is allowed to build there. A description with no Project creates nothing. The Buyer sees the Application before any Guidance event or Gate run.
FR-9: Generate a Boilerplate (repository archive) for Claude Code and Cursor. It holds the Project identification file, dependency pins that satisfy the code-stack Module, design-system references that satisfy the design-system Module, an MCP configuration pointing at the Company Guidance endpoint, and generated skills/instruction files. It holds no vendor hook. The Builder never configures MCP by hand.
FR-10: The Project identification file (a hidden file at the repo root) carries the registry-minted Application id and an advisory Project id. Guidance, the Gate and Collectors identify the Application only by that id and resolve its Project from the active bundle. A missing or unreadable file, or an id absent from the bundle, yields `unbound`: Guidance refuses and the Gate fails. A Project-id mismatch is reported and never used. A second repository fingerprint presenting an already-bound id is refused by every surface and is visible as a Binding refusal.
FR-11: Document response over MCP (Streamable HTTP) through the granular tools `code_stack_rule` (language, framework or library name), `design_component` (component name or usage situation), `design_token` (token name) and `design_import` (module specifier). Each tool returns exactly one of `hit` (Standard id, version, content), `miss` (subject) or `unbound`. The service persists every miss as a gap against the Application, the tool and the subject. No tool needs a session-start briefing or blocks turn end. The same tools serve any MCP client. Tool descriptions state the decision and its inputs.
FR-13: The CLI Gate runs offline against a local revision using a bundle file. It verifies the bundle, uses the same core and extractor, and applies the FR-10 refusals through a local id↔repository binding file. It prints each Deviation with its Standard id and Correction instruction. It exits non-zero on any open Deviation, and zero when every Deviation is absent or accepted and unexpired. It never modifies the working tree. It applies the stale bound against the bundle's issue time.
FR-14: The CI Gate is a step in the Company's existing pipeline. For the same revision and bundle it returns the same result as the CLI Gate. It fails the pipeline exactly when the CLI Gate would exit non-zero. It logs one Correction instruction per Deviation, naming the Standard and a compliant alternative. The commit that enters the step is the commit that leaves it. Past the bound it returns `stale` with a non-zero exit. When the step does not run, it still prints a reason in text.
FR-15: The Buyer accepts a Deviation for a stated period, recording a justification, start, end and alert interval. The acceptance key is (Application id, Standard id, Standard version, conflict slot, subject). While unexpired, only that key passes, and a different key on the same Standard still fails. After the end date the core fails it again with no new bundle. A Builder cannot accept their own Deviation. Recurring alerts naming the Application, the Standard and the end date are evaluated and delivered by the registry and shown to the Buyer on the panel. An end date before the start date is an invalid submit.
FR-20: Every Guidance event and Gate run is stored against the Application id. A Guidance event stores the Application id, tool, subject, Standard version returned or miss, and agent tool name. It never stores raw prompt text. A Gate run stores the Application id, revision, bundle/Effective Standard set version, extractor version and each Deviation. Retention defaults to 90 days and the Company can change it. Inventory groups by Project and agent tool and never names Builders.
FR-21: The panel shows Adherence (share of checked Standards with no open Deviation on a Gate run, derived from checked and open counts) and the most frequent Deviations as a time series, by Application, Project and Module. The Project filter includes descendants.
FR-22: The panel shows consulted subjects, gaps (misses with counts), ignored Modules (Modules with published Standards and zero Guidance events in the period) and an inventory by Project and agent tool.
FR-23: Cross-checks. Ghost applications are those with a Gate run and no Guidance event. Consulted-but-deviated means Guidance returned Standard S and a later Gate Deviation on S occurred, where "later" is decided by the per-Application sequence, never commit ancestry or host clocks. New-application-flow Adherence is shown beside the baseline set: Gate-running Applications not created by the flow.
FR-25: Read API. A credentialed Company system reads the published Standards and the Effective Standard set for a Project. It returns the same set Guidance would return at that time. There is no write path, and a write is refused.
FR-26: Split runtime. Guidance, the Gate and Company-derived records (code, prompts, Gate logs, Guidance records) stay in the Company environment. Standard content is vendor-held and reaches the Company only as a signed bundle. The panel is vendor-side. A single Collector sends only Compilations from the closed catalog: Guidance, Gate run, Deviation, Binding refusal, Bundle status, Collector health. Each carries a UUIDv7 idempotency key, the Application id and a per-Application sequence. A subject crosses only as a slot-name token or a tenant-keyed hash. A schema-failing payload is dropped with a visible count and no partial payload. The Buyer can read every Compilation schema before the Collector is allowed to send.
FR-28: The Buyer configures which roles can read stored Guidance events. A role without the grant gets a denial on that content. A Compilation export contains no prompt-text field.
FR-29: An operator provisions named accounts (Buyer, Standard owner, Builder) for one Company. SSO/SCIM is out of scope. A person without a provisioned account cannot publish, accept a Deviation or read Guidance events. The account record names the role used by FR-4, FR-7, FR-8, FR-15 and FR-28.

_Outside the first cut (no stories; traceability only):_ FR-12 Decision response, FR-16 Impact analysis, FR-17 Acceptance to keep passing, FR-18 Batch acceptance, FR-19 Work-tracker tasks, FR-24 Lineage, FR-27 Decision agent placement.

### NonFunctional Requirements

NFR-1: Deterministic check. For a fixed (bundle hash, extractor version, revision, clock input), the CLI Gate and the CI Gate (and every adapter) return the same Deviations.
NFR-2: Auditable boundary. Every Compilation type has a versioned (semver) schema. A failing payload is dropped and the drop is visible.
NFR-3: Version integrity. No Guidance response or Gate run mixes fields from two versions of a Standard. Each pins one bundle hash.
NFR-4: Tenant isolation. A Company's Standards, Projects, Applications and Compilations are unreadable by another Company. No data-layer query path exists without a tenant id, and Postgres row-level security is a second guard.
NFR-5: No silent pass. A missing or unreadable identification file, an unbound id, a stale bundle past the bound, or an unreadable Effective Standard set is an explicit failure, never an empty success.
NFR-6: Performance design target (not an SLA): Guidance p95 under 500 ms from the bundle cache.
NFR-7: Performance design target (not an SLA): CI Gate result under 60 s. Panel is best-effort.
NFR-8: Resilience. A Collector or panel outage never fails or delays a Guidance call or Gate run. The Collector buffers in a durable local queue, retries and exposes a pending count. Queue loss shows as a Collector-health gap.
NFR-9: Privacy. Stored Guidance holds only FR-20 fields and never raw prompt text. Logs and metrics exported from the service carry ids and counts, never prompt subject text.
NFR-10: Accessibility. The management panel meets WCAG 2.2 AA (see UX-DRs).
NFR-11: Neutrality. Guidance works only through MCP and generated instruction files. No capability requires a proprietary agent-vendor hook.
NFR-12: Security. The Company environment makes only outbound calls to the vendor and opens no inbound port toward it. The service is reachable only inside the Company network. Signing keys come from a secret manager or the environment, never a repository.

### Additional Requirements

**Starter template: to be researched.** The Architecture Spine names no starter template. Epic 1 Story 1 must first research open-source starters on the internet and adopt one where it fits, recording the decision, rather than starting from zero. The target layout is a TypeScript monorepo with `packages/{core,extractor,contract,collector}` and `apps/{registry,panel,service,cli}`. The web framework, ORM, test runner and monorepo tool are chosen at scaffold time and must respect the dependency rules.

- AD-1/AD-5: Effective-set resolution and Deviation evaluation exist only in `packages/core`, written in TypeScript. No adapter re-implements them, caches a derived result across bundles, or post-processes resolution output.
- Dependency rule, enforced by tooling: `core` and `extractor` import only `contract`. Adapters and the registry import `core` and `contract`. `panel` imports `contract` only. The registry uses `core` only for slot derivation, publication validation and Boilerplate resolution.
- AD-6/AD-7: A Gate result is a pure function of (revision facts, extractor version, bundle hash, clock input). The core never reads a clock. The adapter supplies the clock.
- AD-18: Revision-fact extraction (dependency coordinates, import specifiers, tokens) lives only in `packages/extractor`. It is deterministic over supplied file contents, has a versioned fact schema, and its version is recorded on every Gate run.
- AD-3/AD-4: The vendor registry, built in-house, is the only authority for Standards, Modules, owners, the tree, Locked rules, Applications (id → Project) and Accepted deviations. These are versioned and append-only. The bundle format is the only integration seam for later sources.
- AD-11: The registry signs each bundle. The signed payload includes the tenant id, a per-tenant monotonic sequence and the key id. The service and CLI verify the signature, a key id in the trust set, the tenant and the hash, and refuse a sequence lower than the active one. Key rotation overlaps by key id. Revocation means a new trust set plus a sequence bump.
- AD-13: Every registry mutation (publish, re-parent, acceptance, Application change) validates the whole proposed bundle. It rejects a second live Standard in the same slot at the same scope, and a descendant Locked rule that contradicts an ancestor's. The core raises an error, not a guess, on a violation.
- AD-14: The active-bundle pointer lives in the Company record store (not in process memory) and is swapped atomically after verification. Every call pins and records the bundle hash.
- AD-2: One Company-operated service holds the Guidance MCP, the CI Gate runner, the Read API, the bundle puller/cache, the binding table and the record store. It ships as one container image plus its own Postgres, via compose or Helm.
- AD-8: The CLI is fully offline. It uses a bundle file and a local binding file.
- AD-9/AD-10: A single Collector module owns the only function from record to Compilation. It validates against the schema, drops failures with a visible count, and buffers in a durable queue with retries. A test asserts that no sensitive field (prompt text, Standard content, source code) reaches a Compilation.
- AD-12: One shared vendor Postgres for the pilot. Every query path is tenant-scoped, with RLS as a second guard. The application DB role must not own the tables.
- AD-15: Typed Guidance results (`hit` / `miss` / `unbound`). Tool names and inputs are versioned in `contract`.
- AD-16: The registry generates the Boilerplate, mints the Application id and identification-file content, and delivers the result as a repository archive.
- AD-17: Each Company service authenticates to the registry with a per-tenant credential. Roles are enforced in the registry and panel. The service enforces bundle and binding rules plus role-gated Guidance-event reads, using short-lived tenant-scoped role tokens issued by the registry. FR-15 alerts are evaluated by the registry.
- AD-19: Identity is network trust plus a repository fingerprint, bound trust-on-first-use. A different fingerprint presenting a bound id is refused, and the refusal is visible as a Compilation.
- AD-20: Closed, frozen Compilation catalog with UUIDv7 idempotency keys and a per-Application sequence assigned by the record store (or the CLI local file). Gate-run Compilations carry checked and open counts. A panel metric that cannot be derived from the catalog is not built.
- AD-21: Stale means fail closed. The service records bundle age. Past the Buyer-set bound (default 24h), the CI Gate returns `stale` and Guidance flags stale. The Buyer can record a freeze. The CLI checks the bundle file's issue time.
- Conventions: opaque UUIDv7 ids minted by the registry, never by clients. UTC ISO-8601 timestamps. Semver plus a type name on the bundle, the fact schema and every Compilation type, and consumers reject an unknown major version. A single error envelope (`code`, `message`, `subject`), never a partial success. Logs carry ids and counts only.
- Stack: Node 26 LTS target (`engines >=24`). TypeScript 7.x, falling back to 6.0.x. `@modelcontextprotocol/sdk` 1.x behind the MCP adapter (confirm the npm `latest` tag at scaffold). PostgreSQL 18.
- Operational envelope: vendor side is one region with managed Postgres, containers and dev/staging/prod. Company side backs up its record store and Collector queue.
- Plan gating (SPEC §Tiers): capabilities outside the signed-in plan are refused in place, and the refusal names the plan (Community/Team/Business/Enterprise) with no price. Going over the Active governed Application band (Team 25, Business 100) never blocks work. It shows the Buyer a banner with the count and flags Levva.

### UX Design Requirements

UX-DR1: Design tokens. Implement the DESIGN.md token set as one source: colors (surface-base `#FEFBE9`, surface-raised `#FFFFFF`, ink `#0A0A0A`, ink-secondary `#171717`, ink-on-accent `#000000`, accent `#FFC700`, accent-strong `#FBBF24`, border `#E5E5E5`, inverse `#FAFAFA`) and their dark-mode counterparts, spacing scale 4–64 plus gutter 24, radius sm 4px / md 8px. Use no other chromatic color, and never `#737373` for body text.
UX-DR2: Typography. Load Sora (UI/body) and Poppins (display/body-light) and implement the ramp: display 52/400, title 48/600, headline 36/700, title-sm 22/700, body 16/400/1.5, body-light 16/300, label 14/400, label-strong 14/600 (buttons only). The ramp works at 200% zoom and survives text-spacing overrides. No all-caps.
UX-DR3: Color usage rules. Gold (accent) fills only the primary action and the Accepted-deviation alert. It is never body text, never a pass/fail color, and never an Adherence celebration. Status is always a word. Evidence sits on cream or white.
UX-DR4: Contrast audit. Verify every pair in the DESIGN.md contrast table (≥4.5:1 for text, ≥3:1 for large text, focus ring and accent marks) in light and dark mode.
UX-DR5: panel-chrome. Wordmark, signed-in role as text, and a nav listing every first-cut destination (Inventory, Adherence, Gaps, Ignored Modules, Cross-checks, Standards, Project tree, New-application flow, Accepted deviation, Compilations, Guidance access). The current destination is shown at weight 600, not in gold. The accepted-deviation-alert band sits under the chrome.
UX-DR6: button-primary (gold fill, ink-on-accent, 4px, label-strong, 8px 22px padding, hover uses accent-strong only) and button-inverse (ink-secondary fill, inverse text, for a secondary commit and never for publish).
UX-DR7: application-row. Raised row with a hairline border. Hover and keyboard-active states use a cream background, not gold. At least 24px tall. Its accessible name is the Application name. It never shows a Builder name. Activating it opens the Application surface.
UX-DR8: project-filter. Raised field with an 8px radius and an ink focus ring. Single selection. On Adherence it includes descendants. Gaps, Ignored Modules and Cross-checks do not inherit the descendant rule.
UX-DR9: adherence-series. Plot marks in ink-secondary, and the accent may mark the selected Project once. The Adherence value and the Deviation count are text and form the plot's text alternative. Pause/stop/hide controls are required if it animates or updates for more than 5 seconds.
UX-DR10: deviation-row. Shows the Standard id, conflict slot, subject, status word (open/accepted) and correction-instruction. No green or red fills.
UX-DR11: cross-check-row, gap-row and ignored-module-row share the application-row language. A cross-check-row's accessible name is the check type, and activating it opens the Ghost application or the consulted-but-deviated detail. Gap and ignored rows stay on their lists.
UX-DR12: standard-form. Raised, 8px radius, white inputs with a 1px border, 12px horizontal padding, Sora 16. Field sets per entry kind: code-stack, component, token, import. An invalid submit keeps the field and adds ink text under it. A slot conflict names the conflicting Standards and creates no version. Publishing shows the id, Module, scope, version and timestamp.
UX-DR13: project-node. Exposed as an accessible tree carrying the Project name and level name. Indentation of 16px. Selected node at weight 600. Supports marking a Locked rule and granting child-creation permission.
UX-DR14: boilerplate-result. Raised surface listing each artifact (identification file, dependency pins, design-system references, MCP configuration, skills) in text, with no badges, plus the archive download.
UX-DR15: correction-instruction. Cream inset with ink Sora body text (not monospace) that the user can copy and paste into an agent.
UX-DR16: acceptance-form. Fields for justification, start, end and alert interval. End before start is an invalid submit that names the end field. A Builder accepting their own Deviation gets a denial saying the Buyer records acceptance. The end date and interval stay visible on the stored record.
UX-DR17: accepted-deviation-alert. Gold band, ink-on-accent, label-strong. Names the Application, Standard and end date. Stays until the Buyer dismisses it or the end date passes. Respects the motion and pause rules.
UX-DR18: plan-refusal. Shown in place on the panel. Names the plan that includes the capability, with no price. Announced as a status. Never appears in the pipeline log or in an MCP response.
UX-DR19: band-banner. Shown to the Buyer only, as text with the count and the band. Never blocks any action.
UX-DR20: denial. The surface stays visible and the refused action is announced as a status. Covers unprovisioned accounts, non-owner publish, child-Project creation without permission, self-acceptance, and Guidance-event content without the grant.
UX-DR21: Compilations surface. schema-reader shows each versioned Compilation schema of the closed catalog in ink on white. compilation-drop is announced in text and shows no partial payload. bundle-status shows, per service, the active hash, sequence, age against the bound, freeze state, and "stale" in text. The Collector's pending and dropped counts are shown.
UX-DR22: role-grant. Lets the Buyer configure which roles can read Guidance events. Shows the 90-day default retention and the Company-configurable retention setting.
UX-DR23: sign-in. Cream canvas with an optional display line. Uses standard-form fields. A failed attempt shows a denial in text and stays on sign-in. Success lands on Inventory.
UX-DR24: Shared state pattern. Every panel surface implements cold-load (structure first, then Compilation evidence), an error state (structure stays and the evidence region says the Compilation did not arrive), empty, permission-denied and plan-refusal states exactly as in the EXPERIENCE.md State Patterns table. There is no offline editing and no queued writes.
UX-DR25: Keyboard. Every pointer action has a keyboard equivalent. Tab order follows reading order. Opening a form focuses its first field. Esc leaves without committing and returns focus to the opener. Focus is never trapped. The visible ink focus ring has at least 3:1 contrast.
UX-DR26: Accessibility semantics. Every control has a text label. The page language is English, and other-language Standard text is marked with its language. Evidence tables have header cells. Nothing flashes more than 3 times per second. Pointer targets are at least 24px.
UX-DR27: Responsive. At ≥1280px, tables sit beside the Project tree context. At 768–1279px, tables stack under project-filter. At 320–767px, publish, accept, filter and sign-in stay usable, stacked, and evidence tables and the plot may scroll in two dimensions.
UX-DR28: Voice and glossary. All panel and host microcopy uses the PRD glossary terms and the microcopy terms exactly, in one English voice. It never uses certification language for a pass, never names an individual Builder, and never shows prices.
UX-DR29: Host text contract (CLI Gate, CI Gate, Agent Guidance). Each outcome prints one fixed sentence: pass, fail, unbound Application, missing or unreadable identification file, duplicate Application id, run did not complete, Effective Standard set could not be read, bundle stale, bundle failed verification. A miss sentence includes the asked-for subject. Stale Guidance responses say they are stale. Host output never names a plan.
UX-DR30: MCP tool descriptions. The descriptions of the 4 Guidance tools state the decision and the inputs. Their quality is part of the product and should be reviewed as copy.

### FR Coverage Map

FR-1: Epic 1 (author, version, publish in registry) + Epic 4 (signed bundle, active pointer, pin, stale rule)
FR-2: Epic 1 - Code-stack Module entries; Gate checking in Epic 5
FR-3: Epic 1 - Design-system Module entries; Guidance in Epic 4, Gate checking in Epic 5
FR-4: Epic 1 - One Standard owner per Module, Buyer reassigns
FR-5: Epic 2 - Shape the Project tree, cycle rejection, tenant isolation
FR-6: Epic 2 - Precedence and Locked rules in the core resolver
FR-7: Epic 2 - Child-Project permission
FR-8: Epic 3 - Place a new Application
FR-9: Epic 3 - Generate Boilerplate for Claude Code and Cursor
FR-10: Epic 4 (Guidance binding, unbound, fingerprint) + Epic 3 (mint id and file) + Epic 5 (Gate refusals) + Epic 8 (CLI local binding)
FR-11: Epic 4 - Document response over MCP, typed results, gaps
FR-13: Epic 8 - Offline Community CLI Gate
FR-14: Epic 5 - CI Gate
FR-15: Epic 5 - Accepted deviation and recurring alert
FR-20: Epic 4 (Guidance events) + Epic 5 (Gate runs) + Epic 6 (retention)
FR-21: Epic 7 - Adherence over time
FR-22: Epic 6 (inventory) + Epic 7 (demand, gaps, ignored Modules)
FR-23: Epic 7 - Cross-checks
FR-25: Epic 4 - Read API
FR-26: Epic 6 - Collector, closed Compilation catalog, schema reader, drops
FR-28: Epic 6 - Guidance-record role grants
FR-29: Epic 1 - Provision pilot accounts and sign-in

## Epic List

### Epic 1: Standard owners record and publish the Company's Standards
The Buyer, Standard owner and Builder of a pilot Company sign in to one management panel with provisioned, role-named accounts. The Buyer assigns one owner per Module. That owner authors, versions and publishes code-stack and design-system Standards, with conflict-slot validation. Includes the greenfield monorepo scaffold, the tenant-scoped vendor data layer, the panel shell and design tokens, and the core conflict-slot rule (AD-13) used to validate publication on a single root Project.
**FRs covered:** FR-29, FR-4, FR-1 (authoring and publish), FR-2, FR-3
**Also:** NFR-4, NFR-10; AD-3, AD-4, AD-5, AD-12, AD-13, AD-17; UX-DR1 to DR7, DR12, DR20, DR23 to DR28

### Epic 2: The Buyer shapes a Project tree whose Locked rules cannot be escaped
The Buyer builds the Company's Project tree, names its levels, marks Locked rules and grants child-creation permission. The pure resolver core (whose slot rule already exists from Epic 1) returns the Effective Standard set for any Project (closest Project wins per slot, ancestor Locked rules stay). Community-plan limits are refused in place.
**FRs covered:** FR-5, FR-6, FR-7
**Also:** NFR-1 (core determinism), NFR-4; AD-1, AD-6, AD-7, AD-13; UX-DR13, DR18

### Epic 3: A Builder starts an Application already placed inside the Standards
On the panel, a Builder describes an Application and picks a Project. The registry creates the Application, mints its id, and generates a Boilerplate archive for Claude Code or Cursor. The archive contains the identification file, compliant pins and design-system references, MCP configuration pointing at the Company Guidance endpoint (a tenant-configured URL; the service itself arrives in Epic 4), and skills files. The Buyer sees the Application immediately.
**FRs covered:** FR-8, FR-9, FR-10 (minting and file)
**Also:** AD-16; UX-DR14. Each Application change produces a new bundle input, so Epic 4 Guidance can resolve the Application.

### Epic 4: A Builder's agent gets the Company Standard at the moment of decision
The registry signs bundles. The Company-operated service pulls, verifies and atomically activates them, and serves Document response over MCP through the four granular tools: hit, miss or unbound, with misses stored as gaps and a stale flag past the bound. Guidance events are recorded against the Application id, with repository fingerprint binding. The same service exposes the read-only Read API.
**FRs covered:** FR-1 (bundle, active version, stale), FR-10 (Guidance side), FR-11, FR-20 (Guidance events), FR-25
**Also:** NFR-3, NFR-5, NFR-6, NFR-9, NFR-11, NFR-12; AD-2, AD-11, AD-14, AD-15, AD-19, AD-21; UX-DR29, DR30

### Epic 5: The pipeline stops non-compliant code, and the Buyer may accept a Deviation
The CI Gate step extracts revision facts, evaluates them against the pinned bundle and prints Deviations with Correction instructions. It fails closed on unbound or stale and never edits the commit. The Buyer records time-boxed Accepted deviations, and the registry raises recurring alerts on the panel. Acceptance starts from the Deviation match key (Standard id, conflict slot, subject), which can be pasted from the CI log line, plus the Application, as in UJ-4 where the Builder brings the Deviation to the Buyer. A fixture-based determinism test proves that two adapter paths return identical Deviations for the same (bundle hash, extractor version, revision, clock), satisfying NFR-1 without depending on Epic 8.
**FRs covered:** FR-14, FR-15, FR-2/FR-3 (Gate checks), FR-10 (Gate refusals), FR-20 (Gate runs)
**Also:** NFR-1, NFR-5, NFR-7; AD-6, AD-7, AD-18, AD-21; UX-DR10, DR15 to DR17, DR29

### Epic 6: The Buyer receives auditable evidence without sensitive data leaving the Company
A single Collector projects Company records into the closed, versioned Compilation catalog and sends them outbound with idempotency keys and per-Application sequence. It drops schema failures visibly and queues durably when the panel is down. The Buyer reads every schema before sending is allowed, sees bundle status and Collector health, controls who reads Guidance records, and sees the inventory by Project and agent tool. Adds the Application view with Deviation rows and "accept from the Deviation row", which pre-fills the Epic 5 acceptance form.
**FRs covered:** FR-26, FR-28, FR-20 (retention), FR-22 (inventory)
**Also:** NFR-2, NFR-8, NFR-9; AD-9, AD-10, AD-20; UX-DR7, DR8, DR21, DR22, DR24

### Epic 7: The Buyer and Standard owners see how Standards are consulted, followed and broken
Panel intelligence derived only from Compilations: Adherence time series and frequent Deviations by Application, Project and Module; demand, gaps and ignored Modules; cross-checks (Ghost applications, consulted-but-deviated, New-application flow vs baseline set). The Active governed Application count drives the soft band banner.
**FRs covered:** FR-21, FR-22 (demand, gaps, ignored), FR-23
**Also:** AD-20; UX-DR9, DR11, DR19, DR24

### Epic 8 (optional, Community): A Builder runs the Gate offline before pushing
The free CLI Gate verifies a bundle file and keeps a local binding file. It runs the same core and extractor offline, prints the same Deviations as the CI Gate, applies the stale rule to the bundle issue time, and never touches the working tree. It ships only if it does not delay the pilot.
**FRs covered:** FR-13, FR-10 (CLI local binding)
**Also:** NFR-1 (CLI/CI parity), NFR-5; AD-8; UX-DR29

## Epic 1: Standard owners record and publish the Company's Standards

The Buyer, Standard owner and Builder of a pilot Company sign in to one management panel with provisioned, role-named accounts. The Buyer assigns one owner per Module. That owner authors, versions and publishes code-stack and design-system Standards, with conflict-slot validation.

### Story 1.1: Scaffold the monorepo from a researched open-source starter

As a developer on Domain Harness,
I want the monorepo to start from an open-source template chosen through documented research, with package boundaries enforced by tooling,
So that we build on proven scaffolding instead of starting from zero, and resolution logic can still only live in `packages/core`.

**Acceptance Criteria:**

**Given** the Architecture Spine names no starter template
**When** the story starts
**Then** a web search covers open-source, permissively licensed (MIT, Apache-2.0 or BSD) TypeScript monorepo starters and templates (for example Turborepo, Nx or pnpm-workspace starters), MCP server templates built on `@modelcontextprotocol/sdk`, and panel/web app starters
**And** at least three candidates are compared in `docs/decisions/starter-template.md` on: license, maintenance activity (last release and commit), Node >=24 and TypeScript 7.x/6.0.x support, and fit with the `packages/*` + `apps/*` layout and dependency rules. Coverage of panel framework, ORM/Postgres 18 and test runner is a bonus, not a requirement. For each candidate the record lists what it would add that this design does not allow.

**Given** the comparison
**When** a decision is recorded
**Then** the record names the adopted template(s) with the exact version, commit or tag and the license, or explains why every candidate was rejected before falling back to a hand-made scaffold
**And** the Deferred scaffold choices from the Architecture Spine (web framework, ORM, test runner, monorepo tool) are decided in the same record with one-line reasons

**Given** the adopted starter
**When** it is applied
**Then** the code that comes with it is trimmed to the spine's structure: `packages/{core,extractor,contract,collector}` and `apps/{registry,panel,service,cli}`
**And** sample apps, telemetry, hosted-service integrations and any dependency the record did not approve are removed, and license notices are kept as the license requires

**Given** a fresh clone
**When** I install and run the workspace build, typecheck and test commands
**Then** all three pass
**And** the root manifest declares `engines.node >=24`

**Given** a file in `packages/core` or `packages/extractor` that imports anything other than `@domain-harness/contract`
**When** the lint/boundary check runs
**Then** it fails and names the offending import
**And** the same check fails when `apps/panel` imports `core`, or any package imports an `apps/*` module

**Given** `packages/contract`
**When** I inspect its exports
**Then** it defines the single error envelope `{ code, message, subject }` and a UUIDv7 id type
**And** a continuous-integration workflow runs build, typecheck, lint/boundary check and tests on every push

### Story 1.2: Operator provisions a Company and its role-named accounts

As the operator,
I want to provision one Company with named Buyer, Standard owner and Builder accounts,
So that pilot users exist with the roles every later permission check relies on (FR-29).

**Acceptance Criteria:**

**Given** the vendor Postgres 18 database
**When** migrations run
**Then** they create only the tenant, account and root-Project tables this story needs
**And** the application database role does not own the tables, and row-level security is enabled on every tenant-scoped table (AD-12)

**Given** an operator command (CLI or script) with a Company name and a list of (name, email, role) entries
**When** the operator runs it
**Then** a tenant is created with a registry-minted UUIDv7 id, one root Project, and one account per entry whose role is exactly one of Buyer, Standard owner or Builder
**And** an invalid role, or a duplicate email within the tenant, is rejected with the error envelope and nothing is written

**Given** two provisioned Companies A and B
**When** any data-access function is called without a tenant id
**Then** it raises an error instead of querying
**And** a test proves that a query issued in tenant A's context cannot read B's rows even when the tenant filter is deliberately omitted (RLS as the second guard, NFR-4)

### Story 1.3: Sign in to a branded management panel

As a provisioned Buyer, Standard owner or Builder,
I want to sign in and land on the management panel with my role shown,
So that I can reach every destination my role allows from one place (FR-29).

**Acceptance Criteria:**

**Given** the panel app
**When** it renders any surface
**Then** colors, typography (Sora and Poppins), spacing and radii come from one token source matching DESIGN.md in light and dark mode (UX-DR1, UX-DR2)
**And** an automated contrast check passes every pair in the DESIGN.md contrast table, and no style uses `#737373` for text or gold for text, pass/fail or chrome (UX-DR3, UX-DR4)

**Given** the sign-in surface (mechanism chosen at implementation and recorded, no SSO)
**When** a provisioned account signs in successfully
**Then** the person lands on Inventory, shown with its empty state, under panel-chrome that shows the wordmark, the role as text, and a nav of every first-cut destination with the current destination at weight 600 (UX-DR5, UX-DR23)
**And** button-primary and button-inverse follow UX-DR6

**Given** an unprovisioned identity or a failed attempt
**When** sign-in is submitted
**Then** a denial is shown in text, announced as a status, and the person stays on sign-in (UX-DR20)

**Given** keyboard-only use at 320, 768 and 1280 CSS pixels wide
**When** I complete sign-in and move through the nav
**Then** tab order follows reading order, the ink focus ring is visible, nothing traps focus, every target is at least 24px, and sign-in remains usable at 320px (UX-DR25 to UX-DR27)
**And** the page language is English and all copy uses the glossary terms exactly (UX-DR28)

### Story 1.4: Buyer assigns exactly one Standard owner per Module

As the Buyer,
I want to create the code-stack and design-system Modules and assign or reassign each one's Standard owner,
So that every Module has one accountable person and only that person can publish into it (FR-4).

**Acceptance Criteria:**

**Given** I am signed in as the Buyer
**When** I create a Module
**Then** I can choose only the code stack or design system kind in the first cut, the other kinds are not offered, and the Module is stored with a registry-minted id and no owner

**Given** a Module and a provisioned account
**When** I assign that account as Standard owner, or reassign it to another account
**Then** the Module has exactly one owner afterwards and the change is stored append-only with who made it and when

**Given** I am signed in as a Standard owner or Builder
**When** I try to assign or reassign a Module owner
**Then** I receive a denial and nothing changes

### Story 1.5: Standard owner publishes a versioned code-stack Standard

As the Standard owner of the code-stack Module,
I want to create, edit and publish entries for languages, frameworks and libraries,
So that the Company's approved, prohibited and required stack is on record (FR-1, FR-2).

**Acceptance Criteria:**

**Given** I own the code-stack Module
**When** I submit standard-form with a name (the conflict slot), an optional version constraint, a status of approved, prohibited or required, and an optional Correction instruction
**Then** publishing creates a version shown with its Standard id, Module, Project scope (root Project), version and UTC timestamp (UX-DR12)
**And** editing and publishing again creates a new version and never mutates a previous one

**Given** a Module with no owner
**When** anyone attempts to publish into it
**Then** publication is refused with the text that the Module has no owner

**Given** I am signed in as a Builder, or as the owner of a different Module
**When** I attempt to publish into this Module
**Then** I receive a denial and no version is created

**Given** a live Standard already occupies conflict slot (code stack, library, "X") at the root Project
**When** I try to publish a second, different Standard in that same slot and scope
**Then** `packages/core` validation (AD-13) rejects it, the form names both Standards, and no version is created
**And** core unit tests show that the slot is the tuple (Module kind, slot kind, name)

**Given** an invalid submit (for example, a missing name)
**When** I publish
**Then** the field keeps its value and ink text under it explains the error

### Story 1.6: Standard owner publishes design-system components, tokens and imports

As the Standard owner of the design-system Module,
I want to record component, token and import entries,
So that agents and the Gate can later use the Company's design system (FR-1, FR-3).

**Acceptance Criteria:**

**Given** I own the design-system Module
**When** I publish a component entry
**Then** it stores a name (slot), a usage rule, the tokens it depends on and an optional Correction instruction as a new version

**Given** I publish a token entry or an import entry
**When** the version is created
**Then** a token entry stores a name and a status of required or prohibited, and an import entry stores a module specifier and a status of required or prohibited

**Given** a token named "primary" and a code-stack library named "primary"
**When** both are published at the root Project
**Then** both are accepted, because different slot kinds never compete
**And** a second live component with the same name at the same scope is rejected as in Story 1.5

**Given** the Standards surface
**When** I open a Module with no published Standard, or the surface is loading
**Then** it shows the empty state or the cold-load structure from EXPERIENCE.md, and the Standards list is a table with header cells (UX-DR24, UX-DR26)
