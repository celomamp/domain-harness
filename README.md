# Domain Harness

TypeScript monorepo for Domain Harness. The layout and dependency rules come from the architecture spine (`_bmad-output/planning-artifacts/architecture/`); scaffold choices are recorded in [`docs/decisions/starter-template.md`](docs/decisions/starter-template.md).

```text
packages/
  contract/    # bundle format, Compilation schemas, tool results, error envelope, UUIDv7 id type
  core/        # pure resolver (imports only contract)
  extractor/   # revision facts from file contents (imports only contract)
  collector/   # record -> Compilation projection, durable queue
  mcp-bridge/  # stdio MCP bridge run in a Builder's repository (imports only contract (+ its MCP SDK))
apps/
  registry/    # vendor registry, bundle builder, Boilerplate (imports core + contract)
  panel/       # vendor management panel (imports contract only)
  service/     # Company Standards service
  cli/         # offline CLI Gate
tooling/
  tsconfig/        # shared strict TypeScript base
  eslint-config/   # shared typescript-eslint flat config
  boundaries/      # dependency-boundary check and its tests
```

## Requirements

- Node.js 24 or later (26 LTS is the target).
- pnpm 12, pinned in `package.json` (`packageManager`) and provided by corepack:

  ```sh
  corepack enable pnpm
  ```

  Node 25 and later no longer bundle corepack. Install it first with `npm install --global corepack@0.36.0`.

## Commands

```sh
pnpm install          # install the workspace
pnpm run build        # tsc -b in every package (TypeScript 7); react-router build for the panel
pnpm run typecheck    # typecheck sources and tests
pnpm run lint         # ESLint with typescript-eslint
pnpm run boundaries   # dependency-boundary check (.dependency-cruiser.cjs)
pnpm test             # Vitest in every package
```

CI (`.github/workflows/ci.yml`) runs the same steps on every push, on Node 24 and 26.

## Database (registry)

The registry uses PostgreSQL 18. For local work, start the compose service (its password is a local-only development credential, not a secret):

```sh
docker compose up -d --wait postgres
```

Connection strings come only from environment variables:

| Variable | Used by | Connects as |
| --- | --- | --- |
| `REGISTRY_MIGRATION_DATABASE_URL` | `migrate` | the migrator, which owns the tables |
| `REGISTRY_DATABASE_URL` | `provision` (and the registry runtime) | a login role that is a member of `dh_registry_app`, never a superuser, `BYPASSRLS` role or table owner |
| `REGISTRY_TEST_DATABASE_URL` | `pnpm test` (database suite) | an admin role that may create and drop databases |

`migrate` runs as the migrator role, which owns the tables it creates. The registry runtime never uses that role. In production, create a separate login role for the runtime that is a member of `dh_registry_app` only. It must not be a member of the table owner, a superuser or `BYPASSRLS`. Take the password from your secret manager:

```sql
-- after the first migrate (it creates dh_registry_app)
CREATE ROLE registry_runtime LOGIN PASSWORD '<from your secret manager>' IN ROLE dh_registry_app;
```

`REGISTRY_DATABASE_URL` then names `registry_runtime`. `provision` refuses to start when the role is unsafe.

Apply migrations (idempotent):

```sh
export REGISTRY_MIGRATION_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres
pnpm --filter @domain-harness/registry migrate
```

Provision one Company from a JSON file. `plan` is optional (`Community`, `Team`, `Business` or `Enterprise`; default `Team`) and each account's `role` is `Buyer`, `Standard owner` or `Builder`:

```json
{
  "company": "Acme",
  "plan": "Team",
  "accounts": [
    { "name": "Bea", "email": "bea@acme.example", "role": "Buyer" },
    { "name": "Sam", "email": "sam@acme.example", "role": "Standard owner" },
    { "name": "Bo", "email": "bo@acme.example", "role": "Builder" }
  ]
}
```

```sh
# Locally, `options=-c role=dh_registry_app` makes the dev superuser act as the
# runtime role; in production use a login role that is a member of dh_registry_app.
export REGISTRY_DATABASE_URL='postgres://postgres:postgres@localhost:5432/postgres?options=-c%20role%3Ddh_registry_app'
pnpm --filter @domain-harness/registry provision ./company.json
```

It prints `{ tenantId, rootProjectId, plan, accounts: [{ id, role }] }` (ids only, no names or emails). Any error prints one `{ code, message, subject }` envelope to stderr, exits 1 and writes nothing.

The database test suite (`apps/registry/src/tenancy/tenancy.db.test.ts`) runs when `REGISTRY_TEST_DATABASE_URL` is set, creating and dropping its own throwaway database:

```sh
REGISTRY_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres pnpm test
```

Without it, the suite is skipped with a printed reason; when `CI` is set, a missing URL fails the run.

## Sign-in and the management panel

The registry serves a small internal JSON API that the panel calls over HTTP; the panel never touches the database.

| Variable | Used by | Meaning |
| --- | --- | --- |
| `REGISTRY_DATABASE_URL` | registry `serve` | runtime role, as for `provision` |
| `REGISTRY_HTTP_HOST`, `REGISTRY_HTTP_PORT` | registry `serve` | listen address, default `127.0.0.1:4100` |
| `REGISTRY_PANEL_URL` | registry `serve` | the panel's public base URL; emailed links point at `<url>/sign-in/verify` |
| `REGISTRY_SMTP_URL` + `REGISTRY_MAIL_FROM` | registry `serve` | real delivery over SMTP (Nodemailer) |
| `REGISTRY_MAIL_OUTBOX_DIR` | registry `serve` | local delivery: one JSON file per message, mode 0600 |
| `PANEL_REGISTRY_URL` | panel | registry API base URL, default `http://127.0.0.1:4100` |
| `PORT`, `HOST` | panel `start` | where the panel server (`apps/panel/server.js`) listens (default port 3000, all interfaces) |

