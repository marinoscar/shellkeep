// =============================================================================
// Onboarding over a real database (issue #70)
// =============================================================================
//
// Boots the full `AppModule` against the migrated and seeded database and drives
// `GET /api/onboarding` with real users. It proves what the unit tests cannot:
//
//   - a fresh user gets ShellKeep's steps in order, all `todo`;
//   - adding a server, trusting its host key and opening a session flips the first
//     three to `done` on the next read, with no restart (facts are derived per request);
//   - every fact is USER-SCOPED: another user's servers, sessions and runbooks never
//     complete a step for the caller (the runbook count runs under forced RLS);
//   - `shellkeep.add-ai-key` is present exactly when the AI kill switch is on;
//   - a skip persists in the `onboarding` user-settings namespace, and a required
//     step cannot be skipped;
//   - the activation metrics require `system_settings:read` and report the milestone.
//
// Run with `npm run test:db`.
// =============================================================================

import { randomBytes } from 'node:crypto';
import request from 'supertest';

import { resolveDbSuite } from '../helpers/db-test-support';
import { closeTestApp, createTestApp, TestContext } from '../helpers/test-app.helper';

const { describeWithDb } = resolveDbSuite('onboarding.db.spec');
const RUN = randomBytes(4).toString('hex');
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

const ORDER = [
  'shellkeep.add-server',
  'shellkeep.trust-host-key',
  'shellkeep.open-session',
  'shellkeep.add-ai-key',
  'shellkeep.first-runbook',
];

interface Person {
  email: string;
  token: string;
  userId: string;
  orgId: string;
}

interface StepView {
  id: string;
  status: string;
  skipped: boolean;
}

