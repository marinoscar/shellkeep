#!/usr/bin/env node
/**
 * Prisma Environment Helper
 *
 * Constructs DATABASE_URL from individual PostgreSQL environment variables
 * and executes Prisma CLI commands with the proper environment.
 *
 * This is needed because Prisma CLI requires DATABASE_URL to be set,
 * but we use individual variables (POSTGRES_HOST, POSTGRES_PORT, etc.)
 * for flexibility in different environments.
 *
 * Usage:
 *   node scripts/prisma-env.js [prisma command and args]
 *
 * Examples:
 *   node scripts/prisma-env.js migrate deploy
 *   node scripts/prisma-env.js generate
 *   node scripts/prisma-env.js studio
 */

const { spawn } = require('child_process');

// Load .env files if running outside Docker
if (process.env.NODE_ENV !== 'production') {
  try {
    require('dotenv').config();
  } catch (err) {
    // dotenv might not be available in production builds, that's OK
  }
}

/**
 * Builds the PostgreSQL connection URL from the individual POSTGRES_*
 * variables, ignoring any DATABASE_URL already set.
 */
function buildDatabaseUrl(env = process.env) {
  const host = env.POSTGRES_HOST || 'localhost';
  const port = env.POSTGRES_PORT || '5432';
  const user = env.POSTGRES_USER || 'postgres';
  const password = env.POSTGRES_PASSWORD || 'postgres';
  const dbName = env.POSTGRES_DB || 'appdb';
  const ssl = env.POSTGRES_SSL === 'true';

  // Construct URL-safe password (encode special characters)
  const encodedPassword = encodeURIComponent(password);

  // Build SSL parameter
  const sslParam = ssl ? '?sslmode=require' : '';

  return `postgresql://${encodeURIComponent(user)}:${encodedPassword}@${host}:${port}/${dbName}${sslParam}`;
}

/**
 * The URL prisma.config.ts uses: an already-set DATABASE_URL wins, otherwise
 * it is built from POSTGRES_*. This lets a bare `npx prisma ...` (which skips
 * this wrapper, e.g. the platform CLI's migration probe) still find the database.
 */
function constructDatabaseUrl(env = process.env) {
  return env.DATABASE_URL || buildDatabaseUrl(env);
}

/**
 * Main execution
 */
function main() {
  // Get Prisma command from arguments (skip node and script name)
  const prismaArgs = process.argv.slice(2);

  if (prismaArgs.length === 0) {
    console.error('Error: No Prisma command specified');
    console.error('Usage: node scripts/prisma-env.js [prisma command and args]');
    console.error('Example: node scripts/prisma-env.js migrate deploy');
    process.exit(1);
  }

  // Construct DATABASE_URL
  const databaseUrl = buildDatabaseUrl();

  // Set up environment for Prisma CLI
  const env = {
    ...process.env,
    DATABASE_URL: databaseUrl,
  };

  // Execute Prisma CLI with constructed environment
  const prismaProcess = spawn('npx', ['prisma', ...prismaArgs], {
    env,
    stdio: 'inherit',
    shell: true,
  });

  prismaProcess.on('exit', (code) => {
    process.exit(code || 0);
  });

  prismaProcess.on('error', (err) => {
    console.error('Failed to execute Prisma command:', err);
    process.exit(1);
  });
}

// Only run when invoked directly: platform-env.js requires this file for
// constructDatabaseUrl and must not spawn Prisma.
if (require.main === module) {
  main();
}

module.exports = { constructDatabaseUrl, buildDatabaseUrl };
