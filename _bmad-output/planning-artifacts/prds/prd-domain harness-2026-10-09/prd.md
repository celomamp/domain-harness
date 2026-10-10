---
title: Domain Harness
status: final
created: 2026-10-09
updated: 2026-10-09
---

# PRD: Domain Harness
*Working title — confirm.*

## 0. Document Purpose

This PRD is the product source for the product manager, for UX, for architecture, and for the epic breakdown. Vocabulary is fixed in the Glossary. Features group related behavior, and functional requirements sit under them with stable IDs. The user confirmed the fast-path inferences on 2026-10-09. None remain open.

It builds on two inputs and does not restate them. `docs/harness-de-dominio.md` is the product definition and wins on behavior. `docs/harness-de-dominio-analise-executiva.md` is the market and executive thesis. The commercial line in §6 is decided. Geography and the NewCo boundary stay open. Market sizing, price points, competitive notes, rejected mechanisms, and the funding ask live in `addendum.md`.

## 1. Vision

Domain Harness is the system of record for a Company's software-construction Standards in the agent era, with proof of Adherence. It records those Standards in Modules, delivers the Standard that applies at the moment an AI agent makes a decision, runs the Gate before production, and shows how Standards are consulted, followed, and broken.

Companies today either review every business-built Application by hand and become the bottleneck, or let each person point an agent at a private setup. Nobody holds the mandate to keep one set of Standards for every agent.

It serves the Buyer, who must hold Standards without becoming the bottleneck and must see what is being built; the Builder, who needs to move quickly in an agent tool; and the Standard owner, who needs their Module followed without reviewing every Application by hand. The same Standard is served to any MCP-compatible agent. The Company owns the Standards. The operator of Domain Harness is accountable for serving the Effective Standard set it was given and for a Gate result that matches that set. How far that accountability extends in contract is Open Question 4.

The bet is two things agent vendors do not assemble across tools: a Project tree whose Locked rules a child Project cannot drop, and a record that joins Guidance during construction with the later Gate result. Organization instructions, team rules, design-system servers, pull-request review, scorecards, and CI scanners already exist inside single products. Domain Harness is accountable for one Effective Standard set those tools can all read, and for that join.

## 2. Why Now

The window is 2026–2028. Agent use is already ordinary, incidents from ungoverned generated applications have started, and governance of that work is not yet a settled category. A June 2026 Gartner note recommends controls during development plus validation before deploy, which is the shape of Guidance plus the Gate. MCP and AGENTS.md sit with the Agentic AI Foundation, so a tool-neutral channel is available. Detail and sources are in the executive analysis and in `addendum.md`.

## 3. Target User

### 3.1 Jobs To Be Done

- **Buyer.** Hold Standards across the Company without personally reviewing every Application. See which Projects are building, and whether those Applications follow the Standards.
- **Builder.** Start an Application that already carries the right stack and design system, and keep moving in the agent tool they already use.
- **Standard owner.** Have the Module they own followed, and learn when a Standard is missing, ignored, or regularly broken.

### 3.2 Non-Users (v1)

- Companies with no pipeline and no governance practice. The product definition defers them to a later use of the New-application flow.
- A person building only for themselves, with no Company Standards to record.
- Security teams looking for a scanner that certifies an Application. Complementary CI security tools keep that job.
- Teams that want Domain Harness to author a design system or a component library. Those tools can feed a Module.

### 3.3 Key User Journeys

Confirmed cast, 2026-10-09. Vini is the Buyer named in the sources. Ana is the Builder. Helena is the Standard owner.

- **UJ-1. Vini sees what the business is building.**
  - **Persona + context:** Vini, a technology manager, already connected an agent to the design system himself. He wants the Company's Applications on the Standards, and he wants to see them.
  - **Entry state:** Authenticated on the management panel, after at least one Application carries a Project identification file.
  - **Path:** Opens the inventory. Filters by Project. Opens one Application and reads its Adherence, its Deviations, and whether Guidance was consulted.
  - **Climax:** The panel shows Applications that reached the Gate with no Guidance (Ghost applications) beside Applications built through the New-application flow.
  - **Resolution:** Vini can point a Standard owner at a gap or a repeated Deviation without opening the repository.
  - **Edge case:** An Application published from a tool with no repository never appears. Vini's inventory is incomplete until that channel is defined (Open Question 2).
  - Realizes FR-10, FR-20, FR-21, FR-23.

- **UJ-2. Ana starts an Application that is already placed.**
  - **Persona + context:** Ana, a business professional, is building an internal tool with an agent and has no interest in learning MCP by hand.
  - **Entry state:** Authenticated. She has permission to create an Application on a Project the Buyer has opened to her.
  - **Path:** Describes what she wants. Confirms the Project. Receives a repository Boilerplate with the stack, the design system, the Project identification file, MCP configuration, and skills.
  - **Climax:** She opens the repository in her agent and the agent can already request Guidance for that Project.
  - **Resolution:** The Application exists for the Buyer from this moment, before any Gate run.
  - **Edge case:** Ana asks for a child Project so a Locked rule will not apply. Creation is denied. She continues on the Project she was given.
  - Realizes FR-7, FR-8, FR-9, FR-10.

