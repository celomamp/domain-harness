---
name: domain harness
status: final
sources:
  - "{planning_artifacts}/prds/prd-domain harness-2026-10-09/prd.md"
  - "{planning_artifacts}/architecture/architecture-domain harness-2026-10-09/ARCHITECTURE-SPINE.md"
  - "https://levva.io/"
updated: 2026-10-10
---

# Domain Harness — Experience Spine

Domain Harness is the system of record for a Company's software-construction Standards in the agent era, with proof of Adherence. People work on one management panel. The CLI Gate, the CI Gate, and Agent Guidance stay in their hosts, and this spine states the text those hosts must show. The first cut is the Team-shaped pilot. Later reports and Decision response stay specified and are marked outside the first cut.

## Foundation

Multi-surface. The one human surface is the management panel, in the vendor environment. Sibling surfaces stay in their hosts: the CLI Gate, the CI Gate, Agent Guidance over MCP for any MCP-compatible agent, the read API, git, and the Collector. First-cut Boilerplates target Claude Code and Cursor. This spine specifies the text those hosts must show. It does not redesign the hosts.

[ASSUMPTION] The management panel is a responsive web application, desktop-primary. The PRD never says web, mobile, or desktop.

No UI system is named. Visual identity follows levva.io and lives in DESIGN.md.

[ASSUMPTION] Buyer, Standard owner, and Builder use the same panel. Each role can take only the actions the PRD grants that role. Anything else is a denial, not a hidden product.

[ASSUMPTION] Sign-in requires a provisioned account. The authentication mechanism is unset. SSO is outside the first cut.

The product name is a working title. Buyer is Vini. Builder is Ana. Standard owner is Helena. The operator is the protagonist of account provisioning only.

First-cut versus later is the Cut column in Information Architecture.

A passing Gate is never copy for security, accessibility, or legal certification. Domain Harness does not replace the Company's obligations under LGPD or sector rules. Domain Harness does not edit the repository, open a pull request, install a vendor hook, or require a session briefing. Inventory and every evidence view omit individual Builder names until the privacy rules say otherwise. The Company sees only its own Standards, Projects, Applications, and Compilations. Levva services are not features of the panel. Approval timestamps and time-to-approval are not a first-cut surface. Information sources are the next Module after the first cut.

## Information Architecture

The management panel is one application for every role. CLI Gate, CI Gate, and Agent Guidance are host surfaces, not panel pages. No destination is named settings.

Chrome, from the mocks: wordmark Domain Harness, the signed-in role as text (Buyer, Standard owner, or Builder), and a nav that lists every panel destination in this table. Inventory groups application-rows under an agent-tool heading, then a table. The accepted-deviation-alert is a band under that chrome.

Composition reference: [mockups/inventory.html](mockups/inventory.html), [mockups/application.html](mockups/application.html), [mockups/new-application.html](mockups/new-application.html), [mockups/accepted-deviation.html](mockups/accepted-deviation.html). Spine wins on conflict.

| Surface | Reached from | Purpose | Cut |
|---|---|---|---|
| sign-in | Before the management panel | A provisioned account enters. The mechanism is unset. | First cut |
| Inventory | management panel after sign-in | Lists Applications by Project and by agent tool. Omits Builder names. | First cut |
| Application | application-row | Adherence, Deviations, and whether Guidance was consulted for one Application. | First cut |
| Adherence | management panel, scoped by project-filter | Adherence and the most frequent Deviations over time, by Application, by Project, and by Module. | First cut |
| Gaps | management panel | Which subjects are consulted, and each stored miss, with a count, for the Standard owner and the Buyer. | First cut |
| Ignored Modules | management panel | The ignored list. | First cut |
| Cross-checks | management panel | Ghost applications, consulted-but-deviated, and New-application-flow Adherence beside the baseline set. | First cut |
| Standards | management panel | Create, edit, and publish a Standard in a code stack or design system Module. | First cut |
| Project tree | management panel | Create Projects, set one parent, name the level, mark a Locked rule. | First cut |
| New-application flow | management panel [ASSUMPTION] | A description and a Project, then a Boilerplate. | First cut |
| Accepted deviation | a Deviation, and the alert on the management panel [ASSUMPTION] | Buyer records justification, period, and alert interval. | First cut |
| Compilations | management panel | Read each Compilation schema. See a dropped payload, each service's active bundle hash, sequence and staleness, and the Collector's pending and dropped counts. | First cut |
| Guidance access | management panel | Buyer configures which roles can read stored Guidance events. | First cut |
| Impact analysis | publish path, when the report exists | Applications that lose Adherence, the Adherence change, and the Accepted deviations the change touches. | Outside the first cut |
| Lineage | management panel, when the report exists | Which Applications touch which Information sources. | Outside the first cut |
| CLI Gate | a command against a local revision | Prints each Deviation. Host, not a panel page. | First cut |
| CI Gate | a step in the Company's existing pipeline | Same Gate result as the CLI Gate. Host, not a panel page. | First cut |
| Agent Guidance | a tool response to any MCP client | Document response. Host, not a panel page. First-cut Boilerplates target Claude Code and Cursor. | First cut for Document response. Decision response is outside the first cut. |

[ASSUMPTION] Ana types the Application description and confirms the Project on the management panel. The PRD does not say where that description is typed. The climax stays in her agent.

[ASSUMPTION] The recurring Accepted-deviation alert is shown on the management panel to the Buyer. The PRD names the alert contents and leaves the channel unstated. No email is assumed. The alert names the Application, the Standard, and the end date.

## Voice and Tone

