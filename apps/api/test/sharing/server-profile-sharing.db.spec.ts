// =============================================================================
// Sharing server profiles and runbooks over a real database (issue #71)
// =============================================================================
//
// Boots the full `AppModule` against the migrated and seeded database and drives the real routes
// with real users. It proves what a mocked client cannot: the access matrix of a shared server
// (owner, a member of the group it is shared with, a direct viewer and an outsider, each against
// read, connect, run and write), that a credential never leaves the owner, that revoking a share
// closes the door, that links stay off, that a group which owns a server cannot be deleted, and that
// a runbook runs only on the targets its runner may connect to.
//
// Run with `npm run test:db` (as the bootstrap superuser, then as the application role).
// =============================================================================

import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { NotFoundException } from '@nestjs/common';

import { RunbooksService } from '../../src/runbooks/runbooks.service';
import { ServerProfilesService } from '../../src/server-profiles/server-profiles.service';
import { actingPrincipal } from '../../src/platform/sharing/sharing-access';
import { closeTestApp, createTestApp, TestContext } from '../helpers/test-app.helper';

const RUN = randomBytes(4).toString('hex');
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
// Obviously fake; the marker makes any leak into a response or an audit row easy to find.
const SECRET = `FAKE-SSH-PASSWORD-${RUN}`;
const DEF = { schemaVersion: 1, steps: [{ id: 'c1', name: 'Disk', kind: 'command', command: 'df -h' }] };

interface Person {
  email: string;
  token: string;
  userId: string;
  orgId: string;
  permissions: string[];
}

