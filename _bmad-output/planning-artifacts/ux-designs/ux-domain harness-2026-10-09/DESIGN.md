---
name: domain harness
description: System of record for a Company's software-construction Standards, with proof of Adherence. Visual identity follows levva.io.
status: final
sources:
  - "{planning_artifacts}/prds/prd-domain harness-2026-10-09/prd.md"
  - "https://levva.io/"
updated: 2026-10-09
colors:
  surface-base: '#FEFBE9'
  surface-raised: '#FFFFFF'
  ink: '#0A0A0A'
  ink-secondary: '#171717'
  ink-on-accent: '#000000'
  accent: '#FFC700'
  accent-strong: '#FBBF24'
  border: '#E5E5E5'
  inverse: '#FAFAFA'
  surface-subtle: '#F7F3E4'
  surface-sunken: '#F1ECD8'
  ink-muted: '#525252'
  border-strong: '#C9C4B4'
  sidebar: '#0A0A0A'
  sidebar-ink: '#FAFAFA'
  sidebar-muted: '#A3A3A3'
  sidebar-active: '#1F1F1F'
  surface-base-dark: '#0A0A0A'
  surface-raised-dark: '#101319'
  ink-dark: '#FFFFFF'
  ink-secondary-dark: '#FAFAFA'
  ink-on-accent-dark: '#000000'
  accent-dark: '#FFC700'
  accent-strong-dark: '#FBBF24'
  border-dark: '#171717'
  inverse-dark: '#171717'
  surface-subtle-dark: '#15181E'
  surface-sunken-dark: '#0D1015'
  ink-muted-dark: '#A3A3A3'
  border-strong-dark: '#2A2E36'
  sidebar-dark: '#101319'
  sidebar-ink-dark: '#FFFFFF'
  sidebar-muted-dark: '#A3A3A3'
  sidebar-active-dark: '#1A1E25'
typography:
  display:
    fontFamily: Poppins
    fontSize: 52px
    fontWeight: '400'
    lineHeight: '1.3'
  title:
    fontFamily: Sora
    fontSize: 48px
    fontWeight: '600'
    lineHeight: '1.11'
    letterSpacing: -0.01em
  headline:
    fontFamily: Sora
    fontSize: 36px
    fontWeight: '700'
    lineHeight: '1.11'
  title-sm:
    fontFamily: Sora
    fontSize: 22px
    fontWeight: '700'
    lineHeight: '1.2'
  body:
    fontFamily: Sora
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.5'
  body-light:
    fontFamily: Poppins
    fontSize: 16px
    fontWeight: '300'
    lineHeight: '1.3'
  label:
    fontFamily: Sora
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.4'
    letterSpacing: 0.005em
  label-strong:
    fontFamily: Sora
    fontSize: 14px
    fontWeight: '600'
    lineHeight: '1.85'
    letterSpacing: 0.033em
  page-title:
    fontFamily: Sora
    fontSize: 32px
    fontWeight: '600'
    lineHeight: '1.15'
  section-title:
    fontFamily: Sora
    fontSize: 20px
    fontWeight: '600'
    lineHeight: '1.3'
  body-sm:
    fontFamily: Sora
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.5'
  caption:
    fontFamily: Sora
    fontSize: 12px
    fontWeight: '500'
    lineHeight: '1.4'
  stat:
    fontFamily: Sora
    fontSize: 28px
    fontWeight: '600'
    lineHeight: '1.1'
rounded:
  sm: 4px
  md: 8px
spacing:
  '1': 4px
  '2': 8px
  '3': 12px
  '4': 16px
  '5': 24px
  '6': 32px
  '7': 48px
  '8': 64px
  gutter: 24px
  margin-desktop: 76px
shadow:
  form: 'rgba(0, 0, 0, 0.1) 0 1px 2px'
  card: '0 1px 2px rgba(0,0,0,0.06), 0 8px 24px rgba(0,0,0,0.04)'
  popover: '0 8px 24px rgba(0,0,0,0.16)'