Microcopy for the management panel, the CLI Gate, the CI Gate, and Agent Guidance. Brand voice lives in DESIGN.md.

[ASSUMPTION] Panel microcopy is English and uses one voice for every role. Glossary terms are exact. The PRD sets no locale and no tone.

Use the PRD glossary as written: Domain Harness, Company, Standard, Module, Standard owner, Project, Project tree, Locked rule, Effective Standard set, Application, Builder, Buyer, Project identification file, New-application flow, Boilerplate, Guidance, Document response, Decision response, Decision agent, Gate, Conflict slot, Deviation, Correction instruction, Accepted deviation, Adherence, Collector, Compilation, Impact analysis, Information source, Active governed Application.

Microcopy terms, also exact, and not a second glossary: CLI Gate, CI Gate, management panel, Ghost application, miss, gap, ignored list, unbound Application, stale, bundle, consulted-but-deviated, baseline set.

| Do | Don't |
|---|---|
| One English voice for Buyer, Standard owner, and Builder. | A warmer voice for Ana than for Vini. |
| "Deviation open." Name the Standard. | "This Application is secure, accessible, and legally compliant." |
| "unbound Application." | A silent pass when the Project identification file is missing. |
| "miss." | A Standard the Company did not publish. |
| Name the Application, the Standard, and the end date. | An individual Builder's name on Inventory or any evidence view. |
| "Team plan includes the Project tree." No price. | A price, or a hidden control. |

Status words stay as the product uses them. A code-stack entry is approved, prohibited, or required. A token entry or import entry is required or prohibited. A Gate run is pass or fail. A Deviation is open or accepted.

## Component Patterns

Behavioral rules. Visual specs live in DESIGN.md.

