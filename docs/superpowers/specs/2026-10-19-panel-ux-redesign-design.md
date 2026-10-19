# Domain Harness Panel — Operational UX Redesign

**Status:** draft
**Date:** 2026-10-19
**Scope:** the management panel in `apps/panel`
**Human partner decision:** a dense, calm operational panel (Linear/Stripe feel), preserving the cream/ink/gold identity and the Sora/Poppins type system.

## 1. Intent

The panel is a faithful evidence record, but it reads like a specification rendered as text: one large title, a few paragraphs, and a wide table. The evidence model is sound; the interface does not yet help a Buyer, a Standard owner, or a Builder answer three questions quickly:

1. What is happening in this Company?
2. What needs my attention?
3. What can I do next?

This redesign keeps every existing data read, action, permission rule, and glossary term. It changes how the panel is structured, how it scans, and how it guides.

The result should feel like a tool someone uses every day: calm, dense, predictable, and fast. It should not feel like a marketing page, a generic SaaS template, or a wall of forms.

## 2. Goals

- A persistent app shell that gives orientation: grouped navigation, page breadcrumbs, the signed-in role, sign-out, and a clear primary action per page.
- One repeatable page structure: page header, optional summary, content, detail.
- Data surfaces built for scanning: counts, status, search, filter, sort, row actions, and honest empty/loading/error states.
- Long flows broken into guided steps or split panes instead of a single vertical stack.
- A monochrome status language that stays legible without color: word, icon, and surface treatment.
- Every number and label comes from data the panel already reads. No invented metrics.
- Accessibility, the design-token invariants, and the existing test suite stay green.

## 3. Non-goals

- No new product capability, registry endpoint, or Compilation field.
- No charting library, CSS framework, component library, icon package, or font CDN.
- No marketing landing page, decorative illustration, gradient, or hero animation.
- No green/red/blue status colors. Gold remains the only chromatic fill.
- No hiding a control because of a role. A refused action stays visible and is announced as a denial.
- No individual Builder names in Inventory or evidence.
- No copy that presents a passing Gate as security, accessibility, or legal certification.
- No mobile-native product. The panel is a responsive web application down to 320 CSS pixels.
- No modal for every action. Dialogs and side sheets are reserved for short, focused commits.

## 4. Anti-goals

These are failure modes, even if the screens look "modern":

- A cosmetic reskin that leaves every page as prose plus table.
- A generic dashboard that erases the cream/ink/gold identity.
- Filling summary cards with invented or duplicated numbers.
- Density for its own sake: 12px body text, cramped rows, unlabeled icons.
- A card for every field, or a modal for every action.
- Losing context: a detail page with no breadcrumb, a form with no return path.
- Breaking the existing accessible names, live regions, or copy semantics just to make a layout easier.

## 5. Constraints

- **Stack:** React Router 7 framework mode, React 19, plain CSS driven by design tokens, Vitest + Testing Library. No new runtime dependency.
- **Token invariants:** `apps/panel/src/design/tokens.ts` equals the `DESIGN.md` front matter; stylesheets use only token custom properties; no hex/rgb/hsl/px literals in CSS; gold is the only chromatic color; no all-caps transform; no positive `tabindex`; no third-party resource request.
- **Accessibility:** WCAG 2.2 AA, 24px minimum targets, visible focus, keyboard parity, live-region announcements, 320px support, reduced-motion support.
- **Behavior:** existing loaders, actions, refusals, and copy semantics stay. Tests are updated only where markup or accessible names legitimately change.
- **Brand:** cream canvas, white raised surfaces, ink text, gold only for the primary action and the Accepted-deviation alert band.
- **Language:** panel copy stays English and uses the PRD glossary exactly.

## 6. Design decisions

These are the calls made in this design. They can be overridden, but a builder should not have to make them again.

### 6.1 App shell

- **Desktop (≥ 1024px):** a 248px dark sidebar (`ink` near-black in light mode) with cream text, and a cream content canvas.
  - The dark rail is the brand's strongest existing moment (the levva dark hero) and it makes the gold primary action unmistakable.
  - Dark mode: the rail uses `surface-raised-dark`; the canvas uses `surface-base-dark`.
- **Sidebar content:** wordmark and a small "DH" mark; grouped destinations; an account block at the bottom with the signed-in role and a sign-out control. The session exposes no account name, so none is invented.
- **Navigation groups:**
  - **Monitor:** Inventory, Compilations
  - **Govern:** Standards, Project tree, Guidance access
  - **Operate:** New-application flow, Accepted deviation
  - Every existing destination remains present. Grouping adds orientation, not access rules.
