import request from 'supertest';
import {
  TestContext,
  createTestApp,
  closeTestApp,
} from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { createMockTestUser, authHeader } from '../helpers/auth-mock.helper';

/**
 * Characterization of the user-settings wire format (issue #44).
 *
 * The expected bodies below were recorded against the implementation that
 * hard-coded the terminal namespace in the base settings service. The
 * namespace-registry refactor must keep them byte-identical, key order
 * included, so every assertion compares serialized JSON, not parsed objects.
 */

const UPDATED_AT = new Date('2026-01-02T03:04:05.000Z');

const DEFAULT_SHORTCUTS_JSON = [
  { id: '11111111-1111-4111-8111-111111111101', label: 'ESC', keystrokes: [{ modifiers: [], key: 'Escape' }] },
  { id: '11111111-1111-4111-8111-111111111102', label: 'Tab', keystrokes: [{ modifiers: [], key: 'Tab' }] },
  { id: '11111111-1111-4111-8111-111111111103', label: 'Shift+Tab', keystrokes: [{ modifiers: ['shift'], key: 'Tab' }] },
  { id: '11111111-1111-4111-8111-111111111104', label: 'Ctrl+C', keystrokes: [{ modifiers: ['ctrl'], key: 'c' }] },
  { id: '11111111-1111-4111-8111-111111111105', label: 'Ctrl+D', keystrokes: [{ modifiers: ['ctrl'], key: 'd' }] },
  { id: '11111111-1111-4111-8111-111111111106', label: '↑', keystrokes: [{ modifiers: [], key: 'ArrowUp' }] },
  { id: '11111111-1111-4111-8111-111111111107', label: '↓', keystrokes: [{ modifiers: [], key: 'ArrowDown' }] },
  { id: '11111111-1111-4111-8111-111111111108', label: '←', keystrokes: [{ modifiers: [], key: 'ArrowLeft' }] },
  { id: '11111111-1111-4111-8111-111111111109', label: '→', keystrokes: [{ modifiers: [], key: 'ArrowRight' }] },
];

const CUSTOM_SHORTCUT = {
  id: '22222222-2222-4222-8222-222222222201',
  label: 'Ctrl+B',
  keystrokes: [{ modifiers: ['ctrl'], key: 'b' }],
};

