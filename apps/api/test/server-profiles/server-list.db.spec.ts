// =============================================================================
// The Servers page's list, tags and bulk tags over a real database (issue #79)
// =============================================================================
//
// Boots the full `AppModule` against the migrated database and drives the real routes. It proves
// what a mocked client cannot: the filters (text, tags, owner, health, host key) combine over the
// sharing scope (own plus shared, never another user's private profile), the sorts order real rows,
// a connection test stores its outcome, and a bulk tag change reports the ids the caller may not
// change instead of failing.
//
// Run with `npm run test:db` (as the bootstrap superuser, then as the application role).
// =============================================================================

import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';

import { closeTestApp, createTestApp, TestContext } from '../helpers/test-app.helper';

const RUN = randomBytes(4).toString('hex');
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const SECRET = `FAKE-SSH-PASSWORD-${RUN}`;
// Tags unique to this run, so rows another spec left behind never match.
const T = (tag: string) => `${tag}-${RUN}`;

interface Person {
  token: string;
  userId: string;
  orgId: string;
}

interface Row {
  id: string;
  name: string;
  health: string;
  hostKeyState: string;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastSessionAt: string | null;
}

describe('Server list filters, tags and bulk tags (real database)', () => {
  let context: TestContext;
  const emails: string[] = [];
  const server = () => context.app.getHttpServer();
  const bypass = (fn: (tx: any) => Promise<any>): Promise<any> =>
    context.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
      return fn(tx);
    });

  let A: Person; // the caller
  let B: Person; // another user: shares one profile with A, keeps one private
  const ids: Record<string, string> = {};

  async function login(name: string): Promise<Person> {
    const email = `${name}-${RUN}@example.test`;
    emails.push(email);
    const res = await request(server()).post('/api/auth/test/login').send({ email, role: 'contributor' }).expect(302);
    const token = new URL(res.headers.location).searchParams.get('token') as string;
    const me = await request(server()).get('/api/auth/me').set(bearer(token)).expect(200);
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as { org: string };
    return { token, userId: me.body.data.id as string, orgId: claims.org };
  }

  const create = async (person: Person, key: string, tags: string[], extra: Record<string, unknown> = {}) => {
    const res = await request(server())
      .post('/api/server-profiles')
      .set(bearer(person.token))
      .send({
        name: `${key}-${RUN}`,
        hostname: `${key}.example.test`,
        port: 22,
        username: 'ops',
        authMethod: 'password',
        password: SECRET,
        tags,
        ...extra,
      })
      .expect(201);
    ids[key] = res.body.data.id;
  };

  /** The rows of this run the caller sees for a query string, in the order the API returned them. */
  const list = async (person: Person, query = ''): Promise<Row[]> => {
    const res = await request(server())
      .get(`/api/server-profiles?pageSize=100${query ? `&${query}` : ''}`)
      .set(bearer(person.token))
      .expect(200);
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
    return (res.body.data.items as Row[]).filter((row) => row.name.endsWith(`-${RUN}`));
  };
  const names = (rows: Row[]) => rows.map((row) => row.name.replace(`-${RUN}`, ''));

  beforeAll(async () => {
    process.env.SECRETS_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');
    context = await createTestApp({ useMockDatabase: false });
    [A, B] = [await login('lister'), await login('other')];

    await create(A, 'alpha', [T('prod'), T('web')]);
    await create(A, 'bravo', [T('prod')]);
    // Nothing listens on port 1: the connection test fails at once.
    await create(A, 'charlie', [T('dev')], { hostname: '127.0.0.1', port: 1 });
    await create(B, 'delta', [T('prod')]);
    await create(B, 'echo', [T('private')]);
    await request(server())
      .post('/api/grants')
      .set(bearer(B.token))
      .send({ resourceType: 'server_profile', resourceId: ids.delta, role: 'viewer', grantee: { kind: 'user', userId: A.userId } })
      .expect(201);
  }, 120_000);

  afterAll(async () => {
    await bypass(async (tx) => {
      await tx.grant.deleteMany({ where: { resourceType: 'server_profile', resourceId: { in: Object.values(ids) } } });
      await tx.terminalSession.deleteMany({ where: { serverProfileId: { in: Object.values(ids) } } });
      await tx.serverProfile.deleteMany({ where: { name: { endsWith: `-${RUN}` } } });
    });
    await context.prisma.user.deleteMany({ where: { email: { in: emails } } });
    await closeTestApp(context);
  }, 60_000);

  it('lists own plus shared, never another user\'s private profile', async () => {
    expect(names(await list(A, 'sort=name'))).toEqual(['alpha', 'bravo', 'charlie', 'delta']);
    expect(names(await list(A, 'owner=me&sort=name'))).toEqual(['alpha', 'bravo', 'charlie']);
    expect(names(await list(A, 'owner=shared'))).toEqual(['delta']);
  });

  it('filters by text over the name, hostname and username', async () => {
    expect(names(await list(A, `q=bravo-${RUN}`))).toEqual(['bravo']);
    expect(names(await list(A, 'q=127.0.0.1'))).toEqual(['charlie']);
    // The older spelling still works.
    expect(names(await list(A, `search=alpha-${RUN}`))).toEqual(['alpha']);
  });

  it('filters by tags, every one of them, over the shared scope', async () => {
    expect(names(await list(A, `tag=${T('prod')}&sort=name`))).toEqual(['alpha', 'bravo', 'delta']);
    expect(names(await list(A, `tag=${T('prod')}&tag=${T('web')}`))).toEqual(['alpha']);
    expect(await list(A, `tag=${T('private')}`)).toEqual([]);
  });

  it('refuses a malformed owner or health', async () => {
    await request(server()).get('/api/server-profiles?owner=group:not-a-uuid').set(bearer(A.token)).expect(400);
    await request(server()).get('/api/server-profiles?health=sideways').set(bearer(A.token)).expect(400);
  });

  it('stores a failed connection test and filters by health with the tags', async () => {
    const before = await list(A, `q=charlie-${RUN}`);
    expect(before[0]).toMatchObject({ health: 'unknown', lastTestAt: null, lastTestOk: null });

    const res = await request(server()).post(`/api/server-profiles/${ids.charlie}/test`).set(bearer(A.token)).expect(200);
    expect(res.body.data.success).toBe(false);

    const [after] = await list(A, `q=charlie-${RUN}`);
    expect(after).toMatchObject({ health: 'unreachable', lastTestOk: false });
    expect(after.lastTestAt).not.toBeNull();

    expect(names(await list(A, `tag=${T('dev')}&health=unreachable`))).toEqual(['charlie']);
    expect(await list(A, `tag=${T('prod')}&health=unreachable`)).toEqual([]);
    expect(names(await list(A, 'health=unknown&sort=name'))).toEqual(['alpha', 'bravo', 'delta']);

    await bypass((tx) => tx.serverProfile.update({ where: { id: ids.bravo }, data: { lastTestAt: new Date(), lastTestOk: true } }));
    expect(names(await list(A, 'health=reachable'))).toEqual(['bravo']);
    // asc: unreachable, reachable, then never tested.
    expect(names(await list(A, 'sort=health&order=asc'))).toEqual(['charlie', 'bravo', 'alpha', 'delta']);
  });

  it('filters by host-key state', async () => {
    expect(names(await list(A, 'hostKey=untrusted&sort=name'))).toEqual(['alpha', 'bravo', 'charlie', 'delta']);
    await bypass((tx) => tx.serverProfile.update({ where: { id: ids.alpha }, data: { fingerprint: 'SHA256:fake-alpha' } }));
    expect(names(await list(A, 'hostKey=trusted'))).toEqual(['alpha']);
    await bypass((tx) => tx.serverProfile.update({ where: { id: ids.alpha }, data: { lastTestCode: 'HOST_KEY_MISMATCH' } }));
    expect(names(await list(A, 'hostKey=mismatch'))).toEqual(['alpha']);
    expect(await list(A, 'hostKey=trusted')).toEqual([]);
    expect((await list(A, 'hostKey=mismatch'))[0].hostKeyState).toBe('mismatch');
  });

  it('sorts by the caller\'s own last session, never-used last', async () => {
    const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000);
    await bypass(async (tx) => {
      for (const [key, userId, minutesAgo] of [
        ['bravo', A.userId, 5],
        ['charlie', A.userId, 60],
        // B's session on the profile B shared: not A's activity.
        ['delta', B.userId, 1],
      ] as const) {
        await tx.terminalSession.create({
          data: {
            userId,
            orgId: A.orgId,
            serverProfileId: ids[key],
            name: `s-${key}`,
            tmuxSessionId: `tmux-${randomUUID()}`,
            status: 'terminated',
            lastActivityAt: at(minutesAgo),
          },
        });
      }
    });
    const rows = await list(A, 'sort=lastSession&order=desc');
    expect(names(rows)).toEqual(['bravo', 'charlie', 'alpha', 'delta']);
    expect(rows.find((row) => row.name.startsWith('delta'))?.lastSessionAt).toBeNull();
    expect(names(await list(A, 'sort=lastSession&order=asc'))).toEqual(['charlie', 'bravo', 'alpha', 'delta']);
  });

  it('lists the distinct visible tags', async () => {
    const res = await request(server()).get('/api/server-profiles/tags').set(bearer(A.token)).expect(200);
    const tags = (res.body.data.tags as string[]).filter((tag) => tag.endsWith(RUN));
    expect(tags).toEqual([T('dev'), T('prod'), T('web')]);
  });

  describe('bulk tags', () => {
    it('changes what the caller may write and reports the rest', async () => {
      const missing = randomUUID();
      const res = await request(server())
        .patch('/api/server-profiles/bulk-tags')
        .set(bearer(A.token))
        .send({ ids: [ids.alpha, ids.bravo, ids.delta, ids.echo, missing], add: [T('ops')], remove: [T('web')] })
        .expect(200);
      expect(res.body.data.updated.sort()).toEqual([ids.alpha, ids.bravo].sort());
      expect(res.body.data.unchanged).toEqual([]);
      // delta is shared read-only, echo is private to B, the last does not exist.
      expect(res.body.data.denied.sort()).toEqual([ids.delta, ids.echo, missing].sort());

      const rows = await bypass((tx) =>
        tx.serverProfile.findMany({ where: { id: { in: [ids.alpha, ids.delta, ids.echo] } }, select: { id: true, tags: true } }),
      );
      const tagsOf = (id: string) => rows.find((row: { id: string }) => row.id === id).tags;
      expect(tagsOf(ids.alpha)).toEqual([T('prod'), T('ops')]);
      expect(tagsOf(ids.delta)).toEqual([T('prod')]);
      expect(tagsOf(ids.echo)).toEqual([T('private')]);

      const events = await bypass((tx) =>
        tx.auditEvent.findMany({ where: { action: 'server_profile.update', targetId: { in: [ids.alpha, ids.bravo] } } }),
      );
      expect(events.filter((event: { meta: { bulk?: boolean } }) => event.meta?.bulk)).toHaveLength(2);
    });

    it('reports a profile that already has the tags as unchanged', async () => {
      const res = await request(server())
        .patch('/api/server-profiles/bulk-tags')
        .set(bearer(A.token))
        .send({ ids: [ids.alpha], add: [T('ops')] })
        .expect(200);
      expect(res.body.data).toEqual({ updated: [], unchanged: [ids.alpha], denied: [] });
    });

    it('refuses more than 200 ids and an empty change', async () => {
      const many = Array.from({ length: 201 }, () => randomUUID());
      await request(server()).patch('/api/server-profiles/bulk-tags').set(bearer(A.token)).send({ ids: many, add: ['x'] }).expect(400);
      await request(server()).patch('/api/server-profiles/bulk-tags').set(bearer(A.token)).send({ ids: [ids.alpha] }).expect(400);
    });
  });
});
