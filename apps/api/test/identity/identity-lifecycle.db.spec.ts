// =============================================================================
// Identity over a real database: sign-in, sessions, PATs, the device flow (#47)
// =============================================================================
//
// The platform's identity slice replaced ShellKeep's own auth, users, allowlist,
// device-auth and test-auth modules. This boots the full `AppModule` against the
// migrated and SEEDED database (POSTGRES_*; `npm run prisma:migrate` and
// `npm run prisma:seed` first) and walks the flows end to end: the test login,
// `GET /api/auth/me`, refresh-cookie rotation, logout, a personal access token's
// create/use/revoke, the device flow (code, activate, token) and the domain
// routes under each role. Google's redirect needs Google, so it is not driven here.
//
// Every user it creates has a unique `@example.test` address and is deleted at the
// end. Run with `npm run test:db`.
// =============================================================================

import { randomBytes } from 'node:crypto';
import request from 'supertest';

import { closeTestApp, createTestApp, TestContext } from '../helpers/test-app.helper';

const RUN = randomBytes(4).toString('hex');
const email = (name: string) => `${name}-${RUN}@example.test`;
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('Identity lifecycle (real database)', () => {
  let context: TestContext;
  const createdEmails: string[] = [];

  const server = () => context.app.getHttpServer();

  /** Test login: a 302 to the web callback carrying the access token, and the refresh cookie. */
  async function login(name: string, role: 'admin' | 'contributor' | 'viewer') {
    const address = email(name);
    createdEmails.push(address);
    const response = await request(server()).post('/api/auth/test/login').send({ email: address, role }).expect(302);
    const location = new URL(response.headers.location);
    const accessToken = location.searchParams.get('token') as string;
    const cookie = (response.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('refresh_token='))!;
    return { email: address, accessToken, cookie: cookie.split(';')[0], setCookie: cookie };
  }

  beforeAll(async () => {
    // The platform credential store's cipher reads this when a server profile is created
    // (SSH secrets, #48). `.env.test` sets it; a bare environment gets a throwaway key.
    process.env.SECRETS_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');
    context = await createTestApp({ useMockDatabase: false });
  });

  afterAll(async () => {
    await context.prisma.user.deleteMany({ where: { email: { in: createdEmails } } });
    await closeTestApp(context);
  });

  it('lists Google as the enabled sign-in provider without authentication', async () => {
    const response = await request(server()).get('/api/auth/providers').expect(200);

    expect(response.body.data.providers).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'google' })]));
  });

  describe('test login and GET /api/auth/me', () => {
    it.each([
      ['admin', ['admin', 'org_admin']],
      ['contributor', ['contributor']],
      ['viewer', ['viewer']],
    ] as const)('signs in a %s with the roles and permissions the seed grants', async (role, roleNames) => {
      const session = await login(`me-${role}`, role);

      const response = await request(server()).get('/api/auth/me').set(bearer(session.accessToken)).expect(200);

      expect(response.body.data.email).toBe(session.email);
      expect(response.body.data.roles.map((r: { name: string }) => r.name).sort()).toEqual([...roleNames].sort());
      const permissions: string[] = response.body.data.permissions;
      expect(permissions.includes('sessions:write')).toBe(role !== 'viewer');
      expect(permissions).toContain('sessions:read');
      expect(permissions.includes('users:read')).toBe(role === 'admin');
    });

    it('sets the refresh token as an HttpOnly cookie scoped to /api/auth', async () => {
      const session = await login('cookie', 'viewer');

      expect(session.setCookie).toMatch(/HttpOnly/i);
      expect(session.setCookie).toMatch(/Path=\/api\/auth/);
    });

    it('rejects a request without a token, and a token that is not ours', async () => {
      await request(server()).get('/api/auth/me').expect(401);
      await request(server()).get('/api/auth/me').set(bearer('not.a.token')).expect(401);
    });
  });

  describe('refresh and logout', () => {
    it('rotates the refresh cookie: the new one works, the old one is refused', async () => {
      const session = await login('rotate', 'contributor');

      const refreshed = await request(server()).post('/api/auth/refresh').set('Cookie', session.cookie).expect(200);
      expect(refreshed.body.data.accessToken).toEqual(expect.any(String));
      const nextCookie = (refreshed.headers['set-cookie'] as unknown as string[])
        .find((c) => c.startsWith('refresh_token='))!
        .split(';')[0];
      expect(nextCookie).not.toBe(session.cookie);

      await request(server()).post('/api/auth/refresh').set('Cookie', nextCookie).expect(200);
      await request(server()).post('/api/auth/refresh').set('Cookie', session.cookie).expect(401);
    });

    it('refuses a refresh with no cookie', async () => {
      await request(server()).post('/api/auth/refresh').expect(401);
    });

    it('logout invalidates the refresh token', async () => {
      const session = await login('logout', 'contributor');

      await request(server()).post('/api/auth/logout').set(bearer(session.accessToken)).set('Cookie', session.cookie).expect(204);

      await request(server()).post('/api/auth/refresh').set('Cookie', session.cookie).expect(401);
    });

    it('logout-all invalidates every refresh token of the user', async () => {
      const first = await login('logout-all', 'contributor');
      const second = await login('logout-all', 'contributor');

      await request(server()).post('/api/auth/logout-all').set(bearer(first.accessToken)).expect(204);

      await request(server()).post('/api/auth/refresh').set('Cookie', first.cookie).expect(401);
      await request(server()).post('/api/auth/refresh').set('Cookie', second.cookie).expect(401);
    });
  });

  describe('personal access tokens', () => {
    it('creates a token, uses it as a bearer credential, and stops honouring it once revoked', async () => {
      const session = await login('pat', 'contributor');

      const created = await request(server())
        .post('/api/pat')
        .set(bearer(session.accessToken))
        .send({ name: 'ci', durationValue: 1, durationUnit: 'days' })
        .expect(201);
      const token: string = created.body.data.token;
      expect(token.startsWith('pat_')).toBe(true);

      await request(server()).get('/api/auth/me').set(bearer(token)).expect(200);
      await request(server()).get('/api/sessions').set(bearer(token)).expect(200);

      await request(server()).delete(`/api/pat/${created.body.data.id}`).set(bearer(session.accessToken)).expect(204);

      await request(server()).get('/api/auth/me').set(bearer(token)).expect(401);
    });
  });

  describe('device authorization flow (RFC 8628)', () => {
    it('issues a code, lets a signed-in user approve it, and exchanges it for a token', async () => {
      const approver = await login('device', 'contributor');

      const code = await request(server())
        .post('/api/auth/device/code')
        .send({ clientInfo: { deviceName: 'laptop', userAgent: 'jest' } })
        .expect(200);
      const { deviceCode, userCode } = code.body.data;

      await request(server())
        .post('/api/auth/device/authorize')
        .set(bearer(approver.accessToken))
        .send({ userCode, approve: true })
        .expect(200);

      const token = await request(server()).post('/api/auth/device/token').send({ deviceCode }).expect(200);
      await request(server()).get('/api/auth/me').set(bearer(token.body.data.accessToken)).expect(200);
    });
  });

  describe('the domain routes under each role', () => {
    it('lets a Viewer read server profiles and sessions, and refuses every write', async () => {
      const viewer = await login('domain-viewer', 'viewer');

      await request(server()).get('/api/server-profiles').set(bearer(viewer.accessToken)).expect(200);
      await request(server()).get('/api/sessions').set(bearer(viewer.accessToken)).expect(200);
      await request(server())
        .post('/api/server-profiles')
        .set(bearer(viewer.accessToken))
        .send({ name: 'srv', hostname: 'server-a.example.test', port: 22, username: 'u', authMethod: 'agent' })
        .expect(403);
    });

    it('stamps a Contributor’s profile and session with the default organization and hides them from others', async () => {
      const owner = await login('domain-owner', 'contributor');
      const other = await login('domain-other', 'contributor');
      const defaultOrg = await context.prisma.organization.findFirstOrThrow({ where: { isDefault: true } });

      const profile = await request(server())
        .post('/api/server-profiles')
        .set(bearer(owner.accessToken))
        .send({ name: 'srv', hostname: 'server-a.example.test', port: 22, username: 'u', authMethod: 'agent' })
        .expect(201);
      const session = await request(server())
        .post('/api/sessions')
        .set(bearer(owner.accessToken))
        .send({ serverProfileId: profile.body.data.id })
        .expect(201);

      const rows = {
        profile: await context.prisma.serverProfile.findUniqueOrThrow({ where: { id: profile.body.data.id } }),
        session: await context.prisma.terminalSession.findUniqueOrThrow({ where: { id: session.body.data.id } }),
      };
      expect(rows.profile.orgId).toBe(defaultOrg.id);
      expect(rows.session.orgId).toBe(defaultOrg.id);

      await request(server()).get(`/api/server-profiles/${profile.body.data.id}`).set(bearer(other.accessToken)).expect(404);
      await request(server()).get(`/api/sessions/${session.body.data.id}`).set(bearer(other.accessToken)).expect(404);

      const audit = await context.prisma.auditEvent.findMany({
        where: { targetId: { in: [profile.body.data.id, session.body.data.id] } },
        select: { action: true, meta: true },
      });
      expect(audit.map((event) => event.action).sort()).toEqual(['server_profile.create', 'terminal_session.create']);
      expect(JSON.stringify(audit)).not.toMatch(/password|privateKey|passphrase/i);
    });
  });
});
