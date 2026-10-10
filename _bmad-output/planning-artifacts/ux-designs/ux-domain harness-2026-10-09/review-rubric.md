# Spine Pair Review — domain harness

## Overall verdict

The pair is a behavioral contract a story can implement, and it is not a visual contract. Every user journey and every functional requirement is named under Key Flows, component behavior is specific, and the experience sections are in the required order. Color, type, radius, spacing, and component visuals are empty on purpose, and the rubric treats missing hex as critical, so implementation must not mirror a palette from this draft. A few load-bearing paths still force a consumer to invent the step that reaches the climax, the Read API flow, or which publish order is in force.

## 1. Flow coverage — adequate

Checked the source named in frontmatter (`prd.md`): UJ-1 through UJ-5 and FR-1 through FR-29. NFRs are constraints and were not required to be journeys; NFR-1, NFR-3, NFR-4, and NFR-5 are restated inside UJ-4, standard-form, project-node, denial, and the CLI Gate row. Each UJ heading matches the PRD. Each FR appears as a Key Flow heading or a Realizes line. UJ-2, UJ-3, UJ-4, FR-2/FR-3, FR-4, FR-5, FR-24, FR-26, FR-28, and FR-29 have a named actor, numbered steps, a climax, and a failure path. FR-1's publish consequences sit inside the FR-2/FR-3 flow and standard-form, with the first-cut "version in force" assumption committed.

### Findings
- **high** UJ-1's numbered steps open Inventory, filter, and one Application. The climax is Ghost applications beside New-application-flow Applications, which is the Cross-checks surface, and the resolution sends Vini to a gap. Neither Cross-checks, Gaps, nor the Adherence time series (FR-21) is a step (`EXPERIENCE.md`, UJ-1, steps 2–4 and Climax). *Fix:* Add numbered steps that open Cross-checks and, if this journey still owns FR-21 and FR-22, Adherence and Gaps, and put the climax on the step that arrives there.
- **high** FR-25 is not a Key Flow. It states "No human protagonist," has four unnumbered sentences, and has no climax and no failure path (`EXPERIENCE.md`, FR-25 Read API). *Fix:* Name the Company system as the protagonist, number the read, mark the climax as the returned Effective Standard set matching Guidance, and add a failure for missing credentials and for a write.
- **high** UJ-5 says the two publish sentences are unreconciled, then the numbered path publishes and only afterwards shows Impact analysis. FR-16's read-before-in-force choice is not a step (`EXPERIENCE.md`, UJ-5, the two bullets and steps 2–3). The first-cut assumption on standard-form is committed; this out-of-cut flow is not. *Fix:* Split the flow into the two PRD sequences, or number the Buyer's read-before choice and what publish-anyway does.
- **high** Foundation says the operator is not a journey protagonist. FR-29 says the protagonist is the operator (`EXPERIENCE.md`, Foundation paragraph on the cast, and FR-29). *Fix:* Keep the operator as the FR-29 protagonist and delete the "not a journey protagonist" sentence, or move provisioning out of Key Flows and say who the panel protagonist is.
- **medium** FR-27 numbers the steps and has a climax and a failure path, and it leaves the click-owner unset (`EXPERIENCE.md`, FR-27, step 1). *Fix:* Name the role when the PRD names one. Until then, keep the unset label on the step so a story does not invent a button owner.
- **medium** FR-13 is a Realizes line on UJ-4. The numbered steps are the CI path. CLI exit codes, the printed Deviation, and the untouched working tree live in the resolution and the CLI Gate state row (`EXPERIENCE.md`, UJ-4 steps 1–4 and the CLI Gate state row). *Fix:* Give the CLI Gate its own numbered flow with the Builder or the pipeline as protagonist.
- **medium** UJ-5's failure path restates why batch acceptance exists. It does not say what the panel does when the report cannot be produced or the Buyer declines (`EXPERIENCE.md`, UJ-5 Failure path). *Fix:* State the failed outcome, including the plan-refusal already on the Impact analysis state row.

## 2. Token completeness — broken

