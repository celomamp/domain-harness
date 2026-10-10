# PRD extract — Domain Harness

Source: `prd.md` in `prd-domain harness-2026-10-09` (title block: status final, created and updated 2026-10-09). This file records only what that PRD commits. Pointers to other files are noted and were not read.

## Product

Domain Harness is a working title ("Working title — confirm," document title; legal name undecided, §4 Glossary and Open Question 1). §1 Vision positions it in one sentence: "Domain Harness is the system of record for a Company's software-construction Standards in the agent era, with proof of Adherence." It records those Standards in Modules, delivers the Standard that applies at the moment an AI agent makes a decision, runs the Gate before production, and shows how Standards are consulted, followed, and broken. It serves the Buyer, who must hold Standards without becoming the bottleneck and must see what is being built; the Builder, who needs to move quickly in an agent tool; and the Standard owner, who needs their Module followed without reviewing every Application by hand. The same Standard is served to any MCP-compatible agent. The Company owns the Standards. The operator of Domain Harness is accountable for serving the Effective Standard set it was given and for a Gate result that matches that set; how far that accountability extends in contract is Open Question 4. §0 Document Purpose says this PRD does not restate `docs/harness-de-dominio.md` (product definition; wins on behavior) or `docs/harness-de-dominio-analise-executiva.md` (market and executive thesis). The commercial line in §6 is decided. Geography and the NewCo boundary stay open. Market sizing, price points, competitive notes, rejected mechanisms, and the funding ask live in `addendum.md` (not read).

## Glossary

Use these terms exactly (§4). Source documents say *padrão* for Standard, *projeto* for Project, and *gate* for Gate.

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
- **management panel** — the surface that receives Compilations and shows inventory, Adherence, and the join (§5.8, §5.10). Not given a separate glossary line.
- **operator** — provisions named accounts for the first cut (§5.11). Not a glossary persona.
- **consulted-but-deviated** — Guidance that was followed by a Deviation on the same Standard (§5.8 FR-23).
- **baseline set** — Applications that run the Gate and were not created by the New-application flow (FR-23).
- **unbound Application** — the explicit Gate result when the Project identification file is missing or unreadable (FR-10).
- **miss** — the explicit result when no Standard applies to a Guidance ask (FR-11, FR-12). Stored as a gap.
- **gap** — a stored miss against the Application, the tool, and the asked-for subject (FR-11).
- **ignored list** — Modules with published Standards and zero Guidance events in the period (FR-22). The PRD says "ignored list," not a separate status noun.

Plan names (§6 Monetization):

- **Community (free)** — Standard registration, Document response, CLI Gate, one Project.
- **Team (first sale)** — Project tree, Locked rules, CI Gate, Accepted deviations, and the panel that joins Guidance to Gate results. Up to 25 Active governed Applications.
- **Business** — Decision agent, the zero-retention term for Decision-agent traffic, Impact analysis, batch acceptance, work-tracker tasks. Up to 100 Active governed Applications.
- **Enterprise** — Lineage, SSO/SCIM, a dedicated environment, a Company-wide retention commitment for panel data, and an SLA.

Status and result words the PRD uses:

- Code-stack entry: **approved**, **prohibited**, or **required** (FR-2).
- Token entry and import entry: **required** or **prohibited** (FR-3).
- Gate run, in a Compilation: **pass** or **fail** (FR-26).
- Deviation, in a Compilation: **open** or **accepted** (FR-26).
- CLI Gate exit: non-zero when a Deviation is open; zero when every Deviation is absent or accepted and unexpired (FR-13).

Named people (§3.3, confirmed cast 2026-10-09): **Vini** is the Buyer named in the sources. **Ana** is the Builder. **Helena** is the Standard owner.

First-cut MCP tool names (FR-11): `code_stack_rule`, `design_component`, `design_token`, `design_import`.

First-cut Boilerplate targets (FR-9): Claude Code and Cursor. Copilot is named only as an open configuration case.

## Users and jobs

The PRD names three roles and three protagonists. Vini, Ana, and Helena are the confirmed cast for the journeys. Buyer, Builder, and Standard owner are the roles. An operator provisions accounts and is not given a job story.

- **Buyer (role). Protagonist: Vini, a technology manager.** He already connected an agent to the design system himself. He wants the Company's Applications on the Standards, and he wants to see them. Job (§3.1): hold Standards across the Company without personally reviewing every Application; see which Projects are building, and whether those Applications follow the Standards. He decides Accepted deviations (§4). He can reassign the Standard owner of a Module (FR-4), shape the Project tree and name what a level means (FR-5), grant permission to create a child Project (FR-7), list an Application on the panel before any Guidance event or Gate run (FR-8), accept a Deviation for a stated period with a justification and set the alert interval (FR-15), read an Impact analysis and choose to publish anyway (FR-16), accept one Standard change for a chosen set of Applications in one action (FR-18), read Compilation schemas and see dropped Compilations (FR-26), configure which roles can read stored Guidance events (FR-28), and enable the Decision agent on a paid tier (FR-27). He must not be named as an individual Builder in the first-cut inventory: "Naming individual Builders stays off until the privacy rules say otherwise" (FR-20).

- **Builder (role). Protagonist: Ana, a business professional.** She is building an internal tool with an agent and has no interest in learning MCP by hand. Job (§3.1): start an Application that already carries the right stack and design system, and keep moving in the agent tool they already use. She submits a description and a Project (FR-8), receives a Boilerplate (FR-9), works in her agent while the agent requests Guidance (UJ-2, UJ-3), pastes a Correction instruction into her agent and pushes again, or asks the Buyer to accept a Deviation (UJ-4). She can run a CLI Gate (FR-13). A Builder who is not the Standard owner cannot publish into that Module (FR-4). A Builder cannot accept their own Deviation (FR-15). A Builder without permission to create a child Project receives a denial (FR-7).

