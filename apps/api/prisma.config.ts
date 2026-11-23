import { defineConfig } from '@prisma/config';

/**
 * Prisma configuration for v7+.
 *
 * DATABASE_URL is constructed by scripts/prisma-env.js from the individual
 * POSTGRES_* environment variables and injected before the Prisma CLI runs.
 * At runtime the client connects through the PrismaPg driver adapter
 * (src/prisma/prisma.service.ts), which builds the same URL.
 *
 * Paths resolve relative to this file.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL as string,
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
  migrations: {
    path: 'prisma/migrations',
    seed: 'ts-node --project prisma/tsconfig.json --transpile-only prisma/seed.ts',
  },
});