Checked DESIGN.md frontmatter `colors`, `typography`, `rounded`, `spacing`, and `components`, plus every `{path.to.token}` reference in both spines. The five maps are empty objects. Prose contains no design-token paths. The only `{...}` paths are the `sources` entries. No UI system is named, and the panel is not specified as native dynamic type or an 8pt grid, so semantic platform notes do not fill the maps. Contrast targets for load-bearing pairs are absent. Empty tokens are a committed draft decision in Do's and Don'ts; the rubric still marks missing hex as critical.

### Findings
- **critical** `colors` has no hex and no light/dark pair. `typography`, `rounded`, `spacing`, and `components` are empty. Colors, Typography, Layout & Spacing, Elevation & Depth, and Shapes say a later brand decision must fill them. No contrast ratio is stated for text on surface, denial, plan-refusal, or adherence-series (`DESIGN.md` frontmatter and those sections). EXPERIENCE.md defers contrast to DESIGN.md (`Accessibility Floor`). *Fix:* When a brand exists, add hex (and dark pairs if both modes exist), type roles, radii, a spacing scale, component token maps, and contrast targets for those pairs. Do not invent values in implementation while this file stays draft.

## 3. Component coverage — thin

Extracted component names from both spines. The same 18 names appear in `DESIGN.md` Components and `EXPERIENCE.md` Component Patterns: application-row, project-filter, adherence-series, deviation-row, cross-check-row, gap-row, ignored-module-row, standard-form, project-node, boilerplate-result, correction-instruction, acceptance-form, plan-refusal, denial, compilation-drop, schema-reader, role-grant, sign-in. Behavioral cells for the evidence rows, forms, denial, and plan-refusal are real rules. Visual cells are not.

### Findings
- **high** Every DESIGN.md Components row is "Visual spec is unset." None states anatomy, color, size, or state appearance (`DESIGN.md`, Components). *Fix:* After tokens exist, give each component those four visual rules. Leave the rows unset until then, and do not invent them in code.
- **medium** sign-in's behavioral cell repeats the provisioned-account assumption. It does not say which fields exist, what a failed attempt shows, or which surface follows success (`EXPERIENCE.md`, Component Patterns, sign-in). *Fix:* Specify the fields, the failure message, and the landing surface. Keep the mechanism unset if the PRD still has no authentication scheme.
- **medium** The Accepted-deviation alert is load-bearing and has no component row. Copy and channel sit inside acceptance-form and an IA assumption ("shown on the management panel") (`EXPERIENCE.md`, Information Architecture assumption and acceptance-form). *Fix:* Add an alert component, or name the panel region that hosts it, in both spines.

## 4. State coverage — adequate

Walked all 17 Information Architecture surfaces. Panel rows state cold-load, empty, permission-denied, a failure line, plan-refusal where the plan gates the surface, and offline as no editing and no queued write. Host rows opt out of panel cold-load and offline. Focus is specified once, as Tab order and Esc, in Interaction Primitives and Accessibility Floor. CLI empty-of-findings (exit zero) and CI failure (pipeline fails when the CLI would) are present.

### Findings
- **medium** Evidence surfaces have no failed fetch. Cold-load ends when Compilation data arrives, and nothing says what the panel shows if that request errors (`EXPERIENCE.md`, State Patterns intro and Inventory through Cross-checks). *Fix:* Add one shared load-error treatment: the structure stays, the evidence region says the Compilation did not arrive, and no write is queued.
- **medium** Gaps' failure cell says the listed item is the miss, which is the successful row. Guidance access's empty cell is "no Guidance event is stored," but that surface configures role-grant (`EXPERIENCE.md`, Gaps and Guidance access state rows). *Fix:* Give Gaps an actual error, or drop Failure. Give Guidance access an empty state for no grant configured.
- **medium** sign-in is not an Information Architecture surface and has no failed-authentication or unprovisioned state. FR-29's failure is a denial on later actions (`EXPERIENCE.md`, Information Architecture table and FR-29). *Fix:* Add a sign-in surface with failed attempt and unprovisioned account, matching the sign-in component.
- **medium** Standards, New-application flow, and Accepted deviation do not say what an invalid submit shows: a Module with a conflicting slot, a missing Project, or an end before the start (`EXPERIENCE.md`, those three state rows). *Fix:* Add an invalid-submit state per form, using the denial or an inline reason already defined for that rule.
- **medium** CLI Gate, CI Gate, and Agent Guidance have no state for an unreachable Effective Standard set (`EXPERIENCE.md`, those three state rows). *Fix:* State the host text and the exit or tool result when the set cannot be read, distinct from unbound Application.