| Component | Use | Behavioral rules |
|---|---|---|
| application-row | Inventory | One Application, grouped by Project and by agent tool. No Builder name. The Buyer can list it before any Guidance event or Gate run. Activating the row opens Application. A tool with no repository never produces a row. |
| project-filter | Inventory, Adherence | One selected Project. On Inventory, the list is that Project. On Adherence, the series shows Applications bound to that Project and its descendants. Gaps, Ignored Modules, and Cross-checks do not inherit that descendant rule. An ignored Module is a Module with published Standards and zero Guidance events in the period. |
| adherence-series | Adherence, Application | Adherence is the share of checked Standards with no open Deviation on that Gate run. Plots Adherence and the most frequent Deviations by Application, by Project, and by Module. The value is text as well as any mark. A pass is Adherence to the Standards the Company published. |
| deviation-row | Application | Standard id, conflict slot, subject, open or accepted, and the Correction instruction. The match key is the Standard id, the conflict slot, and the subject. No Builder name. A different match key on the same Standard still fails. |
| cross-check-row | Cross-checks | A Ghost application (a Gate run exists and no Guidance event exists for that Application), a consulted-but-deviated pair (Guidance returned Standard S and a later Gate Deviation on S for the same Application on a revision after that event), or Adherence for New-application-flow Applications beside the baseline set. The baseline set is Applications that run the Gate and were not created by the New-application flow. Opening the row does not open the repository. No Builder name. |
| gap-row | Gaps | One stored miss against the Application, the tool, and the asked-for subject, with a count. No Builder name. |
| ignored-module-row | Ignored Modules | One Module with published Standards and zero Guidance events in the period. That Module is on the ignored list. |
| standard-form | Standards | The Standard owner creates, edits, and publishes in a Module they own. Publishing creates a new version and shows id, Module, Project scope, version, and timestamp. A new Guidance request and a new Gate run resolve that version. An in-flight Gate run keeps the version it resolved at start. One response and one run use one version of a Standard. Code-stack entry: name as the conflict slot, optional version constraint, status approved, prohibited, or required, optional Correction instruction. Design-system component entry: name, usage rule, tokens it depends on, optional Correction instruction. Token entry: name, required or prohibited. Import entry: module specifier, required or prohibited. Standards conflict only on a shared conflict slot. First cut offers the code stack and design system Modules only. [ASSUMPTION] In the first cut, publishing a Standard makes that version the version in force, per FR-1. |
| project-node | Project tree | Buyer creates a Project, sets zero or one parent, and names what the level means. Domain Harness stores that name and does not assign a meaning. Buyer marks a Locked rule so a descendant Project cannot override it. Buyer grants permission to create a child Project. A child created with that permission inherits every Locked rule of its ancestors. A cycle is rejected. Another Company's Projects are absent. Community (free) is one Project. A further Project, the tree, or a Locked rule on Community (free) is a plan-refusal that names Team (first sale). |
| boilerplate-result | New-application flow | After a description and a Project, shows the Project identification file, dependency pins that satisfy the code-stack Module, design-system references that satisfy the design-system Module, MCP configuration pointed at the Company's Guidance endpoint, and skills. The Project identification file is a hidden file at the repository root. It carries the Application id, minted when the Application is created, and an advisory Project id. Guidance, the Gate, and Collectors identify the Application from that Application id and from nowhere else, and resolve its Project from the signed bundle. A mismatch between the file's Project id and the bundle is reported, never used. An Application id absent from the bundle is an unbound Application. Skills are generated instruction files the target tool already loads. They are not a vendor hook. Ana is not asked to configure MCP by hand. First-cut targets are Claude Code and Cursor. A tool that reads a git repository, an MCP configuration, and a skills file is in scope once its configuration shape is known. The Application is bound to exactly one Project and appears for the Buyer before any Gate run. A description with no Project is not created. |
| correction-instruction | deviation-row, CLI Gate, CI Gate | Text the Builder pastes into the agent. The Standard owner authors it on the Standard. When that text is empty, the Gate fills one sentence from the status, the conflict slot, and the approved entry in the same slot when one exists. The CI step log includes one Correction instruction naming the Standard and a compliant alternative. Domain Harness does not edit the repository. |
| acceptance-form | Accepted deviation | Buyer records a justification, a start, an end, and the alert interval for one Deviation. Stored: the Buyer, the justification, the start, the end, and the match key. The end date and the alert interval stay as text on the record for as long as it is stored. While unexpired, a later finding with that match key is accepted. After the end, that match key fails the Gate again. An end before the start is an invalid submit: the form names the end field and keeps the record unwritten. A Builder who accepts their own Deviation receives a denial that says the Buyer records the acceptance. Batch acceptance is outside the first cut. |
| accepted-deviation-alert | management panel | [ASSUMPTION] The recurring Accepted-deviation alert is shown on the management panel to the Buyer. The PRD names the alert contents and leaves the channel unstated. No email is assumed. The alert names the Application, the Standard, and the end date. It stays until the Buyer dismisses it or the end date passes. |
| plan-refusal | Any panel surface whose capability is outside the signed-in plan | Shown in place on the management panel. Names the plan that includes the capability: Community (free), Team (first sale), Business, or Enterprise. No prices. v1 does not charge per seat. Team includes up to 25 Active governed Applications. Business includes up to 100. An Active governed Application has a Project identification file and, in the period being counted, a Gate run or a Guidance event. Enterprise states no band. The pipeline log and the MCP response do not carry this refusal. [ASSUMPTION] A capability outside the signed-in Company's plan is refused in place, and the refusal names the plan that includes it. No prices. Exceeding a band is never a plan-refusal and never blocks work: see band-banner. |
| band-banner | management panel, Buyer | Shown to the Buyer when the Active governed Application count exceeds the plan's band: a banner with the count and the band, in text. Levva is flagged for follow-up. It never blocks a Gate run, a Guidance call, or the New-application flow. The pipeline log and the MCP response do not carry it. |
| bundle-status | Compilations | Per service: the active bundle hash, its sequence, its age against the Buyer-set bound, and whether the Buyer has recorded a freeze. A service past the bound is marked stale in text. |
| denial | Any panel surface | The surface stays visible. A role without the grant gets a denial, not a hidden app. The refused action is announced. A person without a provisioned account cannot publish, accept a Deviation, or read Guidance events. A Builder who is not the Standard owner cannot publish. A Builder without permission to create a child Project receives a denial, and no Project is created. A Builder cannot accept their own Deviation. A role without the grant receives a denial on Guidance event content. Another Company's Standards, Projects, Applications, and Compilations are not on this panel. |
| compilation-drop | Compilations | A Compilation that fails its schema is dropped. The drop is visible to the Buyer. No partial payload is shown. A Compilation contains no prompt text, no Standard content, and no source code. |
| schema-reader | Compilations | The Buyer reads the versioned schema for every Compilation type before the Collector is allowed to send. The catalog is closed and frozen for the pilot: Guidance, Gate run, Deviation, Binding refusal, Bundle status (active hash, sequence, staleness), and Collector health (pending, dropped by reason). Every Compilation carries an idempotency key, the Application id, an agent tool name, a timestamp, and a per-Application sequence number. Guidance carries the tool name, the conflict slot, the subject asked as a slot-name token or a Company-keyed hash, and the Standard id and version or a miss. A Gate run carries the revision, pass or fail, the checked and open counts, and each Deviation's match key and whether it is open or accepted. A field or type beyond the catalog needs a security review and a schema version bump. The Collector's pending count and dropped count are visible to the Buyer. |
| role-grant | Guidance access | The Buyer configures which roles can read stored Guidance events. A role without the grant receives a denial on Guidance event content. Exporting a Compilation yields no field defined as prompt text. Stored Guidance events hold only the fields in FR-20, never raw prompt text. Retention defaults to 90 days and the Company can change it. |
| panel-chrome | Every panel surface | Wordmark, role as text, nav of every panel destination. Inventory groups application-rows under an agent-tool heading. |
| sign-in | Before the management panel | [ASSUMPTION] Sign-in requires a provisioned account. The authentication mechanism is unset, and so are the fields. SSO is outside the first cut. A failed attempt shows a denial in text and stays on sign-in. Success lands on Inventory. The account names the role. Buyer, Standard owner, and Builder then use the same panel. |

## State Patterns

Panel surfaces share one load rule and one offline rule. [ASSUMPTION] The panel has no offline editing. A cold load shows the surface structure until Compilation data arrives. If that request errors, the structure stays, the evidence region says the Compilation did not arrive, and no write is queued. No latency number. The PRD leaves both unset. Offline is that rule. It is not a sync design, and a write does not queue. An Application placed on a Project is listed before any Compilation. Adherence, Deviations, and Guidance consultation fill in when Compilations arrive.

Host surfaces have no panel cold-load and no offline mode.