Set exactly one of SMTP or the outbox; otherwise `serve` refuses to start. Run both locally and sign in through the outbox (after `migrate` and `provision` above):

```sh
# terminal 1: registry API, mail written to ./.outbox (ignored by git)
export REGISTRY_DATABASE_URL='postgres://postgres:postgres@localhost:5432/postgres?options=-c%20role%3Ddh_registry_app'
REGISTRY_PANEL_URL=http://localhost:3000 REGISTRY_MAIL_OUTBOX_DIR="$PWD/.outbox" \
  pnpm --filter @domain-harness/registry serve

# terminal 2: the panel (production build); `pnpm --filter @domain-harness/panel dev` serves on :5173 instead
pnpm --filter @domain-harness/panel build
pnpm --filter @domain-harness/panel start
```

Open `http://localhost:3000/sign-in`, enter a provisioned address, then open the link in the newest `.outbox/*.json` file. It works once and expires after 15 minutes; the session lasts 12 hours. Any well-formed address shows the same "Check your email for a sign-in link" text. With `pnpm dev`, set `REGISTRY_PANEL_URL=http://localhost:5173`.

The sign-in database suite (`apps/registry/src/sign-in/sign-in.db.test.ts`) runs with the tenancy suite under `REGISTRY_TEST_DATABASE_URL`.

## Modules and Standard owners

A Module is either a code stack or a design system (kinds `code-stack` and `design-system`). Each has a name, unique in the Company regardless of case, and at most one current Standard owner. **Only the Buyer can create a Module or assign (and reassign) its Standard owner.** Any other role gets `403 role_denied` and nothing is written. The owner must be an account with the `Standard owner` role. Owner changes are append-only: each assignment is a new row recording who assigned it and when, and the latest one is the current owner.

The registry serves these endpoints. Each one needs `Authorization: Bearer <session token>` (otherwise `401 session_invalid`):

| Method and path | Body | Success | Refusals |
| --- | --- | --- | --- |
| `GET /v1/modules` | none | `200 { modules, standardOwners }` | `401 session_invalid` (any role may list) |
| `POST /v1/modules` | `{ "kind", "name" }` | `201` the Module, with `owner: null` | `403 role_denied`, `400 invalid_input` (`kind` or `name`), `409 module_name_taken` |
| `POST /v1/modules/{id}/owner` | `{ "accountId" }` | `200` the Module with its `owner` (assigning the current owner again changes nothing) | `403 role_denied`, `404 module_not_found`, `400 invalid_input` (`accountId`) |

Every Module endpoint can also answer `401 session_invalid`, `405 method_not_allowed`, `413 payload_too_large`, `415 unsupported_media_type`, and `400 invalid_input` with subject `body` or the name of an unexpected field. `404 module_not_found` also covers a malformed Module id and another Company's Module.

The management panel's Standards page lists the Modules and shows both forms to every role; the registry decides. The Modules database suite (`apps/registry/src/modules/modules.db.test.ts`) runs with the other suites under `REGISTRY_TEST_DATABASE_URL`.

## Standards: code stack and design system

A Standard is one entry in one Module at one Project scope: any Project of the Company's Project tree, chosen when version 1 is published (`projectId`; missing means the root Project). The Project scope is fixed for the Standard's life: every later version keeps it, and a Standard for another Project is a new Standard published there. Its id is minted by the registry and stays the same across versions. Every publish appends a new, immutable version (`1`, `2`, ...) recording who published it and when (UTC); earlier versions are never changed, and the highest version is the one in force. **Only the current Standard owner of a Module can publish into it.** Every role can read.

A code-stack entry has `category` (`language`, `framework` or `library`), `name` (1 to 200 characters, trimmed), an optional `versionConstraint` (at most 100), `status` (`approved`, `prohibited` or `required`) and an optional `correctionInstruction` (at most 1000). Its Conflict slot is (code stack, category, name), with names compared trimmed, NFC and regardless of case. Uniqueness is per (Conflict slot, Project scope): the same slot at a child Project is accepted, while two different live Standards in one slot at one Project scope are refused across Modules (`409 slot_conflict`, subject: the Standard already holding the slot; the message names both Standards and the Project). The check is the pure rule in `@domain-harness/core`, run over the whole proposed live set of every Project scope; publishes in one Company are serialised, so two concurrent publishes into one slot cannot both succeed.

A design-system Module takes three entry kinds, told apart by `kind` (code-stack entries carry `category` and never `kind`). Text is trimmed; an empty optional text is stored as `null`.

- Component: `{ "kind": "component", "name", "usageRule", "tokens", "correctionInstruction" }`. `name` is 1 to 200 characters, `usageRule` 1 to 1000, `tokens` a list of 0 to 50 token names (each 1 to 200, no two equal regardless of case), `correctionInstruction` optional (at most 1000). Token names are not checked against published token Standards.
- Token: `{ "kind": "token", "name", "status" }`, with `status` `required` or `prohibited`.
- Import: `{ "kind": "import", "specifier", "status" }`, where `specifier` is the module specifier (1 to 200) and `status` is `required` or `prohibited`.

The entry kind is the slot kind: a design-system Conflict slot is (design system, component | token | import, name), and an import's name is its specifier. Different slot kinds and Module kinds never compete, so a token `primary` and a code-stack library `primary` can both be live, while a second component `button` next to a live component `Button` is refused in any design-system Module. A new version may change the entry kind; the slot moves and is checked again. Design-system entries are checked in this order: `kind` (subject `kind`) → any key that kind does not allow (subject: that key) → the fields in form order (subject: the field). The entry must match the Module's kind: a code-stack entry in a design-system Module is refused on `kind` (it has none), and a design-system entry in a code-stack Module is refused on `kind` (an unexpected key).