- **Standard owner (role). Protagonist: Helena, who owns the design-system Module.** Job (§3.1): have the Module they own followed, and learn when a Standard is missing, ignored, or regularly broken. She creates, edits, and publishes a Standard (FR-1), records code-stack and design-system entries and authors the Correction instruction (FR-2, FR-3, §4), publishes a token change and sees Impact analysis (UJ-5), and sees misses recorded as gaps (UJ-3). Each Module has exactly one accountable Standard owner (FR-4). A Module with no owner cannot be published.

- **Operator.** For the first cut, an operator provisions named accounts for the Buyer, the Standard owner, and the Builder of one Company (FR-29). No job-to-be-done beyond that sentence. SSO and SCIM are outside the first cut.

- **Non-users (v1), §3.2.** Companies with no pipeline and no governance practice — the product definition defers them to a later use of the New-application flow (that definition is `docs/harness-de-dominio.md`, not read). A person building only for themselves, with no Company Standards to record. Security teams looking for a scanner that certifies an Application — complementary CI security tools keep that job. Teams that want Domain Harness to author a design system or a component library — those tools can feed a Module.

Levva funds the operating company and sells services (playbook, diagnostic, implementation, ongoing maintenance) beside the software. Those services are not features of this PRD (§6).

## Form factor and platforms

Human UI form factor (web, mobile, or desktop): **ABSENT.** The PRD never says web, browser, mobile, or desktop. The human surface it does name is the **management panel**. "The management panel runs in the vendor environment" (FR-26). Journeys say the Buyer is "Authenticated on the management panel" (UJ-1).

Surfaces the PRD does name:

- **Management panel** — vendor environment. Shows inventory, Adherence, Deviations, Guidance consultation, gaps, ignored Modules, Ghost applications, consulted-but-deviated, and (later) Impact analysis and lineage. Receives Compilations only.
- **CLI** — "A Builder or a pipeline can run a CLI Gate against a local revision. The Community tier includes this Gate for a single Project" (FR-13). The command prints each Deviation and does not modify the working tree.
- **MCP** — Guidance is served over MCP. "The same Standard is served to any MCP-compatible agent" (§1). "The same tools serve any MCP client. A vendor-specific hook is not required to receive Guidance" (FR-11). "Guidance must work through MCP tools and generated instruction files" (§10 Neutrality).
- **Agent tools, not called an IDE.** First cut generates Boilerplates for Claude Code and Cursor (FR-9). "A tool that reads the same three artifacts is in scope once its configuration shape is known." The three artifacts are a git repository, an MCP configuration, and a skills file. "Copilot's Boilerplate shape remains an open configuration case." UJ-2 climax: she opens the repository in her agent. UJ-3 climax is "Ana's screen" in that agent, using the Company's component.
- **CI** — "The CI Gate runs as a step in the Company's existing pipeline" (FR-14). "In v1: MCP clients; a git repository to hold the Project identification file; the Company's existing CI; the read API" (§9).
- **Read API** — "A Company system with credentials can read the published Standards and the Effective Standard set for a Project" (FR-25). "A write from this API does not exist in v1."
- **Git repository** — holds the Project identification file and the commit the Gate checks. Domain Harness does not edit it.
- **Collector** — a component in the Company environment that sends Compilations to the panel (FR-26).
- **Company work tracker** — later. "The first connectors, when built, are Jira and Azure DevOps" (FR-19). Out of scope for the first cut.
- **Decision agent** — when enabled, runs in the vendor environment (FR-27). Outside the first cut.

Explicitly unbound (§9): tools without a traditional repository, Lovable among them. Lovable can sync to a git host; whether a Collector may read that sync is Open Question 2.

Mobile: **ABSENT.** Desktop app: **ABSENT.** A named IDE product category: **ABSENT** (Claude Code and Cursor are Boilerplate targets only).

## Capabilities that need a human surface

Plan wall, once, from §6: "The free core puts Standards where an agent can read them. The first paid tier is what a Buyer purchases: proof that Applications followed those Standards, across tools. Decision response is an upgrade for a Company that is already paying." "The paid wall is the Project tree, the Locked rule, a named Accepted deviation, and the history that joins Guidance to a later Deviation." "v1 does not charge per seat" (§12). The unit of charge is the Active governed Application, in bands. Price points live in `addendum.md` and are not requirements. The first cut is "the Team-shaped pilot" (§13.1). Community ships in the same period only when it does not delay the pilot. FR-25 Read API is a Company system calling an API; no human moment is described, so it is omitted here and kept in the requirement index.

1. **Publish a versioned Standard (FR-1).** Actor: Standard owner. They create, edit, and publish a Standard in a Module they own. Publishing creates a new version. The system shows a published Standard with an id, a Module, a Project scope, a version, and a timestamp. After publication, a new Guidance request and a new Gate run both resolve that version. An in-flight Gate run keeps the version it resolved at start. Failure the PRD names: a Module with no owner cannot be published (FR-4); a Builder who is not the Standard owner cannot publish. Plan: "Standard registration" is Community. First cut includes owners and versions.

2. **Code-stack Module (FR-2).** Actor: Standard owner. They record languages, frameworks, libraries, and versions as approved or prohibited. Each entry has a name (the conflict slot), an optional version constraint, a status of approved, prohibited, or required, and an optional Correction instruction. The Gate emits a Deviation for each prohibited match and each missing required entry. Two code-stack Standards conflict only when they share that name. Plan gate for this Module alone: **ABSENT** beyond Community "Standard registration." First cut includes this Module.

3. **Design-system Module (FR-3).** Actor: Standard owner. They record components, tokens, and usage rules. A component entry has a name, a usage rule, the tokens it depends on, and an optional Correction instruction. A token entry has a name and a status of required or prohibited. An import entry has a module specifier and a status of required or prohibited. Guidance returns the component entry for a tool call that names the component or the usage situation. The usage rule is for the agent. What the first-cut Gate shows: it evaluates token names, import specifiers, and the component allow-list. It does not score visual fidelity. Failure: two design-system Standards conflict only when they share a component name, a token name, or an import specifier. First cut includes this Module. The design-system Gate is limited to machine-checkable rules (§13.1).

