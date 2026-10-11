---
title: 'Story 1.5: Standard owner publishes a versioned code-stack Standard'
type: 'feature'
created: '2026-10-11'
status: 'done'
baseline_commit: '666825eadb53d10f0e44c9f0549517041f060d62'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-domain harness-2026-10-09/DESIGN.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** Modules have owners (Story 1.4) but nothing can be published into them: there are no Standards, no versions and no conflict-slot rule, so the Company's approved, prohibited and required stack is not on record (FR-1, FR-2, AD-13).

**Approach:** `packages/core` gains the pure conflict-slot rule (slot = (Module kind, slot kind, name)) and whole-set publication validation. The registry gains append-only `standards` + `standard_versions` tables (migration 0004, forced RLS), a Standards service that checks Module, owner, entry and core validation before writing, and Bearer endpoints to list, publish and re-publish code-stack Standards. The panel gains a per-Module Standards page with a Standards table and the code-stack `standard-form`.

## Boundaries & Constraints

**Always:**
- A Standard is one entry in one Module at one Project scope; in this story the scope is always the tenant's root Project. A Standard has a registry-minted UUIDv7 id that stays the same across versions. Each publish inserts one `standard_versions` row with `version` = previous max + 1 (first = 1), `published_by`, `published_at` (UTC). Rows are never updated or deleted (`dh_registry_app` gets `SELECT, INSERT` only). The live version of a Standard is its highest version; the published version is the version in force.
- Code-stack entry (shape kept stable in `contract` for Epic 5): `category` ∈ `language | framework | library` (the slot kind), `name` (trimmed, 1–200 chars; the conflict-slot name), `versionConstraint` (optional; trimmed, ≤100 chars, `""`/missing/null → `null`), `status` ∈ `approved | prohibited | required`, `correctionInstruction` (optional; trimmed, ≤1000 chars, `""`/missing/null → `null`). Any other key in `entry` → `400 invalid_input` subject = that key. Invalid field → `400 invalid_input` subject = the field name.
- Publish check order (first failure wins, nothing written): Bearer session (401) → Module/Standard exists in tenant (`404 module_not_found` / `standard_not_found`, malformed ids included) → Module has an owner (`409 module_has_no_owner`, subject `moduleId`) → session account is the current owner (`403 not_module_owner`, subject `role`) → entry valid (400) → Module kind is `code-stack` (design-system → `400 invalid_input` subject `entry`; Story 1.6) → core validation (`409 slot_conflict`).
- Core validation: the registry builds the whole proposed live set at the root Project (every Standard's live version across all Modules of the tenant, with the proposed version replacing its own Standard's live version) and calls `core`. Two different Standards whose slots are equal at the same scope are a conflict; slot names compare trimmed, NFC, case-insensitively. Core returns an error naming both Standard ids and the slot; `subject` is the id of the Standard already holding the slot. Re-publishing the same Standard in its own slot is never a conflict. Core does no I/O and reads no clock.
- Publishes in one tenant serialise on a transaction advisory lock keyed by the root Project id taken before the live-set read, so two concurrent publishes into one slot cannot both succeed.
- Reading Standards (`GET`) is open to every role of the tenant. All queries via `withTenant`; new tables have RLS enabled + forced with the 0001 policy shape, composite FKs `(tenant_id, …)`, and are in `TENANT_TABLES`.
- Panel imports only `contract`; errors are the `{code,message,subject}` envelope; logs carry ids, codes and counts only. Controls are shown to every role; a refusal is a `denial` in the `role="status"` region; an invalid submit keeps every value and puts ink text under the field. Gold only on the "Publish" button. Tables have header cells. Glossary terms, no all-caps.