- **Active state:** a cream-tinted surface (`sidebar-active`) and 600 weight, plus a slim cream indicator. Never gold.
- **Breadcrumbs:** they live at the top of the page content, above the page header, because only the page knows its dynamic names (`<Application>`, Module, Project). They are not lifted into the shell. The shell has no desktop top bar; the rail is the orientation.
- **Mobile top bar:** below 1024px a slim bar carries the wordmark and a menu button that opens the rail as a drawer. Esc closes the drawer and returns focus to the button. The page breadcrumbs stay in the content.
- **Sign-out:** new resource route `POST /sign-out` that clears the session cookie and redirects to `/sign-in`. It is a form button in the account block, not a link, so it cannot be triggered by navigation.
- **Skip link:** the first focusable element on every panel page, jumping to `#main`.
- **No command palette in this pass.** Search belongs on the data surfaces that can actually filter data. A navigation-only palette would be decoration.
- **Landmarks:** `<header>` for the chrome, `<nav aria-label="Management panel">`, `<main id="main">`.

### 6.2 Page structure

Every panel page uses this order, omitting what does not apply:

1. **Page header** — eyebrow (section), title, one-sentence description, actions, optional meta line.
2. **Summary strip** — 3–4 stat cards, only when the data supports them.
3. **Content sections** — each with a section header (title, optional description, optional action) and a body.
4. **Aside** — on detail pages at ≥ 1280px, context and secondary actions stack beside the main column.

Page titles drop from 48px to 32px. A 48px title on every utility page reads as a landing page and eats the first screen. `display` stays for sign-in only.

### 6.3 Design tokens (additions)

All additions are neutral except the existing gold. The full values and contrast pairs are recorded in `DESIGN.md` and mirrored in `tokens.ts`.

**Color roles**

| Role | Light | Dark | Use |
|---|---|---|---|
| `surface-subtle` | `#F7F3E4` | `#15181E` | table header, inset toolbar, quiet section |
| `surface-sunken` | `#F1ECD8` | `#0D1015` | page gutter, skeleton base |
| `ink-muted` | `#525252` | `#A3A3A3` | secondary labels, timestamps |
| `border-strong` | `#C9C4B4` | `#2A2E36` | inputs, selected outlines |
| `sidebar` | `#0A0A0A` | `#101319` | navigation rail |
| `sidebar-ink` | `#FAFAFA` | `#FFFFFF` | rail text |
| `sidebar-muted` | `#A3A3A3` | `#A3A3A3` | rail section labels |
| `sidebar-active` | `#1F1F1F` | `#1A1E25` | active rail item |

`ink-muted` on cream must meet 4.5:1; `sidebar-muted` on `sidebar` must meet 4.5:1. Both pairs are added to the contrast table and test.

**Typography additions**

| Name | Family | Size | Weight | Line height | Use |
|---|---|---|---|---|---|
| `page-title` | Sora | 32px | 600 | 1.15 | page title |
| `section-title` | Sora | 20px | 600 | 1.3 | section header |
| `body-sm` | Sora | 14px | 400 | 1.5 | dense table cells, helpers |
| `caption` | Sora | 12px | 500 | 1.4 | eyebrow, column labels, meta |
| `stat` | Sora | 28px | 600 | 1.1 | summary values |

The existing `title`, `headline`, `title-sm`, `body`, `body-light`, `label`, and `label-strong` remain. `title-sm` stays for legacy headings that are not section headers.

**Shadows:** add `card` (`0 1px 2px rgba(0,0,0,0.06), 0 8px 24px rgba(0,0,0,0.04)`) and `popover` (`0 8px 24px rgba(0,0,0,0.16)`). Shadows stay soft and are never used to imply elevation hierarchy beyond "this panel floats".

**Radius:** keep 4px for actions and 8px for fields and cards. No pills.

### 6.4 Primitives

New shared components under `apps/panel/src/components/`:

- **`icon.tsx`** — inline SVG set, 1.5px stroke, `currentColor`, 16/20px. Icons are supporting, never the only label. Set: inventory, standards, projects, compilations, guidance, plus, application, deviation, search, filter, sort, chevron, check, alert, clock, copy, arrow-right, menu, close, user, sign-out, external.
- **`page-header.tsx`** — eyebrow, title, description, actions, meta.
- **`breadcrumbs.tsx`** — ordered list, current page as text, prior pages as links.
- **`stat.tsx`** — label, value, hint, optional icon and link. Values are tabular.
- **`section-card.tsx`** — raised surface with header and body; optional action.
- **`badge.tsx`** — status badge with `tone` (`neutral`, `outline`, `solid`) and an icon + word. No color-only state.
- **`data-table.tsx`** — wrapper for a table with a toolbar, sticky header, caption, responsive scroll, and optional footer. Sorting is a small client-side helper, not a new dependency.
- **`toolbar.tsx`** — search field, filter selects/chips, result count, optional group-by and sort controls.
- **`tabs.tsx`** — ARIA tabs with arrow-key navigation; used for detail panes and Compilations.
- **`empty-state.tsx`** — icon, title, explanation, action.
- **`skeleton.tsx`** — static blocks with `aria-hidden` and a parent `aria-busy`. A slow, subtle pulse is allowed outside the alert band; `prefers-reduced-motion` removes it.
- **`copy-button.tsx`** — copies text, announces "Copied", resets after a short delay. Extends the existing Correction copy behavior.
- **`banner.tsx`** — replaces the plain status line with an icon, text, and optional recovery action. The existing live region (`role="status"`, `aria-live="polite"`) stays.
- **`side-sheet.tsx`** — a modal surface with `role="dialog"`, `aria-modal="true"`, a labelled title, focus trap, Esc to close, and focus return to the opener. Used for short commits only (create Module, assign owner, create Project, change parent, publish/edit Standard). Long forms stay on the page.
- **Button variants:** `primary` (gold), `secondary` (white surface, hairline, ink), `ghost` (transparent, ink, hover surface), `inverse` (existing dark chip). A page uses at most one primary action.

### 6.5 Status language

Status is always a word plus an icon; color is never the only signal. All badges are monochrome.

| State | Treatment |
|---|---|
| `pass` | outline badge, check icon |
| `fail` | solid ink badge, alert icon |
| `open` | solid ink badge, dot icon |
| `accepted` | outline badge, check icon |
| `stale` | solid ink badge, clock icon |
| `fresh` | outline badge, check icon |
| `frozen` | neutral badge, lock icon |
| `granted` | outline badge, check icon |
| `not granted` | neutral badge, dash icon |
| `no compilation yet` | neutral badge, dot icon |

The Accepted-deviation alert band remains gold with ink text and is the only gold surface besides the primary button.

### 6.6 Screen designs

#### Sign-in

- Split layout at ≥ 900px: a dark brand panel on the left (wordmark, one-line product statement, three short evidence points, a cream rule) and a cream form panel on the right. Gold appears only on the submit button; the brand panel has no gold accent line. Below 900px the brand panel collapses to a compact wordmark and the form takes the full width.
- One email field, label, helper text, primary button full width.
- The "sent" state replaces the form with a confirmation panel: check icon, "Check your email for a sign-in link", the address, and a quiet "Use a different address" action.
- The invalid and unavailable states appear as a banner above the field, with the field kept.
- Keep the focus-on-open, the live region, and the identical response for every well-formed address.

#### Inventory

- Page header: "Inventory", a one-sentence description, primary "New application".
- Summary: Applications, Projects, Agent tools, Not yet compiled. All derived from the applications + evidence reads.
- Toolbar: search by description/project; Project filter; group-by control (Agent tool / Project); sort (Newest / Name).
- Content: groups rendered as section cards. Each group header carries the agent tool name, count, and a tool icon. Inside, a table with Application (link + project), Project, Agent tool, Status, Added.
  - Status is `No Compilation yet` (neutral) until the evidence read contains a row for that Application, and `Evidence received` (outline) after. This is a read-presence fact, not a Gate verdict: `InventoryEvidence` carries observed agent tools only, so the page must not imply a pass or a fail. Evidence upgrades the group keys exactly as today.
  - Row hover uses cream; the whole row remains keyboard-activatable through the Application link.
- Empty state: "No Application yet." with the New-application action; filtered empty state names the Project and offers "Clear filter".
- Loading: skeleton rows in the table shape, not a paragraph.
- Evidence failure: an inline banner in the affected group, with the fallback grouping preserved.

#### Application

