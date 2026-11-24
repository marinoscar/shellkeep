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
// Hardware keyboards and tablets in the workspace (#170): the accessory row
// collapses to a "Keys" pill while a hardware keyboard is in use and
// `autoHideWithHardwareKeyboard` is on (`useHardwareKeyboard` mocked), the pill
// brings it back, the key panel stays reachable, and nothing changes with the
// option off. Then the sm-md tablet layout (`useTerminalLayout` mocked): the
// side key panel and the Files and AI panels coexist without clipping.
// =============================================================================

const {
  mockSendInput,
  layoutMock,
  termMock,
  statRemoteFile,
  uploadRemoteFile,
  listRemoteDirectory,
  hardware,
  keyOptions,
} = vi.hoisted(
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
    hardware: { present: false },
    keyOptions: { autoHideWithHardwareKeyboard: true, haptics: false },
  }),
);
vi.mock('../../hooks/useHardwareKeyboard', () => ({ useHardwareKeyboard: () => ({ present: hardware.present }) }));

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
      keyOptions,
      updateTerminal: vi.fn(),
    })),
  };
});

import TerminalWorkspacePage from '../../pages/TerminalWorkspacePage';
import { getSession } from '../../services/terminal-api';
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
  hardware.present = false;
  keyOptions.autoHideWithHardwareKeyboard = true;
  setTerminal();
  vi.mocked(getSession).mockImplementation((id: string) => Promise.resolve(session(id)));
  listRemoteDirectory.mockResolvedValue({ path: '/srv/app', entries: [], truncated: false });
});

afterEach(() => {
  termMock.terminal = null;
});

const pill = () => screen.getByRole('button', { name: 'Show key row' });

async function dockReady() {
  await screen.findByRole('button', { name: 'Key panel' });
}

describe('auto-hide with a hardware keyboard (#170)', () => {
  describe.each([
    ['a phone', { isPhone: true, isWide: false }],
    ['an sm tablet', { isPhone: false, isWide: false }],
    ['a wide tablet', { isPhone: false, isWide: true }],
  ])('on %s', (_name, layout) => {
    beforeEach(() => {
      Object.assign(layoutMock, layout);
      hardware.present = true;
    });

    it('collapses the row to a Keys pill pinned beside the panel toggle', async () => {
      renderWorkspace();
      await dockReady();
      expect(screen.queryByRole('toolbar', { name: 'Terminal keys' })).not.toBeInTheDocument();
      expect(pill()).toHaveTextContent('Keys');
      const dock = screen.getByTestId('terminal-key-dock');
      expect(dock).toContainElement(pill());
      expect(dock).toContainElement(screen.getByRole('button', { name: 'Key panel' }));
    });

    it('the pill brings the row back, and it stays for this visit', async () => {
      const user = userEvent.setup();
      renderWorkspace();
      await dockReady();
      await user.click(pill());
      expect(row()).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Show key row' })).not.toBeInTheDocument();
      fireEvent.click(rowKey('Esc'));
      expect(mockSendInput).toHaveBeenLastCalledWith('\x1b');
      // Opening and closing the panel (re-renders, the keyboard still in use) keeps the row.
      await user.click(screen.getByRole('button', { name: 'Key panel' }));
      await user.click(within(panel()).getByRole('button', { name: 'Close key panel' }));
      expect(row()).toBeInTheDocument();
    });

    it('the key panel stays reachable while the row is collapsed', async () => {
      const user = userEvent.setup();
      renderWorkspace();
      await dockReady();
      await user.click(screen.getByRole('button', { name: 'Key panel' }));
      expect(panel()).toBeInTheDocument();
      fireEvent.click(panelKey('Home'));
      expect(mockSendInput).toHaveBeenLastCalledWith('\x1b[H');
      // The row is still the pill.
      expect(pill()).toBeInTheDocument();
    });
  });

  it('changes nothing with the option off', async () => {
    hardware.present = true;
    keyOptions.autoHideWithHardwareKeyboard = false;
    renderWorkspace();
    await dockReady();
    expect(row()).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show key row' })).not.toBeInTheDocument();
    fireEvent.click(rowKey('Esc'));
    expect(mockSendInput).toHaveBeenLastCalledWith('\x1b');
  });

  it('shows the whole row without a hardware keyboard', async () => {
    renderWorkspace();
    await dockReady();
    expect(row()).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show key row' })).not.toBeInTheDocument();
  });
});

