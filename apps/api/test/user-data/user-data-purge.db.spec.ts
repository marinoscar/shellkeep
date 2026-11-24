// =============================================================================
// Real Postgres: the per-user purge of ShellKeep's data (issue #69)
// =============================================================================
//
// On a throwaway database owned by an ORDINARY role (row-level security live): a user with server
// profiles, saved ssh credentials, terminal sessions, runbooks with versions, grants, a group membership
// and storage objects is purged scope by scope, through the REAL `UserPurgeRunner` and ShellKeep's two
// delegated handlers, with the REAL credential store.
//
//   servers     the user's profiles (a group-owned one the user created too), their sessions, their saved
//               ssh credentials and the grants on the profiles are gone; runbooks and files stay;
//   runbooks    the runbook only the user owns goes with its versions and grants; a group's runbook stays
//               with the group, its author link nulled, its versions and grants intact;
//   everything  all of it, plus the user's files (bytes deleted through the provider); the account, the
//               organization membership and the group membership stay;
//   always      another user's rows are untouched and no hostname, user name or secret is written to the log.
// =============================================================================

import { randomUUID } from 'node:crypto';

import { resolveDbSuite } from '../helpers/db-test-support';
import { createRlsDatabase, type RlsDatabase } from '../helpers/rls-database.helper';
import {
  defaultOrgId,
  runPurge,
  seedGroup,
  seedShellkeepUser,
  shellkeepCounts,
  sys,
  userDataServices,
  type SeededUser,
  type UserDataDb,
} from './user-data-db.helper';

const { describeWithDb } = resolveDbSuite('user-data-purge.db.spec');

describeWithDb('user.data.purge of ShellKeep data (real Postgres, RLS on)', () => {
  let db: RlsDatabase;
  let svc: UserDataDb;
  let orgId: string;
  let groupId: string;
  let granteeId: string;

  beforeAll(async () => {
    db = await createRlsDatabase('udpurge');
    svc = userDataServices(db);
    orgId = await defaultOrgId(db);
    granteeId = randomUUID();
    await sys(db, (tx) => tx.user.create({ data: { id: granteeId, email: `grantee-${granteeId.slice(0, 6)}@example.test`, providerDisplayName: 'Person Grantee' } }));
    groupId = await seedGroup(db, orgId, granteeId);
  }, 240_000);

  afterAll(async () => {
    await svc?.close();
    await db?.destroy();
  }, 60_000);

  const seed = (name: string) => seedShellkeepUser(db, svc, { name, orgId, groupId, granteeId });

  it('seeds every kind of row, so the proofs below are not vacuous', async () => {
    const user = await seed('seed');
    expect(await shellkeepCounts(db, user)).toMatchObject({
      profiles: 3,
      sessions: 2,
      sshCredentials: 3,
      ownRunbooks: 1,
      ownRunbookVersions: 2,
      groupRunbooks: 1,
      groupRunbookVersions: 2,
      grants: 4,
      objects: 2,
      user: 1,
      membership: 1,
      groupMember: 1,
    });
  });

  it('servers: profiles, sessions, saved credentials and their grants are gone; the rest and other users stay', async () => {
    const user = await seed('servers');
    const other = await seed('servers-other');
    const otherBefore = await shellkeepCounts(db, other);

    const { result, delegatedTypes } = await runPurge(db, svc, user.userId, 'servers');

    expect(delegatedTypes).toEqual(['servers.user_data.purge']);
    expect(result.models.TerminalSession).toBe(2);
    const after = await shellkeepCounts(db, user);
    expect(after).toMatchObject({ profiles: 0, sessions: 0, sshCredentials: 0 });
    // Grants on the profiles went; grants on the runbooks stay.
    expect(after.grants).toBe(2);
    // Not in the scope: runbooks, files, the account and the memberships.
    expect(after).toMatchObject({ ownRunbooks: 1, groupRunbooks: 1, objects: 2, user: 1, membership: 1, groupMember: 1 });
    expect(await shellkeepCounts(db, other)).toEqual(otherBefore);
  });

  it('servers: running the purge again deletes nothing more', async () => {
    const user = await seed('servers-again');
    await runPurge(db, svc, user.userId, 'servers');
    const before = await shellkeepCounts(db, user);
    await runPurge(db, svc, user.userId, 'servers');
    expect(await shellkeepCounts(db, user)).toEqual(before);
  });

  it('runbooks: the runbook only the user owns goes with its versions and grants; a group runbook stays with the group', async () => {
    const user = await seed('runbooks');
    const other = await seed('runbooks-other');
    const otherBefore = await shellkeepCounts(db, other);

    const { delegatedTypes } = await runPurge(db, svc, user.userId, 'runbooks');

    expect(delegatedTypes).toEqual(['runbooks.user_data.purge']);
    const after = await shellkeepCounts(db, user);
    expect(after).toMatchObject({ ownRunbooks: 0, ownRunbookVersions: 0 });
    // The group's runbook stays, with its versions and its grant, and no author link to the user.
    expect(after).toMatchObject({ groupRunbooks: 1, groupRunbookVersions: 2, groupRunbookAuthored: 0 });
    // Grants: the two on the profiles and the one on the group's runbook remain.
    expect(after.grants).toBe(3);
    // Not in the scope: servers, sessions, credentials, files.
    expect(after).toMatchObject({ profiles: 3, sessions: 2, sshCredentials: 3, objects: 2 });
    expect(await shellkeepCounts(db, other)).toEqual(otherBefore);
  });

  it('everything: all of the user’s data and files go (bytes through the provider); the account and memberships stay', async () => {
    const user = await seed('everything');
    const other = await seed('everything-other');
    const otherBefore = await shellkeepCounts(db, other);
    svc.storage.deleted.length = 0;

    const { result, delegatedTypes } = await runPurge(db, svc, user.userId, 'everything');

    expect(delegatedTypes).toEqual(['runbooks.user_data.purge', 'servers.user_data.purge']);
    expect(result.storageObjectsFailed).toBe(0);
    expect(svc.storage.deleted.sort()).toEqual([...user.objectKeys].sort());
    const after = await shellkeepCounts(db, user);
    expect(after).toMatchObject({ profiles: 0, sessions: 0, sshCredentials: 0, ownRunbooks: 0, ownRunbookVersions: 0, objects: 0, groupRunbooks: 1, groupRunbookAuthored: 0 });
    // Only the group runbook's own grant is left; every grant on a deleted record went.
    expect(after.grants).toBe(1);
    expect(after).toMatchObject({ user: 1, membership: 1, groupMember: 1 });
    expect(await shellkeepCounts(db, other)).toEqual(otherBefore);
  });

  it('writes no hostname, user name or credential name to the audit trail', async () => {
    const user = await seed('audit');
    svc.audit.length = 0;
    await runPurge(db, svc, user.userId, 'servers');
    const text = JSON.stringify(svc.audit);
    expect(svc.audit.some((event) => event.action === 'user_data.purge.completed')).toBe(true);
    expect(text).not.toContain('example.test');
    expect(text).not.toContain('profile.');
    expect(text).not.toContain(user.email);
  });
});
