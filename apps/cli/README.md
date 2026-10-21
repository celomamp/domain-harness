# @domain-harness/cli

CLI Gate (Community). Checks a local revision against a signed Standard
bundle with no network: verifies the bundle file, then runs the same
extractor and core as the CI Gate in process. In the hosted pilot it can
instead send the revision's facts to the Guidance server, which evaluates
and records the run so it reaches the panel.

Requires Node.js >= 24.

## Install

```sh
npm install -g @domain-harness/cli
```

## Versions

```sh
domain-harness --version
# domain-harness 0.0.0 (extractor 1.0.0, fact-schema 1.0.0, contract 1)
```

`contract` is the bundle wire-format major this CLI supports. A bundle with
any other major version is refused with `bundle verification failed`.

## Usage

```sh
domain-harness --help
domain-harness bundle verify --bundle ./bundle.json --trust-keys ./trust.json --tenant <uuidv7>
domain-harness gate --bundle ./bundle.json --trust-keys ./trust.json --tenant <uuidv7>
```

Both commands run fully offline and never modify the working tree. State
(last-seen bundle pointer, Application binding) defaults under the user
cache directory and can be overridden with `--state` / `--binding`.

## Hosted Gate (pilot)

```sh
export DH_GUIDANCE_TOKEN=<the pilot access token>
domain-harness gate --endpoint https://dh-guidance-staging.fly.dev/mcp [--root <dir>]
```

Same output and exit code as the offline Gate: the sentence (`pass`, `fail`
or a refusal), then one line per open Deviation; exit 0 only on `pass`. The
run is recorded by the Guidance server and appears on the Application page
in the panel, where a Deviation can be accepted; the next run then reports
it accepted. The server's active bundle and clock are authoritative, so
`--bundle`, `--trust-keys`, `--tenant`, `--binding`, `--state` and `--now`
are not accepted in this mode.

What is sent: the HEAD commit SHA, the Application id and advisory Project
id from the identification file, the repository fingerprint, and the
revision's facts — dependency names and versions, import specifiers and
design-token names. File contents and file paths are never sent; a file that
cannot be read refuses locally with `run did not complete`. The token is read
only from `DH_GUIDANCE_TOKEN` and never printed. The endpoint must be HTTPS
(plain HTTP only to localhost). When the server cannot be reached or refuses
the token, stdout says `run did not complete` and stderr says why.

As a CI step (GitHub Actions):

```yaml
- run: npm install -g https://github.com/celomamp/domain-harness/releases/download/pilot-0.3/cli.tgz
- run: domain-harness gate --endpoint https://dh-guidance-staging.fly.dev/mcp
  env:
    DH_GUIDANCE_TOKEN: ${{ secrets.DH_GUIDANCE_TOKEN }}
```

## Local smoke

From the repository root (no network, no database):

```sh
pnpm local:cli:smoke
```

It checks `--version`, `--help`, and that `bundle verify` and `gate` refuse unreadable inputs with their one-line failures.