| Endpoint | Body | Success | Refusals |
|---|---|---|---|
| `GET /v1/modules/{id}/standards` | none | `200 { module, standards }` (the live version of each Standard) | `404 module_not_found` |
| `POST /v1/modules/{id}/standards` | `{ "entry": { ... }, "projectId"? }` | `201` version 1 of a new Standard at that Project scope (the root when `projectId` is missing): `{ id, version, module, project, entry, publishedAt, publishedBy }` | see below |
| `GET /v1/standards/{id}/versions` | none | `200 { standardId, versions }`, oldest first | `404 standard_not_found` |
| `POST /v1/standards/{id}/versions` | exactly `{ "entry": { ... } }` | `201` the next version, same id and same Project scope (the entry may move to another slot; it is checked again at that scope). A `projectId` here is `400 invalid_input` with subject `projectId`: the scope is fixed | see below |

A publish is checked in this order; the first failure wins and nothing is written: `401 session_invalid` → `404 module_not_found` / `404 standard_not_found` (also for malformed or another Company's ids) → `409 module_has_no_owner` → `403 not_module_owner` (Buyer, Builder or the owner of another Module) → `400 invalid_input` with the field name as subject (or an unexpected key, or `kind` for an entry of the other Module kind; a `projectId` that is not a string is checked after the entry, subject `projectId`) → `404 project_not_found` with subject `projectId` (an unknown, malformed or another Company's Project) → `409 slot_conflict`. Transport refusals come before that order, because the body is read first: `415 unsupported_media_type`, `413 payload_too_large`, and `400 invalid_input` with subject `body` for malformed JSON. Request bodies may be up to 64 KiB, enough for the longest valid component.

In the panel, each Module name on the Standards page opens that Module's page (`/standards/{moduleId}`): its Standards table with each Standard's Project scope, the form for its kind (shown to every role) and, after a publish, the Standard id, Module, Project scope, version and UTC time. A new Standard's form starts with a "Project scope" picker listing every Project in tree order (the root selected); editing a Standard shows its fixed scope as text. If the Project tree cannot be read, the form says the Standard will be published at the root Project. The design-system form has one "Entry kind" choice that switches between the component, token and import field sets; a component's tokens are typed separated by commas. While the Standards list loads, the page shows its structure and the table header cells with a busy row. Migration `0004_standards.sql` adds the append-only `standards` and `standard_versions` tables under the same forced RLS, and `0005_design_system_entries.sql` widens their checks to the design-system entries (`category` holds the slot kind, `name` the slot name); `apps/registry/src/standards/standards.db.test.ts` covers them end to end over HTTP.

## Project tree

Each Company has exactly one root Project, created by `provision`; it is the only Project without a parent, and its parent can never be changed. The Buyer builds the tree under it, and an account holding the child-Project permission on a Project (see below) can also create that Project's direct children: every other Project has exactly one parent in the same Company, and a level name that says what that level means (for example "Product line"). The level name is stored exactly as typed (no trimming, no case change), 1 to 200 characters with at least one that is not whitespace; Domain Harness never interprets it. The root's level name is `null` for now. A Project name is trimmed and 1 to 200 characters. Project ids are minted by the registry.

| Endpoint | Body | Success | Who |
|---|---|---|---|
| `GET /v1/projects` | none | `200 { rootId, projects, lockedRules }`: every Project `{ id, name, levelName, parentId, createdAt }`, depth-first from the root, children by creation time, then id; `lockedRules` are the current Locked rules (see below) | every role |
| `GET /v1/projects/{id}` | none | `200` one Project | every role |
| `POST /v1/projects` | exactly `{ "name", "levelName", "parentId" }` | `201` the new Project | Buyer anywhere; any other account only under a parent on which it holds the child-Project permission |
| `POST /v1/projects/{id}/parent` | exactly `{ "parentId" }` | `200` the Project with its new parent | Buyer |

A parent change is checked in this order; the first failure wins and nothing is written: `401 session_invalid` → the transport refusals, because the body is read first (`415 unsupported_media_type`, `413 payload_too_large`, and `400 invalid_input` with subject `body` for malformed JSON), even for an unknown Project or a non-Buyer → `404 project_not_found` with subject `projectId` (the Project in the path, also for malformed or another Company's ids) → `403 role_denied` (any role but the Buyer) → `403 plan_refused` with subject `plan` (see Plans below) → `400 invalid_input` with the field (or an unexpected key) as subject → `404 project_not_found` with subject `parentId` (an unknown or another Company's parent) → `409 root_project_fixed` (the root's parent) → `409 project_cycle` (the parent is the Project itself or one of its descendants; the subject is that parent's id, the one that closes the cycle). A create is checked in this order: `401 session_invalid` → the transport refusals (`415 unsupported_media_type`, `413 payload_too_large`, and `400 invalid_input` with subject `body` for malformed JSON) → `403 plan_refused` with subject `plan` (see Plans below) → `400 invalid_input` with the field, an unexpected key, or `body` for a non-object body as subject → `404 project_not_found` with subject `parentId` → `403 child_permission_denied` with subject `parentId` (the caller is not the Buyer and holds no current grant on the parent; see Child-Project permission below) → core validation of the whole bundle (`409`). So a create answers transport errors first, then the plan, then the body fields, then the parent, then the permission: the plan comes before the body fields because the capability does not exist at all on that plan, and the permission comes after the parent because whether the caller may create depends on the parent it names. Reading an unknown or another Company's Project is `404 project_not_found`, and another Company's Projects never appear in the tree.

Before anything is written, the registry builds the whole proposed bundle input (every Project with its proposed parent, plus every live Standard) and validates it with the pure `validateBundleInput` in `@domain-harness/core`: exactly one root, every parent exists, no cycle, then the Conflict slot rule. Tree changes take the same per-Company lock as Standards publishes, so two concurrent re-parents that together would form a cycle cannot both succeed.

Parent changes are append-only. Migration `0006_project_tree.sql` adds `projects.level_name` and `projects.created_by` (both `NULL` for the provisioned root) and the `project_parent_changes` table (forced RLS, `SELECT` and `INSERT` only), which records every create and every parent change with who made it and when. A Project's current parent is the parent of its latest row; `projects.parent_id` keeps the parent at creation. `apps/registry/src/projects/projects.db.test.ts` covers the tree end to end over HTTP.

