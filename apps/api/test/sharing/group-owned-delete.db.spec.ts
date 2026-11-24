// =============================================================================
// Deleting group-owned servers and runbooks, then retiring the group (issue #113)
// =============================================================================
//
// The group role map sends a group ADMIN to `owner` for `server_profile` and `runbook`, so a group
// admin may delete what the group owns and `DELETE /api/groups/:id` can then succeed (it is 409
// GROUP_OWNS_RESOURCES while the group owns anything). A group editor and a group viewer stay below
// `owner` and answer 404. `owner` adds no access to a credential: only the user who saved the
// secrets may change the connection or the secrets, whatever the role.
//
// Run with `npm run test:db` (as the bootstrap superuser, then as the application role).
// =============================================================================

import { randomBytes } from 'node:crypto';
import request from 'supertest';

import { closeTestApp, createTestApp, TestContext } from '../helpers/test-app.helper';

const RUN = randomBytes(4).toString('hex');
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const SECRET = `FAKE-SSH-PASSWORD-${RUN}`;
const DEF = { schemaVersion: 1, steps: [{ id: 'c1', name: 'Disk', kind: 'command', command: 'df -h' }] };

interface Person {
  email: string;
  token: string;
  userId: string;
}

describe('Group admins delete group-owned servers and runbooks (real database)', () => {
  let context: TestContext;
  const emails: string[] = [];
  const server = () => context.app.getHttpServer();
  const bypass = (fn: (tx: any) => Promise<any>): Promise<any> =>
    context.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
      return fn(tx);
    });

  let admin: Person; // creates the group, so its admin
  let admin2: Person; // a second group admin who saved no credential
  let editor: Person; // group editor: may create group-owned records, may not delete them
  let viewer: Person; // group viewer
  let outsider: Person;
  const groupIds: string[] = [];

  async function login(name: string): Promise<Person> {
    const email = `${name}-${RUN}@example.test`;
    emails.push(email);
    const res = await request(server()).post('/api/auth/test/login').send({ email, role: 'contributor' }).expect(302);
    const token = new URL(res.headers.location).searchParams.get('token') as string;
    const me = await request(server()).get('/api/auth/me').set(bearer(token)).expect(200);
    return { email, token, userId: me.body.data.id as string };
  }

  async function newGroup(label: string): Promise<string> {
    const id = (await request(server()).post('/api/groups').set(bearer(admin.token)).send({ name: `Team ${RUN} ${label}` }).expect(201)).body.data.id as string;
    groupIds.push(id);
    for (const [person, role] of [[admin2, 'admin'], [editor, 'editor'], [viewer, 'viewer']] as const) {
      await request(server()).post(`/api/groups/${id}/members`).set(bearer(admin.token)).send({ userId: person.userId, role }).expect(201);
    }
    return id;
  }

  const createProfile = (person: Person, name: string, ownerGroupId: string) =>
    request(server())
      .post('/api/server-profiles')
      .set(bearer(person.token))
      .send({ name: `${name}-${RUN}`, hostname: `${name}.example.test`, port: 22, username: 'ops', authMethod: 'password', password: SECRET, ownerGroupId });

  const createRunbook = (person: Person, name: string, ownerGroupId: string) =>
    request(server()).post('/api/runbooks').set(bearer(person.token)).send({ name: `rb-${RUN}-${name}`, definition: DEF, ownerGroupId });

  /** A grant straight into the table: the sharing API reads group roles from a cached principal, which a fresh group outruns. */
  const grantTo = async (resourceType: string, resourceId: string, granteeGroupId: string): Promise<void> => {
    const group = await bypass((tx) => tx.group.findUniqueOrThrow({ where: { id: granteeGroupId } }));
    await bypass((tx) =>
      tx.grant.create({
        data: { orgId: group.orgId, resourceType, resourceId, granteeKind: 'group', granteeGroupId, role: resourceType === 'runbook' ? 'runner' : 'viewer' },
      }),
    );
  };

  const grantCount = (resourceType: string, resourceId: string): Promise<number> =>
    bypass((tx) => tx.grant.count({ where: { resourceType, resourceId } }));

  beforeAll(async () => {
    process.env.SECRETS_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');
    context = await createTestApp({ useMockDatabase: false });
    admin = await login('gadmin');
    admin2 = await login('gadmin2');
    editor = await login('geditor');
    viewer = await login('gviewer');
    outsider = await login('goutsider');
  }, 120_000);

  afterAll(async () => {
    await bypass(async (tx) => {
      await tx.grant.deleteMany({ where: { granteeGroupId: { in: groupIds } } });
      await tx.runbook.deleteMany({ where: { name: { startsWith: `rb-${RUN}` } } });
      await tx.serverProfile.deleteMany({ where: { name: { endsWith: `-${RUN}` } } });
      await tx.groupMember.deleteMany({ where: { groupId: { in: groupIds } } });
      await tx.group.deleteMany({ where: { id: { in: groupIds } } });
    });
    await context.prisma.user.deleteMany({ where: { email: { in: emails } } });
    await closeTestApp(context);
  }, 60_000);

  it('lets a group admin delete a group-owned server and runbook, then retire the group', async () => {
    const groupId = await newGroup('retire');
    const otherGroup = await newGroup('other');
    const profileId = (await createProfile(editor, 'retire-srv', groupId).expect(201)).body.data.id as string;
    const runbookId = (await createRunbook(editor, 'retire', groupId).expect(201)).body.data.id as string;
    await grantTo('server_profile', profileId, otherGroup);
    expect(await grantCount('server_profile', profileId)).toBe(1);
    await grantTo('runbook', runbookId, otherGroup);

    // The group is not retirable while it owns records.
    const blocked = await request(server()).delete(`/api/groups/${groupId}`).set(bearer(admin.token)).expect(409);
    expect(blocked.body.details.reason).toBe('GROUP_OWNS_RESOURCES');

    // The group admin (not the creator of either record) sees `delete` in the response.
    const seen = await request(server()).get(`/api/server-profiles/${profileId}`).set(bearer(admin2.token)).expect(200);
    expect(seen.body.data.access).toMatchObject({ role: 'owner', shared: true, credentialHolder: false });
    expect(seen.body.data.access.can).toMatchObject({ delete: true, share: true });

    await request(server()).delete(`/api/server-profiles/${profileId}`).set(bearer(admin2.token)).expect(204);
    await request(server()).delete(`/api/runbooks/${runbookId}/permanent`).set(bearer(admin2.token)).expect(204);

    // The grants went in the same transaction, the rows are gone.
    expect(await grantCount('server_profile', profileId)).toBe(0);
    expect(await grantCount('runbook', runbookId)).toBe(0);
    expect(await bypass((tx) => tx.serverProfile.count({ where: { id: profileId } }))).toBe(0);
    expect(await bypass((tx) => tx.runbook.count({ where: { id: runbookId } }))).toBe(0);
    await request(server()).get(`/api/server-profiles/${profileId}`).set(bearer(admin.token)).expect(404);

    await request(server()).delete(`/api/groups/${groupId}`).set(bearer(admin.token)).expect(204);
    groupIds.splice(groupIds.indexOf(groupId), 1);
  });

  it('answers a group editor, a group viewer and an outsider 404 on delete, and keeps the records', async () => {
    const groupId = await newGroup('guarded');
    const profileId = (await createProfile(admin, 'guarded-srv', groupId).expect(201)).body.data.id as string;
    const runbookId = (await createRunbook(admin, 'guarded', groupId).expect(201)).body.data.id as string;

    for (const person of [editor, viewer, outsider]) {
      await request(server()).delete(`/api/server-profiles/${profileId}`).set(bearer(person.token)).expect(404);
      await request(server()).delete(`/api/runbooks/${runbookId}/permanent`).set(bearer(person.token)).expect(404);
    }
    // The editor may not share either (share needs `owner`).
    await request(server())
      .post('/api/grants')
      .set(bearer(editor.token))
      .send({ resourceType: 'server_profile', resourceId: profileId, role: 'viewer', grantee: { kind: 'user', userId: outsider.userId } })
      .expect(404);

    expect(await bypass((tx) => tx.serverProfile.count({ where: { id: profileId } }))).toBe(1);
    expect(await bypass((tx) => tx.runbook.count({ where: { id: runbookId } }))).toBe(1);
    await request(server()).delete(`/api/groups/${groupId}`).set(bearer(admin.token)).expect(409);
  });

  it('still keeps the connection and the secrets of a profile with the user who saved them', async () => {
    const groupId = await newGroup('holder');
    // The editor saved the credential; the group admin owns the record but does not hold the secret.
    const profileId = (await createProfile(editor, 'holder-srv', groupId).expect(201)).body.data.id as string;

    const moved = await request(server())
      .patch(`/api/server-profiles/${profileId}`)
      .set(bearer(admin2.token))
      .send({ hostname: 'attacker.example.test', password: 'replacement' })
      .expect(403);
    expect(moved.body.code).toBe('SERVER_PROFILE_CREDENTIAL_HOLDER_ONLY');
    expect(moved.body.details.fields).toEqual(expect.arrayContaining(['hostname', 'password']));

    // A name change is allowed for the owner role; the host is unchanged.
    await request(server()).patch(`/api/server-profiles/${profileId}`).set(bearer(admin2.token)).send({ name: `holder-renamed-${RUN}` }).expect(200);
    const after = await request(server()).get(`/api/server-profiles/${profileId}`).set(bearer(editor.token)).expect(200);
    expect(after.body.data.hostname).toBe('holder-srv.example.test');
    expect(JSON.stringify(after.body)).not.toContain(SECRET);
  });

  it('refuses to delete a runbook that has an unfinished run: 409 RUNBOOK_HAS_ACTIVE_RUNS', async () => {
    const groupId = await newGroup('active');
    const runbookId = (await createRunbook(admin, 'active', groupId).expect(201)).body.data.id as string;
    const orgId = (await bypass((tx) => tx.runbook.findUniqueOrThrow({ where: { id: runbookId } }))).orgId as string;
    const run = await bypass((tx) =>
      tx.runbookRun.create({ data: { orgId, runbookId, version: 1, initiatedBy: admin.userId, status: 'running', targetSelector: {}, strategy: {} } }),
    );
    const res = await request(server()).delete(`/api/runbooks/${runbookId}/permanent`).set(bearer(admin.token)).expect(409);
    expect(res.body.code).toBe('RUNBOOK_HAS_ACTIVE_RUNS');

    await bypass((tx) => tx.runbookRun.update({ where: { id: run.id }, data: { status: 'cancelled' } }));
    await request(server()).delete(`/api/runbooks/${runbookId}/permanent`).set(bearer(admin.token)).expect(204);
  });
});
