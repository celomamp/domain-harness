---
title: 'Panel, kit and user-guide fixes from the staging validation (findings 5–9)'
type: 'bugfix'
created: '2026-10-21'
status: 'done'
baseline_commit: '01b01bb2111e48dfaaf32e8f197c019c826775d4'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/staging-validation-2026-10-20.md'
  - '{project-root}/docs/staging.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The staging walkthrough of the pilot guide (findings 5–9) left gaps: the guide omits the catalog-read step and the new `DH_GUIDANCE_TOKEN`; Effective standards and the Module Standards table show components as status "None"; Builders see the Buyer-only Company setup form; the kit's `CLAUDE.md`/`AGENTS.md` drop the authored Correction instruction; the Create project drawer reportedly looks semi-transparent.

**Approach:** Six small fixes in one PR (one commit each): guide §11/§12/§16 text in Portuguese; a meaningful component status label in both tables; a read-only endpoint card for non-Buyers; correction instructions carried into the Boilerplate plan and rendered under the stack line; the drawer confirmed at full size before any change. Then refresh changed screenshots, rebuild the guide HTML/PDF and mark findings 5–9 resolved.

## Boundaries & Constraints

**Always:** Panel copy in English, guide in Portuguese, in the existing voice. Renderers stay pure and deterministic; multi-line instructions collapse through `oneLine`. Keep roles, live regions and keyboard order. Unit tests updated with each change.

**Never:** Change registry authorization or the Boilerplate file list or paths. Put a real token in the guide or screenshots. Change `design-system.json` (shared, target-independent). Fix the drawer if it does not reproduce.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Prohibited with correction | `library moment`, prohibited, correction "Use date-fns…\n…" | `- library moment` then an indented `  Correction: Use date-fns… …` line (one line) | N/A |
| No correction | any entry, `correctionInstruction: null` | stack line unchanged, no extra line | N/A |
| Required/approved with correction | correction present | same indented Correction line under the item | N/A |
| Builder opens New application | role Builder or Standard owner | no URL field or Set button; read-only "Company Guidance endpoint" naming the current URL or "Not set." with "Ask the Buyer…" | endpoint unavailable → same unavailable banner |
| Buyer opens New application | role Buyer | Company setup form as today | unchanged |
| Component row | Effective set or DS Module table, component entry | Status cell reads "Governed by usage rule" (neutral badge in Effective set) | N/A |

</frozen-after-approval>

## Code Map

- `apps/registry/src/boilerplate/plan.ts` -- `StackItem` (add `correctionInstruction: string | null`), filled in `planBoilerplate` from `CodeStackEntry.correctionInstruction`.
- `apps/registry/src/boilerplate/render.ts` -- `stackLine`, `renderInstructionsMd` (required `pinned` lines, approved, prohibited); `oneLine` helper.
- `apps/registry/src/boilerplate/{plan,render}.test.ts`, `boilerplate.db.test.ts` -- fixtures with `StackItem` shapes.
- `apps/panel/src/components/project-tree.tsx` -- `PROJECT_TREE_COPY.effective.none`, `StatusBadge` (null status = component).
- `apps/panel/src/routes/module-standards.tsx` -- `designSystemCells` status cell uses `STANDARDS_COPY.none` for components; `entryStatus`.
- `apps/panel/src/routes/new-application.tsx` -- the `SectionCard "Company setup"` at the end of the page; `role` from `routes/panel-layout`; `flowDescription`.
- `apps/panel/src/components/new-application.tsx` -- `NEW_APPLICATION_COPY.endpoint`, `GuidanceEndpointForm`/`GuidanceEndpointField`; add a read-only view.
- `apps/panel/src/routes/new-application.test.tsx` (~l.453–510) -- endpoint tests that render the form for a Builder; update.
- `apps/panel/src/styles/primitives-feedback.css` / `polish.css` -- side sheet: opaque `--color-surface-raised` panel; `sheet-in` animates opacity 0→1 (a mid-animation screenshot looks translucent).
- `docs/guia-do-usuario/guia.html` §11 (`#aplicacoes`), §12 (`#acompanhar`), §16 (`#roteiro`); `build.mjs`; `apps/panel/e2e/guide.screens.ts` (shots 12, 13 show components).
- `GUIA-DO-USUARIO.pdf` -- Chromium print to A4 (commit e1b1387).

## Tasks & Acceptance

