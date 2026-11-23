// =============================================================================
// The platform settings slice over a real database (issue #48)
// =============================================================================
//
// Boots the full `AppModule` against the migrated and SEEDED database (POSTGRES_*;
// `npm run prisma:migrate` and `npm run prisma:seed` first) and walks the settings
// routes the way the web does: the `global` system row (ui, features, the new terminal
// namespace and its bounds), a new user's stored document (the terminal defaults the
// identity slice seeds), a row written before #48 (legacy `profile` flags) and the
// stored shape after a write. The system row is shared, so every change is restored.
// Every user has a unique `@example.test` address and is deleted at the end.
// Run with `npm run test:db`.
// =============================================================================

import { randomBytes } from 'node:crypto';
import request from 'supertest';

import { closeTestApp, createTestApp, TestContext } from '../helpers/test-app.helper';

const RUN = randomBytes(4).toString('hex');
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const TERMINAL_DEFAULTS = {
  detachAfterMinutes: 60,
  terminateDetachedAfterHours: 12,
  purgeTerminatedAfterDays: 3,
  doctorProbeProfileId: null,
};

describe('Settings (real database)', () => {
  let context: TestContext;
  const createdEmails: string[] = [];
  const server = () => context.app.getHttpServer();

  async function login(name: string, role: 'admin' | 'contributor') {
    const email = `settings-${name}-${RUN}@example.test`;
    createdEmails.push(email);
    const response = await request(server()).post('/api/auth/test/login').send({ email, role }).expect(302);
    const accessToken = new URL(response.headers.location).searchParams.get('token') as string;
    return { email, accessToken };
  }

  beforeAll(async () => {
    context = await createTestApp({ useMockDatabase: false });
  });

  afterAll(async () => {
    await context.prisma.user.deleteMany({ where: { email: { in: createdEmails } } });
    await closeTestApp(context);
  });

  describe('system settings', () => {
    it('reads the global row with ui, features and the terminal namespace in the recorded order', async () => {
      const admin = await login('sys-read', 'admin');

      const response = await request(server()).get('/api/system-settings').set(bearer(admin.accessToken)).expect(200);

      const data = response.body.data;
      expect(Object.keys(data).slice(0, 3)).toEqual(['ui', 'features', 'terminal']);
      expect(data.ui).toEqual({ allowUserThemeOverride: expect.any(Boolean) });
      expect(data.features).toEqual(expect.any(Object));
      expect(data.terminal).toEqual(expect.objectContaining({ detachAfterMinutes: expect.any(Number) }));
      expect(data.security).toEqual({ jwtAccessTtlMinutes: expect.any(Number), refreshTtlDays: expect.any(Number) });
      expect(data.version).toEqual(expect.any(Number));
    });

    it('stores a terminal threshold change, enforces the bounds and records an audit event; the change is then undone', async () => {
      const admin = await login('sys-write', 'admin');
      const before = (await request(server()).get('/api/system-settings').set(bearer(admin.accessToken)).expect(200)).body.data;

      const changed = await request(server())
        .patch('/api/system-settings')
        .set(bearer(admin.accessToken))
        .send({ terminal: { detachAfterMinutes: 90, purgeTerminatedAfterDays: 7 } })
        .expect(200);
      expect(changed.body.data.terminal).toEqual({
        ...before.terminal,
        detachAfterMinutes: 90,
        purgeTerminatedAfterDays: 7,
      });
      expect(changed.body.data.version).toBe(before.version + 1);

      // The stored row carries the namespace, next to the keys it has always held.
      const row = await context.prisma.systemSettings.findUnique({ where: { key: 'global' } });
      expect((row!.value as any).terminal).toEqual(changed.body.data.terminal);
      expect((row!.value as any).ui).toEqual(before.ui);

      for (const terminal of [{ detachAfterMinutes: 4 }, { terminateDetachedAfterHours: 721 }, { doctorProbeProfileId: 'srv-1' }]) {
        await request(server()).patch('/api/system-settings').set(bearer(admin.accessToken)).send({ terminal }).expect(400);
      }

      // A stale If-Match is refused.
      await request(server())
        .patch('/api/system-settings')
        .set(bearer(admin.accessToken))
        .set('If-Match', String(before.version))
        .send({ terminal: { detachAfterMinutes: 30 } })
        .expect(409);

      const audit = await context.prisma.auditEvent.findFirst({
        where: { actorUserId: { not: null }, action: { contains: 'settings' }, createdAt: { gte: new Date(Date.now() - 60_000) } },
        orderBy: { createdAt: 'desc' },
      });
      expect(audit).not.toBeNull();

      // Undo.
      await request(server())
        .patch('/api/system-settings')
        .set(bearer(admin.accessToken))
        .send({ terminal: before.terminal })
        .expect(200);
    });

    it('refuses a contributor, who holds no system_settings permission', async () => {
      const contributor = await login('sys-denied', 'contributor');

      await request(server()).get('/api/system-settings').set(bearer(contributor.accessToken)).expect(403);
      await request(server()).patch('/api/system-settings').set(bearer(contributor.accessToken)).send({}).expect(403);
    });
  });

  describe('user settings', () => {
    it('starts a new user with the terminal defaults stored, as ShellKeep always created them', async () => {
      const user = await login('user-new', 'contributor');

      const response = await request(server()).get('/api/user-settings').set(bearer(user.accessToken)).expect(200);

      expect(response.body.data.theme).toBe('system');
      expect(response.body.data.profile).toEqual({ imageSource: 'provider', imageObjectId: null });
      expect(response.body.data.terminal.showScrollButtons).toBe(true);
      expect(response.body.data.terminal.keyShortcuts).toHaveLength(9);
    });

    it('saves terminal preferences and a shortcut list, and loads them back', async () => {
      const user = await login('user-terminal', 'contributor');
      const shortcut = {
        id: '22222222-2222-4222-8222-222222222201',
        label: 'Ctrl+B',
        keystrokes: [{ modifiers: ['ctrl'], key: 'b' }],
      };

      await request(server())
        .patch('/api/user-settings')
        .set(bearer(user.accessToken))
        .send({ terminal: { showScrollButtons: false, keyShortcuts: [shortcut] } })
        .expect(200);

      const loaded = await request(server()).get('/api/user-settings').set(bearer(user.accessToken)).expect(200);
      expect(loaded.body.data.terminal).toEqual({ showScrollButtons: false, keyShortcuts: [shortcut] });

      // Too many shortcuts (the cap is 50) and a keystroke without modifiers are refused.
      const many = Array.from({ length: 51 }, (_, i) => ({
        ...shortcut,
        id: `${String(i).padStart(8, '0')}-2222-4222-8222-222222222201`,
      }));
      await request(server()).patch('/api/user-settings').set(bearer(user.accessToken)).send({ terminal: { keyShortcuts: many } }).expect(400);
      await request(server())
        .patch('/api/user-settings')
        .set(bearer(user.accessToken))
        .send({ terminal: { keyShortcuts: [{ ...shortcut, keystrokes: [{ key: 'b' }] }] } })
        .expect(400);
    });

    it('reads a row written before #48 and stores the normalized profile on the next write, keeping terminal', async () => {
      const user = await login('user-legacy', 'contributor');
      const row = await context.prisma.user.findUnique({ where: { email: user.email }, select: { id: true } });
      const legacy = {
        theme: 'dark',
        profile: { displayName: 'Person A', useProviderImage: false, customImageUrl: 'https://example.test/a.png' },
        terminal: { showScrollButtons: false },
      };
      await context.prisma.userSettings.update({ where: { userId: row!.id }, data: { value: legacy } });

      const read = await request(server()).get('/api/user-settings').set(bearer(user.accessToken)).expect(200);
      expect(read.body.data.profile).toEqual({ displayName: 'Person A', imageSource: 'none', imageObjectId: null });
      expect(read.body.data.terminal).toEqual({ showScrollButtons: false });

      await request(server()).patch('/api/user-settings').set(bearer(user.accessToken)).send({ theme: 'light' }).expect(200);

      const stored = await context.prisma.userSettings.findUnique({ where: { userId: row!.id } });
      expect(stored!.value).toEqual({
        theme: 'light',
        profile: { displayName: 'Person A', imageSource: 'none', imageObjectId: null },
        terminal: { showScrollButtons: false },
      });
    });

    it('refuses an uploaded picture that was not uploaded (the storage slice arrives with #50)', async () => {
      const user = await login('user-avatar', 'contributor');

      await request(server())
        .patch('/api/user-settings')
        .set(bearer(user.accessToken))
        .send({ profile: { imageSource: 'upload', imageObjectId: '3f2b8d4e-7a1c-4e5d-9b6a-1c2d3e4f5a6b' } })
        .expect(400);
    });

    it('answers 401 without a token', async () => {
      await request(server()).get('/api/user-settings').expect(401);
    });
  });
});
