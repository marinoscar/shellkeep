import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router-dom';
import { Box } from '@mui/material';
import { AiConfigContext, AI_CONFIG_DISABLED } from '@marinoscar/platform-web/ai/headless';
import type { ReactNode } from 'react';
import { render, mockUser } from '../utils/test-utils';
import type { TerminalSession } from '../../types';

// =============================================================================
// The terminal workspace (#77): tabs and splits from the URL, hidden panes,
// the AI gate, the key bar on the keyboard, and the docs/SCROLLING.md layout
// invariants as a DOM walk. The real TerminalView renders (its xterm hook is
// mocked), so the walk covers the actual component tree.
// =============================================================================

const { mockSendInput, layoutMock } = vi.hoisted(() => ({
  mockSendInput: vi.fn(),
  layoutMock: { isPhone: false, isWide: true },
}));

vi.mock('../../hooks/useTerminal', () => ({
  useTerminal: vi.fn(() => ({
    isConnected: true,
    error: null,
    reconnect: vi.fn(),
    search: vi.fn(),
    sendInput: mockSendInput,
    terminal: { current: null },
    hostKeyRefusal: null,
    retryConnect: vi.fn(),
    dismissHostKey: vi.fn(),
    latencyMs: 12,
    size: { cols: 80, rows: 24 },
  })),
}));
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));
vi.mock('../../components/terminal/useTerminalLayout', () => ({
  useTerminalLayout: () => layoutMock,
}));
vi.mock('../../services/api', () => ({
  api: { getAccessToken: vi.fn(() => 'mock-token') },
  platformApi: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock('../../services/storage', () => ({
  uploadPastedImage: vi.fn(),
  uploadTerminalFile: vi.fn(),
  storageErrorMessage: vi.fn((_e: unknown, fallback: string) => fallback),
}));
vi.mock('../../services/terminal-api', () => ({
  getSession: vi.fn(),
  updateSession: vi.fn(),
  createSession: vi.fn(),
  downloadSessionHistory: vi.fn(),
  getServerProfile: vi.fn(() => new Promise(() => {})),
  getSessions: vi.fn(() => Promise.resolve({ items: [], total: 0, page: 1, pageSize: 100 })),
  trustHostKey: vi.fn(),
}));
vi.mock('../../hooks/useTerminalSettings', () => ({
  useTerminalSettings: vi.fn(() => ({
    settings: { terminal: { showScrollButtons: true, keyShortcuts: [] } },
    updateSettings: vi.fn().mockResolvedValue(undefined),
  })),
}));

import TerminalWorkspacePage, { keyDockOffset } from '../../pages/TerminalWorkspacePage';
import { getSession, updateSession } from '../../services/terminal-api';

const session = (id: string, name: string): TerminalSession => ({
  id,
  name,
  status: 'active',
  tmuxSessionId: `sk-${id}`,
  cols: 80,
  rows: 24,
  lastActivityAt: new Date().toISOString(),
  terminatedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  serverProfileId: 'profile-1',
  serverProfile: { name: 'Server A', hostname: 'server-a.example.test', port: 22, username: 'person-a', color: 'default' },
});
const SESSIONS: Record<string, TerminalSession> = {
  a: session('a', 'alpha'),
  b: session('b', 'beta'),
  c: session('c', 'gamma'),
};

const writer = { ...mockUser, permissions: [...mockUser.permissions, 'sessions:read', 'sessions:write'] };

let currentLocation = '';
function LocationProbe() {
  const location = useLocation();
  currentLocation = location.pathname + location.search;
  return null;
}

function renderWorkspace(route: string, options: { user?: typeof writer; wrap?: (n: ReactNode) => ReactNode } = {}) {
  const page = (
    <Box component="main" sx={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Routes>
        <Route
          path="/sessions/:id"
          element={
            <>
              <TerminalWorkspacePage />
              <LocationProbe />
            </>
          }
        />
        <Route path="/sessions" element={<p>session list</p>} />
      </Routes>
    </Box>
  );
  return render(<>{options.wrap ? options.wrap(page) : page}</>, {
    wrapperOptions: { route, user: options.user ?? writer },
  });
}

const tabs = () => screen.getAllByRole('tab');
const pane = (id: string) => screen.getByTestId(`terminal-pane-${id}`);

/**
 * jsdom computes no layout, so its `offsetParent` is always `null`. This
 * implements the part of the CSSOM rule the workspace depends on: `null` when
 * the element or an ancestor is `display: none` (or it is detached), the
 * nearest positioned ancestor otherwise. `visibility: hidden` does NOT null it.
 */
function installOffsetParent() {
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent');
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get(this: HTMLElement) {
      if (!this.isConnected) return null;
      if (getComputedStyle(this).display === 'none') return null;
      for (let el = this.parentElement; el; el = el.parentElement) {
        if (getComputedStyle(el).display === 'none') return null;
      }
      for (let el = this.parentElement; el; el = el.parentElement) {
        if (getComputedStyle(el).position !== 'static' || el === document.body) return el;
      }
      return document.body;
    },
  });
  return () => {
    if (original) Object.defineProperty(HTMLElement.prototype, 'offsetParent', original);
  };
}

describe('TerminalWorkspacePage: tabs and splits (#77)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    layoutMock.isPhone = false;
    layoutMock.isWide = true;
    vi.mocked(getSession).mockImplementation((id: string) =>
      SESSIONS[id] ? Promise.resolve(SESSIONS[id]) : Promise.reject(new Error('not found')),
    );
  });

  it('restores the tabs and the active session from the URL', async () => {
    renderWorkspace('/sessions/b?tabs=a,b,c');
    await waitFor(() => expect(tabs().map((t) => t.textContent)).toEqual(['alphaServer A', 'betaServer A', 'gammaServer A']));
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('beta');
    // Every tab keeps a mounted pane; only the active one is on screen.
    expect(screen.getAllByTestId('terminal-xterm-host')).toHaveLength(3);
    expect(pane('b')).toHaveAttribute('data-pane-visible', 'true');
    expect(pane('a')).toHaveAttribute('data-pane-visible', 'false');
  });

  it('opens a bare /sessions/:id as a tab and writes the layout into the URL', async () => {
    renderWorkspace('/sessions/a');
    await waitFor(() => expect(currentLocation).toBe('/sessions/a?tabs=a'));
    expect(tabs()).toHaveLength(1);
  });

  it('restores the stored layout when the URL carries none', async () => {
    window.localStorage.setItem(
      `shellkeep.terminal.workspace.v1:${writer.id}`,
      JSON.stringify({ tabs: ['a', 'b'], split: 'v:a|b' }),
    );
    renderWorkspace('/sessions/a');
    await waitFor(() => expect(currentLocation).toBe('/sessions/a?tabs=a,b&split=v:a|b'));
    expect(screen.getByTestId('terminal-panes')).toHaveAttribute('data-split', 'v');
  });

  it('switches tabs without remounting the panes', async () => {
    renderWorkspace('/sessions/a?tabs=a,b');
    await waitFor(() => expect(tabs()).toHaveLength(2));
    const hostB = within(pane('b')).getByTestId('terminal-xterm-host');
    await userEvent.click(screen.getByTestId('workspace-tab-b'));
    await waitFor(() => expect(currentLocation).toBe('/sessions/b?tabs=a,b'));
    expect(pane('b')).toHaveAttribute('data-pane-visible', 'true');
    expect(within(pane('b')).getByTestId('terminal-xterm-host')).toBe(hostB);
  });

  it('closes a tab with its × and with a middle click', async () => {
    renderWorkspace('/sessions/a?tabs=a,b,c');
    await waitFor(() => expect(tabs()).toHaveLength(3));
    await userEvent.click(screen.getByRole('button', { name: 'Close gamma' }));
    await waitFor(() => expect(currentLocation).toBe('/sessions/a?tabs=a,b'));

    const tabB = screen.getByTestId('workspace-tab-b').parentElement!;
    act(() => {
      tabB.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    });
    await waitFor(() => expect(currentLocation).toBe('/sessions/a?tabs=a'));
    expect(screen.queryByTestId('terminal-pane-b')).not.toBeInTheDocument();
  });

  it('leaves the workspace when the last tab closes', async () => {
    renderWorkspace('/sessions/a?tabs=a');
    await waitFor(() => expect(tabs()).toHaveLength(1));
    await userEvent.click(screen.getByRole('button', { name: 'Close alpha' }));
    await waitFor(() => expect(screen.getByText('session list')).toBeInTheDocument());
  });

  it('drops a tab whose session is gone', async () => {
    renderWorkspace('/sessions/a?tabs=a,zz');
    await waitFor(() => expect(currentLocation).toBe('/sessions/a?tabs=a'));
  });

  it('renames a tab on double-click through PATCH /api/sessions/:id', async () => {
    vi.mocked(updateSession).mockResolvedValue({ ...SESSIONS.b, name: 'renamed' });
    renderWorkspace('/sessions/a?tabs=a,b');
    await waitFor(() => expect(tabs()).toHaveLength(2));
    await userEvent.dblClick(screen.getByTestId('workspace-tab-b'));
    const input = within(screen.getByRole('dialog')).getByLabelText('Session name');
    await userEvent.clear(input);
    await userEvent.type(input, 'renamed{Enter}');
    await waitFor(() => expect(updateSession).toHaveBeenCalledWith('b', { name: 'renamed' }));
    await waitFor(() => expect(screen.getByTestId('workspace-tab-b')).toHaveTextContent('renamed'));
  });

  it('creates a vertical split, switches it to horizontal, and closes a pane', async () => {
    renderWorkspace('/sessions/a?tabs=a,b');
    await waitFor(() => expect(tabs()).toHaveLength(2));

    // One other tab: the split opens straight away.
    await userEvent.click(screen.getByRole('button', { name: 'Split side by side' }));
    await waitFor(() => expect(currentLocation).toBe('/sessions/a?tabs=a,b&split=v:a|b'));
    expect(screen.getByTestId('terminal-panes')).toHaveAttribute('data-split', 'v');
    expect(pane('a')).toHaveAttribute('data-pane-visible', 'true');
    expect(pane('b')).toHaveAttribute('data-pane-visible', 'true');
    expect(screen.getByRole('separator', { name: 'Resize panes' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Split top and bottom' }));
    await waitFor(() => expect(currentLocation).toBe('/sessions/a?tabs=a,b&split=h:a|b'));

    await userEvent.click(screen.getByRole('button', { name: 'Close pane 2' }));
    await waitFor(() => expect(currentLocation).toBe('/sessions/a?tabs=a,b'));
    expect(screen.getByTestId('terminal-panes')).toHaveAttribute('data-split', 'none');
    // Closing a pane keeps its session open as a tab.
    expect(tabs()).toHaveLength(2);
  });

  it('asks which session to split with when there is a choice', async () => {
    renderWorkspace('/sessions/a?tabs=a,b,c');
    await waitFor(() => expect(tabs()).toHaveLength(3));
    await userEvent.click(screen.getByRole('button', { name: 'Split side by side' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'gamma' }));
    await waitFor(() => expect(currentLocation).toBe('/sessions/a?tabs=a,b,c&split=v:a|c'));
  });

  it('shows one pane and a chip row on a phone, even with a split in the URL', async () => {
    layoutMock.isPhone = true;
    layoutMock.isWide = false;
    renderWorkspace('/sessions/a?tabs=a,b&split=v:a|b');
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(2));
    expect(document.querySelectorAll('[role=tablist] .MuiChip-root')).toHaveLength(2);
    expect(screen.getByTestId('terminal-panes')).toHaveAttribute('data-split', 'none');
    expect(screen.queryByRole('button', { name: 'Split side by side' })).not.toBeInTheDocument();
  });
});

describe('TerminalWorkspacePage: hidden tabs and the scroll chain (docs/SCROLLING.md)', () => {
  let restoreOffsetParent: () => void;
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    layoutMock.isPhone = false;
    vi.mocked(getSession).mockImplementation((id: string) => Promise.resolve(SESSIONS[id]));
    restoreOffsetParent = installOffsetParent();
  });
  afterEach(() => restoreOffsetParent());

  it('keeps a hidden tab out of view with visibility, never display: none, so offsetParent stays non-null', async () => {
    renderWorkspace('/sessions/a?tabs=a,b');
    await waitFor(() => expect(tabs()).toHaveLength(2));
    const hidden = pane('b');
    expect(hidden).toHaveAttribute('data-pane-visible', 'false');
    expect(hidden.style.visibility).toBe('hidden');
    expect(getComputedStyle(hidden).display).not.toBe('none');
    const host = within(hidden).getByTestId('terminal-xterm-host');
    expect(host.offsetParent).not.toBeNull();
  });

  it('puts touch-action: none on the xterm container of every pane', async () => {
    renderWorkspace('/sessions/a?tabs=a,b');
    await waitFor(() => expect(tabs()).toHaveLength(2));
    // jsdom's CSS parser drops `touch-action`, so read the rule emotion emitted.
    const css = [...document.querySelectorAll('style')].map((s) => s.textContent ?? '').join('');
    for (const host of screen.getAllByTestId('terminal-xterm-host')) {
      const cls = [...host.classList].find((name) => name.startsWith('css-'));
      expect(cls).toBeDefined();
      const rule = new RegExp(`\\.${cls}\\{[^}]*touch-action:none`);
      expect(css).toMatch(rule);
    }
  });

  it('walks from the xterm host up to <main>: minHeight 0 on the flex chain and no overflow: hidden', async () => {
    renderWorkspace('/sessions/a?tabs=a,b&split=v:a|b');
    await waitFor(() => expect(tabs()).toHaveLength(2));
    for (const host of screen.getAllByTestId('terminal-xterm-host')) {
      const chain: HTMLElement[] = [];
      for (let el: HTMLElement | null = host; el && el.tagName !== 'MAIN'; el = el.parentElement) chain.push(el);
      expect(chain.at(-1)?.parentElement?.tagName).toBe('MAIN');
      for (const el of chain) {
        const style = getComputedStyle(el);
        const label = `${el.tagName}[data-testid=${el.dataset.testid ?? ''}]`;
        for (const overflow of [style.overflow, style.overflowX, style.overflowY]) {
          expect(overflow, `${label} must not clip`).not.toBe('hidden');
        }
        const parentDisplay = el.parentElement ? getComputedStyle(el.parentElement).display : '';
        if (style.display === 'flex' || parentDisplay === 'flex') {
          expect(['0', '0px'], `${label} needs minHeight: 0`).toContain(style.minHeight);
        }
      }
      // No `.xterm-viewport` override in the host's styles.
      const hostRules = [...document.querySelectorAll('style')].map((s) => s.textContent ?? '').join('');
      expect(hostRules).not.toMatch(/\.xterm-viewport\{[^}]*overflow/);
    }
  });
});