4. **One Standard owner per Module (FR-4).** Actor: Buyer reassigns the owner. Standard owner is the only publisher. Success: exactly one accountable owner. Failure: a Module with no owner cannot be published; a Builder who is not the Standard owner cannot publish into that Module. First cut includes owners.

5. **Shape the Project tree (FR-5).** Actor: Buyer. They create Projects, set one parent, and name what the level means for their Company. "Domain Harness does not assign a meaning to a level." Success: a Project has zero or one parent. Failure: a cycle is rejected. Two Companies cannot see each other's Projects. Plan: Project tree is Team, and it is on the paid wall. First cut includes the tree (§13.1). Community is one Project (§6).

6. **Precedence and Locked rules (FR-6).** Actors: Buyer (marks a Locked rule; the PRD does not separately describe a control for marking it beyond the term), Builder and agent (receive the resolved set). The Effective Standard set is resolved from the Application's Project upward. On a conflict, the Standard scoped to the Project closest to the Application wins. A Locked rule from an ancestor remains and is not replaced. What the system shows: Guidance and the Gate return the same Effective Standard set for the same Application and the same published versions. Stated examples: parent allows library X and child prohibits X, so an Application on the child is prohibited from X; parent Locked rule prohibits X and child allows X, so the Application is still prohibited from X; a token Standard and a library Standard do not compete. Plan: Locked rules are Team and on the paid wall. First cut includes them.

7. **Permission to create a child Project (FR-7).** Actor: Buyer grants the permission. Builder attempts creation. Success: a child created by someone with permission still inherits every Locked rule of its ancestors. Failure: "A Builder without the permission receives a denial, and no Project is created." UJ-2 edge: Ana asks for a child Project so a Locked rule will not apply; creation is denied; she continues on the Project she was given. First cut includes this permission.

8. **Place a new Application (FR-8).** Actor: Builder, authenticated, with permission to create an Application on a Project the Buyer has opened to her (UJ-2). She submits a description and a Project. Success: the Application appears on the panel bound to exactly one Project. The Buyer can list it before any Guidance event or Gate run. Failure: "A description with no Project is not created." Plan gate for placement alone: **ABSENT**. First cut includes the New-application flow. SM-2 counts Active governed Applications and validates FR-8 among others.

9. **Generate a Boilerplate (FR-9).** Actor: Builder. Domain Harness generates a Boilerplate for a tool that can consume a git repository, an MCP configuration, and a skills file. What she receives: the Project identification file, dependency pins that satisfy the code-stack Module, design-system references that satisfy the design-system Module, MCP configuration pointed at the Company's Guidance endpoint, and skills that are generated instruction files the target tool already knows how to load. "They are not a vendor hook." Success climax (UJ-2): she opens the repository in her agent and the agent can already request Guidance for that Project. The Application exists for the Buyer from this moment, before any Gate run. Failure / limit: first cut is Claude Code and Cursor only. Copilot's shape is an open configuration case. A tool that reads the same three artifacts is in scope once its configuration shape is known.

10. **Project identification file is the join key (FR-10).** Actors: Builder (the file is in the repo), agent, Gate, Buyer (inventory depends on it). Every Application from the New-application flow contains the file at the repository root. Guidance, the Gate, and Collectors resolve the Project from that file and from nowhere else. Success: a repository whose file names Project P receives the Effective Standard set of P; a Guidance event and a Gate run that present that Application id refer to the same history. Failure: "A missing or unreadable file makes Guidance refuse to answer with another Project's Standards, and makes the Gate fail with an explicit 'unbound Application' result rather than a silent pass." "A second repository that presents an Application id already bound to another repository is refused by Guidance and by the Gate." UJ-1 edge: an Application published from a tool with no repository never appears.

11. **Document response over MCP (FR-11).** Actor: Ana's agent, mid-build; the miss is for the Standard owner. The agent calls a granular tool. First-cut tools and inputs: `code_stack_rule` (language, framework, or library name), `design_component` (component name or usage situation), `design_token` (token name), `design_import` (module specifier). "Each description states that decision and those inputs." What comes back: the matching Standard content, or an explicit miss when no Standard applies. A miss is stored as a gap against the Application, the tool, and the asked-for subject. "No tool requires a session-start briefing, and no tool blocks the agent from finishing a turn." UJ-3 climax: "Ana's screen uses the Company's component. She did not open a design-system site and she did not sit through a briefing at session start." Resolution: the Guidance event is stored against the Application. Plan: Document response is Community. The quality of the tool descriptions is part of the product (§5.5).

12. **Decision response (FR-12).** Actor: an MCP client on the paid path; Ana is the person in UJ-3's paid branch. The client describes a need and receives only the applicable component, token, or rule, and a short usage example, produced by the Decision agent. The response cites the Standard version it used. Failure: "A need with no covering Standard returns a miss, and does not invent a Standard." Out of scope: opening a pull request, editing the repository, or answering from knowledge that is not a published Standard. When the Decision agent is enabled, Domain Harness and the model provider retain no request or response content after the response is returned. Plan: Business (Decision agent and the zero-retention term). "The Decision agent is outside the first cut. The pilot proves Document response, the Gate, and the join." Decision response spends model tokens; when sold, the plan includes a monthly allowance and bills the overage; numbers are in `addendum.md` (not read).

13. **CLI Gate (FR-13).** Actor: a Builder or a pipeline. They run it against a local revision. What it shows: each Deviation with its Standard id and Correction instruction. Success signal: exit code zero when every Deviation is absent or accepted and unexpired. Failure: exit code non-zero when a Deviation is open. "The command does not modify the working tree." Plan: Community, for a single Project.

