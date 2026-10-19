#!/bin/sh
# `pnpm local:serve:registry`: serve the registry API on :4100 with local
# defaults (runtime role, panel URL for :5173, file outbox). The dev signing
# key is generated once outside the repository tree (never committed) when
# REGISTRY_BUNDLE_SIGNING_KEY is unset; set the variable yourself to use your
# own key. An explicitly empty value is passed through so the registry's own
# missing_configuration envelope still refuses before listen (as does setting
# both SMTP and the outbox).
set -eu
here=$(dirname "$0")
# shellcheck source=defaults.sh
. "$here/defaults.sh"

if [ -z "${REGISTRY_BUNDLE_SIGNING_KEY:-}" ] && [ -z "${REGISTRY_BUNDLE_SIGNING_KEY+x}" ]; then
  key_dir="$HOME/.domain-harness"
  key_file="$key_dir/registry-signing-key.pem"
  if [ ! -f "$key_file" ]; then
    mkdir -p "$key_dir"
    chmod 0700 "$key_dir"
    node -e "const { generateKeyPairSync } = require('node:crypto'); const { privateKey } = generateKeyPairSync('ed25519'); require('node:fs').writeFileSync(process.argv[1], privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });" "$key_file"
    printf '%s\n' "local:serve:registry: generated a local-only dev signing key at $key_file (never commit it). Run pnpm local:keys for the matching trust-set JSON." >&2
  fi
  REGISTRY_BUNDLE_SIGNING_KEY="$(cat "$key_file")"
fi

# A pasted key may carry literal `\n` escapes (see .env.local.example); a
# generated key or real multiline value has no backslashes, so unescaping
# here is identity for those inputs.
REGISTRY_BUNDLE_SIGNING_KEY="$(printf '%b' "$REGISTRY_BUNDLE_SIGNING_KEY")"

export REGISTRY_DATABASE_URL="$REGISTRY_DATABASE_URL"
export REGISTRY_HTTP_HOST="$REGISTRY_HTTP_HOST"
export REGISTRY_HTTP_PORT="$REGISTRY_HTTP_PORT"
export REGISTRY_PANEL_URL="$REGISTRY_PANEL_URL"
export REGISTRY_MAIL_OUTBOX_DIR="${REGISTRY_MAIL_OUTBOX_DIR:-}"
export REGISTRY_BUNDLE_SIGNING_KEY="${REGISTRY_BUNDLE_SIGNING_KEY:-}"
export REGISTRY_BUNDLE_SIGNING_KEY_ID="$REGISTRY_BUNDLE_SIGNING_KEY_ID"
if [ -n "${REGISTRY_SMTP_URL:-}" ]; then
  export REGISTRY_SMTP_URL="$REGISTRY_SMTP_URL"
  export REGISTRY_MAIL_FROM="${REGISTRY_MAIL_FROM:-Domain Harness <no-reply@localhost>}"
fi

exec pnpm --filter @domain-harness/registry serve