**Never:** No design-system entries, empty/cold-load states beyond plain text, or Standard deletion/retirement (Story 1.6 / later). No scopes other than the root Project (Epic 2). No bundles, signing or active pointer (Epic 4). No client-minted ids. No UPDATE/DELETE grants. No panel DB access or `core` import in the panel. No language tagging of Standard text.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Publish new | Owner of code-stack Module M posts `{entry:{category:"library",name:" React ",versionConstraint:"^18",status:"approved"}}` to `/v1/modules/{M}/standards` | 201 `StandardInfo` `{id(UUIDv7), version:1, module:{id,kind,name}, project:{id,name} (root), entry:{…name:"React", correctionInstruction:null}, publishedAt, publishedBy}`; panel status names id, Module, root Project scope, version 1 and UTC time | none |
| Edit + republish | Owner posts changed entry to `/v1/standards/{S}/versions` | 201 version 2, same id; `GET /v1/standards/{S}/versions` returns v1 unchanged and v2 | none |
| No owner | Any session (Buyer, Builder, Standard owner) publishes into an ownerless Module | nothing written; panel denial "This Module has no owner, so nothing can be published into it…" | 409 `module_has_no_owner` |
| Not owner | Builder, Buyer, or owner of another Module publishes into M | nothing written; panel denial "Only the Standard owner of this Module can publish into it. Nothing was published." | 403 `not_module_owner` |
| Slot conflict | Live Standard A = (code-stack, library, "react") at root in Module M1; owner of M2 (or M1) publishes a new library "REACT" | nothing written; panel denial names the proposed entry and Standard A (id, name, its Module) and the slot | 409 `slot_conflict`, subject A.id |
| No conflict | library "react" vs framework "react", or a design-system slot named "react" | both may be live (core unit test) | none |
| Invalid entry | missing/blank name, 201-char name, bad category/status, 101-char constraint, 1001-char instruction, extra key | nothing written; panel keeps all values, ink text under the named field | 400 `invalid_input`, subject = field |
| Unknown ids | random/foreign/malformed Module or Standard id | nothing written | 404 `module_not_found` / `standard_not_found` |
| Concurrent | two owners publish the same slot at once | exactly one 201, the other 409 `slot_conflict` | none |
| Registry down | panel cannot reach registry | page structure plus denial-style "Standards are unavailable right now…" | panel catches |

</intent-contract>

## Code Map

- `packages/core/src/index.ts`, `index.test.ts`, `package.json` -- currently only `packageName`; may import `@domain-harness/contract` only (boundary rule `core-imports-only-contract`, no Node built-ins).
- `packages/contract/src/{modules,guards,index,errors}.ts` -- pattern for wire types, guards (`isRecord`, `isUtcIso`), paths, error codes; `ModuleKind`, `AccountRef`, `ModuleInfo`, `MODULE_NOT_FOUND`. Add `standards.ts` beside them.
- `apps/registry/migrations/0003_modules.sql` -- table/RLS/grant shape to copy; `projects_tenant_id_id_key` and `modules_tenant_id_id_key` exist for composite FKs.
- `apps/registry/src/db/schema.ts` -- Drizzle mirror + `TENANT_TABLES`.
- `apps/registry/src/modules/service.ts` -- `withTenant`, advisory lock, `DISTINCT ON` latest-row query, `accountNames`, `toId`, `toModuleInfo`, `ModuleService` shape. Current owner = assignment with max `sequence`.
- `apps/registry/src/tenancy/queries.ts` -- root Project = `projects` row with `parent_id IS NULL` (one per tenant).
- `apps/registry/src/http/server.ts` -- `ROUTES`, `matchRoute` (param route regex), `STATUS_BY_CODE`, `fields()`, `readJson`, `MAX_BODY_BYTES` (4 KiB; raise to 16 KiB), `RegistryServices`; `serve-cli.ts` wiring; `src/index.ts` exports.
- `apps/registry/package.json`, `tsconfig.build.json` -- add `@domain-harness/core` dependency and project reference (then `pnpm install`).
- `apps/registry/src/modules/modules.db.test.ts` -- DB-suite pattern (throwaway DB, admin migrate, runtime role, skip/CI-fail rule, advisory suite lock `MIGRATION_SUITE_LOCK`, `provisionCompany`, sign-in for HTTP tokens, server on port 0); `tenancy/tenancy.db.test.ts` (~l.111–140) asserts the exact table list/count.
- `apps/registry/src/http/server.test.ts` -- fake-service unit pattern; constructor takes `RegistryServices`.
- `apps/panel/src/registry.server.ts` -- `call()` → `ok | refused | unavailable`, `bearer`, `json`.
- `apps/panel/src/routes.ts` + `routes.test.ts` -- nested children list asserted exactly.
- `apps/panel/src/routes/standards.tsx`, `components/modules-section.tsx` -- loader/action/refusal pattern, `Status`, `Button`, field-error markup; Module name cell becomes a link to the Module's Standards page.
- `apps/panel/src/styles/components.css`, `styles.test.ts` -- `.standard-form`, `.modules-table`, `.field-error`; tokens only, accent only on `.button-primary`.
- `apps/panel/src/routes/standards.action.test.ts`, `standards.test.tsx` -- action/component test patterns (fetch stubbed via `vi.stubGlobal`, `createRoutesStub`).

