// =============================================================================
// Real-Postgres test: the terminal_session_summaries table (issue #59)
// =============================================================================
//
// Replays the migration history in a scratch database (as the cluster administrator, like
// `domain-org-id.db.spec.ts`) and proves what the schema promises: a summary row belongs to a session
// and a user and goes with either of them. Run with `npm run test:db`.
// =============================================================================

import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Client } from 'pg';

import { adminLogin } from '../helpers/db-test-support';

const MIGRATIONS = join(__dirname, '..', '..', 'prisma', 'migrations');

const USER_ID = '11111111-1111-4111-8111-111111111111';
const PROFILE_ID = 'aaaaaaa1-0000-4000-8000-000000000001';
const SESSION_ID = 'bbbbbbb1-0000-4000-8000-000000000001';
const SESSION_2 = 'bbbbbbb1-0000-4000-8000-000000000002';

async function withScratchDatabase(fn: (db: Client) => Promise<void>): Promise<void> {
  const name = `sk_test_${randomBytes(6).toString('hex')}`;
  const admin = new Client({ ...adminLogin(), database: 'postgres' });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    const db = new Client({ ...adminLogin(), database: name });
    await db.connect();
    try {
      for (const dir of readdirSync(MIGRATIONS, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
        await db.query(readFileSync(join(MIGRATIONS, dir, 'migration.sql'), 'utf8'));
      }
      await fn(db);
    } finally {
      await db.end();
    }
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.end();
  }
}

async function seed(db: Client): Promise<void> {
  await db.query(`INSERT INTO users (id, email, updated_at) VALUES ($1, 'person-a@example.test', now())`, [USER_ID]);
  await db.query(
    `INSERT INTO server_profiles (id, user_id, org_id, name, hostname, username, auth_method, tags, updated_at)
     VALUES ($1, $2, (SELECT id FROM organizations WHERE is_default), 'Host Alpha', 'alpha.example.test', 'user', 'password', ARRAY[]::text[], now())`,
    [PROFILE_ID, USER_ID],
  );
  for (const id of [SESSION_ID, SESSION_2]) {
    await db.query(
      `INSERT INTO terminal_sessions (id, user_id, org_id, server_profile_id, name, tmux_session_id, updated_at)
       VALUES ($1, $2, (SELECT id FROM organizations WHERE is_default), $3, 'Session', $4, now())`,
      [id, USER_ID, PROFILE_ID, `sk-${id.slice(-1)}`],
    );
    await db.query(
      `INSERT INTO terminal_session_summaries (id, session_id, user_id, status) VALUES (gen_random_uuid(), $1, $2, 'pending')`,
      [id, USER_ID],
    );
  }
}

describe('terminal_session_summaries (real Postgres)', () => {
  it('defaults a new row to untruncated with a creation time, and refuses a row with no session or user', async () => {
    await withScratchDatabase(async (db) => {
      await seed(db);
      const row = await db.query(`SELECT truncated, created_at, summary_md FROM terminal_session_summaries LIMIT 1`);
      expect(row.rows[0].truncated).toBe(false);
      expect(row.rows[0].created_at).toBeInstanceOf(Date);
      expect(row.rows[0].summary_md).toBeNull();

      await expect(
        db.query(`INSERT INTO terminal_session_summaries (id, session_id, user_id, status) VALUES (gen_random_uuid(), $1, $2, 'pending')`, [
          'cccccccc-0000-4000-8000-000000000009',
          USER_ID,
        ]),
      ).rejects.toThrow(/foreign key/i);
    });
  });

  it('goes with its session', async () => {
    await withScratchDatabase(async (db) => {
      await seed(db);
      await db.query(`DELETE FROM terminal_sessions WHERE id = $1`, [SESSION_ID]);
      const left = await db.query(`SELECT session_id FROM terminal_session_summaries`);
      expect(left.rows.map((r) => r.session_id)).toEqual([SESSION_2]);
    });
  });

  it('goes with its user', async () => {
    await withScratchDatabase(async (db) => {
      await seed(db);
      await db.query(`DELETE FROM users WHERE id = $1`, [USER_ID]);
      const left = await db.query(`SELECT count(*)::int AS n FROM terminal_session_summaries`);
      expect(left.rows[0].n).toBe(0);
    });
  });
});