- **UJ-3. Ana's agent asks for the button and gets the Standard.**
  - **Persona + context:** Same Ana, mid-build, about to add a primary action on a form.
  - **Entry state:** Agent connected to Domain Harness. The Project identification file resolves the Project.
  - **Path:** The agent calls a granular tool and asks for the primary button. Domain Harness returns a Document response: the component, the token, and the usage rule from the Effective Standard set. In the paid Decision response path, the same ask returns only the applicable answer.
  - **Climax:** Ana's screen uses the Company's component. She did not open a design-system site and she did not sit through a briefing at session start.
  - **Resolution:** The Guidance event is stored against the Application.
  - **Edge case:** No Standard covers the ask. The tool says so, and the miss is recorded as a gap for the Standard owner.
  - Realizes FR-6, FR-11, FR-12, FR-20, FR-22.

- **UJ-4. The pipeline stops Ana, and IT may let it through.**
  - **Persona + context:** Ana opens a pull request. The Company's CI runs the Gate.
  - **Entry state:** The revision contains the Project identification file. The Gate can read the Effective Standard set.
  - **Path:** The Gate reports Deviations. Each one includes a Correction instruction. Ana pastes that instruction into her agent and pushes again, or asks the Buyer to accept the Deviation with a justification.
  - **Climax:** Either the Gate passes, or an Accepted deviation is on record and the alert interval starts.
  - **Resolution:** The repository commit is the one Ana pushed. Domain Harness has not edited it.
  - **Edge case:** The design-system miss is visual and has no machine-checkable rule. The first-cut Gate does not invent a visual failure; Guidance still returned the Standard during construction.
  - Realizes FR-13, FR-14, FR-15.

- **UJ-5. Helena changes a token and sees who breaks.**
  - **Persona + context:** Helena owns the design-system Module. A token must change.
  - **Entry state:** She can publish a new version of a Standard.
  - **Path:** She publishes. The panel shows the Impact analysis: which Applications fall out of Adherence, and which Accepted deviations the change touches. She requests acceptance. The Buyer accepts the change for a set of Applications in one action, or Domain Harness opens tasks in the Company's work tracker.
  - **Climax:** Helena knows the cost of the change before those Applications start failing the Gate without warning.
  - **Resolution:** Applications without acceptance fail the Gate on the new version. Applications with acceptance keep passing until the acceptance expires or is revoked.
  - **Edge case:** Dozens of Applications are affected. Batch acceptance exists so Helena's change does not require one meeting per Application.
  - Realizes FR-1, FR-16, FR-17, FR-18, FR-19. Outside the first cut; see §13.2.

## 4. Glossary

Use these terms exactly. Source documents say *padrão* for Standard, *projeto* for Project, and *gate* for Gate.

- **Domain Harness** — the product. Working name. A separate company, funded by Levva, operates it. The legal name is undecided.
- **Company** — the customer organization that owns the Standards.
- **Standard** — a versioned rule the Company expects an Application to follow. It lives in one Module and is scoped to one Project.
- **Module** — the structured collection of Standards of one kind. Kinds: code stack, design system, domains and entities, information sources, brand, general.
- **Standard owner** — the person accountable for one Module.
- **Project** — a node in the Project tree. It has at most one parent and any number of children. The Company decides whether a node means a business unit, a tribe, a value stream, or an Application.
- **Project tree** — the hierarchy of Projects for one Company.
- **Locked rule** — a Standard a Project marks so a descendant Project cannot override it.
- **Effective Standard set** — the Standards that apply to an Application after precedence and Locked rules are resolved.
- **Application** — software the Company is building, bound to exactly one Project.
- **Builder** — the person who constructs an Application with an AI agent.
- **Buyer** — the technology, IT, or governance leader who holds Standards for the Company and decides Accepted deviations.
- **Project identification file** — a hidden file at the repository root that carries the Application id and the Project id.
- **New-application flow** — the path where a Builder describes an Application, it is placed on a Project, and Domain Harness generates a Boilerplate.
- **Boilerplate** — the starter for a new Application: approved stack, design system, Project identification file, MCP configuration, and skills.
- **Guidance** — an answer to an agent that asks for the Standard that applies at a decision, served over MCP.
- **Document response** — Guidance that returns the Standard content for the agent to interpret.
- **Decision response** — Guidance that returns only the applicable answer for a need the agent describes.
- **Decision agent** — the component that produces a Decision response.
- **Gate** — the check of an Application against its Effective Standard set. The CLI Gate runs on demand. The CI Gate runs in the pipeline.
- **Conflict slot** — the key that tells two Standards they compete. In the code-stack Module the slot is a language name, a framework name, or a library name. In the design-system Module the slot is a component name, a token name, or an import specifier. Standards in different slots do not compete.
- **Deviation** — a Gate finding that the Application does not follow a Standard. Its match key is the Standard id, the conflict slot, and the subject the Gate found (the dependency coordinate, component, token, or import).
- **Correction instruction** — the text attached to a Deviation so the Builder can paste it into their agent. The Standard owner authors it on the Standard. When that text is empty, the Gate fills one sentence from the status, the conflict slot, and the approved entry in the same slot when one exists.
- **Accepted deviation** — a Deviation the Buyer has accepted for a period, with a written justification.
- **Adherence** — the share of checked Standards an Application follows on a Gate run.
- **Collector** — a component in the Company environment that sends Compilations to the management panel.
- **Compilation** — one fixed-schema aggregate a Collector is allowed to send. The schema is published and auditable.
- **Impact analysis** — the report, before or as a Standard version takes effect, of Applications that lose Adherence, the Adherence change, and the Accepted deviations the change touches.
- **Ghost application** — an Application that reaches the Gate with no Guidance event recorded for that Application.
- **Information source** — a place the Company authorizes data to come from, and the purpose that use is allowed for.
- **Active governed Application** — an Application that has a Project identification file and, in the period being counted, a Gate run or a Guidance event.

