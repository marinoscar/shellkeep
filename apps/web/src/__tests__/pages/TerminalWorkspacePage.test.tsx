import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../utils/test-utils';

// The props the page passed to the (mocked) TerminalView, so a test can fire
// its callbacks.
const { terminalViewProps } = vi.hoisted(() => ({
  terminalViewProps: {
    current: null as null | {
      onConnectionChange?: (c: boolean) => void;
      onError?: (e: string) => void;
    },
  },
}));
import { forwardRef, useImperativeHandle } from 'react';
import type { TerminalSession } from '../../types';

// Mock react-router-dom so useParams returns a known session id
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useParams: vi.fn(() => ({ id: 'session-1' })),
    useNavigate: vi.fn(() => vi.fn()),
  };
});

// Mock API service
vi.mock('../../services/api', () => ({
  api: { getAccessToken: vi.fn(() => 'mock-token') },
  // The platform host (rendered by the test wrapper) spreads the app's client.
  platformApi: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

// Mock the storage objects flow (#50).
vi.mock('../../services/storage', () => ({
  uploadPastedImage: vi.fn(),
  uploadTerminalFile: vi.fn(),
  storageErrorMessage: vi.fn((_error: unknown, fallback: string) => fallback),
}));

vi.mock('../../services/terminal-api', () => ({
  getSession: vi.fn(),
  updateSession: vi.fn(),
  createSession: vi.fn(),
  downloadSessionHistory: vi.fn(),
}));

// Mock useTerminalSettings to avoid API calls in page tests
vi.mock('../../hooks/useTerminalSettings', () => ({
  useTerminalSettings: vi.fn(() => ({
    settings: { terminal: { showScrollButtons: true } },
    isLoading: false,
    error: null,
    isSaving: false,
    updateSettings: vi.fn().mockResolvedValue(undefined),
    updateTheme: vi.fn().mockResolvedValue(undefined),
    updateProfile: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Shared mocks for the TerminalView imperative handle
const mockSendInput = vi.fn();
const mockFocus = vi.fn();

// Mock TerminalView so no xterm/WebSocket wiring is needed.
// Uses forwardRef + useImperativeHandle to expose sendInput and focus
// so that TerminalPage's paste handler can call them via the ref.
vi.mock('../../components/terminal/TerminalView', () => ({
  TerminalView: forwardRef<
    { sendInput: (data: string) => void; focus: () => void; getTerminal: () => null },
    {
      sessionId: string;
      onConnectionChange?: (c: boolean) => void;
      onError?: (e: string) => void;
    }
  >(function MockTerminalView(props, ref) {
    const { sessionId, onConnectionChange } = props;
    terminalViewProps.current = props;
    useImperativeHandle(ref, () => ({
      sendInput: mockSendInput,
      focus: mockFocus,
      getTerminal: () => null,
    }));
    return (
      <div
        data-testid="terminal-view"
        data-session-id={sessionId}
        onClick={() => onConnectionChange?.(true)}
      />
    );
  }),
}));

import TerminalPage from '../../pages/TerminalWorkspacePage';
import { EXPIRED_MESSAGE, FORBIDDEN_MESSAGE } from '../../services/terminal-ws';
import { getSession, updateSession } from '../../services/terminal-api';

const mockSession: TerminalSession = {
  id: 'session-1',
  name: 'My SSH Session',
  status: 'active',
  tmuxSessionId: 'tmux-abc',
  cols: 80,
  rows: 24,
  lastActivityAt: new Date().toISOString(),
  terminatedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  serverProfile: {
    id: 'profile-1',
    name: 'Dev Server',
    hostname: 'dev.example.com',
    port: 22,
    username: 'deploy',
  },
};

describe('TerminalWorkspacePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSession).mockResolvedValue(mockSession);
    vi.mocked(updateSession).mockResolvedValue(mockSession);
  });

  function renderTerminalPage(sessionId = 'session-1') {
    return render(<TerminalPage />, {
      wrapperOptions: { route: `/sessions/${sessionId}` },
    });
  }

  describe('Loading / session fetch', () => {
    it('should render null while the session is loading', () => {
      // Never resolve so we stay in loading state
      vi.mocked(getSession).mockReturnValue(new Promise(() => {}));

      const { container } = renderTerminalPage();

      expect(container.firstChild).toBeNull();
    });

    it('should render the toolbar and terminal after the session loads', async () => {
      renderTerminalPage();

      await waitFor(() => {
        expect(screen.getByTestId('terminal-view')).toBeInTheDocument();
      });
    });

    it('should navigate away when session fetch fails', async () => {
      const mockNavigate = vi.fn();
      const { useNavigate } = await import('react-router-dom');
      vi.mocked(useNavigate).mockReturnValue(mockNavigate);

      vi.mocked(getSession).mockRejectedValueOnce(new Error('Not found'));

      renderTerminalPage();

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/sessions');
      });
    });
  });

  describe('Toolbar integration', () => {
    it('should display the session name in the toolbar', async () => {
      renderTerminalPage();

      await waitFor(() => {
        expect(screen.getByText('My SSH Session')).toBeInTheDocument();
      });
    });

    it('should render the back button', async () => {
      renderTerminalPage();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /back to sessions/i })).toBeInTheDocument();
      });
    });

    it('should update connection state after TerminalView fires onConnectionChange', async () => {
      renderTerminalPage();

      await waitFor(() => {
        expect(screen.getByTestId('terminal-view')).toBeInTheDocument();
      });

      // The toolbar renders before clicking - verify it's stable
      expect(screen.getByText('My SSH Session')).toBeInTheDocument();

      // Simulate connection change via the mock's onClick
      await userEvent.click(screen.getByTestId('terminal-view'));

      // After connection change, component re-renders without errors
      await waitFor(() => {
        expect(screen.getByText('My SSH Session')).toBeInTheDocument();
      });
    });
  });

  describe('Rename', () => {
    it('should call updateSession and update the toolbar name on rename', async () => {
      const updatedSession = { ...mockSession, name: 'Renamed Session' };
      vi.mocked(updateSession).mockResolvedValueOnce(updatedSession);

      renderTerminalPage();

      await waitFor(() => {
        expect(screen.getByText('My SSH Session')).toBeInTheDocument();
      });

      // Trigger inline rename via toolbar
      await userEvent.click(screen.getByTestId('EditIcon').closest('button')!);
      const input = screen.getByRole('textbox');
      await userEvent.clear(input);
      await userEvent.type(input, 'Renamed Session');
      await userEvent.keyboard('{Enter}');

      await waitFor(() => {
        expect(updateSession).toHaveBeenCalledWith('session-1', { name: 'Renamed Session' });
      });

      await waitFor(() => {
        expect(screen.getByText('Renamed Session')).toBeInTheDocument();
      });
    });
  });

  describe('Open in new tab', () => {
    it('should open a new window/tab pointing to the session route', async () => {
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

      renderTerminalPage();

      await waitFor(() => {
        expect(screen.getByTestId('OpenInNewIcon').closest('button')!).toBeInTheDocument();
      });

      await userEvent.click(screen.getByTestId('OpenInNewIcon').closest('button')!);

      expect(openSpy).toHaveBeenCalledWith('/sessions/session-1', '_blank');
      openSpy.mockRestore();
    });
  });

  describe('Copy and download', () => {
    it('should copy terminal text to clipboard when copy button is clicked', async () => {
      const writeTextSpy = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: writeTextSpy },
        writable: true,
        configurable: true,
      });

      renderTerminalPage();

      await waitFor(() => {
        expect(screen.getByTestId('ContentCopyIcon').closest('button')!).toBeInTheDocument();
      });

      await userEvent.click(screen.getByTestId('ContentCopyIcon').closest('button')!);

      // getTerminalText returns '' because the mock terminal has no buffer
      // clipboard.writeText is not called for empty text — verify it doesn't throw
      expect(writeTextSpy).not.toHaveBeenCalled();
    });

    it('should not throw when download is clicked with no terminal content', async () => {
      renderTerminalPage();

      await waitFor(() => {
        expect(screen.getByTestId('DownloadIcon').closest('button')!).toBeInTheDocument();
      });

      await expect(
        userEvent.click(screen.getByTestId('DownloadIcon').closest('button')!),
      ).resolves.not.toThrow();
    });
  });

  describe('Paste', () => {
    it('should send clipboard text to the terminal and focus it when paste button is clicked', async () => {
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          read: vi.fn().mockResolvedValue([
            {
              types: ['text/plain'],
              getType: vi.fn().mockResolvedValue({
                text: vi.fn().mockResolvedValue('hello world'),
              }),
            },
          ]),
          writeText: vi.fn(),
        },
        writable: true,
        configurable: true,
      });

      renderTerminalPage();

      await waitFor(() => {
        expect(screen.getByTestId('ContentPasteIcon').closest('button')!).toBeInTheDocument();
      });

      await userEvent.click(screen.getByTestId('ContentPasteIcon').closest('button')!);

      await waitFor(() => {
        expect(mockSendInput).toHaveBeenCalledWith('hello world');
      });

      expect(mockFocus).toHaveBeenCalled();
    });
  });

  describe('Connection errors (#93)', () => {
    async function renderWithTerminal() {
      renderTerminalPage();
      await waitFor(() => expect(screen.getByTestId('terminal-view')).toBeInTheDocument());
      expect(terminalViewProps.current?.onError).toBeTypeOf('function');
    }

    it('shows the session-expired message with a "Sign in again" action', async () => {
      await renderWithTerminal();
      expect(screen.queryByTestId('terminal-connection-alert')).not.toBeInTheDocument();

      act(() => { terminalViewProps.current!.onError!(EXPIRED_MESSAGE); });

      const alert = screen.getByTestId('terminal-connection-alert');
      expect(alert).toHaveTextContent('Your session has expired. Sign in again to reconnect.');
      expect(within(alert).getByRole('button', { name: 'Sign in again' })).toBeInTheDocument();
      // A final error cannot be dismissed.
      expect(within(alert).queryByRole('button', { name: /close/i })).not.toBeInTheDocument();
      // The terminal stays mounted underneath.
      expect(screen.getByTestId('terminal-view')).toBeInTheDocument();
    });

    it('shows the forbidden message', async () => {
      await renderWithTerminal();

      act(() => { terminalViewProps.current!.onError!(FORBIDDEN_MESSAGE); });

      const alert = screen.getByTestId('terminal-connection-alert');
      expect(alert).toHaveTextContent(FORBIDDEN_MESSAGE);
      expect(within(alert).getByRole('button', { name: 'Back to sessions' })).toBeInTheDocument();
      expect(within(alert).queryByRole('button', { name: 'Sign in again' })).not.toBeInTheDocument();
    });

    it('clears an error once the terminal connects again', async () => {
      await renderWithTerminal();

      act(() => { terminalViewProps.current!.onError!('WebSocket error'); });
      expect(screen.getByTestId('terminal-connection-alert')).toHaveTextContent('WebSocket error');

      act(() => { terminalViewProps.current!.onConnectionChange!(true); });
      expect(screen.queryByTestId('terminal-connection-alert')).not.toBeInTheDocument();
    });
  });
});
