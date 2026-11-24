// The files routes over the real guards and the seeded catalog (issue #153): the terminal's
// permission (`sessions:write`), no `files:*` permission, and the one deliberately public route.

import { NotFoundException } from '@nestjs/common';
import request from 'supertest';
import { closeTestApp, createTestApp, TestContext } from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { authHeader, createMockAdminUser, createMockContributorUser, createMockViewerUser } from '../helpers/auth-mock.helper';
import { catalogPermissionsOf } from '../fixtures/test-data.factory';
import { FilesService } from '../../src/files/files.service';

const ID = '3f2b8d4e-7a1c-4e5d-9b6a-1c2d3e4f5a6b';
const stub = {
  list: jest.fn().mockResolvedValue({ path: '/', entries: [], truncated: false }),
  stat: jest.fn().mockResolvedValue({}),
  content: jest.fn().mockResolvedValue({ text: '', offset: 0, length: 0, size: 0, eof: true }),
  issueDownloadToken: jest.fn().mockResolvedValue({ token: 't', expiresAt: new Date().toISOString() }),
  upload: jest.fn().mockRejectedValue(new NotFoundException('x')),
  openDownload: jest.fn().mockRejectedValue(new NotFoundException('x')),
};

describe('files routes RBAC', () => {
  let context: TestContext;
  beforeAll(async () => {
    context = await createTestApp({ useMockDatabase: true, overrideProviders: [{ provide: FilesService, useValue: stub }] });
  });
  afterAll(async () => closeTestApp(context));
  beforeEach(() => {
    resetPrismaMock();
    setupBaseMocks();
  });

  const server = () => context.app.getHttpServer();
  const routes: Array<[string, (agent: request.Agent) => request.Test]> = [
    ['list', (a) => a.get(`/api/server-profiles/${ID}/files`)],
    ['stat', (a) => a.get(`/api/server-profiles/${ID}/files/stat?path=~`)],
    ['content', (a) => a.get(`/api/server-profiles/${ID}/files/content?path=a`)],
    ['upload', (a) => a.post(`/api/server-profiles/${ID}/files/upload?path=~&name=a.txt`)],
    ['download-token', (a) => a.post(`/api/server-profiles/${ID}/files/download-token`).send({ path: 'a' })],
  ];

  it('adds no files permission: the terminal permission gates the routes', () => {
    expect(catalogPermissionsOf('contributor').filter((p) => p.startsWith('files:'))).toEqual([]);
    expect(catalogPermissionsOf('contributor')).toContain('sessions:write');
    expect(catalogPermissionsOf('viewer')).not.toContain('sessions:write');
  });

  it.each(routes)('401 for an anonymous caller on %s', async (_n, call) => {
    await call(request.agent(server())).expect(401);
  });

  it.each(routes)('403 naming sessions:write for a Viewer on %s', async (_n, call) => {
    const viewer = await createMockViewerUser(context);
    const res = await call(request.agent(server())).set(authHeader(viewer.accessToken));
    expect(res.status).toBe(403);
    expect(res.body.message).toContain('sessions:write');
  });

  it.each([
    ['Admin', createMockAdminUser],
    ['Contributor', createMockContributorUser],
  ])('lets a %s past the guards on every route', async (_n, make) => {
    const user = await make(context);
    for (const [, call] of routes) {
      const res = await call(request.agent(server())).set(authHeader(user.accessToken));
      expect([200, 404]).toContain(res.status);
    }
  });

  it('serves the download route with no credential at all (the token is the credential)', async () => {
    const res = await request(server()).get('/api/files/download/some-token');
    expect(res.status).toBe(404);
  });
});