describe('tablet layout: the key panel beside the Files and AI panels (#170)', () => {
  beforeEach(() => {
    // sm-md: a tablet in portrait or landscape, an unfolded foldable.
    layoutMock.isPhone = false;
    layoutMock.isWide = false;
    layoutMock.isTouch = true;
  });

  function assertNoClippingChain(from: HTMLElement) {
    // From the side panel up to the workspace root: nothing clips (docs/specs/terminal.md 5.3).
    let el: HTMLElement | null = from.parentElement;
    while (el && el.dataset.testid !== 'terminal-workspace') {
      expect(getComputedStyle(el).overflow, el.dataset.testid ?? el.tagName).not.toBe('hidden');
      el = el.parentElement;
    }
  }

  it('the side key panel sits after the panes in the terminal body, and nothing on the chain clips', async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await dockReady();
    await user.click(screen.getByRole('button', { name: 'Key panel' }));
    const body = screen.getByTestId('terminal-body');
    const side = screen.getByTestId('terminal-key-panel-side');
    expect(body).toContainElement(side);
    // The panes come first and take the rest; they may shrink (min-width 0), so nothing overflows the body.
    const panes = body.firstElementChild as HTMLElement;
    expect(panes.compareDocumentPosition(side) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(getComputedStyle(panes).minWidth).toBe('0');
    expect(getComputedStyle(side).flexShrink).toBe('0');
    expect(getComputedStyle(side).minWidth).toBe('0');
    expect(KEY_PANEL_SIDE_WIDTH).toBe('min(320px, 40%)');
    assertNoClippingChain(side);
    // The panel's header (tabs, Customize, close) is reachable at this width.
    expect(within(side).getByRole('tab', { name: 'Keys' })).toBeInTheDocument();
    expect(within(side).getByRole('link', { name: 'Customize' })).toBeInTheDocument();
    expect(within(side).getByRole('button', { name: 'Close key panel' })).toBeInTheDocument();
  });

  it('Files opens as a sheet and takes the key panel’s turn, and back', async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await dockReady();
    const keyToggle = screen.getByRole('button', { name: 'Key panel' });
    await user.click(keyToggle);
    await user.click(screen.getByRole('button', { name: 'Files' }));
    expect(await screen.findByTestId('terminal-files-sheet')).toBeInTheDocument();
    expect(screen.queryByTestId('terminal-files-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('terminal-key-panel-side')).not.toBeInTheDocument();
    expect(keyToggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('the AI sheet and the key panel take turns', async () => {
    const user = userEvent.setup();
    renderWorkspace({ wrap: aiOn, user: aiUser });
    await dockReady();
    await user.click(screen.getByRole('button', { name: 'AI' }));
    expect(await screen.findByRole('presentation')).toBeInTheDocument();
    expect(screen.queryByTestId('terminal-ai-panel')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Key panel', hidden: true }));
    await waitFor(() => expect(screen.getByTestId('terminal-key-panel-side')).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByRole('presentation')).not.toBeInTheDocument());
  });

  it('with a hardware keyboard: the pill and the side panel together, the row stays collapsed', async () => {
    const user = userEvent.setup();
    hardware.present = true;
    renderWorkspace();
    await dockReady();
    await user.click(screen.getByRole('button', { name: 'Key panel' }));
    expect(screen.getByTestId('terminal-key-panel-side')).toBeInTheDocument();
    expect(pill()).toBeInTheDocument();
    expect(screen.queryByRole('toolbar', { name: 'Terminal keys' })).not.toBeInTheDocument();
    // The side panel never blurs the terminal: the hardware keyboard keeps typing into it.
    expect(termMock.terminal!.blur).not.toHaveBeenCalled();
  });
});
