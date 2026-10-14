# The Company Standards service image (Story 4.2): runs the bundle-pull
# daemon. Build context is the repository root (see apps/service/compose.yaml)
# so the pinned workspace resolves.
FROM node:26-bookworm-slim

# Node 26 no longer bundles corepack; install the pinned version (like CI) and
# enable the pnpm version pinned in package.json.
RUN npm install --global corepack@0.36.0 \
    && corepack enable pnpm

WORKDIR /app

# Workspace manifests first so the dependency-install layer caches.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/service/package.json apps/service/package.json
COPY packages/contract/package.json packages/contract/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/extractor/package.json packages/extractor/package.json

RUN pnpm install --frozen-lockfile

# Source: the workspace units the service imports at runtime, then the service.
COPY tsconfig.json ./
COPY packages ./packages
COPY apps/service ./apps/service

WORKDIR /app/apps/service

# The daemon reads its configuration from the environment, reaches the vendor
# registry only over outbound calls, and listens on no port (NFR-12): the
# container therefore publishes no ports.
CMD ["node", "--conditions=@domain-harness/source", "src/bundles/service-cli.ts"]
