# Validation Report — domain harness

- **DESIGN.md:** `_bmad-output/planning-artifacts/ux-designs/ux-domain harness-2026-10-09/DESIGN.md`
- **EXPERIENCE.md:** `_bmad-output/planning-artifacts/ux-designs/ux-domain harness-2026-10-09/EXPERIENCE.md`
- **Run at:** 2026-10-09T15:52-0300

## Overall verdict

The pair is a behavioral contract a story can implement, and it is not a visual contract. Every user journey and every functional requirement is named under Key Flows, component behavior is specific, and the experience sections are in the required order. Color, type, radius, spacing, and component visuals are empty on purpose, and the rubric treats missing hex as critical, so implementation must not mirror a palette from this draft. A few load-bearing paths still force a consumer to invent the step that reaches the climax, the Read API flow, or which publish order is in force.

The accessibility review shifts that picture. A builder cannot meet WCAG 2.2 AA from these spines: contrast has no pairs to measure, and below 768px publish and accept are withheld. Keyboard operation of those actions, several error texts, and a missed Accepted-deviation alert are unspecified, so the AA assumption is not yet a contract a builder can implement.

## Category verdicts

- Flow coverage — adequate
- Token completeness — broken
- Component coverage — thin
- State coverage — adequate
- Visual reference coverage — strong
- Bloat & overspecification — adequate
- Inheritance discipline — adequate
- Shape fit — strong
- Accessibility review — thin

## Findings by severity

### Critical (3)

**[Token completeness]** — Color tokens have no hex (DESIGN.md frontmatter)
`colors`, `typography`, `rounded`, `spacing`, and `components` are empty. No contrast ratio is stated for text on surface, denial, plan-refusal, or adherence-series.
Fix: When a brand exists, add hex, type roles, radii, a spacing scale, component token maps, and contrast targets. Do not invent values in implementation while this file stays draft.

**[Accessibility]** — Contrast targets cannot be verified (DESIGN.md Colors; EXPERIENCE.md Accessibility Floor)
WCAG 1.4.3 and 1.4.11 have no pairs to measure. The floor assumes AA and places contrast in an empty DESIGN.md.
Fix: Before AA can be claimed, name foreground and background pairs and state the AA ratios (4.5:1 text, 3:1 large text and non-text). Leave the brand values unset until that decision.

**[Accessibility]** — Publish and accept are withheld below 768px (EXPERIENCE.md Responsive & Platform)
WCAG 1.4.10 requires the same functionality at 320 CSS pixels. Zoom at 200% and 400% lands below 768px.
Fix: Keep publish, accept, filter, and sign-in available at 320 CSS pixels, stacked, with vertical scroll. Allow two-dimensional scroll only for evidence tables and the adherence plot. Remove the wider-window gate.

### High (9)

**[Flow coverage]** — UJ-1 never steps onto the climax (EXPERIENCE.md UJ-1)
The numbered steps open Inventory, filter, and one Application. The climax is Cross-checks.
Fix: Add numbered steps that open Cross-checks, Adherence, and Gaps, and put the climax on the step that arrives there.

**[Flow coverage]** — FR-25 is not a Key Flow (EXPERIENCE.md FR-25)
No protagonist, no numbered steps, no climax, no failure path.
Fix: Name the Company system as the protagonist, number the read, mark the matching Effective Standard set as the climax, and add a failure for missing credentials and for a write.

**[Flow coverage]** — UJ-5 states both publish orders and then follows only one (EXPERIENCE.md UJ-5)
The Buyer's read-before-in-force choice is not a step.
Fix: Number both sequences, including publish-anyway, and keep them unreconciled.

**[Flow coverage]** — The operator is excluded and then used (EXPERIENCE.md Foundation, FR-29)
Foundation says the operator is not a journey protagonist. FR-29 uses the operator as protagonist.
Fix: Keep the operator as the FR-29 protagonist and delete the exclusion.

**[Component coverage]** — Every visual spec is unset (DESIGN.md Components)
None states anatomy, color, size, or state appearance.
Fix: After tokens exist, give each component those four visual rules. Leave the rows unset until then.

**[Accessibility]** — Pointer-first leaves the primary actions without a keyboard path (EXPERIENCE.md Interaction Primitives)
Tab order and Esc are specified. Publish, accept, filter, sign-in, and row activation have no keyboard equivalent. Focus movement and a visible focus indicator are unspecified.
Fix: Give every pointer action a keyboard equivalent. Move focus into the form, return it on Esc, never trap it, and require a visible focus indicator.

