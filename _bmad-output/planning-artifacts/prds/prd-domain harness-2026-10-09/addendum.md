---
title: Domain Harness — PRD addendum
status: final
created: 2026-10-09
updated: 2026-10-09
---

# Addendum: Domain Harness

Material that informed the PRD and does not belong in its requirement narrative. The PRD is `prd.md`. Sources are `docs/harness-de-dominio.md` and `docs/harness-de-dominio-analise-executiva.md`.

## Rejected mechanisms

Recorded so architecture and UX do not reopen them.

| Option | Decision | Why |
| --- | --- | --- |
| Push Standards into each vendor through that vendor's hooks | Rejected | Breaks neutrality. One Company would maintain a different channel per agent. |
| Mandatory briefing at session start | Rejected | Spends tokens on every session whether or not a decision needs a Standard. |
| Mandatory review before the agent finishes a turn | Rejected | Becomes a quality gate the Builder experiences as friction. The CI Gate is the check. |
| Domain Harness opens a pull request or edits the repository | Rejected | The Company keeps authorship. A Deviation carries a Correction instruction, or a later release opens a task in the Company's tracker. |
| Seat-based price | Rejected, 2026-10-09 | The unit of charge is the Active governed Application. Decided in PRD §6. |
| Lead the product promise with only "system of record and proof" | Rejected by the user during vision coaching | The promise includes recording, delivering at decision time, checking before production, and showing the join. The positioning sentence still opens the vision. |

## What not to claim

A web check on 9 October 2026, read against the executive analysis:

