# The vendor registry API image: runs `registry serve` (the registry's
# internal JSON API). Build context is the repository root so the pinned
# workspace resolves. Same source-mode runtime as the service daemon
# (apps/service/Dockerfile): no compiled dist, the entry runs straight from
# TypeScript with Node's type stripping and the @domain-harness/source
# condition. Configuration comes only from the environment (see
# apps/registry/src/http/serve-cli.ts); HOST/PORT defaults are overridden by
# the fly.toml [env] (0.0.0.0:4100).
FROM node:26-bookworm-slim

# Node 26 no longer bundles corepack; install the pinned version (like CI) and
# enable the pnpm version pinned in package.json.
RUN npm install --global corepack@0.36.0 \
    && corepack enable pnpm

WORKDIR /app

# Workspace manifests first so the dependency-install layer caches.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/registry/package.json apps/registry/package.json
COPY packages/contract/package.json packages/contract/package.json
COPY packages/core/package.json packages/core/package.json

RUN pnpm install --frozen-lockfile

# Source: the workspace units the registry imports at runtime, then the registry.
COPY tsconfig.json ./
COPY packages ./packages
COPY apps/registry ./apps/registry

WORKDIR /app/apps/registry

# The registry API listens on REGISTRY_HTTP_PORT (default 4100).
EXPOSE 4100

CMD ["node", "--conditions=@domain-harness/source", "src/http/serve-cli.ts"]