## Tasks & Acceptance

**Execution:**
- [ ] `packages/contract/src/standards.ts` (+ export, + `standards.test.ts`) -- `CODE_STACK_CATEGORIES`, `CODE_STACK_STATUSES`, limits (`STANDARD_NAME_MAX=200`, `VERSION_CONSTRAINT_MAX=100`, `CORRECTION_INSTRUCTION_MAX=1000`), `CodeStackEntry`, `StandardPublishRequest {entry}`, `StandardInfo`, `StandardList {module: ModuleInfo, standards}`, `StandardVersionList {standardId, versions}`, paths `moduleStandardsPath(id)`, `standardVersionsPath(id)`, codes `STANDARD_NOT_FOUND`, `MODULE_HAS_NO_OWNER`, `NOT_MODULE_OWNER`, `SLOT_CONFLICT`, guards -- one wire contract.
- [ ] `packages/core/src/slots.ts` (+ export, + `slots.test.ts`) -- `ConflictSlot`, `codeStackSlot(entry)`, `normalizeSlotName`, `sameSlot`, `formatSlot`, `validatePublication(live, proposed)` returning `{ok:true}` or `{ok:false, error: ErrorEnvelope, standards:[proposedId, existingId]}` -- AD-13 rule, tuple proven by tests.
- [ ] `apps/registry/migrations/0004_standards.sql` + `src/db/schema.ts` -- `standards` (id, tenant_id, module_id, project_id, created_by, created_at; `UNIQUE(tenant_id,id)`) and `standard_versions` (id, tenant_id, standard_id, version ≥1, category, name trimmed 1–200, entry jsonb, published_by, published_at; `UNIQUE(standard_id,version)`); composite FKs, forced RLS, `SELECT, INSERT` only; `TENANT_TABLES` extended.
- [ ] `apps/registry/src/standards/{validate,service}.ts` -- `validateCodeStackEntry`; `listStandards`, `listStandardVersions`, `publishStandard` (new), `publishStandardVersion` (edit) with the check order above; `createStandardService(db)`. Add `@domain-harness/core` dependency + tsconfig reference.
- [ ] `apps/registry/src/http/{server,serve-cli}.ts`, `src/index.ts` -- `GET|POST /v1/modules/{id}/standards`, `GET|POST /v1/standards/{id}/versions`; body exactly `{entry}`; 403/404/409 mappings; `MAX_BODY_BYTES` 16 KiB; wire `standards` service.
- [ ] registry tests -- `validate.test.ts`; `server.test.ts` routes/status with fake service; `standards/standards.db.test.ts` covering every registry matrix row end to end over HTTP, append-only proof (runtime UPDATE/DELETE on both tables → permission denied), RLS cross-tenant read with tenant filter omitted, concurrent same-slot publish; update `tenancy.db.test.ts` table list/count.
- [ ] `apps/panel/src/registry.server.ts` (+ tests) -- `listStandards`, `getStandardVersions`, `publishStandard`, `publishStandardVersion`.
- [ ] `apps/panel/src/routes.ts`, `routes/module-standards.tsx`, `components/standard-form.tsx` (+ CSS only if needed) -- route `standards/:moduleId`; loader (list + `?edit=<standardId>` selects the Standard to edit, autofocusing the first field); action `intent=publish` (+ optional `standardId`) mapping every refusal per matrix; on `slot_conflict` fetch the subject's versions to name it (fallback: id only). UI: h1 Module name, kind and owner text, link "All Modules"; status region; on success a "Published" description list (Standard id, Module, Project scope "<root name> (root Project)", Version, Published UTC); table (header cells: Standard, Category, Status, Version constraint, Version, Published, Standard id) with per-row "Edit <name>" link, empty text "No Standard is published in this Module yet."; code-stack form fields in order Category, Name, Version constraint (optional), Status, Correction instruction (optional textarea), button-primary "Publish"; editing shows "Cancel edit", and Esc in the form while editing returns to the page without committing and focuses that row's Edit link; design-system Module shows "Design-system entries are not available yet." instead of the form. `modules-section.tsx`: Module name links to its page; `standards.tsx` intro "Open a Module to see and publish its Standards."
- [ ] panel tests -- action/loader for every panel matrix row (stubbed fetch), component test (header cells, form for Builder role too, denial in `role="status"`, values kept + ink text on invalid submit, publish result shows the five facts), `routes.test.ts`.
- [ ] `README.md` -- Standards endpoints, refusals, and that only a Module's Standard owner publishes.