- Breadcrumb: Inventory / <Application>.
- Header: Application description, project link, agent tool, listed date; actions: "Copy Application id", "Accept a deviation" when open deviations exist.
- Summary strip: Adherence (`checked − open` of `checked`), Gate verdict badge, Guidance consulted badge, Open deviations count.
- Binding refusal: a prominent banner with the registry sentence, the recovery text, and a "Back to Inventory" link.
- Main column:
  - **Deviations** section: a table at ≥ 900px and stacked cards below. Each row: status badge, Standard id (with copy), Conflict slot, Subject, Correction (inset with copy), Accept action for open rows.
  - **History** section: the stored Compilations in reverse sequence order, each with type, sequence, timestamp, and a short fact (verdict, outcome, refusal reason). This uses data already in `ApplicationEvidence`.
- Aside: Application facts (id, project, agent tool, created), Guidance consultation, and a link to the Project.
- Empty state: "This Application is listed and has no Guidance event and no Gate run." plus the next-step explanation.
- Error: the existing "did not arrive" rule, styled as a banner.

#### Standards (Modules)

- Page header: "Standards", description, primary "Create Module".
- Summary: Modules, Code stacks, Design systems, Without an owner.
- Toolbar: search by Module name; kind filter; owner filter.
- Content: a table or cards with Module name (link), Kind badge, Standard owner (name + assigned date), and a row action "Change owner".
  - "Change owner" opens a side sheet with the eligible Standard owners and a single commit. The per-row inline select disappears from the table.
  - Modules without an owner show a "No owner" neutral badge and a "Assign owner" action.
- Create Module opens a side sheet (name + kind) rather than a form permanently at the bottom.
- Empty state: "No Module yet." with the create action.

#### Module Standards

- Breadcrumb: Standards / <Module>.
- Header: Module name, kind badge, owner, actions: "Publish standard" (primary) and "Back to Standards".
- Summary: Standards, Projects scoped, Last published.
- Toolbar: search by Standard name; filter by entry kind and status; sort by name, version, published.
- Content: a table with Standard (name + edit action), Project scope, Entry kind, Status badge, Version, Published. The raw Standard id moves into an expandable detail row with a copy button. The 8th ID column disappears.
- Publish/edit: a side sheet with grouped fields (Identity, Rule, Correction), helper text, inline errors, and a sticky footer with Cancel and Publish. Editing opens the same sheet prefilled. The current `?edit=` deep link keeps working.
- Published success: a banner above the table with the Standard id, version, project, and timestamp, plus "Copy id".
- Empty state: "This Module has no published Standard yet." with the publish action.
- Version history: not in this pass. The Standard detail row shows the live version only; a future pass can add a history sheet using `getStandardVersions`.

#### Project tree

- Breadcrumb: Projects / <Project>.
- Header: selected Project name, level name, parent, actions: "Create project", "Change parent".
- Two panes at ≥ 1280px: the tree on the left, the selected Project's context on the right.
- Tree: proper expand/collapse chevrons, depth indentation, level name as a caption, selected state with a cream surface and 600 weight. The tree keeps its ARIA tree semantics.
- Right pane: tabs — **Effective standards**, **Access**, **Build grants**.
  - Effective standards: the existing table, with status badges and a Locked-rule action in a compact row form.
  - Access: child-Project permission rows with a toggle-style commit and an explicit account label.
  - Build grants: the same pattern, with a "Granted"/"Not granted" badge.
- Create Project and Change parent open side sheets.
- Empty state for a Company with only the root: explain the root and offer Create project.
- Failure: cycle and locked-rule conflicts appear as banners naming the Projects and the rule.

#### New-application flow

- Header: "New-application flow", description, role-aware explanation.
- Three tabs/sections:
  1. **Place an application** — description + Project + primary "Place application". This is the Builder's main path.
  2. **Generate Boilerplate** — appears after a successful place, with the target select and "Generate Boilerplate"; the result is a set of artifact cards with copy actions.
  3. **Register existing** — the Buyer-only identification-file path, with its own explanation.
- Company Guidance endpoint: a separate "Company setup" card at the bottom, marked "Buyer", with the current URL and save action.
- A compact progress rail shows the current state as Place → Generate → Result. "Register existing" is an alternate path in its own tab, not a rail step. The rail is explanatory, not a blocking wizard: the user can jump back.
- After a successful place, the page scrolls/focuses the Boilerplate step and announces the result.
- Boilerplate result: artifact cards grouped by kind, each with a filename, the kind label as its description, and a copy button that copies the path. The identification file gets a prominent "commit this file" note. The panel does not decode the archive; the existing download stays.
- Empty state: the form is waiting, with a one-line explanation of what will be created.
- Errors keep the submitted values and name the field.

