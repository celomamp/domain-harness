---
title: 'Story 1.6: Standard owner publishes design-system components, tokens and imports'
type: 'feature'
created: '2026-10-12'
status: 'done'
baseline_commit: '8d68ccf0e5c875cee38a8bc64475ebe302b882e3'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-5-standard-owner-publishes-a-versioned-code-stack-standard.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** A design-system Module can be owned (Story 1.4), but the registry refuses every publish into it (Story 1.5 returns `400 invalid_input` subject `entry`), so the Company's components, tokens and imports cannot be recorded (FR-1, FR-3). The Standards page also has no loading (cold-load) state.

**Approach:** Add the three design-system entry shapes to `contract` and their Conflict slots to `core`. Let the registry validate and publish them through the same publish path, version rules and slot rule as code stack, with migration 0005 widening the `standard_versions` checks. The panel gets a design-system `standard-form` with one field set per entry kind, a design-system Standards table, and a cold-load structure that shows the page structure while the Standards list loads.

## Boundaries & Constraints

**Always:**
- Design-system entries (stable `contract` shapes for Epic 5), every text trimmed; `""`/missing/null optional text → `null`:
  - Component: `{kind:"component", name (1–200), usageRule (1–1000), tokens: string[] (0–50 items, each 1–200, no two equal under the slot-name comparison), correctionInstruction (optional, ≤1000)}`.
  - Token: `{kind:"token", name (1–200), status ∈ required | prohibited}`.
  - Import: `{kind:"import", specifier (1–200), status ∈ required | prohibited}`.
- Slots: `(design-system, component|token|import, name-or-specifier)`, compared like Story 1.5 (trim, NFC, lowercase). Only `core` derives slots and runs `validatePublication`; the registry passes it every live Standard across all Modules at the root Project. Different Module kinds or slot kinds never compete.
- The registry picks the validator by the Module's kind. Design-system checks run in this order: `kind` (subject `kind`) → any key not allowed for that kind (subject = that key) → fields in form order (subject = field name). The 1.5 check order is otherwise unchanged; the "design-system Module → 400 `entry`" step is removed. A code-stack entry posted into a design-system Module → 400 subject `kind`; a design-system entry posted into a code-stack Module → 400 subject `kind` (an unknown key).
- `standard_versions.category` holds the slot kind (`language|framework|library|component|token|import`) and `name` holds the slot name (the specifier for imports). A new version may change the entry kind; the slot moves and is re-validated. Rows stay append-only (SELECT, INSERT only).
- A component's `tokens` are names only. They are not checked against published token Standards.
- Panel imports only `contract`. Controls are shown to every role, and refusals appear as a `denial` in the `role="status"` region. An invalid submit keeps every value and puts ink text under the field. Gold appears only on the Publish button, and the page shows exactly one form. Tables have header cells, glossary terms are used exactly, and there is no all-caps text.

**Never:** No change to the code-stack entry shape, its refusals or its copy, except removing the now-unreachable design-system denial. No scopes beyond the root Project, no bundles, no deletion or retirement of Standards, no token-reference integrity checks, no language tagging. No new tables. No offline editing or queued writes. No `core` import or DB access in the panel.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Publish component | Owner of design-system Module D posts `{entry:{kind:"component",name:" Button ",usageRule:"Use for primary actions",tokens:[" primary ","spacing-4"]}}` | 201 `StandardInfo` with version 1 at the root scope; entry `{kind:"component",name:"Button",usageRule:…,tokens:["primary","spacing-4"],correctionInstruction:null}`; the panel shows the five published facts | none |
| Publish token / import | `{kind:"token",name:"primary",status:"prohibited"}`; `{kind:"import",specifier:"@mui/material",status:"required"}` | 201 each; the table lists them | none |
| Cross-kind same name | Live code-stack library "primary" and a new token "primary" at the root | Both accepted (DB test) | none |
| Same-kind clash | Live component "Button"; a new component "button" (same or another design-system Module) | Nothing is written; the panel denial names both Standards and the slot `(design system, component, "Button")` | 409 `slot_conflict`, subject = the holder's id |
| Edit | Owner republishes a component with a changed usage rule via `/v1/standards/{S}/versions` | 201 version 2 with the same id; version 1 unchanged | none |
| Invalid | Missing/bad `kind`; blank or 201-char name/specifier; blank or 1001-char usage rule; 51 tokens, a blank token, duplicate tokens ("a","A"), tokens not an array; status `approved` on a token; `versionConstraint` on a component; extra key | Nothing is written; the panel keeps every value and shows ink text under the field | 400 `invalid_input`, subject = field/key |
| Wrong kind for Module | Code-stack entry into D; design-system entry into a code-stack Module | Nothing is written | 400 `invalid_input`, subject `kind` |
| Not owner / no owner / unknown ids | as Story 1.5 | as Story 1.5 | 403 / 409 / 404 as Story 1.5 |
| Empty | Module with no published Standard | The table section shows "No Standard is published in this Module yet." and the form is shown | none |
| Cold-load | The Standards list has not arrived yet | The page shows the "Standards" heading, the Standards table with header cells and a busy body row "Loading Standards…" (`aria-busy="true"`), and no form yet; the data then replaces it | none |
| Registry down | The list call fails | The structure stays, with "Standards are unavailable right now…" in the status region | panel catches |