**Acceptance Criteria:**
- Given the owner of a code-stack Module on its Standards page, when they publish an entry, then the page shows the Standard id, Module, root Project scope, version 1 and UTC timestamp, and the table lists it; when they edit and publish again, the table shows version 2 with the same id and the registry still returns version 1 unchanged.
- Given live library "X" at the root Project, when anyone publishes a different Standard with library "x" in any Module, then the form names both Standards, and no Standard or version row is added.
- Given core unit tests, when slots differ only in Module kind or slot kind, then they never conflict, and when (Module kind, slot kind, name) are equal for two different Standards at one scope, validation fails naming both.
- Given a fresh clone without `REGISTRY_TEST_DATABASE_URL` and `CI`, when build, typecheck, lint, boundaries and test run, then all pass with DB suites skipped.

## Spec Change Log

## Review Triage Log

### 2026-10-11 — Review pass
- verdicts: 29 findings — high 0, medium 0, low 21, false 8, maybe-false 0
- findings:
  - `[low]` `[reject]` BH1: one pre-existing conflict in the live set blocks every later publish — publishes are serialised under the scope lock with the slot rule, so the set cannot become inconsistent through the registry; AD-13 asks for an error rather than a guess.
  - `[low]` `[reject]` BH2: conflict copy always says "root Project" and takes the slot text from the holder's entry — scope is always the root Project in this story; on the reachable path the holder's live entry is the slot that clashed.
  - `[false]` `[reject]` BH3: `MAX_BODY_BYTES` raised to 16 KiB on every route — the spec requires exactly this; the change follows it.
  - `[low]` `[reject]` BH4: a malformed or missing `entry` reads as the design-system denial in the panel — the panel always sends an entry object, so only a crafted request reaches this.
  - `[low]` `[reject]` BH5: the database does not enforce slot uniqueness or the optional-field length limits — "live" is the latest version, which a unique index cannot express; the service validates every field and holds the scope lock (same split as Story 1.4).
  - `[low]` `[reject]` BH6: lowercase is not full case folding (ß, fullwidth forms) — a rare edge for language, framework and library names; NFKC or case folding adds new rules.
  - `[low]` `[patch]` BH7: version history and the publisher are not shown; the "Published" column does not say UTC — renamed the column header "Published (UTC)"; a history view goes beyond the ACs (the API serves the versions).
  - `[low]` `[reject]` BH8: every request loads all of the tenant's accounts and Projects; O(n²) pairwise check — the pilot Company has a handful of Standards.
  - `[low]` `[patch]` BH9: the README refusal order leaves out 415/413/malformed JSON, which the server checks first — README now states these transport refusals come before the listed order; reading the body lazily would add complexity for crafted requests only.
  - `[low]` `[reject]` BH10: an unknown intent or an unexpected `invalid_input` subject is shown as "unavailable" — only crafted requests reach these (same as BH5 in Story 1.4).
  - `[low]` `[reject]` BH11: focus is not moved to the first invalid field; Esc on a focused select leaves edit mode — the ACs do not require focus to move to the error; Esc leaving the form from any field is the specified behaviour.
  - `[low]` `[reject]` BH12: missing tests (Cancel-edit focus, list order, owner changing mid-request, live-set inconsistency over HTTP, more concurrent re-publishes) — each is either covered by a neighbouring test (Esc focus, owner reassignment, core inconsistency) or unreachable.
  - `[low]` `[reject]` EC2: a field over 16 KiB gets a 413 shown as "unavailable" — needs a paste of more than 16 KiB into a 1000-character field.
  - `[low]` `[reject]` EC3: a posted `standardId` from another Module publishes into that Module from this Module's page — only a crafted form does this, and the registry still requires the session to own the target Module.
  - `[low]` `[reject]` EC4: an inconsistent live set is reported as `slot_conflict` — same as BH1.
  - `[low]` `[reject]` EC5: the holder moves slots between the 409 and the versions read — the race window is milliseconds and the message is still about a real holder.
  - `[low]` `[patch]` VG1: the panel test cannot tell the holder's latest version from its first — the test's version 1 now has a different entry, and the message is asserted to name the latest.
  - `[low]` `[patch]` VG2: invalid entry before Module-kind check is not pinned — added a DB assertion that publishing `name: ""` into the design-system Module returns 400 `invalid_input` subject `name` and writes nothing.
  - `[false]` `[reject]` IA1: a Standard as one entry vs a versioned set of entries — the AC refuses "a second, different Standard in that same slot", so a Standard holds one slot; recorded in Design Notes.
  - `[false]` `[reject]` IA2: category added as the slot kind vs name-only slot — the AC's own example slot (code stack, library, "X") and its "core unit tests show the slot is the tuple (Module kind, slot kind, name)" require a slot kind.
  - `[false]` `[reject]` IA3: several code-stack Modules vs one — the AC names "the owner of a different Module" and AD-13 rejects clashes "across Modules"; recorded in Story 1.4.
  - `[false]` `[reject]` IA4: panel denial tests use stubbed registry responses — the DB suite proves the denials and "no version created" over HTTP with real sessions; the panel tests prove the mapping (same split as Stories 1.3/1.4).
  - `[false]` `[reject]` IA5: previous versions are not visible in the panel — the AC requires that a previous version is never mutated; the DB suite and `GET /v1/standards/{id}/versions` prove it.
  - `[false]` `[reject]` IA6: the AC example (missing name) is tested in the panel with a 201-character name — both are refused the same way; the missing name is proven at the registry and the panel mapping is subject-based.
  - `[false]` `[reject]` IA7: no test asserts the standard-form visual spec — `styles.test.ts` checks token use, and visual styling is not an AC of this story.
  - `[low]` `[patch]` EC1: non-owner or unknown-id POST with a bad content type, oversized or malformed body gets 415/413/400 before 404/409/403 — same root cause as BH9; README now documents transport refusals first.
  - `[low]` `[reject]` EC6: Esc while a select is focused in edit mode leaves edit mode — Esc leaving the form from any field is the specified behaviour; an open native popup consumes Esc itself.
  - `[low]` `[reject]` EC7: an unknown intent is announced as an outage — crafted requests only.
  - `[low]` `[patch]` EC8: claim — the documented check order is not the server's order for transport errors — same root cause as BH9; README patched.