## 5. Features

### 5.1 Standard Registry

**Description:** Standard owners record the Company's rules in Modules and publish them as versions. The first cut fills the code-stack Module and the design-system Module. Other kinds exist so later Modules land in the same registry. Realizes UJ-5.

**Functional Requirements:**

#### FR-1: Publish a versioned Standard

A Standard owner can create, edit, and publish a Standard in a Module they own. Publishing creates a new version. Guidance and the Gate resolve the version in force at request time.

**Consequences (testable):**
- A published Standard has an id, a Module, a Project scope, a version, and a timestamp.
- After publication, a new Guidance request and a new Gate run both resolve that version.
- An in-flight Gate run keeps the version it resolved at start.

#### FR-2: Code-stack Module

A Standard owner can record, for the code-stack Module, languages, frameworks, libraries, and versions as approved or prohibited.

**Consequences (testable):**
- A code-stack entry covers a language, a framework, or a library. It has a name (the conflict slot), an optional version constraint, a status of approved, prohibited, or required, and an optional Correction instruction.
- The Gate emits a Deviation for each prohibited match and each missing required entry.
- Two code-stack Standards conflict only when they share that name.

#### FR-3: Design-system Module

A Standard owner can record, for the design-system Module, components, tokens, and usage rules.

**Consequences (testable):**
- A component entry has a name (the conflict slot), a usage rule, the tokens it depends on, and an optional Correction instruction. A token entry has a name and a status of required or prohibited. An import entry has a module specifier and a status of required or prohibited.
- Guidance returns the component entry for a tool call that names the component or the usage situation. The usage rule is for the agent. The first-cut Gate does not score visual fidelity.
- The first-cut Gate evaluates token names, import specifiers, and the component allow-list. Two design-system Standards conflict only when they share a component name, a token name, or an import specifier.

#### FR-4: One Standard owner per Module

Each Module has exactly one accountable Standard owner. The Buyer can reassign that owner.

**Consequences (testable):**
- A Module with no owner cannot be published.
- A Builder who is not the Standard owner cannot publish into that Module.

**Notes:**
- [NOTE FOR PM] Keeping Modules current is a service and a process (source sync from Figma, repositories, and data catalogs; a review cadence; a maintenance contract). The first-cut requirement is the registry and the owner. Sync from origin systems is a later integration.

### 5.2 Project Tree

**Description:** Standards are scoped on a tree the Company defines. The closer Project wins a conflict. A Locked rule cannot be escaped by adding a child. Realizes UJ-2.

**Functional Requirements:**

#### FR-5: Shape the Project tree

The Buyer can create Projects, set one parent, and name what the level means for their Company. Domain Harness does not assign a meaning to a level.

**Consequences (testable):**
- A Project has zero or one parent.
- A cycle is rejected.
- Two Companies cannot see each other's Projects.

#### FR-6: Precedence and Locked rules

The Effective Standard set for an Application is resolved from its Project upward. Standards compete only when they share a conflict slot. On a conflict, the Standard scoped to the Project closest to the Application wins. A Locked rule from an ancestor remains in the set and is not replaced by a descendant.

**Consequences (testable):**
- Parent allows library X and child prohibits library X: an Application on the child is prohibited from X.
- Parent Locked rule prohibits library X and child allows library X: the Application is still prohibited from X.
- A token Standard and a library Standard do not compete, because they are different slots.
- Guidance and the Gate return the same Effective Standard set for the same Application and the same published versions.

#### FR-7: Permission to create a child Project

Creating a child Project requires a permission the Buyer grants. A new child does not drop a Locked rule.

**Consequences (testable):**
- A Builder without the permission receives a denial, and no Project is created.
- A child created by someone with permission still inherits every Locked rule of its ancestors.

### 5.3 New-Application Flow

**Description:** The Builder describes an Application, it is placed on the tree, and the starter already follows the stack and the design system. Starting inside the Standards is how Adherence is achieved. The Application is visible to the Buyer before the first Gate run. Realizes UJ-2.

