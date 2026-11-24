import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { Box } from '@mui/material';
import { AiConfigContext, AI_CONFIG_DISABLED } from '@marinoscar/platform-web/ai/headless';
import type { ReactNode } from 'react';
import { render, mockUser } from '../utils/test-utils';
import type { TerminalSession } from '../../types';
import type { KeyLayout } from '../../lib/terminal/keys/keyModel';

// =============================================================================
// The accessory row and the full key panel in the workspace (#167): the bytes
// every key kind sends (normal and application cursor mode), the modifiers
// through the row and the panel, the panel as a side panel off a phone (sm
// tablets, foldables, desktop) and in place of the keyboard on a phone
// (`useTerminalLayout` mocked),
// the keyboard button, Customize, Escape, the AI and attach-file actions, and
// the turns the key panel takes with the Files and AI panels.
// =============================================================================

const { mockSendInput, layoutMock, termMock, statRemoteFile, uploadRemoteFile, listRemoteDirectory } = vi.hoisted(
  () => ({
    mockSendInput: vi.fn(),
    layoutMock: { isPhone: true, isWide: false, isTouch: true },
    termMock: {
      terminal: null as null | {
        focus: ReturnType<typeof vi.fn>;
        blur: ReturnType<typeof vi.fn>;
        modes: { applicationCursorKeysMode: boolean };
        hasSelection: () => boolean;
        getSelection: () => string;
      },
    },
    statRemoteFile: vi.fn(),
    uploadRemoteFile: vi.fn(),
    listRemoteDirectory: vi.fn(),
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

import TerminalWorkspacePage, { KEY_PANEL_DEFAULT_HEIGHT, keyPanelDockHeight } from '../../pages/TerminalWorkspacePage';
import { getSession } from '../../services/terminal-api';
import { RemoteUploadError } from '../../services/files-api';
import { KEY_PANEL_SIDE_WIDTH } from '../../components/terminal/keys/TerminalKeyPanel';

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
const aiUser = { ...writer, permissions: [...writer.permissions, 'ai:use'] };

const aiOn = (node: ReactNode) => (
  <AiConfigContext.Provider
    value={{ config: { ...AI_CONFIG_DISABLED, enabled: true }, isLoading: false, error: null, refresh: async () => {} }}
  >
    {node}
  </AiConfigContext.Provider>
);

function renderWorkspace(options: { user?: typeof writer; wrap?: (n: ReactNode) => ReactNode } = {}) {
  const page = (
    <Box component="main" sx={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Routes>
        <Route path="/sessions/:id" element={<TerminalWorkspacePage />} />
        <Route path="/settings/shortcuts" element={<p>shortcuts editor</p>} />
      </Routes>
    </Box>
  );
  return render(<>{options.wrap ? options.wrap(page) : page}</>, {
    wrapperOptions: { route: '/sessions/a?tabs=a', user: options.user ?? writer },
  });
}

const row = () => screen.getByRole('toolbar', { name: 'Terminal keys' });
const rowKey = (name: string) => within(row()).getByRole('button', { name });
const panel = () => screen.getByRole('region', { name: 'Key panel' });
const panelKey = (name: string) => within(panel()).getByRole('button', { name });

async function ready() {
  await screen.findByRole('toolbar', { name: 'Terminal keys' });
}

function setTerminal(applicationCursor = false) {
  termMock.terminal = {
    focus: vi.fn(),
    blur: vi.fn(),
    modes: { applicationCursorKeysMode: applicationCursor },
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
  setTerminal();
  vi.mocked(getSession).mockImplementation((id: string) => Promise.resolve(session(id)));
  listRemoteDirectory.mockResolvedValue({ path: '/srv/app', entries: [], truncated: false });
});

afterEach(() => {
  termMock.terminal = null;
});

describe('the accessory row in the workspace (#167)', () => {
  const BYTES: Array<[string, string, string]> = [
    // [key, normal mode, application cursor mode]
    ['Esc', '\x1b', '\x1b'],
    ['Shift+Tab', '\x1b[Z', '\x1b[Z'],
    ['←', '\x1b[D', '\x1bOD'],
    ['Home', '\x1b[H', '\x1bOH'],
    ['F5', '\x1b[15~', '\x1b[15~'],
    ['Ctrl+B O', '\x02o', '\x02o'],
    ['Word', '\x1b[1;5C', '\x1b[1;5C'],
  ];

  it.each(BYTES)('%s sends the right bytes in both cursor modes', async (name, normal, application) => {
    renderWorkspace();
    await ready();
    fireEvent.click(rowKey(name));
    expect(mockSendInput).toHaveBeenLastCalledWith(normal);
    termMock.terminal!.modes.applicationCursorKeysMode = true;
    fireEvent.click(rowKey(name));
    expect(mockSendInput).toHaveBeenLastCalledWith(application);
  });

  it('applies an armed modifier to the next key and keeps the terminal focused', async () => {
    renderWorkspace();
    await ready();
    fireEvent.click(rowKey('Ctrl'));
    fireEvent.click(rowKey('F5'));
    expect(mockSendInput).toHaveBeenLastCalledWith('\x1b[15;5~');
    expect(rowKey('Ctrl')).toHaveAttribute('aria-pressed', 'false');
    expect(termMock.terminal!.focus).toHaveBeenCalled();
  });

  it('shows the arrow-drag key (#168), hides snippets until #172 and the AI key without AI', async () => {
    renderWorkspace();
    await ready();
    expect(within(row()).getByRole('button', { name: 'Arrow drag' })).toBeInTheDocument();
    expect(within(row()).queryByRole('button', { name: 'Snippets' })).not.toBeInTheDocument();
    expect(within(row()).queryByRole('button', { name: 'Open AI assistant' })).not.toBeInTheDocument();
  });

  it('the AI key opens the assistant when AI is available', async () => {
    layoutMock.isPhone = false;
    layoutMock.isWide = true;
    renderWorkspace({ wrap: aiOn, user: aiUser });
    await ready();
    fireEvent.click(rowKey('Open AI assistant'));
    expect(await screen.findByTestId('terminal-ai-panel')).toBeInTheDocument();
    expect(mockSendInput).not.toHaveBeenCalled();
  });
});

describe('the key panel on a phone (#167)', () => {
  it('replaces the keyboard in the key dock, blurring the terminal', async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await ready();
    const toggle = screen.getByRole('button', { name: 'Key panel' });
    await user.click(toggle);
    const dock = screen.getByTestId('terminal-key-dock');
    expect(within(dock).getByTestId('terminal-key-panel-dock')).toBe(panel());
    expect(screen.queryByTestId('terminal-key-panel-side')).not.toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveAttribute('aria-controls', panel().id);
    expect(termMock.terminal!.blur).toHaveBeenCalled();
    // No keyboard seen yet: the default height.
    expect(panel()).toHaveStyle({ height: `${KEY_PANEL_DEFAULT_HEIGHT}px` });
    // Focus moves into the panel (a tab raises no keyboard).
    await waitFor(() => expect(within(panel()).getByRole('tab', { name: 'Keys' })).toHaveFocus());

    await user.click(toggle);
    expect(screen.queryByRole('region', { name: 'Key panel' })).not.toBeInTheDocument();
  });

  it('draws every group in a 4-column grid, keys spanning 1 or 2 cells, each group on a new row', async () => {
    renderWorkspace();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Key panel' }));
    const grid = within(panel()).getByTestId('terminal-key-grid');
    expect(grid.style.gridTemplateColumns || getComputedStyle(grid).gridTemplateColumns).toBe(
      'repeat(4, minmax(0, 1fr))',
    );
    const cells = Array.from(grid.children) as HTMLElement[];
    const cellOf = (name: string) => cells.find((c) => within(c).queryByRole('button', { name }))!;
    const column = (name: string) => getComputedStyle(cellOf(name)).gridColumn.replace(/\s/g, '');
    expect(column('Shift+Tab')).toBe('1/span2');
    expect(column('Esc')).toBe('span1');
    expect(column('Alt')).toBe('1/span1');
    expect(column('Ctrl+B O')).toBe('1/span2');
  });

  it('sends panel keys without refocusing the terminal, and modifiers work through the panel', async () => {
    renderWorkspace();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Key panel' }));
    termMock.terminal!.focus.mockClear();
    fireEvent.click(panelKey('Ctrl'));
    expect(rowKey('Ctrl')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(panelKey('←'));
    expect(mockSendInput).toHaveBeenLastCalledWith('\x1b[1;5D');
    expect(panelKey('Ctrl')).toHaveAttribute('aria-pressed', 'false');
    termMock.terminal!.modes.applicationCursorKeysMode = true;
    fireEvent.click(panelKey('←'));
    expect(mockSendInput).toHaveBeenLastCalledWith('\x1bOD');
    // The phone keyboard would cover the panel: the terminal is not focused.
    expect(termMock.terminal!.focus).not.toHaveBeenCalled();
  });

  it('the keyboard button closes the panel and refocuses the terminal', async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await ready();
    await user.click(screen.getByRole('button', { name: 'Key panel' }));
    await user.click(panelKey('Show keyboard'));
    expect(screen.queryByRole('region', { name: 'Key panel' })).not.toBeInTheDocument();
    expect(termMock.terminal!.focus).toHaveBeenCalled();
  });

  it('Escape inside the panel closes it and returns focus to the toggle', async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await ready();
    await user.click(screen.getByRole('button', { name: 'Key panel' }));
    await waitFor(() => expect(within(panel()).getByRole('tab', { name: 'Keys' })).toHaveFocus());
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: 'Key panel' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Key panel' })).toHaveFocus();
  });

  it('Customize opens the shortcuts editor', async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await ready();
    await user.click(screen.getByRole('button', { name: 'Key panel' }));
    const customize = within(panel()).getByRole('link', { name: 'Customize' });
    expect(customize).toHaveAttribute('href', '/settings/shortcuts');
    await user.click(customize);
    expect(await screen.findByText('shortcuts editor')).toBeInTheDocument();
  });

  describe('with the on-screen keyboard', () => {
    const originalViewport = window.visualViewport;
    const listeners = new Set<() => void>();
    const viewport = { height: 0, offsetTop: 0 };

    beforeEach(() => {
      listeners.clear();
      viewport.height = window.innerHeight - 300;
      Object.defineProperty(window, 'visualViewport', {
        configurable: true,
        value: {
          get height() {
            return viewport.height;
          },
          offsetTop: 0,
          addEventListener: (_t: string, fn: () => void) => listeners.add(fn),
          removeEventListener: (_t: string, fn: () => void) => listeners.delete(fn),
        },
      });
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        const bottom = this.dataset.testid === 'terminal-workspace' ? window.innerHeight : 0;
        return { top: 0, left: 0, right: 0, bottom, width: 0, height: bottom, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
      });
    });
    afterEach(() => {
      Object.defineProperty(window, 'visualViewport', { configurable: true, value: originalViewport });
      vi.restoreAllMocks();
    });

    const keyboard = (height: number) => {
      viewport.height = window.innerHeight - height;
      listeners.forEach((fn) => fn());
    };

    it("takes the keyboard's last height, and closes when the keyboard comes back", async () => {
      renderWorkspace();
      await ready();
      const frame = screen.getByTestId('terminal-workspace-frame');
      const bottom = () => frame.style.bottom || getComputedStyle(frame).bottom;
      await waitFor(() => expect(bottom()).toBe('300px'));
      fireEvent.click(screen.getByRole('button', { name: 'Key panel' }));
      expect(panel()).toHaveStyle({ height: '300px' });
      // The blur dismisses the keyboard; the panel stays where it was.
      keyboard(0);
      await waitFor(() => expect(bottom()).toBe('0px'));
      expect(panel()).toBeInTheDocument();
      // The user taps the terminal: the keyboard returns and wins.
      keyboard(300);
      await waitFor(() => expect(screen.queryByRole('region', { name: 'Key panel' })).not.toBeInTheDocument());
    });
  });

  it('keyPanelDockHeight falls back to the default for no or a tiny keyboard', () => {
    expect(keyPanelDockHeight(0)).toBe(KEY_PANEL_DEFAULT_HEIGHT);
    expect(keyPanelDockHeight(100)).toBe(KEY_PANEL_DEFAULT_HEIGHT);
    expect(keyPanelDockHeight(320)).toBe(320);
  });
});

