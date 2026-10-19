#!/bin/sh
# `pnpm local:up [company.json]`: bring up registry postgres, apply
# migrations, and optionally provision one Company from the given file.
# Fails with one sentence (exit 1) when Docker is down.
set -eu
here=$(dirname "$0")
# shellcheck source=defaults.sh
. "$here/defaults.sh"

if [ "$#" -gt 1 ]; then
  echo "local:up: usage: pnpm local:up [company.json]." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "local:up: Docker is not running; start Docker Desktop (or dockerd) and retry." >&2
  exit 1
fi

docker compose up -d --wait postgres

REGISTRY_MIGRATION_DATABASE_URL="$REGISTRY_MIGRATION_DATABASE_URL" \
  pnpm --filter @domain-harness/registry migrate

if [ -n "${1:-}" ]; then
  REGISTRY_DATABASE_URL="$REGISTRY_DATABASE_URL" \
    pnpm --filter @domain-harness/registry provision "$1"
  printf '%s\n' \
    "local:up: postgres is up (127.0.0.1:5432), migrations applied, Company provisioned." \
    "next: copy the provision output's serviceCredential into SERVICE_TENANT_CREDENTIAL for the service stack (see README)," \
    "then run pnpm local:serve (registry on :4100 and panel on :5173 in one terminal)."
else
  printf '%s\n' \
    "local:up: postgres is up (127.0.0.1:5432) and migrations are applied." \
    "next: pnpm local:up ./company.json to provision, or pnpm local:provision ./company.json later;" \
    "then pnpm local:serve (registry on :4100 and panel on :5173 in one terminal)."
fi