## Design Notes

- **A Standard is one entry.** FR-1 gives a Standard one Module, scope, version and timestamp, and FR-2 says two code-stack Standards conflict when they share a name, so each Standard holds exactly one entry and one slot. Editing may change the name or category (the slot moves, re-validated).
- **Slot kind = category.** The AC's slot (code stack, library, "X") and FR-2's "language, framework or library" make the category the slot kind; it is a required field.
- **Case-insensitive slot names** (trim + NFC + lowercase): "React" and "react" are the same library; the stored name keeps the owner's spelling.
- **Live set query:** `SELECT DISTINCT ON (v.standard_id) … FROM standard_versions v JOIN standards s … JOIN modules m … WHERE s.project_id = $root ORDER BY v.standard_id, v.version DESC`, mapped to `{standardId, projectId, slot}` for `validatePublication`.

## Verification

**Commands:**
- `docker compose up -d --wait postgres` then `REGISTRY_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres pnpm test` -- all suites pass, DB suites not skipped.
- `pnpm run build && pnpm run typecheck && pnpm run lint && pnpm run boundaries` -- exit 0.
- `pnpm test` without the env var -- passes, DB suites skipped with a printed reason.

## Auto Run Result

Status: done

**Summary:** The Standard owner of a code-stack Module can publish, edit and re-publish code-stack Standards (category language/framework/library, name, optional version constraint, status approved/prohibited/required, optional Correction instruction). Each publish appends an immutable version (1, 2, 3, ...) under a stable registry-minted id at the root Project scope. `packages/core` owns the conflict-slot rule: a slot is (Module kind, slot kind, name), and names compare trimmed, NFC and case-insensitively. It validates the whole proposed live set across Modules and names both Standards on a clash. The registry refuses publishing in a fixed order: unknown Module or Standard, Module with no owner, non-owner, invalid entry, design-system Module, slot conflict. Writes go through migration 0004's append-only tables (forced RLS, SELECT/INSERT only), serialised by a per-scope advisory lock. The panel gains a per-Module Standards page: a Standards table, the code-stack standard-form, an edit flow, and published facts (id, Module, scope, version, UTC time).

