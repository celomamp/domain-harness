# Domain Harness Panel Operational Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the management panel from a set of text-and-table surfaces into a calm, dense operational tool with a persistent shell, scannable summaries, guided flows, and a monochrome status language, without changing the product's data model or permissions.

**Architecture:** A token-driven React Router panel. The foundation adds neutral surface/ink tokens, a larger type ramp, inline SVG icons, and a small primitive library. Each screen then composes those primitives with the data its loader already returns. The shell owns orientation (dark rail, breadcrumbs, account/sign-out); page headers own the page title and primary action. Screens are implemented in parallel after the foundation, each owning its route, tests, and CSS file.

**Tech Stack:** React Router 7 framework mode, React 19, TypeScript, plain CSS with custom-property tokens, Vitest + Testing Library. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-10-19-panel-ux-redesign-design.md`

## Global Constraints

- **No new runtime dependency.** No Tailwind, component library, icon package, chart library, or font CDN.
- **Tokens are the only source of color and size.** `apps/panel/src/design/tokens.ts` must equal the `DESIGN.md` front matter. Stylesheets may use only token custom properties: no hex, `rgb()`, `hsl()`, `oklch()`, or `px` literals.
- **Gold is not a status color.** `.button-primary` and `.accepted-deviation-alert` are the only selectors allowed to fill with `--color-accent`; the style test enforces it.
- **Accessibility:** WCAG 2.2 AA, 24px minimum targets, visible ink focus ring, keyboard parity, live regions, 320px support, `prefers-reduced-motion`.
- **Copy:** English, sentence case, PRD glossary exact. No exclamation marks, no "Welcome back", no "Oops", no certification copy.
- **Behavior:** preserve every existing loader, action, intent, refusal, field name, return path, and denial. A role without a grant still sees the control and receives the denial.
- **Privacy:** no individual Builder name on Inventory or evidence surfaces.
- **No invented data:** every number and label comes from a read the panel already performs.
- **Alert band:** the Accepted-deviation alert band never animates or transitions.

## Review Focus

The spec implies these five failure modes; each gets a test in the owning task.

1. **Long names at 320px.** A 500-character Application description, a long Module name, or a long Project name must wrap without hiding the link or pushing the primary action off-screen. Test in Tasks 7, 8, and 9.
2. **Many rows.** 60+ Applications or Standards must remain searchable and sortable without dropping rows, losing the caption, or breaking the summary count. Test in Tasks 7 and 9.
3. **Slow, empty, and failed reads.** A pending promise shows a skeleton and honest placeholders; an empty read shows an empty state; a failed read shows a banner and keeps the structure. Summary numbers must never show stale or undefined values. Test in Tasks 7, 8, and 13.
4. **Keyboard-only operation.** Tabs, side sheets, the mobile drawer, and copy buttons must work without a pointer, trap focus only inside a modal/sheet, close on Esc, and return focus to the opener. Test in Tasks 3, 4, 5, and 9.
5. **Dark mode and 200% zoom.** New neutral pairs must pass contrast in both modes; headers and toolbars must not overflow or clip at 200% zoom or 320px. Test via `contrast.test.ts` and a final visual pass in Task 15.

## Parallelization Map

The work is deliberately split so that no two agents edit the same file. Foundation is serial; screens fan out.

| Wave | Tasks | Runs in parallel? | Why |
|---|---|---|---|
| 0 | Task 1: tokens, icon, formatters, CSS scaffold | No | Touches `tokens.ts`, `DESIGN.md`, `root.tsx`, and creates every CSS file |
| 1 | Tasks 2, 3, 4: display, feedback, data primitives | Yes, 3 agents | Each owns disjoint component and test files and its own CSS file; all consume `Icon` from Task 1 |
| 2 | Tasks 5, 6: shell/sign-out, sign-in | Yes, 2 agents | Disjoint files; both consume primitives |
| 3 | Tasks 7, 8, 9, 10: Inventory, Application, Standards+Module, New-application | Yes, 4 agents | Disjoint routes, components, tests, and CSS files |
| 4 | Tasks 11, 12, 13, 14: Project tree, Accepted deviation, Compilations, Guidance access | Yes, 4 agents | Disjoint routes, components, tests, and CSS files |
| 5 | Task 15: full verification; parallel reviewers | Reviewers yes, fixes serial | Reviewers read only; the coordinator applies fixes |

**Parallel-work rules**

- The coordinator (the main agent) owns `git add`/`git commit`. Subagents never commit; concurrent commits race on `.git/index`.
- A subagent may edit only the files listed in its task. If it needs a shared primitive changed, it reports the need; the coordinator makes the change before the task resumes.
- Each subagent runs its own test file(s), then the coordinator runs the full panel suite after merging a wave.
- A wave does not start until the previous wave's full panel suite is green.
- If two tasks would touch the same file, they are merged into one task or serialized. The file-ownership table is authoritative.

## File Ownership Map

| Owner | Files |
|---|---|
| Task 1 (foundation) | `apps/panel/src/design/tokens.ts`, `design/contrast.ts`, `design/tokens.test.ts`, `design/contrast.test.ts`, `apps/panel/src/format.ts`, `apps/panel/src/format.test.ts`, `apps/panel/src/components/icon.tsx`, `apps/panel/src/components/icon.test.tsx`, `apps/panel/src/components/button.tsx`, `apps/panel/src/components/button.test.tsx`, `apps/panel/src/root.tsx`, `apps/panel/src/styles/components.css`, `apps/panel/src/styles/*.css` (create every file, then leave them to their owners), `_bmad-output/.../DESIGN.md` |
| Task 2 (display) | `components/badge.tsx`, `page-header.tsx`, `breadcrumbs.tsx`, `stat.tsx`, `section-card.tsx`, `styles/primitives-display.css`, `components/primitives-display.test.tsx` |
| Task 3 (feedback) | `components/empty-state.tsx`, `skeleton.tsx`, `copy-button.tsx`, `banner.tsx`, `tabs.tsx`, `side-sheet.tsx`, `styles/primitives-feedback.css`, `components/primitives-feedback.test.tsx` |
| Task 4 (data) | `components/data-table.tsx`, `toolbar.tsx`, `styles/primitives-data.css`, `components/primitives-data.test.tsx` |
| Task 5 (shell) | `components/panel-chrome.tsx`, `routes/panel-layout.tsx`, `routes/sign-out.ts`, `routes/sign-out.test.ts`, `routes.ts`, `styles/shell.css`, `components/components.test.tsx` |
| Task 6 (sign-in) | `components/sign-in-form.tsx`, `routes/sign-in.tsx` (only if the confirmation state needs loader data), `routes/sign-in.test.tsx`, `styles/sign-in.css` |
| Task 7 (Inventory) | `routes/inventory.tsx`, `routes/inventory.test.tsx`, `styles/inventory.css` |
| Task 8 (Application) | `routes/application.tsx`, `routes/application.test.tsx`, `styles/application.css` |
| Task 9 (Standards) | `routes/standards.tsx`, `components/modules-section.tsx`, `routes/module-standards.tsx`, `components/standard-form.tsx`, `components/design-system-form.tsx`, their tests, `styles/standards.css` |
| Task 10 (New-application) | `routes/new-application.tsx`, `components/new-application.tsx`, `routes/new-application.test.tsx`, `styles/new-application.css` |
| Task 11 (Project tree) | `routes/project-tree.tsx`, `components/project-tree.tsx`, `routes/project-tree.test.tsx`, `routes/project-tree.action.test.ts`, `styles/project-tree.css` |
| Task 12 (Accepted deviation) | `routes/accepted-deviation.tsx`, `routes/accepted-deviation.test.tsx`, `styles/accepted-deviation.css` |
| Task 13 (Compilations) | `routes/compilations.tsx`, `routes/compilations.test.tsx`, `styles/compilations.css` |
| Task 14 (Guidance access) | `routes/guidance-access.tsx`, `routes/guidance-access.test.tsx`, `styles/guidance-access.css` |

---

## Task 1: Design Tokens, Icon, Formatters, and CSS Scaffold

**Files:**
- Modify: `_bmad-output/planning-artifacts/ux-designs/ux-domain harness-2026-10-09/DESIGN.md`
- Modify: `apps/panel/src/design/tokens.ts`
- Modify: `apps/panel/src/design/contrast.ts`
- Modify: `apps/panel/src/design/tokens.test.ts`
- Modify: `apps/panel/src/design/contrast.test.ts`
- Create: `apps/panel/src/format.ts`
- Create: `apps/panel/src/format.test.ts`
- Create: `apps/panel/src/components/icon.tsx`
- Create: `apps/panel/src/components/icon.test.tsx`
- Modify: `apps/panel/src/components/button.tsx`
- Create: `apps/panel/src/components/button.test.tsx`
- Modify: `apps/panel/src/root.tsx`
- Create: `apps/panel/src/styles/shell.css`, `primitives-display.css`, `primitives-feedback.css`, `primitives-data.css`, `inventory.css`, `application.css`, `standards.css`, `new-application.css`, `project-tree.css`, `accepted-deviation.css`, `compilations.css`, `guidance-access.css`, `sign-in.css` (each starts with a one-line comment; their owners fill them)

**Interfaces:**
- Produces:
  - `colors` gains `surface-subtle`, `surface-sunken`, `ink-muted`, `border-strong`, `sidebar`, `sidebar-ink`, `sidebar-muted`, `sidebar-active`, plus `-dark` for each.
  - `typography` gains `page-title` (Sora 32/600/1.15), `section-title` (Sora 20/600/1.3), `body-sm` (Sora 14/400/1.5), `caption` (Sora 12/500/1.4), `stat` (Sora 28/600/1.1).
  - `shadow` gains `card` and `popover`.
  - `formatDate(iso: string): string` and `formatDateTime(iso: string): string` in `src/format.ts`, using `Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ... })`.
  - `IconName` union and `Icon({ name, size = 16, label }: { name: IconName; size?: 16 | 20; label?: string }): JSX.Element` in `components/icon.tsx`.
  - `Button` gains `variant: "primary" | "secondary" | "ghost" | "inverse"`; `secondary` uses a raised surface with a hairline border, `ghost` uses a transparent surface with a hover fill, and the existing `primary`/`inverse` rendering is unchanged.

- [ ] **Step 1: Write the failing formatter test**

```ts
import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime } from "./format.ts";

describe("format", () => {
  it("formats a UTC instant as a short date", () => {
    expect(formatDate("2026-10-13T23:30:00.000Z")).toBe("13 Oct 2026");
  });
  it("formats a UTC instant with the time", () => {
    expect(formatDateTime("2026-10-13T23:30:00.000Z")).toBe("13 Oct 2026, 23:30 UTC");
  });
  it("returns an em dash for an unparseable value", () => {
    expect(formatDate("not-a-date")).toBe("—");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @domain-harness/panel exec vitest run src/format.test.ts`
Expected: FAIL because `./format.ts` does not exist.

- [ ] **Step 3: Implement `format.ts`**

Export `formatDate` and `formatDateTime`. Use a module-level `Intl.DateTimeFormat` with `timeZone: "UTC"`. Return `"—"` when `Number.isNaN(Date.parse(iso))`.

- [ ] **Step 4: Write the failing icon test**

```tsx
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Icon } from "./icon.tsx";

describe("Icon", () => {
  it("is decorative by default", () => {
    const { container } = render(<Icon name="inventory" />);
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });
  it("is labelled when a label is provided", () => {
    render(<Icon name="inventory" label="Inventory" />);
    expect(screen.getByRole("img", { name: "Inventory" })).toBeTruthy();
  });
});
```

- [ ] **Step 5: Run it to verify it fails**

Run: `pnpm --filter @domain-harness/panel exec vitest run src/components/icon.test.tsx`
Expected: FAIL because `icon.tsx` does not exist.

- [ ] **Step 6: Implement `icon.tsx`**

Define the union: `inventory`, `standards`, `projects`, `compilations`, `guidance`, `plus`, `application`, `deviation`, `search`, `filter`, `sort`, `chevron`, `check`, `alert`, `clock`, `copy`, `arrow-right`, `menu`, `close`, `user`, `sign-out`, `external`, `dot`, `lock`, `dash`. Each path is a 24×24 viewBox, `fill="none"`, `stroke="currentColor"`, `strokeWidth="1.5"`, `strokeLinecap="round"`, `strokeLinejoin="round"`. Decorative icons get `aria-hidden="true"`; a labelled icon gets `role="img"` and a `<title>`.

- [ ] **Step 7: Write the failing button-variant test**

```tsx
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "./button.tsx";

describe("Button", () => {
  it("renders every variant with its class and a safe default type", () => {
    render(<><Button variant="primary">Go</Button><Button variant="secondary">Keep</Button><Button variant="ghost">Cancel</Button><Button variant="inverse">Back</Button></>);
    expect(screen.getByRole("button", { name: "Go" }).className).toBe("button-primary");
    expect(screen.getByRole("button", { name: "Keep" }).className).toBe("button-secondary");
    expect(screen.getByRole("button", { name: "Cancel" }).className).toBe("button-ghost");
    expect(screen.getByRole("button", { name: "Back" }).className).toBe("button-inverse");
    expect(screen.getByRole("button", { name: "Go" }).getAttribute("type")).toBe("button");
  });
});
```

- [ ] **Step 8: Run it to verify it fails**

Run: `pnpm --filter @domain-harness/panel exec vitest run src/components/button.test.tsx`
Expected: FAIL because `secondary` and `ghost` are not in the union.

- [ ] **Step 9: Extend `Button`**

Add `secondary` and `ghost` to the variant union and the class list. Add `.button-secondary` and `.button-ghost` to `styles/components.css` using only tokens. Keep the existing `.button-primary` and `.button-inverse` rules untouched.

- [ ] **Step 10: Update `DESIGN.md` and `tokens.ts`**

Add the color roles, type styles, shadows, and component entries from the design doc to both. Add the contrast pairs to `contrast.ts`:

```ts
{ foreground: "ink-muted", background: "surface-base", use: "secondary labels", min: 4.5 },
{ foreground: "sidebar-muted", background: "sidebar", use: "rail section labels", min: 4.5 },
{ foreground: "sidebar-ink", background: "sidebar", use: "rail text", min: 4.5 },
{ foreground: "ink", background: "surface-subtle", use: "table header text", min: 4.5 },
```

- [ ] **Step 11: Extend the token tests**

Add assertions that `tokenCss()` emits `--type-page-title-size: 32px`, `--type-caption-size: 12px`, `--type-stat-size: 28px`, `--shadow-card`, and `--shadow-popover`. Keep the existing equality tests.

- [ ] **Step 12: Create the CSS scaffold and import it**

Create every CSS file listed above with a comment naming its owner. In `root.tsx`, import them after `components.css`. Keep `components.css` for legacy and shared button/status rules; new rules go in the new files.

- [ ] **Step 13: Run the foundation tests and the style invariants**

Run: `pnpm --filter @domain-harness/panel exec vitest run src/design src/format.test.ts src/components/icon.test.tsx src/components/button.test.tsx src/styles`
Expected: PASS. The equality test proves `tokens.ts` and `DESIGN.md` agree; the style test proves no literal colors/sizes.

- [ ] **Step 14: Commit**

```bash
git add apps/panel/src/design apps/panel/src/format.ts apps/panel/src/format.test.ts apps/panel/src/components/icon.tsx apps/panel/src/components/icon.test.tsx apps/panel/src/components/button.tsx apps/panel/src/components/button.test.tsx apps/panel/src/root.tsx apps/panel/src/styles _bmad-output/planning-artifacts/ux-designs/ux-domain\ harness-2026-10-09/DESIGN.md
git commit -m "feat(panel): extend tokens, icons and button variants"
```

---

## Task 2: Display Primitives

**Files:**
- Create: `apps/panel/src/components/badge.tsx`
- Create: `apps/panel/src/components/page-header.tsx`
- Create: `apps/panel/src/components/breadcrumbs.tsx`
- Create: `apps/panel/src/components/stat.tsx`
- Create: `apps/panel/src/components/section-card.tsx`
- Create: `apps/panel/src/styles/primitives-display.css`
- Create: `apps/panel/src/components/primitives-display.test.tsx`

**Interfaces:**
- `Badge({ tone, icon, children }: { tone: "neutral" | "outline" | "solid"; icon?: IconName; children: ReactNode })`
- `PageHeader({ eyebrow, title, description, actions, meta }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode; meta?: ReactNode })`
- `Breadcrumbs({ items }: { items: readonly { label: string; to?: string }[] })`
- `Stat({ label, value, hint, icon, to }: { label: string; value: string; hint?: string; icon?: IconName; to?: string })`
- `SectionCard({ id, title, description, action, children }: { id?: string; title: string; description?: string; action?: ReactNode; children: ReactNode })`

- [ ] **Step 1: Write the failing display-primitive tests**

```tsx
// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { Badge } from "./badge.tsx";
import { Breadcrumbs } from "./breadcrumbs.tsx";
import { PageHeader } from "./page-header.tsx";
import { SectionCard } from "./section-card.tsx";
import { Stat } from "./stat.tsx";

describe("display primitives", () => {
  it("Badge always renders its word and an icon, and exposes its tone", () => {
    const { container } = render(<Badge tone="solid" icon="alert">fail</Badge>);
    expect(screen.getByText("fail")).toBeTruthy();
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.firstElementChild?.getAttribute("data-tone")).toBe("solid");
  });
  it("PageHeader renders eyebrow, h1, description, actions and meta in order", () => {
    render(<PageHeader eyebrow="Monitor" title="Inventory" description="Every Application." actions={<button>New</button>} meta="3 Projects" />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Inventory");
    expect(screen.getByText("Monitor")).toBeTruthy();
    expect(screen.getByRole("button", { name: "New" })).toBeTruthy();
    expect(screen.getByText("3 Projects")).toBeTruthy();
  });
  it("Breadcrumbs render prior items as links and the current page as text", () => {
    render(<MemoryRouter><Breadcrumbs items={[{ label: "Inventory", to: "/inventory" }, { label: "Checkout" }]} /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "Inventory" }).getAttribute("href")).toBe("/inventory");
    expect(screen.queryByRole("link", { name: "Checkout" })).toBeNull();
    expect(screen.getByText("Checkout").getAttribute("aria-current")).toBe("page");
  });
  it("Stat renders a labelled group with a value and a hint", () => {
    render(<Stat label="Applications" value="12" hint="3 Projects" />);
    const group = screen.getByRole("group", { name: "Applications" });
    expect(within(group).getByText("12")).toBeTruthy();
    expect(within(group).getByText("3 Projects")).toBeTruthy();
  });
  it("SectionCard renders its header and action", () => {
    render(<SectionCard title="Deviations" description="3 open" action={<button>Accept</button>}>body</SectionCard>);
    expect(screen.getByRole("heading", { name: "Deviations" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Accept" })).toBeTruthy();
    expect(screen.getByText("body")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @domain-harness/panel exec vitest run src/components/primitives-display.test.tsx`
Expected: FAIL because the components do not exist.

- [ ] **Step 3: Implement the components**

`PageHeader` uses `type-page-title` for the `h1`, `type-caption` for the eyebrow, `type-body-sm` for the description, and a flex meta row. `Stat` renders `<div className="stat" role="group" aria-label={label}>` with `type-stat` for the value and `tabular-nums`. `SectionCard` uses a raised surface, hairline border, 8px radius, and a header row. `Breadcrumbs` uses `<nav aria-label="Breadcrumb"><ol>` and sets `aria-current="page"` on the last item. `Badge` uses `data-tone` and the `Icon` component.

- [ ] **Step 4: Add the CSS**

In `primitives-display.css`, style `.page-header`, `.page-header__eyebrow`, `.breadcrumbs`, `.stat`, `.section-card`, `.badge` and their variants using only token variables. Use `min-width: 0`, `overflow-wrap: anywhere`, and flex wrapping so long names survive 320px.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @domain-harness/panel exec vitest run src/components/primitives-display.test.tsx src/styles`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/panel/src/components/badge.tsx apps/panel/src/components/page-header.tsx apps/panel/src/components/breadcrumbs.tsx apps/panel/src/components/stat.tsx apps/panel/src/components/section-card.tsx apps/panel/src/components/primitives-display.test.tsx apps/panel/src/styles/primitives-display.css
git commit -m "feat(panel): add display primitives"
```

---

## Task 3: Feedback Primitives

**Files:**
- Create: `apps/panel/src/components/empty-state.tsx`
- Create: `apps/panel/src/components/skeleton.tsx`
- Create: `apps/panel/src/components/copy-button.tsx`
- Create: `apps/panel/src/components/banner.tsx`
- Create: `apps/panel/src/components/tabs.tsx`
- Create: `apps/panel/src/components/side-sheet.tsx`
- Create: `apps/panel/src/styles/primitives-feedback.css`
- Create: `apps/panel/src/components/primitives-feedback.test.tsx`

**Interfaces:**
- `EmptyState({ icon, title, description, action }: { icon: IconName; title: string; description?: string; action?: ReactNode })`
- `Skeleton({ lines = 3, className }: { lines?: number; className?: string })`
- `CopyButton({ value, label = "Copy", copiedLabel = "Copied" }: { value: string; label?: string; copiedLabel?: string })`
- `Banner({ tone, title, children, action, live = false }: { tone: "notice" | "denial" | "success"; title?: string; children: ReactNode; action?: ReactNode; live?: boolean })`
- `Tabs({ label, tabs, value, onChange }: { label: string; tabs: readonly { id: string; label: string; panelId: string }[]; value: string; onChange: (id: string) => void })`
- `SideSheet({ open, onClose, title, description, children }: { open: boolean; onClose: () => void; title: string; description?: string; children: ReactNode })`

- [ ] **Step 1: Write the failing feedback-primitive tests**

```tsx
// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Banner } from "./banner.tsx";
import { CopyButton } from "./copy-button.tsx";
import { EmptyState } from "./empty-state.tsx";
import { SideSheet } from "./side-sheet.tsx";
import { Skeleton } from "./skeleton.tsx";
import { Tabs } from "./tabs.tsx";

describe("feedback primitives", () => {
  it("EmptyState renders a title, explanation and action", () => {
    render(<EmptyState icon="application" title="No Application yet." description="Place one." action={<button>New</button>} />);
    expect(screen.getByRole("heading", { name: "No Application yet." })).toBeTruthy();
    expect(screen.getByRole("button", { name: "New" })).toBeTruthy();
  });
  it("Skeleton is hidden from assistive technology", () => {
    const { container } = render(<Skeleton lines={4} />);
    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
  });
  it("CopyButton writes the value and announces Copied", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    render(<CopyButton value="01928c7e" />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Copy" })); });
    expect(writeText).toHaveBeenCalledWith("01928c7e");
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
  });
  it("Banner is presentational by default and a live region only when asked", () => {
    const { rerender, container } = render(<Banner tone="denial" title="Refused">Nothing was changed.</Banner>);
    expect(screen.queryByRole("status")).toBeNull();
    expect(container.textContent).toContain("Refused");
    rerender(<Banner tone="denial" title="Refused" live>Nothing was changed.</Banner>);
    expect(screen.getByRole("status").textContent).toContain("Refused");
  });
  it("Tabs move with the arrow keys and expose aria-selected", () => {
    const onChange = vi.fn();
    render(<Tabs label="Evidence" value="overview" onChange={onChange} tabs={[{ id: "overview", label: "Overview", panelId: "p1" }, { id: "history", label: "History", panelId: "p2" }]} />);
    fireEvent.keyDown(screen.getByRole("tab", { name: "Overview" }), { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("history");
    expect(screen.getByRole("tab", { name: "Overview" }).getAttribute("aria-selected")).toBe("true");
  });
  it("SideSheet focuses its title, closes on Escape and returns focus", () => {
    const opener = document.createElement("button");
    opener.textContent = "Open";
    document.body.append(opener);
    opener.focus();
    const onClose = vi.fn();
    const { rerender } = render(<SideSheet open onClose={onClose} title="Create Module">form</SideSheet>);
    expect(document.activeElement?.textContent).toContain("Create Module");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    rerender(<SideSheet open={false} onClose={onClose} title="Create Module">form</SideSheet>);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @domain-harness/panel exec vitest run src/components/primitives-feedback.test.tsx`
Expected: FAIL because the components do not exist.

- [ ] **Step 3: Implement the components**

`Banner` renders `<div className="banner banner--{tone}">`; when `live` is true it adds `role="status"` and `aria-live="polite"`. `Status` remains the one live region for action results. `CopyButton` uses `navigator.clipboard.writeText`, sets `copied` for 2000ms, and renders an `Icon` plus the label. `Tabs` renders `role="tablist"`, each tab with `role="tab"`, `aria-selected`, `aria-controls`, `tabIndex` 0 for selected and -1 for others; ArrowLeft/ArrowRight/Home/End call `onChange`. `SideSheet` renders a `<div className="side-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId}>` overlay; when open, it focuses the title (`tabIndex={-1}`), traps Tab inside the sheet, closes on Escape, and returns focus to the previously focused element on close. `EmptyState` and `Skeleton` are presentational.

- [ ] **Step 4: Add the CSS**

In `primitives-feedback.css`, style `.empty-state`, `.skeleton` (with a slow pulse gated by `prefers-reduced-motion`), `.banner`, `.tabs`, `.side-sheet`, and `.copy-button`. The side sheet is a right-side panel at ≥ 768px and a full-width sheet below. Use `color-mix(in srgb, var(--color-ink) 45%, transparent)` for the overlay backdrop; the style test allows `color-mix` with token variables.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @domain-harness/panel exec vitest run src/components/primitives-feedback.test.tsx src/styles`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/panel/src/components/empty-state.tsx apps/panel/src/components/skeleton.tsx apps/panel/src/components/copy-button.tsx apps/panel/src/components/banner.tsx apps/panel/src/components/tabs.tsx apps/panel/src/components/side-sheet.tsx apps/panel/src/components/primitives-feedback.test.tsx apps/panel/src/styles/primitives-feedback.css
git commit -m "feat(panel): add feedback primitives"
```

---

## Task 4: Data Primitives

**Files:**
- Create: `apps/panel/src/components/data-table.tsx`
- Create: `apps/panel/src/components/toolbar.tsx`
- Create: `apps/panel/src/styles/primitives-data.css`
- Create: `apps/panel/src/components/primitives-data.test.tsx`

**Interfaces:**
- `SortDirection = "asc" | "desc"`
- `SortState = { column: string; direction: SortDirection }`
- `sortRows<T>(rows: readonly T[], sort: SortState | null, value: (row: T, column: string) => string | number): T[]`
- `DataTable<T>({ caption, columns, rows, rowKey, empty, footer }: { caption: string; columns: readonly { id: string; header: string; align?: "start" | "end" }[]; rows: readonly T[]; rowKey: (row: T) => string; empty?: ReactNode; footer?: ReactNode })`
- `Toolbar({ searchLabel, searchValue, onSearch, filters, count, sort, onSort, groupBy, onGroupBy }: { searchLabel: string; searchValue: string; onSearch: (value: string) => void; filters?: ReactNode; count: string; sort?: SortState | null; onSort?: (sort: SortState) => void; groupBy?: ReactNode; onGroupBy?: (value: string) => void })`

- [ ] **Step 1: Write the failing data-primitive tests**

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DataTable, sortRows } from "./data-table.tsx";
import { Toolbar } from "./toolbar.tsx";

const rows = [{ id: "b", name: "Beta", count: 2 }, { id: "a", name: "Alpha", count: 10 }];

describe("data primitives", () => {
  it("sorts rows without mutating the input", () => {
    const sorted = sortRows(rows, { column: "name", direction: "asc" }, (row, column) => row[column as "name"]);
    expect(sorted.map((row) => row.id)).toEqual(["a", "b"]);
    expect(rows.map((row) => row.id)).toEqual(["b", "a"]);
  });
  it("sorts numbers numerically", () => {
    const sorted = sortRows(rows, { column: "count", direction: "desc" }, (row, column) => row[column as "count"]);
    expect(sorted.map((row) => row.count)).toEqual([10, 2]);
  });
  it("DataTable renders a caption, headers, rows, and an empty state", () => {
    const { rerender } = render(<DataTable caption="Applications" columns={[{ id: "name", header: "Application" }]} rows={rows} rowKey={(row) => row.id} />);
    expect(screen.getByRole("table", { name: "Applications" })).toBeTruthy();
    expect(screen.getAllByRole("columnheader").map((th) => th.textContent)).toEqual(["Application"]);
    expect(screen.getAllByRole("row")).toHaveLength(3);
    rerender(<DataTable caption="Applications" columns={[{ id: "name", header: "Application" }]} rows={[]} rowKey={(row) => row.id} empty={<p>No Application yet.</p>} />);
    expect(screen.getByText("No Application yet.")).toBeTruthy();
  });
  it("Toolbar exposes a labelled search and the result count", () => {
    const onSearch = vi.fn();
    render(<Toolbar searchLabel="Search applications" searchValue="" onSearch={onSearch} count="3 Applications" />);
    fireEvent.change(screen.getByLabelText("Search applications"), { target: { value: "checkout" } });
    expect(onSearch).toHaveBeenCalledWith("checkout");
    expect(screen.getByText("3 Applications")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @domain-harness/panel exec vitest run src/components/primitives-data.test.tsx`
Expected: FAIL because the components do not exist.

- [ ] **Step 3: Implement the components**

`sortRows` copies the array, compares with `localeCompare` for strings and subtraction for numbers, and returns the copy. `DataTable` wraps the table in `<div className="data-table__scroll" tabIndex={0}>` for keyboard scroll, renders `<caption>`, and uses `<th scope="col">`. `Toolbar` renders a search input with `type="search"`, a count, and slots for filters, group-by, and sort.

- [ ] **Step 4: Add the CSS**

In `primitives-data.css`, style `.data-table`, `.data-table__scroll`, `.data-table th` (sticky, `surface-subtle`), rows (hairline, hover `surface-base`), and `.toolbar` (flex wrap, search grows, count tabular). Ensure `min-width: 0` and horizontal scroll at 320px.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @domain-harness/panel exec vitest run src/components/primitives-data.test.tsx src/styles`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/panel/src/components/data-table.tsx apps/panel/src/components/toolbar.tsx apps/panel/src/components/primitives-data.test.tsx apps/panel/src/styles/primitives-data.css
git commit -m "feat(panel): add data table and toolbar primitives"
```

---

## Task 5: App Shell and Sign-Out

**Files:**
- Modify: `apps/panel/src/components/panel-chrome.tsx`
- Modify: `apps/panel/src/routes/panel-layout.tsx`
- Create: `apps/panel/src/routes/sign-out.ts`
- Create: `apps/panel/src/routes/sign-out.test.ts`
- Modify: `apps/panel/src/routes.ts`
- Modify: `apps/panel/src/components/components.test.tsx`
- Modify: `apps/panel/src/styles/shell.css`

**Interfaces:**
- `PANEL_NAV` becomes grouped: `readonly { label: string; items: readonly { to: string; label: string; icon: IconName }[] }[]`.
- `PanelChrome({ role, children }: { role: Role; children?: ReactNode })` renders the skip link, the dark rail, the mobile bar/drawer, the account block, and `<main id="main" className="panel-main">{children}</main>`.
- `action({ request }: ActionFunctionArgs): Response` clears the session cookie and redirects to `/sign-in`.
- Route entry: `{ path: "sign-out", file: "routes/sign-out.ts" }` in `routes.ts`.

- [ ] **Step 1: Write the failing shell tests**

Update `components.test.tsx` to assert:

```tsx
it("groups the seven destinations and marks the current page", async () => {
  renderPanel("/inventory");
  const nav = await screen.findByRole("navigation", { name: "Management panel" });
  expect(nav.textContent).toContain("Monitor");
  expect(nav.textContent).toContain("Govern");
  expect(nav.textContent).toContain("Operate");
  expect([...nav.querySelectorAll("a")].map((a) => a.textContent)).toEqual([
    "Inventory", "Compilations", "Standards", "Project tree", "Guidance access",
    "New-application flow", "Accepted deviation",
  ]);
  expect(screen.getByRole("link", { current: "page" }).textContent).toBe("Inventory");
});

it("offers a sign-out form in the account block", async () => {
  renderPanel("/inventory");
  const signOut = await screen.findByRole("button", { name: "Sign out" });
  expect(signOut.closest("form")?.getAttribute("action")).toBe("/sign-out");
  expect(signOut.closest("form")?.getAttribute("method")).toBe("post");
});

it("opens and closes the mobile drawer with the keyboard", async () => {
  renderPanel("/inventory");
  const menu = await screen.findByRole("button", { name: "Menu" });
  fireEvent.click(menu);
  expect(menu.getAttribute("aria-expanded")).toBe("true");
  fireEvent.keyDown(document, { key: "Escape" });
  expect(menu.getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(menu);
});
```

Create `routes/sign-out.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { action } from "./sign-out.ts";

describe("sign-out", () => {
  it("clears the session cookie and redirects", () => {
    const response = action({ request: new Request("http://localhost/sign-out", { method: "POST" }) } as never);
    expect((response as Response).headers.get("location")).toBe("/sign-in");
    expect((response as Response).headers.get("set-cookie")).toMatch(/dh_session=; Max-Age=0/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @domain-harness/panel exec vitest run src/components/components.test.tsx src/routes/sign-out.test.ts`
Expected: FAIL because the grouped nav, sign-out control, and route do not exist.

- [ ] **Step 3: Implement the shell**

`PanelChrome` renders:

```tsx
<a className="skip-link" href="#main">Skip to content</a>
<div className="shell">
  <aside className="shell__rail" aria-label="Management panel">
    <p className="shell__wordmark">Domain Harness</p>
    <nav aria-label="Management panel">
      {PANEL_NAV.map((group) => (
        <section key={group.label} className="shell__group">
          <h2 className="shell__group-label type-caption">{group.label}</h2>
          <ul>{group.items.map((item) => <li key={item.to}><NavLink to={item.to}><Icon name={item.icon} />{item.label}</NavLink></li>)}</ul>
        </section>
      ))}
    </nav>
    <div className="shell__account">
      <p className="type-label">{role}</p>
      <Form method="post" action="/sign-out"><button type="submit" className="shell__signout"><Icon name="sign-out" />Sign out</button></Form>
    </div>
  </aside>
  <div className="shell__content">
    <header className="shell__mobilebar">
      <button type="button" aria-expanded={drawerOpen} aria-controls="shell-rail" onClick={() => { setDrawerOpen(!drawerOpen); }}>
        <Icon name="menu" label="Menu" />
      </button>
      <p className="shell__wordmark">Domain Harness</p>
    </header>
    <main id="main" className="panel-main">{children}</main>
  </div>
</div>
```

The mobile drawer is a state-driven overlay below 1024px: a button with `aria-expanded` and `aria-controls`, the same rail rendered in an overlay, Esc closes it and returns focus to the button. Keep `role` as text and the seven links. Desktop has no top bar; page breadcrumbs live in the content.

`panel-layout.tsx` passes `role` and the alert band + `<Outlet />` as children of `PanelChrome`. The skip link target `#main` exists once, inside `PanelChrome`.

`sign-out.ts`:

```ts
import { redirect } from "react-router";
import { clearSessionCookie } from "../session.server.ts";

export function action({ request }: { request: Request }): Response {
  return redirect("/sign-in", { headers: { "Set-Cookie": clearSessionCookie(request) } });
}
```

- [ ] **Step 4: Add the shell CSS**

In `shell.css`, style the dark rail, groups, active state (cream tint, 600 weight, no gold), account block, skip link (visually hidden until focused), mobile bar/drawer, and the 1024px breakpoint. Use only tokens. Ensure the rail text meets contrast in both modes.

- [ ] **Step 5: Run the shell tests and the full panel suite**

Run: `pnpm --filter @domain-harness/panel exec vitest run src/components/components.test.tsx src/routes/sign-out.test.ts src/routes`
Expected: PASS. Update the tab-order test to include the skip link and the sign-out button, and update any route test that relied on the old nav text order. The table scroll wrapper may add `tabindex="0"`; the zero-tabindex assertion must exclude it or be scoped to the rail.

- [ ] **Step 6: Commit**

```bash
git add apps/panel/src/components/panel-chrome.tsx apps/panel/src/routes/panel-layout.tsx apps/panel/src/routes/sign-out.ts apps/panel/src/routes/sign-out.test.ts apps/panel/src/routes.ts apps/panel/src/components/components.test.tsx apps/panel/src/styles/shell.css
git commit -m "feat(panel): add operational shell and sign-out"
```

---

## Task 6: Sign-In

**Files:**
- Modify: `apps/panel/src/components/sign-in-form.tsx`
- Modify: `apps/panel/src/routes/sign-in.tsx` (only if the confirmation state needs loader data)
- Modify: `apps/panel/src/routes/sign-in.test.tsx`
- Modify: `apps/panel/src/styles/sign-in.css`

**Interfaces:**
- `SignInForm({ notice, email }: { notice: SignInNotice; email: string })` keeps its signature.
- The "sent" state replaces the form with a confirmation panel; the "use a different address" action returns to the form without a network call.

- [ ] **Step 1: Update the sign-in tests**

Keep every existing assertion about focus, status text, field errors, and the single gold button. Add:

```tsx
it("shows a split brand panel and a single gold action", async () => {
  renderSignIn();
  expect(await screen.findByText("Domain Harness")).toBeTruthy();
  expect(screen.getByText(/software-construction Standards/i)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Email me a sign-in link" }).className).toBe("button-primary");
});

it("replaces the form with a confirmation panel after sending", async () => {
  registry(202, {});
  renderSignIn();
  await submit("bea@acme.io");
  expect(await screen.findByRole("heading", { name: "Check your email" })).toBeTruthy();
  expect(screen.getByText("bea@acme.io")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Use a different address" }));
  expect(screen.getByLabelText("Email address")).toBeTruthy();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @domain-harness/panel exec vitest run src/routes/sign-in.test.tsx`
Expected: FAIL on the new assertions.

- [ ] **Step 3: Implement the split layout and confirmation state**

`SignInForm` renders `<main className="sign-in-shell">` with two regions: `.sign-in-brand` (dark surface, wordmark, one-line statement, three evidence points, cream rule) and `.sign-in-panel` (cream, heading, helper, `Status`, form or confirmation). On `notice === "sent"`, render the confirmation panel with an `h2` "Check your email", the address, a `Status` carrying the same "Check your email for a sign-in link" text, and a secondary "Use a different address" button that returns to the form without a network call. Move focus to the confirmation heading. Use `useState` only for "use a different address"; the notice remains server-driven. Keep the focus-on-open effect and the live region.

- [ ] **Step 4: Add the CSS**

In `sign-in.css`, style the two-column layout at ≥ 900px, the stacked layout below, the brand panel with `sidebar`/`sidebar-ink`, the form panel on cream, and the confirmation panel. Gold appears only on `.button-primary`.

- [ ] **Step 5: Run the tests and the full panel suite**

Run: `pnpm --filter @domain-harness/panel exec vitest run src/routes/sign-in.test.tsx src/styles`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/panel/src/components/sign-in-form.tsx apps/panel/src/routes/sign-in.tsx apps/panel/src/routes/sign-in.test.tsx apps/panel/src/styles/sign-in.css
git commit -m "feat(panel): redesign sign-in"
```

---

## Task 7: Inventory

**Files:**
- Modify: `apps/panel/src/routes/inventory.tsx`
- Modify: `apps/panel/src/routes/inventory.test.tsx`
- Modify: `apps/panel/src/styles/inventory.css`

**Interfaces:**
- Keep `InventoryLoaderData`, `groupApplications`, and `evidenceMap` unchanged.
- New local helpers: `inventorySummary(applications, evidence): { applications: number; projects: number; agentTools: number; notCompiled: number }`, `filterApplications(applications, query, projectId): ApplicationInfo[]`, `sortApplications(applications, sort): ApplicationInfo[]`.
- `ApplicationGroup` gains `count` only in the rendered header; the type stays.

- [ ] **Step 1: Update the Inventory tests**

Keep the grouping, filter, fallback, empty, loading, and loader assertions. Change the table name/headers to the new structure and add:

```tsx
it("shows a summary derived from the reads", async () => {
  renderInventory(fullReads());
  const applications = await screen.findByRole("group", { name: "Applications" });
  expect(within(applications).getByText("3")).toBeTruthy();
  const projects = screen.getByRole("group", { name: "Projects" });
  expect(within(projects).getByText("3")).toBeTruthy();
  const agentTools = screen.getByRole("group", { name: "Agent tools" });
  expect(within(agentTools).getByText("1")).toBeTruthy();
  const notCompiled = screen.getByRole("group", { name: "Not yet compiled" });
  expect(within(notCompiled).getByText("2")).toBeTruthy();
});

it("searches by description or Project and reports the result count", async () => {
  renderInventory(fullReads());
  await screen.findByRole("table", { name: /Applications/ });
  fireEvent.change(screen.getByLabelText("Search applications"), { target: { value: "intake" } });
  expect(screen.getByText("Intake form")).toBeTruthy();
  expect(screen.queryByText("Checkout service")).toBeNull();
});

it("handles 60 applications without dropping rows", async () => {
  const many = Array.from({ length: 60 }, (_, index) => ({ ...flow, id: `${flow.id}-${index}`, description: `Application ${index}` }));
  renderInventory({ applications: Promise.resolve({ kind: "ok", value: { applications: many } }) });
  await screen.findByRole("table", { name: /Applications/ });
  expect(screen.getAllByRole("row")).toHaveLength(61);
  expect(screen.getByText("60 Applications")).toBeTruthy();
});

it("keeps a 500-character description visible and wrapped", async () => {
  const long = { ...flow, description: "A".repeat(500) };
  renderInventory({ applications: Promise.resolve({ kind: "ok", value: { applications: [long] } }) });
  const link = await screen.findByRole("link", { name: "A".repeat(500) });
  expect(link.className).toContain("application-name");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @domain-harness/panel exec vitest run src/routes/inventory.test.tsx`
Expected: FAIL on the new structure.

- [ ] **Step 3: Implement the page**

Render:

```tsx
<PageHeader eyebrow="Monitor" title="Inventory" description="Every Application the Company has placed, grouped by agent tool." actions={<Link className="button-primary" to="/new-application">New application</Link>} />
<Summary>...
<Toolbar searchLabel="Search applications" ... />
{groups.map((group) => (
  <SectionCard key={group.key} title={`${group.heading} · ${group.applications.length}`}>
    <DataTable caption={`Applications — ${group.heading}`} ... />
  </SectionCard>
))}
```

The status cell uses `Badge`: `No Compilation yet` (neutral, `dot`) or `Evidence received` (outline, `check`). The "Placement" column is removed; the project is a secondary line under the Application name. The "Added" column uses `formatDate(createdAt)`. The evidence note becomes a `Banner tone="notice"` only when evidence is unavailable. The empty state uses `EmptyState` with the New-application action.

- [ ] **Step 4: Add the CSS**

In `inventory.css`, style `.inventory-summary`, `.inventory-groups`, `.application-name` (wrap anywhere), and the group header. Keep the table scroll behavior.

- [ ] **Step 5: Run the tests and the full panel suite**

Run: `pnpm --filter @domain-harness/panel exec vitest run src/routes/inventory.test.tsx && pnpm --filter @domain-harness/panel test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/panel/src/routes/inventory.tsx apps/panel/src/routes/inventory.test.tsx apps/panel/src/styles/inventory.css
git commit -m "feat(panel): redesign inventory"
```

---

## Task 8: Application

**Files:**
- Modify: `apps/panel/src/routes/application.tsx`
- Modify: `apps/panel/src/routes/application.test.tsx`
- Modify: `apps/panel/src/styles/application.css`

**Interfaces:**
- Keep `deriveEvidence`, `DeviationRow`, and all existing copy constants.
- Add `compilationHistory(compilations): readonly { id: string; type: string; sequence: number; occurredAt: string; detail: string }[]` for the History section.
- Add `applicationFacts(application): { project: string; agentTool: string; created: string }`.

- [ ] **Step 1: Update the Application tests**

Keep the derivation, adherence, verdict, guidance, deviation, correction-copy, binding-refusal, and loader assertions. Add:

```tsx
it("shows adherence, verdict, guidance and open deviations as summary facts", async () => {
  renderApplication(/* existing fixture */);
  expect(await screen.findByText("Adherence")).toBeTruthy();
  expect(screen.getByText("8 of 10")).toBeTruthy();
  expect(screen.getByText("pass")).toBeTruthy();
  expect(screen.getByText("Guidance consulted")).toBeTruthy();
  expect(screen.getByText("2 open")).toBeTruthy();
});