In the panel, "Project tree" (`/projects`) shows the tree as an accessible tree (Up, Down, Home and End move, Enter or Space selects; `?project={id}` selects a Project), a "Create a Project" form and, for any Project but the root, a "Change the parent of ..." form. The forms are shown to every role; the registry's refusals appear as a status. While the tree loads, the page shows its structure with a busy tree region.

### Effective Standard set

The Effective Standard set of a Project is the set of Standards that Project actually receives. It is resolved only by the pure `resolveEffectiveSet` in `@domain-harness/core`, from the Project tree, every live Standard and the Locked rules, walking from the Project up to the root:

- only Standards scoped to the Project or one of its ancestors count; a sibling's or a descendant's never do;
- Standards compete only in one Conflict slot: within a slot, the Standard scoped closest to the Project wins (a parent approves library "X" and the child prohibits "x": "x" is prohibited on the child, and still approved on the parent); a token and a library both stay;
- a Locked rule of an ancestor is never replaced: the locked Standard nearest the root wins its slot (see Locked rules below; the registry passes the current marks);
- two Standards in one slot at one Project scope on the path are an error (`slot_conflict`, naming both Standards), never a guess.

The answer is deterministic: it is ordered by Module kind, slot kind, normalised slot name, then Standard id, and the same inputs in any order give a byte-identical result for every caller. A property test over 300 seeded random trees (`packages/core/src/resolve.property.test.ts`) checks this against a brute-force oracle. The registry and the panel never re-sort, filter or cache the result.

| Endpoint | Body | Success | Who |
|---|---|---|---|
| `GET /v1/projects/{id}/effective-standards` | none | `200 { project, standards }`: each entry `{ slot, status, standard, sourceProject, locked }` in core's order; `status` is `null` for a component, `standard` is the live version | every role |

Refusals: `401 session_invalid` without a valid session → `404 project_not_found` with subject `projectId` for a malformed, unknown or another Company's id → core's error as is (`409 slot_conflict`). Every read runs in one tenant transaction under the Company's bundle lock (the one publishes and tree changes take), so the tree and the Standards are always read in one consistent state.

In the panel, selecting a Project on the Project tree shows its Effective Standard set under the tree (beside it from 1280px wide): a table with the header cells "Conflict slot", "Status", "Version" and "Source Project", the slot written as `(code stack, library, "X")`, "None" for a component's status, and "(this Project)" after the source when the Standard is scoped to the selected Project. The set loads on its own: the tree and forms show first while its section is busy, "No Standard applies to <name> yet." is the empty state, and if the set cannot be read the section says it is unavailable while the tree and forms stay.

### Locked rules

A Locked rule is a Standard the Buyer marks on the Project it is scoped to. In the Effective Standard set of that Project and of every descendant it is never replaced: within its Conflict slot, the locked Standard nearest the root wins, even over a Standard scoped closer to the Project (a parent's Locked rule prohibits library "X" and the child allows "x": "x" stays prohibited on the child, with the parent as source). Only the Buyer marks or removes a Locked rule; a Standard owner or a Builder is refused.

| Endpoint | Body | Success | Who |
|---|---|---|---|
| `POST /v1/standards/{id}/locked-rule` | exactly `{ "locked": true \| false }` | `200 { standard, locked, changedAt, changedBy }` (the live version and the current state; `changedAt` and `changedBy` are `null` when the Standard was never marked) | Buyer |

A mark is checked in this order; the first failure wins and nothing is written: `401 session_invalid` → the transport refusals, because the body is read first (`415 unsupported_media_type`, `413 payload_too_large`, and `400 invalid_input` with subject `body` for malformed JSON) → then, under the Company's bundle lock, `404 standard_not_found` (malformed, unknown or another Company's id) → `403 role_denied` → `400 invalid_input` with subject `locked` or the unexpected key → the same state as now answers `200` and writes nothing → for a mark only, `403 plan_refused` with subject `plan` (see Plans below) → for a mark, the whole proposed bundle input (the tree, every live Standard, the current Locked rules plus this one) is validated by `validateBundleInput` in core → `409 locked_rule_conflict`. Removing a Locked rule never conflicts.

Two Locked rules contradict each other when they hold the same Conflict slot and one is scoped to a strict ancestor of the other's Project: the descendant one could never take effect. Core's `validateLockedRules` refuses the pair with `locked_rule_conflict`, naming both Standards, both Projects and the slot; the subject is the other Standard when the pair involves the Standard being marked, otherwise the ancestor's Standard. Locked rules on unrelated branches (siblings) never conflict. Every other bundle validation passes the current Locked rules too: a re-parent that puts a Locked rule under a contradicting ancestor Locked rule, and a new version that moves a locked Standard into a contradicting slot, are both refused with `409 locked_rule_conflict` and write nothing.

Marks are append-only: migration `0007_locked_rules.sql` adds the `locked_rule_changes` table (forced RLS, `SELECT` and `INSERT` only), one row per mark or removal with who made it and when. A Standard's current state is its latest row; no row means not locked. `GET /v1/projects` lists the current Locked rules as `lockedRules`: `{ standardId, projectId, markedAt, markedBy }`, ordered by Project id, then Standard id. `apps/registry/src/locked-rules/locked-rules.db.test.ts` covers them end to end over HTTP.

