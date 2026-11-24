// =============================================================================
// Sharing a run's log bundle by link, over a real database (issue #63)
// =============================================================================
//
// Boots the full `AppModule` against the migrated and seeded database and drives the real routes:
//
//   - the initiator of a run creates a link with the sharing slice's own route (`POST /api/grants/links`,
//     type `runbook_run`, default lifetime 7 days);
//   - anyone holding the link downloads the bundle WITHOUT signing in (`GET /api/public/runbook-runs/bundle`
//     with `X-Link-Token`): a presigned URL valid 15 minutes, `Cache-Control: no-store`,
//     `Referrer-Policy: no-referrer`; the route never streams bytes;
//   - an unknown, malformed, missing, revoked or expired link, and a link to a run with no bundle, are ONE
//     404 shape;
//   - somebody who did not start the run cannot create a link (404), and a server profile or a runbook
//     still answers 422 to a link;
//   - the authenticated list and download of the artifacts, audited.
//
// Run with `npm run test:db` (as the bootstrap superuser, then as the application role).
// =============================================================================

import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';

import { closeTestApp, createTestApp, TestContext } from '../helpers/test-app.helper';
import { createMockStorageProvider, installMockStorageProvider } from '../helpers/mock-storage-provider.helper';

const RUN = randomBytes(4).toString('hex');
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

interface Person {
  email: string;
  token: string;
  userId: string;
  orgId: string;
}

