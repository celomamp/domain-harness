#!/bin/sh
# `pnpm local:serve:panel`: serve the management panel with `panel dev` on
# :5173 (the local standard; REGISTRY_PANEL_URL matches).
set -eu
here=$(dirname "$0")
# shellcheck source=defaults.sh
. "$here/defaults.sh"

export PANEL_REGISTRY_URL="$PANEL_REGISTRY_URL"
exec pnpm --filter @domain-harness/panel dev
