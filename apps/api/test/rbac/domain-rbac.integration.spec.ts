// =============================================================================
// Server profile and terminal session RBAC over the seeded catalog (issue #47)
// =============================================================================
//
// Platform migration 0024 moved `contributor` and `viewer` from `user_roles` onto
// an org membership and left `admin` as the one system role; #47 moved ShellKeep's
// six domain permissions onto the same model. This proves every role holds the
// SAME effective permissions on servers and sessions as before, now through the
// org membership, and that the routes enforce them with the real guards.
//
// Users are shaped as production stores them and their permissions come from
// `prisma/catalog/permissions.json` (what the seed writes), not a hand-written list.
// =============================================================================

import request from 'supertest';
import { closeTestApp, createTestApp, TestContext } from '../helpers/test-app.helper';
import { prismaMock, resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import {
  authHeader,
  createMockAdminUser,
  createMockContributorUser,
  createMockViewerUser,
} from '../helpers/auth-mock.helper';
import { catalogPermissionsOf } from '../fixtures/test-data.factory';

const DOMAIN = /^(servers|sessions):/;
const domainOf = (permissions: string[]) => permissions.filter((p) => DOMAIN.test(p)).sort();

const ALL_SIX = [
  'servers:delete',
  'servers:read',
  'servers:write',
  'sessions:delete',
  'sessions:read',
  'sessions:write',
];

describe('Server profile and session RBAC (Integration)', () => {
  describe('the seeded catalog', () => {
    it('gives an administrator all six through the org_admin membership, none through the system admin role', () => {
      expect(domainOf(catalogPermissionsOf('org_admin'))).toEqual(ALL_SIX);
      expect(domainOf(catalogPermissionsOf('admin'))).toEqual([]);
    });

    it('gives a Contributor all six', () => {
      expect(domainOf(catalogPermissionsOf('contributor'))).toEqual(ALL_SIX);
    });

    it('gives a Viewer the two reads and nothing that writes', () => {
      expect(domainOf(catalogPermissionsOf('viewer'))).toEqual(['servers:read', 'sessions:read']);
    });
  });

  describe('the routes', () => {
    let context: TestContext;

    beforeAll(async () => {
      context = await createTestApp({ useMockDatabase: true });
    });

    afterAll(async () => {
      await closeTestApp(context);
    });

    beforeEach(() => {
      resetPrismaMock();
      setupBaseMocks();
      (prismaMock.serverProfile.findMany as jest.Mock).mockResolvedValue([]);
      (prismaMock.serverProfile.count as jest.Mock).mockResolvedValue(0);
      (prismaMock.terminalSession.findMany as jest.Mock).mockResolvedValue([]);
      (prismaMock.terminalSession.count as jest.Mock).mockResolvedValue(0);
    });

    const server = () => context.app.getHttpServer();

    it('rejects an unauthenticated caller with 401', async () => {
      await request(server()).get('/api/server-profiles').expect(401);
      await request(server()).get('/api/server-profiles/tags').expect(401);
      await request(server()).patch('/api/server-profiles/bulk-tags').send({}).expect(401);
      await request(server()).get('/api/sessions').expect(401);
    });

    it.each([
      ['Admin', createMockAdminUser],
      ['Contributor', createMockContributorUser],
      ['Viewer', createMockViewerUser],
    ])('lets a %s list server profiles and sessions', async (_name, make) => {
      const user = await make(context);

      await request(server()).get('/api/server-profiles').set(authHeader(user.accessToken)).expect(200);
      await request(server()).get('/api/server-profiles?tag=prod&health=unreachable').set(authHeader(user.accessToken)).expect(200);
      await request(server()).get('/api/server-profiles/tags').set(authHeader(user.accessToken)).expect(200);
      await request(server()).get('/api/sessions').set(authHeader(user.accessToken)).expect(200);
    });

    it('refuses a Viewer every write with 403 and names the missing permission', async () => {
      const viewer = await createMockViewerUser(context);
      const id = '3f2b8d4e-7a1c-4e5d-9b6a-1c2d3e4f5a6b';
      const body = { name: 'srv', hostname: 'server-a.example.test', port: 22, username: 'u', authMethod: 'agent' };

      const create = await request(server()).post('/api/server-profiles').set(authHeader(viewer.accessToken)).send(body);
      expect(create.status).toBe(403);
      expect(create.body.message).toContain('servers:write');

      await request(server()).patch(`/api/server-profiles/${id}`).set(authHeader(viewer.accessToken)).send({ name: 'x' }).expect(403);
      await request(server()).delete(`/api/server-profiles/${id}`).set(authHeader(viewer.accessToken)).expect(403);
      await request(server())
        .patch('/api/server-profiles/bulk-tags')
        .set(authHeader(viewer.accessToken))
        .send({ ids: [id], add: ['x'] })
        .expect(403);
      await request(server()).post('/api/sessions').set(authHeader(viewer.accessToken)).send({ serverProfileId: id }).expect(403);
      await request(server()).patch(`/api/sessions/${id}`).set(authHeader(viewer.accessToken)).send({ name: 'x' }).expect(403);
      await request(server()).delete(`/api/sessions/${id}`).set(authHeader(viewer.accessToken)).expect(403);
      await request(server()).post('/api/sessions/batch-terminate').set(authHeader(viewer.accessToken)).send({ ids: [id] }).expect(403);
    });

    it.each([
      ['Admin', createMockAdminUser],
      ['Contributor', createMockContributorUser],
    ])('lets a %s past the guards on every write (a malformed body is a 400, not a 403)', async (_name, make) => {
      const user = await make(context);

      await request(server()).post('/api/server-profiles').set(authHeader(user.accessToken)).send({}).expect(400);
      await request(server()).patch('/api/server-profiles/bulk-tags').set(authHeader(user.accessToken)).send({}).expect(400);
      await request(server()).post('/api/sessions').set(authHeader(user.accessToken)).send({}).expect(400);
    });
  });
});
