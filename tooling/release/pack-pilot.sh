#!/bin/sh
# Pack the pilot's two installables as self-contained npm tarballs, for a
# GitHub Release while they are not on npm:
#   mcp-bridge.tgz  the stdio MCP bridge (npx -y <url> <endpoint>)
#   cli.tgz         the offline Gate CLI (npm install -g <url>)
# Each bundles its workspace packages and npm dependencies into one ESM file,
# so the tarball has no dependencies. Usage: sh tooling/release/pack-pilot.sh <out-dir>
set -eu

OUT="${1:?usage: pack-pilot.sh <out-dir>}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ESBUILD="esbuild@0.25.10"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# bundle <entry> <out-file>: one ESM file for Node 24, built-ins external, a
# require shim for CommonJS dependencies.
bundle() {
  npx --yes "$ESBUILD" "$1" --bundle --platform=node --format=esm --target=node24 \
    --conditions=@domain-harness/source --outfile="$2" --log-level=warning \
    --banner:js="import { createRequire as __dhCreateRequire } from 'node:module'; const require = __dhCreateRequire(import.meta.url);"
  # A bin needs the node shebang; esbuild keeps one only when the entry has it.
  if [ "$(head -c 2 "$2")" != "#!" ]; then
    { printf '#!/usr/bin/env node\n'; cat "$2"; } > "$2.tmp" && mv "$2.tmp" "$2"
  fi
}

# pack <dir> <name> <bin-name> <bin-file> <description> <tarball>
pack() {
  cat > "$1/package.json" <<EOF
{
  "name": "$2",
  "version": "$(node -p "require('$ROOT/package.json').version ?? '0.0.0'")-pilot",
  "description": "$5",
  "type": "module",
  "license": "UNLICENSED",
  "engines": { "node": ">=24" },
  "bin": { "$3": "./$4" },
  "files": ["$4"]
}
EOF
  chmod +x "$1/$4"
  (cd "$1" && npm pack --silent --pack-destination "$WORK" >/dev/null)
  mv "$WORK"/*.tgz "$OUT/$6"
}

mkdir -p "$WORK/bridge" "$WORK/cli"
bundle "$ROOT/packages/mcp-bridge/src/bridge.ts" "$WORK/bridge/bridge.js"
pack "$WORK/bridge" "@domain-harness/mcp-bridge" "mcp-bridge" "bridge.js" \
  "Domain Harness stdio MCP bridge (pilot build)." "mcp-bridge.tgz"

bundle "$ROOT/apps/cli/src/cli.ts" "$WORK/cli/cli.js"
pack "$WORK/cli" "@domain-harness/cli" "domain-harness" "cli.js" \
  "Domain Harness offline Gate CLI (pilot build)." "cli.tgz"

ls -l "$OUT"
