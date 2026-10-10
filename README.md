# Domain Harness

TypeScript monorepo for Domain Harness. The layout and dependency rules come from the architecture spine (`_bmad-output/planning-artifacts/architecture/`); scaffold choices are recorded in [`docs/decisions/starter-template.md`](docs/decisions/starter-template.md).

```text
packages/
  contract/    # bundle format, Compilation schemas, tool results, error envelope, UUIDv7 id type
  core/        # pure resolver (imports only contract)
  extractor/   # revision facts from file contents (imports only contract)
  collector/   # record -> Compilation projection, durable queue
apps/
  registry/    # vendor registry, bundle builder, Boilerplate (imports core + contract)
  panel/       # vendor management panel (imports contract only)
  service/     # Company Standards service
  cli/         # offline CLI Gate
tooling/
  tsconfig/        # shared strict TypeScript base
  eslint-config/   # shared typescript-eslint flat config
  boundaries/      # dependency-boundary check and its tests
```

## Requirements

- Node.js 24 or later (26 LTS is the target).
- pnpm 12, pinned in `package.json` (`packageManager`) and provided by corepack:

  ```sh
  corepack enable pnpm
  ```

  Node 25 and later no longer bundle corepack. Install it first with `npm install --global corepack@0.36.0`.

## Commands

```sh
pnpm install          # install the workspace
pnpm run build        # tsc -b in every package (TypeScript 7)
pnpm run typecheck    # typecheck sources and tests
pnpm run lint         # ESLint with typescript-eslint
pnpm run boundaries   # dependency-boundary check (.dependency-cruiser.cjs)
pnpm test             # Vitest in every package
```

CI (`.github/workflows/ci.yml`) runs the same steps on every push, on Node 24 and 26.

## Telemetry

Turborepo collects anonymous usage telemetry unless it is turned off. CI sets `TURBO_TELEMETRY_DISABLED=1`. Turn it off locally once per machine:

```sh
pnpm exec turbo telemetry disable
```

or export `TURBO_TELEMETRY_DISABLED=1` (or `DO_NOT_TRACK=1`) in your shell. No remote cache is configured.

## Secrets

Secrets come from the environment or a secret manager, never from this repository. `.env` files are ignored by git.
