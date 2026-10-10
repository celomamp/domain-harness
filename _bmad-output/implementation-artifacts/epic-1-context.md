# Epic 1 Context: Standard owners record and publish the Company's Standards

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Stand up the greenfield Domain Harness monorepo and the first vendor-side slice: an operator provisions a pilot Company with role-named accounts (Buyer, Standard owner, Builder). They sign in with a magic link to one branded management panel. The Buyer assigns exactly one Standard owner per Module, and that owner authors, versions and publishes code-stack and design-system Standards on the single root Project. The core conflict-slot rule rejects same-slot clashes at publish time. This epic lays the foundations every later epic builds on: package boundaries, the tenant-scoped data layer, the panel shell and design tokens, the error envelope and id conventions, and the core slot rule.

## Stories

- Story 1.1: Scaffold the monorepo from a researched open-source starter
- Story 1.2: Operator provisions a Company and its role-named accounts
- Story 1.3: Sign in to a branded management panel
- Story 1.4: Buyer assigns exactly one Standard owner per Module
- Story 1.5: Standard owner publishes a versioned code-stack Standard
- Story 1.6: Standard owner publishes design-system components, tokens and imports

## Requirements & Constraints

- **Accounts:** an operator (CLI or script, no UI) provisions one Company with named accounts. Each account has exactly one role: Buyer, Standard owner or Builder. There is no SSO/SCIM. A person without a provisioned account cannot publish. Every later permission check relies on the account's role.
- **Plan attribute:** each tenant has a plan of Community, Team, Business or Enterprise. The pilot default is Team. A capability outside the plan is refused in place and names the plan, never a price.
- **Modules:** the first cut offers only two kinds, code stack and design system. Each Module has exactly one accountable owner, and only the Buyer can assign or reassign that owner. Owner changes are stored append-only with who made them and when. A Module with no owner cannot be published into. A non-owner, including a Builder, gets a denial, and no version is created.
- **Publishing:** create, edit and publish. Each publish creates a new immutable version that shows its Standard id, Module, Project scope (the root Project in this epic), version and UTC timestamp. Earlier versions are never mutated. In the first cut, the published version is the version in force. Signed bundles, the active pointer and the stale rule come in Epic 4.
- **Code-stack entry:** name (the conflict slot), optional version constraint, status (approved, prohibited or required), optional Correction instruction.
- **Design-system entries:**
  - Component: name (slot), usage rule, the tokens it depends on, optional Correction instruction.
  - Token: name plus required or prohibited.
  - Import: module specifier plus required or prohibited.
- **Tenant isolation:** one Company can never read another Company's data. Any data-access function called without a tenant id must throw. A test must show that RLS blocks cross-tenant reads even when the tenant filter is deliberately left out.
- **Accessibility:** the panel meets WCAG 2.2 AA.
- **Engines:** the workspace build, typecheck and test must pass on a fresh clone. CI runs build, typecheck, lint/boundary check and tests on every push. The pilot uses GitHub Actions.

## Technical Decisions

- **Layout:** a TypeScript monorepo with `packages/{core,extractor,contract,collector}` and `apps/{registry,panel,service,cli}`. Packages are named `@domain-harness/*`.
- **Scaffold choices:** the web framework, ORM, test runner and monorepo tool are chosen in Story 1.1. Record them in `docs/decisions/starter-template.md` after comparing at least three permissively licensed starters. Strip out anything the record did not approve, such as samples, telemetry or hosted integrations.
- **Dependency rule, enforced by lint/boundary tooling:**
  - `core` and `extractor` import only `contract`.
  - Adapters and the registry import `core` and `contract`.
  - `panel` imports `contract` only.
  - Nothing imports from `apps/*`.
  - The registry uses `core` only for slot derivation, publication validation and Boilerplate resolution.
- **Core purity:** all resolution and validation logic lives only in `packages/core`. The core does no I/O, reads no clock and makes no network calls. Adapters never re-implement or post-process its output.
- **Conflict slot:** a slot is the tuple (Module kind, slot kind, name), so equal names in different kinds never compete. For example, a token "primary" and a library "primary" can coexist. On publish, the registry validates the whole proposed set through `core`. It rejects a second live Standard in the same slot at the same Project scope, across Modules. The core raises an error, never a guess, and the error names both Standards.
- **Registry authority:** the vendor registry, built in-house in `apps/registry`, is the only authority for Standards, Modules, owners and the tree. All of these are versioned and append-only.
- **Data layer:** one shared vendor PostgreSQL 18 database. Every tenant-scoped table has RLS enabled as a second guard. The application DB role must not own the tables, because an owner bypasses RLS. Story 1.2 migrations create only the tenant, account and root-Project tables. Later stories add their own tables.
- **Roles:** roles are enforced in the registry and the panel.
- **Ids:** opaque UUIDv7 ids, always minted by the registry and never by clients. This covers tenant, Project, Module and Standard ids.
- **Timestamps:** UTC ISO-8601 everywhere.
- **Errors:** one error envelope `{ code, message, subject }` defined in `contract`, together with the UUIDv7 id type. There are no bare-string errors and no partial success. An invalid write writes nothing.
- **Logs:** logs carry ids and counts only.
- **Secrets:** secrets come from the environment or a secret manager, never from the repository.
- **Stack:**
  - Node 26 LTS target, with `engines.node >=24` in the root manifest.
  - TypeScript 7.0.2 (native compiler) for build and typecheck. TypeScript 6.0.3 is installed through an npm alias only for compiler-API tooling (typescript-eslint, dependency-cruiser) until 7.1 ships that API.
  - `@modelcontextprotocol/server` 2.x (npm `latest` 2.3.1), replacing `@modelcontextprotocol/sdk` 1.x. It is used from Epic 4, behind the MCP adapter, over Streamable HTTP.
  - The pilot Company builds only in TypeScript/npm. Both stack decisions are recorded in `docs/decisions/starter-template.md`.
