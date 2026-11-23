import { defineConfig } from '@prisma/config';

/**
 * Prisma configuration for v7+.
 *
 * DATABASE_URL is constructed by scripts/prisma-env.js from the individual
 * POSTGRES_* environment variables and injected before the Prisma CLI runs.
 * At runtime the client connects through the PrismaPg driver adapter
 * (src/prisma/prisma.service.ts), which builds the same URL.
 *
 * The schema is a FOLDER of generated files: `npm run db:compose` writes
 * prisma/schema/ from the platform fragments in @marinoscar/platform-db and
 * this app's own prisma/fragments/. Never edit a file there. Two lines matter:
 *   - `schema` must name the folder.
 *   - `migrations.path` must be explicit: with a schema folder the default
 *     moves to `<schema folder>/migrations`, and `migrate` would report
 *     "No migration found" on a database whose history is intact.
 *
 * Paths resolve relative to this file.
 */
export default defineConfig({
  schema: 'prisma/schema',
  datasource: {
    url: process.env.DATABASE_URL as string,
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
  migrations: {
    path: 'prisma/migrations',
    seed: 'ts-node --project prisma/tsconfig.json --transpile-only prisma/seed.ts',
  },
});
