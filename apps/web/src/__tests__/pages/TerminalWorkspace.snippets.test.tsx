import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { Box } from '@mui/material';
import { AiConfigContext, AI_CONFIG_DISABLED } from '@marinoscar/platform-web/ai/headless';
import type { ReactNode } from 'react';
import { render, mockUser } from '../utils/test-utils';
import type { TerminalSession } from '../../types';
import type { KeyLayout } from '../../lib/terminal/keys/keyModel';

// =============================================================================
// The snippets key and the Snippets tab in the workspace (#172): the key opens the
// panel on its tab, a tap pastes the text at the prompt with no Enter, a phone's
// docked panel gives the keyboard back after an insert and stays put while the
// search box raises the keyboard, and a reader has no snippets key.
// =============================================================================

const { mockSendInput, layoutMock, termMock, statRemoteFile, uploadRemoteFile, listRemoteDirectory, inset, snippetsApi } = vi.hoisted(
  () => ({
    mockSendInput: vi.fn(),
    layoutMock: { isPhone: true, isWide: false, isTouch: true },
    termMock: {
      terminal: null as null | {
        focus: ReturnType<typeof vi.fn>;
        blur: ReturnType<typeof vi.fn>;
        modes: { applicationCursorKeysMode: boolean; bracketedPasteMode: boolean };
        paste: ReturnType<typeof vi.fn>;
        hasSelection: () => boolean;
        getSelection: () => string;
      },
    },
    statRemoteFile: vi.fn(),
    uploadRemoteFile: vi.fn(),
    listRemoteDirectory: vi.fn(),
    inset: { value: 0 },
    snippetsApi: { listSnippets: vi.fn() },
  }),
);