it("lists the stored Compilations in reverse sequence order", async () => {
  renderApplication(/* fixture with gate_run, guidance, deviation */);
  expect(await screen.findByRole("heading", { name: "History" })).toBeTruthy();
  expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
    expect.stringContaining("Gate run"),
    expect.stringContaining("Guidance"),
  ]);
});

it("keeps the deviation table and the correction copy action", async () => {
  renderApplication(/* fixture with one open row */);
  expect(await screen.findByRole("table", { name: "Deviations" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
});

it("keeps a 500-character description visible and wrapped", async () => {
  const long = "A".repeat(500);
  renderApplication(/* fixture with application description long */);
  const heading = await screen.findByRole("heading", { level: 1, name: long });
  expect(heading.className).toContain("type-page-title");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @domain-harness/panel exec vitest run src/routes/application.test.tsx`
Expected: FAIL on the new structure.

- [ ] **Step 3: Implement the page**

Render `<Breadcrumbs items={[{ label: "Inventory", to: "/inventory" }, { label: application.application.description }]} />` above the `PageHeader`. The `PageHeader` carries the application description, a project link, an agent tool badge, a listed date, and a `CopyButton` for the id. Render a `Stat` row: Adherence, Verdict, Guidance, Open deviations. Render the binding refusal as a `Banner tone="denial"` with the recovery text and a link. Render a `SectionCard` for Deviations with a `DataTable` at ≥ 900px and stacked `.deviation-card` elements below (CSS-only: render the table and set `display: block` at the breakpoint, or render both with `hidden` classes; choose one and test the accessible table at desktop). Render a `SectionCard` for History with an ordered list. Render an aside with Application facts and a link to the Project. Keep the empty state and the correction copy.

- [ ] **Step 4: Add the CSS**

In `application.css`, style `.application-layout` (two columns at ≥ 1280px), `.application-summary`, `.deviation-card`, `.correction-instruction`, and `.history-list`. Ensure long Standard ids wrap.

- [ ] **Step 5: Run the tests and the full panel suite**

Run: `pnpm --filter @domain-harness/panel exec vitest run src/routes/application.test.tsx && pnpm --filter @domain-harness/panel test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/panel/src/routes/application.tsx apps/panel/src/routes/application.test.tsx apps/panel/src/styles/application.css
git commit -m "feat(panel): redesign application evidence"
```

---

## Task 9: Standards and Module Standards

**Files:**
- Modify: `apps/panel/src/routes/standards.tsx`
- Modify: `apps/panel/src/components/modules-section.tsx`
- Modify: `apps/panel/src/routes/module-standards.tsx`
- Modify: `apps/panel/src/components/standard-form.tsx`
- Modify: `apps/panel/src/components/design-system-form.tsx`
- Modify: `apps/panel/src/routes/standards.test.tsx`
- Modify: `apps/panel/src/routes/module-standards.test.tsx`
- Modify: `apps/panel/src/routes/module-standards.action.test.ts`
- Modify: `apps/panel/src/routes/standards.action.test.ts`
- Modify: `apps/panel/src/styles/standards.css`

**Interfaces:**
- `ModulesSection` keeps its props and action data; it renders the new summary, toolbar, table, and side sheets.
- `StandardForm` and `DesignSystemForm` keep their props and field names; they render inside a `SideSheet` when editing or publishing.
- Add `modulesSummary(list: ModuleList): { modules: number; codeStacks: number; designSystems: number; withoutOwner: number }`.
- Add `standardsSummary(list: StandardList): { standards: number; projects: number; lastPublished: string }`.

- [ ] **Step 1: Update the Standards tests**

Keep the create-module, assign-owner, denial, validation, and action assertions. Add:

```tsx
it("shows a summary of Modules by kind and ownership", async () => {
  renderStandards(/* two modules, one unowned */);
  expect(await screen.findByText("Modules")).toBeTruthy();
  expect(screen.getByText("1")).toBeTruthy();
  expect(screen.getByText("Without an owner")).toBeTruthy();
});

it("opens the owner side sheet from a row action and keeps focus inside it", async () => {
  renderStandards(/* one module */);
  fireEvent.click(await screen.findByRole("button", { name: "Change owner" }));
  expect(screen.getByRole("dialog", { name: /Standard owner/ })).toBeTruthy();
  expect(document.activeElement?.textContent).toContain("Standard owner");
});

it("keeps the publish form's field names and intents", async () => {
  renderModuleStandards(/* fixture */);
  expect(await screen.findByLabelText("Category")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Publish" })).toBeTruthy();
});

it("keeps long Module and Standard names visible and wrapped", async () => {
  const long = "S".repeat(120);
  renderModuleStandards(/* fixture with module.name and standard slot name long */);
  expect((await screen.findByRole("heading", { level: 1, name: long })).className).toContain("type-page-title");
  expect(screen.getByRole("link", { name: long }).className).toContain("standard-name");
});

it("handles 60 standards without dropping rows", async () => {
  renderModuleStandards(/* fixture with 60 standards */);
  await screen.findByRole("table", { name: /Standards/ });
  expect(screen.getAllByRole("row")).toHaveLength(61);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @domain-harness/panel exec vitest run src/routes/standards.test.tsx src/routes/module-standards.test.tsx`
Expected: FAIL on the new structure.

- [ ] **Step 3: Implement the Modules page**

`standards.tsx` renders `PageHeader` with a "Create Module" primary action. `ModulesSection` renders a summary row, a `Toolbar` (search + kind filter + owner filter), a `DataTable` of Modules with `Badge` for kind and ownership, and a row action "Change owner" / "Assign owner" that opens the `SideSheet` containing the existing owner form. The create form moves into a `SideSheet` triggered by the header action. On success, the sheet closes; on refusal, it stays open with the submitted values. On the Module Standards page, render `<Breadcrumbs items={[{ label: "Standards", to: "/standards" }, { label: module.name }]} />` above the `PageHeader`.

- [ ] **Step 4: Implement the Module Standards page**

Render `PageHeader` with the Module name, kind badge, owner, and a "Publish standard" primary action. Render a summary row and a toolbar (search by name, entry-kind filter, status filter, sort). Render the table without the raw Standard id column; add an expandable detail row with the id and a `CopyButton`. Render the publish/edit form in a `SideSheet`; the edit link keeps `?edit=`. The success banner includes the Standard id, version, project, and timestamp with a copy action. Keep the `DesignSystemForm` field set and the `?edit=` deep link.

- [ ] **Step 5: Add the CSS**

In `standards.css`, style `.standards-summary`, `.standards-toolbar`, `.standard-detail`, `.owner-cell`, and the side-sheet form layout. Use `overflow-wrap: anywhere` for long names and ids.

- [ ] **Step 6: Run the tests and the full panel suite**

Run: `pnpm --filter @domain-harness/panel exec vitest run src/routes/standards.test.tsx src/routes/module-standards.test.tsx src/routes/standards.action.test.ts src/routes/module-standards.action.test.ts && pnpm --filter @domain-harness/panel test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/panel/src/routes/standards.tsx apps/panel/src/components/modules-section.tsx apps/panel/src/routes/module-standards.tsx apps/panel/src/components/standard-form.tsx apps/panel/src/components/design-system-form.tsx apps/panel/src/routes/standards.test.tsx apps/panel/src/routes/module-standards.test.tsx apps/panel/src/routes/standards.action.test.ts apps/panel/src/routes/module-standards.action.test.ts apps/panel/src/styles/standards.css
git commit -m "feat(panel): redesign standards and module standards"
```

---

## Task 10: New-Application Flow

**Files:**
- Modify: `apps/panel/src/routes/new-application.tsx`
- Modify: `apps/panel/src/components/new-application.tsx`
- Modify: `apps/panel/src/routes/new-application.test.tsx`
- Modify: `apps/panel/src/styles/new-application.css`

**Interfaces:**
- Keep all four intents (`place`, `register`, `guidance-endpoint`, `boilerplate`) and their action data.
- Add `newApplicationStep(actionData): "place" | "boilerplate" | "result"` for the progress rail.
- Artifact cards copy the path and use the existing kind label as the description.

- [ ] **Step 1: Update the New-application tests**

Keep the heading, description, Project select, gold button, register, guidance endpoint, boilerplate, and refusal assertions. Add:

```tsx
it("shows the Place → Generate → Result rail and the current step", async () => {
  renderNewApplication();
  expect(await screen.findByText("Place")).toBeTruthy();
  expect(screen.getByText("Generate")).toBeTruthy();
  expect(screen.getByText("Result")).toBeTruthy();
});

it("puts Register existing in its own tab, not on the rail", async () => {
  renderNewApplication();
  expect(screen.getByRole("tab", { name: "Register existing" })).toBeTruthy();
  expect(screen.getByRole("tab", { name: "Place an application" })).toBeTruthy();
});

it("renders Boilerplate artifacts as cards that copy the path", async () => {
  renderNewApplication(/* boilerplate actionData */);
  expect(await screen.findByRole("heading", { name: "Boilerplate" })).toBeTruthy();
  expect(screen.getAllByRole("button", { name: "Copy" }).length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @domain-harness/panel exec vitest run src/routes/new-application.test.tsx`
Expected: FAIL on the new structure.

- [ ] **Step 3: Implement the page**

Render `PageHeader` with the role-aware description. Render the progress rail. Render `Tabs` for "Place an application", "Generate Boilerplate", "Register existing"; the Place panel contains the existing `NewApplicationForm` and `ProjectField`; the Generate panel appears after a successful place with the `BoilerplateForm`; the Register panel contains `RegisterApplicationForm`. Render the Boilerplate result as `SectionCard` with artifact cards (kind, path, `CopyButton`) and the identification-file note. Render the Company Guidance endpoint as a separate `SectionCard` marked "Buyer" with the existing form. Keep all intents and action data.

- [ ] **Step 4: Add the CSS**

In `new-application.css`, style `.flow-rail`, `.flow-step`, `.artifact-grid`, `.artifact-card`, and the tab panels. The rail collapses to a vertical list below 768px.

- [ ] **Step 5: Run the tests and the full panel suite**

Run: `pnpm --filter @domain-harness/panel exec vitest run src/routes/new-application.test.tsx && pnpm --filter @domain-harness/panel test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/panel/src/routes/new-application.tsx apps/panel/src/components/new-application.tsx apps/panel/src/routes/new-application.test.tsx apps/panel/src/styles/new-application.css
git commit -m "feat(panel): redesign new-application flow"
```

---

## Task 11: Project Tree

**Files:**
- Modify: `apps/panel/src/routes/project-tree.tsx`
- Modify: `apps/panel/src/components/project-tree.tsx`
- Modify: `apps/panel/src/routes/project-tree.test.tsx`
- Modify: `apps/panel/src/routes/project-tree.action.test.ts`
- Modify: `apps/panel/src/styles/project-tree.css`

**Interfaces:**
- Keep `ProjectTreeView`, `EffectiveSetTable`, `ChildPermissionPanel`, `BuildGrantPanel`, `CreateProjectForm`, `ChangeParentForm`, and all action intents.
- Add `projectTreeHeader(tree, selected): { parent: string; level: string; children: number }`.
- The context pane uses `Tabs` with ids `effective`, `access`, `builds`.

- [ ] **Step 1: Update the Project tree tests**

Keep the tree semantics, selection, effective set, permission, build grant, cycle, and action assertions. Add:

```tsx
it("shows the selected Project in a two-pane layout with context tabs", async () => {
  renderProjectTree(/* fixture */);
  expect(await screen.findByRole("heading", { name: "Acme" })).toBeTruthy();
  expect(screen.getByRole("tab", { name: "Effective standards" })).toBeTruthy();
  expect(screen.getByRole("tab", { name: "Access" })).toBeTruthy();
  expect(screen.getByRole("tab", { name: "Build grants" })).toBeTruthy();
});

it("opens Create project in a side sheet", async () => {
  renderProjectTree(/* fixture */);
  fireEvent.click(await screen.findByRole("button", { name: "Create project" }));
  expect(screen.getByRole("dialog", { name: /Create project/ })).toBeTruthy();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @domain-harness/panel exec vitest run src/routes/project-tree.test.tsx`
Expected: FAIL on the new structure.

- [ ] **Step 3: Implement the page**

Render `<Breadcrumbs items={[{ label: "Project tree", to: "/projects" }, { label: selected.name }]} />` above the `PageHeader`. The `PageHeader` carries the selected Project name, level, parent, and actions. Render the tree in a `SectionCard` with chevrons and the existing ARIA tree semantics. Render the context pane with `Tabs`: Effective standards (the existing table), Access (child permissions), Build grants. Move Create project and Change parent into `SideSheet`s. Keep the selected Project URL (`?project=`) and all action intents.

- [ ] **Step 4: Add the CSS**

In `project-tree.css`, style `.project-tree-layout`, `.project-tree-node`, `.project-tree-node__chevron`, `.tree-context`, and the side-sheet forms. Keep the existing indentation and focus behavior.

- [ ] **Step 5: Run the tests and the full panel suite**

Run: `pnpm --filter @domain-harness/panel exec vitest run src/routes/project-tree.test.tsx src/routes/project-tree.action.test.ts && pnpm --filter @domain-harness/panel test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/panel/src/routes/project-tree.tsx apps/panel/src/components/project-tree.tsx apps/panel/src/routes/project-tree.test.tsx apps/panel/src/routes/project-tree.action.test.ts apps/panel/src/styles/project-tree.css
git commit -m "feat(panel): redesign project tree"
```

---

## Task 12: Accepted Deviation

**Files:**
- Modify: `apps/panel/src/routes/accepted-deviation.tsx`
- Modify: `apps/panel/src/routes/accepted-deviation.test.tsx`
- Modify: `apps/panel/src/styles/accepted-deviation.css`

**Interfaces:**
- Keep all `AcceptedDeviationField` names, the `record` intent, the paste parser, and the resolved-version behavior.
- Add `acceptanceStatus(record, now): "active" | "expired"` based on `end`.
- Add `groupAcceptanceFields` only if it simplifies the JSX; do not rename fields.

- [ ] **Step 1: Update the Accepted-deviation tests**

Keep the paste, prefill, validation, resolved version, builder denial, plan refusal, and record assertions. Add:

```tsx
it("renders stored acceptances as cards with an Active or Expired badge", async () => {
  renderAcceptedDeviation(/* fixture with one active and one expired */);
  expect(await screen.findByText("Stored acceptances")).toBeTruthy();
  expect(screen.getByText("Active")).toBeTruthy();
  expect(screen.getByText("Expired")).toBeTruthy();
});

it("puts the paste area first and shows the parsed match key", async () => {
  renderAcceptedDeviation(/* fixture */);
  expect(screen.getByLabelText("CI Gate deviation log line")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("CI Gate deviation log line"), { target: { value: "..." } });
  fireEvent.click(screen.getByRole("button", { name: "Use this line" }));
  expect(screen.getByDisplayValue("...")).toBeTruthy();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @domain-harness/panel exec vitest run src/routes/accepted-deviation.test.tsx`
Expected: FAIL on the new structure.

- [ ] **Step 3: Implement the page**

Render `PageHeader` with the explanation and the back link. Render a two-column layout: the form on the left (`SectionCard` titled "Record acceptance") and `StoredRecords` on the right. The form is grouped into three fieldsets: Match the Deviation (paste area first, then the match-key fields, then the resolved version), Justification and window, and Review (summary + primary submit). The stored records become cards with an Active/Expired `Badge`, the subject, application, standard + version, window, alert interval, buyer, and justification. Keep every field name, error, and intent.

- [ ] **Step 4: Add the CSS**

In `accepted-deviation.css`, style `.accepted-deviation-layout`, `.acceptance-group`, `.acceptance-card`, `.acceptance-card__meta`, and the paste preview. Keep the date and alert interval fields in a two-column row at ≥ 768px.

- [ ] **Step 5: Run the tests and the full panel suite**

Run: `pnpm --filter @domain-harness/panel exec vitest run src/routes/accepted-deviation.test.tsx && pnpm --filter @domain-harness/panel test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/panel/src/routes/accepted-deviation.tsx apps/panel/src/routes/accepted-deviation.test.tsx apps/panel/src/styles/accepted-deviation.css
git commit -m "feat(panel): redesign accepted deviation"
```

---

## Task 13: Compilations

**Files:**
- Modify: `apps/panel/src/routes/compilations.tsx`
- Modify: `apps/panel/src/routes/compilations.test.tsx`
- Modify: `apps/panel/src/styles/compilations.css`

**Interfaces:**
- Keep `bundleAgeHours`, `isBundleStale`, `dropAnnouncement`, and every copy constant.
- Add `compilationsSummary(bundles, health): { services: number; stale: number; pending: number; drops: number }`.
- Tabs: `overview`, `schemas`, `drops`.

- [ ] **Step 1: Update the Compilations tests**

Keep the schema, read-state, bundle-status, stale, health, drop, and denial assertions. Add:

```tsx
it("shows a health summary before the tabs", async () => {
  renderCompilations(/* fixture with one stale bundle, pending 2, one drop */);
  const services = await screen.findByRole("group", { name: "Services reporting" });
  expect(within(services).getByText("1")).toBeTruthy();
  const pending = screen.getByRole("group", { name: "Pending" });
  expect(within(pending).getByText("2")).toBeTruthy();
});

it("shows an em dash, not a stale number, when a read is unavailable", async () => {
  renderCompilations({ bundles: Promise.resolve({ kind: "unavailable" }), health: Promise.resolve({ kind: "unavailable" }) });
  const services = await screen.findByRole("group", { name: "Services reporting" });
  expect(within(services).getByText("—")).toBeTruthy();
  expect(screen.queryByText("undefined")).toBeNull();
});

it("puts the schemas behind the Schemas tab and keeps them available on cold load", async () => {
  renderCompilations(/* fixture */);
  expect(screen.getByRole("tab", { name: "Schemas" })).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "Schemas" }));
  expect(screen.getByText("Compilation schemas")).toBeTruthy();
});

it("announces drops on the Overview tab when a count is above zero", async () => {
  renderCompilations(/* fixture with a drop */);
  expect(await screen.findByRole("status")).toBeTruthy();
  expect(screen.getByText(/Compilation drop/)).toBeTruthy();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @domain-harness/panel exec vitest run src/routes/compilations.test.tsx`
Expected: FAIL on the new structure.

- [ ] **Step 3: Implement the page**

Render `PageHeader`, the summary row, and `Tabs` for Overview / Schemas / Drops. Overview contains the bundle-status `DataTable` (with `Badge` for fresh/stale/frozen and `CopyButton` for the hash) and Collector-health cards. Schemas contains the read state and the accordion of `SchemaReader` sections. Drops contains the `dropAnnouncement` lines. Keep every section's own `Suspense` and its unavailable/session-ended states.

- [ ] **Step 4: Add the CSS**

In `compilations.css`, style `.compilations-summary`, `.schema-accordion`, `.bundle-table`, `.health-card`, and `.drop-banner`. Long hashes wrap with `overflow-wrap: anywhere`.

- [ ] **Step 5: Run the tests and the full panel suite**

Run: `pnpm --filter @domain-harness/panel exec vitest run src/routes/compilations.test.tsx && pnpm --filter @domain-harness/panel test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/panel/src/routes/compilations.tsx apps/panel/src/routes/compilations.test.tsx apps/panel/src/styles/compilations.css
git commit -m "feat(panel): redesign compilations"
```

---

## Task 14: Guidance Access

**Files:**
- Modify: `apps/panel/src/routes/guidance-access.tsx`
- Modify: `apps/panel/src/routes/guidance-access.test.tsx`
- Modify: `apps/panel/src/styles/guidance-access.css`

**Interfaces:**
- Keep the `save` and `mint` intents, `GRANTABLE_ROLES`, the retention validation, the Buyer-only denial, and the one-time token output.
- The role rows use checkboxes with the existing `name="grants"` and `value={role}`; the duplicate prose list is removed.

- [ ] **Step 1: Update the Guidance-access tests**

Keep the grant, retention, token, denial, and action assertions. Add:

```tsx
it("shows one role row per grantable role with the Buyer always granted", async () => {
  renderGuidanceAccess(/* fixture */);
  expect(await screen.findByText("Who can read Guidance events")).toBeTruthy();
  expect(screen.getByText("Buyer: always granted.")).toBeTruthy();
  expect(screen.getAllByRole("checkbox")).toHaveLength(/* GRANTABLE_ROLES.length */);
});

it("shows the one-time token with a copy action after minting", async () => {
  renderGuidanceAccess(/* actionData with token */);
  expect(screen.getByText("Use this token inside the Company network")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
});

it("keeps the retention input's name and range", async () => {
  renderGuidanceAccess(/* fixture */);
  const input = screen.getByLabelText("Keep Guidance events for (days)");
  expect(input.getAttribute("name")).toBe("retentionDays");
  expect(input.getAttribute("min")).toBe("1");
  expect(input.getAttribute("max")).toBe("3650");
});

it("shows the save bar when a role or the retention changes", async () => {
  renderGuidanceAccess(/* fixture */);
  expect(screen.queryByRole("button", { name: "Save Guidance access" })).toBeNull();
  fireEvent.click(screen.getByLabelText("Builder"));
  expect(screen.getByRole("button", { name: "Save Guidance access" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Discard" })).toBeTruthy();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @domain-harness/panel exec vitest run src/routes/guidance-access.test.tsx`
Expected: FAIL on the new structure.

- [ ] **Step 3: Implement the page**

Render `PageHeader`. Render a two-column layout: the grant card and the retention card on the left, the read-token card on the right. The grant card has one row per role with a checkbox, a state badge, and a description; Buyer is checked and disabled. The retention card has the number input and a helper. The save action is a sticky bar when a change is pending (use state initialized from the current values; reset on success). The token card shows the mint button and the one-time token in a code block with `CopyButton` and expiry. Keep every intent, field name, and denial.

- [ ] **Step 4: Add the CSS**

In `guidance-access.css`, style `.guidance-layout`, `.role-row`, `.retention-card`, `.save-bar`, `.token-block`. The save bar stacks below 768px and does not cover the form.

- [ ] **Step 5: Run the tests and the full panel suite**

Run: `pnpm --filter @domain-harness/panel exec vitest run src/routes/guidance-access.test.tsx && pnpm --filter @domain-harness/panel test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/panel/src/routes/guidance-access.tsx apps/panel/src/routes/guidance-access.test.tsx apps/panel/src/styles/guidance-access.css
git commit -m "feat(panel): redesign guidance access"
```

---

## Task 15: Full Verification and Review

**Files:**
- Modify: only files required by review findings.

**Interfaces:**
- No new interfaces.

- [ ] **Step 1: Run the full panel suite**

Run: `pnpm --filter @domain-harness/panel test`
Expected: all tests pass (the original 477 plus the new ones).

- [ ] **Step 2: Run typecheck, lint, build, and boundaries**

```bash
pnpm --filter @domain-harness/panel typecheck
pnpm --filter @domain-harness/panel lint
pnpm --filter @domain-harness/panel build
pnpm boundaries
```

Expected: all pass with no warnings.

- [ ] **Step 3: Run the visual and accessibility checks**

Start the panel locally (`pnpm local:serve` or the panel dev server) and check at 1440px, 1024px, 768px, and 320px, in light and dark mode, at 200% zoom:

- The sidebar, breadcrumbs, and page header do not overlap.
- The primary action is visible without horizontal scroll.
- Tables scroll horizontally, never clip the first column.
- Tabs, side sheets, and the mobile drawer work with keyboard only; Esc closes and focus returns.
- Every status has a word and an icon.
- No gold appears outside the primary button and the alert band.
- The alert band does not animate.

- [ ] **Step 4: Dispatch parallel reviewers**

Dispatch three fresh reviewers in parallel (no edits; they report findings):

1. **Accessibility reviewer:** keyboard, focus, ARIA, contrast, 320px, reduced motion.
2. **UX reviewer:** hierarchy, density, consistency, brand, empty/loading/error states.
3. **Code reviewer:** token invariants, no new dependencies, no behavior regressions, test quality.

- [ ] **Step 5: Triage and fix findings**

Sort findings into blocking (break acceptance), important (fix now), and follow-up (record in the plan). Fix blocking and important findings serially. Re-run the full suite and the checks after each fix.

- [ ] **Step 6: Commit the final state**

```bash
git add -A
git commit -m "chore(panel): polish and verify the operational redesign"
```

---

## Execution Handoff

The plan is complete. The recommended execution is **subagent-driven**, because the work is explicitly partitioned by file ownership and the screens are independent after the foundation. The coordinator runs Task 1, then dispatches the parallel waves, reviews each wave, and keeps `git` commits serial.

If the human partner prefers **native** execution, the same task order applies, but the coordinator implements each task itself and uses one fresh reviewer at the end.