14. **CI Gate (FR-14).** Actor: Ana opens a pull request; the Company's CI runs the Gate; the Buyer may later accept. The step reports the same result as the CLI Gate for the same revision and the same published versions. What the step log shows: each Deviation includes one Correction instruction naming the Standard and a compliant alternative. Failure: the step fails the pipeline when the CLI Gate would exit non-zero. "The commit that entered the step is the commit that leaves it." Plan: "The CI Gate is a paid capability" (Team). "The first cut built for the pilot includes it."

15. **Accepted deviation (FR-15).** Actor: Buyer. They accept a Deviation for a stated period by recording a justification, and they set the alert interval. What is stored: the Buyer, the justification, the start, the end, and the Deviation match key. While unexpired, a later finding with that match key is accepted. A finding on the same Standard with a different match key still fails. After the end, that match key fails the Gate again. What the alert shows: it is emitted on the Buyer's interval and names the Application, the Standard, and the end date. Alert channel (email, panel, or otherwise): **ABSENT.** Failure: "A Builder cannot accept their own Deviation." UJ-4 climax: either the Gate passes, or an Accepted deviation is on record and the alert interval starts. Resolution: "The repository commit is the one Ana pushed. Domain Harness has not edited it." Plan: Team, on the paid wall. "Accepted deviations ship with the CI Gate in the first cut." Batch acceptance of a Standard change is a separate, later capability (FR-18).

16. **Impact analysis (FR-16).** Actor: Standard owner publishes; Buyer reads. Publishing a Standard version produces an Impact analysis for Applications bound to the affected Projects. The analysis lists each affected Application, the Adherence delta, and each Accepted deviation the new version invalidates. "The Buyer can read the analysis before the version becomes the version in force, and can choose to publish anyway." UJ-5 says she publishes, then the panel shows which Applications fall out of Adherence and which Accepted deviations the change touches. Both sentences are in the PRD; it does not reconcile publish-then-show with read-before-in-force. Plan: Business. Outside the first cut (§13.2), except where a new version simply becomes the version in force (FR-1).

17. **Acceptance to keep passing (FR-17).** Actor: Buyer records acceptance; Standard owner requested it (UJ-5). An affected Application keeps passing the Gate on the new version only after a recorded acceptance. Without acceptance, the next Gate run evaluates the new version and fails on each new Deviation. With acceptance, those Deviations are Accepted deviations tied to the version change. Revoking the acceptance makes the next Gate run fail them again. UJ-5 resolution: applications with acceptance keep passing until the acceptance expires or is revoked. Plan: §6 names Impact analysis and batch acceptance on Business, not this sentence alone; §13.2 places FR-17 with them as out of scope for MVP ("per-change acceptance").

18. **Batch acceptance (FR-18).** Actor: Buyer. They accept one Standard change for a chosen set of Applications in one action. One action writes one acceptance record per selected Application, all citing the same Standard version. Applications left unselected do not receive an acceptance. UJ-5 edge: dozens of Applications are affected; batch acceptance exists so the change does not require one meeting per Application. The Buyer accepts in one action, or Domain Harness opens tasks in the Company's work tracker. Plan: Business. Outside the first cut.

19. **Tasks in the Company's work tracker (FR-19).** Actor: the system opens a story or task instead of suggesting code; Helena's path offers this alternative to batch acceptance. A created task links back to the Application and the Standard version. "Domain Harness does not open a pull request in the Application repository." Plan: Business. "Out of scope for the first cut: tracker connectors." First connectors, when built, are Jira and Azure DevOps.

20. **Store Guidance and Gate results on the Application (FR-20).** Actor: Buyer on the panel. Collectors send Compilations. A stored Guidance event has the Application id, the tool, the subject asked, the Standard version returned or a miss, and the agent tool name. A stored Gate run has the Application id, the revision, the Effective Standard set version, and each Deviation. What the first-cut inventory shows: groups by Project and by agent tool. "Naming individual Builders stays off until the privacy rules say otherwise." Plan: the panel that joins Guidance to Gate results is Team and on the paid wall. First cut keeps the join and the Adherence views.

21. **Adherence over time (FR-21).** Actor: Buyer. "The panel shows Adherence and the most frequent Deviations by Application, by Project, and by Module, as a time series." Adherence for an Application equals the share of checked Standards with no open Deviation on that Gate run. Changing the selected Project changes the series to Applications bound to that Project and its descendants. UJ-1 path: opens one Application and reads its Adherence, its Deviations, and whether Guidance was consulted. First cut includes these views.

22. **Demand, gaps, ignored Modules, inventory (FR-22).** Actor: Buyer; gaps are for the Standard owner (UJ-3). The panel shows which subjects are consulted, which Guidance calls missed, which Modules have no Guidance in the period, and which Projects and agent tools are building. A miss from FR-11 appears on the gap list with a count. A Module with published Standards and zero Guidance events in the period appears on the ignored list. The inventory lists Applications by Project and by agent tool. UJ-1: opens the inventory, filters by Project. First cut includes gaps, ignored Modules, and inventory.

23. **Cross-checks (FR-23).** Actor: Buyer (Vini). The panel shows Ghost applications, consulted-but-deviated, and Adherence for Applications from the New-application flow beside the baseline set. A Ghost application is listed when a Gate run exists and no Guidance event exists for that Application. Consulted-but-deviated requires a Guidance event that returned Standard S and a later Gate Deviation on S for the same Application and a revision after that event. UJ-1 climax: the panel shows Ghost applications beside Applications built through the New-application flow. Resolution: Vini can point a Standard owner at a gap or a repeated Deviation without opening the repository. First cut includes Ghost applications and consulted-but-deviated. SM-6: by month 6 the pilot Buyer has opened, from the panel, at least one consulted-but-deviated row or one Ghost application.