**Functional Requirements:**

#### FR-8: Place a new Application

A Builder can submit a description and a Project. Domain Harness creates the Application bound to that Project when the Builder is allowed to build there.

**Consequences (testable):**
- The Application appears on the panel bound to exactly one Project.
- A description with no Project is not created.
- The Buyer can list the Application before any Guidance event or Gate run.

#### FR-9: Generate a Boilerplate

Domain Harness generates a Boilerplate for a tool that can consume a git repository, an MCP configuration, and a skills file.

**Consequences (testable):**
- The Boilerplate contains the Project identification file, dependency pins that satisfy the code-stack Module, and design-system references that satisfy the design-system Module.
- The MCP configuration points at the Company's Guidance endpoint.
- Skills in the Boilerplate are generated instruction files the target tool already knows how to load. They are not a vendor hook.
- The first cut generates Boilerplates for Claude Code and Cursor. A tool that reads the same three artifacts is in scope once its configuration shape is known. Copilot's Boilerplate shape remains an open configuration case.

### 5.4 Project Identification

**Description:** One hidden file binds an Application to a Project for Guidance, the Gate, and Collectors. Realizes UJ-1, UJ-2, UJ-3, UJ-4.

**Functional Requirements:**

#### FR-10: Project identification file is the join key

Every Application produced by the New-application flow contains a Project identification file at the repository root. Guidance, the Gate, and Collectors resolve the Project from that file and from nowhere else.

**Consequences (testable):**
- A repository whose file names Project P receives the Effective Standard set of P.
- A missing or unreadable file makes Guidance refuse to answer with another Project's Standards, and makes the Gate fail with an explicit "unbound Application" result rather than a silent pass.
- The file carries an Application id minted when the Application is created, and the Project id.
- A Guidance event and a Gate run that present that Application id refer to the same history.
- A second repository that presents an Application id already bound to another repository is refused by Guidance and by the Gate.

### 5.5 Guidance

**Description:** During construction the agent pulls Standards through granular MCP tools. Domain Harness does not push Standards into a vendor's hook, does not require a briefing at session start, and does not require a review before the agent finishes. The quality of the tool descriptions is part of the product. Realizes UJ-3.

**Functional Requirements:**

#### FR-11: Document response over MCP

An MCP client can call granular tools and receive a Document response for the Effective Standard set of the resolved Project.

**Consequences (testable):**
- The first-cut tools are `code_stack_rule` (input: language, framework, or library name), `design_component` (input: component name or usage situation), `design_token` (input: token name), and `design_import` (input: module specifier). Each description states that decision and those inputs.
- A call returns the matching Standard content, or an explicit miss when no Standard applies.
- A miss is stored as a gap against the Application, the tool, and the asked-for subject.
- No tool requires a session-start briefing, and no tool blocks the agent from finishing a turn.
- The same tools serve any MCP client. A vendor-specific hook is not required to receive Guidance.

#### FR-12: Decision response

On the paid path, an MCP client describes a need and receives a Decision response produced by the Decision agent: the applicable component, token, or rule, and a short usage example.

**Consequences (testable):**
- The response cites the Standard version it used.
- A need with no covering Standard returns a miss, and does not invent a Standard.
- The Decision agent is outside the first cut. The pilot proves Document response, the Gate, and the join.
- **Out of scope:** opening a pull request, editing the repository, or answering from knowledge that is not a published Standard.

**Feature-specific NFRs:**
- When the Decision agent is enabled, Domain Harness and the model provider retain no request or response content after the response is returned.

**Notes:**
- [NOTE FOR PM] If a Decision response and a later Gate run disagree, the Buyer loses trust. Ship the agreement metric (SM-4) with the Decision agent, not after it.
- [NOTE FOR PM] Packmind already distributes standards to many agents over MCP. Open Question 10 chooses whether the first-cut registry and Document response are built, adopted, or contributed. That choice changes the implementation source. It does not remove FR-1, FR-2, FR-3, or FR-11 from the first cut. The Project tree, the Accepted deviation, and the join are the layers to own. See `addendum.md`.

### 5.6 Gate

**Description:** Before production, the Gate compares the Application with its Effective Standard set. The Buyer decides what may pass anyway. Domain Harness leaves the repository unchanged and returns a Correction instruction. Realizes UJ-4.

**Functional Requirements:**

#### FR-13: CLI Gate

A Builder or a pipeline can run a CLI Gate against a local revision. The Community tier includes this Gate for a single Project.

**Consequences (testable):**
- The command reads the Project identification file, resolves the Effective Standard set, and prints each Deviation with its Standard id and Correction instruction.
- The exit code is non-zero when a Deviation is open, and zero when every Deviation is absent or accepted and unexpired.
- The command does not modify the working tree.

#### FR-14: CI Gate

The CI Gate runs as a step in the Company's existing pipeline and reports the same result as the CLI Gate for the same revision and the same published versions.

