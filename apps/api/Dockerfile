# =============================================================================
# API Dockerfile - Multi-stage build
# =============================================================================

# -----------------------------------------------------------------------------
# Base stage
# -----------------------------------------------------------------------------
FROM node:24-alpine AS base
WORKDIR /app
# Install OpenSSL for Prisma compatibility.
#
# `postgresql17-client` is pg_dump, pg_restore and psql, for the platform database backup
# and restore (#52). It is in the BASE stage so `development` and `production` both ship
# it: a backup that only works in one of them is exercised first on the night it is needed.
#
# THE MAJOR IS PINNED EXPLICITLY. The floating `postgresql-client` meta-package tracks
# whatever major the Alpine release under `node:24-alpine` ships, so a base-image refresh
# could move the client without a line of this repository changing, and `pg_dump` REFUSES
# to dump a server newer than itself. 17 is the platform's floor (MIN_PG_CLIENT_MAJOR in
# `@marinoscar/platform-api/db-backup`); a 17 client dumps and restores a 14 to 17 server,
# and CI and the rehearsals run PostgreSQL 16. `test/pg-client-version.spec.ts` holds this
# number equal to the constant. To bump the pair: docs/runbooks/postgres-client-version.md.
RUN apk add --no-cache openssl openssl-dev postgresql17-client
RUN corepack enable

# -----------------------------------------------------------------------------
# Dependencies stage
# -----------------------------------------------------------------------------
FROM base AS deps
COPY package*.json ./
COPY prisma ./prisma/
COPY prisma.config.ts ./
COPY scripts ./scripts/
# Using npm install since this is a workspace package without its own lock file
# Set dummy DATABASE_URL for Prisma generate (actual connection not needed at build time)
RUN npm install --ignore-scripts && \
    DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" npm run prisma:generate

# -----------------------------------------------------------------------------
# Development stage
# -----------------------------------------------------------------------------
FROM base AS development
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["npm", "run", "start:dev"]

# -----------------------------------------------------------------------------
# Build stage
# -----------------------------------------------------------------------------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# -----------------------------------------------------------------------------
# Production stage
# -----------------------------------------------------------------------------
FROM base AS production
COPY --from=build /app/dist ./dist
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY prisma ./prisma/
COPY prisma.config.ts ./
COPY scripts ./scripts/
EXPOSE 3000
CMD ["npm", "run", "start:prod"]
