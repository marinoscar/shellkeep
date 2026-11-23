// =============================================================================
// The host core, About and Doctor over the composed app (issue #46)
// =============================================================================
//
// Drives the REAL `AppModule` over a mocked database: the routes the platform's
// host slice mounts (`/api/health/*`, `/api/admin/about`, `/api/admin/doctor`,
// `/api/admin/maintenance`), ShellKeep's `terminal` About section and Doctor
// checks, the maintenance window over HTTP, the `{ data }` envelope and the
// generated OpenAPI document.
// =============================================================================

import request from 'supertest';
import { MaintenanceModeService } from '@marinoscar/platform-api/host';
import {
  TestContext,
  createTestApp,
  closeTestApp,
} from '../helpers/test-app.helper';
import { prismaMock, resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import {
  authHeader,
  createMockAdminUser,
  createMockContributorUser,
} from '../helpers/auth-mock.helper';
import { createOpenApiDocument } from '../../src/openapi/document';

describe('Host core, About and Doctor (Integration)', () => {
  let context: TestContext;
  let maintenance: MaintenanceModeService;

  beforeAll(async () => {
    context = await createTestApp({ useMockDatabase: true });
    maintenance = context.module.get(MaintenanceModeService);
  });

  afterAll(async () => {
    maintenance.setInMemoryOverride(null);
    await closeTestApp(context);
  });

  beforeEach(() => {
    resetPrismaMock();
    setupBaseMocks();
    maintenance.setInMemoryOverride(null);
  });

  const get = (url: string) => request(context.app.getHttpServer()).get(url);

  describe('GET /api/admin/about', () => {
    it('reports the API and the terminal section, to an administrator', async () => {
      const admin = await createMockAdminUser(context);
      (prismaMock.terminalSession.groupBy as jest.Mock).mockResolvedValue([
        { status: 'active', _count: { _all: 3 } },
        { status: 'detached', _count: { _all: 1 } },
      ]);

      const res = await get('/api/admin/about').set(authHeader(admin.accessToken)).expect(200);

      expect(res.body.data.api.version).toEqual(expect.any(String));
      const terminal = res.body.data.extras.find((extra: { id: string }) => extra.id === 'terminal');
      expect(terminal).toMatchObject({
        id: 'terminal',
        label: 'Terminal',
        facts: {
          activeSessions: 3,
          detachedSessions: 1,
          ssh2Version: expect.stringMatching(/^\d+\.\d+\.\d+/),
          detachAfterMinutes: 60,
          terminateDetachedAfterHours: 12,
          purgeTerminatedAfterDays: 3,
        },
      });
    });

    it('is refused to a contributor (system_settings:read)', async () => {
      const contributor = await createMockContributorUser(context);
      await get('/api/admin/about').set(authHeader(contributor.accessToken)).expect(403);
    });

    it('is refused without a token', async () => {
      await get('/api/admin/about').expect(401);
    });
  });

  describe('GET /api/admin/doctor', () => {
    it('lists the terminal checks next to the platform ones', async () => {
      const admin = await createMockAdminUser(context);

      const res = await get('/api/admin/doctor?refresh=true').set(authHeader(admin.accessToken)).expect(200);

      const ids = JSON.stringify(res.body.data);
      for (const id of [
        'terminal.ssh.client',
        'terminal.tmux.probe',
        'terminal.sessions.reaper',
        'terminal.ssh.legacy-secrets',
        'network.egress',
        'maintenance.mode',
        'db.connection',
      ]) {
        expect(ids).toContain(id);
      }
    });

    it('is refused to a contributor', async () => {
      const contributor = await createMockContributorUser(context);
      await get('/api/admin/doctor').set(authHeader(contributor.accessToken)).expect(403);
    });
  });

  describe('maintenance mode over HTTP', () => {
    it('answers 503 with the maintenance marker to a contributor, and still serves the health probes', async () => {
      const contributor = await createMockContributorUser(context);
      maintenance.setInMemoryOverride({ enabled: true, message: 'Upgrading', allowAdmins: true });

      const res = await get('/api/server-profiles').set(authHeader(contributor.accessToken)).expect(503);

      expect(res.headers['retry-after']).toBe('30');
      expect(res.body).toMatchObject({
        code: 'ERROR',
        message: 'Upgrading',
        details: { reason: 'MAINTENANCE_MODE', allowAdmins: true },
      });
      await get('/api/health/live').expect(200);
    });

    it('lets an administrator through while the window allows admins', async () => {
      const admin = await createMockAdminUser(context);
      maintenance.setInMemoryOverride({ enabled: true, allowAdmins: true });

      await get('/api/admin/about').set(authHeader(admin.accessToken)).expect(200);
    });

    it('serves the maintenance status to an administrator', async () => {
      const admin = await createMockAdminUser(context);
      const res = await get('/api/admin/maintenance').set(authHeader(admin.accessToken)).expect(200);
      expect(res.body.data).toMatchObject({ enabled: false, allowAdmins: true });
    });
  });

  describe('the response envelope and request ids', () => {
    it('wraps a success in { data, meta } and echoes a request id', async () => {
      const res = await get('/api/health/live').set('x-request-id', 'req-from-the-proxy').expect(200);

      expect(res.body).toMatchObject({ data: { status: 'ok' }, meta: { timestamp: expect.any(String) } });
      expect(res.headers['x-request-id']).toBe('req-from-the-proxy');
    });

    it('generates a request id when none arrives', async () => {
      const res = await get('/api/health/live').expect(200);
      expect(res.headers['x-request-id']).toEqual(expect.any(String));
    });
  });

  describe('the OpenAPI document', () => {
    it('lists the host routes and ShellKeep tags, with every operation tagged', () => {
      const document = createOpenApiDocument(context.app);

      expect(Object.keys(document.paths)).toEqual(
        expect.arrayContaining([
          '/api/health/live',
          '/api/health/ready',
          '/api/admin/about',
          '/api/admin/doctor',
          '/api/admin/maintenance',
          '/api/server-profiles',
          '/api/sessions',
        ]),
      );
      const declared = new Set((document.tags ?? []).map((tag) => tag.name));
      for (const [path, item] of Object.entries(document.paths)) {
        for (const operation of Object.values(item as Record<string, { tags?: string[] }>)) {
          for (const tag of operation.tags ?? []) {
            expect({ path, tag, declared: declared.has(tag) }).toEqual({ path, tag, declared: true });
          }
        }
      }
      expect(JSON.stringify((document as unknown as Record<string, unknown>)['x-tagGroups'])).toContain('Servers & Terminal');
    });
  });
});
