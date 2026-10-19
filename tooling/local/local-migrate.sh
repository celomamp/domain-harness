#!/bin/sh
# `pnpm local:migrate`: apply registry migrations with the local default URL.
# Fails with the migrator's own envelope when the database is unreachable.
set -eu
here=$(dirname "$0")
# shellcheck source=defaults.sh
. "$here/defaults.sh"

REGISTRY_MIGRATION_DATABASE_URL="$REGISTRY_MIGRATION_DATABASE_URL" \
  pnpm --filter @domain-harness/registry migrate