| Surface | Cut | States |
|---|---|---|
| sign-in | First cut | Cold-load: the form structure. The fields stay unset with the mechanism. Empty: the form is waiting. Permission-denied: an unprovisioned account receives a denial in text and does not reach Inventory. Failure: a failed attempt shows a denial in text and stays on sign-in. Success lands on Inventory. Offline: no editing. |
| Inventory | First cut | Cold-load: surface structure, then Compilation evidence. Empty: no Application on the selected Project. Permission-denied: denial. Failure: a tool with no repository never appears, so the inventory is incomplete. When the plan lacks the panel that joins Guidance to Gate results, plan-refusal names Team (first sale). Offline: no editing. |
| Application | First cut | Cold-load: surface structure, then Compilation evidence. Empty: the Application is listed and has no Guidance event and no Gate run. Permission-denied: denial on Guidance event content when the role lacks the grant. Failure: a Gate result of unbound Application is shown as a failure. The text says the Project identification file is missing or unreadable, or that its Application id is absent from the bundle, and recovery is to restore that file or ask the Buyer to place the Application. A second repository that presents an Application id already bound to another repository is refused in text, and recovery is to use the repository already bound to that id. When the plan lacks the panel that joins Guidance to Gate results, plan-refusal names Team (first sale). Offline: no editing. |
| Adherence | First cut | Cold-load: surface structure, then Compilation evidence. Empty: no Gate run in the selection, so adherence-series has no point. Permission-denied: denial. Failure: plan-refusal naming Team (first sale) when the plan lacks the panel that joins Guidance to Gate results. A pass is not certification copy. Offline: no editing. |
| Gaps | First cut | Cold-load: surface structure, then Compilation evidence. Empty: no miss in the period. Permission-denied: denial. Failure: the Compilation did not arrive. Plan-refusal names Team (first sale) when the plan lacks the panel that joins Guidance to Gate results. Offline: no editing. |
| Ignored Modules | First cut | Cold-load: surface structure, then Compilation evidence. Empty: no Module is on the ignored list. Permission-denied: denial. Failure: plan-refusal names Team (first sale) when the plan lacks the panel that joins Guidance to Gate results. Offline: no editing. |
| Cross-checks | First cut | Cold-load: surface structure, then Compilation evidence. Empty: no Ghost application and no consulted-but-deviated row. Permission-denied: denial. Failure: plan-refusal names Team (first sale) when the plan lacks the panel that joins Guidance to Gate results. Offline: no editing. |
| Standards | First cut | Cold-load: surface structure. Empty: the Module has no published Standard. Permission-denied: denial when the person is not the Standard owner. Failure: a Module with no owner cannot be published. Invalid submit: two Standards that share a conflict slot are named, and the version is not created. Modules other than code-stack and design-system are outside the first cut. Offline: no editing. |
| Project tree | First cut | Cold-load: surface structure. Empty: the Company has no Project yet. Permission-denied: denial, and no Project is created, when a Builder lacks permission to create a child Project. Failure: a cycle is rejected. The text names the parent that closes the cycle, and the Buyer chooses another parent. On Community (free), a second Project is a plan-refusal that names Team (first sale). Offline: no editing. |
| New-application flow | First cut | Cold-load: surface structure. Empty: the form is waiting for a description and a Project. Permission-denied: denial. Failure: a description with no Project is not created. The text names the Project field and tells Ana to choose a Project. Offline: no editing. |
| Accepted deviation | First cut | Cold-load: surface structure. Empty: no Accepted deviation is stored. Permission-denied: denial when a Builder accepts their own Deviation. Failure: after the end date, that match key fails the Gate again. On Community (free), plan-refusal names Team (first sale). Offline: no editing. |
| Compilations | First cut | Cold-load: surface structure. Empty: no Compilation has arrived, and schema-reader still shows the schema. Permission-denied: denial. Failure: compilation-drop. The Buyer must have read the schema before the Collector is allowed to send. Offline: no editing. |
| Guidance access | First cut | Cold-load: surface structure. Empty: no role grant is configured. Permission-denied: denial on Guidance event content when the role lacks the grant. Failure: a Compilation export contains no prompt text. Offline: no editing. |
| Impact analysis | Outside the first cut | Cold-load: report structure. Empty: no Application loses Adherence. Permission-denied: denial. Failure: plan-refusal names Business when the plan lacks the report. The two publish sentences in UJ-5 stay unreconciled. Offline: no editing. |
| Lineage | Outside the first cut | Cold-load: report structure. Empty: no Application is paired with an Information source. Permission-denied: denial. Failure: plan-refusal names Enterprise when the plan lacks the report. Offline: no editing. |
| CLI Gate | First cut | Prints each Deviation with its Standard id and Correction instruction. Empty of findings: exit zero when every Deviation is absent or accepted and unexpired, and the print says pass. Failure: exit non-zero when a Deviation is open, and the print says fail. unbound Application, a missing or unreadable Project identification file, a duplicate Application id, and a run that did not complete each print one sentence. A missing Effective Standard set prints that the set could not be read, and the exit is non-zero. A bundle file whose issue time is past the Buyer-set bound (default 24 hours, unless a freeze is recorded) prints one sentence that the bundle is stale, and the exit is non-zero. A bundle that fails verification prints one sentence and the exit is non-zero. The command does not modify the working tree. |
| CI Gate | First cut | The step log shows each Deviation and one Correction instruction. The result matches the CLI Gate for the same revision and the same published versions. Failure: the step fails the pipeline when the CLI Gate would exit non-zero. unbound Application, a missing or unreadable Project identification file, a duplicate Application id, a run that did not complete, and a missing Effective Standard set each print one sentence in the step log. When the active bundle is past the Buyer-set bound (default 24 hours, unless a freeze is recorded), the step prints an explicit stale result in one sentence and fails the pipeline. It is never a pass. The commit that entered the step is the commit that leaves it. The CI Gate is a Team capability. The pipeline log does not name the plan. When the step does not run, it still prints a text reason. |
| Agent Guidance | First cut for Document response. Decision response is outside the first cut. | Every response is one of three typed results: hit (Standard id, version, content), miss (the asked-for subject), or unbound. The service stores each miss as a gap. When the active bundle is past the Buyer-set bound, Guidance keeps serving it and each response says it is stale. The same tools serve any MCP client. Failure: a missing or unreadable Project identification file, or an Application id absent from the bundle, returns unbound and Guidance refuses, in one sentence, to answer with another Project's Standards. A second repository presenting an already bound Application id is refused in one sentence. A missing Effective Standard set returns one sentence that the set could not be read. A miss sentence includes the asked-for subject. No tool requires a session briefing, and no tool blocks the agent from finishing a turn. Decision response, outside the first cut, returns only the applicable component, token, or rule, and a short usage example, cites the Standard version it used, does not answer from knowledge that is not a published Standard, and a miss does not invent a Standard. Decision response is a Business capability. The MCP response does not name the plan. |

