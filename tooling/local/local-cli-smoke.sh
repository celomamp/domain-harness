#!/bin/sh
# `pnpm local:cli:smoke`: offline CLI smoke (no network, no database).
# `--version` and `--help` answer exit 0; `bundle verify` with unreadable
# inputs refuses with its one-line failure (exit 1), proving the binary runs.
set -eu

bin="apps/cli/dist/cli.js"
if [ ! -f "$bin" ]; then
  pnpm --filter @domain-harness/cli build
fi

node "$bin" --version
node "$bin" --help >/dev/null

if node "$bin" bundle verify --bundle ./does-not-exist.json --trust-keys ./does-not-exist.json --tenant 018f3d2a-7000-7000-8000-000000000100; then
  echo "local:cli:smoke: expected bundle verify to refuse unreadable inputs." >&2
  exit 1
fi

if node "$bin" gate --bundle ./does-not-exist.json --trust-keys ./does-not-exist.json --tenant 018f3d2a-7000-7000-8000-000000000100 >/dev/null 2>&1; then
  echo "local:cli:smoke: expected gate to refuse unreadable inputs." >&2
  exit 1
fi

echo "local:cli:smoke: ok (version, help, verify refusal, gate refusal)."
