# The management panel image (staging): builds the React Router app, then
# serves it with the slim production server (apps/panel/server.js). Build
# context is the repository root so the pinned workspace resolves.
FROM node:26-bookworm-slim AS builder

# Node 26 no longer bundles corepack; install the pinned version (like CI) and
# enable the pnpm version pinned in package.json.
RUN npm install --global corepack@0.36.0 \
    && corepack enable pnpm

WORKDIR /app

# Workspace manifests first so the dependency-install layer caches. The panel
# resolves only @domain-harness/contract among the workspace units, plus the
# shared tsconfig base its builds extend.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/panel/package.json apps/panel/package.json
COPY packages/contract/package.json packages/contract/package.json
COPY tooling/tsconfig/package.json tooling/tsconfig/package.json

RUN pnpm install --frozen-lockfile

# Sources for the panel build and the workspace unit it resolves.
COPY tsconfig.json ./
COPY tooling/tsconfig ./tooling/tsconfig
COPY packages ./packages
COPY apps/panel ./apps/panel

WORKDIR /app/apps/panel

# The SSR bundle resolves @domain-harness/contract to its built dist, so the
# workspace dependency builds before the panel itself.
RUN pnpm --filter @domain-harness/contract build \
    && pnpm --filter @domain-harness/panel build

FROM node:26-bookworm-slim AS runtime

# Node 26 no longer bundles corepack; install the pinned version (like CI) and
# enable the pnpm version pinned in package.json.
RUN npm install --global corepack@0.36.0 \
    && corepack enable pnpm

WORKDIR /app

# Production dependencies only: devDependencies (vite, react-router dev,
# vitest) stay in the builder. Workspace links resolve exactly as installed.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/panel/package.json apps/panel/package.json
COPY packages/contract/package.json packages/contract/package.json

RUN pnpm install --frozen-lockfile --prod

# The built app plus the production server (PORT/HOST come from the fly.toml
# [env]: 0.0.0.0:3000).
COPY --from=builder /app/apps/panel/dist ./apps/panel/dist
COPY --from=builder /app/apps/panel/server.js ./apps/panel/server.js

WORKDIR /app/apps/panel

EXPOSE 3000

CMD ["node", "server.js"]