- **Sign-in:** a passwordless magic link. The email delivery provider is chosen and recorded during Story 1.3.

## UX & Interaction Patterns

- **Design tokens, one source for light and dark:**
  - Light: surface-base `#FEFBE9`, surface-raised `#FFFFFF`, ink `#0A0A0A`, ink-secondary `#171717`, ink-on-accent `#000000`, accent `#FFC700`, accent-strong `#FBBF24`, border `#E5E5E5`, inverse `#FAFAFA`.
  - Dark: surface-base `#0A0A0A`, surface-raised `#101319`, ink `#FFFFFF`, ink-secondary `#FAFAFA`, border `#171717`, inverse `#171717`. Gold stays the same.
  - Spacing runs from 4 to 64, plus a gutter of 24. Radius is sm 4px or md 8px.
  - Use no other chromatic color. Never use `#737373` for text.
  - An automated contrast check must pass every DESIGN.md pair in both modes.
- **Typography:**
  - Sora is the UI and body font. Poppins is the display and body-light font.
  - Ramp: display 52/400, title 48/600, headline 36/700, title-sm 22/700, body 16/400/1.5, body-light 16/300, label 14/400, and label-strong 14/600 (buttons only).
  - No all-caps.
  - Text must work at 200% zoom and with text-spacing overrides.
- **Gold:** gold fills only the primary action and the Accepted-deviation alert. It is never text, never a pass/fail color, never chrome, and never the current-nav indicator. Status is always a word.
- **panel-chrome:** wordmark "Domain Harness", the signed-in role as text, and a nav with the current destination at weight 600. The nav lists only destinations that exist so far: Inventory (shell) and Standards. Later stories add their own entries.
- **Buttons:**
  - button-primary: gold fill, ink-on-accent text, 4px radius, label-strong, padding 8px 22px. On hover, it changes only to accent-strong.
  - button-inverse: ink-secondary fill with inverse text, for secondary commits. Never use it for publish.
- **sign-in:**
  - A cream canvas with a single email field.
  - Any address shows the same text, "Check your email for a sign-in link", so the form never reveals whether an account exists.
  - The link is single-use with a short expiry.
  - An expired or used link shows a denial in text, announced as a status, and the person stays on sign-in.
  - Success lands on Inventory in its empty state.
- **standard-form:**
  - Raised, 8px radius, white inputs with a 1px border, 12px horizontal padding, Sora 16.
  - Separate field sets for each entry kind: code-stack, component, token and import.
  - An invalid submit keeps the field's value and adds ink text under it.
  - A slot conflict names the conflicting Standards and creates no version.
  - A successful publish shows the id, Module, scope, version and timestamp.
- **Standards surface states:** cold-load shows the structure first. The empty state means the Module has no published Standard. A non-owner gets a denial. A Module with no owner shows "no owner" refusal text. The Standards list is a table with header cells. There is no offline editing and no queued writes.
- **denial:** the surface stays visible, and the refused action is announced as a status. Never hide a control by role.
- **Keyboard and focus:**
  - Every pointer action has a keyboard equivalent, and tab order follows reading order.
  - Opening a form focuses its first field. Esc leaves without committing and returns focus to the opener.
  - Focus is never trapped. The ink focus ring needs at least 3:1 contrast.
  - Pointer targets are at least 24px.
- **Responsive layout:** at ≥1280px, tables sit beside the context. At 768–1279px, content stacks. At 320–767px, sign-in, publish and filter stay usable when stacked.
- **Language and copy:** the page language is English. Other-language Standard text is marked with its language. Use the glossary terms exactly (Standard, Module, Standard owner, Buyer, Builder, Conflict slot, Correction instruction, management panel, and so on) in one voice for every role. Never use certification language, never name individual Builders, and never show prices.

## Cross-Story Dependencies

- Story 1.1 comes first. It provides the workspace, boundary lint, CI workflow, and the `contract` error envelope and UUIDv7 type that every other story uses.
- Story 1.2 (tenant, accounts, root Project, RLS) comes before Story 1.3 (sign-in needs provisioned accounts) and Story 1.4 (owners are provisioned accounts).
- Story 1.4 (Modules and owners) comes before Stories 1.5 and 1.6. Publishing requires an owned Module.
- Story 1.5 introduces the `core` slot validation, and Story 1.6 reuses it. Story 1.6 adds the Standards empty and cold-load states and the table semantics.
- **Later epics:**
  - Epic 2 reuses the core slot rule for multi-Project resolution and Locked rules. Publication stays on the root Project here.
  - Epic 4 turns published versions into signed bundles with an active pointer and the stale rule.
  - Epic 5 Gate checks consume the code-stack and design-system entry shapes defined here, so keep those shapes stable in `contract`.