describe('Sharing the bundle of a run by link (real database)', () => {
  let context: TestContext;
  const emails: string[] = [];
  const server = () => context.app.getHttpServer();
  const bypass = (fn: (tx: any) => Promise<any>): Promise<any> =>
    context.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
      return fn(tx);
    });
  const storage = createMockStorageProvider();

  let A: Person;
  let B: Person;
  let runbookId: string;
  let runId: string;
  let bareRunId: string;
  let bundleId: string;
  let archiveId: string;

  async function login(name: string): Promise<Person> {
    const email = `${name}-${RUN}@example.test`;
    emails.push(email);
    const res = await request(server()).post('/api/auth/test/login').send({ email, role: 'contributor' }).expect(302);
    const token = new URL(res.headers.location).searchParams.get('token') as string;
    const me = await request(server()).get('/api/auth/me').set(bearer(token)).expect(200);
    const claims = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8')) as { org: string };
    return { email, token, userId: me.body.data.id as string, orgId: claims.org };
  }

  const createLink = (person: Person, resourceId: string, extra: Record<string, unknown> = {}) =>
    request(server()).post('/api/grants/links').set(bearer(person.token)).send({ resourceType: 'runbook_run', resourceId, role: 'viewer', ...extra });

  const publicBundle = (token?: string) => {
    const req = request(server()).get('/api/public/runbook-runs/bundle');
    return token === undefined ? req : req.set('X-Link-Token', token);
  };

  beforeAll(async () => {
    process.env.SECRETS_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');
    context = await createTestApp({ useMockDatabase: false });
    installMockStorageProvider(context, storage);
    storage.getSignedDownloadUrl.mockImplementation(async (key: string) => `https://storage.example.test/${key}?signed=1`);
    [A, B] = [await login('initiator'), await login('stranger')];

    await bypass(async (tx) => {
      const runbook = await tx.runbook.create({ data: { orgId: A.orgId, ownerUserId: A.userId, name: `rb-${RUN}-bundle` } });
      runbookId = runbook.id;
      await tx.runbookVersion.create({
        data: { orgId: A.orgId, runbookId, version: 1, definition: { schemaVersion: 1, steps: [] }, definitionSha256: 'a'.repeat(64) },
      });
      const base = { orgId: A.orgId, runbookId, version: 1, status: 'succeeded', initiatedBy: A.userId, targetSelector: {}, strategy: {}, finishedAt: new Date() };
      runId = (await tx.runbookRun.create({ data: base })).id;
      bareRunId = (await tx.runbookRun.create({ data: base })).id;
      const target = await tx.runbookRunTarget.create({ data: { orgId: A.orgId, runId, position: 0, status: 'succeeded', serverName: 'server-one', hostname: 'host.example.test', port: 22, username: 'ops' } });
      const step = await tx.runbookRunStep.create({ data: { orgId: A.orgId, runId, runTargetId: target.id, stepIndex: 0, stepId: 'logs', kind: 'collect_logs', name: 'Logs', status: 'succeeded' } });
      archiveId = (await tx.runbookArtifact.create({ data: { orgId: A.orgId, runId, runTargetId: target.id, runStepId: step.id, kind: 'target_archive', storageKey: `runbook-artifacts/${A.orgId}/${runId}/${target.id}/0.tar.gz`, fileCount: 2, sizeBytes: 2048n, sha256: 'b'.repeat(64) } })).id;
      bundleId = (await tx.runbookArtifact.create({ data: { orgId: A.orgId, runId, kind: 'bundle', storageKey: `runbook-artifacts/${A.orgId}/${runId}/bundle.zip`, fileCount: 3, sizeBytes: 4096n, sha256: 'c'.repeat(64) } })).id;
    });
  }, 120_000);

  afterAll(async () => {
    await bypass(async (tx) => {
      await tx.grant.deleteMany({ where: { orgId: A.orgId, resourceType: { in: ['runbook_run', 'runbook'] } } });
      await tx.runbookRun.deleteMany({ where: { runbookId } });
      await tx.runbookVersion.deleteMany({ where: { runbookId } });
      await tx.runbook.deleteMany({ where: { id: runbookId } });
      await tx.auditEvent.deleteMany({ where: { targetId: { in: [runId, bundleId, archiveId] } } });
    });
    await context.prisma.user.deleteMany({ where: { email: { in: emails } } });
    await closeTestApp(context);
  }, 60_000);

  describe('creating a link', () => {
    it('is the initiator\'s alone: a stranger gets 404, and a runbook or a server still answers 422', async () => {
      await createLink(B, runId).expect(404);
      await createLink(A, randomUUID()).expect(404);
      await request(server()).post('/api/grants/links').set(bearer(A.token)).send({ resourceType: 'runbook', resourceId: runbookId, role: 'viewer' }).expect(422);
    });

    it('defaults to a lifetime of 7 days, is capped at 30, and is audited without the token', async () => {
      const res = await createLink(A, runId).expect(201);
      const days = (new Date(res.body.data.grant.expiresAt).getTime() - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(6.9);
      expect(days).toBeLessThan(7.1);
      const capped = await createLink(A, runId, { expiresAt: new Date(Date.now() + 90 * 86_400_000).toISOString() }).expect(201);
      expect((new Date(capped.body.data.grant.expiresAt).getTime() - Date.now()) / 86_400_000).toBeLessThan(30.1);

      const audit = await bypass((tx) => tx.auditEvent.findMany({ where: { action: 'runbook_artifact.link_created', targetId: runId } }));
      expect(audit.length).toBeGreaterThanOrEqual(2);
      expect(JSON.stringify(audit)).not.toContain(res.body.data.token);
      await request(server()).delete(`/api/grants/${capped.body.data.grant.id}`).set(bearer(A.token)).expect(204);
    });
  });

  describe('opening a link without signing in', () => {
    let token: string;
    let grantId: string;

    beforeAll(async () => {
      const res = await createLink(A, runId).expect(201);
      token = res.body.data.token;
      grantId = res.body.data.grant.id;
    });

    it('answers metadata and a presigned URL, never bytes, with no-store headers', async () => {
      const res = await publicBundle(token).expect(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      expect(res.body.data).toMatchObject({
        runbook: `rb-${RUN}-bundle`,
        sizeBytes: 4096,
        url: `https://storage.example.test/runbook-artifacts/${A.orgId}/${runId}/bundle.zip?signed=1`,
      });
      expect(res.body.data.finishedAt).toEqual(expect.any(String));
      expect(storage.getSignedDownloadUrl).toHaveBeenLastCalledWith(
        `runbook-artifacts/${A.orgId}/${runId}/bundle.zip`,
        expect.objectContaining({ expiresIn: 900 }),
      );
      // the token of a link grants the bundle route and nothing else
      await request(server()).get(`/api/runbook-runs/${runId}/artifacts`).set('X-Link-Token', token).expect(401);
    });

    it('answers ONE 404 for no token, a malformed one, an unknown one and a link with no bundle', async () => {
      const bare = (await createLink(A, bareRunId).expect(201)).body.data.token as string;
      const shapes = [];
      for (const attempt of [undefined, 'nonsense', `lnk_${randomBytes(32).toString('base64url')}`, bare]) {
        const res = await publicBundle(attempt).expect(404);
        expect(res.headers['cache-control']).toBe('no-store');
        shapes.push(res.body);
      }
      expect(new Set(shapes.map((body) => JSON.stringify({ code: body.code, message: body.message }))).size).toBe(1);
    });

    it('stops working when it expires, and when it is revoked', async () => {
      const expiring = await createLink(A, runId).expect(201);
      await publicBundle(expiring.body.data.token).expect(200);
      await bypass((tx) => tx.grant.update({ where: { id: expiring.body.data.grant.id }, data: { expiresAt: new Date(Date.now() - 60_000) } }));
      await publicBundle(expiring.body.data.token).expect(404);

      await publicBundle(token).expect(200);
      await request(server()).delete(`/api/grants/${grantId}`).set(bearer(A.token)).expect(204);
      await publicBundle(token).expect(404);
    });
  });

  describe('the authenticated routes', () => {
    it('lists the archives and the bundle state, and 404s for somebody who may not see the run', async () => {
      const res = await request(server()).get(`/api/runbook-runs/${runId}/artifacts`).set(bearer(A.token)).expect(200);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0]).toMatchObject({ id: archiveId, kind: 'target_archive', serverName: 'server-one', stepId: 'logs', fileCount: 2, sizeBytes: 2048 });
      expect(res.body.data.bundle).toMatchObject({ status: 'ready', artifactId: bundleId, sizeBytes: 4096 });
      await request(server()).get(`/api/runbook-runs/${runId}/artifacts`).set(bearer(B.token)).expect(404);
    });

    it('signs a 15 minute download and audits it', async () => {
      const res = await request(server()).get(`/api/runbook-runs/${runId}/artifacts/${bundleId}/download`).set(bearer(A.token)).expect(200);
      expect(res.body.data.url).toContain(`/${runId}/bundle.zip`);
      expect(new Date(res.body.data.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(15 * 60_000);
      const audit = await bypass((tx) => tx.auditEvent.findMany({ where: { action: 'runbook_artifact.downloaded', targetId: bundleId } }));
      expect(audit).toHaveLength(1);
      await request(server()).get(`/api/runbook-runs/${runId}/artifacts/${bundleId}/download`).set(bearer(B.token)).expect(404);
      await request(server()).get(`/api/runbook-runs/${runId}/artifacts/${randomUUID()}/download`).set(bearer(A.token)).expect(404);
    });

    it('answers the existing bundle instead of building a second, and refuses a run that has not finished', async () => {
      const res = await request(server()).post(`/api/runbook-runs/${runId}/artifacts/bundle`).set(bearer(A.token)).expect(202);
      expect(res.body.data).toEqual({ jobId: null, artifactId: bundleId });
      const running = await bypass((tx) =>
        tx.runbookRun.create({ data: { orgId: A.orgId, runbookId, version: 1, status: 'running', initiatedBy: A.userId, targetSelector: {}, strategy: {} } }),
      );
      await request(server()).post(`/api/runbook-runs/${running.id}/artifacts/bundle`).set(bearer(A.token)).expect(409);
      const queued = await request(server()).post(`/api/runbook-runs/${bareRunId}/artifacts/bundle`).set(bearer(A.token)).expect(202);
      expect(queued.body.data.jobId).toEqual(expect.any(String));
      const again = await request(server()).post(`/api/runbook-runs/${bareRunId}/artifacts/bundle`).set(bearer(A.token)).expect(202);
      expect(again.body.data.jobId).toBe(queued.body.data.jobId);
      await bypass((tx) => tx.job.deleteMany({ where: { id: queued.body.data.jobId } }));
    });
  });
});