describe('the key panel on an sm tablet or unfolded foldable (#167)', () => {
  beforeEach(() => {
    // Below `md` but not a phone: the AI and Files panels are sheets here.
    layoutMock.isPhone = false;
    layoutMock.isWide = false;
  });

  it('opens beside the panes with the keyboard still up, at most 40% of the width', async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await ready();
    await user.click(screen.getByRole('button', { name: 'Key panel' }));
    const side = screen.getByTestId('terminal-key-panel-side');
    expect(screen.getByTestId('terminal-body')).toContainElement(side);
    expect(screen.queryByTestId('terminal-key-panel-dock')).not.toBeInTheDocument();
    expect(termMock.terminal!.blur).not.toHaveBeenCalled();
    expect(within(side).queryByRole('button', { name: 'Show keyboard' })).not.toBeInTheDocument();
    // jsdom drops CSS min(), so the width is checked at its source.
    expect(KEY_PANEL_SIDE_WIDTH).toBe('min(320px, 40%)');
  });

  it('Escape gives the terminal its focus back', async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await ready();
    await user.click(screen.getByRole('button', { name: 'Key panel' }));
    within(panel()).getByRole('tab', { name: 'Keys' }).focus();
    termMock.terminal!.focus.mockClear();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: 'Key panel' })).not.toBeInTheDocument();
    expect(termMock.terminal!.focus).toHaveBeenCalled();
  });
});

