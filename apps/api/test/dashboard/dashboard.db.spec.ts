// =============================================================================
// The Home dashboard summary over a real database (issue #78)
// =============================================================================
//
// Boots the full `AppModule` against the migrated and seeded database and drives the real route
// with real users. It proves what a mocked client cannot: the counts cover exactly what the
// caller may see through the sharing slice (their own servers, servers shared with them, never
// another user's), sessions are the caller's own, untrusted host keys are counted, and `runs` is
// `null` without `runbooks:read`; with it the runs come from the runbook engine's source (#62): the runs the caller
// started or may read through a shared runbook, counted the way the Runs list they link to counts them.
//
// Run with `npm run test:db`.
// =============================================================================

import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';

import { DashboardService } from '../../src/dashboard/dashboard.service';
import { actingPrincipal } from '../../src/platform/sharing/sharing-access';
import { resolveDbSuite } from '../helpers/db-test-support';
import { closeTestApp, createTestApp, TestContext } from '../helpers/test-app.helper';

const { describeWithDb } = resolveDbSuite('dashboard.db.spec');
const RUN = randomBytes(4).toString('hex');
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

interface Person {
  email: string;
  token: string;
  userId: string;
  orgId: string;
  permissions: string[];
}

describeWithDb('Home dashboard summary (real database)', () => {
  let context: TestContext;
  const emails: string[] = [];
  const server = () => context.app.getHttpServer();
  const bypass = (fn: (tx: any) => Promise<any>): Promise<any> =>
    context.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
      return fn(tx);
    });

  let A: Person; // owns three servers, shares one with B
  let B: Person; // owns one server, sees A's shared one
  let C: Person; // owns nothing, sees nothing
  const profiles: Record<string, string> = {};

  async function login(name: string, role = 'contributor'): Promise<Person> {
    const email = `dash-${name}-${RUN}@example.test`;
    emails.push(email);
    const res = await request(server()).post('/api/auth/test/login').send({ email, role }).expect(302);
    const token = new URL(res.headers.location).searchParams.get('token') as string;
    const me = await request(server()).get('/api/auth/me').set(bearer(token)).expect(200);
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as { org: string };
    return { email, token, userId: me.body.data.id, orgId: claims.org, permissions: me.body.data.permissions };
  }

  const createProfile = async (person: Person, name: string) => {
    const res = await request(server())
      .post('/api/server-profiles')
      .set(bearer(person.token))
      .send({ name: `${name}-${RUN}`, hostname: `${name}.example.test`, port: 22, username: 'ops', authMethod: 'password', password: `FAKE-${RUN}` })
      .expect(201);
    profiles[name] = res.body.data.id;
    return res.body.data.id as string;
  };

  const addSession = (person: Person, profileId: string, name: string, status: 'active' | 'detached' | 'terminated', minutesAgo: number) =>
    bypass((tx) =>
      tx.terminalSession.create({
        data: {
          userId: person.userId,
          orgId: person.orgId,
          serverProfileId: profileId,
          name: `${name}-${RUN}`,
          status,
          tmuxSessionId: `sk-${name}-${RUN}`,
          lastActivityAt: new Date(Date.now() - minutesAgo * 60_000),
          terminatedAt: status === 'terminated' ? new Date() : null,
        },
      }),
    );

  const summaryOf = async (person: Person) =>
    (await request(server()).get('/api/dashboard/summary').set(bearer(person.token)).expect(200)).body.data;

  beforeAll(async () => {
    process.env.SECRETS_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');
    context = await createTestApp({ useMockDatabase: false });
    [A, B, C] = [await login('a'), await login('b'), await login('c', 'viewer')];

    await createProfile(A, 'server-a1');
    await createProfile(A, 'server-a2');
    const shared = await createProfile(A, 'server-a3');
    await createProfile(B, 'server-b1');
    // One of A's servers has a trusted host key; the other two do not.
    await bypass((tx) =>
      tx.serverProfile.update({
        where: { id: profiles['server-a1'] },
        data: { fingerprint: 'SHA256:fake-fingerprint', hostKeyAlgorithm: 'ssh-ed25519', hostKeyTrustedAt: new Date() },
      }),
    );
    await request(server())
      .post('/api/grants')
      .set(bearer(A.token))
      .send({ resourceType: 'server_profile', resourceId: shared, role: 'viewer', grantee: { kind: 'user', userId: B.userId } })
      .expect(201);

    for (let i = 0; i < 6; i += 1) await addSession(A, profiles['server-a1'], `a-live-${i}`, i % 2 ? 'detached' : 'active', i);
    await addSession(A, profiles['server-a2'], 'a-gone', 'terminated', 0);
    await addSession(B, profiles['server-b1'], 'b-live', 'detached', 1);
  }, 120_000);

  afterAll(async () => {
    await bypass(async (tx) => {
      await tx.runbook.deleteMany({ where: { name: { endsWith: `-${RUN}` } } });
      await tx.terminalSession.deleteMany({ where: { name: { endsWith: `-${RUN}` } } });
      await tx.grant.deleteMany({ where: { resourceId: { in: Object.values(profiles) } } });
      await tx.serverProfile.deleteMany({ where: { name: { endsWith: `-${RUN}` } } });
    });
    await context.prisma.user.deleteMany({ where: { email: { in: emails } } });
    await closeTestApp(context);
  }, 60_000);

  it("counts the owner's servers, with the untrusted host keys, and every untested one as unknown", async () => {
    const { servers } = await summaryOf(A);
    expect(servers).toEqual({ total: 3, reachable: 0, unreachable: 0, unknown: 3, hostKeyUntrusted: 2 });
  });

  it('counts reachability from the stored connection-test outcome (#79)', async () => {
    await bypass(async (tx) => {
      await tx.serverProfile.update({ where: { id: profiles['server-a1'] }, data: { lastTestAt: new Date(), lastTestOk: true } });
      await tx.serverProfile.update({ where: { id: profiles['server-a2'] }, data: { lastTestAt: new Date(), lastTestOk: false } });
    });
    try {
      const { servers } = await summaryOf(A);
      expect(servers).toEqual({ total: 3, reachable: 1, unreachable: 1, unknown: 1, hostKeyUntrusted: 2 });
    } finally {
      await bypass((tx) =>
        tx.serverProfile.updateMany({
          where: { id: { in: [profiles['server-a1'], profiles['server-a2']] } },
          data: { lastTestAt: null, lastTestOk: null },
        }),
      );
    }
  });

  it('counts a server shared with the caller, and never another user\'s unshared ones', async () => {
    const { servers } = await summaryOf(B);
    // server-b1 (own) plus server-a3 (shared); server-a1 and server-a2 stay out.
    expect(servers).toEqual({ total: 2, reachable: 0, unreachable: 0, unknown: 2, hostKeyUntrusted: 2 });
  });

  it('shows nothing of anyone else to an outsider', async () => {
    const summary = await summaryOf(C);
    expect(summary.servers).toEqual({ total: 0, reachable: 0, unreachable: 0, unknown: 0, hostKeyUntrusted: 0 });
    expect(summary.sessions).toEqual({ active: 0, attached: 0, detached: 0, recent: [] });
  });

  it("lists the caller's own live sessions, five at most, newest first, never a terminated one", async () => {
    const { sessions } = await summaryOf(A);
    expect(sessions).toMatchObject({ active: 6, attached: 3, detached: 3 });
    expect(sessions.recent.map((s: { name: string }) => s.name)).toEqual([0, 1, 2, 3, 4].map((i) => `a-live-${i}-${RUN}`));
    expect(sessions.recent[0]).toMatchObject({ serverProfileId: profiles['server-a1'], serverName: `server-a1-${RUN}` });
    expect(JSON.stringify(sessions)).not.toContain('example.test');

    const other = await summaryOf(B);
    expect(other.sessions.active).toBe(1);
    expect(other.sessions.recent.map((s: { name: string }) => s.name)).toEqual([`b-live-${RUN}`]);
  });

  it('answers runs: null without runbooks:read, and empty counts with it before any run exists', async () => {
    expect(A.permissions).toContain('runbooks:read');
    expect((await summaryOf(A)).runs).toEqual({ running: 0, failedLast24h: 0, recent: [] });

    const service = context.app.get(DashboardService);
    const withoutRunbooks = actingPrincipal({
      userId: A.userId,
      orgId: A.orgId,
      permissions: A.permissions.filter((p) => p !== 'runbooks:read'),
      roles: [],
    });
    const summary = await service.summary(withoutRunbooks);
    expect(summary.runs).toBeNull();
    expect(summary.servers?.total).toBe(3);
  });

  it('summarizes the runs the caller started or may read, and nobody else’s', async () => {
    const own = randomUUID();
    const shared = randomUUID();
    const hidden = randomUUID();
    const hours = (n: number) => new Date(Date.now() - n * 3_600_000);
    const runIds: string[] = [];
    await bypass(async (tx) => {
      for (const [id, owner, name] of [[own, A.userId, 'own'], [shared, B.userId, 'shared'], [hidden, B.userId, 'hidden']] as const) {
        await tx.runbook.create({ data: { id, orgId: A.orgId, ownerUserId: owner, name: `rb-${name}-${RUN}` } });
        await tx.runbookVersion.create({
          data: { orgId: A.orgId, runbookId: id, version: 1, definition: { schemaVersion: 1, steps: [] }, definitionSha256: 'a'.repeat(64), createdBy: owner },
        });
      }
      // [runbook, started by, status, created hours ago, target statuses]
      const runs: Array<[string, string, string, number, string[]]> = [
        [own, A.userId, 'running', 1, ['succeeded', 'running', 'failed']],
        [own, A.userId, 'failed', 2, ['failed']],
        [own, A.userId, 'failed', 30, ['failed']], // failed, but queued before the 24h window
        [own, A.userId, 'succeeded', 3, ['succeeded']],
        [shared, B.userId, 'running', 4, ['running', 'queued']], // B's run of a runbook shared with A
        [hidden, B.userId, 'running', 5, ['running']], // B's private runbook: A sees nothing of it
        [hidden, B.userId, 'failed', 6, ['failed']],
      ];
      for (const [runbookId, owner, status, ago, targets] of runs) {
        const id = randomUUID();
        runIds.push(id);
        await tx.runbookRun.create({
          data: { id, orgId: A.orgId, runbookId, version: 1, initiatedBy: owner, status, createdAt: hours(ago), startedAt: hours(ago), params: {}, secretRefs: {}, targetSelector: {}, strategy: {} },
        });
        for (const [position, targetStatus] of targets.entries()) {
          await tx.runbookRunTarget.create({
            data: { orgId: A.orgId, runId: id, position, serverName: `t${position}-${RUN}`, hostname: 'h.example.test', port: 22, username: 'ops', status: targetStatus },
          });
        }
      }
    });
    await request(server())
      .post('/api/grants')
      .set(bearer(B.token))
      .send({ resourceType: 'runbook', resourceId: shared, role: 'viewer', grantee: { kind: 'user', userId: A.userId } })
      .expect(201);

    const { runs } = await summaryOf(A);
    expect(runs).toMatchObject({ running: 2, failedLast24h: 1 });
    // Newest first: own running (1h), own failed (2h), own succeeded (3h), shared running (4h), own failed (30h).
    expect(runs!.recent.map((r: { runbookName: string; status: string }) => [r.runbookName, r.status])).toEqual([
      [`rb-own-${RUN}`, 'running'],
      [`rb-own-${RUN}`, 'failed'],
      [`rb-own-${RUN}`, 'succeeded'],
      [`rb-shared-${RUN}`, 'running'],
      [`rb-own-${RUN}`, 'failed'],
    ]);
    expect(runs!.recent[0]).toMatchObject({ targets: { total: 3, succeeded: 1, failed: 1, running: 1 } });
    expect(runs!.recent[3]).toMatchObject({ targets: { total: 2, succeeded: 0, failed: 0, running: 2 } });
    expect(runs!.recent.map((r: { runbookName: string; status: string }) => r.runbookName)).not.toContain(`rb-hidden-${RUN}`);

    // The tiles count what the Runs list they link to lists.
    const listed = async (query: string) =>
      (await request(server()).get(`/api/runbook-runs?${query}`).set(bearer(A.token)).expect(200)).body.data.total as number;
    expect(await listed('status=running')).toBe(runs!.running);
    expect(await listed('status=failed&since=24h')).toBe(runs!.failedLast24h);

    // An outsider with no runs and no share sees nothing, and B sees B's own runs and no one else's private ones.
    expect((await summaryOf(C)).runs).toEqual({ running: 0, failedLast24h: 0, recent: [] });
    const b = (await summaryOf(B)).runs!;
    expect(b.running).toBe(2);
    expect(b.failedLast24h).toBe(1);
    expect(b.recent.map((r: { runbookName: string; status: string }) => r.runbookName)).not.toContain(`rb-own-${RUN}`);
    void runIds;
  }, 60_000);

  it('answers servers: null for a caller without servers:read', async () => {
    const service = context.app.get(DashboardService);
    const summary = await service.summary(
      actingPrincipal({ userId: A.userId, orgId: A.orgId, permissions: ['sessions:read'], roles: [] }),
    );
    expect(summary.servers).toBeNull();
    expect(summary.sessions.active).toBe(6);
  });
});
