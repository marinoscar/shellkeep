// =============================================================================
// Shared setup for the real-Postgres suites (`*.db.spec.ts`, issue #52)
// =============================================================================
//
// TWO TIERS RUN THE SAME SUITES. CI runs `npm run test:db` first as the bootstrap
// superuser and then again connected as the ordinary application role
// (`shellkeep_app`, forced row-level security): POSTGRES_USER is the role in the
// second run. A few suites must create roles or databases, or replay the whole
// migration history, which the application role is not allowed to do. Those
// reach the cluster through the ADMIN login below, never through POSTGRES_USER:
//
//   TEST_DB_ADMIN_USER / TEST_DB_ADMIN_PASSWORD   a superuser; default POSTGRES_USER / POSTGRES_PASSWORD
//
// They are read by these test helpers only; no application code reads them.
//
// NOT A `*.spec.ts` FILE, so Jest never runs it as a suite.
// =============================================================================

import { execFileSync } from 'node:child_process';

import { Client } from 'pg';

import type { DatabaseEnv } from '../../src/common/database-url';

/**
 * Whether something is listening on host:port (a short, real TCP connect, run in
 * a child process so it is synchronous: Jest decides which `describe` blocks exist
 * from a file's synchronous top level).
 */
export function isPostgresReachable(host: string, port: number, timeoutMs = 2000): boolean {
  try {
    const probe = `
      const net = require('net');
      const socket = net.createConnection({ host: process.argv[1], port: Number(process.argv[2]) });
      const done = (ok) => { try { socket.destroy(); } catch (_e) {} process.exit(ok ? 0 : 1); };
      socket.setTimeout(${timeoutMs});
      socket.on('connect', () => done(true));
      socket.on('timeout', () => done(false));
      socket.on('error', () => done(false));
    `;
    execFileSync(process.execPath, ['-e', probe, host, String(port)], { stdio: 'ignore', timeout: timeoutMs + 1000 });
    return true;
  } catch {
    return false;
  }
}

/** `describe` when a Postgres is reachable at POSTGRES_HOST:POSTGRES_PORT, `describe.skip` (with a warning) when not. */
export function resolveDbSuite(suiteName: string): { describeWithDb: jest.Describe; dbReachable: boolean } {
  const host = process.env.POSTGRES_HOST;
  const port = Number(process.env.POSTGRES_PORT) || 5432;
  const dbReachable = Boolean(host) && isPostgresReachable(host as string, port);
  if (!dbReachable) {
    // eslint-disable-next-line no-console
    console.warn(
      `\n[${suiteName}] SKIPPED: no Postgres reachable at ${host ?? '(POSTGRES_HOST unset)'}:${port}. ` +
        'Point POSTGRES_HOST/POSTGRES_PORT at a migrated database and re-run `npm run test:db`.\n',
    );
  }
  return { describeWithDb: dbReachable ? describe : describe.skip, dbReachable };
}

/** `process.env` with `DATABASE_URL` stripped (it would win over POSTGRES_*) and `POSTGRES_DB` pinned to `database`. */
export function envFor(database: string): DatabaseEnv {
  const { DATABASE_URL: _ignored, ...rest } = process.env;
  return { ...rest, POSTGRES_DB: database };
}

/** The cluster administrator's login: TEST_DB_ADMIN_*, else POSTGRES_USER / POSTGRES_PASSWORD. */
export function adminLogin(): { host: string; port: number; user: string; password: string } {
  return {
    host: process.env.POSTGRES_HOST ?? 'localhost',
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    user: process.env.TEST_DB_ADMIN_USER || process.env.POSTGRES_USER || 'postgres',
    password: process.env.TEST_DB_ADMIN_PASSWORD || process.env.POSTGRES_PASSWORD || 'postgres',
  };
}

/**
 * Runs `fn` on a short-lived connection to `database` as the administrator, with the
 * bypass startup option so its reads are the ground truth ("every row") whether the
 * administrator is a superuser or not.
 */
export async function withAdmin<T>(database: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ ...adminLogin(), database, options: '-c app.rls_bypass=on' });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}