**Consequences (testable):**
- The step fails the pipeline when the CLI Gate would exit non-zero.
- Each Deviation in the step log includes one Correction instruction naming the Standard and a compliant alternative.
- The commit that entered the step is the commit that leaves it.
- The CI Gate is a paid capability. The first cut built for the pilot includes it.

#### FR-15: Accepted deviation

The Buyer can accept a Deviation for a stated period by recording a justification. Domain Harness raises a recurring alert until the acceptance ends. The Buyer sets the alert interval.

**Consequences (testable):**
- An Accepted deviation stores the Buyer, the justification, the start, the end, and the Deviation match key.
- While it is unexpired, a later finding with that match key is accepted. A finding on the same Standard with a different match key still fails.
- After the end, a finding with that match key fails the Gate again.
- An alert is emitted on the Buyer's interval and names the Application, the Standard, and the end date.
- A Builder cannot accept their own Deviation.
- Accepted deviations ship with the CI Gate in the first cut. A Gate with no acceptance path recreates the bottleneck the product exists to remove. Batch acceptance of a Standard change is a separate, later capability (FR-18).

### 5.7 Standard Change

**Description:** When a Standard version changes, the Company sees the blast radius and explicitly accepts the new world. Affected Applications otherwise start failing the Gate. Realizes UJ-5. Outside the first cut except where a new version simply becomes the version in force (FR-1).

**Functional Requirements:**

#### FR-16: Impact analysis

Publishing a Standard version produces an Impact analysis for the Applications bound to the affected Projects.

**Consequences (testable):**
- The analysis lists each affected Application, the Adherence delta, and each Accepted deviation the new version invalidates.
- The Buyer can read the analysis before the version becomes the version in force, and can choose to publish anyway.

#### FR-17: Acceptance to keep passing

An Application affected by a new Standard version keeps passing the Gate on that version only after a recorded acceptance.

**Consequences (testable):**
- Without acceptance, the next Gate run evaluates the new version and fails on each new Deviation.
- With acceptance, those Deviations are Accepted deviations tied to the version change.
- Revoking the acceptance makes the next Gate run fail them again.

#### FR-18: Batch acceptance

The Buyer can accept one Standard change for a chosen set of Applications in one action.

**Consequences (testable):**
- One action writes one acceptance record per selected Application, all citing the same Standard version.
- Applications left unselected do not receive an acceptance.

#### FR-19: Tasks in the Company's work tracker

Instead of suggesting code, Domain Harness can open a story or task in the tracker the Company already uses, carrying the Standard version and the affected Application.

**Consequences (testable):**
- A created task links back to the Application and the Standard version.
- Domain Harness does not open a pull request in the Application repository.
- **Out of scope for the first cut:** tracker connectors. The first connectors, when built, are Jira and Azure DevOps.

### 5.8 Intelligence

**Description:** Collectors send Compilations that let the panel join Guidance with Gate results for the same Application. The panel shows demand, gaps, ignored Modules, inventory, Adherence, and the cross-checks that make the join useful. Realizes UJ-1. The first cut keeps the join and the Adherence views. Lineage waits for the Information source Module.

**Functional Requirements:**

#### FR-20: Store Guidance and Gate results on the Application

Every Guidance event and every Gate run is stored against the Application id from the Project identification file.

**Consequences (testable):**
- A stored Guidance event has the Application id, the tool, the subject asked, the Standard version returned or a miss, and the agent tool name.
- A stored Gate run has the Application id, the revision, the Effective Standard set version, and each Deviation.
- The first-cut inventory groups by Project and by agent tool. Naming individual Builders stays off until the privacy rules say otherwise.

#### FR-21: Adherence over time

The panel shows Adherence and the most frequent Deviations by Application, by Project, and by Module, as a time series.

**Consequences (testable):**
- Adherence for an Application equals the share of checked Standards with no open Deviation on that Gate run.
- Changing the selected Project changes the series to Applications bound to that Project and its descendants.

#### FR-22: Demand, gaps, ignored Modules, inventory

The panel shows which subjects are consulted, which Guidance calls missed, which Modules have no Guidance in the period, and which Projects and agent tools are building.

**Consequences (testable):**
- A miss from FR-11 appears on the gap list with a count.
- A Module with published Standards and zero Guidance events in the period appears on the ignored list.
- The inventory lists Applications by Project and by agent tool.

#### FR-23: Cross-checks

The panel shows Ghost applications, Guidance that was followed by a Deviation on the same Standard (consulted-but-deviated), and Adherence for Applications from the New-application flow beside the baseline set.

**Consequences (testable):**
- A Ghost application is listed when a Gate run exists and no Guidance event exists for that Application.
- Consulted-but-deviated requires a Guidance event that returned Standard S and a later Gate Deviation on S for the same Application and a revision after that event.
- The baseline set is Applications that run the Gate and were not created by the New-application flow.

#### FR-24: Lineage

The panel shows which Applications touch which Information sources.

**Consequences (testable):**
- Given Information sources recorded as Standards, and Gate or Guidance evidence that an Application referenced one, the panel lists that pair.
- **Out of scope for the first cut:** the information-sources Module and this report. The executive analysis places lineage on the enterprise tier.

