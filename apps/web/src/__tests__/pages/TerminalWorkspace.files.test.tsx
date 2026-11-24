import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { Box } from '@mui/material';
import { AiConfigContext, AI_CONFIG_DISABLED } from '@marinoscar/platform-web/ai/headless';
import type { ReactNode } from 'react';
import { render, mockUser } from '../utils/test-utils';
import type { TerminalSession } from '../../types';
import type { WorkspacePaneProps } from '../../components/terminal/workspace/WorkspacePane';

// =============================================================================
// The workspace's Files panel (#156): the toolbar toggle, side panel vs bottom
// sheet through `useTerminalLayout` (mocked), the AI panel taking turns, the
// `sessions:write` gate, and "Show in file browser" from the terminal link
// menu (#155) opening the panel at the file's folder.
//
// Panes are stubbed: each renders the real `TerminalFileLinkMenu` for one
// printed path, wired to the props the page passes, so the link menu's action
// travels the page's real callback.
// =============================================================================

const { layoutMock, listRemoteDirectory } = vi.hoisted(() => ({
  layoutMock: { isPhone: false, isWide: true, isTouch: false },
  listRemoteDirectory: vi.fn(),
}));

vi.mock('../../components/terminal/useTerminalLayout', () => ({ useTerminalLayout: () => layoutMock }));
vi.mock('../../services/api', () => ({
  api: { getAccessToken: vi.fn(() => 'mock-token') },
  platformApi: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock('../../services/files-api', () => ({ listRemoteDirectory, downloadRemoteFile: vi.fn() }));
vi.mock('../../services/terminal-api', () => ({
  getSession: vi.fn(),
  updateSession: vi.fn(),
  createSession: vi.fn(),
  downloadSessionHistory: vi.fn(),
  getServerProfile: vi.fn(() => new Promise(() => {})),
  getSessions: vi.fn(() => Promise.resolve({ items: [], total: 0, page: 1, pageSize: 100 })),
}));
vi.mock('../../hooks/useTerminalSettings', async () => {
  const { DEFAULT_TERMINAL_SETTINGS } = await import('../../lib/terminal/settings');
  return {
    useTerminalSettings: vi.fn(() => ({
      terminal: DEFAULT_TERMINAL_SETTINGS,
      actionShortcuts: {},
      updateTerminal: vi.fn(),
    })),
  };
});
vi.mock('../../components/terminal/workspace/WorkspacePane', async () => {
  const { useState } = await import('react');
  const { TerminalFileLinkMenu } = await import('../../components/terminal/files/TerminalFileLinkMenu');
  return {
    WorkspacePane: ({ sessionId, fileLinksProfileId, onShowInFileBrowser }: WorkspacePaneProps) => {
      const [open, setOpen] = useState(false);
      const path = '/srv/app/logs/error.log';
      return (
        <div data-testid={`pane-${sessionId}`}>
          {fileLinksProfileId && (
            <button type="button" onClick={() => setOpen(true)}>
              {`link ${sessionId}`}
            </button>
          )}
          {fileLinksProfileId && (
            <TerminalFileLinkMenu
              sessionId={sessionId}
              profileId={fileLinksProfileId}
              onShowInFileBrowser={onShowInFileBrowser}
              onClose={() => setOpen(false)}
              state={
                open
                  ? {
                      anchor: { x: 10, y: 10 },
                      link: {
                        reference: { path: 'logs/error.log', start: 0, end: 14 },
                        stat: { path, type: 'file', isText: true },
                        text: 'logs/error.log',
                        range: { start: { x: 1, y: 1 }, end: { x: 14, y: 1 } },
                      },
                    }
                  : null
              }
            />
          )}
        </div>
      );
    },
  };
});

import TerminalWorkspacePage from '../../pages/TerminalWorkspacePage';
import { getSession } from '../../services/terminal-api';

const session = (id: string, name: string, profileId: string): TerminalSession => ({
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
  serverProfileId: profileId,
  serverProfile: { name: `Server ${name}`, hostname: 'server-a.example.test', port: 22, username: 'person-a', color: 'default' },
});
const SESSIONS: Record<string, TerminalSession> = {
  a: session('a', 'alpha', 'profile-1'),
  b: session('b', 'beta', 'profile-2'),
};

const writer = { ...mockUser, permissions: [...mockUser.permissions, 'sessions:read', 'sessions:write'] };
const reader = { ...mockUser, permissions: [...mockUser.permissions, 'sessions:read'] };

function renderWorkspace(route: string, options: { user?: typeof writer; wrap?: (n: ReactNode) => ReactNode } = {}) {
  const page = (
    <Box component="main" sx={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Routes>
        <Route path="/sessions/:id" element={<TerminalWorkspacePage />} />
      </Routes>
    </Box>
  );
  return render(<>{options.wrap ? options.wrap(page) : page}</>, {
    wrapperOptions: { route, user: options.user ?? writer },
  });
}

const aiOn = (node: ReactNode) => (
  <AiConfigContext.Provider
    value={{ config: { ...AI_CONFIG_DISABLED, enabled: true }, isLoading: false, error: null, refresh: async () => {} }}
  >
    {node}
  </AiConfigContext.Provider>
);

describe('Terminal workspace Files panel (#156)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    layoutMock.isPhone = false;
    layoutMock.isWide = true;
    vi.mocked(getSession).mockImplementation((id: string) => Promise.resolve(SESSIONS[id]!));
    listRemoteDirectory.mockImplementation(({ path }: { path: string }) =>
      Promise.resolve({
        path: path === '.' ? '/srv/app' : path,
        entries: [
          { name: 'error.log', type: 'file', size: 10, mtime: '2026-11-20T00:00:00.000Z', mode: '0644', symlinkTarget: null, targetType: null },
        ],
        truncated: false,
      }),
    );
  });

  it('docks as a side panel on a wide screen, following the session directory', async () => {
    const user = userEvent.setup();
    renderWorkspace('/sessions/a?tabs=a');
    const toggle = await screen.findByRole('button', { name: 'Files' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    const panel = screen.getByTestId('terminal-files-panel');
    await within(panel).findByRole('list', { name: 'Files in /srv/app' });
    expect(listRemoteDirectory).toHaveBeenCalledWith({ profileId: 'profile-1', path: '.', sessionId: 'a' });
    expect(screen.queryByTestId('terminal-files-sheet')).not.toBeInTheDocument();

    await user.click(within(panel).getByRole('button', { name: 'Close files' }));
    expect(screen.queryByTestId('terminal-files-panel')).not.toBeInTheDocument();
  });

  it('opens as a bottom sheet on a phone', async () => {
    layoutMock.isPhone = true;
    layoutMock.isWide = false;
    const user = userEvent.setup();
    renderWorkspace('/sessions/a?tabs=a');
    await user.click(await screen.findByRole('button', { name: 'Files' }));
    const sheet = await screen.findByTestId('terminal-files-sheet');
    await within(sheet).findByRole('list', { name: 'Files in /srv/app' });
    expect(screen.queryByTestId('terminal-files-panel')).not.toBeInTheDocument();
    // The phone affordances stay: the key bar is still docked.
    expect(screen.getByTestId('terminal-key-dock')).toBeInTheDocument();
  });

  it('takes turns with the AI panel', async () => {
    const user = userEvent.setup();
    renderWorkspace('/sessions/a?tabs=a', { wrap: aiOn, user: { ...writer, permissions: [...writer.permissions, 'ai:use'] } });
    await user.click(await screen.findByRole('button', { name: 'Files' }));
    expect(screen.getByTestId('terminal-files-panel')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'AI' }));
    expect(screen.getByTestId('terminal-ai-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('terminal-files-panel')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Files' }));
    expect(screen.getByTestId('terminal-files-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('terminal-ai-panel')).not.toBeInTheDocument();
  });

  it('is absent without sessions:write, and so is the link action', async () => {
    renderWorkspace('/sessions/a?tabs=a', { user: reader });
    await screen.findAllByRole('tab');
    await waitFor(() => expect(getSession).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Files' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'link a' })).not.toBeInTheDocument();
  });

  it('"Show in file browser" from a link opens the panel at the folder with the file selected', async () => {
    const user = userEvent.setup();
    renderWorkspace('/sessions/a?tabs=a');
    await user.click(await screen.findByRole('button', { name: 'link a' }));
    await user.click(screen.getByRole('menuitem', { name: 'Show in file browser' }));

    const panel = await screen.findByTestId('terminal-files-panel');
    await within(panel).findByRole('list', { name: 'Files in /srv/app/logs' });
    expect(listRemoteDirectory).toHaveBeenCalledWith({ profileId: 'profile-1', path: '/srv/app/logs', sessionId: 'a' });
    expect(listRemoteDirectory).not.toHaveBeenCalledWith(expect.objectContaining({ path: '.' }));
    await waitFor(() =>
      expect(within(panel).getByRole('button', { name: /^error\.log, file/ })).toHaveAttribute('aria-current', 'true'),
    );
    expect(within(panel).getByRole('switch', { name: 'Follow terminal directory' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Files' })).toHaveAttribute('aria-pressed', 'true');

    // Closed and opened again from the toolbar, it follows the terminal again.
    await user.click(screen.getByRole('button', { name: 'Files' }));
    await user.click(screen.getByRole('button', { name: 'Files' }));
    await within(screen.getByTestId('terminal-files-panel')).findByRole('list', { name: 'Files in /srv/app' });
  });

  it('switches to the pane on the link\'s server first', async () => {
    const user = userEvent.setup();
    renderWorkspace('/sessions/a?tabs=a,b&split=v:a|b');
    await user.click(await screen.findByRole('button', { name: 'link b' }));
    await user.click(screen.getByRole('menuitem', { name: 'Show in file browser' }));
    await waitFor(() =>
      expect(listRemoteDirectory).toHaveBeenCalledWith({ profileId: 'profile-2', path: '/srv/app/logs', sessionId: 'b' }),
    );
  });
});