#### Accepted deviation

- Header: "Accepted deviation", a one-sentence explanation, and a "Back to Application evidence" link when the page was reached from a row.
- Two columns at ≥ 1280px: the form on the left, stored acceptances on the right.
- **Record acceptance** form, three groups:
  1. **Match the Deviation** — a paste area first ("Paste the Gate's Deviation line"), a parsed preview with three chips (Standard, Conflict slot, Subject), then the manual fields. "Use this line" fills the fields and shows the resolved Standard version.
  2. **Justification and window** — justification, start, end, alert interval with an "hours" suffix.
  3. **Review** — a summary of what will be stored, then the primary "Record Accepted deviation".
- **Stored acceptances** become cards: Subject, Application, Standard + version, window (start → end), alert interval, recorded by, and an Active/Expired badge computed from `end`. The justification is body text, not a run-on sentence.
- Empty state: "No Accepted deviation is recorded yet." with an explanation.
- Errors: field errors under the field; a plan refusal or Builder denial as a banner inside the form.

#### Compilations

- Header: "Compilations", description.
- Summary: Services reporting, Stale bundles, Pending, Drops. Derived from the bundle-status and collector-health reads.
- Tabs:
  - **Overview** — bundle status table (Application, Agent tool, Active hash with copy, Sequence, Age vs bound, Freeze state, Status badge) and Collector health cards (Pending, Dropped by reason). Drops appear as a banner at the top of this tab when any count is above zero.
  - **Schemas** — an accordion of compilation types, each with version and a definition list. The catalog-read state and the "I have read catalog" commit sit at the top of this tab.
  - **Drops** — the drop announcements by reason and count, with the stored-nothing guarantee.
- Empty states name what has not arrived, not just "empty".
- The schema docs are static and remain available on a cold load.

#### Guidance access

- Header: "Guidance access", description.
- Two columns at ≥ 1280px.
- **Who can read Guidance events** — a card with one row per grantable role, a toggle-style checkbox, and a state badge. Buyer is always granted and disabled. The duplicate prose list is removed; the controls are the source of truth.
- **Retention** — a card with the current value, a number input, and a helper ("1–3650 days").
- A sticky save bar appears when a toggle or the retention value changes; it contains the primary "Save Guidance access" and a "Discard" ghost action.
- **Your read token** — a separate card with the mint action, the one-time token in a code block with copy, and the expiry. The token is never stored.
- Empty state: no grant configured, with the default retention explained.
- Denials are banners, not missing controls.

#### Global states

- **Loading:** skeleton blocks that match the final layout; `aria-busy` on the region; no spinner-only screens.
- **Empty:** icon, title, explanation, action. Empty is not an error.
- **Error / denial:** banner with icon, the exact registry sentence, and a recovery action. The surface stays.
- **Success:** banner at the top of the affected section, with the facts of what changed.
- **Focus:** the visible ink ring; drawers and dialogs move focus to their title, trap it, and return it to the opener on close.
- **Reduced motion:** no pulse, no drawer slide; instant state changes.

### 6.7 Copy

New panel copy stays in sentence case, direct, and glossary-exact. It adds navigation and section labels ("Monitor", "Govern", "Operate", "Overview", "History", "Access", "Build grants", "Company setup", "Stored acceptances", "Active", "Expired", "Sign out") and keeps every existing denial, empty, and success sentence. No exclamation marks, no "Welcome back", no "Oops".

## 7. Implementation plan (for the builder)

The redesign is one coherent system delivered in three slices. Each slice leaves the panel buildable and all tests green. A screen is never half-migrated.

### Slice A — Foundation

1. Update `DESIGN.md` front matter and prose with the new tokens, type ramp, shell, primitives, and status language.
2. Update `apps/panel/src/design/tokens.ts` and the contrast pairs.
3. Add the token and contrast tests for the new pairs.
4. Build `icon.tsx`, `page-header.tsx`, `breadcrumbs.tsx`, `stat.tsx`, `section-card.tsx`, `badge.tsx`, `empty-state.tsx`, `skeleton.tsx`, `copy-button.tsx`, `banner.tsx`, `data-table.tsx`, `toolbar.tsx`, `tabs.tsx`.
5. Build the app shell in `panel-chrome.tsx`: dark rail, groups, active state, account block, mobile drawer, skip link.
6. Add the `sign-out` resource route and its action test.
7. Redesign sign-in with the split layout and the confirmation state.