### 5.9 Standards API

**Description:** Other Company systems can read Domain Harness as the source of the Effective Standard set, including tools that never run the Gate.

**Functional Requirements:**

#### FR-25: Read API

A Company system with credentials can read the published Standards and the Effective Standard set for a Project.

**Consequences (testable):**
- The API returns the same Effective Standard set that Guidance would return for that Project at that time.
- A write from this API does not exist in v1. Publication stays in the registry (FR-1).

### 5.10 Deployment Boundary

**Description:** Sensitive content stays in the Company environment. The panel receives Compilations whose schema the Company can audit. Realizes the principle that what is sensitive stays with the Company.

**Functional Requirements:**

#### FR-26: Split the runtime

Guidance, the Gate, Standard content, and records that contain sensitive detail run in the Company environment. The management panel runs in the vendor environment. A Collector sends only Compilations.

**Consequences (testable):**
- A Compilation that fails its schema is dropped, the drop is visible to the Buyer, and no partial payload is sent.
- The Buyer can read the schema for every Compilation type before the Collector is allowed to send.
- The first-cut Compilation fields are: Application id, Project id, agent tool name, and timestamp; for Guidance, the tool name, the conflict slot, the subject asked, and the Standard id and version or a miss; for a Gate run, the revision, pass or fail, and each Deviation's match key and whether it is open or accepted.
- A Compilation contains no prompt text, no Standard content, and no source code. Fields beyond this list are Open Question 5.

#### FR-27: Decision agent placement

When the Company enables the Decision agent, it runs in the vendor environment.

**Consequences (testable):**
- Enabling it on the Business tier requires the zero-retention term in FR-12's feature NFR, including the model provider. That term covers Decision-agent traffic.
- The Enterprise tier adds a dedicated environment and a Company-wide retention commitment for panel data on top of that term.
- Disabling the Decision agent stops Decision response calls. Document response continues from the Company environment.

### 5.11 Access

**Description:** The first cut provisions named accounts. What Builders ask agents is sensitive. The Buyer decides who can see Guidance records. Compilations do not carry raw prompts.

**Functional Requirements:**

#### FR-29: Provision the pilot accounts

For the first cut, an operator provisions named accounts for the Buyer, the Standard owner, and the Builder of one Company. SSO and SCIM are outside the first cut.

**Consequences (testable):**
- A person without a provisioned account cannot publish, accept a Deviation, or read Guidance events.
- The account record names the role used by FR-4, FR-7, FR-8, FR-15, and FR-28.

#### FR-28: Restrict Guidance records

The Buyer configures which roles can read stored Guidance events. A Compilation includes no raw prompt text.

**Consequences (testable):**
- A role without the grant receives a denial on Guidance event content.
- Exporting a Compilation and searching it yields no field defined as prompt text.
- Raw prompt text is excluded. The first-cut field list is FR-26. Open Question 5 covers only fields beyond that list.

## 6. Monetization

Confirmed 2026-10-09. The free core puts Standards where an agent can read them. The first paid tier is what a Buyer purchases: proof that Applications followed those Standards, across tools. Decision response is an upgrade for a Company that is already paying, sold as token savings and agreement with the Gate.

- **Community (free).** Standard registration, Document response, CLI Gate, one Project.
- **Team (first sale).** Project tree, Locked rules, CI Gate, Accepted deviations, and the panel that joins Guidance to Gate results. Up to 25 Active governed Applications.
- **Business.** Decision agent, the zero-retention term for Decision-agent traffic, Impact analysis, batch acceptance, work-tracker tasks. Up to 100 Active governed Applications.
- **Enterprise.** Lineage, SSO/SCIM, a dedicated environment, a Company-wide retention commitment for panel data, and an SLA.

The unit of charge is the Active governed Application, in bands. Price points live in `addendum.md` and are not requirements. The paid wall is the Project tree, the Locked rule, a named Accepted deviation, and the history that joins Guidance to a later Deviation.

Services (playbook, diagnostic, implementation, ongoing maintenance) are sold by Levva beside the software. They are not features of this PRD. The registry must be complete enough that a maintenance engagement can update a Module without a product change.

## 7. Cross-Cutting NFRs

- **NFR-1 Deterministic check.** For a fixed revision and a fixed set of published versions, the CLI Gate and the CI Gate return the same Deviations.
- **NFR-2 Auditable boundary.** Every Compilation type has a versioned schema. A failing payload is dropped and visible (FR-26).
- **NFR-3 Version integrity.** Guidance and the Gate do not mix fields from two versions of the same Standard in one response or one run (FR-1).
- **NFR-4 Tenant isolation.** A Company's Standards, Projects, Applications, and Compilations are unreadable by another Company (FR-5).
- **NFR-5 No silent pass.** A missing Project identification file is a failed Gate, not an empty success (FR-10).

Latency budgets, panel availability, and a recovery-time objective are unset. See Open Question 8.

