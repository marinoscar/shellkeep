import { renderTuiScreen, stripAnsi } from '@marinoscar/platform-cli/tui/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ServerRow } from '../commands/servers-list.js';
import type { ServerTestReport } from '../commands/servers-test.js';
import type { SessionRow } from '../commands/sessions-list.js';

import { takePendingAttach } from './pending-attach.js';
import { serversScreen, sessionsScreen } from './screens.js';
import { createServersScreen } from './servers.screen.js';
import { createSessionsScreen } from './sessions.screen.js';

const server = (id: string, name: string, trusted: boolean): ServerRow => ({
  id,
  name,
  hostname: `${name}.example.test`,
  port: 22,
  username: 'deploy',
  authMethod: 'key',
  tags: [],
  color: null,
  hostKeyTrusted: trusted,
  hostKeyAlgorithm: null,
  hostKeyTrustedAt: null,
  createdAt: null,
  updatedAt: null,
});

const session = (id: string, name: string, status: string): SessionRow => ({
  id,
  name,
  status,
  serverProfileId: 'p1',
  server: { name: 'alpha', hostname: 'alpha.example.test', port: 22, username: 'deploy' },
  cols: 80,
  rows: 24,
  lastActivityAt: null,
  createdAt: null,
});


afterEach(() => takePendingAttach());

describe('the screens are registered lazily, after the platform screens', () => {
  it('declares routes, labels and orders above the built-ins', () => {
    expect([serversScreen.route, sessionsScreen.route]).toEqual(['servers', 'sessions']);
    expect(serversScreen.order).toBeGreaterThan(60);
    expect(sessionsScreen.order).toBeGreaterThan(serversScreen.order);
    expect(serversScreen.component).toBeUndefined();
    expect(typeof serversScreen.load).toBe('function');
  });
});

describe('the Servers screen', () => {
  const rows = [server('s1', 'alpha', true), server('s2', 'beta', false)];

  it('lists the profiles with their host-key state', async () => {
    const Screen = createServersScreen(() => ({ list: async () => rows, test: vi.fn() }));
    const screen = await renderTuiScreen(Screen);
    const frame = await screen.waitForFrame((text) => stripAnsi(text).includes('alpha'));

    expect(stripAnsi(frame)).toContain('deploy@alpha.example.test:22');
    expect(stripAnsi(frame)).toContain('trusted');
    expect(stripAnsi(frame)).toContain('not trusted');
    screen.unmount();
  });

  it('tests the selected profile on `t` and shows the latency and host-key status', async () => {
    const test = vi.fn(
      async (id: string): Promise<ServerTestReport> => ({
        id,
        success: true,
        latencyMs: 37,
        hostKey: { status: 'trusted', presentedFingerprint: null },
        error: null,
        code: null,
      }),
    );
    const Screen = createServersScreen(() => ({ list: async () => rows, test }));
    const screen = await renderTuiScreen(Screen);
    await screen.waitForFrame((text) => stripAnsi(text).includes('beta'));

    await screen.press('down');
    await screen.type('t');
    await screen.waitForFrame((text) => stripAnsi(text).includes('OK in 37 ms'));

    expect(test).toHaveBeenCalledWith('s2');
    screen.unmount();
  });

  it('shows a failed load and returns to the menu on esc', async () => {
    const Screen = createServersScreen(() => ({
      list: async () => {
        throw new Error('Not logged in. Run `shellkeep login` first');
      },
      test: vi.fn(),
    }));
    const screen = await renderTuiScreen(Screen);
    await screen.waitForFrame((text) => stripAnsi(text).includes('Not logged in'));

    await screen.press('esc');
    await screen.waitForFrame((text) => text.includes('[back at the menu]'));
    expect(screen.nav.stack.map((frame) => frame.kind)).toEqual(['menu']);
    screen.unmount();
  });

  it('renders at a narrow width without colour', async () => {
    const Screen = createServersScreen(() => ({ list: async () => rows, test: vi.fn() }));
    const screen = await renderTuiScreen(Screen, { theme: 'mono', columns: 30 });
    await screen.waitForFrame((text) => stripAnsi(text).includes('alpha'));
    expect(screen.crashed()).toBeUndefined();
    screen.unmount();
  });
});

describe('the Sessions screen', () => {
  const rows = [session('a1', 'build shell', 'active'), session('a2', 'old shell', 'terminated')];

  it('lists the sessions', async () => {
    const Screen = createSessionsScreen(() => ({ list: async () => rows }), vi.fn());
    const screen = await renderTuiScreen(Screen);
    const frame = await screen.waitForFrame((text) => stripAnsi(text).includes('build shell'));

    expect(stripAnsi(frame)).toContain('active');
    expect(stripAnsi(frame)).toContain('alpha');
    screen.unmount();
  });

  it('hands the selected session to the bridge on enter', async () => {
    const attach = vi.fn();
    const Screen = createSessionsScreen(() => ({ list: async () => rows }), attach);
    const screen = await renderTuiScreen(Screen);
    await screen.waitForFrame((text) => stripAnsi(text).includes('build shell'));

    await screen.press('enter');

    expect(attach).toHaveBeenCalledWith('a1');
    screen.unmount();
  });

  it('refuses to attach a terminated session', async () => {
    const attach = vi.fn();
    const Screen = createSessionsScreen(() => ({ list: async () => rows }), attach);
    const screen = await renderTuiScreen(Screen);
    await screen.waitForFrame((text) => stripAnsi(text).includes('old shell'));

    await screen.press('down');
    await screen.press('enter');
    await screen.waitForFrame((text) => stripAnsi(text).includes('terminated.'));

    expect(attach).not.toHaveBeenCalled();
    screen.unmount();
  });

  it('records the attach for runApp by default', async () => {
    const Screen = createSessionsScreen(() => ({ list: async () => rows }));
    const screen = await renderTuiScreen(Screen);
    await screen.waitForFrame((text) => stripAnsi(text).includes('build shell'));

    await screen.press('a');

    expect(takePendingAttach()).toBe('a1');
    screen.unmount();
  });
});
