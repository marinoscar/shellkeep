// =============================================================================
// Real-Postgres test: the migration history replays on an empty database and the
// domain tables carry a NOT NULL org_id (issue #45)
// =============================================================================
//
// Self-contained: it connects as the cluster ADMINISTRATOR (TEST_DB_ADMIN_USER /
// TEST_DB_ADMIN_PASSWORD, else POSTGRES_*; see helpers/db-test-support.ts), never as
// the application role the second tier of `test:db` runs as (#52): replaying the whole
// history creates extensions and database objects an ordinary role may not. It creates a scratch database per case, replays every prisma/migrations/*/migration.sql
// in directory order (what `prisma migrate deploy` does on an empty database)
// and drops the scratch database afterwards. Run with `npm run test:db`.
// =============================================================================

import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Client } from 'pg';

import { adminLogin } from '../helpers/db-test-support';

const MIGRATIONS = join(__dirname, '..', '..', 'prisma', 'migrations');
const ORG_ID_MIGRATION = 'shellkeep_domain_org_id';

function connection(database: string): Client {
  return new Client({ ...adminLogin(), database });
}

function migrationDirs(): string[] {
  return readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

async function withScratchDatabase(fn: (db: Client, name: string) => Promise<void>): Promise<void> {
  const name = `sk_test_${randomBytes(6).toString('hex')}`;
  const admin = connection('postgres');
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    const db = connection(name);
    await db.connect();
    try {
      await fn(db, name);
    } finally {
      await db.end();
    }
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.end();
  }
}

async function replay(db: Client, include: (dir: string) => boolean): Promise<void> {
  for (const dir of migrationDirs()) {
    if (!include(dir)) continue;
    await db.query(readFileSync(join(MIGRATIONS, dir, 'migration.sql'), 'utf8'));
  }
}

const USER_ID = '11111111-1111-4111-8111-111111111111';
const PROFILE_ID = 'aaaaaaa1-0000-4000-8000-000000000001';
const SESSION_ID = 'bbbbbbb1-0000-4000-8000-000000000001';

async function insertSampleRows(db: Client): Promise<void> {
  await db.query(
    `INSERT INTO users (id, email, updated_at) VALUES ($1, 'person-a@example.test', now())`,
    [USER_ID],
  );
  await db.query(
    `INSERT INTO server_profiles (id, user_id, name, hostname, username, auth_method, tags, updated_at)
     VALUES ($1, $2, 'Host Alpha', 'alpha.example.test', 'user', 'password', ARRAY[]::text[], now())`,
    [PROFILE_ID, USER_ID],
  );
  await db.query(
    `INSERT INTO terminal_sessions (id, user_id, server_profile_id, name, tmux_session_id, updated_at)
     VALUES ($1, $2, $3, 'Session 1', 'sk-1', now())`,
    [SESSION_ID, USER_ID, PROFILE_ID],
  );
}

describe('ShellKeep domain schema (real Postgres)', () => {
  it('replays the whole history on an empty database (the missing domain migration)', async () => {
    await withScratchDatabase(async (db) => {
      await replay(db, () => true);

      const tables = await db.query(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name IN ('server_profiles', 'terminal_sessions')`,
      );
      expect(tables.rows.map((r) => r.table_name).sort()).toEqual(['server_profiles', 'terminal_sessions']);

      const color = await db.query(
        `SELECT 1 FROM information_schema.columns
          WHERE table_name = 'server_profiles' AND column_name = 'color'`,
      );
      expect(color.rowCount).toBe(1);

      const ledgerOrder = migrationDirs();
      expect(ledgerOrder.indexOf('20260124223147_add_terminal_domain')).toBeGreaterThan(
        ledgerOrder.indexOf('20260124223146_initial'),
      );
      expect(ledgerOrder.indexOf('20260124223147_add_terminal_domain')).toBeLessThan(
        ledgerOrder.indexOf('20260322203853_add_server_profile_color'),
      );
    });
  });

  it('gives server_profiles and terminal_sessions a NOT NULL org_id that references organizations', async () => {
    await withScratchDatabase(async (db) => {
      await replay(db, () => true);

      for (const table of ['server_profiles', 'terminal_sessions']) {
        const col = await db.query(
          `SELECT is_nullable FROM information_schema.columns WHERE table_name = $1 AND column_name = 'org_id'`,
          [table],
        );
        expect(col.rows).toEqual([{ is_nullable: 'NO' }]);

        const fk = await db.query(
          `SELECT confrelid::regclass::text AS target, confdeltype
             FROM pg_constraint WHERE conname = $1`,
          [`${table}_org_id_fkey`],
        );
        expect(fk.rows).toEqual([{ target: 'organizations', confdeltype: 'r' }]); // r = RESTRICT

        const idx = await db.query(`SELECT 1 FROM pg_indexes WHERE indexname = $1`, [`${table}_org_id_user_id_idx`]);
        expect(idx.rowCount).toBe(1);
      }

      const orgs = await db.query(`SELECT count(*)::int AS n FROM organizations WHERE is_default`);
      expect(orgs.rows[0].n).toBe(1);

      await db.query(
        `INSERT INTO users (id, email, updated_at) VALUES ($1, 'person-a@example.test', now())`,
        [USER_ID],
      );
      await expect(
        db.query(
          `INSERT INTO server_profiles (id, user_id, name, hostname, username, auth_method, tags, updated_at)
           VALUES ($1, $2, 'Host Alpha', 'alpha.example.test', 'user', 'password', ARRAY[]::text[], now())`,
          [PROFILE_ID, USER_ID],
        ),
      ).rejects.toMatchObject({ code: '23502' }); // not_null_violation
    });
  });

  it('backfills existing rows with the default organization', async () => {
    await withScratchDatabase(async (db) => {
      // The database as the baseline leaves it: everything but the org_id migration.
      // The sharing migration (#71) builds on org_id, so it is not part of the pre-org_id history either.
      await replay(db, (dir) => !dir.endsWith(ORG_ID_MIGRATION) && !dir.endsWith('_add_sharing_owner_group'));
      await insertSampleRows(db);

      const orgIdDir = migrationDirs().find((d) => d.endsWith(ORG_ID_MIGRATION));
      expect(orgIdDir).toBeDefined();
      await db.query(readFileSync(join(MIGRATIONS, orgIdDir as string, 'migration.sql'), 'utf8'));

      const defaultOrg = (await db.query(`SELECT id FROM organizations WHERE is_default`)).rows[0].id;
      for (const table of ['server_profiles', 'terminal_sessions']) {
        const rows = await db.query(`SELECT org_id FROM ${table}`);
        expect(rows.rows).toEqual([{ org_id: defaultOrg }]);
      }
    });
  });
});