## 8. Data Governance

- Standard content, Gate logs that quote code, and Guidance records stay in the Company environment (FR-26, FR-28).
- The vendor environment holds the panel and the Compilations the schema allows.
- The Decision agent, once enabled, is the path that sends a need and a Standard excerpt to the vendor environment, and only under zero retention (FR-27).
- Lineage, when it exists, is there so a Company can answer which Applications touch which Information sources for LGPD and security reviews (FR-24). It is not a first-cut claim.
- Domain Harness does not certify security and does not replace the Company's obligations under LGPD or sector rules. The Gate reports Adherence to the Standards the Company published.

## 9. Integration and Dependencies

- **In v1:** MCP clients; a git repository to hold the Project identification file; the Company's existing CI; the read API (FR-25).
- **First-cut Boilerplate targets:** Claude Code and Cursor (FR-9).
- **Later:** Jira and Azure DevOps for FR-19; Figma, repositories, and data catalogs as sources that update Modules; Snyk, Semgrep, and Sonar remain complementary scanners. Domain Harness does not ingest their findings in v1.
- **Explicitly unbound:** tools without a traditional repository, Lovable among them. Lovable can sync to a git host; whether a Collector may read that sync is Open Question 2.

## 10. Constraints and Guardrails

### Privacy

The product definition flags the recording of what Builders ask agents as sensitive. FR-28 is the guardrail that can be built before the policy text is finished. The policy itself is Open Question 6.

### Liability

The Gate reports Adherence to published Standards. A passing Gate is not a security certification. Contractual limits, and the insurance that matches a duty of means, are a legal workstream in `addendum.md`, not a product behavior.

### Cost

Decision response spends model tokens. When that path is sold, the plan includes a monthly allowance and bills the overage. Numbers are in `addendum.md`.

### Neutrality

Guidance must work through MCP tools and generated instruction files. A capability that requires a hook proprietary to one agent vendor is out of product scope.

## 11. Risks and Mitigations

| Risk | What would go wrong | Mitigation in this PRD |
| --- | --- | --- |
| Agent vendors ship organization rules | Buyers treat Document response as something they already have | Free core is the funnel. Paid value is the Project tree, Accepted deviations, and the join (FR-6, FR-15, FR-23). |
| The Gate is too strict | Builders publish outside the pipeline | Accepted deviations ship with the CI Gate (FR-15). SM-C1 watches the bypass. |
| The Gate is too loose | The panel becomes a report nobody acts on | Deviations fail the pipeline unless accepted (FR-14). SM-C2 watches the acceptance rate. |
| A Decision response conflicts with the Gate | The Buyer stops trusting both | Decision agent stays out of the first cut. SM-4 ships with it (FR-12). |
| Standards go stale | Guidance imposes an abandoned Standard with confidence | Ignored Modules and consulted-but-deviated are visible (FR-22, FR-23). A Standard owner is required to publish (FR-4). |
| Tools without a repository skip the Gate | The inventory undercounts real building | Open Question 2. The read API is the intended feed (FR-25). |
| Compilations leak prompts | The security review stops the pilot | The first-cut field list excludes prompt text, Standard content, and source code (FR-26, FR-28). |
| The open-source core is rebuilt for its own sake | Time goes into a commodity | Open Question 10 chooses build, adopt, or contribute before implementation starts. The first-cut capabilities stay in scope. |
| Architecture reads the product as a threat to its role | The sponsor blocks the sale | The acceleration story is time-to-approval, and it waits until the Company records approval timestamps (Open Question 7). The first sale remains proof. |

Business risks (a services-heavy NewCo, a long sales cycle, a part-time founder) are in `addendum.md`. They do not change these requirements.

First cut and MVP mean the pilot list in §13. v1 means constraints that outlast the pilot.

## 12. Non-Goals (Explicit)

- Domain Harness is not a coding agent and does not edit a Company's repository or open pull requests.
- Domain Harness does not install vendor-specific hooks, and it does not require a briefing at session start or a review before the agent finishes.
- A passing Gate does not certify security, accessibility, or legal compliance.
- Domain Harness does not author design systems, component libraries, or data catalogs.
- Domain Harness does not decide what a level in the Project tree means.
- v1 does not charge per seat.
- v1 does not scan Applications for OWASP classes. That remains with the Company's security tools.
- The first cut does not include the Decision agent, Impact analysis, batch acceptance, lineage, work-tracker tasks, SSO/SCIM, or Modules other than code stack and design system.

## 13. MVP Scope

### 13.1 In Scope

The first cut is narrow on both sides and still able to show the join. This is the Team-shaped pilot. Community ships in the same period only when it does not delay the pilot.