**Execution:**
- [x] `apps/registry/src/boilerplate/plan.ts`, `render.ts` + tests -- carry and render the Correction line -- fix 5.
- [x] `apps/panel/src/components/project-tree.tsx`, `routes/module-standards.tsx` + tests -- component status label -- fix 3.
- [x] `apps/panel/src/routes/new-application.tsx`, `components/new-application.tsx` + tests -- Buyer-only form, read-only card otherwise -- fix 4.
- [x] Drawer -- check at full size, light/dark, 375px -- fix 6 (fix or record "not reproduced").
- [x] `docs/guia-do-usuario/guia.html` -- §11 token paragraph (Claude Code shell profile; Cursor from GUI: `launchctl setenv` on macOS / start from a terminal), §12 catalog-read step, §16 checklists -- fixes 1, 2.
- [x] Screens, `GUIA-DO-USUARIO.html`, `GUIA-DO-USUARIO.pdf`; print check.
- [x] Validation report: findings 5–9 resolved 2026-10-21.

**Acceptance Criteria:**
- Given the VAL Project, when a Builder generates a Claude Code kit, then `CLAUDE.md` shows the moment Correction instruction.
- Given a Builder, when they open New application, then no endpoint form is shown and the current endpoint is readable.
- Given PrimaryButton, when Effective standards renders, then its Status is not "None".

## Verification

**Commands:**
- `pnpm run build && pnpm run typecheck && pnpm run lint && pnpm run boundaries` -- expected: all pass.
- `pnpm --filter @domain-harness/panel test` and `pnpm --filter @domain-harness/registry test -- boilerplate` -- expected: pass.

**Manual checks:**
- Staging after deploy: as Builder, the three acceptance criteria above.

## Implementation Notes

## Review Triage Log

| # | Layer | Finding | Verdict | Evidence | Route |
|---|-------|---------|---------|----------|-------|
| 1 | verification-gap | Non-Buyer card's loading fallback and Await errorElement untested | medium | Gap filed with evidence: no non-Buyer render uses a pending or rejected endpoint promise | patch |
| 2 | edge-case / blind | Component `correctionInstruction` dropped from CLAUDE.md/AGENTS.md; guide table claims every Standard's correction | medium | `ComponentEntry.correctionInstruction` exists (contract standards.ts); plan.ts components omit it | patch (design-system.json unchanged) |
| 3 | blind | Design-system import corrections dropped | false | `IMPORT_ENTRY_FIELDS` and `TOKEN_ENTRY_FIELDS` have no correction field | reject |
| 4 | edge-case | Legacy code-stack row without `correctionInstruction` makes `oneLine(undefined)` throw | false | validate.ts:78 always writes the key (`optionalText` → null) since Story 1.5; `isCodeStackEntry` requires it | reject |
| 5 | edge-case / blind | Missing layout role makes a Buyer fall back to the read-only card | false | panel-layout loader always returns `role` or a redirect Response; the fallback is pre-existing | reject |
| 6 | blind | Review diff omits GUIA-DO-USUARIO.html | false | Generated file excluded on purpose; rebuilt from guia.html by build.mjs | reject |
| 7 | blind | AGENTS.md correction lines only partly tested | low | AGENTS.md uses the same `renderInstructionsMd`; existing path-swap equality test covers it | reject |
| 8 | blind | "Correction:" label odd on required/approved; oneLine flattens structure; markdown injection | low | Label matches the panel's "Correction instruction"; oneLine was required by the task; injection pattern pre-existing | reject |
| 9 | blind | "Governed by usage rule" defined twice; null status assumed component; dash icon | low | Contract gives null status only to components (projects/service.ts:235); duplication follows each screen's own copy object | reject |
| 10 | blind | Module Standards assertion covers whole row (Tokens cell can be "None") | low | `not.toContain("None")` over all cells; direct fix | patch |
| 11 | blind | Buyer-doesn't-see-read-only view untested; aria-busy without live region | low | First: folded into patch 1. aria-busy mirrors existing GuidanceEndpointField | patch (first part) |
| 12 | blind | `launchctl setenv` does not survive restart; guide silent | medium | macOS launchd user env resets at login | patch |
| 13 | blind | Hardcoded "catalog 1.0.0" in guide | low | Matches today's button text; guide is regenerated per release | reject |
| 14 | blind | Staging notes lack SHAs; finding 9 only checked locally | low | Staging re-check is part of the post-deploy verification | reject |