## 5. Visual reference coverage — strong

Listed the workspace. `imports/` exists and is empty. `mockups/` and `wireframes/` are absent. No spine links to those paths. No orphans and no unspecific figure references. A spines-win-on-conflict line is not required while nothing is linked.

### Findings
None.

## 6. Bloat & overspecification — adequate

DESIGN.md is short and does not pin pixels ahead of tokens. EXPERIENCE.md is decision-bearing and not decorative. The same PRD consequences are copied across Foundation, component cells, state cells, and flow resolutions. Open gaps is a consumer list, not bloat.

### Findings
- **medium** The alert assumption, the certification ban, the Project identification file, and the plan bands are each restated in several sections (`EXPERIENCE.md`, Foundation, the Information Architecture assumptions, plan-refusal, acceptance-form, UJ-4). *Fix:* Keep one full statement on the component or the flow, and point the other sections at it.
- **medium** standard-form, boilerplate-result, project-node, and plan-refusal are single prose cells a field table would extract more cleanly (`EXPERIENCE.md`, Component Patterns). *Fix:* Break each into fields, rules, and the one assumption.
- **low** DESIGN.md Brand & Style restates the PRD vision and the Adherence definition (`DESIGN.md`, Brand & Style). *Fix:* Leave the glossary sentence and the unset-token decision; drop the restatement.

## 7. Inheritance discipline — adequate

`sources` on both spines resolves to `_bmad-output/planning-artifacts/prds/prd-domain harness-2026-10-09/prd.md`. UJ-1 through UJ-5 titles match the PRD, including the period. The 18 component names match across DESIGN.md Components, EXPERIENCE.md Component Patterns, and later mentions. EXPERIENCE.md has no `{colors.*}` or other design-token paths to resolve. Packmind is an implementation note in the PRD, not a UX reference; Inspiration correctly records that no reference product was supplied.

### Findings
- **medium** The Voice and Tone term list is not the PRD glossary. It omits Company, New-application flow, Decision agent, Conflict slot, Impact analysis, Information source, and Active governed Application, and it adds miss, gap, ignored list, unbound Application, consulted-but-deviated, baseline set, and management panel. DESIGN.md has no glossary (`EXPERIENCE.md`, Voice and Tone list; `prd.md` §4 Glossary). *Fix:* Use the PRD glossary verbatim in both spines, and keep the extra microcopy terms in a separate list.
- **medium** "join panel" is the plan gate on six state rows and is not a glossary term, a surface, or a component (`EXPERIENCE.md`, Inventory through Cross-checks). *Fix:* Name the Team capability with the PRD's words (the panel that joins Guidance to Gate results), or add the term to the glossary with that definition.
- **low** FR headings drop the PRD colon (`FR-4:` versus `FR-4`). Information Architecture says "code stack" and "design system"; components also say "code-stack" and "design-system." cross-check-row says "New-application-flow" (`EXPERIENCE.md`, Key Flow headings, Standards row, cross-check-row). *Fix:* Use the PRD's `FR-N:` titles and the hyphenated Module names.

## 8. Shape fit — strong

DESIGN.md sections follow Brand & Style, Colors, Typography, Layout & Spacing, Elevation & Depth, Shapes, Components, Do's and Don'ts. EXPERIENCE.md has Foundation, Information Architecture, Voice and Tone, Component Patterns, State Patterns, Interaction Primitives, Accessibility Floor, and Key Flows. Responsive & Platform is present because the spine assumes a multi-surface, breakpointed panel. Inspiration & Anti-patterns is present because the PRD non-goals are rejects. Open gaps earns its place as the list of decisions a consumer must not invent. No default was dropped.

### Findings
None.

## Mechanical notes

Frontmatter on both spines has `name`, `status: draft`, `sources`, and `updated`. DESIGN.md also has `description` and the five token maps. Those maps are valid YAML and empty. No Mermaid. No broken design-token paths. Component kebab-case is stable across both files. Frontmatter `name` is the slug `domain harness`; prose uses Domain Harness. The operator contradiction, the glossary gap, "join panel," and the FR-title colon are the name and cross-reference issues above. `imports/` is an empty directory; nothing in the spines points at it.
