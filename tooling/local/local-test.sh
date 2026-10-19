#!/bin/sh
# `pnpm local:test`: boot postgres and always run the DB suites by exporting
# both test URLs. Plain `pnpm test` keeps its skip behavior; this command is
# the one that runs everything green. A failing suite keeps its exit code.
set -eu
here=$(dirname "$0")
# shellcheck source=defaults.sh
. "$here/defaults.sh"

if ! docker info >/dev/null 2>&1; then
  echo "local:test: Docker is not running; start Docker Desktop (or dockerd) and retry." >&2
  exit 1
fi

docker compose up -d --wait postgres

export REGISTRY_TEST_DATABASE_URL="$REGISTRY_TEST_DATABASE_URL"
export SERVICE_TEST_DATABASE_URL="$SERVICE_TEST_DATABASE_URL"
exec pnpm test