## Interaction Primitives

**Pointer-first panel.** [ASSUMPTION] The panel is pointer-first. The PRD names no input modality. The Buyer, the Standard owner, and the Builder point at a row or a form on the management panel. Activating an application-row opens that Application. Activating a cross-check-row opens that Ghost application or consulted-but-deviated row. A gap-row and an ignored-module-row stay on their lists. project-filter, standard-form, project-node, acceptance-form, role-grant, and the New-application flow are controls on that same panel.

**Keyboard.** Every pointer action has a keyboard equivalent, including activating application-row and cross-check-row, changing project-filter, publishing standard-form, submitting acceptance-form, and completing sign-in. Tab order follows reading order on every panel surface. Opening a form moves focus to its first field. Esc leaves the form without publishing, without accepting a Deviation, and without creating a Project, and returns focus to the control that opened it. Focus is never trapped. The focus indicator is visible. Its contrast is `{colors.ink}` against `{colors.surface-base}`, as in DESIGN.md.

**CLI Gate.** A command a Builder or a pipeline runs against a local revision. It prints each Deviation and does not modify the working tree.

**CI Gate.** A step in the Company's existing pipeline. The step log is the Company's log. Domain Harness does not replace the pipeline UI.

**Agent Guidance.** A tool response to any MCP client. First-cut Boilerplates target Claude Code and Cursor. First-cut tools are `code_stack_rule` (language, framework, or library name), `design_component` (component name or usage situation), `design_token` (token name), and `design_import` (module specifier). The quality of those descriptions is part of the product. Each description states the decision and the inputs. The response is a hit with the Standard content, a miss, or unbound. It is not a briefing-sized dump.

**Read API.** A Company system reads. There is no write.

**Banned, from the non-goals.** Editing the repository. Opening a pull request. Installing a vendor hook. Requiring a session briefing or blocking the agent from finishing a turn. Using a passing Gate as security, accessibility, or legal certification. Scoring visual fidelity or inventing a visual Gate failure. Authoring a design system, a component library, or a data catalog. Assigning a meaning to a level in the Project tree. Charging per seat. Scanning Applications for OWASP classes. Ingesting Snyk, Semgrep, or Sonar findings in v1. Asking Ana to configure MCP by hand.

## Accessibility Floor

Behavioral. Visual contrast lives in DESIGN.md and follows the pairs table there.

[ASSUMPTION] The management panel meets WCAG 2.2 AA. The user set the stakes of this UX pass to consumer. The customer in the PRD is a Company. The PRD states no accessibility requirement for this product.

- Every control has a text label, including project-filter, standard-form, acceptance-form, role-grant, sign-in, and the New-application flow fields.
- The panel's programmatic language is English. When a Standard, a usage rule, a Correction instruction, or a level name is in another language, that part is identified.
- Tab order matches reading order on every panel surface. Every pointer action has a keyboard equivalent. Opening a form moves focus to its first field. Esc returns focus to the opener. Focus is never trapped. The focus indicator is visible.
- A denial and a plan-refusal are announced as a status, not conveyed by appearance alone. compilation-drop is announced the same way, in text: the schema failed, and no partial payload was stored. The Buyer can correct the Collector and send again.
- adherence-series is not color-only. The Adherence value and the Deviation count are text, and the plot has that text as its alternative. Status words carry the state: pass or fail, open or accepted, approved, prohibited, or required.
- An activating application-row is named with the Application. An activating cross-check-row is named with the check type. Evidence tables have header cells. project-node is exposed as a tree with the Project name and the level name.
- Nothing flashes more than three times in any one second. If adherence-series or the Accepted-deviation alert moves, blinks, or updates for more than five seconds, the Buyer can pause, stop, or hide it.
- Every pointer target is at least 24 CSS pixels, or it meets the WCAG 2.2 spacing exception. The spacing scale is DESIGN.md `{spacing.*}`.
- Publish, accept, filter, and sign-in remain available at 320 CSS pixels wide.
- CLI Gate and CI Gate print each Deviation and its Correction instruction as text. Agent Guidance returns the Standard or a miss as text, and the miss sentence includes the asked-for subject. Those hosts are not a responsive layout of the panel, and this floor does not restyle them. unbound Application, a missing or unreadable Project identification file, a duplicate Application id, and a run that did not complete each print one sentence. A missing Effective Standard set prints that the set could not be read.

## Responsive & Platform

[ASSUMPTION] The management panel is a responsive web application, desktop-primary. The PRD never says web, mobile, or desktop.

The CLI Gate, the CI Gate, and Agent Guidance are not responsive layouts of the panel. The read API, git, and the Collector are not layouts of the panel.

