// =============================================================================
// ShellKeep's user-data routes over HTTP (issue #69)
// =============================================================================
//
// The platform's own route behaviour (401, the saas gate, offboarding) is proven in the package. This
// spec proves what ShellKeep adds, against the booted `AppModule` with a mocked database:
//
//   GET  /api/user-data/summary          the three ShellKeep categories with the caller's counts, both
//                                        narrow scopes with their phrases;
//   POST /api/user-data/deletions        scope `servers` with `SERVERS` (and `runbooks` with `RUNBOOKS`)
//                                        enqueues `user.data.purge`; a wrong phrase is a 400 and queues nothing;
//   /api/admin/factory-reset/*           `system:factory_reset` is Admin only (a viewer is refused), and the
//                                        summary lists the ShellKeep steps' lines;
//   the exact permission of every route.
// =============================================================================

import request from 'supertest';
import { JobsService } from '@marinoscar/platform-api/jobs';

import { userDataControllers } from '../../src/platform/user-data/user-data.config';
import { TestContext, createTestApp, closeTestApp } from '../helpers/test-app.helper';
import { prismaMock, resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { authHeader, createMockAdminUser, createMockViewerUser } from '../helpers/auth-mock.helper';

const JOB_ID = '7a1d1f0e-0000-4000-8000-000000000069';

function routePermissions(controller: object, method: string): string[] {
  const handler = (controller as { prototype: Record<string, unknown> }).prototype[method] as object;
  const keys = Reflect.getMetadataKeys(handler) as string[];
  const found = keys.map((key) => Reflect.getMetadata(key, handler)).find((value) => Array.isArray(value) && value.every((v) => typeof v === 'string' && v.includes(':')));
  return (found as string[] | undefined) ?? [];
}

describe('ShellKeep user-data routes', () => {
  let context: TestContext;
  let enqueue: jest.SpyInstance;
  const server = () => context.app.getHttpServer();

  beforeAll(async () => {
    context = await createTestApp({ useMockDatabase: true });
  }, 60_000);

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(() => {
    resetPrismaMock();
    setupBaseMocks();
    enqueue = jest.spyOn(context.app.get(JobsService), 'enqueue').mockResolvedValue({ id: JOB_ID, status: 'pending' } as never);
  });

  afterEach(() => enqueue.mockRestore());

  it('declares the exact permission on every route: none of ShellKeep’s own, and never system_settings:write for the reset', () => {
    const { UserDataController, FactoryResetController } = userDataControllers;
    for (const method of ['summary', 'request', 'status']) {
      expect(routePermissions(UserDataController!, method)).toEqual(['user_settings:write']);
      expect(routePermissions(FactoryResetController!, method)).toEqual(['system:factory_reset']);
    }
  });

  describe('GET /api/user-data/summary', () => {
    it('lists the three ShellKeep categories with the caller’s counts, and both narrow scopes', async () => {
      const viewer = await createMockViewerUser(context);
      (prismaMock.serverProfile.count as jest.Mock).mockResolvedValue(3);
      (prismaMock.terminalSession.count as jest.Mock).mockResolvedValue(5);
      (prismaMock.runbook.count as jest.Mock).mockResolvedValue(2);

      const response = await request(server()).get('/api/user-data/summary').set(authHeader(viewer.accessToken)).expect(200);

      const categories = response.body.data.categories as Array<{ id: string; label: string; description: string; content: boolean; count: number }>;
      expect(categories.find((category) => category.id === 'servers')).toMatchObject({
        description: 'Server profiles and their saved credentials.',
        content: true,
        count: 3,
      });
      expect(categories.find((category) => category.id === 'sessions')).toMatchObject({
        description: 'Terminal session records and their saved logs.',
        content: true,
        count: 5,
      });
      expect(categories.find((category) => category.id === 'runbooks')).toMatchObject({
        description: 'Runbooks you own, their versions, runs and collected artifacts.',
        content: true,
        count: 2,
      });

      const scopes = response.body.data.scopes as Array<{ id: string; label: string; layer: string; confirmation: string; categories: string[] }>;
      expect(scopes.find((scope) => scope.id === 'servers')).toEqual(
        expect.objectContaining({ label: 'Delete my servers and sessions', layer: 'specific', confirmation: 'SERVERS', categories: ['servers', 'sessions'] }),
      );
      expect(scopes.find((scope) => scope.id === 'runbooks')).toEqual(
        expect.objectContaining({ label: 'Delete my runbooks and run history', layer: 'specific', confirmation: 'RUNBOOKS', categories: ['runbooks'] }),
      );
      // The built-in scopes are still there, and `content` now reaches the three categories too.
      expect(scopes.find((scope) => scope.id === 'content')!.categories).toEqual(expect.arrayContaining(['servers', 'sessions', 'runbooks']));
    });
  });

  describe('POST /api/user-data/deletions', () => {
    it.each([
      ['servers', 'SERVERS'],
      ['runbooks', 'RUNBOOKS'],
    ])('enqueues user.data.purge for scope %s with its phrase', async (scope, confirmation) => {
      const viewer = await createMockViewerUser(context);
      const response = await request(server())
        .post('/api/user-data/deletions')
        .set(authHeader(viewer.accessToken))
        .send({ scope, confirmation })
        .expect(202);
      expect(response.body.data).toEqual({ jobId: JOB_ID, status: 'pending' });
      expect(enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'user.data.purge', subjectType: 'user', subjectId: viewer.id, payload: { userId: viewer.id, scope }, orgId: null }),
      );
    });

    it('re-checks the phrase server-side: a wrong or lower-cased phrase is a 400 and queues nothing', async () => {
      const viewer = await createMockViewerUser(context);
      for (const confirmation of ['servers', 'RUNBOOKS', 'DELETE MY DATA']) {
        const response = await request(server())
          .post('/api/user-data/deletions')
          .set(authHeader(viewer.accessToken))
          .send({ scope: 'servers', confirmation })
          .expect(400);
        expect(response.body.details.reason).toBe('CONFIRMATION_MISMATCH');
      }
      expect(enqueue).not.toHaveBeenCalled();
    });
  });

  describe('/api/admin/factory-reset', () => {
    it('is Admin only (system:factory_reset): a viewer is refused', async () => {
      const viewer = await createMockViewerUser(context);
      await request(server()).get('/api/admin/factory-reset/summary').set(authHeader(viewer.accessToken)).expect(403);
      await request(server()).post('/api/admin/factory-reset').set(authHeader(viewer.accessToken)).send({ confirmation: 'FACTORY RESET' }).expect(403);
      expect(enqueue).not.toHaveBeenCalled();
    });

    it('lists the lines of ShellKeep’s steps in "Deleted" and queues one reset for an Admin', async () => {
      const admin = await createMockAdminUser(context);
      // The kept backups' jobs: none here.
      (prismaMock.databaseBackupRun.findMany as jest.Mock).mockResolvedValue([]);
      const summary = await request(server()).get('/api/admin/factory-reset/summary').set(authHeader(admin.accessToken)).expect(200);
      expect(summary.body.data.deleted).toEqual(
        expect.arrayContaining([
          'Live terminal connections are closed; tmux sessions already running on your servers are not killed.',
          'Every server profile and its saved credentials',
        ]),
      );

      await request(server()).post('/api/admin/factory-reset').set(authHeader(admin.accessToken)).send({ confirmation: 'FACTORY RESET' }).expect(202);
      expect(enqueue).toHaveBeenCalledWith({ type: 'admin.factory_reset', reason: 'rerun', payload: { actorUserId: admin.id }, orgId: null });
    });
  });
});