In the panel, a Project with Locked rules shows "1 Locked rule" or "N Locked rules" after its level name on the tree (part of the node's accessible name). The Effective Standard set table has a fifth column, "Locked rule", reading "Locked rule" or "Not locked"; a row scoped to the selected Project also holds a "Mark as Locked rule" or "Remove Locked rule" button (followed by the slot for assistive technology). The button is shown to every role; the registry's refusals, including a contradiction naming both rules, appear as a status. Publishing a version that would contradict a Locked rule is refused on the Module's Standards page as well.

### Child-Project permission

The Buyer grants or revokes, per account and per Project, the permission to create child Projects directly under that Project. A grant on P covers direct children of P only: it is not inherited by P's descendants, so creating under a child of P needs its own grant. Re-parenting stays Buyer-only, and the Buyer never needs a grant. A grant stays with its Project when that Project is re-parented. A child created with the permission inherits every Locked rule of P and of P's ancestors through the same resolver; nothing about resolution changes.

| Endpoint | Body | Success | Who |
|---|---|---|---|
| `GET /v1/projects/{id}/child-permissions` | none | `200 { project, grants, eligibleAccounts }`: each current grant `{ account: { accountId, name, role }, grantedAt, grantedBy }` ordered by account name, then id; `eligibleAccounts` is every non-Buyer account of the Company, ordered by name, then id | every role |
| `POST /v1/projects/{id}/child-permissions` | exactly `{ "accountId", "granted" }` | `200 { project, account, granted, changedAt, changedBy }` (`changedAt`/`changedBy` are `null` when the pair never had a row) | Buyer |

The GET answers `401 session_invalid` without a session and `404 project_not_found` (subject `projectId`) for a malformed, unknown or another Company's Project. A grant or revoke is checked in this order; the first failure wins and nothing is written: `401 session_invalid` → the transport refusals, because the body is read first (`415 unsupported_media_type`, `413 payload_too_large`, and `400 invalid_input` with subject `body` for malformed JSON), even for an unknown Project or a non-Buyer → then, under the Company's bundle lock, `404 project_not_found` (subject `projectId`) → `403 role_denied` (any role but the Buyer) → `400 invalid_input` with subject `body` (a non-object body), `accountId`, `granted` or the unexpected key → `400 invalid_input` with subject `accountId` when the account is not one of this Company's accounts (including a malformed id) or is the Buyer → the same state as now answers `200` and writes nothing → the row is inserted. Because creates take the same lock, a revoke that commits first wins over a concurrent create.

Grants are append-only: migration `0008_child_permissions.sql` adds the `child_permission_changes` table (forced RLS, `SELECT` and `INSERT` only), one row per grant or revoke with who made it and when. A (Project, account) pair's current state is its latest row; no row means not granted. `apps/registry/src/child-permissions/child-permissions.db.test.ts` covers it end to end over HTTP.

In the panel, under the Effective Standard set, the section "Child-Project permission for <Project>" lists each current grant ("<account> (<role>), granted by <Buyer> on <YYYY-MM-DD>") with a "Revoke" button, and a "Grant permission" form whose Account select lists the eligible accounts not yet granted. It loads in its own busy section, and a failure leaves the tree, the table and the forms in place. The controls are shown to every role; the registry's refusals appear as a status. A create refused for a missing permission names the parent and says to ask the Buyer.

### Build grant

The Buyer grants or revokes, per account and per Project, the build grant: the right to place a new Application on that Project (see Applications below). It is a separate grant from the child-Project permission, stored in its own table, so holding one never implies the other. A build grant on P covers P only: it is never inherited by P's descendants, and it stays with P when P is re-parented. The Buyer never needs one.

| Endpoint | Body | Success | Who |
|---|---|---|---|
| `GET /v1/projects/{id}/build-grants` | none | `200 { project, grants, eligibleAccounts }`, the same shapes and order as the child-Project permission | every role |
| `POST /v1/projects/{id}/build-grants` | exactly `{ "accountId", "granted" }` | `200 { project, account, granted, changedAt, changedBy }` (`changedAt`/`changedBy` are `null` when the pair never had a row) | Buyer |

The checks, their order, the messages and the same-state no-op are those of the child-Project permission, with "build" wording: `401 session_invalid` → the transport refusals (`415`, `413`, `400 invalid_input` subject `body`) → under the bundle lock, `404 project_not_found` (subject `projectId`) → `403 role_denied` ("only the Buyer can grant or revoke the build grant; nothing was changed") → `400 invalid_input` with subject `body`, `accountId`, `granted` or the unexpected key → `400 invalid_input` with subject `accountId` for an account that is not this Company's (including a malformed id) or is the Buyer → the same state as now answers `200` and writes nothing → the row is inserted.

Grants are append-only: migration `0009_build_grants.sql` adds the `build_grant_changes` table (forced RLS, `SELECT` and `INSERT` only), one row per grant or revoke with who made it and when; a pair's current state is its latest row, and no row means not granted. `apps/registry/src/build-grants/build-grants.db.test.ts` covers it end to end over HTTP.

In the panel, under the child-Project permission, the section "Build grant for <Project>" lists each current grant ("<account> (<role>), granted by <Buyer> on <YYYY-MM-DD>") with a "Revoke" button, and a "Grant build" form whose Account select starts on "Choose an account". It loads in its own busy section, and a failure leaves the rest of the page in place. The controls are shown to every role; the registry's refusals appear as a status.

### Plans

Each Company has a plan (`tenants.plan`, set at provisioning). On the Community plan the Company keeps its one root Project, and the registry refuses three Project-tree writes with `403 plan_refused`, subject `plan`, writing nothing:

| Refused on Community | Message |
|---|---|
| `POST /v1/projects` (creating a Project, by anyone, a grant holder included) | "this Company's plan does not include creating another Project; nothing was changed" |
| `POST /v1/projects/{id}/parent` (setting a parent) | "this Company's plan does not include setting a parent; nothing was changed" |
| `POST /v1/standards/{id}/locked-rule` with `locked: true` (marking a Locked rule) | "this Company's plan does not include marking a Locked rule; nothing was changed" |

The messages name the capability, never a plan or a price, and no plan name appears in the error code or the registry's messages. Every other plan (Team, Business, Enterprise) is unaffected. Every read, removing a Locked rule (`locked: false`), and granting or revoking the child-Project permission stay allowed on Community, so a downgraded Company can still read its tree and reduce its Locked rules. The plan is read inside the request's tenant transaction, under the bundle lock, by `assertTreePlan` (`apps/registry/src/tenancy/plan.ts`). Where the check sits in each route's order is stated in that route's check order above: create and parent change under Project tree, a mark under Locked rules.

In the panel, a plan refusal leaves the top status empty and is shown in place, in a live status region that is always present (empty until a refusal) inside the form or section that was submitted: under the button of the Create a Project form, inside the Change parent form, or above the table of the Effective Standard set. It names "Team (first sale)" and never shows a price; no control is hidden. `apps/registry/src/tenancy/plan.db.test.ts` covers the refusals end to end over HTTP, including a Company downgraded from Team.

## Applications

An Application is bound to exactly one Project. The registry mints its id (a UUIDv7) and records whether the New-application flow created it (`fromFlow`) and who created it; the wire never carries who created it. Every Application change passes whole-bundle validation in `packages/core`: the bundle input carries every Application (id → Project), and a duplicated id (`invalid_input`, subject `applicationId`) or an Application on a Project outside the tree (`project_not_found`, subject `projectId`) is refused.

| Endpoint | Body | Success | Who |
|---|---|---|---|
| `GET /v1/applications` | none | `200 { applications }`: every Application of the Company `{ id, description, project: { id, name }, fromFlow, agentTool, createdAt }` (`agentTool` is the target of the latest successful Boilerplate generation, `null` when none), ordered by `createdAt`, then id | every role |
| `POST /v1/applications` | exactly `{ "description", "projectId" }` | `201` the Application, `fromFlow: true`, `agentTool: null`, the description stored trimmed | the Buyer on any Project; any other account on a Project it holds a build grant on |
| `POST /v1/applications/registered` | exactly `{ "description", "projectId" }` | `201 { fileName, content }`: the Project identification file of the minted Application, to commit to the repository root — no Boilerplate, no archive. The row is flagged `fromFlow: false` and forms the baseline set. | the Buyer only |

The GET answers `401 session_invalid` without a session. A placement is checked in this order; the first failure wins and nothing is written: `401 session_invalid` → the transport refusals (`415`, `413`, `400 invalid_input` subject `body` for malformed JSON) → under the bundle lock, `400 invalid_input` with subject `body` (not an object) or the unexpected key → `400 invalid_input` subject `description` (not a string, or empty or longer than 500 characters once trimmed) → `400 invalid_input` subject `projectId` ("choose a Project for the Application; nothing was created") when it is absent, not a string or empty → `404 project_not_found` subject `projectId` (malformed, unknown or another Company's) → `403 build_grant_denied` subject `projectId` ("you have no build grant on this Project; nothing was created") when the caller is not the Buyer and holds no current build grant on that Project (the child-Project permission does not count) → core validation of the whole bundle → the row is inserted. No plan or band check applies.

Registering an existing Application (`POST /v1/applications/registered`) lets the Buyer put an Application that already exists in the Company's repositories into the baseline set. The role is checked before the body is read (like the Guidance endpoint: the body is drained, never parsed, for any other role), then the same body → Project → core validation order as a placement runs (with no build-grant step, since only the Buyer registers), with the row flagged `fromFlow: false` and the caller recorded as its creator. The answer is only the identification file (`fileName` and its exact bytes), identical to `GET /v1/applications/{id}/identification-file`; no Boilerplate, archive, MCP configuration or agent tool is generated or recorded, and no migration is involved. On the panel, the "Register an existing Application" form on the New-application flow surface has the same Description and Project fields with a secondary button, shows the file in a raised section that tells the Buyer to commit it to the repository root (noting no Boilerplate is generated), and is shown to every role — a non-Buyer's submit is announced as a denial.

Applications are append-only: migration `0009_build_grants.sql` also adds the `applications` table (forced RLS, `SELECT` and `INSERT` only, a per-Company `sequence` as the Application-list version of the bundle input). `apps/registry/src/applications/applications.db.test.ts` covers it end to end over HTTP.

In the panel, the "New-application flow" surface (`/new-application`, last in the nav) has a Description textarea, a Project select starting on "Choose a Project", and the gold "Place the Application" button. A success says "The Application is placed on <Project>. The Buyer sees it on Inventory now."; a missing Project or a bad description puts ink text under that field and keeps what was typed; a missing build grant names the Project and says to ask the Buyer. Inventory lists every Application of the Company at once (Application, Project, Placement "New-application flow" or "Registered", Listed date), before any Gate run, and never shows a Builder name.

### Project identification file

Every Application has one Project identification file, which lets Guidance, the Gate and Collectors find it the same way. It is a hidden dotfile at the repository root, `.domain-harness.json` (`IDENTIFICATION_FILE_NAME` in `packages/contract`), holding a JSON object versioned by semver:

```json
{
  "version": "1.0.0",
  "applicationId": "01928c7e-5b2a-7c3d-ae4f-a1b2c3d4e5f7",
  "projectId": "01928c7e-5b2a-7c3d-ae4f-a1b2c3d4e5f8"
}
```

`applicationId` is the registry-minted Application id. `projectId` is advisory: consumers resolve the Project from the bundle by Application id, and a mismatch is reported, never used. `formatIdentificationFile(applicationId, projectId)` is the only serializer: keys in exactly that order, two-space indent and a trailing newline, so equal inputs give byte-identical files.

`parseIdentificationFile(content)` never throws and never fills a default. It answers `{ kind: "parsed", file }` (the three fields only; unknown extra keys are ignored, and any minor or patch of major 1 is read), `{ kind: "missing" }` for no file (`null`), or `{ kind: "unreadable", error }` with the envelope code `identification_file_unreadable`. First failure wins: not JSON or not a JSON object (subject `file`) → `version` not `MAJOR.MINOR.PATCH` (no leading zeros, no pre-release) or a major other than 1 (subject `version`) → `applicationId` not a UUIDv7 → `projectId` not a UUIDv7 (subject: that field). Messages carry field names and versions only, never the file's content.

| Endpoint | Body | Success | Who |
|---|---|---|---|
| `GET /v1/applications/{id}/identification-file` | none | `200 { fileName: ".domain-harness.json", content }`, `content` the serializer's output for the Application's id and its current Project | every role |

It answers `401 session_invalid` without a session, `405` for any method but GET, and `404 application_not_found` subject `applicationId` ("no such Application in this Company") for a malformed, unknown or other Company's id.

### Boilerplate

A Boilerplate is a starter repository for one Application and one agent tool — Claude Code or Cursor — already placed inside the Standards and wired to Company Guidance with no manual MCP setup.

**Company Guidance endpoint.** The Buyer sets one Guidance endpoint URL per Company on the New-application flow surface. Every change is one row of `guidance_endpoint_changes` (migration `0010`, append-only, RLS forced, SELECT and INSERT only); the current URL is the highest sequence. The URL is trimmed and must be 1 to 2048 characters, parse as a URL, use `https:`, and carry no whitespace, user name, password or fragment. Setting the current URL again writes nothing.

| Endpoint | Body | Success | Who |
|---|---|---|---|
| `GET /v1/guidance-endpoint` | none | `200 { url, changedAt }`, both `null` when unset | every role |
| `POST /v1/guidance-endpoint` | `{ url }` | `200 { url, changedAt }` | Buyer only (`403 role_denied` before the body is read) |
| `POST /v1/applications/{id}/boilerplate` | `{ target }`: `"claude-code"` or `"cursor"` | `200 { applicationId, target, archiveName, archiveBase64, artifacts }` | every role |

**Agent-tool recording.** A successful generation records its target as the Application's agent tool: one row of `application_agent_tool_changes` (migration `0011`, append-only, RLS forced, SELECT and INSERT only, `agent_tool` one of the two targets). An Application's current agent tool is its highest per-Application sequence; generating the current target again writes nothing, and a refusal writes nothing. `GET /v1/applications` answers it as `agentTool` — the target of the latest successful generation, `null` when none.

**Generation.** Under the tenant transaction and the bundle lock, first failure wins and nothing is returned partially: the Application exists (`404 application_not_found`) → the body is exactly `{ target }` with a known target (`400 invalid_input`, subject `target`) → the endpoint is set (`409 guidance_endpoint_unset`: ask the Buyer to set it) → the Effective Standard set of the Application's Project resolves through `core` → the ecosystem check → the conflict check → render and pack → the target is recorded as the Application's agent tool (nothing recorded when a refusal won above).

**Ecosystem rule.** The pilot supports TypeScript and npm only. A required `language` must be `typescript` (pinned as `devDependencies.typescript`) or `javascript` (no pin); a required `framework` or `library` must have a valid npm package name once lowercased and becomes `dependencies[name]`. The pin is the version constraint verbatim, or `"*"`. Any other required entry stops generation with `409 unsupported_ecosystem`, one sentence naming each as `<category> <name>`. Approved and prohibited entries are never pinned; the instructions list them. A pin named like a prohibited code-stack entry (case-insensitively), or one package pinned to two versions, is `409 boilerplate_conflict`.

**Files**, at the archive root, in this order — the three shared files, then the target's own:

| Artifact | Path | Content |
|---|---|---|
| Project identification file | `.domain-harness.json` | `formatIdentificationFile(applicationId, projectId)` |
| Dependency pins | `package.json` | `application-<id>`, private, ESM, the required pins (keys sorted) |
| Design-system references | `design-system.json` | required and prohibited imports and tokens, components with usage rules and tokens |

| Target | MCP configuration | Instructions | Skills |
|---|---|---|---|
| Claude Code | `.mcp.json`: the `domain-harness` server, `npx -y @domain-harness/mcp-bridge <endpoint URL>` | `CLAUDE.md` | `.claude/skills/domain-harness-guidance/SKILL.md` |
| Cursor | `.cursor/mcp.json`: the same bridge entry plus Cursor's `type: "stdio"` | `AGENTS.md` | `.cursor/skills/domain-harness-guidance/SKILL.md` |

`AGENTS.md` is the exact `CLAUDE.md` content with the one path reference `.mcp.json` → `.cursor/mcp.json`, and the Cursor skill is the exact Claude skill content with the same one path swap. The instruction file and the skill both tell the agent to make an initial commit before calling Guidance, because the bridge identifies the repository by its root commit. The first three files are target-independent, so every target ships them byte for byte the same; only the MCP configuration and the instruction and skill file locations and formats differ. The archive never holds hook configuration (no `settings.json`, no `hooks` key, no `hooks.json`).

**Archive format.** A ustar tar (regular files only, mode 0644, uid/gid 0, mtime 0, no owner names) in the order above, gzip-compressed, returned base64 in JSON as `domain-harness-<applicationId>-<target>.tar.gz`. Equal inputs give identical bytes. Logs carry the Application id, the target and the file count only. On the panel, after a placement, the Builder picks the agent tool (Claude Code or Cursor) and generates the Boilerplate; the result lists each artifact in text with a download link.

## Service (bundles)

The Company-operated service pulls the tenant's latest signed Standard bundle from the registry, verifies it strictly on the wire, and activates it by swapping the tenant's active-bundle pointer in its record store — all outbound only; the service listens on no port. Run the pull daemon:

```sh
node --conditions=@domain-harness/source apps/service/src/bundles/service-cli.ts
```

Configuration comes only from the environment:

| Variable | Meaning |
| --- | --- |
| `SERVICE_VENDOR_URL` | outbound base URL of the vendor registry (http or https) |
| `SERVICE_TENANT_ID` | this Company's tenant id (UUIDv7) |
| `SERVICE_TENANT_CREDENTIAL` | the tenant's registry service credential, sent as a Bearer token |
| `SERVICE_BUNDLE_TRUST_KEYS` | JSON object of keyId → Ed25519 PEM public key (rotation overlaps by key id) |
| `SERVICE_RECORD_DATABASE_URL` | connection string of the record store (shared with the CI Gate store) |
| `SERVICE_PULL_INTERVAL_MS` | optional; positive integer, default 60000 |

Every cycle does one outbound GET, verifies the received bundle (shape → unknown key id → signature → tenant → hash → sequence; every refusal is recorded append-only with its reason), activates a verified bundle, then observes staleness against the Buyer-set bound the bundle carries (a recorded freeze suspends the bound). Logs carry ids and codes only; any start-up error prints one `{ code, message, subject }` envelope to stderr and exits 1.

For local development, one container image ships the daemon beside its own PostgreSQL 18 record store:

```sh
export SERVICE_TENANT_CREDENTIAL=...   # from the registry's provision output
export SERVICE_BUNDLE_TRUST_KEYS='{"key-1": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"}'
docker compose -f apps/service/compose.yaml up -d --wait
```

The record store publishes `127.0.0.1:5433 → 5432` (distinct from the root compose's 5432); the service container publishes nothing. The store variables:

| Variable | Used by | Connects as |
| --- | --- | --- |
| `SERVICE_RECORD_DATABASE_URL` | the bundle daemon and the CI Gate | the runtime role that owns the plain service tables |
| `SERVICE_TEST_DATABASE_URL` | `pnpm test` (database suites in `apps/service`) | an admin role that may create and drop databases |

The service database suites (`apps/service/src/ci-gate/store.postgres.test.ts`, `apps/service/src/bundles/bundles.db.test.ts` and `apps/service/src/guidance/guidance.db.test.ts`) run when `SERVICE_TEST_DATABASE_URL` is set, each creating and dropping its own throwaway database.

## Guidance identity

The Company service identifies the Application on every Guidance call (Story 4.3). A Builder's agent runs the stdio bridge in its repository — every Boilerplate's MCP configuration already declares exactly this command:

```sh
npx -y @domain-harness/mcp-bridge <guidance endpoint URL>
```

The bridge forwards every MCP message to the endpoint over Streamable HTTP, recomputing its identity at call time (never at start-up, never cached): the identification file `.domain-harness.json` is read and parsed both halves, and the repository fingerprint is computed with a separate `git` subprocess per call. Each header is sent exactly when its value was computable — a missing value simply means an absent header, and the call is forwarded regardless; the service decides every identity outcome.

| Header | Sent when |
| --- | --- |
| `X-DH-Application-Id` | the identification file parsed |
| `X-DH-Advisory-Project-Id` | the identification file parsed (the file's advisory `projectId`; the service cannot read the Builder's file) |
| `X-DH-Repo-Fingerprint` | the repository fingerprint was computable |

The fingerprint algorithm is versioned in `@domain-harness/contract` (`REPOSITORY_FINGERPRINT_ALGORITHM_VERSION`, currently `1`): the lowercase SHA-256 hex digest of the root commit SHA of `git rev-list --max-parents=0 HEAD`. The header names are versioned there too (`GUIDANCE_IDENTITY_HEADERS`). A repository with no commit cannot be identified — the Boilerplate instructions tell the agent to commit before calling Guidance.

The bridge validates its endpoint URL at start-up: a missing or invalid URL prints one `{ code, message, subject }` envelope to stderr and exits 1. At run time, a forwarding or transport failure is told only to the requests the client is waiting on — each answers with one JSON-RPC error — while notifications are fire-and-forget (a failed forward drops them silently) and the bridge keeps running; stdout carries only the MCP stream and stderr carries no subject text at all.

On the service, `resolveGuidanceIdentity` makes the one decision every serving surface shares (AD-19), against the active bundle payload, in this fixed order:

| # | Input | Outcome |
| --- | --- | --- |
| 1 | no fingerprint | `unbound`, "make an initial commit and call Guidance again" |
| 2 | no application id | `unbound`, "missing or unreadable identification file" |
| 3 | id not in the bundle's `payload.applications` | `unbound`, "unbound Application"; the binding and nothing else is touched |
| 4 | first-seen id | bound trust-on-first-use (first presented fingerprint wins) → `bound`, Project id resolved from the bundle |
| 5 | bound id, different fingerprint | `refused`, "duplicate Application id"; one refusal row |
| 6 | bound id, same fingerprint | `bound` |
| 7 | store or bundle read fails | `unbound`, "run did not complete" (reason `unavailable`); nothing is bound or recorded |

An advisory Project id that disagrees with the bundle's Project id for that Application is reported in the `bound` result and recorded in the append-only `guidance_project_mismatches` table (migration `0003_guidance_identity.sql`) — it is never used: the bundle's Project id is what is returned. Advisory mismatches are evaluated and recorded only on `bound` outcomes: a `refused` or `unbound` call drops its advisory mismatch. Every outcome is a typed result (`bound`/`unbound`/`refused` in `@domain-harness/contract`) whose sentences are the fixed UX-DR29 strings from `@domain-harness/gate`; only the commit-once sentence is new (inline in the service unit).

Bindings and binding refusals reuse the Gate's shared record-store tables (`application_bindings`, `binding_refusals`): Guidance and the Gate use ONE check, one id→fingerprint row per Application — either unit's store sees the other surface's rows. Every refused call records one `binding_refusals` row — one row per refused call, so a repeat offender's refusals ledger grows by one each time.

## Telemetry

Turborepo collects anonymous usage telemetry unless it is turned off. CI sets `TURBO_TELEMETRY_DISABLED=1`. Turn it off locally once per machine:

```sh
pnpm exec turbo telemetry disable
```

or export `TURBO_TELEMETRY_DISABLED=1` (or `DO_NOT_TRACK=1`) in your shell. No remote cache is configured.

## Secrets

Secrets come from the environment or a secret manager, never from this repository. `.env` files are ignored by git.