| Breakpoint | Behavior |
|---|---|
| At least 1280px | [ASSUMPTION] Evidence tables sit beside the Project tree context. |
| 768–1279px | [ASSUMPTION] Tables stack under the project-filter. |
| Below 768px, down to 320 CSS pixels | [ASSUMPTION] Publish, accept, filter, and sign-in stay available, stacked, with vertical scroll. Evidence tables and adherence-series may scroll in two dimensions. This is not a second mobile product. |

## Inspiration & Anti-patterns

No reference products were supplied. Nothing in this spine is lifted from another product.

Rejects, from the non-goals:

- Rejected — editing a repository, opening a pull request, or installing a vendor hook.
- Rejected — a session briefing, or a review that blocks the agent from finishing a turn.
- Rejected — a passing Gate as copy for security, accessibility, or legal certification.
- Rejected — authoring a design system, a component library, or a data catalog.
- Rejected — Domain Harness deciding what a level in the Project tree means.
- Rejected — charging per seat in v1.
- Rejected — scanning Applications for OWASP classes.
- Rejected — naming individual Builders in inventory or evidence.
- Rejected — scoring visual fidelity, or inventing a visual failure when a design-system miss has no machine-checkable rule.
- Rejected as first-cut behavior — Decision response, Impact analysis, batch acceptance, lineage, work-tracker tasks, SSO/SCIM, origin sync from Figma and other source systems, and Modules other than code stack and design system.
- Rejected as users of v1 — a Company with no pipeline and no governance practice, and a person building only for themselves with no Company Standards to record.

## Key Flows

### UJ-1. Vini sees what the business is building.

**Cut:** First cut.

**Realizes:** FR-10 Project identification file is the join key; FR-20 Store Guidance and Gate results on the Application; FR-21 Adherence over time; FR-23 Cross-checks.

1. Entry state: Vini is authenticated on the management panel, after at least one Application carries a Project identification file.
2. He opens Inventory.
3. He filters by Project with project-filter.
4. He opens one Application and reads its Adherence, its Deviations, and whether Guidance was consulted.
5. He opens Adherence. The series follows the selected Project and its descendants.
6. He opens Gaps and reads which subjects were consulted and which asks missed.
7. He opens Cross-checks.

**Climax:** On Cross-checks, the panel shows Applications that reached the Gate with no Guidance (Ghost applications) beside Applications built through the New-application flow.

Resolution: Vini can point a Standard owner at a gap or a repeated Deviation without opening the repository. Rows do not name a Builder.

Failure path: An Application published from a tool with no repository never appears. Such tools stay outside the first cut, and Vini's inventory is incomplete until a channel is defined.

### UJ-2. Ana starts an Application that is already placed.

**Cut:** First cut.

**Realizes:** FR-7 Permission to create a child Project; FR-8 Place a new Application; FR-9 Generate a Boilerplate; FR-10 Project identification file is the join key.

1. Entry state: Ana is authenticated. She has permission to create an Application on a Project the Buyer has opened to her.
2. She describes what she wants. [ASSUMPTION] Ana types the Application description and confirms the Project on the management panel. The PRD does not say where that description is typed. The climax stays in her agent.
3. She confirms the Project.
4. She receives a repository Boilerplate with the stack, the design system, the Project identification file, MCP configuration, and skills.

**Climax:** She opens the repository in her agent and the agent can already request Guidance for that Project.

Resolution: the Application exists for the Buyer from this moment, before any Gate run. Ana is not asked to configure MCP by hand. A child created with permission inherits every Locked rule of its ancestors. Skills are not a vendor hook. First-cut targets are Claude Code and Cursor. A tool that reads the same three artifacts is in scope once its configuration shape is known.

Failure path: Ana asks for a child Project so a Locked rule will not apply. Creation is denied. She continues on the Project she was given. A description with no Project is not created.

### UJ-3. Ana's agent asks for the button and gets the Standard.

**Cut:** First cut for Document response. FR-12 Decision response is outside the first cut.

**Realizes:** FR-6 Precedence and Locked rules; FR-10 Project identification file is the join key; FR-11 Document response over MCP; FR-12 Decision response; FR-20 Store Guidance and Gate results on the Application; FR-22 Demand, gaps, ignored Modules, inventory.

1. Entry state: the agent is connected to Domain Harness. The Application id in the Project identification file resolves the Project from the active bundle.
2. The agent calls a granular tool and asks for the primary button.
3. Domain Harness returns a Document response: the component, the token, and the usage rule from the Effective Standard set.
4. In the paid Decision response path, the same ask returns only the applicable component, token, or rule, and a short usage example. That path is outside the first cut. It does not answer from knowledge that is not a published Standard.

**Climax:** Ana's screen uses the Company's component. She did not open a design-system site and she did not sit through a briefing at session start.

Resolution: the Guidance event is stored against the Application. The Effective Standard set is resolved from the Application's Project upward. On a shared conflict slot, the Standard scoped to the Project closest to the Application wins. A Locked rule from an ancestor remains and is not replaced. Guidance and the Gate return that same set for the same Application and the same published versions. Parent allows library X and child prohibits X, so an Application on the child is prohibited from X. A parent Locked rule that prohibits X still prohibits X when the child allows X. A token Standard and a library Standard do not compete.

Failure path: no Standard covers the ask. The tool says so, and the miss is recorded as a gap for the Standard owner. A miss does not invent a Standard. A missing Project identification file, or an Application id absent from the bundle, returns unbound and Guidance refuses to answer with another Project's Standards. When the active bundle is stale, Guidance still answers and flags the response stale.

