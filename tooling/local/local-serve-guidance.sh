#!/bin/sh
# `pnpm local:guidance`: serve the Company guidance + Read API server locally
# (inbound 127.0.0.1:SERVICE_GUIDANCE_PORT, default 8080) with local defaults.
# Needs a migrated record store, a provisioned tenant, and real credential +
# trust keys (see README, "Local development"); the daemon refuses with one
# envelope otherwise. No placeholder is ever defaulted: unset stays unset so
# the refusal names the variable, and an explicit value is passed through.
set -eu
here=$(dirname "$0")
# shellcheck source=defaults.sh
. "$here/defaults.sh"

export SERVICE_TENANT_ID="$SERVICE_TENANT_ID"
export SERVICE_RECORD_DATABASE_URL="$SERVICE_RECORD_DATABASE_URL"
export SERVICE_READ_CREDENTIAL="${SERVICE_READ_CREDENTIAL:-}"
export SERVICE_VENDOR_URL="$SERVICE_VENDOR_URL"
export SERVICE_TENANT_CREDENTIAL="${SERVICE_TENANT_CREDENTIAL:-}"
export SERVICE_BUNDLE_TRUST_KEYS="${SERVICE_BUNDLE_TRUST_KEYS:-}"
export SERVICE_ROLE_TOKEN_TRUST_KEYS="${SERVICE_ROLE_TOKEN_TRUST_KEYS:-}"
export SERVICE_GUIDANCE_PORT="$SERVICE_GUIDANCE_PORT"
exec node --conditions=@domain-harness/source "$here/../../apps/service/src/guidance/server-cli.ts"
