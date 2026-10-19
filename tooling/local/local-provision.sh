#!/bin/sh
# `pnpm local:provision <company.json>`: provision one Company with the local
# runtime default (a member of dh_registry_app). Prints ids only.
set -eu
here=$(dirname "$0")
# shellcheck source=defaults.sh
. "$here/defaults.sh"

if [ "$#" -ne 1 ]; then
  echo "local:provision: usage: pnpm local:provision <company.json>." >&2
  exit 1
fi

REGISTRY_DATABASE_URL="$REGISTRY_DATABASE_URL" \
  pnpm --filter @domain-harness/registry provision "$1"