describe('Sharing server profiles and runbooks (real database)', () => {
  let context: TestContext;
  const emails: string[] = [];
  const server = () => context.app.getHttpServer();
  const bypass = (fn: (tx: any) => Promise<any>): Promise<any> =>
    context.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
      return fn(tx);
    });

  let A: Person; // owner
  let B: Person; // member of the group the server is shared with
  let C: Person; // outsider
  let D: Person; // direct viewer grantee
  let V: Person; // an org Viewer (no sessions:write) holding an operator share
  let profileId: string;
  let groupId: string;

  async function login(name: string, role = 'contributor'): Promise<Person> {
    const email = `${name}-${RUN}@example.test`;
    emails.push(email);
    const res = await request(server()).post('/api/auth/test/login').send({ email, role }).expect(302);
    const token = new URL(res.headers.location).searchParams.get('token') as string;
    const me = await request(server()).get('/api/auth/me').set(bearer(token)).expect(200);
    // The organization the access token acts in is its `org` claim.
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as { org: string };
    return { email, token, userId: me.body.data.id as string, orgId: claims.org, permissions: me.body.data.permissions as string[] };
  }

  /** The caller as the guard would build them, with the permissions the user really holds. */
  const principalOf = (person: Person, permissions: string[] = person.permissions) =>
    actingPrincipal({ userId: person.userId, orgId: person.orgId, permissions, roles: [] });

  const createProfile = (person: Person, name: string, extra: Record<string, unknown> = {}) =>
    request(server())
      .post('/api/server-profiles')
      .set(bearer(person.token))
      .send({ name: `${name}-${RUN}`, hostname: `${name}.example.test`, port: 22, username: 'ops', authMethod: 'password', password: SECRET, ...extra });

  const share = (owner: Person, resourceType: string, resourceId: string, role: string, grantee: Record<string, unknown>) =>
    request(server()).post('/api/grants').set(bearer(owner.token)).send({ resourceType, resourceId, role, grantee });

  beforeAll(async () => {
    process.env.SECRETS_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');
    context = await createTestApp({ useMockDatabase: false });
    [A, B, C, D] = [await login('owner'), await login('member'), await login('outsider'), await login('viewer')];
    V = await login('orgviewer', 'viewer');

    profileId = (await createProfile(A, 'shared').expect(201)).body.data.id;
    groupId = (await request(server()).post('/api/groups').set(bearer(A.token)).send({ name: `Team ${RUN}` }).expect(201)).body.data.id;
    await request(server()).post(`/api/groups/${groupId}/members`).set(bearer(A.token)).send({ userId: B.userId, role: 'viewer' }).expect(201);
  }, 120_000);

  afterAll(async () => {
    await bypass(async (tx) => {
      await tx.grant.deleteMany({ where: { orgId: A.orgId, resourceType: { in: ['server_profile', 'runbook'] } } });
      await tx.runbookVersion.deleteMany({ where: { runbook: { name: { startsWith: `rb-${RUN}` } } } });
      await tx.runbook.deleteMany({ where: { name: { startsWith: `rb-${RUN}` } } });
      await tx.serverProfile.deleteMany({ where: { name: { endsWith: `-${RUN}` } } });
      await tx.groupMember.deleteMany({ where: { groupId } });
      await tx.group.deleteMany({ where: { name: { startsWith: `Team ${RUN}` } } });
    });
    await context.prisma.user.deleteMany({ where: { email: { in: emails } } });
    await closeTestApp(context);
  }, 60_000);

  describe('a server shared with a group as operator', () => {
    let grantId: string;

    it('is private until it is shared: an outsider and a member both get 404', async () => {
      for (const person of [B, C, D]) {
        await request(server()).get(`/api/server-profiles/${profileId}`).set(bearer(person.token)).expect(404);
        const list = await request(server()).get('/api/server-profiles').set(bearer(person.token)).expect(200);
        expect(list.body.data.items.map((item: { id: string }) => item.id)).not.toContain(profileId);
      }
    });

    it('lets the owner share it with the group as operator', async () => {
      const res = await share(A, 'server_profile', profileId, 'operator', { kind: 'group', groupId }).expect(201);
      grantId = res.body.data.id;
    });

    it('shows it to the member, who can open a session on it, but never a credential', async () => {
      const list = await request(server()).get('/api/server-profiles').set(bearer(B.token)).expect(200);
      const item = list.body.data.items.find((entry: { id: string }) => entry.id === profileId);
      expect(item).toBeDefined();
      expect(item.owner).toMatchObject({ kind: 'user', id: A.userId });
      expect(item.access).toMatchObject({ role: 'operator', via: 'group_grant', shared: true });
      expect(item.access.can).toEqual({ connect: true, test: true, write: false, share: false, delete: false });
      expect(item).not.toHaveProperty('hasPassword');

      const one = await request(server()).get(`/api/server-profiles/${profileId}`).set(bearer(B.token)).expect(200);
      expect(JSON.stringify(one.body)).not.toContain(SECRET);
      for (const field of ['hasPassword', 'hasPrivateKey', 'hasPassphrase', 'password', 'privateKey', 'passphrase']) {
        expect(one.body.data).not.toHaveProperty(field);
      }

      const session = await request(server()).post('/api/sessions').set(bearer(B.token)).send({ serverProfileId: profileId }).expect(201);
      // The session is the member's own, never the owner's.
      expect(session.body.data.userId).toBe(B.userId);
      const mine = await request(server()).get('/api/sessions').set(bearer(A.token)).expect(200);
      expect(mine.body.data.items.map((s: { id: string }) => s.id)).not.toContain(session.body.data.id);
    });

    it('lets the owner see their own credential flags and nobody else', async () => {
      const own = await request(server()).get(`/api/server-profiles/${profileId}`).set(bearer(A.token)).expect(200);
      expect(own.body.data).toMatchObject({ hasPassword: true, access: { role: 'owner', shared: false } });
      expect(JSON.stringify(own.body)).not.toContain(SECRET);
    });

    it('refuses the member every write: PATCH, DELETE, host-key trust and a further share answer 404', async () => {
      await request(server()).patch(`/api/server-profiles/${profileId}`).set(bearer(B.token)).send({ name: 'hijacked' }).expect(404);
      await request(server()).delete(`/api/server-profiles/${profileId}`).set(bearer(B.token)).expect(404);
      await request(server()).delete(`/api/server-profiles/${profileId}/host-key`).set(bearer(B.token)).expect(404);
      await share(B, 'server_profile', profileId, 'viewer', { kind: 'user', userId: C.userId }).expect(404);
      const after = await request(server()).get(`/api/server-profiles/${profileId}`).set(bearer(A.token)).expect(200);
      expect(after.body.data.name).toBe(`shared-${RUN}`);
    });

    it('answers the outsider 404 on read, session creation, write and share (never 403)', async () => {
      await request(server()).get(`/api/server-profiles/${profileId}`).set(bearer(C.token)).expect(404);
      await request(server()).post('/api/sessions').set(bearer(C.token)).send({ serverProfileId: profileId }).expect(404);
      await request(server()).patch(`/api/server-profiles/${profileId}`).set(bearer(C.token)).send({ name: 'x' }).expect(404);
      await request(server()).post(`/api/server-profiles/${profileId}/test`).set(bearer(C.token)).expect(404);
      await share(C, 'server_profile', profileId, 'viewer', { kind: 'user', userId: D.userId }).expect(404);
    });

    it('filters the list: "shared with me" for the member, "mine" for the owner', async () => {
      const ids = async (person: Person, filter: string) =>
        (await request(server()).get(`/api/server-profiles?filter=${filter}`).set(bearer(person.token)).expect(200)).body.data.items.map(
          (item: { id: string }) => item.id,
        );
      expect(await ids(B, 'shared')).toContain(profileId);
      expect(await ids(B, 'mine')).not.toContain(profileId);
      expect(await ids(A, 'mine')).toContain(profileId);
      expect(await ids(A, 'shared')).not.toContain(profileId);
    });

    it('reads the credential server-side for the member and audits it without the secret', async () => {
      const profiles = context.app.get(ServerProfilesService);
      const decrypted = await profiles.getDecryptedProfile(profileId, principalOf(B), 'history');
      expect(decrypted.password).toBe(SECRET);
      expect(decrypted.userId).toBe(A.userId);

      const events = await bypass((tx) => tx.auditEvent.findMany({ where: { action: 'server_profile.connect_as_grantee', targetId: profileId } }));
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ actorUserId: B.userId, targetType: 'server_profile' });
      expect(events[0].meta).toMatchObject({ ownerUserId: A.userId, purpose: 'history' });
      expect(JSON.stringify(events)).not.toContain(SECRET);

      // The owner reading their own credential is not a grantee event.
      await profiles.getDecryptedProfile(profileId, principalOf(A), 'connect');
      expect(await bypass((tx) => tx.auditEvent.count({ where: { action: 'server_profile.connect_as_grantee', targetId: profileId } }))).toBe(1);
    });

    it('refuses the credential to the outsider, and to a viewer who may read but not connect', async () => {
      const profiles = context.app.get(ServerProfilesService);
      await expect(profiles.getDecryptedProfile(profileId, principalOf(C), 'connect')).rejects.toBeInstanceOf(NotFoundException);
      await share(A, 'server_profile', profileId, 'viewer', { kind: 'user', userId: D.userId }).expect(201);
      await request(server()).get(`/api/server-profiles/${profileId}`).set(bearer(D.token)).expect(200);
      await expect(profiles.getDecryptedProfile(profileId, principalOf(D), 'connect')).rejects.toBeInstanceOf(NotFoundException);
      await request(server()).post('/api/sessions').set(bearer(D.token)).send({ serverProfileId: profileId }).expect(404);
    });

    it('needs the RBAC permission on top of the share: an org Viewer holding an operator share cannot open a session', async () => {
      await share(A, 'server_profile', profileId, 'operator', { kind: 'user', userId: V.userId }).expect(201);
      await request(server()).get(`/api/server-profiles/${profileId}`).set(bearer(V.token)).expect(200);
      await request(server()).post('/api/sessions').set(bearer(V.token)).send({ serverProfileId: profileId }).expect(403);
    });

    it('closes the door when the share is revoked', async () => {
      await request(server()).delete(`/api/grants/${grantId}`).set(bearer(A.token)).expect(204);
      await request(server()).get(`/api/server-profiles/${profileId}`).set(bearer(B.token)).expect(404);
      await request(server()).post('/api/sessions').set(bearer(B.token)).send({ serverProfileId: profileId }).expect(404);
      const profiles = context.app.get(ServerProfilesService);
      await expect(profiles.assertCanConnect(profileId, principalOf(B))).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('links stay off', () => {
    it('answers 422 ROLE_NOT_GRANTABLE for a link on a server profile and on a runbook', async () => {
      const runbook = await request(server()).post('/api/runbooks').set(bearer(A.token)).send({ name: `rb-${RUN}-link`, definition: DEF }).expect(201);
      for (const [resourceType, resourceId] of [
        ['server_profile', profileId],
        ['runbook', runbook.body.data.id],
      ]) {
        const res = await request(server()).post('/api/grants/links').set(bearer(A.token)).send({ resourceType, resourceId, role: 'viewer' }).expect(422);
        expect(res.body.details.reason).toBe('ROLE_NOT_GRANTABLE');
      }
    });
  });

  describe('a server owned by a group', () => {
    let owned: string;

    it('is created by a group admin or editor only', async () => {
      // B is a plain viewer of the group: forbidden. C is no member: 404.
      await createProfile(B, 'by-viewer', { ownerGroupId: groupId }).expect(403);
      await createProfile(C, 'by-stranger', { ownerGroupId: groupId }).expect(404);
      const res = await createProfile(A, 'group-owned', { ownerGroupId: groupId }).expect(201);
      owned = res.body.data.id;
      expect(res.body.data.owner).toMatchObject({ kind: 'group', id: groupId });
    });

    it('maps the group role onto the server: viewer reads, editor operates, admin writes', async () => {
      // B is a group viewer: reads, cannot connect.
      await request(server()).get(`/api/server-profiles/${owned}`).set(bearer(B.token)).expect(200);
      await request(server()).post('/api/sessions').set(bearer(B.token)).send({ serverProfileId: owned }).expect(404);
      // Promote B to group editor: operator on the server.
      await request(server()).patch(`/api/groups/${groupId}/members/${B.userId}`).set(bearer(A.token)).send({ role: 'editor' }).expect(200);
      await request(server()).post('/api/sessions').set(bearer(B.token)).send({ serverProfileId: owned }).expect(201);
      await request(server()).patch(`/api/server-profiles/${owned}`).set(bearer(B.token)).send({ name: 'x' }).expect(404);
      // The group admin (A) holds editor: may rename, may not move the credentials of a profile saved by someone else (A saved it).
      await request(server()).patch(`/api/server-profiles/${owned}`).set(bearer(A.token)).send({ name: `group-renamed-${RUN}` }).expect(200);
      // C, outside the group, sees nothing.
      await request(server()).get(`/api/server-profiles/${owned}`).set(bearer(C.token)).expect(404);
    });

    it('stops the group being deleted while it owns a server: 409 GROUP_OWNS_RESOURCES', async () => {
      const res = await request(server()).delete(`/api/groups/${groupId}`).set(bearer(A.token)).expect(409);
      expect(res.body.details.reason).toBe('GROUP_OWNS_RESOURCES');
      expect(res.body.details.counts).toMatchObject({ server_profile: 1 });
    });
  });

  describe('a runbook run on shared servers', () => {
    let runbookId: string;
    let privateServer: string;

    it('is private to its author, then readable and runnable by a grantee, never writable', async () => {
      privateServer = (await createProfile(A, 'private').expect(201)).body.data.id;
      runbookId = (await request(server()).post('/api/runbooks').set(bearer(A.token)).send({ name: `rb-${RUN}-shared`, definition: DEF }).expect(201)).body.data.id;
      await request(server()).get(`/api/runbooks/${runbookId}`).set(bearer(C.token)).expect(404);
      const outsiderList = await request(server()).get('/api/runbooks').set(bearer(C.token)).expect(200);
      expect(outsiderList.body.data.items.map((r: { id: string }) => r.id)).not.toContain(runbookId);

      await share(A, 'runbook', runbookId, 'runner', { kind: 'user', userId: B.userId }).expect(201);
      const got = await request(server()).get(`/api/runbooks/${runbookId}`).set(bearer(B.token)).expect(200);
      expect(got.body.data.access).toMatchObject({ role: 'runner', via: 'user_grant', shared: true });
      expect(got.body.data.access.can).toEqual({ run: true, write: false, share: false });
      const list = await request(server()).get('/api/runbooks?filter=shared').set(bearer(B.token)).expect(200);
      expect(list.body.data.items.map((r: { id: string }) => r.id)).toContain(runbookId);

      await request(server()).put(`/api/runbooks/${runbookId}/definition`).set(bearer(B.token)).set('If-Match', '"v1"').send({ definition: DEF }).expect(404);
      await request(server()).patch(`/api/runbooks/${runbookId}`).set(bearer(B.token)).send({ name: 'x' }).expect(404);
      await request(server()).delete(`/api/runbooks/${runbookId}`).set(bearer(B.token)).expect(404);
      await share(B, 'runbook', runbookId, 'viewer', { kind: 'user', userId: C.userId }).expect(404);
    });

    it('runs only where the runner may connect: another target is a per-target forbidden, not a failure', async () => {
      // B may connect to the group-owned server (editor in the group) but not to A's private one.
      const preview = await request(server())
        .post('/api/runbooks/targets/preview')
        .set(bearer(B.token))
        .send({ selector: { serverIds: [privateServer] } })
        .expect(200);
      expect(preview.body.data.servers).toEqual([]);
      expect(preview.body.data.skipped).toEqual([{ serverProfileId: privateServer, reason: 'forbidden' }]);

      const owner = await request(server())
        .post('/api/runbooks/targets/preview')
        .set(bearer(A.token))
        .send({ selector: { serverIds: [privateServer] } })
        .expect(200);
      expect(owner.body.data.servers.map((s: { id: string }) => s.id)).toEqual([privateServer]);

      // A tag never reveals a server the caller cannot even read.
      await request(server()).patch(`/api/server-profiles/${privateServer}`).set(bearer(A.token)).send({ tags: [`tag-${RUN}`] }).expect(200);
      const byTag = await request(server())
        .post('/api/runbooks/targets/preview')
        .set(bearer(C.token))
        .send({ selector: { tags: { any: [`tag-${RUN}`], all: [] } } })
        .expect(200);
      expect(byTag.body.data).toMatchObject({ servers: [], skipped: [] });
    });

    it('requires `run` on the runbook before any run is enqueued', async () => {
      const runbooks = context.app.get(RunbooksService);
      await expect(runbooks.requireRun(principalOf(B), runbookId)).resolves.toBeUndefined();
      await expect(runbooks.requireRun(principalOf(C), runbookId)).rejects.toBeInstanceOf(NotFoundException);
      // A reader may see the runbook but not run it.
      await share(A, 'runbook', runbookId, 'viewer', { kind: 'user', userId: D.userId }).expect(201);
      await request(server()).get(`/api/runbooks/${runbookId}`).set(bearer(D.token)).expect(200);
      await expect(runbooks.requireRun(principalOf(D), runbookId)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('deleting a server profile', () => {
    it('removes every grant on it in the same transaction', async () => {
      const doomed = (await createProfile(A, 'doomed').expect(201)).body.data.id;
      await share(A, 'server_profile', doomed, 'viewer', { kind: 'user', userId: D.userId }).expect(201);
      await share(A, 'server_profile', doomed, 'operator', { kind: 'group', groupId }).expect(201);
      expect(await bypass((tx) => tx.grant.count({ where: { resourceType: 'server_profile', resourceId: doomed } }))).toBe(2);

      await request(server()).delete(`/api/server-profiles/${doomed}`).set(bearer(A.token)).expect(204);

      expect(await bypass((tx) => tx.grant.count({ where: { resourceType: 'server_profile', resourceId: doomed } }))).toBe(0);
      await request(server()).get(`/api/server-profiles/${doomed}`).set(bearer(D.token)).expect(404);
    });
  });
});
