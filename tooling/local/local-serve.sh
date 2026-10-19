#!/bin/sh
# `pnpm local:serve`: registry API on 127.0.0.1:4100 plus the panel on
# :5173 in one terminal (registry in the background, panel dev in the
# foreground). For separate logs use the split pair instead:
# `pnpm local:serve:registry` (terminal 1) and `pnpm local:serve:panel`
# (terminal 2). A registry that fails to listen (for example a missing
# mail choice) stops everything with its own one-sentence error.
set -eu
here=$(dirname "$0")
# shellcheck source=defaults.sh
. "$here/defaults.sh"

host="${REGISTRY_HTTP_HOST=127.0.0.1}"
port="${REGISTRY_HTTP_PORT=4100}"

sh "$here/local-serve-registry.sh" &
registry=$!
cleanup() { kill "$registry" 2>/dev/null || true; }
trap cleanup INT TERM EXIT

ready=""
i=0
while [ "$i" -lt 30 ]; do
  if ! kill -0 "$registry" 2>/dev/null; then
    echo "local:serve: the registry failed to start; fix the error above and retry." >&2
    exit 1
  fi
  if node -e "fetch('http://$host:$port/v1/projects').then(()=>process.exit(0)).catch(()=>process.exit(1))" 2>/dev/null; then
    ready="1"
    break
  fi
  i=$((i + 1))
  sleep 1
done

if [ -z "$ready" ]; then
  echo "local:serve: the registry did not listen on $host:$port within 30s." >&2
  exit 1
fi

sh "$here/local-serve-panel.sh"
