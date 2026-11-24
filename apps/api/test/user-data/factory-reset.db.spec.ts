// =============================================================================
// Real Postgres: the admin factory reset over ShellKeep's data (issue #69)
// =============================================================================
//
// On a throwaway database owned by an ORDINARY role (row-level security live), through the REAL
// `FactoryResetHandler` and ShellKeep's registered steps: after a full run no server profile, session,
// saved ssh credential, runbook, version or grant of ANY user remains, the administrator who ran it included
// (the per-user purge delegates profiles, and the actor is never deleted); the administrator's account,
// the database backups (their run, archive and linked job) and the default organization survive; both
// ShellKeep steps ran and are counted; and a re-run deletes nothing more.
// =============================================================================

import { randomUUID } from 'node:crypto';

import { factoryResetStepRegistry } from '@marinoscar/platform-api/user-data';

import { resolveDbSuite } from '../helpers/db-test-support';
import { createRlsDatabase, type RlsDatabase } from '../helpers/rls-database.helper';
import { defaultOrgId, runningJob, seedGroup, seedShellkeepUser, shellkeepCounts, sys, userDataServices, type UserDataDb } from './user-data-db.helper';

const { describeWithDb } = resolveDbSuite('factory-reset.db.spec');

describeWithDb('admin.factory_reset over ShellKeep data (real Postgres, RLS on)', () => {
  let db: RlsDatabase;
  let svc: UserDataDb;

  beforeAll(async () => {
    db = await createRlsDatabase('udreset');
    svc = userDataServices(db);
  }, 240_000);

  afterAll(async () => {
    await svc?.close();
    await db?.destroy();
  }, 60_000);

  it('registers both ShellKeep steps, each with a line for the page', () => {
    const steps = new Map(factoryResetStepRegistry.list().map((step) => [step.id, step]));
    expect(steps.get('shellkeep.terminal.disconnect')).toMatchObject({
      phase: 'before-users',
      summary: 'Live terminal connections are closed; tmux sessions already running on your servers are not killed.',
    });
    expect(steps.get('shellkeep.servers.reset')).toMatchObject({ phase: 'before-users' });
  });

  it('deletes every user’s ShellKeep data and keeps the actor, backups and the default organization', async () => {
    const orgId = await defaultOrgId(db);
    const actor = randomUUID();
    await sys(db, (tx) => tx.user.create({ data: { id: actor, email: `admin-${actor.slice(0, 6)}@example.test`, providerDisplayName: 'Person Admin' } }));
    const groupId = await seedGroup(db, orgId, actor);
    const mine = await seedShellkeepUser(db, svc, { name: 'actor', orgId, groupId, granteeId: actor });
    const bob = await seedShellkeepUser(db, svc, { name: 'bob', orgId, groupId, granteeId: actor });
    // `mine` is the administrator who runs the reset.
    const backupKey = `database-backups/${randomUUID()}.dump`;
    const backupJob = await sys(db, async (tx) => {
      const job = await tx.job.create({ data: { type: 'db.backup.run', reason: 'rerun', status: 'succeeded' } });
      await tx.databaseBackupRun.create({ data: { status: 'completed', trigger: 'manual', storageProvider: 's3', storageKey: backupKey, bucket: 'b', format: 'custom', jobId: job.id } });
      await tx.storageObject.create({ data: { name: 'b.dump', size: 1, mimeType: 'application/octet-stream', storageKey: backupKey, orgId, status: 'ready' } });
      return job;
    });

    const job = await runningJob(db, 'admin.factory_reset', { actorUserId: mine.userId });
    await svc.factory.process(job);

    expect(await shellkeepCounts(db, mine)).toMatchObject({ profiles: 0, sessions: 0, sshCredentials: 0, ownRunbooks: 0, groupRunbooks: 0, ownRuns: 0, groupRuns: 0, grants: 0, objects: 0, user: 1 });
    expect(await shellkeepCounts(db, bob)).toMatchObject({ profiles: 0, sessions: 0, sshCredentials: 0, ownRunbooks: 0, groupRunbooks: 0, ownRuns: 0, groupRuns: 0, grants: 0, objects: 0, user: 0 });

    const after = await sys(db, async (tx) => ({
      users: (await tx.user.findMany({ select: { id: true } })).map((u: { id: string }) => u.id),
      profiles: await tx.serverProfile.count(),
      sessions: await tx.terminalSession.count(),
      runbooks: await tx.runbook.count(),
      versions: await tx.runbookVersion.count(),
      backupRuns: await tx.databaseBackupRun.count(),
      backupJob: await tx.job.findUnique({ where: { id: backupJob.id } }),
      backupObject: await tx.storageObject.count({ where: { storageKey: backupKey } }),
      orgs: (await tx.organization.findMany({ select: { id: true } })).map((o: { id: string }) => o.id),
    }));
    // The grantee row `actor` goes too: only the run's actor (`mine`) remains.
    expect(after.users).toEqual([mine.userId]);
    expect(after).toMatchObject({ profiles: 0, sessions: 0, runbooks: 0, versions: 0, backupRuns: 1, backupObject: 1, orgs: [orgId] });
    expect(after.backupJob).not.toBeNull();

    const stored = await sys(db, (tx) => tx.job.findUnique({ where: { id: job.id } }));
    const counts = (stored.payload as { result: { counts: Record<string, number> } }).result.counts;
    expect(counts).toHaveProperty(['step.shellkeep.terminal.disconnect.sessionsTerminated']);
    expect(counts).toHaveProperty(['step.shellkeep.servers.reset.serverProfiles']);

    // A re-run deletes nothing more.
    await svc.factory.process(stored);
    expect(await sys(db, (tx) => tx.user.count())).toBe(1);
  });

  it('terminates an active session that appears while the reset runs, and opens no connection', async () => {
    const orgId = await defaultOrgId(db);
    const actor = randomUUID();
    const user = randomUUID();
    const profile = randomUUID();
    await sys(db, async (tx) => {
      for (const id of [actor, user]) await tx.user.create({ data: { id, email: `late-${id.slice(0, 6)}@example.test`, providerDisplayName: 'Person Late' } });
      await tx.serverProfile.create({ data: { id: profile, userId: user, orgId, name: 'Server late', hostname: 'late.example.test', username: 'ops', authMethod: 'password' } });
    });
    const step = factoryResetStepRegistry.list().find((entry) => entry.id === 'shellkeep.terminal.disconnect')!;
    const session = randomUUID();
    await sys(db, (tx) =>
      tx.terminalSession.create({ data: { id: session, userId: user, orgId, serverProfileId: profile, name: 'Session late', tmuxSessionId: 'tmux-late', status: 'active' } }),
    );
    const counts = await sys(db, (tx) => step.run(tx, { actorUserId: actor, jobId: randomUUID() }));
    expect(counts).toEqual({ sessionsTerminated: 1 });
    const row = await sys(db, (tx) => tx.terminalSession.findUniqueOrThrow({ where: { id: session } }));
    expect(row.status).toBe('terminated');
    expect(row.terminatedAt).not.toBeNull();
    // Idempotent.
    expect(await sys(db, (tx) => step.run(tx, { actorUserId: actor, jobId: randomUUID() }))).toEqual({ sessionsTerminated: 0 });
  });
});
