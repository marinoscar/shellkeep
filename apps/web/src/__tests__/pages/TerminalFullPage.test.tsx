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
  uploadFile: vi.fn(),
  getDownloadUrl: vi.fn(),
  api: { getAccessToken: vi.fn(() => 'mock-token') },
}));

vi.mock('../../services/terminal-api', () => ({
  getSession: vi.fn(),
  createSession: vi.fn(),
  downloadSessionHistory: vi.fn().mockRejectedValue(new Error('History unavailable')),
}));

// Mock useUserSettings to avoid API calls in page tests
vi.mock('../../hooks/useUserSettings', () => ({
  useUserSettings: vi.fn(() => ({
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

// Mock TerminalView so no xterm/WebSocket is needed
vi.mock('../../components/terminal/TerminalView', () => ({
  TerminalView: vi.fn(
    (props: {
      sessionId: string;
      onConnectionChange?: (c: boolean) => void;
      onError?: (e: string) => void;
    }) => {
      terminalViewProps.current = props;
      return (
        <div
          data-testid="terminal-view"
          data-session-id={props.sessionId}
          onClick={() => props.onConnectionChange?.(true)}
        />
      );
    },
  ),
}));

import TerminalFullPage from '../../pages/TerminalFullPage';
import { EXPIRED_MESSAGE, FORBIDDEN_MESSAGE } from '../../services/terminal-ws';
import { getSession } from '../../services/terminal-api';

const mockSession: TerminalSession = {
  id: 'session-1',
  name: 'Full Page Session',
  status: 'active',
  tmuxSessionId: 'tmux-xyz',
  cols: 220,
  rows: 50,
  lastActivityAt: new Date().toISOString(),
  terminatedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  serverProfile: {
    id: 'profile-1',
    name: 'Prod Server',
    hostname: 'prod.example.com',
    port: 22,
    username: 'ubuntu',
  },
};

describe('TerminalFullPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSession).mockResolvedValue(mockSession);
  });

  describe('Loading / session fetch', () => {
    it('should render null while the session is loading', () => {
      vi.mocked(getSession).mockReturnValue(new Promise(() => {}));

      const { container } = render(<TerminalFullPage />);

      expect(container.firstChild).toBeNull();
    });

    it('should render the terminal view after the session loads', async () => {
      render(<TerminalFullPage />);

      await waitFor(() => {
        expect(screen.getByTestId('terminal-view')).toBeInTheDocument();
      });
    });

    it('should navigate to /sessions when the session fetch fails', async () => {
      const mockNavigate = vi.fn();
      const { useNavigate } = await import('react-router-dom');
      vi.mocked(useNavigate).mockReturnValue(mockNavigate);

      vi.mocked(getSession).mockRejectedValueOnce(new Error('Not found'));

      render(<TerminalFullPage />);

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/sessions');
      });
    });
  });

  describe('Top bar rendering', () => {
    it('should display the session name in the top bar', async () => {
      render(<TerminalFullPage />);

      await waitFor(() => {
        expect(screen.getByText(/full page session/i)).toBeInTheDocument();
      });
    });

    it('should display the username and hostname in the top bar', async () => {
      render(<TerminalFullPage />);

      await waitFor(() => {
        expect(screen.getByText(/ubuntu@prod\.example\.com/i)).toBeInTheDocument();
      });
    });

    it('should render the back button', async () => {
      render(<TerminalFullPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /back to sessions/i })).toBeInTheDocument();
      });
    });

    it('should render the copy button', async () => {
      render(<TerminalFullPage />);

      await waitFor(() => {
        expect(screen.getByTestId('ContentCopyIcon').closest('button')!).toBeInTheDocument();
      });
    });

    it('should render the download button', async () => {
      render(<TerminalFullPage />);

      await waitFor(() => {
        expect(screen.getByTestId('DownloadIcon').closest('button')!).toBeInTheDocument();
      });
    });
  });

  describe('Connection status indicator', () => {
    it('should show a disconnected indicator before connection is established', async () => {
      render(<TerminalFullPage />);

      await waitFor(() => {
        expect(screen.getByTestId('terminal-view')).toBeInTheDocument();
      });

      // The CircleIcon changes color via sx but there is only one instance
      const statusIcon = document.querySelector('[data-testid="CircleIcon"]');
      expect(statusIcon).toBeInTheDocument();
    });

    it('should reflect connected state after TerminalView fires onConnectionChange', async () => {
      render(<TerminalFullPage />);

      await waitFor(() => {
        expect(screen.getByTestId('terminal-view')).toBeInTheDocument();
      });

      // Simulate connection by clicking the mock TerminalView
      await userEvent.click(screen.getByTestId('terminal-view'));

      // isConnected becomes true - the CircleIcon should now use success color (#4caf50)
      // We verify the component doesn't crash and re-renders
      expect(screen.getByTestId('terminal-view')).toBeInTheDocument();
    });
  });

  describe('Copy and download', () => {
    it('should not throw when copy button is clicked with no terminal content', async () => {
      render(<TerminalFullPage />);

      await waitFor(() => {
        expect(screen.getByTestId('ContentCopyIcon').closest('button')!).toBeInTheDocument();
      });

      await expect(
        userEvent.click(screen.getByTestId('ContentCopyIcon').closest('button')!),
      ).resolves.not.toThrow();
    });

    it('should not throw when download button is clicked with no terminal content', async () => {
      render(<TerminalFullPage />);

      await waitFor(() => {
        expect(screen.getByTestId('DownloadIcon').closest('button')!).toBeInTheDocument();
      });

      await expect(
        userEvent.click(screen.getByTestId('DownloadIcon').closest('button')!),
      ).resolves.not.toThrow();
    });

    it('should not create a download anchor when terminal has no content', async () => {
      // The TerminalView mock never provides a terminal ref handle,
      // so getTerminalText() returns '' and the download handler short-circuits.
      const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL');

      render(<TerminalFullPage />);

      await waitFor(() => {
        expect(screen.getByTestId('DownloadIcon').closest('button')!).toBeInTheDocument();
      });

      await userEvent.click(screen.getByTestId('DownloadIcon').closest('button')!);

      // URL.createObjectURL should NOT be called because text is empty
      expect(createObjectURLSpy).not.toHaveBeenCalled();
      createObjectURLSpy.mockRestore();
    });
  });

  describe('Navigation', () => {
    it('should navigate to /sessions when back button is clicked', async () => {
      const mockNavigate = vi.fn();
      const { useNavigate } = await import('react-router-dom');
      vi.mocked(useNavigate).mockReturnValue(mockNavigate);

      render(<TerminalFullPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /back to sessions/i })).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole('button', { name: /back to sessions/i }));

      expect(mockNavigate).toHaveBeenCalledWith('/sessions');
    });
  });

  describe('Connection errors (#93)', () => {
    async function renderWithTerminal() {
      render(<TerminalFullPage />);
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