describe('TerminalWorkspacePage: the key bar sits on the keyboard', () => {
  const originalViewport = window.visualViewport;
  afterEach(() => {
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: originalViewport });
    vi.restoreAllMocks();
  });

  it('computes the offset from the inset minus the space already below the page', () => {
    expect(keyDockOffset(300, 0)).toBe(300);
    expect(keyDockOffset(300, 80)).toBe(220);
    expect(keyDockOffset(50, 80)).toBe(0);
    expect(keyDockOffset(0, 0)).toBe(0);
  });

  it("puts the frame's bottom, and so the key bar's, at the mocked visualViewport inset", async () => {
    vi.mocked(getSession).mockImplementation((id: string) => Promise.resolve(SESSIONS[id]));
    layoutMock.isPhone = true;
    const listeners = new Set<() => void>();
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: {
        height: window.innerHeight - 320,
        offsetTop: 0,
        addEventListener: (_t: string, fn: () => void) => listeners.add(fn),
        removeEventListener: (_t: string, fn: () => void) => listeners.delete(fn),
      },
    });
    // The page ends at the bottom of the layout viewport (no bottom bar in this tree).
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const bottom = this.dataset.testid === 'terminal-workspace' ? window.innerHeight : 0;
      return { top: 0, left: 0, right: 0, bottom, width: 0, height: bottom, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    });
    renderWorkspace('/sessions/a?tabs=a');
    const frame = await screen.findByTestId('terminal-workspace-frame');
    await waitFor(() => expect(frame.style.bottom || getComputedStyle(frame).bottom).toBe('320px'));
    // The key bar's dock is the frame's last child: its bottom is the frame's.
    expect(frame.lastElementChild).toBe(screen.getByTestId('terminal-key-dock'));
  });
});

