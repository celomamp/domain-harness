# @domain-harness/cli

Offline CLI Gate (Community). Checks a local revision against a signed
Standard bundle with no network: verifies the bundle file, then runs the
same extractor and core as the CI Gate in process.

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

## Local smoke

From the repository root (no network, no database):

```sh
pnpm local:cli:smoke
```

It checks `--version`, `--help`, and that `bundle verify` and `gate` refuse unreadable inputs with their one-line failures.
