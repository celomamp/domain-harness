# Staging on Fly.io (homologation)

Staging proves the system outside a developer laptop: the four processes run
continuously on Fly.io in region `iad` (next to Supabase us-east-1), wired to
the Supabase **staging** project (`wjwhmjlassmesbxpwdhi`), with sign-in mail
caught by a Mailtrap sandbox. No app code changes are involved — only the
Dockerfiles, the four `fly.*-staging.toml` files at the repository root, and
this runbook.

Decisions (frozen for this round): Fly org `personal`; Mailtrap sandbox
`sandbox.smtp.mailtrap.io` (STARTTLS, user `551331ce042330`) — the sandbox
catches mail, nothing is ever really delivered; default `*.fly.dev` public
URLs; internal traffic over Fly private networking (`*.internal`); no custom
domains, no autoscaling setup, no production data.

| App | Fly app | Image (Dockerfile) | Port | Public? | What it is |
|-----|---------|--------------------|------|---------|------------|
| registry | `dh-registry-staging` | `apps/registry/Dockerfile` | 4100 | yes (443) | vendor registry JSON API; builders + sign-in links |
| panel | `dh-panel-staging` | `apps/panel/Dockerfile` | 3000 | yes (443) | management panel; the staging front door |
| service | `dh-service-staging` | `apps/service/Dockerfile` | none | no | bundle-pull daemon; outbound only |
| guidance | `dh-guidance-staging` | `apps/service/Dockerfile.guidance` | 8080 | no (see below) | Guidance MCP + credentialed Read API |

The guidance app declares `[[services.ports]]` only because the platform
schema requires a ports entry wherever checks run. It is **never allocated a
public IP** (`fly ips list --app dh-guidance-staging` must stay empty), so it
is reachable only at `http://dh-guidance-staging.internal:8080`. The service
daemon declares no services at all (it listens on no port and has no checks,
per spec).

Every app sets `auto_stop_machines = false, min_machines_running = 1` (the
daemon has no services block to carry them — keep exactly one Machine running
via `fly scale count 1`). Healthchecks are TCP only; no `/healthz` exists.

## One-time staging setup

### 1. Supabase staging databases

In the staging project dashboard / SQL editor (run as the project owner):

1. **Registry database.** Apply the existing migrations once (they create the
   `dh_registry_app` / `dh_sign_in_lookup` / `dh_alert_scheduler` roles
   themselves — no migration edits, no new SQL files in this spec):
   - From your laptop with the **owner** connection string
     (`REGISTRY_MIGRATION_DATABASE_URL`, direct port 5432):
     `pnpm --filter @domain-harness/registry migrate`. If direct 5432 is
     unreachable from your network, the same command works through the
     pooler host (`:6543`, `sslmode=no-verify`).
   - Or rely on the registry app's `release_command` (see "Deploy"), which
     runs the same migrator before every release. Do one of the two before
     the first boot, not zero.
2. **Registry runtime credential.** The runtime refuses superuser/owner roles
   (`unsafe_database_role`), so create one least-privilege login role and use
   it for `REGISTRY_DATABASE_URL`:
   `CREATE ROLE dh_registry_staging LOGIN PASSWORD '<generated>';`
   `GRANT dh_registry_app TO dh_registry_staging;`
   RLS policies are role-agnostic (tenant check only) and the table grants go
   to `dh_registry_app`, so membership is sufficient.
3. **`record_store` second database.** The only new database this spec allows:
   run `CREATE DATABASE record_store;` once in the dashboard SQL editor as
   owner (the pooler cannot create databases). Point both service apps' pools
   at it (`SERVICE_RECORD_DATABASE_URL`); both entries auto-migrate it on
   boot, so no manual migrate step exists for it.
4. Connection shapes: direct port 5432 with `sslmode=verify-full`
   (`postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/<db>`) is primary
   on Fly (full IPv6); the pooler host (`:6543`, `sslmode=no-verify` — its
   cert chain does not verify) is the fallback proven from restricted
   networks. Never use the pooler for `CREATE DATABASE`.
5. Concurrent boot is safe: the daemon and the guidance server share the
   service migrate runner, whose advisory transaction lock serializes the
   auto-migrate; the second entry waits, then sees `alreadyApplied`.
6. If a `release_command` migration fails, the release is blocked and the
   previous Machines keep serving. Read the migrator envelope in
   `fly logs`, fix forward (migrations are append-only and re-runnable —
   there is no down-migration path by design), and redeploy.