describe('User settings characterization', () => {
  let context: TestContext;
  let stored: { value: any; version: number } | null;

  beforeAll(async () => {
    context = await createTestApp({ useMockDatabase: true });
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(() => {
    resetPrismaMock();
    setupBaseMocks();
    stored = null;

    const row = (userId: string) => ({
      id: `settings-${userId}`,
      userId,
      value: stored!.value,
      version: stored!.version,
      updatedAt: UPDATED_AT,
    });

    const settings = context.prismaMock.userSettings as any;
    settings.findUnique.mockImplementation(async ({ where }: any) =>
      stored ? row(where.userId) : null,
    );
    settings.create.mockImplementation(async ({ data }: any) => {
      stored = { value: data.value, version: 1 };
      return row(data.userId);
    });
    settings.update.mockImplementation(async ({ where, data }: any) => {
      stored = { value: data.value, version: stored!.version + 1 };
      return row(where.userId);
    });
    (context.prismaMock.user.update as any).mockResolvedValue({});
  });

  const getBody = async (token: string) =>
    (
      await request(context.app.getHttpServer())
        .get('/api/user-settings')
        .set(authHeader(token))
        .expect(200)
    ).text;

  const patchBody = async (token: string, body: object) =>
    (
      await request(context.app.getHttpServer())
        .patch('/api/user-settings')
        .set(authHeader(token))
        .send(body)
        .expect(200)
    ).text;

  const dataOf = (text: string) => JSON.parse(text).data;

  it('GET for a new user returns defaults and stores them in the recorded shape', async () => {
    const user = await createMockTestUser(context);

    const text = await getBody(user.accessToken);

    expect(JSON.stringify(dataOf(text))).toBe(
      JSON.stringify({
        theme: 'system',
        profile: { useProviderImage: true },
        terminal: { showScrollButtons: true, keyShortcuts: DEFAULT_SHORTCUTS_JSON },
        updatedAt: UPDATED_AT.toISOString(),
        version: 1,
      }),
    );
    // Stored JSON for a new user: unchanged by the refactor.
    expect(JSON.stringify(stored!.value)).toBe(
      JSON.stringify({
        theme: 'system',
        profile: { useProviderImage: true },
        terminal: { showScrollButtons: true, keyShortcuts: DEFAULT_SHORTCUTS_JSON },
      }),
    );
  });

  it('GET for a user with custom shortcuts returns them untouched', async () => {
    const user = await createMockTestUser(context);
    stored = {
      value: {
        theme: 'dark',
        profile: { useProviderImage: false, displayName: 'Person A' },
        terminal: { showScrollButtons: false, keyShortcuts: [CUSTOM_SHORTCUT] },
      },
      version: 4,
    };

    const text = await getBody(user.accessToken);

    expect(JSON.stringify(dataOf(text))).toBe(
      JSON.stringify({
        theme: 'dark',
        profile: { useProviderImage: false, displayName: 'Person A' },
        terminal: { showScrollButtons: false, keyShortcuts: [CUSTOM_SHORTCUT] },
        updatedAt: UPDATED_AT.toISOString(),
        version: 4,
      }),
    );
  });

  it('GET for a legacy user without terminal settings fills the defaults without writing', async () => {
    const user = await createMockTestUser(context);
    stored = {
      value: { theme: 'light', profile: { useProviderImage: true } },
      version: 2,
    };

    const text = await getBody(user.accessToken);

    expect(JSON.stringify(dataOf(text))).toBe(
      JSON.stringify({
        theme: 'light',
        profile: { useProviderImage: true },
        terminal: { showScrollButtons: true, keyShortcuts: DEFAULT_SHORTCUTS_JSON },
        updatedAt: UPDATED_AT.toISOString(),
        version: 2,
      }),
    );
    expect(context.prismaMock.userSettings.update).not.toHaveBeenCalled();
    expect(stored.version).toBe(2);
  });

  it('GET for a user with showScrollButtons only fills the default shortcuts', async () => {
    const user = await createMockTestUser(context);
    stored = {
      value: {
        theme: 'system',
        profile: { useProviderImage: true },
        terminal: { showScrollButtons: false },
      },
      version: 3,
    };

    const text = await getBody(user.accessToken);

    expect(JSON.stringify(dataOf(text))).toBe(
      JSON.stringify({
        theme: 'system',
        profile: { useProviderImage: true },
        terminal: { showScrollButtons: false, keyShortcuts: DEFAULT_SHORTCUTS_JSON },
        updatedAt: UPDATED_AT.toISOString(),
        version: 3,
      }),
    );
  });

  it('PATCH theme keeps terminal settings and merges defaults into the stored value', async () => {
    const user = await createMockTestUser(context);
    stored = {
      value: {
        theme: 'system',
        profile: { useProviderImage: true },
        terminal: { showScrollButtons: false, keyShortcuts: [CUSTOM_SHORTCUT] },
      },
      version: 1,
    };

    const text = await patchBody(user.accessToken, { theme: 'dark' });

    const expected = {
      theme: 'dark',
      profile: { useProviderImage: true },
      terminal: { showScrollButtons: false, keyShortcuts: [CUSTOM_SHORTCUT] },
    };
    expect(JSON.stringify(dataOf(text))).toBe(
      JSON.stringify({ ...expected, updatedAt: UPDATED_AT.toISOString(), version: 2 }),
    );
    expect(JSON.stringify(stored!.value)).toBe(JSON.stringify(expected));
  });

  it('PATCH terminal.showScrollButtons leaves the shortcuts as they were', async () => {
    const user = await createMockTestUser(context);
    stored = {
      value: {
        theme: 'system',
        profile: { useProviderImage: true },
        terminal: { showScrollButtons: true, keyShortcuts: [CUSTOM_SHORTCUT] },
      },
      version: 1,
    };

    const text = await patchBody(user.accessToken, {
      terminal: { showScrollButtons: false },
    });

    expect(JSON.stringify(dataOf(text))).toBe(
      JSON.stringify({
        theme: 'system',
        profile: { useProviderImage: true },
        terminal: { showScrollButtons: false, keyShortcuts: [CUSTOM_SHORTCUT] },
        updatedAt: UPDATED_AT.toISOString(),
        version: 2,
      }),
    );
  });

  it('PATCH terminal.keyShortcuts replaces the whole list', async () => {
    const user = await createMockTestUser(context);
    stored = {
      value: {
        theme: 'system',
        profile: { useProviderImage: true },
        terminal: { showScrollButtons: true, keyShortcuts: DEFAULT_SHORTCUTS_JSON },
      },
      version: 1,
    };

    const text = await patchBody(user.accessToken, {
      terminal: { keyShortcuts: [CUSTOM_SHORTCUT] },
    });

    expect(JSON.stringify(dataOf(text))).toBe(
      JSON.stringify({
        theme: 'system',
        profile: { useProviderImage: true },
        terminal: { showScrollButtons: true, keyShortcuts: [CUSTOM_SHORTCUT] },
        updatedAt: UPDATED_AT.toISOString(),
        version: 2,
      }),
    );
  });

  it('PATCH on a legacy user materializes the terminal defaults', async () => {
    const user = await createMockTestUser(context);
    stored = {
      value: { theme: 'light', profile: { useProviderImage: true } },
      version: 1,
    };

    const text = await patchBody(user.accessToken, { theme: 'dark' });

    const expected = {
      theme: 'dark',
      profile: { useProviderImage: true },
      terminal: { showScrollButtons: true, keyShortcuts: DEFAULT_SHORTCUTS_JSON },
    };
    expect(JSON.stringify(dataOf(text))).toBe(
      JSON.stringify({ ...expected, updatedAt: UPDATED_AT.toISOString(), version: 2 }),
    );
    expect(JSON.stringify(stored!.value)).toBe(JSON.stringify(expected));
  });

  it('PUT without terminal stores and returns no terminal key', async () => {
    const user = await createMockTestUser(context);
    stored = {
      value: { theme: 'system', profile: { useProviderImage: true } },
      version: 1,
    };
    context.prismaMock.userSettings.upsert.mockImplementation(async ({ update }: any) => {
      stored = { value: update.value, version: stored!.version + 1 };
      return {
        id: 'settings-x',
        userId: user.id,
        value: stored.value,
        version: stored.version,
        updatedAt: UPDATED_AT,
      };
    });

    const res = await request(context.app.getHttpServer())
      .put('/api/user-settings')
      .set(authHeader(user.accessToken))
      .send({ theme: 'dark', profile: { useProviderImage: false } })
      .expect(200);

    expect(JSON.stringify(dataOf(res.text))).toBe(
      JSON.stringify({
        theme: 'dark',
        profile: { useProviderImage: false },
        updatedAt: UPDATED_AT.toISOString(),
        version: 2,
      }),
    );
  });

  it('PATCH rejects an invalid shortcut with 400', async () => {
    const user = await createMockTestUser(context);
    stored = {
      value: { theme: 'system', profile: { useProviderImage: true } },
      version: 1,
    };

    await request(context.app.getHttpServer())
      .patch('/api/user-settings')
      .set(authHeader(user.accessToken))
      .send({ terminal: { keyShortcuts: [{ id: 'not-a-uuid', label: 'x' }] } })
      .expect(400);
  });
});
