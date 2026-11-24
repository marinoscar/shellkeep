import { vi } from 'vitest';

// ink's chalk picks its colour level when it is first imported, and a test run
// has no TTY, so it would draw no colour at all. Force truecolor for this file
// only (vitest isolates modules per file), before anything imports ink:
// FORCE_COLOR turns colour on, COLORTERM picks truecolor over a TERM that
// would otherwise cap it at 16 colours.
vi.hoisted(() => {
  process.env.FORCE_COLOR = '3';
  process.env.COLORTERM = 'truecolor';
});

import { DashboardSource, resolveTuiTheme } from '@marinoscar/platform-cli/tui';
import { fakeEmitterFeed, renderTuiScreen, stripAnsi } from '@marinoscar/platform-cli/tui/testing';
import { BRAND } from '@shellkeep/shared';
import { describe, expect, it } from 'vitest';

import { APP_TUI_THEME } from '../app.js';

import type { RunsPoll } from './runs.feed.js';
import { runsReducer } from './runs.feed.js';
import { createRunsScreen } from './runs.screen.js';
import { createServersScreen } from './servers.screen.js';
import { createSessionsScreen } from './sessions.screen.js';

// #148: the screens draw their error and warning lines through the theme, so
// they take the brand tones and drop colour under NO_COLOR, never ink literals.
describe('the screens colour through the TUI theme', () => {
  const brandTheme = resolveTuiTheme({ overrides: APP_TUI_THEME, env: {}, noColor: false });
  /** ink's truecolor foreground sequence for a `#RRGGBB` token. */
  const fg = (hex: string): string =>
    `38;2;${[1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)).join(';')}m`;
  /** Any SGR foreground colour: 16-colour, bright, 256-colour or truecolor. */
  const FOREGROUND = /\u001b\[(3[0-7]|9[0-7]|38;)/;
  const failing = () => ({
    list: async (): Promise<never> => {
      throw new Error('Not logged in. Run `shellkeep login` first');
    },
    test: vi.fn(),
  });

  it('draws a failed load in the theme error tone, and plain in monochrome', async () => {
    for (const Screen of [createServersScreen(failing), createSessionsScreen(failing, vi.fn())]) {
      const coloured = await renderTuiScreen(Screen, { theme: brandTheme });
      await coloured.waitForFrame((text) => text.includes('Not logged in'));
      expect(coloured.lastFrame()).toContain(fg(BRAND.dark.err));
      expect(coloured.lastFrame()).not.toContain('\u001b[31m');
      coloured.unmount();

      const mono = await renderTuiScreen(Screen, { theme: 'mono' });
      await mono.waitForFrame((text) => text.includes('Not logged in'));
      // Bold and inverse may stay; no foreground colour does.
      expect(mono.lastFrame() ?? '').not.toMatch(FOREGROUND);
      mono.unmount();
    }
  });

  it('draws an unreachable poll on the Runs screen in the theme warning tone', async () => {
    const feed = fakeEmitterFeed<RunsPoll>();
    const Screen = createRunsScreen(() => ({ dashboard: new DashboardSource(runsReducer, feed), detail: vi.fn() }));
    const screen = await renderTuiScreen(Screen, { theme: brandTheme });
    feed.event({
      kind: 'ok',
      at: '2026-10-01T00:00:00.000Z',
      runs: [{ id: 'r1', runbook: 'Patch hosts', status: 'running', trigger: 'manual', createdAt: '2026-10-01T00:00:00.000Z', finishedAt: null }],
    });
    await screen.waitForFrame((text) => stripAnsi(text).includes('Patch hosts'));
    feed.disconnect('connection refused');
    await screen.waitForFrame((text) => stripAnsi(text).includes('Not reachable'));
    const frame = screen.lastFrame() ?? '';
    expect(frame).toContain(fg(BRAND.dark.warn));
    expect(frame).not.toContain('\u001b[33m');
    screen.unmount();
  });

  it('draws a forbidden Runs list in the theme error tone', async () => {
    const feed = fakeEmitterFeed<RunsPoll>();
    const Screen = createRunsScreen(() => ({ dashboard: new DashboardSource(runsReducer, feed), detail: vi.fn() }));
    const screen = await renderTuiScreen(Screen, { theme: brandTheme });
    feed.event({ kind: 'forbidden', at: 'now', message: 'Your account does not have the runbooks:read permission.' });
    await screen.waitForFrame((text) => stripAnsi(text).includes('runbooks:read'));
    const frame = screen.lastFrame() ?? '';
    expect(frame).toContain(fg(BRAND.dark.err));
    screen.unmount();
  });
});
