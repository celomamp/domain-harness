# Shared local-only defaults for `pnpm local:*` (sourced by tooling/local/*.sh).
#
# Every value is a LOCAL-ONLY DEVELOPMENT CREDENTIAL for a database, port, or
# key bound to the developer machine; nothing here is a secret and nothing
# here is used outside local development. Values mirror `.env.local.example`.
# Assignment uses `=` (not `:=`) on purpose: an unset variable takes the
# local default so a clean clone boots, while an explicitly empty variable
# stays empty so the app's own fail-closed envelope still fires.
# shellcheck shell=sh

: "${REGISTRY_MIGRATION_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres}"
: "${REGISTRY_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres?options=-c%20role%3Ddh_registry_app}"
: "${REGISTRY_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres}"
: "${REGISTRY_HTTP_HOST=127.0.0.1}"
: "${REGISTRY_HTTP_PORT=4100}"
: "${REGISTRY_PANEL_URL=http://localhost:5173}"
: "${REGISTRY_MAIL_OUTBOX_DIR=./.outbox}"
# No default for REGISTRY_BUNDLE_SIGNING_KEY on purpose: a private key must
# never be committed (a registry tripwire fails `pnpm test` when any private
# key exists in the repository tree). `local-serve-registry.sh` generates a
# dev key outside the repository on first use when the variable is unset, and
# passes an explicitly empty value through so the registry's own
# missing_configuration envelope still fires.
: "${REGISTRY_BUNDLE_SIGNING_KEY_ID=local-dev-key-1}"
: "${PANEL_REGISTRY_URL=http://127.0.0.1:4100}"
: "${SERVICE_VENDOR_URL=http://127.0.0.1:4100}"
: "${SERVICE_TENANT_ID=018f3d2a-7000-7000-8000-000000000100}"
# No defaults for SERVICE_BUNDLE_TRUST_KEYS / SERVICE_ROLE_TOKEN_TRUST_KEYS:
# run `pnpm local:keys` and paste its trust-set JSON (see .env.local.example).
# Compose fails with one sentence when the bundle trust keys are unset, so
# the daemon never starts on a placeholder.
: "${SERVICE_RECORD_DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres}"
: "${SERVICE_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres}"
: "${SERVICE_READ_CREDENTIAL=local-only-read-secret}"
: "${SERVICE_GUIDANCE_PORT=8080}"
# (SERVICE_ROLE_TOKEN_TRUST_KEYS intentionally unset: see above.)

export REGISTRY_MIGRATION_DATABASE_URL REGISTRY_DATABASE_URL REGISTRY_TEST_DATABASE_URL
export REGISTRY_HTTP_HOST REGISTRY_HTTP_PORT REGISTRY_PANEL_URL REGISTRY_MAIL_OUTBOX_DIR
export REGISTRY_BUNDLE_SIGNING_KEY REGISTRY_BUNDLE_SIGNING_KEY_ID
export PANEL_REGISTRY_URL
export SERVICE_VENDOR_URL SERVICE_TENANT_ID SERVICE_BUNDLE_TRUST_KEYS
export SERVICE_RECORD_DATABASE_URL SERVICE_TEST_DATABASE_URL
export SERVICE_READ_CREDENTIAL SERVICE_GUIDANCE_PORT SERVICE_ROLE_TOKEN_TRUST_KEYS
