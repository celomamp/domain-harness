---
status: draft
stepsCompleted: [1]
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

**Starter template: none.** The Architecture Spine names no starter template. Epic 1 Story 1 is a greenfield scaffold: a TypeScript monorepo with `packages/{core,extractor,contract,collector}` and `apps/{registry,panel,service,cli}`. The web framework, ORM, test runner and monorepo tool are chosen at scaffold time and must respect the dependency rules.

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

{{requirements_coverage_map}}

## Epic List

{{epics_list}}
