// =============================================================================
// GET /api/dashboard/summary: access rule and what reaches the service (issue #78)
// =============================================================================
//
// The real guards run; the service is a fake that records the principal, so this proves the
// route's access rule (401 without a token, sessions:read for every org role) and that the
// service receives the caller's real permissions, which is where `runs` and `servers` are gated
// (unit: src/dashboard/dashboard.service.spec.ts; scope over a real database:
// test/dashboard/dashboard.db.spec.ts).
// =============================================================================

import request from 'supertest';

import { DashboardService } from '../../src/dashboard/dashboard.service';
import { closeTestApp, createTestApp, TestContext } from '../helpers/test-app.helper';
import { authHeader, createMockAdminUser, createMockContributorUser, createMockViewerUser } from '../helpers/auth-mock.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { catalogPermissionsOf } from '../fixtures/test-data.factory';

const SUMMARY = {
  servers: { total: 0, reachable: 0, unreachable: 0, unknown: 0, hostKeyUntrusted: 0 },
  sessions: { active: 0, attached: 0, detached: 0, recent: [] },
  runs: null,
};

describe('GET /api/dashboard/summary (integration)', () => {
  let context: TestContext;
  const dashboard = { summary: jest.fn() };

  beforeAll(async () => {
    context = await createTestApp({
      useMockDatabase: true,
      overrideProviders: [{ provide: DashboardService, useValue: dashboard }],
    });
  });
  afterAll(async () => closeTestApp(context));

  beforeEach(() => {
    dashboard.summary.mockReset().mockResolvedValue(SUMMARY);
    resetPrismaMock();
    setupBaseMocks();
  });

  const get = (token?: string) => {
    const req = request(context.app.getHttpServer()).get('/api/dashboard/summary');
    return token ? req.set(authHeader(token)) : req;
  };

  it('seeds sessions:read to every org role, so every member reaches Home', () => {
    expect(['org_admin', 'contributor', 'viewer'].map((r) => catalogPermissionsOf(r).includes('sessions:read'))).toEqual([true, true, true]);
  });

  it('is 401 without a token, and the service is never called', async () => {
    await get().expect(401);
    expect(dashboard.summary).not.toHaveBeenCalled();
  });

  it.each([
    ['viewer', createMockViewerUser],
    ['contributor', createMockContributorUser],
    ['admin', createMockAdminUser],
  ] as const)('is 200 for a %s, with the summary in the data envelope', async (_role, create) => {
    const user = await create(context);
    const res = await get(user.accessToken).expect(200);
    expect(res.body.data).toEqual(SUMMARY);
  });

  it("hands the service the caller's own identity, organization and permissions", async () => {
    const viewer = await createMockViewerUser(context);
    await get(viewer.accessToken).expect(200);
    const principal = dashboard.summary.mock.calls[0][0];
    expect(principal.userId).toBe(viewer.id);
    expect(principal.activeOrgId).toEqual(expect.any(String));
    expect(principal.permissions).toEqual(expect.arrayContaining(['sessions:read', 'servers:read', 'runbooks:read']));
  });
});