24. **Lineage (FR-24).** Actor: Buyer, later. The panel shows which Applications touch which Information sources, given Information sources recorded as Standards and Gate or Guidance evidence that an Application referenced one. Purpose (§8): so a Company can answer which Applications touch which Information sources for LGPD and security reviews. It is not a first-cut claim. Plan: Enterprise. "Out of scope for the first cut: the information-sources Module and this report."

25. **Split the runtime (FR-26).** Actor: Buyer. Guidance, the Gate, Standard content, and records that contain sensitive detail run in the Company environment. The panel runs in the vendor environment. A Collector sends only Compilations. What the Buyer can do: read the schema for every Compilation type before the Collector is allowed to send. Failure: "A Compilation that fails its schema is dropped, the drop is visible to the Buyer, and no partial payload is sent." First-cut Compilation fields: Application id, Project id, agent tool name, and timestamp; for Guidance, the tool name, the conflict slot, the subject asked, and the Standard id and version or a miss; for a Gate run, the revision, pass or fail, and each Deviation's match key and whether it is open or accepted. "A Compilation contains no prompt text, no Standard content, and no source code." Fields beyond this list are Open Question 5. First cut includes Collectors and Compilations.

26. **Decision agent placement (FR-27).** Actor: the Company enables it (who clicks is not named beyond "When the Company enables the Decision agent"). It runs in the vendor environment. Enabling it on the Business tier requires the zero-retention term in FR-12, including the model provider. The Enterprise tier adds a dedicated environment and a Company-wide retention commitment for panel data on top of that term. Disabling the Decision agent stops Decision response calls. Document response continues from the Company environment. Outside the first cut.

27. **Restrict Guidance records (FR-28).** Actor: Buyer. They configure which roles can read stored Guidance events. A Compilation includes no raw prompt text. Failure: "A role without the grant receives a denial on Guidance event content." Exporting a Compilation and searching it yields no field defined as prompt text. The policy text itself is Open Question 6; FR-28 is the guardrail that can be built before that text is finished. First cut includes FR-28.

28. **Provision the pilot accounts (FR-29).** Actor: operator. They provision named accounts for the Buyer, the Standard owner, and the Builder of one Company. The account record names the role used by FR-4, FR-7, FR-8, FR-15, and FR-28. Failure: "A person without a provisioned account cannot publish, accept a Deviation, or read Guidance events." SSO and SCIM are outside the first cut (Enterprise, §6). How a person authenticates beyond "Authenticated" in UJ-1 and UJ-2: **ABSENT.**

## Information architecture hints

SCREEN NAMES ABSENT. The PRD never names a screen.

Human moments and the destinations it does name:

- **Management panel**, after authentication (UJ-1 entry).
- **Inventory** on that panel. Vini opens it and filters by Project (UJ-1). The inventory lists Applications by Project and by agent tool (FR-22). The first-cut inventory groups by Project and by agent tool (FR-20).
- **One Application** inside that inventory. He reads its Adherence, its Deviations, and whether Guidance was consulted (UJ-1).
- **Time series** of Adherence and the most frequent Deviations by Application, by Project, and by Module. Changing the selected Project changes the series (FR-21).
- **Gap list** with a count (FR-22). **Ignored list** of Modules (FR-22).
- **Ghost applications**, **consulted-but-deviated** rows, and New-application-flow Adherence beside the **baseline set** (FR-23, SM-6).
- **Impact analysis** as a report the Buyer can read (FR-16, UJ-5). Outside the first cut.
- **Lineage** pairs of Applications and Information sources (FR-24). Outside the first cut. Enterprise.
- **Compilation schema** the Buyer can read before a Collector is allowed to send, and a visible drop when a payload fails (FR-26).
- **Accepted deviation** record: Buyer, justification, start, end, match key (FR-15). Recurring alert naming Application, Standard, and end date. Channel ABSENT.
- **Role grant** for who can read stored Guidance events (FR-28). The word "settings" is not used.
- **Project tree** the Buyer creates: Projects, one parent, a name for what the level means (FR-5).
- **Standard** in a Module: create, edit, publish; code-stack and design-system fields (FR-1, FR-2, FR-3).
- **New-application flow:** a description and a Project, then a repository Boilerplate (UJ-2, FR-8, FR-9). Where that description is typed (panel, agent, or elsewhere): **ABSENT.**
- **CLI** output and **CI step log** (FR-13, FR-14).
- **Agent conversation** in Claude Code or Cursor, where Guidance is consumed and a Correction instruction is pasted (UJ-3, UJ-4). That surface belongs to the agent tool.
- **Work-tracker story or task** linking back to the Application and the Standard version (FR-19). Outside the first cut.

No navigation labels, no document titles for the panel, and no settings destination are named.

## Journeys

Confirmed cast, §3.3. Five journeys. UJ-5 is outside the first cut.

### UJ-1. Vini sees what the business is building.

Actor: Vini, Buyer, a technology manager. Realizes FR-10, FR-20, FR-21, FR-23.

1. Entry state: authenticated on the management panel, after at least one Application carries a Project identification file.
2. Opens the inventory.
3. Filters by Project.
4. Opens one Application and reads its Adherence, its Deviations, and whether Guidance was consulted.

Climax: "The panel shows Applications that reached the Gate with no Guidance (Ghost applications) beside Applications built through the New-application flow."

Resolution: Vini can point a Standard owner at a gap or a repeated Deviation without opening the repository.

Failure path: "An Application published from a tool with no repository never appears. Vini's inventory is incomplete until that channel is defined (Open Question 2)."

### UJ-2. Ana starts an Application that is already placed.

Actor: Ana, Builder, a business professional. Realizes FR-7, FR-8, FR-9, FR-10.

1. Entry state: authenticated. She has permission to create an Application on a Project the Buyer has opened to her.
2. Describes what she wants.
3. Confirms the Project.
4. Receives a repository Boilerplate with the stack, the design system, the Project identification file, MCP configuration, and skills.

