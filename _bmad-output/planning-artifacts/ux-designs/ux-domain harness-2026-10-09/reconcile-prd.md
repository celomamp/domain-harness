# Reconcile — prd.md

The draft was corrected after this pass. Agent Guidance is any MCP client. Descendant scoping stays on Adherence. Gap and ignored rows do not drill in. Plan refusal stays on the panel. Builder names are attributed to FR-20. A cycle is rejected, with no extra save rule. Pointer-first is tagged. Visual posture that the PRD does not state was removed from DESIGN.md. The consumer-stakes line now names the user's stake and the Company as the customer. Dropped user-visible rules that were folded back: Ana is not asked to configure MCP, the Buyer grants child-Project permission, consulted subjects, the baseline-set definition, the Decision-response usage example, the three-artifact tool rule, the Project identification file, the read API returning the same Effective Standard set, the 25 and 100 Application bands, LGPD, tool-description quality, non-users, scanner findings, and Levva services.

## Kept

- Journeys: UJ-1 through UJ-5 keep Vini, Ana, and Helena, the entry, path, climax, and failure of each, with UJ-5 outside the first cut and its two publish sentences left unreconciled.
- Plan wall: Community is Standards an agent can read (registration, Document response, CLI Gate, one Project); the paid wall is the Project tree, the Locked rule, a named Accepted deviation, and the join of Guidance to a later Deviation; Decision response sits on Business.
- Non-goals: Domain Harness does not edit the repository, open a pull request, install a vendor hook, or require a session briefing; a passing Gate is not a security, accessibility, or legal certification; it does not author a design system, component library, or data catalog; it does not assign a meaning to a tree level; v1 does not charge per seat; v1 does not scan for OWASP classes.
- First cut: the Team-shaped pilot is code stack and design system with owners and versions, the Project tree with Locked rules, the New-application flow and Boilerplate for Claude Code and Cursor, Document response, both Gates with Accepted deviations, Compilations, and the panel evidence views. Decision response, Impact analysis, batch acceptance, lineage, work-tracker tasks, and SSO/SCIM stay outside that cut.

## Dropped

- "has no interest in learning MCP by hand" — §3.3 UJ-2. Ana is named; the spine never says the flow must not ask her to configure MCP.
- "Companies with no pipeline and no governance practice" and "A person building only for themselves, with no Company Standards to record" — §3.2. The scanner and design-system-author non-users are in the spines.
- "a hidden file at the repository root" that "carries the Application id and the Project id"; Guidance, the Gate, and Collectors "resolve the Project from that file and from nowhere else"; "The file carries an Application id minted when the Application is created" — §4, FR-10.
- "Creating a child Project requires a permission the Buyer grants" — FR-7. The denial and the inherited Locked rule are present. No grant action is.
- "The quality of the tool descriptions is part of the product" — §5.5. "Each description states that decision and those inputs" — FR-11. The tool names and inputs are present.
- "a short usage example" — FR-12. Decision response is specified as the applicable answer and a cited Standard version.
- "answering from knowledge that is not a published Standard" — FR-12. The spines say a miss does not invent a Standard.
- "A tool that reads the same three artifacts is in scope once its configuration shape is known" — FR-9. Copilot stays listed as an open. This wider rule does not.
- "which subjects are consulted" — FR-22. Gaps record misses. The demand list of consulted subjects does not appear.
- "The baseline set is Applications that run the Gate and were not created by the New-application flow" — FR-23. The term is used. The definition is not.
- "The API returns the same Effective Standard set that Guidance would return for that Project at that time" — FR-25. "including tools that never run the Gate" — §5.9.
- Module kinds "domains and entities, information sources, brand, general" — §4. "Other kinds exist so later Modules land in the same registry" — §5.1. "Information sources are the next Module after the first cut, because that is where the risk sits" — §13.2. An Information source includes "the purpose that use is allowed for" — §4. The spines say other Modules and the information-sources Module wait.
- "Domain Harness does not ingest their findings in v1" — §9, Snyk, Semgrep, and Sonar. The OWASP non-goal is present.
- "Origin sync from Figma and other source systems" — §13.2. FR-4 note: sync from Figma, repositories, and data catalogs is a later integration. The first cut is the registry and the owner.
- "Up to 25 Active governed Applications" on Team and "Up to 100" on Business — §6. Enterprise states no band. Glossary: an Active governed Application "has a Project identification file and, in the period being counted, a Gate run or a Guidance event." The spines leave only the exceeded-band case open.
- "Time-to-approval is a later story … shown only after the Company records an approval timestamp, and it is not a first-cut metric" — §15 Open Question 7.
- "A rising rate means Standards are stale or the Gate is blocking work the Buyer does not want blocked" — §14 SM-C2. The briefing-dump counter-metric is present. This reading of Accepted deviations is not.
- "Per-Company evaluations signed by Standard owners" — §15 Open Question 3. The disagreement path is left open. The signed evaluations are not mentioned.
- "They are not features of this PRD" — §6, Levva services (playbook, diagnostic, implementation, ongoing maintenance).
- "does not replace the Company's obligations under LGPD or sector rules" — §8. The spines say a passing Gate is not a certification, and Lineage is not a certification.