describe('the key panel on a wide layout (#167)', () => {
  beforeEach(() => {
    layoutMock.isPhone = false;
    layoutMock.isWide = true;
  });

  it('opens beside the panes and leaves the terminal focused (the keyboard stays up)', async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await ready();
    await user.click(screen.getByRole('button', { name: 'Key panel' }));
    const side = screen.getByTestId('terminal-key-panel-side');
    expect(screen.getByTestId('terminal-body')).toContainElement(side);
    expect(screen.queryByTestId('terminal-key-panel-dock')).not.toBeInTheDocument();
    expect(termMock.terminal!.blur).not.toHaveBeenCalled();
    expect(within(side).queryByRole('button', { name: 'Show keyboard' })).not.toBeInTheDocument();

    fireEvent.click(panelKey('Home'));
    expect(mockSendInput).toHaveBeenLastCalledWith('\x1b[H');
    expect(termMock.terminal!.focus).toHaveBeenCalled();
  });

  it('Escape inside the panel closes it and gives the terminal its focus back', async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await ready();
    await user.click(screen.getByRole('button', { name: 'Key panel' }));
    within(panel()).getByRole('tab', { name: 'Keys' }).focus();
    termMock.terminal!.focus.mockClear();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: 'Key panel' })).not.toBeInTheDocument();
    expect(termMock.terminal!.focus).toHaveBeenCalled();
  });

  it('a pop-up Escape closes only the pop-up', async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await ready();
    await user.click(screen.getByRole('button', { name: 'Key panel' }));
    await user.pointer({ keys: '[MouseRight]', target: panelKey('Ctrl') });
    expect(await screen.findByRole('menu', { name: 'Ctrl combinations' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(panel()).toBeInTheDocument();
  });

  it('takes turns with the Files and AI panels', async () => {
    const user = userEvent.setup();
    renderWorkspace({ wrap: aiOn, user: aiUser });
    await ready();
    const keyToggle = screen.getByRole('button', { name: 'Key panel' });

    await user.click(screen.getByRole('button', { name: 'Files' }));
    expect(screen.getByTestId('terminal-files-panel')).toBeInTheDocument();
    await user.click(keyToggle);
    expect(screen.getByTestId('terminal-key-panel-side')).toBeInTheDocument();
    expect(screen.queryByTestId('terminal-files-panel')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'AI' }));
    expect(screen.getByTestId('terminal-ai-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('terminal-key-panel-side')).not.toBeInTheDocument();
    expect(keyToggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(keyToggle);
    expect(screen.getByTestId('terminal-key-panel-side')).toBeInTheDocument();
    expect(screen.queryByTestId('terminal-ai-panel')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Files' }));
    expect(screen.getByTestId('terminal-files-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('terminal-key-panel-side')).not.toBeInTheDocument();
  });
});

describe('the attach-file key (#167)', () => {
  const file = () => new File(['hello'], 'notes.txt', { type: 'text/plain' });

  beforeEach(() => {
    statRemoteFile.mockResolvedValue({ path: '/srv/app', name: 'app', type: 'dir' });
    uploadRemoteFile.mockResolvedValue({ path: '/srv/app/notes.txt', name: 'notes.txt', size: 5, overwritten: false });
  });

  it("opens the file picker and uploads into the session's working directory", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await ready();
    const input = screen.getByTestId('terminal-attach-input') as HTMLInputElement;
    const pickerOpened = vi.spyOn(input, 'click');
    fireEvent.click(rowKey('Attach a file'));
    expect(pickerOpened).toHaveBeenCalled();

    await user.upload(input, file());
    await waitFor(() =>
      expect(uploadRemoteFile).toHaveBeenCalledWith(
        expect.objectContaining({ profileId: 'profile-1', dir: '/srv/app', name: 'notes.txt', sessionId: 'a' }),
      ),
    );
    expect(statRemoteFile).toHaveBeenCalledWith({ profileId: 'profile-1', path: '.', sessionId: 'a' });
    expect(uploadRemoteFile.mock.calls[0][0]).not.toHaveProperty('overwrite', true);
    expect(await screen.findByText('Uploaded notes.txt to /srv/app')).toBeInTheDocument();
    expect(mockSendInput).not.toHaveBeenCalled();
  });

  it('never replaces an existing file', async () => {
    uploadRemoteFile.mockRejectedValue(new RemoteUploadError('exists', 409, 'FILE_EXISTS', {}));
    const user = userEvent.setup();
    renderWorkspace();
    await ready();
    await user.upload(screen.getByTestId('terminal-attach-input') as HTMLInputElement, file());
    expect(
      await screen.findByText('notes.txt already exists in /srv/app. Use the Files panel to replace it.'),
    ).toBeInTheDocument();
    expect(uploadRemoteFile).toHaveBeenCalledTimes(1);
  });

  it('is absent without sessions:write', async () => {
    renderWorkspace({ user: reader });
    await ready();
    expect(within(row()).queryByRole('button', { name: 'Attach a file' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('terminal-attach-input')).not.toBeInTheDocument();
  });
});