describe('TerminalWorkspacePage: the AI panel gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    layoutMock.isPhone = false;
    layoutMock.isWide = true;
    vi.mocked(getSession).mockImplementation((id: string) => Promise.resolve(SESSIONS[id]));
  });

  const aiOn = (node: ReactNode) => (
    <AiConfigContext.Provider
      value={{ config: { ...AI_CONFIG_DISABLED, enabled: true }, isLoading: false, error: null, refresh: async () => {} }}
    >
      {node}
    </AiConfigContext.Provider>
  );

  it('is absent with no AI provider mounted (AI off)', async () => {
    renderWorkspace('/sessions/a?tabs=a', { user: { ...writer, permissions: [...writer.permissions, 'ai:use'] } });
    await waitFor(() => expect(tabs()).toHaveLength(1));
    expect(screen.queryByRole('button', { name: 'AI' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('terminal-ai-panel')).not.toBeInTheDocument();
  });

  it('is absent with AI on but without ai:use', async () => {
    renderWorkspace('/sessions/a?tabs=a', { wrap: aiOn });
    await waitFor(() => expect(tabs()).toHaveLength(1));
    expect(screen.queryByRole('button', { name: 'AI' })).not.toBeInTheDocument();
  });

  it('opens as a side panel with AI on and ai:use, its actions disabled until their APIs ship', async () => {
    renderWorkspace('/sessions/a?tabs=a', {
      wrap: aiOn,
      user: { ...writer, permissions: [...writer.permissions, 'ai:use'] },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'AI' }));
    const panel = screen.getByTestId('terminal-ai-panel');
    expect(within(panel).getByRole('button', { name: 'Suggest' })).toBeDisabled();
    expect(within(panel).getAllByText('Coming with Terminal AI').length).toBeGreaterThan(0);
    await userEvent.click(within(panel).getByRole('button', { name: 'Close assistant' }));
    expect(screen.queryByTestId('terminal-ai-panel')).not.toBeInTheDocument();
  });
});