describeWithDb('onboarding (real database)', () => {
  let context: TestContext;
  const emails: string[] = [];
  const profileIds: string[] = [];
  const server = () => context.app.getHttpServer();
  const bypass = (fn: (tx: any) => Promise<any>): Promise<any> =>
    context.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
      return fn(tx);
    });

  let A: Person;
  let B: Person;
  let aiEnabled = false;

  async function login(name: string, role: 'admin' | 'contributor' = 'contributor'): Promise<Person> {
    const email = `onboard-${name}-${RUN}@example.test`;
    emails.push(email);
    const res = await request(server()).post('/api/auth/test/login').send({ email, role }).expect(302);
    const token = new URL(res.headers.location).searchParams.get('token') as string;
    const me = await request(server()).get('/api/auth/me').set(bearer(token)).expect(200);
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as { org: string };
    return { email, token, userId: me.body.data.id, orgId: claims.org };
  }

  /** The caller's ShellKeep steps, in response order. */
  const shellkeepSteps = async (person: Person): Promise<StepView[]> => {
    const res = await request(server()).get('/api/onboarding').set(bearer(person.token)).expect(200);
    return (res.body.data.user.steps as StepView[]).filter((step) => step.id.startsWith('shellkeep.'));
  };
  const statusOf = (steps: StepView[]) => Object.fromEntries(steps.map((step) => [step.id, step.status]));
  const expectedOrder = () => ORDER.filter((id) => aiEnabled || id !== 'shellkeep.add-ai-key');

  beforeAll(async () => {
    process.env.SECRETS_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');
    context = await createTestApp({ useMockDatabase: false });
    [A, B] = [await login('a'), await login('b')];
    const config = await request(server()).get('/api/ai/config').set(bearer(A.token)).expect(200);
    aiEnabled = config.body.data.enabled === true;
  }, 120_000);

  afterAll(async () => {
    await bypass(async (tx) => {
      await tx.terminalSession.deleteMany({ where: { name: { endsWith: `-${RUN}` } } });
      await tx.runbook.deleteMany({ where: { name: { endsWith: `-${RUN}` } } });
      await tx.serverProfile.deleteMany({ where: { id: { in: profileIds } } });
    });
    await context.prisma.user.deleteMany({ where: { email: { in: emails } } });
    await closeTestApp(context);
  }, 60_000);

  it('lists the ShellKeep steps in order, all todo, for a fresh user', async () => {
    const steps = await shellkeepSteps(A);
    expect(steps.map((step) => step.id)).toEqual(expectedOrder());
    expect(steps.every((step) => step.status === 'todo')).toBe(true);
  });

  it('shows the AI key step exactly when AI is on', async () => {
    const ids = (await shellkeepSteps(A)).map((step) => step.id);
    expect(ids.includes('shellkeep.add-ai-key')).toBe(aiEnabled);
  });

  it('flips add-server, trust-host-key and open-session to done without a restart, for that user only', async () => {
    const created = await request(server())
      .post('/api/server-profiles')
      .set(bearer(A.token))
      .send({ name: `srv-${RUN}`, hostname: 'server-a.example.test', port: 22, username: 'ops', authMethod: 'password', password: `FAKE-${RUN}` })
      .expect(201);
    const profileId = created.body.data.id as string;
    profileIds.push(profileId);
    expect(statusOf(await shellkeepSteps(A))).toMatchObject({
      'shellkeep.add-server': 'done',
      'shellkeep.trust-host-key': 'todo',
      'shellkeep.open-session': 'todo',
    });

    // Trusting a host key stores its fingerprint (#60); written directly, as no SSH server answers here.
    await bypass((tx) =>
      tx.serverProfile.update({
        where: { id: profileId },
        data: { fingerprint: 'SHA256:fake-fingerprint', hostKeyAlgorithm: 'ssh-ed25519', hostKeyTrustedAt: new Date() },
      }),
    );
    await bypass((tx) =>
      tx.terminalSession.create({
        data: { userId: A.userId, orgId: A.orgId, serverProfileId: profileId, name: `s-${RUN}`, status: 'terminated', tmuxSessionId: `sk-${RUN}`, terminatedAt: new Date() },
      }),
    );

    expect(statusOf(await shellkeepSteps(A))).toMatchObject({
      'shellkeep.add-server': 'done',
      'shellkeep.trust-host-key': 'done',
      'shellkeep.open-session': 'done',
      'shellkeep.first-runbook': 'todo',
    });
    // B shares the organization but owns none of it.
    expect((await shellkeepSteps(B)).every((step) => step.status === 'todo')).toBe(true);
  });

  it("counts only the caller's own runbooks, under row-level security", async () => {
    await bypass((tx) => tx.runbook.create({ data: { orgId: A.orgId, ownerUserId: A.userId, name: `rb-${RUN}` } }));
    expect(statusOf(await shellkeepSteps(A))['shellkeep.first-runbook']).toBe('done');
    expect(statusOf(await shellkeepSteps(B))['shellkeep.first-runbook']).toBe('todo');
  });

  it('persists a skip in the onboarding namespace and refuses to skip a required step', async () => {
    await request(server())
      .patch('/api/user-settings')
      .set(bearer(B.token))
      .send({ onboarding: { skipped: ['shellkeep.first-runbook'] } })
      .expect(200);
    const res = await request(server()).get('/api/onboarding').set(bearer(B.token)).expect(200);
    expect(res.body.data.settings.skipped).toEqual(['shellkeep.first-runbook']);
    const runbook = (res.body.data.user.steps as StepView[]).find((step) => step.id === 'shellkeep.first-runbook');
    expect(runbook).toMatchObject({ skipped: true, status: 'todo' });

    await request(server())
      .patch('/api/user-settings')
      .set(bearer(B.token))
      .send({ onboarding: { skipped: ['shellkeep.add-server'] } })
      .expect(400);
  });

  it('gates the activation metrics on system_settings:read and reports the first-session milestone', async () => {
    await request(server()).get('/api/admin/onboarding/metrics').set(bearer(A.token)).expect(403);
    const admin = await login('admin', 'admin');
    const res = await request(server()).get('/api/admin/onboarding/metrics').set(bearer(admin.token)).expect(200);
    const body = JSON.stringify(res.body.data);
    expect(body).toContain('shellkeep_first_session_opened');
    // Aggregates only: no hostname reaches the metrics.
    expect(body).not.toContain('example.test');
  });
});
