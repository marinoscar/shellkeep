#!/usr/bin/env node
/**
 * SSH secret re-encryption launcher (issue #48)
 *
 * Runs `src/server-profiles/migrate/ssh-secrets-migrate.ts`, which copies the SSH
 * secrets of every server profile from the legacy columns into the platform
 * credential store. Loads the same .env files as scripts/prisma-env.js, so the
 * database comes from POSTGRES_* and the keys from the environment.
 *
 *   npm run ssh:migrate-secrets                dry run (default)
 *   npm run ssh:migrate-secrets -- --apply     copy
 *   npm run ssh:migrate-secrets -- --verify    compare
 *
 * In a built image (dist/ present) it runs the compiled file; in a checkout it runs the
 * TypeScript source through ts-node (transpile only, like the other scripts).
 * Runbook: docs/runbooks/ssh-secret-reencryption.md
 */

const { existsSync } = require('fs');
const { join } = require('path');

if (process.env.NODE_ENV !== 'production') {
  try {
    require('dotenv').config();
  } catch (err) {
    // dotenv might not be available in production builds, that's OK
  }
}

const compiled = join(__dirname, '..', 'dist', 'server-profiles', 'migrate', 'ssh-secrets-migrate.js');

let entry;
if (existsSync(compiled)) {
  entry = require(compiled);
} else {
  process.env.TS_NODE_PROJECT = join(__dirname, 'tsconfig.json');
  process.env.TS_NODE_TRANSPILE_ONLY = 'true';
  require('ts-node/register');
  entry = require(join(__dirname, '..', 'src', 'server-profiles', 'migrate', 'ssh-secrets-migrate.ts'));
}

entry.main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error) => {
    // The class and code only: a message can carry a connection string or a value.
    console.error(entry.describeFailure(error));
    process.exit(2);
  },
);