vi.mock('../../hooks/useTerminal', () => ({
  useTerminal: vi.fn(() => ({
    isConnected: true,
    error: null,
    reconnect: vi.fn(),
    search: vi.fn(),
    sendInput: mockSendInput,
    terminal: { current: termMock.terminal },
    hasSelection: false,
    hostKeyRefusal: null,
    retryConnect: vi.fn(),
    dismissHostKey: vi.fn(),
    latencyMs: 12,
    size: { cols: 80, rows: 24 },
  })),
}));
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));
vi.mock('../../hooks/useKeyboardInset', () => ({ useKeyboardInset: () => inset.value }));
vi.mock('../../services/snippets-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/snippets-api')>()),
  ...snippetsApi,
}));
vi.mock('../../components/terminal/useTerminalLayout', () => ({ useTerminalLayout: () => layoutMock }));
vi.mock('../../services/api', () => ({
  api: { getAccessToken: vi.fn(() => 'mock-token'), refreshToken: vi.fn() },
  API_BASE_URL: '/api',
  platformApi: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock('../../services/files-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/files-api')>()),
  statRemoteFile,
  uploadRemoteFile,
  listRemoteDirectory,
}));
vi.mock('../../services/storage', () => ({
  uploadPastedImage: vi.fn(),
  uploadTerminalFile: vi.fn(),
  storageErrorMessage: vi.fn((_e: unknown, fallback: string) => fallback),
}));
vi.mock('../../services/terminal-explain-api', () => ({
  streamTerminalExplain: vi.fn(),
  previewTerminalExplain: vi.fn(),
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

const LAYOUT: KeyLayout = {
  groups: [
    { keys: [{ id: 'ai' }, { id: 'arrow-drag' }, { id: 'attach-file' }, { id: 'snippets' }] },
    { keys: [{ id: 'shift+tab' }, { id: 'esc' }, { id: 'ctrl' }] },
    { keys: [{ id: 'alt' }, { id: 'left' }, { id: 'home' }, { id: 'f5' }] },
    {
      keys: [
        {
          key: {
            kind: 'macro',
            id: '00000000-0000-4000-8000-000000000001',
            label: 'Ctrl+B O',
            chords: [
              { modifiers: ['ctrl'], key: 'b' },
              { modifiers: [], key: 'o' },
            ],
          },
        },
        { key: { kind: 'custom', id: '00000000-0000-4000-8000-000000000002', label: 'Word', sequence: '\\e[1;5C' } },
      ],
    },
  ],
};

vi.mock('../../hooks/useTerminalSettings', async () => {
  const { DEFAULT_TERMINAL_SETTINGS } = await import('../../lib/terminal/settings');
  return {
    useTerminalSettings: vi.fn(() => ({
      terminal: { ...DEFAULT_TERMINAL_SETTINGS, showKeyBar: 'always' },
      actionShortcuts: {},
      keyLayout: LAYOUT,
      keyOptions: { autoHideWithHardwareKeyboard: true, haptics: false },
      updateTerminal: vi.fn(),
    })),
  };
});

import TerminalWorkspacePage from '../../pages/TerminalWorkspacePage';
import { getSession } from '../../services/terminal-api';

const session = (id: string): TerminalSession => ({
  id,
  name: `session-${id}`,
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

const writer = { ...mockUser, permissions: [...mockUser.permissions, 'sessions:read', 'sessions:write'] };
const reader = { ...mockUser, permissions: [...mockUser.permissions, 'sessions:read'] };

const snip = (id: string, title: string, body: string) => ({
  id,
  title,
  body,
  tags: [],
  position: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

function renderWorkspace(user = writer) {
  return render(
    <Box component="main" sx={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Routes>
        <Route path="/sessions/:id" element={<TerminalWorkspacePage />} />
      </Routes>
    </Box>,
    { wrapperOptions: { route: '/sessions/a?tabs=a', user } },
  );
}

const row = () => screen.getByRole('toolbar', { name: 'Terminal keys' });
const panel = () => screen.getByRole('region', { name: 'Key panel' });

async function ready() {
  await screen.findByRole('toolbar', { name: 'Terminal keys' });
}

function setTerminal(bracketed = true) {
  termMock.terminal = {
    focus: vi.fn(),
    blur: vi.fn(),
    paste: vi.fn(),
    modes: { applicationCursorKeysMode: false, bracketedPasteMode: bracketed },
    hasSelection: () => false,
    getSelection: () => '',
  };
  return termMock.terminal;
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  layoutMock.isPhone = true;
  layoutMock.isWide = false;
  layoutMock.isTouch = true;
  inset.value = 0;
  setTerminal();
  vi.mocked(getSession).mockImplementation((id: string) => Promise.resolve(session(id)));
  statRemoteFile.mockResolvedValue({ path: '/srv/app' });
  listRemoteDirectory.mockResolvedValue({ path: '/srv/app', entries: [], truncated: false });
  snippetsApi.listSnippets.mockResolvedValue([snip('s1', 'Disk usage', 'df -h'), snip('s2', 'Two lines', 'echo one\necho two')]);
});

afterEach(() => {
  termMock.terminal = null;
});

describe('the snippets key and tab (#172)', () => {
  it('opens the key panel on the Snippets tab, in the keyboard\'s place on a phone', async () => {
    renderWorkspace();
    await ready();
    fireEvent.click(within(row()).getByRole('button', { name: 'Snippets' }));
    expect(within(panel()).getByRole('tab', { name: 'Snippets' })).toHaveAttribute('aria-selected', 'true');
    expect(await within(panel()).findByRole('button', { name: 'Insert Disk usage' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Key panel' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('switches an open panel from the Keys tab to Snippets', async () => {
    renderWorkspace();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Key panel' }));
    expect(within(panel()).getByRole('tab', { name: 'Keys' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(within(row()).getByRole('button', { name: 'Snippets' }));
    expect(within(panel()).getByRole('tab', { name: 'Snippets' })).toHaveAttribute('aria-selected', 'true');
  });

  it('has no snippets key without sessions:write', async () => {
    renderWorkspace(reader);
    await ready();
    expect(within(row()).queryByRole('button', { name: 'Snippets' })).not.toBeInTheDocument();
  });

  it('on a phone, an insert pastes the text with no Enter, closes the panel and gives the keyboard back', async () => {
    renderWorkspace();
    await ready();
    fireEvent.click(within(row()).getByRole('button', { name: 'Snippets' }));
    fireEvent.click(await within(panel()).findByRole('button', { name: 'Insert Disk usage' }));
    expect(termMock.terminal!.paste).toHaveBeenCalledWith('df -h');
    expect(mockSendInput).not.toHaveBeenCalled();
    expect(termMock.terminal!.focus).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Key panel' })).not.toBeInTheDocument());
  });

  it('on a wide screen, the side panel stays open after an insert', async () => {
    layoutMock.isPhone = false;
    layoutMock.isWide = true;
    renderWorkspace();
    await ready();
    fireEvent.click(within(row()).getByRole('button', { name: 'Snippets' }));
    expect(screen.getByTestId('terminal-key-panel-side')).toBeInTheDocument();
    fireEvent.click(await within(panel()).findByRole('button', { name: 'Insert Disk usage' }));
    expect(termMock.terminal!.paste).toHaveBeenCalledWith('df -h');
    expect(screen.getByTestId('terminal-key-panel-side')).toBeInTheDocument();
  });

  it('pastes a multi-line snippet when the terminal has bracketed paste, and asks first when it does not', async () => {
    const user = userEvent.setup();
    layoutMock.isPhone = false;
    layoutMock.isWide = true;
    renderWorkspace();
    await ready();
    fireEvent.click(within(row()).getByRole('button', { name: 'Snippets' }));
    fireEvent.click(await within(panel()).findByRole('button', { name: 'Insert Two lines' }));
    expect(termMock.terminal!.paste).toHaveBeenLastCalledWith('echo one\necho two');

    termMock.terminal!.paste.mockClear();
    termMock.terminal!.modes.bracketedPasteMode = false;
    fireEvent.click(within(panel()).getByRole('button', { name: 'Insert Two lines' }));
    expect(termMock.terminal!.paste).not.toHaveBeenCalled();
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Insert anyway' }));
    expect(termMock.terminal!.paste).toHaveBeenCalledWith('echo one\necho two');
  });

  it('keeps a docked panel open when the search box raises the keyboard', async () => {
    const user = userEvent.setup();
    const view = renderWorkspace();
    await ready();
    fireEvent.click(within(row()).getByRole('button', { name: 'Snippets' }));
    await user.click(await within(panel()).findByRole('searchbox', { name: 'Search snippets' }));
    inset.value = 280;
    view.rerender(
      <Box component="main" sx={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <Routes>
          <Route path="/sessions/:id" element={<TerminalWorkspacePage />} />
        </Routes>
      </Box>,
    );
    expect(screen.getByRole('region', { name: 'Key panel' })).toBeInTheDocument();
  });
});