components:
  application-row:
    background: '{colors.surface-raised}'
    foreground: '{colors.ink}'
    border: '{colors.border}'
    radius: '{rounded.sm}'
  project-filter:
    background: '{colors.surface-raised}'
    foreground: '{colors.ink}'
    border: '{colors.border}'
    radius: '{rounded.md}'
  adherence-series:
    foreground: '{colors.ink}'
    mark: '{colors.ink-secondary}'
    accent: '{colors.accent}'
  deviation-row:
    background: '{colors.surface-raised}'
    foreground: '{colors.ink}'
    border: '{colors.border}'
  cross-check-row:
    background: '{colors.surface-raised}'
    foreground: '{colors.ink}'
    border: '{colors.border}'
  gap-row:
    background: '{colors.surface-raised}'
    foreground: '{colors.ink}'
    border: '{colors.border}'
  ignored-module-row:
    background: '{colors.surface-raised}'
    foreground: '{colors.ink}'
    border: '{colors.border}'
  standard-form:
    background: '{colors.surface-raised}'
    foreground: '{colors.ink}'
    border: '{colors.border}'
    radius: '{rounded.md}'
  project-node:
    foreground: '{colors.ink}'
  boilerplate-result:
    background: '{colors.surface-raised}'
    foreground: '{colors.ink}'
    radius: '{rounded.md}'
  correction-instruction:
    foreground: '{colors.ink}'
    background: '{colors.surface-base}'
  acceptance-form:
    background: '{colors.surface-raised}'
    foreground: '{colors.ink}'
    radius: '{rounded.md}'
  accepted-deviation-alert:
    background: '{colors.accent}'
    foreground: '{colors.ink-on-accent}'
    radius: '{rounded.sm}'
  plan-refusal:
    background: '{colors.surface-raised}'
    foreground: '{colors.ink}'
    border: '{colors.border}'
  denial:
    background: '{colors.surface-raised}'
    foreground: '{colors.ink}'
    border: '{colors.border}'
  compilation-drop:
    background: '{colors.surface-raised}'
    foreground: '{colors.ink}'
    border: '{colors.border}'
  schema-reader:
    background: '{colors.surface-raised}'
    foreground: '{colors.ink}'
    radius: '{rounded.sm}'
  role-grant:
    background: '{colors.surface-raised}'
    foreground: '{colors.ink}'
    radius: '{rounded.md}'
  sign-in:
    background: '{colors.surface-base}'
    foreground: '{colors.ink}'
  button-primary:
    background: '{colors.accent}'
    foreground: '{colors.ink-on-accent}'
    radius: '{rounded.sm}'
    font: '{typography.label-strong}'
  button-inverse:
    background: '{colors.ink-secondary}'
    foreground: '{colors.inverse}'
    radius: '{rounded.sm}'
    font: '{typography.label-strong}'
  button-secondary:
    background: '{colors.surface-raised}'
    foreground: '{colors.ink}'
    border: '{colors.border}'
    radius: '{rounded.sm}'
    font: '{typography.label-strong}'
  button-ghost:
    background: transparent
    foreground: '{colors.ink}'
    radius: '{rounded.sm}'
    font: '{typography.label-strong}'
  panel-chrome:
    background: '{colors.surface-raised}'
    foreground: '{colors.ink}'
    role: '{colors.ink-secondary}'
---

## Brand & Style

Domain Harness is the system of record for a Company's software-construction Standards in the agent era, with proof of Adherence. The name is a working title. The legal name is undecided. The Company owns the Standards.

