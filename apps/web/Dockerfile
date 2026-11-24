# =============================================================================
# Web Dockerfile - Multi-stage build
# =============================================================================
# BUILD CONTEXT IS THE REPOSITORY ROOT (infra/compose/base.compose.yml:
# `context: ../..`, `dockerfile: apps/web/Dockerfile`), so the root
# package-lock.json is reachable. The generated nginx.conf proxies to
# `web:5173` in every mode, so the production image listens on 5173 too
# (apps/web/nginx.conf).

# -----------------------------------------------------------------------------
# Base stage
# -----------------------------------------------------------------------------
FROM node:24-alpine AS base
WORKDIR /app

# -----------------------------------------------------------------------------
# Dependencies stage
# -----------------------------------------------------------------------------
FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
# Every workspace manifest is required: `npm ci` validates the whole workspace set against
# the lockfile, even when installing one workspace (apps/cli is the shellkeep CLI).
COPY apps/cli/package.json ./apps/cli/
COPY packages ./packages/
RUN npm ci --workspace=web --include-workspace-root

# -----------------------------------------------------------------------------
# Development stage
# -----------------------------------------------------------------------------
FROM base AS development
COPY --from=deps /app ./
COPY tsconfig.base.json ./
COPY apps/web ./apps/web
WORKDIR /app/apps/web
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host"]

# -----------------------------------------------------------------------------
# Build stage
# -----------------------------------------------------------------------------
FROM base AS build
COPY --from=deps /app ./
COPY tsconfig.base.json ./
COPY apps/web ./apps/web
WORKDIR /app/apps/web
RUN npm run build

# -----------------------------------------------------------------------------
# Production stage (nginx to serve static files)
# -----------------------------------------------------------------------------
FROM nginx:1.30-alpine AS production
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 5173
CMD ["nginx", "-g", "daemon off;"]