Climax: she opens the repository in her agent and the agent can already request Guidance for that Project.

Resolution: the Application exists for the Buyer from this moment, before any Gate run.

Failure path: Ana asks for a child Project so a Locked rule will not apply. Creation is denied. She continues on the Project she was given.

### UJ-3. Ana's agent asks for the button and gets the Standard.

Actor: Ana, mid-build, about to add a primary action on a form. Realizes FR-6, FR-11, FR-12, FR-20, FR-22. FR-12 is the paid path and is outside the first cut.

1. Entry state: agent connected to Domain Harness. The Project identification file resolves the Project.
2. The agent calls a granular tool and asks for the primary button.
3. Domain Harness returns a Document response: the component, the token, and the usage rule from the Effective Standard set.
4. In the paid Decision response path, the same ask returns only the applicable answer.

Climax: "Ana's screen uses the Company's component. She did not open a design-system site and she did not sit through a briefing at session start."

Resolution: the Guidance event is stored against the Application.

Failure path: no Standard covers the ask. The tool says so, and the miss is recorded as a gap for the Standard owner.

### UJ-4. The pipeline stops Ana, and IT may let it through.

Actor: Ana opens a pull request; the Buyer may accept. Realizes FR-13, FR-14, FR-15.

1. The Company's CI runs the Gate.
2. Entry state: the revision contains the Project identification file. The Gate can read the Effective Standard set.
3. The Gate reports Deviations. Each one includes a Correction instruction.
4. Ana pastes that instruction into her agent and pushes again, or asks the Buyer to accept the Deviation with a justification.

Climax: either the Gate passes, or an Accepted deviation is on record and the alert interval starts.

Resolution: "The repository commit is the one Ana pushed. Domain Harness has not edited it."

Failure path: "The design-system miss is visual and has no machine-checkable rule. The first-cut Gate does not invent a visual failure; Guidance still returned the Standard during construction."

### UJ-5. Helena changes a token and sees who breaks.

Actor: Helena, Standard owner of the design-system Module; the Buyer accepts. Realizes FR-1, FR-16, FR-17, FR-18, FR-19. "Outside the first cut; see §13.2."

1. Entry state: she can publish a new version of a Standard.
2. She publishes.
3. The panel shows the Impact analysis: which Applications fall out of Adherence, and which Accepted deviations the change touches.
4. She requests acceptance.
5. The Buyer accepts the change for a set of Applications in one action, or Domain Harness opens tasks in the Company's work tracker.

Climax: Helena knows the cost of the change before those Applications start failing the Gate without warning.

Resolution: Applications without acceptance fail the Gate on the new version. Applications with acceptance keep passing until the acceptance expires or is revoked.

Failure path / scale: dozens of Applications are affected. Batch acceptance exists so Helena's change does not require one meeting per Application.

## States and edge cases

Empty:

- "A description with no Project is not created" (FR-8).
- "A Module with no owner cannot be published" (FR-4).
- A Module with published Standards and zero Guidance events in the period appears on the ignored list (FR-22).
- Ghost application: a Gate run exists and no Guidance event exists for that Application (FR-23). UJ-1 shows these beside New-application-flow Applications.
- Inventory incomplete: an Application published from a tool with no repository never appears (UJ-1).
- When the Correction instruction text is empty, the Gate fills one sentence from the status, the conflict slot, and the approved entry in the same slot when one exists (§4).

Error and refusal:

- Missing or unreadable Project identification file: Guidance refuses to answer with another Project's Standards; the Gate fails with an explicit "unbound Application" result rather than a silent pass (FR-10). NFR-5: "A missing Project identification file is a failed Gate, not an empty success."
- A second repository that presents an Application id already bound to another repository is refused by Guidance and by the Gate (FR-10).
- A cycle in the Project tree is rejected (FR-5).
- Explicit miss when no Standard applies (FR-11). A Decision response miss does not invent a Standard (FR-12).
- A Compilation that fails its schema is dropped, the drop is visible to the Buyer, and no partial payload is sent (FR-26, NFR-2).
- CLI exit non-zero when a Deviation is open (FR-13). CI step fails the pipeline in that case (FR-14).
- The first-cut Gate does not invent a visual failure for a design-system miss that has no machine-checkable rule (UJ-4).

Permission:

- Two Companies cannot see each other's Projects (FR-5). NFR-4: a Company's Standards, Projects, Applications, and Compilations are unreadable by another Company.
- Builder without child-creation permission: denial, and no Project is created (FR-7).
- Builder who is not the Standard owner cannot publish (FR-4).
- Builder cannot accept their own Deviation (FR-15).
- A person without a provisioned account cannot publish, accept a Deviation, or read Guidance events (FR-29).
- A role without the Guidance-record grant receives a denial on Guidance event content (FR-28).

Offline: **ABSENT.**

Loading: **ABSENT.** "Latency budgets, panel availability, and a recovery-time objective are unset" (§7, Open Question 8).

Conflict:

- Standards compete only on a shared conflict slot (FR-6, §4). Parent/child library X examples are in FR-6.
- An in-flight Gate run keeps the version it resolved at start (FR-1). NFR-3: Guidance and the Gate do not mix fields from two versions of the same Standard in one response or one run.
- Risk, not a specified screen: if a Decision response and a later Gate run disagree, the Buyer loses trust (§5.5 note). The Decision agent stays out of the first cut. Open Question 3 includes "the disagreement path when a Builder challenges a Decision response."

Quota and plan-limit:

