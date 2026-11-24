// =============================================================================
// /api/exports over HTTP, with ShellKeep's sources (issue #68)
// =============================================================================
//
// Authentication on every route, the sources a caller may use (each source needs its own
// permission), the source's permission (403), unknown source or format (400), a request the source
// refuses (400), another user's export (404, never 403), the 202 of a queued export. The queue is
// spied (`JobsService.enqueue`): what the job does is the package's handler spec and `exports.db.spec.ts`.
// =============================================================================

import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { JobsService } from '@marinoscar/platform-api/jobs';

import { TestContext, createTestApp, closeTestApp } from '../helpers/test-app.helper';
import { prismaMock, resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { authHeader, createMockContributorUser, createMockViewerUser } from '../helpers/auth-mock.helper';

describe('Exports (/api/exports)', () => {
  let context: TestContext;
  let enqueue: jest.SpyInstance;

  beforeAll(async () => {
    context = await createTestApp({ useMockDatabase: true });
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(() => {
    resetPrismaMock();
    setupBaseMocks();
    (prismaMock.job.count as jest.Mock).mockResolvedValue(0);
    enqueue = jest.spyOn(context.app.get(JobsService), 'enqueue').mockImplementation(
      async (input) =>
        ({
          id: randomUUID(),
          status: 'pending',
          payload: input.payload,
          createdAt: new Date('2026-11-24T10:00:00.000Z'),
          finishedAt: null,
        }) as never,
    );
  });

  afterEach(() => enqueue.mockRestore());

  const server = () => context.app.getHttpServer();

  it.each([
    ['get', '/api/exports/sources'],
    ['get', '/api/exports'],
    ['post', '/api/exports'],
    ['get', `/api/exports/${randomUUID()}`],
  ] as const)('%s %s answers 401 without a session', async (method, path) => {
    await request(server())[method](path).expect(401);
  });

  it("lists user-data and ShellKeep's three sources for a contributor, never org-data", async () => {
    const contributor = await createMockContributorUser(context);
    const response = await request(server()).get('/api/exports/sources').set(authHeader(contributor.accessToken)).expect(200);
    const ids = response.body.data.items.map((s: { id: string }) => s.id);
    expect(ids).toEqual(expect.arrayContaining(['user-data', 'server-profiles', 'terminal-sessions', 'runbook-runs']));
    expect(ids).not.toContain('org-data');

    const profiles = response.body.data.items.find((s: { id: string }) => s.id === 'server-profiles');
    expect(profiles.formats.map((f: { id: string }) => f.id)).toEqual(['json', 'csv', 'xlsx']);
    expect(profiles.fields.map((f: { key: string; kind: string }) => `${f.key}:${f.kind}`)).toEqual(['includeShared:boolean']);

    const sessions = response.body.data.items.find((s: { id: string }) => s.id === 'terminal-sessions');
    expect(sessions.fields.map((f: { key: string; kind: string }) => `${f.key}:${f.kind}`)).toEqual(['from:date', 'to:date', 'status:select']);

    const runs = response.body.data.items.find((s: { id: string }) => s.id === 'runbook-runs');
    expect(runs.fields.map((f: { key: string; kind: string }) => `${f.key}:${f.kind}`)).toEqual(['from:date', 'to:date', 'runbookId:text']);
  });

  it('shows a source only to a caller who holds its permission', async () => {
    const viewer = await createMockViewerUser(context);
    const response = await request(server()).get('/api/exports/sources').set(authHeader(viewer.accessToken)).expect(200);
    const ids: string[] = response.body.data.items.map((s: { id: string }) => s.id);
    const permissionOf: Record<string, string> = {
      'server-profiles': 'servers:read',
      'terminal-sessions': 'sessions:read',
      'runbook-runs': 'runbooks:read',
    };
    const me = await request(server()).get('/api/auth/me').set(authHeader(viewer.accessToken)).expect(200);
    const held: string[] = me.body.data.permissions;
    for (const [source, permission] of Object.entries(permissionOf)) {
      expect(ids.includes(source)).toBe(held.includes(permission));
    }
  });

  it('POST server-profiles answers 202 with a pending export queued for the caller', async () => {
    const contributor = await createMockContributorUser(context);
    const response = await request(server())
      .post('/api/exports')
      .set(authHeader(contributor.accessToken))
      .send({ source: 'server-profiles', format: 'json', request: { includeShared: true } })
      .expect(202);
    expect(response.body.data).toMatchObject({ status: 'pending', source: 'server-profiles', format: 'json', scope: 'user', download: null });
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'export.run',
        subjectType: 'user',
        subjectId: contributor.id,
        skipDedup: true,
        payload: expect.objectContaining({ source: 'server-profiles', request: { includeShared: true } }),
      }),
    );
  });

  it('400 for an unknown source or format, an extra request key and a request the source refuses', async () => {
    const contributor = await createMockContributorUser(context);
    const post = (body: object) => request(server()).post('/api/exports').set(authHeader(contributor.accessToken)).send(body);
    await post({ source: 'nope', format: 'json' }).expect(400);
    await post({ source: 'server-profiles', format: 'pdf' }).expect(400);
    await post({ source: 'server-profiles', format: 'json', request: { includeShared: true, extra: 1 } }).expect(400);
    await post({ source: 'terminal-sessions', format: 'csv', request: { from: '2026-02-01', to: '2026-01-01' } }).expect(400);
    await post({ source: 'terminal-sessions', format: 'csv', request: { from: '2026-01-01', to: '2026-01-31', status: 'bogus' } }).expect(400);
    await post({ source: 'terminal-sessions', format: 'csv', request: { from: '2026-01-01' } }).expect(400);
    await post({ source: 'runbook-runs', format: 'json', request: { from: '2026-01-01', to: '2026-01-31', runbookId: 'x' } }).expect(400);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("403 without the source's permission", async () => {
    const contributor = await createMockContributorUser(context);
    await request(server())
      .post('/api/exports')
      .set(authHeader(contributor.accessToken))
      .send({ source: 'org-data', format: 'json' })
      .expect(403);
  });

  it("404 for another user's export, and for an id that is not an export", async () => {
    const contributor = await createMockContributorUser(context);
    const id = randomUUID();
    const other = randomUUID();
    (prismaMock.job.findFirst as jest.Mock).mockResolvedValue({
      id,
      status: 'pending',
      createdAt: new Date(),
      finishedAt: null,
      subjectType: 'user',
      subjectId: other,
      payload: { source: 'server-profiles', format: 'json', request: {}, requestedById: other, scope: 'user', subjectId: other, orgId: 'org-default' },
    });
    await request(server()).get(`/api/exports/${id}`).set(authHeader(contributor.accessToken)).expect(404);
    (prismaMock.job.findFirst as jest.Mock).mockResolvedValue(null);
    await request(server()).get(`/api/exports/${id}`).set(authHeader(contributor.accessToken)).expect(404);
    await request(server()).get('/api/exports/not-a-uuid').set(authHeader(contributor.accessToken)).expect(400);
  });

  it("GET /api/exports lists the caller's exports", async () => {
    const contributor = await createMockContributorUser(context);
    (prismaMock.job.findMany as jest.Mock).mockResolvedValue([
      {
        id: randomUUID(),
        status: 'running',
        createdAt: new Date(),
        finishedAt: null,
        payload: {
          source: 'terminal-sessions',
          format: 'xlsx',
          request: { from: '2026-01-01', to: '2026-01-31' },
          requestedById: contributor.id,
          scope: 'user',
          subjectId: contributor.id,
          orgId: 'org-default',
        },
      },
    ]);
    const response = await request(server()).get('/api/exports').set(authHeader(contributor.accessToken)).expect(200);
    expect(response.body.data.items.map((i: { status: string }) => i.status)).toEqual(['running']);
  });
});
