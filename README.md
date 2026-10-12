# Domain Harness

TypeScript monorepo for Domain Harness. The layout and dependency rules come from the architecture spine (`_bmad-output/planning-artifacts/architecture/`); scaffold choices are recorded in [`docs/decisions/starter-template.md`](docs/decisions/starter-template.md).

```text
packages/
  contract/    # bundle format, Compilation schemas, tool results, error envelope, UUIDv7 id type
  core/        # pure resolver (imports only contract)
  extractor/   # revision facts from file contents (imports only contract)
  collector/   # record -> Compilation projection, durable queue
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

Each Company has exactly one root Project, created by `provision`; it is the only Project without a parent, and its parent can never be changed. The Buyer builds the tree under it: every other Project has exactly one parent in the same Company, and a level name that says what that level means (for example "Product line"). The level name is stored exactly as typed (no trimming, no case change), 1 to 200 characters with at least one that is not whitespace; Domain Harness never interprets it. The root's level name is `null` for now. A Project name is trimmed and 1 to 200 characters. Project ids are minted by the registry.

| Endpoint | Body | Success | Who |
|---|---|---|---|
| `GET /v1/projects` | none | `200 { rootId, projects }`: every Project `{ id, name, levelName, parentId, createdAt }`, depth-first from the root, children by creation time, then id | every role |
| `GET /v1/projects/{id}` | none | `200` one Project | every role |
| `POST /v1/projects` | exactly `{ "name", "levelName", "parentId" }` | `201` the new Project | Buyer |
| `POST /v1/projects/{id}/parent` | exactly `{ "parentId" }` | `200` the Project with its new parent | Buyer |

A tree change is checked in this order; the first failure wins and nothing is written: `401 session_invalid` → `404 project_not_found` with subject `projectId` (the Project in the path, also for malformed or another Company's ids) → `403 role_denied` (any role but the Buyer) → `400 invalid_input` with the field (or an unexpected key) as subject → `404 project_not_found` with subject `parentId` (an unknown or another Company's parent) → `409 root_project_fixed` (the root's parent) → `409 project_cycle` (the parent is the Project itself or one of its descendants; the subject is that parent's id, the one that closes the cycle). Transport refusals come before that order on a parent change, because the body is read first: `415 unsupported_media_type`, `413 payload_too_large`, and `400 invalid_input` with subject `body` for malformed JSON, even for an unknown Project or a non-Buyer. A create has no Project in the path, so its role check comes first and the body is not read for any other role. Reading an unknown or another Company's Project is `404 project_not_found`, and another Company's Projects never appear in the tree.

Before anything is written, the registry builds the whole proposed bundle input (every Project with its proposed parent, plus every live Standard) and validates it with the pure `validateBundleInput` in `@domain-harness/core`: exactly one root, every parent exists, no cycle, then the Conflict slot rule. Tree changes take the same per-Company lock as Standards publishes, so two concurrent re-parents that together would form a cycle cannot both succeed.

Parent changes are append-only. Migration `0006_project_tree.sql` adds `projects.level_name` and `projects.created_by` (both `NULL` for the provisioned root) and the `project_parent_changes` table (forced RLS, `SELECT` and `INSERT` only), which records every create and every parent change with who made it and when. A Project's current parent is the parent of its latest row; `projects.parent_id` keeps the parent at creation. `apps/registry/src/projects/projects.db.test.ts` covers the tree end to end over HTTP.

In the panel, "Project tree" (`/projects`) shows the tree as an accessible tree (Up, Down, Home and End move, Enter or Space selects; `?project={id}` selects a Project), a "Create a Project" form and, for any Project but the root, a "Change the parent of ..." form. The forms are shown to every role; the registry's refusals appear as a status. While the tree loads, the page shows its structure with a busy tree region.

## Telemetry

Turborepo collects anonymous usage telemetry unless it is turned off. CI sets `TURBO_TELEMETRY_DISABLED=1`. Turn it off locally once per machine:

```sh
pnpm exec turbo telemetry disable
```

or export `TURBO_TELEMETRY_DISABLED=1` (or `DO_NOT_TRACK=1`) in your shell. No remote cache is configured.

## Secrets

Secrets come from the environment or a secret manager, never from this repository. `.env` files are ignored by git.