- Community: one Project; Standard registration, Document response, CLI Gate (§6).
- Team: up to 25 Active governed Applications. Includes Project tree, Locked rules, CI Gate, Accepted deviations, and the join panel.
- Business: up to 100 Active governed Applications. Adds Decision agent, zero-retention term, Impact analysis, batch acceptance, work-tracker tasks.
- Enterprise: Lineage, SSO/SCIM, dedicated environment, Company-wide retention commitment for panel data, and an SLA. No application-count band is stated for Enterprise.
- Decision response, when sold: a monthly allowance and overage billing. Numbers are in `addendum.md`, not in this PRD (§10 Cost).
- v1 does not charge per seat (§12).
- What the product does when a band is exceeded: **ABSENT.**

Audit and proof:

- Accepted deviation stores the Buyer, the justification, the start, the end, and the match key (FR-15).
- Every Compilation type has a versioned schema (NFR-2). The Buyer can read it before send (FR-26).
- A Compilation contains no prompt text, no Standard content, and no source code (FR-26).
- Naming individual Builders stays off until the privacy rules say otherwise (FR-20).
- "A passing Gate is not a security certification" (§10). The Gate reports Adherence to the Standards the Company published (§8).

## Voice, brand, visual, motion, i18n, accessibility

- **Voice:** ABSENT. No tone, copy deck, or message style. The only language constraint is terminology: "Use these terms exactly" (§4).
- **Brand:** The product name is a working title. "Domain Harness — the product. Working name. A separate company, funded by Levva, operates it. The legal name is undecided." Open Question 1 is the legal name of the company and the product name. No logo, color, or brand voice is stated.
- **Visual:** ABSENT for Domain Harness's own visual identity. Related product facts, which are about the Company's design system, not this product's look: the design-system Module records components, tokens, and usage rules (FR-3); "The first-cut Gate does not score visual fidelity"; "The design-system miss is visual and has no machine-checkable rule. The first-cut Gate does not invent a visual failure" (UJ-4). Domain Harness does not author design systems or component libraries (§12).
- **Motion:** ABSENT.
- **i18n:** ABSENT as a UI locale or translation requirement. The glossary notes that source documents say *padrão*, *projeto*, and *gate*. Geography is open (§0; Open Question 9 points at `addendum.md`, not read).
- **Accessibility:** ABSENT as a requirement on Domain Harness's own UI. The PRD says a passing Gate does not certify accessibility (§12). That is a non-goal about customer Applications, not a commitment about this product's interface.

## Non-goals and constraints

Non-goals (§12), verbatim in substance:

- Domain Harness is not a coding agent and does not edit a Company's repository or open pull requests.
- Domain Harness does not install vendor-specific hooks, and it does not require a briefing at session start or a review before the agent finishes.
- A passing Gate does not certify security, accessibility, or legal compliance.
- Domain Harness does not author design systems, component libraries, or data catalogs.
- Domain Harness does not decide what a level in the Project tree means.
- v1 does not charge per seat.
- v1 does not scan Applications for OWASP classes. That remains with the Company's security tools.
- The first cut does not include the Decision agent, Impact analysis, batch acceptance, lineage, work-tracker tasks, SSO/SCIM, or Modules other than code stack and design system.

Also out of the first cut (§13.2): per-change acceptance (FR-17); Modules for domains and entities, information sources, brand, and general (information sources are the next Module after the first cut); dedicated environment; SLA; Lovable and other tools without a repository the Gate can see; origin sync from Figma and other source systems. Decision response's agreement metric (SM-4) ships with FR-12, not with the first cut.

First cut in scope (§13.1), the Team-shaped pilot: code-stack and design-system Modules with owners and versions; Project tree with precedence, Locked rules, and child-creation permission; New-application flow and Boilerplate for Claude Code and Cursor; Project identification file; Document response; CLI Gate and CI Gate, including Accepted deviations and recurring alerts; Collectors, Compilations, and panel views for Adherence, frequent Deviations, gaps, ignored Modules, inventory, Ghost applications, and consulted-but-deviated; read API. The design-system Gate is limited to machine-checkable rules.

Hard constraints that shape what a person can see or trust:

- The Company owns the Standards (§1). Sensitive content stays in the Company environment (§5.10). Standard content, Gate logs that quote code, and Guidance records stay in the Company environment (§8). The vendor environment holds the panel and the Compilations the schema allows.
- The operator is accountable for serving the Effective Standard set it was given and for a Gate result that matches that set (§1). Contractual extent is Open Question 4 and is "not a product behavior" (§10 Liability; legal workstream in `addendum.md`, not read).
- "Domain Harness does not certify security and does not replace the Company's obligations under LGPD or sector rules" (§8).
- Neutrality (§10): a capability that requires a hook proprietary to one agent vendor is out of product scope.
- Privacy (§10): recording what Builders ask agents is sensitive. Compilations do not carry raw prompts (FR-28). Zero retention applies to Decision-agent traffic when that path is enabled (FR-12, FR-27).
- Deterministic check (NFR-1): for a fixed revision and a fixed set of published versions, the CLI Gate and the CI Gate return the same Deviations.
- No silent pass (NFR-5).
- Tenant isolation (NFR-4).
- Publication stays in the registry. The read API cannot write in v1 (FR-25).
- Skills in the Boilerplate are not a vendor hook (FR-9).
- Keeping Modules current via sync from Figma, repositories, and data catalogs is a later integration. The first-cut requirement is the registry and the owner (FR-4 note). The registry must be complete enough that a maintenance engagement can update a Module without a product change (§6).
- Snyk, Semgrep, and Sonar remain complementary scanners. Domain Harness does not ingest their findings in v1 (§9).
- Do not optimize the counter-metrics (§14): SM-C1, share of Project-tree Applications that reach a production deploy with no Gate run; SM-C2, share of Deviations that become Accepted deviations; SM-C3, Guidance events per Application. "Do not maximize. A briefing-sized context dump would inflate this number and violate FR-11."
- Open Question 10 (build, adopt, or contribute the registry and Document response) "changes the implementation source. It does not remove FR-1, FR-2, FR-3, or FR-11 from the first cut." See the note on FR-12 and `addendum.md` (not read). Packmind is named there as already distributing standards to many agents over MCP.

