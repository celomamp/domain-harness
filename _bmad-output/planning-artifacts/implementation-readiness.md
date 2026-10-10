---
status: resolved
resolved_by: sprint-change-proposal-2026-10-10.md
gate: CONCERNS
date: 2026-10-10
decision: 'Fix before sprint planning (option B)'
inputs: [SPEC.md, prd.md, ARCHITECTURE-SPINE.md, DESIGN.md, EXPERIENCE.md, epics.md]
---

# Implementation Readiness — Domain Harness first cut

Verdict: **CONCERNS**. All first-cut FRs trace to stories, and no epic depends on a later one. The six decisions below are recorded only in story text, or nowhere. They must go into the plan documents before tracking is generated.

| # | Concern | Gap lives in | Blocks | Fix with |
|---|---|---|---|---|
| 1 | Nothing records how a Guidance call carries the Application id and a repository fingerprint (transport: header, MCP config field, …), or what the fingerprint is made of. This is security-relevant. | ARCHITECTURE-SPINE AD-19; Story 4.3 | Epic 4 | `bmad-correct-course`, which updates the architecture (new AD or AD-19 amendment) |
| 2 | Conflict: EXPERIENCE expects the panel to deny Guidance-event content, but that content never leaves the Company (AD-9). Story 6.7 resolves it with reads through the Company service and role tokens (AD-17). The UX documents do not record that resolution. | EXPERIENCE (Application, Guidance access); Story 6.7 | Epic 6 | `bmad-correct-course`, which updates EXPERIENCE and the architecture |
| 3 | The Boilerplate supports only the npm/TypeScript ecosystem. The pilot Company's stack is unconfirmed. | Story 3.3; SPEC silent | Epic 3 | `bmad-correct-course`, which updates the SPEC constraint |
| 4 | The CI Gate targets GitHub Actions first. The pilot Company's CI system is unrecorded. | Story 5.3 | Epic 5 | `bmad-correct-course`, which updates the SPEC constraint |
| 5 | The per-Project build grant (3.1, implied by FR-8) and registering an existing Application (3.5, needed for FR-23's baseline) exist only in stories. | Stories 3.1, 3.5; PRD/SPEC silent | Epics 3, 7 | `bmad-correct-course`, which updates the SPEC capabilities (CAP-3, CAP-9) |
| 6 | The sign-in method is unset (EXPERIENCE open gap). The panel homes for the Guidance endpoint URL and the staleness bound/freeze are missing from the EXPERIENCE information architecture. | EXPERIENCE open gaps and IA; Stories 1.3, 3.3, 4.1 | Epics 1, 3, 4 | `bmad-correct-course`, which updates EXPERIENCE |

After the fixes, rerun `bmad-sprint-planning`.