## Contradictions

- Agent Guidance is "a tool response inside Claude Code or Cursor" (Foundation, Information Architecture, Interaction Primitives). FR-9 limits those two products to first-cut Boilerplate targets. FR-11: "The same tools serve any MCP client." §1: "The same Standard is served to any MCP-compatible agent." No `[ASSUMPTION]` tag.
- `project-filter` applies to Inventory, Gaps, Ignored Modules, and Cross-checks, and "Lists and adherence-series then show Applications bound to that Project and its descendants." FR-21 gives descendant scoping to the Adherence series only. UJ-1 filters Inventory by Project and does not mention descendants. An ignored Module is a Module with zero Guidance events, not an Application on a descendant Project. No `[ASSUMPTION]` tag.
- "Activating an application-row, a cross-check-row, a gap-row, or an ignored-module-row opens that record." Opening an Application is UJ-1. Opening a consulted-but-deviated row or a Ghost application is SM-6. A gap row and an ignored-module row have no drill-in in the PRD. No `[ASSUMPTION]` tag.
- On Community, the CI step "is a plan-refusal that names Team." On a plan below Business, Decision response "is a plan-refusal that names Business." The tagged plan-refusal assumption is scoped to "Any panel surface." The spine calls the CI Gate and Agent Guidance hosts, not panel pages. The PRD says the CI Gate is paid (FR-14) and Decision response is Business (FR-12, §6). It does not say the pipeline log or the MCP response names the plan.
- "Naming an individual Builder" is banned "from the non-goals." §12 does not list that ban. FR-20: "Naming individual Builders stays off until the privacy rules say otherwise."
- A cycle is rejected "and that parent is not saved." FR-5 says only "A cycle is rejected."
- "Pointer-first panel." The PRD names no input modality. The responsive-web assumption does not state pointer-first. No `[ASSUMPTION]` tag on this primitive.
- DESIGN.md Brand & Style: the panel "does not look like a … habit app." Do's and Don'ts: "Decorate Adherence as a score celebration" and "Put evidence before chrome." The PRD states no visual posture. These lines have no `[ASSUMPTION]` tag. The coding-agent and certification lines match §12.
- `[ASSUMPTION]` "Stakes are consumer." The tag misstates the audience. The customer is a Company (§1, §3.1). "A person building only for themselves" is a non-user (§3.2). The same assumption correctly says the PRD states no accessibility requirement.

## Coverage

All five journeys and all twenty-nine functional requirements appear in EXPERIENCE.md. None are missing.

- UJ-1 present
- UJ-2 present
- UJ-3 present
- UJ-4 present
- UJ-5 present
- FR-1 present
- FR-2 present
- FR-3 present
- FR-4 present
- FR-5 present
- FR-6 present
- FR-7 present
- FR-8 present
- FR-9 present
- FR-10 present
- FR-11 present
- FR-12 present
- FR-13 present
- FR-14 present
- FR-15 present
- FR-16 present
- FR-17 present
- FR-18 present
- FR-19 present
- FR-20 present
- FR-21 present
- FR-22 present
- FR-23 present
- FR-24 present
- FR-25 present
- FR-26 present
- FR-27 present
- FR-28 present
- FR-29 present