### Slice B — Core flows

8. Inventory: header, summary, toolbar, grouped tables, empty/loading/error states.
9. Application: header, summary, deviation table/cards, history, aside, refusal banner.
10. Standards: header, summary, toolbar, Module table, owner side sheet, create Module side sheet.
11. Module Standards: header, summary, toolbar, table with detail row, publish/edit side sheet, success banner.

### Slice C — Remaining flows

12. New-application: tabs, progress rail, result artifact cards, Company setup card.
13. Project tree: two panes, tree affordances, context tabs, create/change-parent side sheets.
14. Accepted deviation: two columns, grouped form, parsed preview, stored acceptance cards.
15. Compilations: summary, tabs, bundle table, health cards, schema accordion.
16. Guidance access: role toggles, retention card, sticky save bar, token card.

### Test strategy

- Component tests for every new primitive: badge word+icon, tabs keyboard, dialog focus, copy announcement, empty state, skeleton `aria-busy`.
- Route tests keep the existing accessible names and add assertions for the new structure (summary values, filters, empty/loading states).
- A shell test asserts all seven destinations, their groups, the active state, and the sign-out commit.
- Token and styles tests stay authoritative; update `DESIGN.md` and `tokens.ts` together.
- Visual checks at 1440px, 1024px, 768px, and 320px; keyboard-only pass; dark mode pass.

## 8. What is left to the builder

- Exact icon drawings, as long as they are 1.5px stroke, `currentColor`, and labelled.
- The precise CSS class names and file split (`shell.css`, `primitives.css`, `routes.css`), as long as every value comes from a token.
- The exact wording of new helper text, as long as it follows the glossary and the voice rules.
- The order of fields inside the publish/edit side sheets, as long as the existing field names, errors, and intents are preserved.
- Whether a table becomes stacked cards below 768px or keeps a horizontal scroll, per section. The rule is: a primary action and the first two facts stay visible without horizontal scroll.

## 8.1 Builder-check resolutions

The independent builder review raised five ambiguities. This document now settles them:

- **Breadcrumbs vs primary action:** breadcrumbs live at the top of the page content; the page header owns the page primary action. The shell has no desktop top bar, so no route metadata or portal mechanism is needed to lift dynamic names or actions into it.
- **Gold on sign-in:** the brand panel uses a cream rule, not a gold accent line. Gold stays only on the primary button and the alert band, so the style test is not relaxed.
- **Boilerplate copy:** an artifact card copies the artifact path and uses the existing kind label as its description. The archive is not decoded; the existing download stays.
- **Inventory status:** the column shows read-presence (`No Compilation yet` / `Evidence received`), never a Gate verdict, because `InventoryEvidence` carries agent tools only.
- **New-application rail:** Place → Generate → Result. "Register existing" is an alternate path, not a third rail step.

## 9. Open decisions for the human partner

These change what gets built; the rest is the builder's call. Recommendations are marked.

1. **Scope:** all nine screens in this pass, delivered in three slices, or only Slice A + B first with the remaining screens in a follow-up? *Recommended: all nine, with a review checkpoint after Slice A + B; the remaining screens follow in the same session unless you stop it.*
2. **Sidebar tone:** the dark rail described here, or a light/cream rail that is quieter but less branded? *Recommended: dark rail; it is the strongest existing brand moment and it makes the gold primary action unmistakable.*
3. **Sign-out:** adding the resource route and the control is required for the shell. *Recommended: in scope; the shell otherwise has no way to end a session.*
4. **Design spine:** `DESIGN.md` and `EXPERIENCE.md` will be updated to describe the new shell, primitives, and status language. *Recommended: edit both; the token test already treats `DESIGN.md` as the source of truth, and a redesign that leaves the spine stale would be a second source of truth.*

## 10. Acceptance

The redesign is done when:

- Every panel page uses the shell, the page header, and the shared primitives; no page is left as prose plus a bare table.
- The three questions (what is happening, what needs attention, what next) have a visible answer on Inventory, Application, Standards, and Compilations.
- Long flows are split into steps or panes without losing any existing field, intent, refusal, or return path.
- Every status is a word plus an icon; no state depends on color alone.
- All tests pass, including the token, style, contrast, and accessibility invariants.
- The panel works at 320px, at 200% zoom, with keyboard only, and in dark mode.
- No new runtime dependency, no new API endpoint, and no invented metric.
