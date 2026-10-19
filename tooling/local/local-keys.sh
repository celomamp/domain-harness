#!/bin/sh
# `pnpm local:keys`: generate (once) the local-only dev bundle-signing key
# outside the repository tree and print the trust-set JSON for
# SERVICE_BUNDLE_TRUST_KEYS and SERVICE_ROLE_TOKEN_TRUST_KEYS. The key lives
# at `$HOME/.domain-harness/registry-signing-key.pem` (mode 0600; never
# committed — a registry tripwire fails `pnpm test` when any private key
# exists inside the repository). Re-running reuses the existing key and only
# reprints the public material. The private key is never printed.
set -eu
here=$(dirname "$0")
# shellcheck source=defaults.sh
. "$here/defaults.sh"

key_dir="$HOME/.domain-harness"
key_file="$key_dir/registry-signing-key.pem"
key_id="${REGISTRY_BUNDLE_SIGNING_KEY_ID:-local-dev-key-1}"

if [ ! -f "$key_file" ]; then
  mkdir -p "$key_dir"
  chmod 0700 "$key_dir"
  node -e "const { generateKeyPairSync } = require('node:crypto'); const { privateKey } = generateKeyPairSync('ed25519'); require('node:fs').writeFileSync(process.argv[1], privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });" "$key_file"
  printf '%s\n' "local:keys: generated a local-only dev signing key at $key_file (never commit it)." >&2
fi

trust_json="$(node -e "const { createPrivateKey, createPublicKey } = require('node:crypto'); const fs = require('node:fs'); const pem = fs.readFileSync(process.argv[1], 'utf8').replace(/\\\\n/g, '\n'); const pub = createPublicKey(createPrivateKey(pem)).export({ type: 'spki', format: 'pem' }); process.stdout.write(JSON.stringify({ [process.argv[2]]: pub }));" "$key_file" "$key_id")"

printf '%s\n' "key id: $key_id"
printf '%s\n' "paste one of these into your shell (or .env.local) for the service stack:"
printf '%s\n' "SERVICE_BUNDLE_TRUST_KEYS='$trust_json'"
printf '%s\n' "SERVICE_ROLE_TOKEN_TRUST_KEYS='$trust_json'"
