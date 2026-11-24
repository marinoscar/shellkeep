#!/usr/bin/env node
/**
 * Storage environment import launcher (issue #50)
 *
 * Runs `src/platform/storage/import-env-storage-config.ts`, which copies the previous
 * build's STORAGE_PROVIDER / S3_* / AWS_* variables once into the runtime storage
 * configuration (settings plus the encrypted credential store). Loads the same .env
 * files as scripts/prisma-env.js.
 *
 *   npm run storage:import-env                 write
 *   npm run storage:import-env -- --dry-run    print what would be written
 *   npm run storage:import-env -- --user <email>
 *
 * In a built image (dist/ present) it runs the compiled file; in a checkout it runs the
 * TypeScript source through ts-node (transpile only). Runbook: docs/runbooks/storage-configuration.md
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

const compiled = join(__dirname, '..', 'dist', 'platform', 'storage', 'import-env-storage-config.js');

let entry;
if (existsSync(compiled)) {
  entry = require(compiled);
} else {
  process.env.TS_NODE_PROJECT = join(__dirname, 'tsconfig.json');
  process.env.TS_NODE_TRANSPILE_ONLY = 'true';
  require('ts-node/register');
  entry = require(join(__dirname, '..', 'src', 'platform', 'storage', 'import-env-storage-config.ts'));
}

entry.main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error) => {
    console.error(entry.describeFailure(error));
    process.exit(2);
  },
);