The visual identity follows [levva.io](https://levva.io/). Levva funds the operating company. The live site is black, cream, and gold: a dark hero, a cream reading surface, and one gold fill for the action that moves the work forward. The management panel uses that same language. It is an evidence tool, not a marketing page. It is not a coding agent, and a passing Gate is not a certification.

Composition reference: [mockups/inventory.html](mockups/inventory.html), [mockups/application.html](mockups/application.html), [mockups/new-application.html](mockups/new-application.html), [mockups/accepted-deviation.html](mockups/accepted-deviation.html). Spine wins on conflict.

The interface uses the PRD glossary exactly. The term list lives in EXPERIENCE.md Voice and Tone. Levva's site voice is direct and corporate. Panel microcopy stays the one English voice in EXPERIENCE.md.

## Colors

Values are computed from levva.io on 2026-10-09. An older kit lists `#FFC800`. The live primary button is `{colors.accent}` (`#FFC700`). Follow the live site.

- **Cream (`{colors.surface-base}` `#FEFBE9`)** is the panel canvas. Light-mode default. Used for the page, not for a wash behind status words.
- **White (`{colors.surface-raised}` `#FFFFFF`)** is a raised reading surface: forms, rows, inputs.
- **Ink (`{colors.ink}` `#0A0A0A`)** is primary text on cream and white. **Secondary ink (`{colors.ink-secondary}` `#171717`)** is nav, labels, and series marks.
- **Gold (`{colors.accent}` `#FFC700`)** is the only chromatic fill. Primary action and the Accepted-deviation alert. Text on gold is `{colors.ink-on-accent}` (`#000000`). Gold is never body text, never a pass/fail color, never an Adherence celebration.
- **Amber (`{colors.accent-strong}` `#FBBF24`)** is the site footer band. On the panel it is reserved for a single persistent chrome moment if one is needed. Do not use it as a second action color.
- **Hairline (`{colors.border}` `#E5E5E5`)** is the input and row border from the site form.
- **Inverse (`{colors.inverse}` `#FAFAFA`)** is text on `{colors.ink-secondary}` fills, matching the site's "Fale conosco" chip.
- **Quiet surfaces (`{colors.surface-subtle}` `#F7F3E4`, `{colors.surface-sunken}` `#F1ECD8`)** are the muted neutral steps: table headers, inset toolbars, page gutters, and skeleton bases.
- **Muted ink (`{colors.ink-muted}` `#525252`)** is secondary labels and timestamps; it meets 4.5:1 on cream.
- **Strong hairline (`{colors.border-strong}` `#C9C4B4`)** marks inputs and selected outlines.
- **Sidebar** roles (`{colors.sidebar}` `#0A0A0A`, `{colors.sidebar-ink}` `#FAFAFA`, `{colors.sidebar-muted}` `#A3A3A3`, `{colors.sidebar-active}` `#1F1F1F`) are the dark navigation rail and its text. Active is a cream-tinted surface at weight 600, never gold.
- **Dark surfaces** (`{colors.surface-base-dark}` `#0A0A0A`, `{colors.surface-raised-dark}` `#101319`) match the site's near-black sections. Ink inverts to white. Gold does not change.

Contrast, WCAG 2.2 AA, load-bearing pairs. Ratios are for the stated pair. Status is always a word as well as any mark.

| Pair | Use | Target |
|---|---|---|
| `{colors.ink}` on `{colors.surface-base}` | Body, rows, denials | ≥ 4.5:1 |
| `{colors.ink}` on `{colors.surface-raised}` | Forms, inputs | ≥ 4.5:1 |
| `{colors.ink-secondary}` on `{colors.surface-base}` | Labels, nav | ≥ 4.5:1 |
| `{colors.ink-on-accent}` on `{colors.accent}` | Primary button, alert | ≥ 4.5:1 |
| `{colors.inverse}` on `{colors.ink-secondary}` | Inverse chip | ≥ 4.5:1 |
| `{colors.ink-dark}` on `{colors.surface-base-dark}` | Dark body | ≥ 4.5:1 |
| `{colors.ink}` on `{colors.surface-raised}` at `{typography.title}` | Large text | ≥ 3:1 |
| Focus ring `{colors.ink}` against `{colors.surface-base}` | Non-text | ≥ 3:1 |
| Control border `{colors.border}` is not the only focus or error signal | Non-text | Pair with the ink ring |
| `{colors.accent}` marks on `{colors.surface-raised}` | Series accent only | ≥ 3:1; the Adherence number is text |

The live site also computes `#737373`. That pair fails 4.5:1 on cream. Do not use it for panel body text.

## Typography

Typefaces are the ones levva.io loads: **Sora** for UI, titles, and body; **Poppins** for the rare display line and the light marketing sentence.

- `{typography.display}` — Poppins 52 / 400. Empty-state or sign-in greeting only. Not a table title.
- `{typography.title}` — Sora 48 / 600. Surface titles on desktop. Scale down with the viewport. Must remain legible at 200% zoom.
- `{typography.headline}` — Sora 36 / 700. Application name, Module name.
- `{typography.title-sm}` — Sora 22 / 700. Row-group and form section titles.
- `{typography.body}` — Sora 16 / 400 / 1.5. Default reading text, including Correction instruction and denial.
- `{typography.body-light}` — Poppins 16 / 300. Optional supporting line on sign-in. Not evidence.
- `{typography.label}` — Sora 14 / 400. Nav, meta, timestamps.
- `{typography.label-strong}` — Sora 14 / 600 with the site's 0.46px tracking. Buttons only.
- `{typography.page-title}` — Sora 32 / 600 / 1.15. Page titles. `{typography.title}` stays for sign-in only.
- `{typography.section-title}` — Sora 20 / 600 / 1.3. Section headers.
- `{typography.body-sm}` — Sora 14 / 400 / 1.5. Dense table cells and helpers.
- `{typography.caption}` — Sora 12 / 500 / 1.4. Eyebrows, column labels, meta.
- `{typography.stat}` — Sora 28 / 600 / 1.1. Summary values, set in tabular numerals.

The type ramp must still work at 200% zoom. Spacing must survive text-spacing overrides. No all-caps except a glossary status word already written in lowercase in EXPERIENCE.md.

## Layout & Spacing

Scale, from the site's 4- and 8-pixel rhythm: 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64. `{spacing.gutter}` is 24px between evidence columns. `{spacing.margin-desktop}` is 76px on the marketing site; the panel uses `{spacing.5}` (24px) at the edge so tables keep width.

The navigation rail is 248px wide; below 1024px it becomes a 248px off-canvas drawer opened by the menu button.

Single reading column for forms. Evidence tables may use the remaining width. At 1280px and above, tables sit beside the Project tree context. From 768px to 1279px, tables stack under the project-filter. From 320px to 767px, publish, accept, filter, and sign-in stay available, stacked, with vertical scroll. Evidence tables and the adherence plot may scroll in two dimensions.

Every pointer target is at least 24 CSS pixels, or it meets the WCAG 2.2 spacing exception.

## Elevation & Depth

Levva uses tone, not a shadow ladder. Cream versus white versus near-black is the hierarchy. When a shadow appears, it is the site form shadow: `rgba(0, 0, 0, 0.1) 0 1px 2px`. Two softer shadows join it for the operational panel: `{shadow.card}` (`0 1px 2px rgba(0,0,0,0.06), 0 8px 24px rgba(0,0,0,0.04)`) for raised cards and `{shadow.popover}` (`0 8px 24px rgba(0,0,0,0.16)`) for floating surfaces. Shadows stay soft and never imply more than "this panel floats". No card stack. No gold glow. Dark mode uses `{colors.surface-raised-dark}` against `{colors.surface-base-dark}` the same way.

## Shapes

`{rounded.sm}` (4px) is the site action radius: primary button, inverse chip, alert, activating row. `{rounded.md}` (8px) is the site form radius: inputs, standard-form, acceptance-form, sign-in fields. No pills. No full-round surfaces.

## Components

Anatomy, color, size, and state. Behavior lives in EXPERIENCE.md.

- **application-row** — `{colors.surface-raised}` row, `{colors.ink}` in `{typography.body}`, hairline `{colors.border}`. Hover and keyboard-active use `{colors.surface-base}` behind the row, not gold. Radius `{rounded.sm}`. Height meets the 24px target.
- **project-filter** — Raised field, `{rounded.md}`, `{typography.label}`, `{colors.border}`. Open list uses the same field tokens. Focus is the ink ring, not a gold outline.
- **adherence-series** — Plot marks in `{colors.ink-secondary}`. `{colors.accent}` may mark the selected Project once. The Adherence value and the Deviation count are `{typography.body}` text. The plot's text alternative is those numbers.
- **deviation-row** — Same row language as application-row. Status words (open, accepted) are `{typography.label}` in ink. No green or red fill.
- **cross-check-row**, **gap-row**, **ignored-module-row** — Same as application-row. The activating name is the Application or the check type, in ink.
- **standard-form**, **acceptance-form**, **role-grant** — Raised surface, `{rounded.md}`, inputs matching the site field: white, 1px `{colors.border}`, `{spacing.3}` horizontal padding, Sora 16. Invalid submit keeps the field and adds `{typography.body}` ink text under it.
- **project-node** — Ink text, no fill. Tree indentation uses `{spacing.4}`. Selected node is ink weight 600, not gold.
- **boilerplate-result** — Raised surface, `{typography.body}` listing the artifacts. No badge.
- **correction-instruction** — Cream inset, ink body. Monospace is not a Levva face; keep Sora so the Builder can read it.
- **accepted-deviation-alert** — `{colors.accent}` fill, `{colors.ink-on-accent}` in `{typography.label-strong}`. Radius `{rounded.sm}`. No motion longer than five seconds without pause.
- **plan-refusal**, **denial**, **compilation-drop** — Raised surface, ink `{typography.body}`, hairline border. No chromatic fill. The word is the state.
- **schema-reader** — Raised, `{typography.body}`. Schema text is ink on white.
- **sign-in** — Cream canvas, display optional, form as standard-form. Failed attempt is denial tokens.
- **button-primary** — `{colors.accent}` fill, `{colors.ink-on-accent}`, `{rounded.sm}`, `{typography.label-strong}`, padding 8px 22px. Hover darkens only by using `{colors.accent-strong}` if a hover must exist; the default rest state is `{colors.accent}`.
- **button-inverse** — `{colors.ink-secondary}` fill, `{colors.inverse}` text, same radius and type. Used for a secondary commit (the site's "Fale conosco"), not for publish.
- **button-secondary** — `{colors.surface-raised}` fill, `{colors.ink}` text, hairline `{colors.border}`, `{rounded.sm}`, `{typography.label-strong}`. A secondary commit beside the one primary action.
- **button-ghost** — transparent surface, `{colors.ink}` text, `{rounded.sm}`, `{typography.label-strong}`. Hover fills with `{colors.surface-subtle}`. Used for quiet, reversible actions.
- **panel-chrome** — Cream or white under the wordmark. Role is `{typography.label}` in `{colors.ink-secondary}`. Nav labels are `{typography.label}` in ink. Current destination is weight 600, not gold. The accepted-deviation-alert sits under this chrome as a gold band.

## Do's and Don'ts

| Do | Don't |
|---|---|
| Use the glossary terms exactly | Replace Standard, Gate, Adherence, Deviation, Module, Application, or Company with a synonym |
| Show a Gate result as a check against the Effective Standard set | Present a passing Gate as a certification of security, accessibility, or legal compliance |
| Speak of the Builder as a role | Name individual Builders |
| Show Adherence as the share of checked Standards an Application follows | Describe that share as a certification, or color it gold |
| Use `{colors.accent}` only as a fill for the primary action and the Accepted-deviation alert | Use gold for body text, pass/fail, or chrome |
| Put evidence on cream or white, actions in gold or inverse ink | Wash a table in gold, or use the footer amber as a page background |
| Keep 4px actions and 8px fields | Use pills or a second radius scale |
| Meet the contrast table before claiming AA | Invent a third chromatic color, or use `#737373` for body text |
