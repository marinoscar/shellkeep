// =============================================================================
// Snippets over HTTP with the real guards and pipes (issue #172)
// =============================================================================
//
// The REAL controller, `SnippetsService`, rate limiter, Zod validation and the platform guards over a mocked
// Prisma client: who may call each route (`sessions:write`), the 400s of the caps, the owner-only 404, the
// order route, the secret warning and the rate limit. Persistence is proved by the service spec.
// =============================================================================

import request from 'supertest';

import { closeTestApp, createTestApp, type TestContext } from '../helpers/test-app.helper';
import { prismaMock, resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { authHeader, createMockAdminUser, createMockContributorUser, createMockViewerUser } from '../helpers/auth-mock.helper';
import { SnippetsRateLimiter } from '../../src/snippets/snippets-rate-limiter';

const ID = '3f2b8d4e-7a1c-4e5d-9b6a-1c2d3e4f5a6b';

const row = (over: Record<string, unknown> = {}) => ({
  id: ID,
  userId: 'u',
  orgId: 'o',
  title: 'Disk',
  body: 'df -h',
  tags: [],
  position: 0,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  ...over,
});

describe('Snippets API (Integration)', () => {
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
    const snippet = prismaMock.snippet;
    snippet.findMany.mockResolvedValue([row()]);
    snippet.findFirst.mockResolvedValue(row());
    snippet.count.mockResolvedValue(1);
    snippet.aggregate.mockResolvedValue({ _max: { position: null } });
    snippet.create.mockImplementation(async ({ data }: any) => row(data));
    snippet.update.mockImplementation(async ({ data }: any) => row(data));
    snippet.deleteMany.mockResolvedValue({ count: 1 });
  });

  const server = () => context.app.getHttpServer();
  const body = { title: 'Disk usage', body: 'df -h', tags: ['disk'] };

  it('rejects an unauthenticated caller with 401 on every route', async () => {
    await request(server()).get('/api/snippets').expect(401);
    await request(server()).post('/api/snippets').send(body).expect(401);
    await request(server()).put('/api/snippets/order').send({ ids: [ID] }).expect(401);
    await request(server()).patch(`/api/snippets/${ID}`).send({ title: 'x' }).expect(401);
    await request(server()).delete(`/api/snippets/${ID}`).expect(401);
  });

  it('refuses a Viewer every route with 403 naming sessions:write', async () => {
    const viewer = await createMockViewerUser(context);
    const h = authHeader(viewer.accessToken);
    const list = await request(server()).get('/api/snippets').set(h);
    expect(list.status).toBe(403);
    expect(list.body.message).toContain('sessions:write');
    await request(server()).post('/api/snippets').set(h).send(body).expect(403);
    await request(server()).put('/api/snippets/order').set(h).send({ ids: [ID] }).expect(403);
    await request(server()).patch(`/api/snippets/${ID}`).set(h).send({ title: 'x' }).expect(403);
    await request(server()).delete(`/api/snippets/${ID}`).set(h).expect(403);
  });

  it.each([
    ['Admin', createMockAdminUser],
    ['Contributor', createMockContributorUser],
  ])('lets a %s list, create, edit, reorder and delete', async (_name, make) => {
    const user = await make(context);
    const h = authHeader(user.accessToken);
    const list = await request(server()).get('/api/snippets?query=disk').set(h).expect(200);
    expect(list.body.data.items[0]).toMatchObject({ id: ID, title: 'Disk', body: 'df -h' });
    const created = await request(server()).post('/api/snippets').set(h).send(body).expect(201);
    expect(created.body.data).toMatchObject({ title: 'Disk usage', warning: null });
    await request(server()).patch(`/api/snippets/${ID}`).set(h).send({ title: 'Renamed' }).expect(200);
    await request(server()).put('/api/snippets/order').set(h).send({ ids: [ID] }).expect(200);
    await request(server()).delete(`/api/snippets/${ID}`).set(h).expect(204);
  });

  it('returns the secret warning on create and update, and saves the snippet', async () => {
    const user = await createMockContributorUser(context);
    const h = authHeader(user.accessToken);
    const created = await request(server()).post('/api/snippets').set(h).send({ title: 'db', body: 'mysql --password=hunter22' }).expect(201);
    expect(created.body.data.warning).toBe('looks-like-secret');
    expect(prismaMock.snippet.create).toHaveBeenCalled();
    const updated = await request(server()).patch(`/api/snippets/${ID}`).set(h).send({ body: 'export API_KEY=abcd1234efgh' }).expect(200);
    expect(updated.body.data.warning).toBe('looks-like-secret');
  });

  it('answers 404 for a snippet that is not the caller\'s (update, delete, reorder)', async () => {
    const user = await createMockContributorUser(context);
    const h = authHeader(user.accessToken);
    prismaMock.snippet.findFirst.mockResolvedValue(null);
    prismaMock.snippet.count.mockResolvedValue(0);
    await request(server()).patch(`/api/snippets/${ID}`).set(h).send({ title: 'x' }).expect(404);
    await request(server()).delete(`/api/snippets/${ID}`).set(h).expect(404);
    await request(server()).put('/api/snippets/order').set(h).send({ ids: [ID] }).expect(404);
    expect(prismaMock.snippet.update).not.toHaveBeenCalled();
    expect(prismaMock.snippet.deleteMany).not.toHaveBeenCalled();
  });

  it('scopes every query to the caller', async () => {
    const user = await createMockContributorUser(context);
    await request(server()).get('/api/snippets').set(authHeader(user.accessToken)).expect(200);
    const where = prismaMock.snippet.findMany.mock.calls[0][0].where;
    expect(where.userId).toBe(user.id);
    expect(typeof where.orgId).toBe('string');
  });

  it('enforces the caps with 400', async () => {
    const user = await createMockContributorUser(context);
    const h = authHeader(user.accessToken);
    const post = (payload: unknown) => request(server()).post('/api/snippets').set(h).send(payload as object);
    await post({}).expect(400);
    await post({ title: '', body: 'x' }).expect(400);
    await post({ title: 'x'.repeat(81), body: 'x' }).expect(400);
    await post({ title: 't', body: '' }).expect(400);
    await post({ title: 't', body: 'x'.repeat(4097) }).expect(400);
    await post({ title: 't', body: 'é'.repeat(2049) }).expect(400);
    await post({ title: 't', body: 'a\0b' }).expect(400);
    await post({ title: 't', body: 'x', tags: Array.from({ length: 9 }, (_, i) => `t${i}`) }).expect(400);
    await post({ title: 't', body: 'x', tags: ['y'.repeat(25)] }).expect(400);
    await post({ title: 't', body: 'x'.repeat(4096) }).expect(201);
    await post({ title: 'x'.repeat(80), body: 'x', tags: ['t'.repeat(24)] }).expect(201);
    await request(server()).patch(`/api/snippets/${ID}`).set(h).send({}).expect(400);
    await request(server()).patch('/api/snippets/not-a-uuid').set(h).send({ title: 'x' }).expect(400);
    await request(server()).put('/api/snippets/order').set(h).send({ ids: ['nope'] }).expect(400);
    await request(server()).put('/api/snippets/order').set(h).send({ ids: [ID, ID] }).expect(400);
    await request(server()).get(`/api/snippets?query=${'q'.repeat(101)}`).set(h).expect(400);
  });

  it('answers 409 at the per-user cap and 429 over the rate limit', async () => {
    const user = await createMockContributorUser(context);
    const h = authHeader(user.accessToken);
    prismaMock.snippet.count.mockResolvedValue(200);
    const full = await request(server()).post('/api/snippets').set(h).send(body).expect(409);
    expect(full.body.code).toBe('SNIPPET_LIMIT_REACHED');

    const limiter = context.app.get(SnippetsRateLimiter);
    let hits = 0;
    let last = 0;
    while (hits < 200 && last !== 429) {
      last = (await request(server()).get('/api/snippets').set(h)).status;
      hits += 1;
    }
    expect(last).toBe(429);
    expect(limiter).toBeDefined();
  });
});
