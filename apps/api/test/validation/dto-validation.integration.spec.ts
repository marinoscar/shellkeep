import request from 'supertest';
import {
  TestContext,
  createTestApp,
  closeTestApp,
} from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { createMockAdminUser, authHeader } from '../helpers/auth-mock.helper';

/**
 * Characterization of Zod validation failures across controllers: each case
 * sends an invalid body or query to a real endpoint and records the status and
 * the error body. Written to prove the zod 3 to zod 4
 * and nestjs-zod 3 to 5 upgrade did not change the 400 contract.
 */
describe('DTO validation errors (Integration)', () => {
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
  });

  const UUID = '11111111-1111-4111-8111-111111111111';

  const cases: Array<{
    name: string;
    method: 'post' | 'patch' | 'put' | 'get';
    url: string;
    body?: Record<string, unknown>;
  }> = [
    { name: 'allowlist add', method: 'post', url: '/api/allowlist', body: { email: 'nope' } },
    { name: 'allowlist query', method: 'get', url: '/api/allowlist?status=bogus' },
    { name: 'users update', method: 'patch', url: `/api/users/${UUID}`, body: { isActive: 'yes' } },
    { name: 'users list query', method: 'get', url: '/api/users?page=0' },
    { name: 'user roles', method: 'put', url: `/api/users/${UUID}/roles`, body: {} },
    { name: 'user settings replace', method: 'put', url: '/api/user-settings', body: { theme: 'neon' } },
    { name: 'user settings patch', method: 'patch', url: '/api/user-settings', body: { theme: 'neon' } },
    { name: 'system settings replace', method: 'put', url: '/api/system-settings', body: { ui: {} } },
    { name: 'system settings patch', method: 'patch', url: '/api/system-settings', body: { ui: { allowUserThemeOverride: 'x' } } },
    { name: 'server profile create', method: 'post', url: '/api/server-profiles', body: { name: '' } },
    { name: 'server profile query', method: 'get', url: '/api/server-profiles?page=0' },
    { name: 'session create', method: 'post', url: '/api/sessions', body: { serverProfileId: 'nope' } },
    { name: 'session rename', method: 'patch', url: `/api/sessions/${UUID}`, body: { name: '' } },
    { name: 'storage upload init', method: 'post', url: '/api/storage/objects/upload/init', body: {} },
    { name: 'storage list query', method: 'get', url: '/api/storage/objects?pageSize=0' },
  ];

  it.each(cases)('$name returns 400 with a stable body', async (c) => {
    const admin = await createMockAdminUser(context);
    let req = request(context.app.getHttpServer())[c.method](c.url).set(authHeader(admin.accessToken));
    if (c.body) req = req.send(c.body);
    const res = await req;
    const { timestamp, path, ...rest } = res.body;
    expect(res.status).toBe(400);
    // The contract as shipped: a generic body with no `details` field. Zod issue
    // paths are deliberately not exposed.
    expect(rest).toEqual({
      statusCode: 400,
      code: 'BAD_REQUEST',
      message: 'Validation failed',
    });
    expect(typeof timestamp).toBe('string');
    expect(path).toBe(c.url);
  });
});
