// =============================================================================
// Runbook routes: 401, 403 and 2xx per route, and the secret egress sweep (issue #61)
// =============================================================================
//
// The real guards and pipes run; the services behind the controllers are fakes, so this
// proves the access rule of each route and that no runbook-secrets route returns a value.
// =============================================================================

import request from 'supertest';
import { OrgCredentialsService } from '@marinoscar/platform-api/credentials';

import { RunbooksService } from '../../src/runbooks/runbooks.service';
import { TargetResolverService } from '../../src/runbooks/target-resolver.service';
import { closeTestApp, createTestApp, TestContext } from '../helpers/test-app.helper';
import { authHeader, createMockAdminUser, createMockContributorUser, createMockViewerUser } from '../helpers/auth-mock.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { catalogPermissionsOf } from '../fixtures/test-data.factory';

const ID = '3f2b8d4e-7a1c-4e5d-9b6a-1c2d3e4f5a6b';
const DEF = { schemaVersion: 1, steps: [{ id: 'c1', name: 'Disk', kind: 'command', command: 'df -h' }] };
const SENTINEL = 'SENTINEL-runbook-secret-VALUE-0042';

const runbook = { id: ID, name: 'Patch', latestVersion: { version: 1, definition: DEF } };

describe('Runbook routes (integration)', () => {
  let context: TestContext;
  let stored: { name: string; hint: string; label: string | null; updatedByUserId: string; createdAt: Date; updatedAt: Date }[];
  const runbooks = {
    list: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    replaceDefinition: jest.fn(),
    updateMetadata: jest.fn(),
    archive: jest.fn(),
    restore: jest.fn(),
    listVersions: jest.fn(),
    getVersion: jest.fn(),
    validate: jest.fn(),
  };
  const targets = { resolve: jest.fn() };
  const orgCredentials = { list: jest.fn(), setSecret: jest.fn(), deleteSecret: jest.fn(), getSecret: jest.fn() };

  beforeAll(async () => {
    context = await createTestApp({
      useMockDatabase: true,
      overrideProviders: [
        { provide: RunbooksService, useValue: runbooks },
        { provide: TargetResolverService, useValue: targets },
        { provide: OrgCredentialsService, useValue: orgCredentials },
      ],
    });
  });
  afterAll(async () => closeTestApp(context));

  beforeEach(() => {
    for (const fake of [...Object.values(runbooks), targets.resolve, ...Object.values(orgCredentials)]) fake.mockReset();
    resetPrismaMock();
    setupBaseMocks();
    stored = [];
    runbooks.list.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    runbooks.findOne.mockResolvedValue(runbook);
    runbooks.create.mockResolvedValue(runbook);
    runbooks.replaceDefinition.mockResolvedValue({ runbook, created: true });
    runbooks.updateMetadata.mockResolvedValue({ id: ID });
    runbooks.archive.mockResolvedValue(undefined);
    runbooks.restore.mockResolvedValue({ id: ID });
    runbooks.listVersions.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    runbooks.getVersion.mockResolvedValue({ version: 1, definition: DEF });
    runbooks.validate.mockReturnValue({ valid: true, definition: DEF, definitionSha256: 'x', warnings: [] });
    targets.resolve.mockResolvedValue({ targets: [], skipped: [], total: 0, capped: false, limit: 200 });
    orgCredentials.list.mockImplementation(async () => stored);
    orgCredentials.setSecret.mockImplementation(async (_org: string, _purpose: string, name: string, _value: string, meta: any) => {
      const info = { purpose: 'runbook_secret', name, hint: '••••0042', label: meta?.label ?? null, updatedByUserId: meta?.updatedByUserId, createdAt: new Date(0), updatedAt: new Date(0) };
      stored = [info];
      return info;
    });
    orgCredentials.deleteSecret.mockResolvedValue(undefined);
  });

  const server = () => context.app.getHttpServer();

  type Route = { method: 'get' | 'post' | 'put' | 'patch' | 'delete'; path: string; body?: unknown; permission: string; ok: number; headers?: Record<string, string> };
  const ROUTES: Route[] = [
    { method: 'get', path: '/api/runbooks', permission: 'runbooks:read', ok: 200 },
    { method: 'get', path: `/api/runbooks/${ID}`, permission: 'runbooks:read', ok: 200 },
    { method: 'get', path: `/api/runbooks/${ID}/versions`, permission: 'runbooks:read', ok: 200 },
    { method: 'get', path: `/api/runbooks/${ID}/versions/1`, permission: 'runbooks:read', ok: 200 },
    { method: 'post', path: '/api/runbooks/targets/preview', body: { selector: { tags: { any: ['web'] } } }, permission: 'runbooks:read', ok: 200 },
    { method: 'post', path: '/api/runbooks', body: { name: 'Patch', definition: DEF }, permission: 'runbooks:write', ok: 201 },
    { method: 'post', path: '/api/runbooks/validate', body: { definition: DEF }, permission: 'runbooks:write', ok: 200 },
    { method: 'put', path: `/api/runbooks/${ID}/definition`, body: { definition: DEF }, permission: 'runbooks:write', ok: 200, headers: { 'If-Match': '"v1"' } },
    { method: 'patch', path: `/api/runbooks/${ID}`, body: { name: 'New' }, permission: 'runbooks:write', ok: 200 },
    { method: 'delete', path: `/api/runbooks/${ID}`, permission: 'runbooks:write', ok: 204 },
    { method: 'post', path: `/api/runbooks/${ID}/restore`, permission: 'runbooks:write', ok: 200 },
    { method: 'get', path: '/api/runbook-secrets', permission: 'runbooks:write', ok: 200 },
    { method: 'put', path: '/api/runbook-secrets/api-token', body: { value: SENTINEL }, permission: 'runbooks:write', ok: 200 },
    { method: 'delete', path: '/api/runbook-secrets/api-token', permission: 'runbooks:write', ok: 204 },
  ];

  const call = (route: Route, token?: string) => {
    let req = (request(server()) as any)[route.method](route.path);
    if (token) req = req.set(authHeader(token));
    for (const [k, v] of Object.entries(route.headers ?? {})) req = req.set(k, v);
    return route.body === undefined ? req : req.send(route.body);
  };

  it('seeds runbooks:read to every org role, write and run to writers, approve to org_admin', () => {
    const has = (role: string, p: string) => catalogPermissionsOf(role).includes(p);
    expect(['org_admin', 'contributor', 'viewer'].map((r) => has(r, 'runbooks:read'))).toEqual([true, true, true]);
    expect(['org_admin', 'contributor', 'viewer'].map((r) => has(r, 'runbooks:write'))).toEqual([true, true, false]);
    expect(['org_admin', 'contributor', 'viewer'].map((r) => has(r, 'runbooks:run'))).toEqual([true, true, false]);
    expect(['org_admin', 'contributor', 'viewer'].map((r) => has(r, 'runbooks:approve'))).toEqual([true, false, false]);
    expect(has('admin', 'runbooks:read')).toBe(false);
  });

  describe.each(ROUTES.map((r) => [`${r.method.toUpperCase()} ${r.path.replace(ID, ':id')}`, r] as const))('%s', (_name, route) => {
    it('is 401 without a token', async () => {
      await call(route).expect(401);
    });

    it(`is ${route.permission === 'runbooks:read' ? '2xx' : '403'} for a viewer`, async () => {
      const viewer = await createMockViewerUser(context);
      const res = await call(route, viewer.accessToken);
      if (route.permission === 'runbooks:read') expect(res.status).toBe(route.ok);
      else {
        expect(res.status).toBe(403);
        expect(res.body.message).toContain(route.permission);
      }
    });

    it('is 2xx for a contributor', async () => {
      const user = await createMockContributorUser(context);
      await call(route, user.accessToken).expect(route.ok);
    });

    it('is 2xx for an admin', async () => {
      const user = await createMockAdminUser(context);
      await call(route, user.accessToken).expect(route.ok);
    });
  });

  describe('the definition PUT', () => {
    it('is 428 without If-Match and 400 for an unreadable one, before the service runs', async () => {
      const user = await createMockContributorUser(context);
      const base = () => request(server()).put(`/api/runbooks/${ID}/definition`).set(authHeader(user.accessToken)).send({ definition: DEF });
      const missing = await base();
      expect(missing.status).toBe(428);
      expect(missing.body.code).toBe('RUNBOOK_IF_MATCH_REQUIRED');
      await base().set('If-Match', 'banana').expect(400);
      expect(runbooks.replaceDefinition).not.toHaveBeenCalled();
    });

    it('passes the version of If-Match to the service and returns the new ETag', async () => {
      const user = await createMockContributorUser(context);
      runbooks.replaceDefinition.mockResolvedValue({ runbook: { ...runbook, latestVersion: { version: 4 } }, created: true });
      const res = await request(server()).put(`/api/runbooks/${ID}/definition`).set(authHeader(user.accessToken)).set('If-Match', 'W/"v3"').send({ definition: DEF, changelog: 'c' });
      expect(res.status).toBe(200);
      expect(res.headers.etag).toBe('"v4"');
      expect(runbooks.replaceDefinition).toHaveBeenCalledWith(expect.objectContaining({ orgId: expect.any(String) }), ID, 3, { definition: DEF, changelog: 'c' });
    });
  });

  it('sets the ETag on GET and create', async () => {
    const user = await createMockContributorUser(context);
    const got = await request(server()).get(`/api/runbooks/${ID}`).set(authHeader(user.accessToken)).expect(200);
    expect(got.headers.etag).toBe('"v1"');
    const created = await request(server()).post('/api/runbooks').set(authHeader(user.accessToken)).send({ name: 'x', definition: DEF }).expect(201);
    expect(created.headers.etag).toBe('"v1"');
  });

  it('rejects a malformed id or body with 400 and a bad secret name', async () => {
    const user = await createMockContributorUser(context);
    await request(server()).get('/api/runbooks/not-a-uuid').set(authHeader(user.accessToken)).expect(400);
    await request(server()).post('/api/runbooks').set(authHeader(user.accessToken)).send({ definition: DEF }).expect(400);
    await request(server()).put('/api/runbook-secrets/Bad_Name').set(authHeader(user.accessToken)).send({ value: 'x' }).expect(400);
    await request(server()).put('/api/runbook-secrets/ok').set(authHeader(user.accessToken)).send({ value: '' }).expect(400);
  });

  it('maps the preview result to { servers, skipped, total, capped, limit }', async () => {
    const user = await createMockContributorUser(context);
    targets.resolve.mockResolvedValue({ targets: [{ id: ID, name: 'a' }], skipped: [{ serverProfileId: 'x', reason: 'forbidden' }], total: 1, capped: false, limit: 200 });
    const res = await request(server()).post('/api/runbooks/targets/preview').set(authHeader(user.accessToken)).send({ selector: {} }).expect(200);
    expect(res.body.data).toEqual({ servers: [{ id: ID, name: 'a' }], skipped: [{ serverProfileId: 'x', reason: 'forbidden' }], total: 1, capped: false, limit: 200 });
  });

  describe('secret egress: no runbook route ever returns a secret value', () => {
    it('sweeps every response of the secret routes and the audit trail for the sentinel', async () => {
      const user = await createMockContributorUser(context);
      const bodies: string[] = [];
      const put = await request(server()).put('/api/runbook-secrets/api-token').set(authHeader(user.accessToken)).send({ value: SENTINEL, label: 'Deploy' }).expect(200);
      bodies.push(JSON.stringify([put.body, put.headers]));
      const list = await request(server()).get('/api/runbook-secrets').set(authHeader(user.accessToken)).expect(200);
      bodies.push(JSON.stringify([list.body, list.headers]));
      const del = await request(server()).delete('/api/runbook-secrets/api-token').set(authHeader(user.accessToken)).expect(204);
      bodies.push(JSON.stringify(del.headers));
      // The value is passed to the credential store, once, and nowhere else.
      expect(orgCredentials.setSecret).toHaveBeenCalledWith(expect.any(String), 'runbook_secret', 'api-token', SENTINEL, expect.objectContaining({ label: 'Deploy' }));
      expect(orgCredentials.getSecret).not.toHaveBeenCalled();
      expect(bodies.join('\n')).not.toContain(SENTINEL);
      expect(put.body.data).toEqual(expect.objectContaining({ name: 'api-token', hint: '••••0042' }));
      expect(Object.keys(put.body.data).sort()).toEqual(['createdAt', 'hint', 'label', 'name', 'updatedAt', 'updatedBy']);
    });
  });
});