### UJ-4. The pipeline stops Ana, and IT may let it through.

**Cut:** First cut.

**Realizes:** FR-10 Project identification file is the join key; FR-13 CLI Gate; FR-14 CI Gate; FR-15 Accepted deviation.

1. The Company's CI runs the Gate.
2. Entry state: the revision contains the Project identification file. The Gate can read the Effective Standard set from a verified bundle within the Buyer-set bound.
3. The Gate reports Deviations. Each one includes a Correction instruction.
4. Ana pastes that instruction into her agent and pushes again, or asks the Buyer to accept the Deviation with a justification.

**Climax:** Either the Gate passes, or an Accepted deviation is on record and the alert interval starts.

[ASSUMPTION] The recurring Accepted-deviation alert is shown on the management panel to the Buyer. The PRD names the alert contents and leaves the channel unstated. No email is assumed.

Resolution: The repository commit is the one Ana pushed. Domain Harness has not edited it. For a fixed revision and a fixed set of published versions, the CLI Gate and the CI Gate return the same Deviations. The CLI Gate prints each Deviation and does not modify the working tree. Exit is non-zero when a Deviation is open, and zero when every Deviation is absent or accepted and unexpired. The CI step fails the pipeline in the non-zero case. The commit that entered the step is the commit that leaves it. A passing Gate is never copy for security, accessibility, or legal certification.

Failure path: The design-system miss is visual and has no machine-checkable rule. The first-cut Gate does not invent a visual failure; Guidance still returned the Standard during construction. A Builder cannot accept their own Deviation. unbound Application fails the Gate rather than passing. A stale bundle fails the CI Gate with an explicit stale result rather than passing, until the Buyer refreshes the bundle or records a freeze.

### FR-13: CLI Gate.

**Cut:** First cut.

The protagonist is Ana, or the pipeline when it runs the same command.

1. Ana runs the CLI Gate against a local revision.
2. The command prints each Deviation with its Standard id and Correction instruction.
3. Exit is zero when every Deviation is absent or accepted and unexpired.

**Climax:** Ana reads the printed Correction instruction and can paste it into her agent. The command has not modified the working tree.

Failure path: exit is non-zero when a Deviation is open. unbound Application, a missing or unreadable Project identification file, a duplicate Application id, and a run that did not complete each print one sentence. A missing Effective Standard set prints that the set could not be read, and the exit is non-zero. That result is distinct from unbound Application. A stale bundle prints one sentence and the exit is non-zero.

### UJ-5. Helena changes a token and sees who breaks.

**Cut:** Outside the first cut.

**Realizes:** FR-1 Publish a versioned Standard; FR-16 Impact analysis; FR-17 Acceptance to keep passing; FR-18 Batch acceptance; FR-19 Tasks in the Company's work tracker.

The PRD states both of the following. This spine does not reconcile them.

- She publishes, then the panel shows which Applications fall out of Adherence and which Accepted deviations the change touches.
- The Buyer can read the Impact analysis before the version becomes the version in force, and can choose to publish anyway.

[ASSUMPTION] In the first cut, publishing a Standard makes that version the version in force, per FR-1. UJ-5's read-before-in-force step stays with Impact analysis, outside the first cut. The PRD does not reconcile those two sentences.

Sequence A, as one PRD sentence states it. This spine does not choose it over Sequence B.

1. Entry state: Helena can publish a new version of a Standard.
2. She publishes.
3. The panel shows the Impact analysis: which Applications fall out of Adherence, and which Accepted deviations the change touches.
4. She requests acceptance.
5. The Buyer accepts the change for a set of Applications in one action, or Domain Harness opens tasks in the Company's work tracker.

Sequence B, as the other PRD sentence states it.

1. Entry state: Helena has a new version ready, and it is not yet the version in force.
2. The Buyer reads the Impact analysis.
3. The Buyer chooses to publish anyway, or leaves the previous version in force.

**Climax:** Helena knows the cost of the change before those Applications start failing the Gate without warning.

Resolution: Applications without acceptance fail the Gate on the new version. Applications with acceptance keep passing until the acceptance expires or is revoked. Revoking the acceptance makes the next Gate run fail those Deviations again. One batch action writes one acceptance record per selected Application, all citing the same Standard version. Applications left unselected do not receive an acceptance. A work-tracker task links back to the Application and the Standard version. Domain Harness does not open a pull request. The first connectors, when built, are Jira and Azure DevOps.

Failure path: the report cannot be produced, or the signed-in plan lacks Impact analysis. plan-refusal names Business. If the Buyer declines, the previous version stays the version in force and no acceptance is written. Dozens of Applications can be affected. Batch acceptance exists so the change does not require one meeting per Application.

### FR-2: Code-stack Module. FR-3: Design-system Module.

**Cut:** First cut.

Helena owns the design-system Module.

1. Helena opens standard-form on the design-system Module she owns.
2. She records a component entry (name, usage rule, tokens it depends on, optional Correction instruction), a token entry (name, required or prohibited), or an import entry (module specifier, required or prohibited).
3. The same standard-form is how the Standard owner of the code-stack Module records a language, a framework, or a library: name as the conflict slot, optional version constraint, status approved, prohibited, or required, and an optional Correction instruction. Helena does that only when she is the owner of that Module.
4. The owner publishes. A new version is created. In the first cut that version is the version in force, per the assumption on UJ-5.

**Climax:** The next Guidance request and the next Gate run both resolve that version. The Gate emits a Deviation for each prohibited match and each missing required entry. On the design-system Module it evaluates token names, import specifiers, and the component allow-list. It does not score visual fidelity.