### 2. Fresh staging signing key (never committed)

Same pattern as `pnpm local:keys`, but a staging key kept outside the repo
(e.g. `~/.domain-harness/staging-signing-key.pem`, mode 0600):

- Generate an Ed25519 PKCS#8 PEM (the `local-keys.sh` node one-liner works;
  any equivalent does).
- Trust-set JSON for the service apps: derive the SPKI public PEM from the
  private key and wrap it as `{"staging-key-1": "<public PEM>"}` — this exact
  JSON becomes `SERVICE_BUNDLE_TRUST_KEYS` and
  `SERVICE_ROLE_TOKEN_TRUST_KEYS`.
- The key id (`staging-key-1`) matches `REGISTRY_BUNDLE_SIGNING_KEY_ID` in
  `fly.registry-staging.toml`; if you pick another id, change the toml too.
- `fly secrets set` accepts the real multiline PEM (the registry also tolerates
  `\n`-escaped pastes).

### 3. Provision the staging company

From your laptop (a **runtime-role** URL in the shell only, never committed —
provision refuses owner/superuser roles via `assertRuntimeRoleSafe`):

1. `REGISTRY_DATABASE_URL=<runtime-URL> pnpm --filter @domain-harness/registry provision <company.json>` (the `dh_registry_staging` URL from §1; use the pooler `:6543` host when direct `:5432` is unreachable from your network — both work for provision)
2. Save the printed `tenantId` and `serviceCredential` into your secret
   manager — they source `SERVICE_TENANT_ID`, `SERVICE_TENANT_CREDENTIAL`
   (daemon + guidance) and identify the staging tenant.

### 4. Staging secrets inventory (names + source, no values)

| App | Secret | Source |
|-----|--------|--------|
| registry | `REGISTRY_DATABASE_URL` | Supabase dashboard (staging project, `dh_registry_staging` login role) |
| registry | `REGISTRY_MIGRATION_DATABASE_URL` | Supabase dashboard (staging project, owner role; release_command only) |
| registry | `REGISTRY_SMTP_URL` | Mailtrap sandbox inbox (`smtp://551331ce042330:<password>@sandbox.smtp.mailtrap.io:587`) |
| registry | `REGISTRY_BUNDLE_SIGNING_KEY` | Generated staging key (§2) |
| service | `SERVICE_TENANT_ID` | Registry provision output (§3) |
| service | `SERVICE_TENANT_CREDENTIAL` | Registry provision output (§3) |
| service | `SERVICE_BUNDLE_TRUST_KEYS` | Generated trust-set JSON (§2) |
| service | `SERVICE_RECORD_DATABASE_URL` | Supabase dashboard (`record_store` second DB) |
| guidance | `SERVICE_TENANT_ID` | Registry provision output (§3) |
| guidance | `SERVICE_TENANT_CREDENTIAL` | Registry provision output (§3) |
| guidance | `SERVICE_RECORD_DATABASE_URL` | Supabase dashboard (`record_store` second DB, same value) |
| guidance | `SERVICE_READ_CREDENTIAL` | Generated opaque secret (any unguessable string) |
| guidance | `SERVICE_ROLE_TOKEN_TRUST_KEYS` | Generated trust-set JSON (§2, same value) |
| panel | — | none (the panel holds no credentials) |

Set them per app, e.g.
`fly secrets set --app dh-registry-staging REGISTRY_DATABASE_URL=…`.
`fly.toml [env]` carries only non-secret values; `.env`-style files stay
local and gitignored.

## Boot order

Cold boot (and the order to bring back after a full stop):

1. Databases migrated — registry via `release_command` on deploy (or the
   laptop migrate in §1); record store auto-migrates on daemon/guidance boot.
2. Company provisioned (§3).
3. Registry → panel → service daemon → guidance server.
4. A missing secret fails fast with the app's one-sentence envelope
   (`missing_configuration … is not set` on stderr, exit 1) — check
   `fly logs --app <app>`; the Machine stays on the previous healthy release
   when a healthcheck blocks a new one.

## Deploy

Remote builders — no local Docker needed:

```sh
fly deploy -c fly.registry-staging.toml --remote-only
fly deploy -c fly.panel-staging.toml --remote-only
fly deploy -c fly.service-staging.toml --remote-only
fly deploy -c fly.guidance-staging.toml --remote-only
```

First launch per app (org `personal`), then deploy:

```sh
fly apps create dh-registry-staging --org personal   # once per app
fly deploy -c fly.registry-staging.toml --remote-only
```

Keep the daemon pinned to one always-on Machine (no services block to carry
the placement): `fly scale count 1 --app dh-service-staging`.

Health: `fly status --app <app>` shows the TCP checks; the panel serves the
sign-in page at `https://dh-panel-staging.fly.dev`.

## Sign-in expectation

With SMTP set, sign-in mails land in the **Mailtrap sandbox inbox** — open the
message there and follow the link (it points at the staging panel URL via
`REGISTRY_PANEL_URL`). Without SMTP configured, links are never delivered:
that is the documented gap, not a silent failure. The panel itself holds no
mail state.

## Demo accounts (no email needed)

Demo sign-in is a feature toggle for testing: one account per role signs in
as soon as its address is typed on the sign-in page, with no emailed link.
It needs both switches, and both are set only in the staging tomls:

| Where | Variable | Meaning |
| --- | --- | --- |
| registry (`[env]`) | `REGISTRY_DEMO_SIGN_IN=1` | provisions the Company "Demo Pilot" (plan Team) at start unless its accounts exist, and serves `POST /v1/demo-sessions`; any other value or unset: the endpoint answers 404 and nothing is provisioned |
| registry (secret, optional) | `REGISTRY_DEMO_ACCOUNTS` | the three addresses, exactly one per role: `Buyer=ana@acme.com;Standard owner=rui@acme.com;Builder=lia@acme.com`; a malformed list refuses the start with `invalid_configuration` |
| panel (`[env]`) | `PANEL_DEMO_SIGN_IN=1` | the sign-in action tries a demo session first; a non-demo address gets the emailed link as usual. The page says demo accounts enter directly but never lists them |

Without `REGISTRY_DEMO_ACCOUNTS` the defaults apply
(`apps/registry/src/sign-in/demo.ts`):

| Role | Email |
| --- | --- |
| Buyer | `buyer@demo.domainharness.test` |
| Standard owner | `owner@demo.domainharness.test` |
| Builder | `builder@demo.domainharness.test` |

To use your own addresses: `fly secrets set --app dh-registry-staging
REGISTRY_DEMO_ACCOUNTS='Buyer=...;Standard owner=...;Builder=...'` (this
restarts the registry, which provisions a new "Demo Pilot" for them). To turn
the feature off, remove both toggle lines and redeploy. Anyone who knows a
demo address can enter that account, so keep real data out of "Demo Pilot",
and never set either toggle where real Companies sign in. The registry logs
`{"event":"demo_company","state":"provisioned"|"present"|"partial"}` at start
("partial" means only some demo addresses exist; nothing is written).

## Daemon expectation

`fly logs --app dh-service-staging` shows one `bundle_cycle` line per pull
(`SERVICE_PULL_INTERVAL_MS`, default 60s): pull → verify → activate, with
`bundle: activated|pinned` and `staleness: recorded|…`. An unreachable vendor
URL is logged per cycle (`bundle: pull:…`) and the daemon keeps cycling —
it never crashes on a failed pull.

## Rollback

```sh
fly releases --app <app>                       # find the last healthy image
fly deploy -c <fly.<app>-staging.toml> --image <ref> --remote-only
```

A failed healthcheck already blocks the bad release (previous Machines stay);
the command above restores the previous image explicitly.

## Known staging issues (follow-ups, not blockers)

- **Private DNS**: `*.internal` hostnames did not resolve from freshly deployed
  Machines (`ENOTFOUND`), so inter-service URLs currently use the public
  `https://dh-registry-staging.fly.dev` (set via `fly secrets`, overriding the
  `[env]` defaults). The tomls keep `.internal` as the design target; see the
  deferred-work entry before switching back.
- **Worker placement**: the daemon app carries no `[[services]]`, so its
  Machine was scaled to zero by default — `fly scale count 1` pins exactly one
  running Machine (done). If it ever stops again, `fly machine start` it and
  check the org's billing/activity for platform stops.

## Verification

```sh
fly config validate -c fly.registry-staging.toml
fly config validate -c fly.panel-staging.toml
fly config validate -c fly.service-staging.toml
fly config validate -c fly.guidance-staging.toml
pnpm run build && pnpm run typecheck && pnpm run lint && pnpm run boundaries
```

Live deploy, sign-in, and a daemon pull → verify → activate cycle are
expected only after the ORG/SMTP/REGION answers are applied — executed by a
human or a follow-up run.