## Open product questions

From §15, plus in-line opens. Included only where a different answer would change what people see, name, or are allowed to do. Questions the PRD says are not product behavior are marked that way.

1. **Name.** Legal name of the company and product name. Domain Harness is the working title. Changes the product name people see.
2. **Tools without a repository.** How an Application built in Lovable, or a similar host, gets a Project, Guidance, and a Gate result. The read API is the likely feed. A Collector that reads a synced git repository is a candidate, not a decision. Until then, Vini's inventory is incomplete (UJ-1). Repository-less building stays outside SM-C1 until this has a channel.
3. **Decision-agent quality operations.** Per-Company evaluations signed by Standard owners, the disagreement path when a Builder challenges a Decision response, and the numeric bar for SM-4. The disagreement path is undescribed. Decision response itself is outside the first cut.
4. **Contractual liability.** How far responsibility extends when an Application that passed the Gate later has a security failure. The PRD states this is a legal workstream and "not a product behavior" (§10). The product statement already fixed for UX copy: a passing Gate is not a security certification.
5. **Compilation fields beyond the first cut.** Any further field needs a security review before it is added. Changes what the panel and the Buyer can see in Compilations.
6. **Privacy policy.** What Guidance stores beyond the fields in FR-20, and which roles see it, as a Company-facing policy rather than only an access-control setting. FR-28 can ship before this text. Changes who sees Guidance records and what those records contain.
7. **Sales story.** Resolved 2026-10-09. The first sale is proof: Adherence (SM-1) and the join of Guidance to Gate results. Time-to-approval is a later story, shown only after the Company records an approval timestamp, and it is not a first-cut metric. Approval timestamps are not a first-cut surface.
8. **Service levels.** Latency for Document response, panel availability, and recovery objectives. Required before an enterprise SLA is signed, not before the pilot. Loading and availability expectations for the panel are unset.
9. **Board recommendations still open.** Brazil-first and a year-3 path to the US, and the NewCo selling software while Levva sells services. They are in `addendum.md` (not read). The charging unit is decided: Active governed Application. Geography could affect locale later; this PRD does not state a UI language.
10. **Implementation source of the registry.** Build, adopt, or contribute the registry and Document response. Decided before implementation starts. The capabilities remain in the first cut. The PRD does not say the human steps change.

Also open inside a requirement, not numbered in §15: "Copilot's Boilerplate shape remains an open configuration case" (FR-9).

§0 says the user confirmed the fast-path inferences on 2026-10-09 and none of those inferences remain open. §16 Assumptions Index: "None open." The commercial line in §6 stands as requirements. The opens above are the ones §15 still lists.

## Requirement index

Journeys (§3.3 Key User Journeys):

- UJ-1. Vini sees what the business is building.
- UJ-2. Ana starts an Application that is already placed.
- UJ-3. Ana's agent asks for the button and gets the Standard.
- UJ-4. The pipeline stops Ana, and IT may let it through.
- UJ-5. Helena changes a token and sees who breaks.

Features and functional requirements (§5 Features):

- §5.1 Standard Registry — FR-1 Publish a versioned Standard; FR-2 Code-stack Module; FR-3 Design-system Module; FR-4 One Standard owner per Module. Realizes UJ-5.
- §5.2 Project Tree — FR-5 Shape the Project tree; FR-6 Precedence and Locked rules; FR-7 Permission to create a child Project. Realizes UJ-2.
- §5.3 New-Application Flow — FR-8 Place a new Application; FR-9 Generate a Boilerplate. Realizes UJ-2.
- §5.4 Project Identification — FR-10 Project identification file is the join key. Realizes UJ-1, UJ-2, UJ-3, UJ-4.
- §5.5 Guidance — FR-11 Document response over MCP; FR-12 Decision response. Realizes UJ-3.
- §5.6 Gate — FR-13 CLI Gate; FR-14 CI Gate; FR-15 Accepted deviation. Realizes UJ-4.
- §5.7 Standard Change — FR-16 Impact analysis; FR-17 Acceptance to keep passing; FR-18 Batch acceptance; FR-19 Tasks in the Company's work tracker. Realizes UJ-5. Outside the first cut except FR-1's version-in-force behavior.
- §5.8 Intelligence — FR-20 Store Guidance and Gate results on the Application; FR-21 Adherence over time; FR-22 Demand, gaps, ignored Modules, inventory; FR-23 Cross-checks; FR-24 Lineage. Realizes UJ-1. FR-24 is outside the first cut.
- §5.9 Standards API — FR-25 Read API.
- §5.10 Deployment Boundary — FR-26 Split the runtime; FR-27 Decision agent placement.
- §5.11 Access — FR-29 Provision the pilot accounts; FR-28 Restrict Guidance records.

Cross-cutting NFRs (§7):

- NFR-1 Deterministic check.
- NFR-2 Auditable boundary.
- NFR-3 Version integrity.
- NFR-4 Tenant isolation.
- NFR-5 No silent pass.

Plans (§6 Monetization):

- Community (free).
- Team (first sale).
- Business.
- Enterprise.

Success metrics (§14 Success Metrics):

- SM-1 Adherence lift.
- SM-2 Active governed Applications.
- SM-3 Ghost applications as a share of Applications with a Gate run.
- SM-4 Decision-response agreement with the later Gate. Target unset. Ships with FR-12.
- SM-5 Pilot commercial gate. Not a product behavior. Detail in `addendum.md` (not read).
- SM-6 Buyer opens a consulted-but-deviated row or a Ghost application from the panel.
- SM-7 A pilot Gate run shows a Locked rule overriding a descendant Standard.
- SM-C1 Production deploy with no Gate run.
- SM-C2 Share of Deviations that become Accepted deviations.
- SM-C3 Guidance events per Application.

MVP headings (§13): §13.1 In Scope; §13.2 Out of Scope for MVP.
