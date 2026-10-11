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

## Telemetry

Turborepo collects anonymous usage telemetry unless it is turned off. CI sets `TURBO_TELEMETRY_DISABLED=1`. Turn it off locally once per machine:

```sh
pnpm exec turbo telemetry disable
```

or export `TURBO_TELEMETRY_DISABLED=1` (or `DO_NOT_TRACK=1`) in your shell. No remote cache is configured.

## Secrets

Secrets come from the environment or a secret manager, never from this repository. `.env` files are ignored by git.
