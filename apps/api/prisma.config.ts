import { createRequire } from 'node:module';

import { defineConfig } from '@prisma/config';

// Why derive the URL here: the platform CLI's migration probe (`deploy status`,
// install/update verify) runs a bare `npx prisma migrate status` in the api
// container, skipping the npm wrapper, so DATABASE_URL is unset and the schema
// state would be reported as unknown. An already-set DATABASE_URL still wins.
// `createRequire` because prisma-env.js is CommonJS and this file may load as
// either module kind.
const { constructDatabaseUrl } = createRequire(import.meta.url)('./scripts/prisma-env.js') as {
  constructDatabaseUrl: (env?: NodeJS.ProcessEnv) => string;
};

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
    url: constructDatabaseUrl(),
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
  migrations: {
    path: 'prisma/migrations',
    seed: 'ts-node --project prisma/tsconfig.json --transpile-only prisma/seed.ts',
  },
});