Already shipping, so not a Domain Harness novelty: MCP itself and the public MCP registry; organization and team instructions (GitHub Copilot organization instructions GA 2 April 2026; Cursor team rules; Claude organization skills); design-system MCP servers (Figma, Storybook, zeroheight, Knapsack, Supernova); pull-request review against team standards (Tessl, August 2026); scorecards and time-bounded exemptions (Cortex exemptions; Port modeled waivers); CI, SAST, and quality gates (Snyk, Semgrep, Sonar, including Sonar's agentic quality gate); distribution of standards to many agents (Packmind).

Not found in that pass, and aligned with the executive thesis: a project tree that applies across agent vendors, with locked rules a child project cannot drop, and a join between a standard consulted on a change and a later CI finding on that same standard. Locked rules and timed exceptions do exist inside a single vendor. The PRD's claim is the cross-tool tree plus the join, stated in the vision.

Packmind is the closest implementation of the free core. The PRD note on FR-12 asks for an adopt-or-contribute decision before that core is rebuilt.

## Deployment boundary

| Runs in the Company environment | Runs in the vendor environment |
| --- | --- |
| Guidance (Document response), Gate, Standard content, sensitive records | Management panel, intelligence computed from Compilations |
| Collectors | Decision agent, only if the Company enables it, under zero retention that also binds the model provider |

Collectors are deterministic. Their output schema is fixed, versioned, and readable by the Company's security review before anything is sent. The first-cut fields are FR-26 in the PRD. Raw prompt text, Standard content, and source code are excluded by FR-26 and FR-28. Fields beyond that list are Open Question 5.

## Entitlements

Tier contents and the charging unit were confirmed on 2026-10-09. See PRD §6. The prices below are still the executive analysis's recommendation, not a requirement. Accepted deviations ship with the CI Gate (Team). The analysis had placed exceptions on Business. Batch acceptance and Impact analysis stay on Business. Zero retention of Decision-agent traffic ships with the Decision agent on Business. Enterprise adds a Company-wide retention commitment for panel data.

| Plan | Includes | Brazil price in the analysis | US price in the analysis |
| --- | --- | --- | --- |
| Community | Registry, Document response, CLI Gate, 1 Project | Free | Free |
| Team | Up to 25 Applications, Project tree, CI Gate, Adherence panel | R$ 8 thousand / month | US$ 3 thousand / month |
| Business | Up to 100 Applications, Decision agent with zero retention of that traffic, batch acceptance, Impact analysis, Jira / Azure DevOps | R$ 20 thousand / month | US$ 8 thousand / month |
| Enterprise | Unlimited Applications, lineage, SSO/SCIM, dedicated environment, Company-wide retention commitment, SLA | From R$ 40 thousand / month | From US$ 15 thousand / month |

Decision-agent token cost needs a monthly allowance plus overage so model cost does not consume software margin. Figures for that allowance are not set.

Services, sold by Levva in the recommended structure:

| Offer | Shape in the analysis | Price band in the analysis |
| --- | --- | --- |
| Playbook | How to capture and maintain Standards | Free as a lead, or R$ 30–60 thousand with a workshop |
| Diagnostic | 4 weeks: Application inventory, existing Standards, gaps | R$ 80–120 thousand |
| Implementation | 8–12 weeks: code stack, design system, Gate, tree | R$ 200–350 thousand |
| Maintenance | Module updates, gaps, Deviations | R$ 20–60 thousand / month |

## Commercial recommendations

Two board items remain open. They are Open Question 9 in the PRD.

1. Brazil first, in regulated and large sectors (financial services and benefits, insurance and health, large retail, then agriculture and industry). The analysis then stages the US: an English open-source core, a bridge through multinationals already served in Brazil, and direct US sales from year 3. It also names Europe, after the AI Act's high-risk application in August 2026, as another later market.
2. The NewCo invoices software. Levva invoices services as the preferred implementation partner. The analysis says mixing the two revenues would price the NewCo as a consultancy. Deal terms still open before incorporation are in Corporate structure notes below.

The charging unit is decided: Active governed Application (PRD §6).

The same analysis gives the Brazil sales motion (Levva presales for 18 months, a paid diagnostic as the door, conversion target above 50%), sector wedges (auditor trail, authorized information sources, brand, approval time), and unit economics (implementation covers acquisition in year one; software payback on the order of 9 to 16 months). Those figures stay in `docs/harness-de-dominio-analise-executiva.md`. Gap reports, ignored Modules, and Impact analysis are also the demand line for Levva's maintenance contract: the software is meant to feed that service pipeline. Implementation, in that source, includes proposing Standards where the Company has none.

The analysis sizes Brazil software SAM at about R$ 290 million a year and a five-year SOM of roughly R$ 10–15 million ARR, on assumptions it flags for the pilot (share of mature accounts, and ACV). The full tables, the three-year projection, and the sources stay in `docs/harness-de-dominio-analise-executiva.md`.

Ideal first account in that analysis: 1,000+ employees, a formal architecture or IT governance function, CI in use, and at least one agent tool already under contract. The buying signal named there is a manager who has already connected agents and now wants them pointed at Company Standards.

## Pilot ask

Also from the executive analysis, for the board conversation, not as a build requirement.

About R$ 1 million and 6 months, with a decision at month 3.

| Item | Amount in the analysis |
| --- | --- |
| Team of 4 for 6 months (2 engineering, 1 AI engineering and evals, 1 product/design) | R$ 840 thousand |
| Environments, model tokens, tools | R$ 60 thousand |
| NewCo formation and model contracts | R$ 90 thousand |

Gates in that recommendation: a letter of intent from the first customer before hiring; at month 3, the first cut running in that customer's environment on at least 5 real Applications; at month 6, the commercial and Adherence criteria in PRD SM-1 and SM-5.

The product definition names Ticket as the spontaneous demand and Corteva as the acceleration hypothesis. Neither is a signed design partner in these documents.

The AI-engineering seat in the ask exists to build evaluations. The PRD keeps the Decision agent out of the first cut, so that seat during the pilot is eval harness and measurement of Document response against the Gate, not a shipped Decision response. Revisit if the board wants Decision response inside the six months.

## Corporate structure notes

Unresolved before incorporation, per the executive analysis: intellectual-property assignment or license from work funded by Levva; founder vesting; conflict rules for people who sit in both companies; a shareholders' agreement that allows a later external investor; the option of a foreign holding if the US path proceeds.

Downside framed in the analysis: if the product stops, Levva keeps a presales asset (playbook, diagnostic, Gate and MCP components) and the practice of building production applications that embed AI inside a customer's Standards. The product definition states that learning as a reason to proceed even if the product does not.