**[Accessibility]** — Four failures are not identified in text (EXPERIENCE.md State Patterns)
A cycle, a description with no Project, a compilation-drop, and unbound Application lack identification and recovery.
Fix: Name the object, state what happened in glossary terms, and state the recovery in one sentence. Announce compilation-drop.

**[Accessibility]** — A missed Accepted-deviation alert is not perceivable (EXPERIENCE.md acceptance-form)
Nothing says the alert remains until the Buyer perceives it, or that the end date stays visible.
Fix: Show the end date and the alert interval for the life of the record. Keep the alert until the Buyer dismisses it or the end date passes.

**[Accessibility]** — Host strings omit failures that are not a Deviation (EXPERIENCE.md CLI Gate, CI Gate, Agent Guidance)
unbound Application, a missing Project identification file, and a duplicate Application id can fail without a required sentence.
Fix: Require a text sentence for those failures and for a run that did not complete. Keep miss as the word miss, with the asked-for subject.

### Medium (18)

**[Flow coverage]** — FR-27 leaves the click-owner unset (EXPERIENCE.md FR-27)
Fix: Keep the unset label so a story does not invent a button owner.

**[Flow coverage]** — The CLI Gate is only a resolution on the CI journey (EXPERIENCE.md UJ-4)
Fix: Give the CLI Gate its own numbered flow.

**[Flow coverage]** — UJ-5's failure path restates the scale problem (EXPERIENCE.md UJ-5)
Fix: State the failed outcome, including plan-refusal.

**[Component coverage]** — sign-in names no fields or failure (EXPERIENCE.md sign-in)
Fix: Specify the failure message and the landing surface. Keep the mechanism unset.

**[Component coverage]** — The Accepted-deviation alert has no component (EXPERIENCE.md acceptance-form)
Fix: Add an alert component in both spines.

**[State coverage]** — Evidence surfaces have no failed fetch (EXPERIENCE.md State Patterns)
Fix: Keep the structure, say the Compilation did not arrive, and queue no write.

**[State coverage]** — Gaps and Guidance access misuse empty and failure (EXPERIENCE.md State Patterns)
Fix: Give Gaps a real error or drop Failure. Give Guidance access an empty state for no grant configured.

**[State coverage]** — sign-in is not a surface (EXPERIENCE.md Information Architecture)
Fix: Add a sign-in surface with failed attempt and unprovisioned account.

**[State coverage]** — Three forms omit invalid submit (EXPERIENCE.md Standards, New-application flow, Accepted deviation)
Fix: Add an invalid-submit state per form.

**[State coverage]** — Hosts have no state when the Effective Standard set cannot be read (EXPERIENCE.md CLI Gate, CI Gate, Agent Guidance)
Fix: State the host text and the exit or tool result.

**[Bloat & overspecification]** — Four rules are restated in several sections (EXPERIENCE.md)
Fix: Keep one full statement and point the other sections at it.

**[Bloat & overspecification]** — Four component cells are prose a table would extract (EXPERIENCE.md)
Fix: Break each into fields, rules, and the one assumption.

**[Inheritance discipline]** — The term list is not the PRD glossary (EXPERIENCE.md Voice and Tone)
Fix: Use the PRD glossary verbatim in both spines, and keep microcopy terms in a separate list.

**[Inheritance discipline]** — join panel is not a glossary term (EXPERIENCE.md State Patterns)
Fix: Name the panel that joins Guidance to Gate results.

**[Accessibility]** — Target size is unspecified (DESIGN.md Layout & Spacing)
Fix: State a minimum of 24 CSS pixels, or the WCAG 2.2 spacing exception, for every pointer target.

**[Accessibility]** — Page language is not required in the accessibility tree (EXPERIENCE.md Voice and Tone)
Fix: Require the panel's programmatic language to be English. Identify an authored field that is in another language.

**[Accessibility]** — Motion can flash or run without a pause (EXPERIENCE.md Accessibility Floor)
Fix: Forbid flashing more than three times in one second. Provide pause, stop, or hide when motion lasts more than five seconds.

**[Accessibility]** — Name, role, and value stop short of the plot, the tree, and the drop (EXPERIENCE.md Accessibility Floor)
Fix: Name the announcement role. Require a text alternative for the plot, tree semantics, row names, and header cells.

### Low (2)

**[Bloat & overspecification]** — Brand & Style restates the vision (DESIGN.md Brand & Style)
Fix: Leave the glossary sentence and the unset-token decision.

**[Inheritance discipline]** — FR headings and Module names drift (EXPERIENCE.md Key Flows)
Fix: Use the PRD's `FR-N:` titles and the hyphenated Module names.

## Reviewer files

- `review-rubric.md`
- `review-accessibility.md`