**Files changed:**
- `packages/contract/src/standards.ts` (+ test, `index.ts`): code-stack entry shape, Standard wire types, paths, error codes, guards.
- `packages/core/src/slots.ts` (+ test, `index.ts`): conflict slot and `validatePublication`.
- `apps/registry/migrations/0004_standards.sql`, `src/db/schema.ts`: `standards` and `standard_versions` tables.
- `apps/registry/src/standards/{service,validate}.ts` (+ `validate.test.ts`, `standards.db.test.ts`): list, versions and publish operations; entry validation.
- `apps/registry/src/http/{server,serve-cli}.ts`, `src/index.ts`, `src/modules/service.ts`: new routes, status mappings, 16 KiB body limit, wiring, shared helpers.
- `apps/registry/{package.json,tsconfig.build.json}`, `pnpm-lock.yaml`: dependency on `@domain-harness/core`.
- Registry tests updated for the new service and tables: `server.test.ts`, `modules.db.test.ts`, `sign-in.db.test.ts`, `tenancy.db.test.ts`.
- `apps/panel/src/{registry.server.ts,routes.ts,routes/module-standards.tsx,components/standard-form.tsx,components/modules-section.tsx,routes/standards.tsx,styles/components.css}` (+ tests): the Module Standards page.
- `README.md`: Standards endpoints, refusal order (transport refusals first), owner-only publishing.

**Review findings:** 29 findings: high 0, medium 0, low 21, false 8.
- **Patched (low, 4 entries covering 6 findings):**
  - BH9/EC1/EC8: the README now states that transport refusals come first.
  - BH7: the table column is "Published (UTC)".
  - VG1: a test now proves the conflict message names the holder's latest version.
  - VG2: a DB test pins that entry validation runs before the Module-kind check.
- **Deferred:** none.
- **Rejected:** 15 low and 8 false, each with its reason in the triage log.

**Follow-up review recommended: false.** Patched counts: high 0, medium 0, low 4.

**Verification:**
- `pnpm run build`, `typecheck`, `lint` and `boundaries` exit 0, re-run after the patches.
- With `REGISTRY_TEST_DATABASE_URL` (compose PG18), all pass:
  - registry 306
  - panel 168 + 1 skipped (the existing contrast exception)
  - contract 115
  - core 13
  - boundaries 16
- Without the database URL, all pass and the four DB suites print a skip reason.
- Matrix audit: every I/O row has a covering test that ran:
  - core: `slots.test.ts`
  - registry: `standards.db.test.ts` and `validate.test.ts`
  - panel: `module-standards.action.test.ts` and `module-standards.test.tsx`

**Residual risks:**
- Slot uniqueness and the optional-field lengths are enforced by the service and its scope lock, not by database constraints.
- Slot names compare with lowercase, not full Unicode case folding.
- Choices made on the human's behalf:
  - A Standard holds exactly one entry.
  - The entry's category (language, framework, library) is a required field and is the slot kind.
  - Slot names are case-insensitive.
- The panel shows no version history; the registry serves it at `GET /v1/standards/{id}/versions`.
- No real-browser check of the page, the Esc/focus behaviour, or the 320px layout was done in this run.