- Code-stack Module and design-system Module (FR-2, FR-3), with owners and versions (FR-1, FR-4).
- A Project tree with precedence, Locked rules, and child-creation permission (FR-5, FR-6, FR-7).
- New-application flow and Boilerplate for Claude Code and Cursor (FR-8, FR-9).
- Project identification file as the join key (FR-10).
- Document response (FR-11).
- CLI Gate and CI Gate (FR-13, FR-14), including Accepted deviations and recurring alerts (FR-15).
- Collectors, Compilations, and the panel views for Adherence, frequent Deviations, gaps, ignored Modules, inventory, Ghost applications, and consulted-but-deviated (FR-20, FR-21, FR-22, FR-23, FR-26, FR-28).
- Read API for the Effective Standard set (FR-25).

The design-system Gate is limited to machine-checkable rules (FR-3).

### 13.2 Out of Scope for MVP

- Decision agent and Decision response (FR-12). The agreement metric is part of that later release.
- Modules for domains and entities, information sources, brand, and general. Information sources are the next Module after the first cut, because that is where the risk sits.
- Impact analysis, per-change acceptance, and batch acceptance (FR-16, FR-17, FR-18). [NOTE FOR PM] The product definition treats change-acceptance as part of how Standards stay honest. It is emotionally load-bearing and easy to pull forward if the pilot's Standards start moving.
- Work-tracker tasks (FR-19), lineage (FR-24), SSO/SCIM, dedicated environment, SLA.
- Lovable and other tools without a repository the Gate can see.
- Origin sync from Figma and other source systems.

## 14. Success Metrics

**Primary**

- **SM-1:** Adherence lift. On the pilot Company, mean Adherence of Applications created through the New-application flow, minus mean Adherence of the baseline set, at month 6. The target is at least 20 percentage points. The baseline set is defined on FR-23. Validates FR-9, FR-11, FR-14.
- **SM-2:** Active governed Applications on the pilot Company at month 6, counted as defined in the Glossary. This is the internal commercial count, and it is the charging unit in §6. Validates FR-8, FR-10, FR-14.

**Secondary**

- **SM-3:** Ghost applications as a share of Applications with a Gate run, trending down from the first month they are visible. Validates FR-23.
- **SM-4:** Among Decision responses that cite a Standard, the share whose later Gate run does not open a Deviation on that Standard. Target unset. Ships with FR-12, not with the first cut. Validates FR-12, FR-14.
- **SM-5:** Pilot commercial gate, as recommended by the executive analysis and not a product behavior: a paid pilot of at least R$ 150 thousand or a signed annual contract, and at least three letters of intent or paid diagnostics from other accounts, by month 6. Validates that the first cut is worth buying. Detail in `addendum.md`.

- **SM-6:** By month 6 the pilot Buyer has opened, from the panel, at least one consulted-but-deviated row or one Ghost application. Validates FR-23.
- **SM-7:** By month 6 at least one pilot Gate run shows a Locked rule overriding a descendant Standard in the same conflict slot. Validates FR-6.

**Counter-metrics (do not optimize)**

- **SM-C1:** Among Applications on the Project tree, the share that reach a production deploy with no Gate run. The denominator is the Project tree. Repository-less building stays outside SM-C1 until Open Question 2 has a channel. Counterbalances SM-1.
- **SM-C2:** Share of Deviations that become Accepted deviations. Counterbalances SM-1. A rising rate means Standards are stale or the Gate is blocking work the Buyer does not want blocked.
- **SM-C3:** Guidance events per Application. Do not maximize. A briefing-sized context dump would inflate this number and violate FR-11.

## 15. Open Questions

1. **Name.** Legal name of the company and product name. Domain Harness is the working title.
2. **Tools without a repository.** How an Application built in Lovable, or a similar host, gets a Project, Guidance, and a Gate result. The read API is the likely feed. A Collector that reads a synced git repository is a candidate, not a decision.
3. **Decision-agent quality operations.** Per-Company evaluations signed by Standard owners, the disagreement path when a Builder challenges a Decision response, and the numeric bar for SM-4.
4. **Contractual liability.** How far responsibility extends when an Application that passed the Gate later has a security failure. Legal workstream; the product statement is in §10.
5. **Compilation fields beyond the first cut.** FR-26 lists the fields the pilot sends. Any further field needs a security review before it is added.
6. **Privacy policy.** What Guidance stores beyond the fields in FR-20, and which roles see it, as a Company-facing policy rather than only an access-control setting.
7. **Sales story.** Resolved 2026-10-09. The first sale is proof: Adherence (SM-1) and the join of Guidance to Gate results. Time-to-approval is a later story for an architecture sponsor, shown only after the Company records an approval timestamp, and it is not a first-cut metric.
8. **Service levels.** Latency for Document response, panel availability, and recovery objectives. Required before an enterprise SLA is signed, not before the pilot.
9. **Board recommendations still open.** Brazil-first and a year-3 path to the US, and the NewCo selling software while Levva sells services. They are in `addendum.md`. The charging unit is decided: Active governed Application (§6).
10. **Implementation source of the registry.** Build, adopt, or contribute the registry and Document response. Decided before implementation starts. The capabilities remain in the first cut. See the note on FR-12.

## 16. Assumptions Index

None open. The user confirmed the fast-path inferences on 2026-10-09, including the commercial line in §6. Those sentences now stand as requirements.