</intent-contract>

## Code Map

- `packages/contract/src/standards.ts` -- has `CodeStackEntry`, the limits, `CODE_STACK_ENTRY_FIELDS`, `isCodeStackEntry`, `StandardInfo.entry: CodeStackEntry`, `StandardPublishRequest`, and the guards (`isStandardInfo` → `isCodeStackEntry`). Add the design-system types beside these; `index.ts` re-exports.
- `packages/core/src/slots.ts` -- `codeStackSlot`, `ConflictSlot.slotKind: string`, `validatePublication`, `formatSlot` (via `MODULE_KIND_LABELS`, so "design system"). Add `designSystemSlot` and `entrySlot`; export them from `index.ts`; tests go in `slots.test.ts`.
- `apps/registry/migrations/0004_standards.sql` -- read-only reference; the `standard_versions` checks are unnamed inline column/table checks. Look up their generated names (probably `standard_versions_category_check`, `standard_versions_entry_check`, `standard_versions_name_check`) in `pg_constraint` before dropping them in 0005.
- `apps/registry/src/db/schema.ts:197-215` -- `category` typed with `CODE_STACK_CATEGORIES`, `entry` typed `CodeStackEntry`; widen both.
- `apps/registry/src/standards/validate.ts` -- `validateCodeStackEntry`, `optionalText`, `length`, `validatePublishBody(body)`. Add `validateDesignSystemEntry`, and make `validatePublishBody(body, moduleKind)`.
- `apps/registry/src/standards/service.ts` -- `publish()`: the "design-system → 400 entry" block (around l.180), `codeStackSlot(entry)`, the insert of `category`/`name`, `toStandardInfo` (which destructures code-stack fields; return `version.entry` as stored), and `liveSet` (unchanged, because it reads the `category`/`name` columns).
- `apps/registry/src/standards/{validate.test.ts,standards.db.test.ts}` -- existing patterns. The DB test's "design-system → 400 entry" assertions (VG2 included) must change to the new refusals.
- `apps/registry/src/http/server.ts` -- generic over `body: unknown`; it should need no change. Check `server.test.ts` for the design-system expectations.
- `apps/registry/src/tenancy/tenancy.db.test.ts` -- asserts the table list; there are no new tables, but check for a migration-count assertion.
- `apps/panel/src/registry.server.ts:148-167` -- `publishStandard`/`publishStandardVersion` take `StandardPublishRequest["entry"]`; widen to the union request entry.
- `apps/panel/src/routes/module-standards.tsx` -- loader (awaits `listStandards`, resolves `editId`), action (reads the code-stack fields), `refusal()` (`SLOT_CONFLICT` fetches the holder, `invalid_input` maps the subject to `CODE_STACK_ENTRY_FIELDS`, `entry` → design-system denial), and the component (`list.module.kind === "code-stack" ? <StandardForm> : designSystemNotice`, `StandardsTable`).
- `apps/panel/src/components/standard-form.tsx` -- `STANDARDS_COPY`, `StandardForm`, Esc/edit focus, the field markup helpers. `STANDARDS_COPY.conflict` reads `entry.category`/`entry.name`.
- `apps/panel/src/routes/{loaders.test.ts,module-standards.action.test.ts,module-standards.test.tsx}`, `apps/panel/src/registry.server.test.ts` -- test patterns (`vi.stubGlobal("fetch")`, `createRoutesStub`).
- `apps/panel/src/styles/components.css` + `styles.test.ts` -- `.standard-form`, `.standards-table`; tokens only.
- `README.md` -- the Standards section from Story 1.5.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/contract/src/standards.ts` (+ `index.ts`, `standards.test.ts`) -- add `DESIGN_SYSTEM_ENTRY_KINDS`, `DESIGN_SYSTEM_STATUSES` (`required`, `prohibited`), `USAGE_RULE_MAX=1000`, `COMPONENT_TOKENS_MAX=50`, per-kind field lists (`COMPONENT_ENTRY_FIELDS` = kind, name, usageRule, tokens, correctionInstruction; `TOKEN_ENTRY_FIELDS` = kind, name, status; `IMPORT_ENTRY_FIELDS` = kind, specifier, status), the `DesignSystemEntryField` union, entry types, `DesignSystemEntry`, `StandardEntry = CodeStackEntry | DesignSystemEntry`, guards (`isDesignSystemEntry`, `isStandardEntry`), and the accessors `entrySlotKind(entry)` (category or kind) and `entrySlotName(entry)` (name or specifier). `StandardInfo.entry` becomes `StandardEntry`; `StandardPublishRequest.entry` becomes a union with the design-system request shape. Tests cover each guard and accessor.
- [ ] `packages/core/src/slots.ts` (+ `index.ts`, `slots.test.ts`) -- add `designSystemSlot(entry)` and `entrySlot(entry)`, which dispatches on the entry shape. Tests: token "primary" vs library "primary" → ok; component vs token with the same name → ok; two components "Button"/"button" in different Standards → `slot_conflict` naming both; an import specifier clash → conflict.
- [ ] `apps/registry/migrations/0005_design_system_entries.sql` + `src/db/schema.ts` -- drop and recreate the `standard_versions` category and entry checks. `category` must be one of the six slot kinds. `entry` is an object whose shape matches `category`: code-stack (`entry.category = category`, `entry.name = name`, status approved/prohibited/required); component (`entry.kind = 'component'`, `entry.name = name`, `entry.tokens` is an array, `entry.usageRule` is a string); token (`entry.kind = 'token'`, `entry.name = name`, status required/prohibited); import (`entry.kind = 'import'`, `entry.specifier = name`, status required/prohibited). No grant change. Widen the schema types.
- [ ] `apps/registry/src/standards/validate.ts` (+ `validate.test.ts`) -- add `validateDesignSystemEntry` with the check order and limits above (tokens must be an array of strings; duplicates are compared trimmed, NFC, lowercase), and `validatePublishBody(body, moduleKind)`. Tests cover every invalid row of the matrix.
- [ ] `apps/registry/src/standards/service.ts` -- validate with the Module's kind, call `entrySlot(entry)`, insert `category = entrySlotKind(entry)` and `name = entrySlotName(entry)`, and have `toStandardInfo` return the stored entry. Drop the design-system refusal. Update the doc comments.
- [ ] `apps/registry/src/standards/standards.db.test.ts` (+ `server.test.ts` if needed) -- over HTTP, cover the publish component/token/import, cross-kind, same-kind clash (across two design-system Modules too), edit, invalid (subjects), wrong-kind-for-Module and non-owner rows. Also prove the DB check refuses a raw insert of a token row with status `approved`.
- [ ] `apps/panel/src/registry.server.ts` (+ test) -- widen the entry parameter types; add one test that posts a design-system entry.
- [ ] `apps/panel/src/components/design-system-form.tsx` (new) + `standard-form.tsx` -- the design-system `standard-form`:
  - Heading "Publish a design-system Standard" / "Edit <name>".
  - First field "Entry kind" (select: component, token, import). Default is component, or the edited Standard's kind. Only the chosen kind's field set renders (React state).
  - Component fields: Name; Usage rule (textarea); "Tokens it depends on (optional, separated by commas)" (text, split on commas, trimmed, blanks dropped); Correction instruction (optional textarea).
  - Token fields: Name, Status (required/prohibited). Import fields: Module specifier, Status.
  - Then the gold "Publish" button.
  - Same edit, Esc and Cancel-edit behaviour as `StandardForm`, and an ink field error per subject.
  - Copy lives in `DESIGN_SYSTEM_COPY`, which includes field errors for every design-system field.
  - Remove `designSystemDenial`/`designSystemNotice`. Generalise `STANDARDS_COPY.conflict` to use `entrySlotKind`/`entrySlotName` and the proposed values (kind + name/specifier).
- [ ] `apps/panel/src/routes/module-standards.tsx`:
  - The loader returns `{moduleId, editParam, standards: Promise<RegistryResult<StandardList>>}` without awaiting, after the session-cookie check.
  - The component renders the heading, the status region and the "Standards" section inside `<Suspense fallback={<ColdLoad/>}>` with `<Await>`. `ColdLoad` shows the h1 "Standards", the section heading, and a table with the active header cells and one `aria-busy` row "Loading Standards…".
  - On resolve:
    - ok: the current UI. A `session_invalid` result shows a denial with a "Sign in again" link to `/sign-in`. Not-found and unavailable keep their copy.
    - The code-stack Module keeps `StandardForm`. A design-system Module renders `DesignSystemForm` and a design-system table with header cells: Standard, Entry kind, Status (`None` for components), Usage rule (`None` unless component), Tokens (comma-joined, `None` when empty or not a component), Version, Published (UTC), Standard id. Each row keeps the "Edit <name>" link.
  - The action reads `kind`. When the field is present, it builds the design-system entry (component tokens split as above). Otherwise it builds the code-stack entry. It keeps the values and maps `invalid_input` subjects to the design-system or code-stack field errors by Module form. A subject `entry` or `kind` on the code-stack form → actionUnavailable.
- [ ] panel tests -- the loader returns the pending promise. Component tests: cold-load structure (header cells, `aria-busy`, no form), empty state, design-system form field sets per kind (switching kind shows the right fields), design-system table header cells, refused submit keeps values and ink text, conflict copy for a component, the "Sign in again" denial. Action tests: design-system publish ok, the tokens split, each field-error subject, the conflict. Update the existing tests that expected the design-system notice or awaited loader data.
- [ ] `README.md` -- the design-system entry shapes, the `kind` check order, and that the slot kind is the entry kind.

**Acceptance Criteria:**
- Given the owner of the design-system Module on its Standards page, when they publish a component, a token and an import, then each shows the published facts and appears in the table with header cells; when they edit and republish a component, the table shows version 2 with the same id.
- Given a live code-stack library "primary", when the design-system owner publishes token "primary", then it is accepted; when anyone publishes a second live component with an existing component's name at the root Project, then the form names both Standards and no row is added.
- Given the Standards page while the list is loading, then the structure and table header cells show with a busy row and no form; given a Module with no Standard, then the empty text shows.
- Given a fresh clone without `REGISTRY_TEST_DATABASE_URL` and `CI`, when build, typecheck, lint, boundaries and test run, then all pass with the DB suites skipped.

## Spec Change Log

## Review Triage Log

### 2026-10-12 — Review pass
- verdicts: 25 findings — high 0, medium 0, low 19, false 6, maybe-false 0
- findings:
  - `[low]` `[reject]` BH1: the 64 KiB body limit does not fit a maximal component sent as escaped surrogate pairs, and the higher limit now applies to every route. The panel sends raw UTF-8 (`JSON.stringify`). Only a hand-written client sending 50×200 escaped astral characters reaches 413, and sizing for that would mean a per-route limit.
  - `[low]` `[reject]` BH2: a token name with a comma (API only) splits in two when edited in the panel. The panel cannot create such a name and no other client exists; refusing commas would add a new validation rule.
  - `[low]` `[patch]` BH3: `validate.ts` duplicates core's slot-name normaliser. Fixed: it now imports `normalizeSlotName` from `@domain-harness/core`.
  - `[low]` `[reject]` BH4: a lapsed session redirects on publish but shows a denial on load. The action's redirect is unchanged from 1.5; the load-side denial is required because the list is no longer awaited before render.
  - `[low]` `[reject]` BH5: `toStandardInfo` serves the stored entry without picking out the known keys. Every stored entry comes from the validator's normalised object, so an extra key needs a raw DB write.
  - `[low]` `[reject]` BH6: the 0005 entry check does not check token element types, the `correctionInstruction` type, or extra keys. Same split as 1.5 (BH5 there): the service validates every field, and the DB check is a second guard on the slot columns.
  - `[false]` `[reject]` BH7: the migration guesses constraint names. PostgreSQL's names for unnamed checks are deterministic, and the migration suite runs 0001→0005 on a fresh DB. Rows written by 1.5's validator satisfy the tightened code-stack branch.
  - `[low]` `[reject]` BH8: the cold-load headers are a shared subset, and the heading changes to the Module name. The Module kind is unknown until the list arrives, so the shared header cells are the only honest structure. `aria-busy` on both `tbody` and `tr` is harmless.
  - `[false]` `[reject]` BH9: the spec's checkboxes and logs were not updated. The workflow fills the triage log and the result at finalisation; fixing it would mean editing this build's spec.
  - `[low]` `[patch]` BH10: switching Entry kind discards the typed Name. Fixed: `key={kind}` removed, so the shared Name field keeps its value; a test asserts this.
  - `[low]` `[reject]` BH11: the action picks the form from `form.has("kind")`, not the Module kind. Only a crafted or stale cross-page post reaches this, and the registry still refuses it.
  - `[low]` `[reject]` BH12: no page-level import edit test, no kind-change edit test in the panel, DB tests share a `button` variable, and the table headers are hard-coded. Neighbouring tests cover each of these: the import action tests, the DB kind-change test, the token edit page test. The shared-fixture style follows the 1.5 suite.
  - `[low]` `[reject]` EC1: commas in token names. Same as BH2.
  - `[low]` `[reject]` EC2: a `kind` post to a code-stack page gives a field error that is never shown. Crafted requests only, same root as BH11.
  - `[false]` `[reject]` EC3: an edit can change the entry kind. The spec allows this ("A new version may change the entry kind; the slot moves and is re-validated"), and a DB test proves the re-validation.
  - `[low]` `[reject]` EC4: no projection in `toStandardInfo`. Same as BH5.
  - `[low]` `[reject]` EC5: the DB check is loose. Same as BH6.
  - `[low]` `[reject]` EC6: the cold-load headers do not match "active header cells". Same as BH8.
  - `[low]` `[reject]` EC7: the error mapping is chosen by the submitted fields. Same as BH11.
  - `[false]` `[reject]` IA1: AC1–3 are proven only in the skipped DB suite. The DB suite ran in this verification (registry 368 tests with `REGISTRY_TEST_DATABASE_URL`).
  - `[low]` `[reject]` IA2: `server.test.ts`'s fake service dispatches on a `kind` key rather than the Module kind. The real dispatch is covered by `validate.test.ts` and the DB suite.
  - `[low]` `[reject]` IA3: the cold-load is tested in jsdom only. The implementer also checked SSR streaming against the built panel with a delayed fake registry; the structure arrived in about 20 ms and the data at 1.5 s.
  - `[false]` `[reject]` IA4: the /standards index page is untouched. Its Modules table already has header cells (Story 1.4); the AC's "Standards list" is the per-Module table.
  - `[false]` `[reject]` IA5: the lapsed-session behaviour changed. This is a necessary consequence of the deferred loader, and a test covers the denial plus the "Sign in again" link.
  - `[false]` `[reject]` IA6: the global body limit was raised. This is a necessary consequence: the longest valid component exceeds 16 KiB, and a server test covers it.

## Design Notes

- **Entry kind is the slot kind**, mirroring code-stack's `category`. The `kind` discriminator also tells the shapes apart on the wire, because code-stack entries carry `category` and never `kind`.
- **One form, one gold button.** EXPERIENCE.md asks for "separate field sets for each entry kind", and DESIGN.md allows gold only on the primary action. So a single `standard-form` switches its field set by "Entry kind" instead of showing three Publish buttons.
- **Cold-load via `Await`.** React Router SSR only renders a route after its loader resolves. A deferred `standards` promise lets the structure stream first, and on client navigation the transition keeps the old page until the new one is ready.
- **Tokens are free names.** The Gate (Epic 5) evaluates them. Refusing a component whose token is not yet published would force a publishing order that the AC does not ask for.

## Verification

**Commands:**
- `docker compose up -d --wait postgres` then `REGISTRY_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres pnpm test` -- expected: all suites pass, with the DB suites run.
- `pnpm run build && pnpm run typecheck && pnpm run lint && pnpm run boundaries` -- expected: exit 0.
- `pnpm test` without the env var -- expected: passes, with the DB suites skipped.

## Auto Run Result

Status: done

**Summary:** The Standard owner of a design-system Module can now publish, edit and republish three kinds of design-system Standards. They go through the same append-only versioning, owner checks and Conflict slot rule as code stack:
- Components: name, usage rule, the tokens the component depends on, and an optional Correction instruction.
- Tokens: name, required or prohibited.
- Imports: module specifier, required or prohibited.

Slots are (design system, entry kind, name or specifier). A token "primary" and a code-stack library "primary" can both be live, while a second component with the same name is refused across all design-system Modules. The registry picks the entry validator from the Module's kind. Migration 0005 widens the `standard_versions` checks to all six slot kinds. The panel's Module Standards page gains:
- A design-system `standard-form`: one form, an "Entry kind" select that switches the field set, and one gold Publish button.
- A design-system Standards table with header cells.
- A cold-load structure: the loader defers the list, and `Suspense`/`Await` show the headings, the shared table header cells and a busy "Loading Standards…" row while it loads.

**Files changed:**
- `packages/contract/src/standards.ts` (+ test, `index.ts`): the design-system entry shapes, statuses, limits, per-kind fields, guards, and `entrySlotKind`/`entrySlotName`. `StandardInfo.entry` is now a union.
- `packages/core/src/slots.ts` (+ test, `index.ts`): `designSystemSlot` and `entrySlot`.
- `apps/registry/migrations/0005_design_system_entries.sql`, `src/db/schema.ts`: the widened category and entry checks.
- `apps/registry/src/standards/{validate,service}.ts` (+ `validate.test.ts`, `standards.db.test.ts`): design-system validation and kind-based dispatch. Publishing stores the slot kind and slot name.
- `apps/registry/src/http/server.ts` (+ test): `MAX_BODY_BYTES` raised to 64 KiB so the longest valid component fits.
- `apps/registry/src/tenancy/tenancy.db.test.ts`: the migration list now includes 0005.
- `apps/panel/src/components/{design-system-form,standard-form}.tsx`, `routes/module-standards.tsx`, `registry.server.ts`, `styles/components.css` (+ tests): the design-system form and table, the cold-load state, the "Sign in again" denial, and generalised conflict and published copy.
- `README.md`: the design-system entry shapes, the `kind` check order, and migration 0005.

**Review findings:** 25 in total: high 0, medium 0, low 19, false 6.
- **Patched (2, both low):**
  - BH3: duplicate tokens are now checked with core's `normalizeSlotName`.
  - BH10: switching Entry kind keeps the typed Name.
- **Deferred:** none.
- **Rejected:** 17 low and 6 false, each with its reason in the triage log. The main themes:
  - Several are reachable only by crafted or raw-DB requests (comma tokens, no entry projection, loose DB check, form picked by the submitted fields).
  - Others are documented deviations (the 64 KiB global body limit, the cold-load header subset, the lapsed-session denial).

**Follow-up review recommended: false.** Patched counts: high 0, medium 0, low 2.

**Verification:**
- `pnpm run build`, `typecheck`, `lint` and `boundaries` exit 0, re-run after the patches.
- With `REGISTRY_TEST_DATABASE_URL` (compose PG18), all pass:

  | Package | Tests passed |
  |---|---|
  | registry | 368 |
  | panel | 193, plus 1 skipped (the existing contrast exception) |
  | contract | 129 |
  | core | 19 |
  | boundaries | 16 |

- Without the database URL, all pass and the DB suites print a skip reason.
- Matrix audit: every I/O row has a covering test that ran:
  - core: `slots.test.ts`
  - registry: `validate.test.ts` and `standards.db.test.ts`, including raw-insert check refusals
  - panel: `module-standards.test.tsx` and `module-standards.action.test.ts`, covering cold-load, empty, outage and conflict

**Residual risks:**
- These deviations from the spec are recorded here:
  - The body limit was raised to 64 KiB on every route.
  - The cold-load table shows the 5 header cells both tables share, because the Module kind is unknown while the list loads.
  - On load, a lapsed session now shows a "Sign in again" denial instead of redirecting.
  - The old entry check was named `standard_versions_check` and is recreated as `standard_versions_entry_check`.
- Token names may contain commas through the API, which the panel's comma-separated field cannot round-trip.
- The DB entry check does not restrict extra keys or token element types. The service validator is the guard.
- Choices made on the human's behalf:
  - The entry kind is the slot kind.
  - A component's tokens are free names, not references to token Standards.
  - The Correction instruction exists on components only.
  - An edit may change the entry kind.
- Kind switching, Esc/focus and the narrow layouts were checked in jsdom only. The implementer checked cold-load streaming against the built panel.