Failure path: a Module with no owner cannot be published. A person who is not the Standard owner receives a denial. Two Standards conflict only when they share a conflict slot.

### FR-4: One Standard owner per Module.

**Cut:** First cut.

1. Vini opens the Module on the management panel.
2. He reassigns the Standard owner. The Module has exactly one accountable owner.
3. That owner can publish. The previous owner cannot.

**Climax:** The Module has one Standard owner, and only that person can publish into it.

Failure path: a Module with no owner cannot be published. A Builder who is not the Standard owner receives a denial, and no version is created.

### FR-5: Shape the Project tree.

**Cut:** First cut.

Vini is the Buyer. Resolution of the Effective Standard set is FR-6 Precedence and Locked rules on UJ-3.

1. Vini creates a Project and sets at most one parent.
2. He names what the level means. The panel stores his words. Domain Harness does not assign a meaning.
3. He marks a Locked rule on a Standard so a descendant Project cannot override it.
4. He grants permission to create a child Project.
5. A child created by someone with that permission still inherits every Locked rule of its ancestors.

**Climax:** The Project tree shows the new Project with the level name Vini wrote, and the Locked rule he marked remains for every descendant.

Failure path: a cycle is rejected. On Community (free), a second Project is a plan-refusal that names Team (first sale). A Builder without permission to create a child Project receives a denial, and no Project is created.

### FR-24: Lineage.

**Cut:** Outside the first cut.

1. Information sources are recorded as Standards. That Module is outside the first cut.
2. Vini opens Lineage.
3. The panel shows which Applications touch which Information sources, from Gate or Guidance evidence that an Application referenced one.

**Climax:** Vini can answer which Applications touch which Information sources for an LGPD or security review, without opening a repository.

Failure path: with no Information source Standard, or with no Gate or Guidance evidence, the pair is absent. On a plan other than Enterprise, plan-refusal names Enterprise. Lineage is not a certification.

### FR-25: Read API.

**Cut:** First cut.

The protagonist is the Company system. There is no person in this flow.

1. The Company system presents credentials.
2. It reads the published Standards and the Effective Standard set for a Project.

**Climax:** The API returns the same Effective Standard set that Guidance would return for that Project at that time, including for tools that never run the Gate.

Failure path: missing credentials are refused. A write from this API does not exist in v1, and a write is refused.

### FR-26: Split the runtime.

**Cut:** First cut.

1. Vini opens schema-reader and reads the schema for every Compilation type before the Collector is allowed to send.
2. Guidance, the Gate, and records that contain sensitive detail stay in the Company environment. Standard content is held in the vendor environment for the pilot and reaches the Company only as a signed bundle. The management panel runs in the vendor environment. A Collector sends only Compilations.
3. A Collector sends a Compilation from the closed catalog. A later payload fails its schema.

**Climax:** Vini sees compilation-drop. No partial payload is on the panel.

Failure path: the drop is the failure. A Compilation contains no prompt text, no Standard content, and no source code. When the panel is unreachable the Collector queues and retries, the Buyer sees the pending count, and a Guidance call or Gate run never fails or waits for it.

### FR-27: Decision agent placement.

**Cut:** Outside the first cut.

1. The Company enables the Decision agent. The PRD does not name who clicks. The click-owner is unset.
2. The Decision agent runs in the vendor environment.
3. Enabling it on the Business tier requires the zero-retention term, including the model provider. The Enterprise tier adds a dedicated environment and a Company-wide retention commitment for panel data on top of that term.

**Climax:** Decision response calls run, Domain Harness and the model provider retain no request or response content after the response is returned, and Document response continues from the Company environment.

Failure path: disabling the Decision agent stops Decision response calls. Document response continues. Without the zero-retention term, enabling on the Business tier does not proceed. A miss does not invent a Standard.

### FR-28: Restrict Guidance records.

**Cut:** First cut.

1. Vini opens Guidance access on the management panel.
2. He sets role-grant for which roles can read stored Guidance events.
3. A person whose role lacks the grant opens Guidance event content.

**Climax:** That person receives a denial on the content. The panel is the same panel.

Failure path: exporting a Compilation and searching it yields no field defined as prompt text. Stored Guidance holds only the FR-20 fields, retention defaults to 90 days and the Company can change it, and the Buyer controls who reads. The Company-facing privacy policy text is still to be drafted. This guardrail does not wait for that text.

### FR-29: Provision the pilot accounts.

**Cut:** First cut. SSO/SCIM is outside the first cut.

The protagonist is the operator.

1. The operator provisions named accounts for the Buyer, the Standard owner, and the Builder of one Company.
2. Each account record names the role used when that person publishes, creates a child Project, places an Application, accepts a Deviation, or reads Guidance events.
3. The person signs in. [ASSUMPTION] Sign-in requires a provisioned account. The authentication mechanism is unset. SSO is outside the first cut.

**Climax:** Vini, Helena, and Ana reach the same management panel, and each action is limited to the role on the account.

Failure path: a person without a provisioned account cannot publish, accept a Deviation, or read Guidance events. The refusal is a denial.

## Open gaps

Non-blocking for this spine. Architecture and legal carry them.

- Authentication mechanism
- Legal product name
- Copilot Boilerplate shape
- Privacy policy text, to be drafted from the 90-day retention commitment
- Decision-response disagreement path, and per-Company evaluations signed by Standard owners
- Origin sync from Figma and other source systems
- Alert channel, if the panel assumption is rejected
- Where Ana types the description, if the panel assumption is rejected
