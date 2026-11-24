import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render, mockUser } from '../../utils/test-utils';
import { createRef } from 'react';

// Hoist shared mocks so vi.mock factory closures can reference them
const { mockReconnect, mockSearch, mockSendInput, mockTerminalRef } = vi.hoisted(() => ({
  mockReconnect: vi.fn(),
  mockSearch: vi.fn(),
  mockSendInput: vi.fn(),
  mockTerminalRef: { current: null as unknown },
}));

vi.mock('../../../hooks/useTerminal', () => ({
  useTerminal: vi.fn(() => ({
    isConnected: false,
    error: null,
    reconnect: mockReconnect,
    search: mockSearch,
    sendInput: mockSendInput,
    terminal: mockTerminalRef,
  })),
}));

// The host-key dialog's API calls (#60)
vi.mock('../../../services/terminal-api', () => ({
  trustHostKey: vi.fn(),
  getServerProfile: vi.fn(),
}));

// Mock xterm CSS import
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

import { TerminalView, type TerminalViewHandle } from '../../../components/terminal/TerminalView';
import { useTerminal } from '../../../hooks/useTerminal';
import { DEFAULT_TERMINAL_SETTINGS } from '../../../lib/terminal/settings';
import { trustHostKey, getServerProfile } from '../../../services/terminal-api';
import { HOST_KEY_MISMATCH_MESSAGE, HOST_KEY_UNTRUSTED_MESSAGE } from '../../../services/terminal-ws';
import type { HostKeyRefusal, ServerProfile } from '../../../types';

describe('TerminalView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useTerminal).mockReturnValue({
      isConnected: false,
      error: null,
      reconnect: mockReconnect,
      search: mockSearch,
      sendInput: mockSendInput,
      terminal: mockTerminalRef as ReturnType<typeof useTerminal>['terminal'],
    });
  });

  describe('Rendering', () => {
    it('should render a container div', () => {
      const { container } = render(
        <TerminalView sessionId="session-1" />,
      );

      // The Box rendered as a div receives the ref and acts as the xterm container
      const boxes = container.querySelectorAll('.MuiBox-root');
      expect(boxes.length).toBeGreaterThan(0);
    });

    it('should call useTerminal with the provided sessionId and the default preferences', () => {
      render(<TerminalView sessionId="test-session-42" />);

      expect(useTerminal).toHaveBeenCalledWith(
        'test-session-42',
        expect.objectContaining({ current: expect.anything() }),
        expect.objectContaining({ preferences: DEFAULT_TERMINAL_SETTINGS }),
        // No server given: no file links (#155).
        { fileLinks: null },
      );
    });

    it('hands the user preferences to useTerminal and paints the theme background (#80)', () => {
      const preferences = { ...DEFAULT_TERMINAL_SETTINGS, fontSize: 20, theme: 'solarized-dark' as const };
      render(<TerminalView sessionId="s-1" preferences={preferences} />);

      expect(useTerminal).toHaveBeenLastCalledWith(
        's-1',
        expect.anything(),
        expect.objectContaining({ preferences }),
        expect.anything(),
      );
      expect(screen.getByTestId('terminal-xterm-host')).toHaveStyle({ backgroundColor: '#002b36' });
    });

    it('hands a file link source to useTerminal when given a server (#155)', () => {
      render(<TerminalView sessionId="s-1" fileLinks={{ profileId: 'prof-1' }} />);

      expect(useTerminal).toHaveBeenLastCalledWith(
        's-1',
        expect.anything(),
        expect.anything(),
        { fileLinks: expect.objectContaining({ resolve: expect.any(Function), activate: expect.any(Function) }) },
      );
      // The menu is mounted closed.
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('flashes for a visual bell', () => {
      vi.mocked(useTerminal).mockReturnValue({
        ...vi.mocked(useTerminal)(),
        bellCount: 1,
      } as ReturnType<typeof useTerminal>);
      render(<TerminalView sessionId="s-1" />);

      expect(screen.getByTestId('terminal-visual-bell')).toBeInTheDocument();
    });
  });

  describe('Connection change notifications', () => {
    it('should notify parent when connection state changes to true', () => {
      const onConnectionChange = vi.fn();

      vi.mocked(useTerminal).mockReturnValue({
        isConnected: true,
        error: null,
        reconnect: mockReconnect,
        search: mockSearch,
        sendInput: mockSendInput,
        terminal: mockTerminalRef as ReturnType<typeof useTerminal>['terminal'],
      });

      render(
        <TerminalView
          sessionId="session-1"
          onConnectionChange={onConnectionChange}
        />,
      );

      expect(onConnectionChange).toHaveBeenCalledWith(true);
    });

    it('should notify parent when connection state is false', () => {
      const onConnectionChange = vi.fn();

      vi.mocked(useTerminal).mockReturnValue({
        isConnected: false,
        error: null,
        reconnect: mockReconnect,
        search: mockSearch,
        sendInput: mockSendInput,
        terminal: mockTerminalRef as ReturnType<typeof useTerminal>['terminal'],
      });

      render(
        <TerminalView
          sessionId="session-1"
          onConnectionChange={onConnectionChange}
        />,
      );

      expect(onConnectionChange).toHaveBeenCalledWith(false);
    });

    it('should not throw when onConnectionChange is not provided', () => {
      vi.mocked(useTerminal).mockReturnValue({
        isConnected: true,
        error: null,
        reconnect: mockReconnect,
        search: mockSearch,
        sendInput: mockSendInput,
        terminal: mockTerminalRef as ReturnType<typeof useTerminal>['terminal'],
      });

      expect(() => {
        render(<TerminalView sessionId="session-1" />);
      }).not.toThrow();
    });
  });

  describe('Error notifications', () => {
    it('should notify parent when an error occurs', () => {
      const onError = vi.fn();

      vi.mocked(useTerminal).mockReturnValue({
        isConnected: false,
        error: 'Not authenticated',
        reconnect: mockReconnect,
        search: mockSearch,
        sendInput: mockSendInput,
        terminal: mockTerminalRef as ReturnType<typeof useTerminal>['terminal'],
      });

      render(
        <TerminalView
          sessionId="session-1"
          onError={onError}
        />,
      );

      expect(onError).toHaveBeenCalledWith('Not authenticated');
    });

    it('should not call onError when there is no error', () => {
      const onError = vi.fn();

      render(
        <TerminalView
          sessionId="session-1"
          onError={onError}
        />,
      );

      expect(onError).not.toHaveBeenCalled();
    });
  });

  describe('Imperative handle', () => {
    it('should expose getTerminal through the ref handle', () => {
      const fakeTerminal = { cols: 80, rows: 24 } as unknown;
      const terminalRef = { current: fakeTerminal };
      vi.mocked(useTerminal).mockReturnValue({
        isConnected: false,
        error: null,
        reconnect: mockReconnect,
        search: mockSearch,
        sendInput: mockSendInput,
        terminal: terminalRef as ReturnType<typeof useTerminal>['terminal'],
      });

      const ref = createRef<TerminalViewHandle>();
      render(<TerminalView ref={ref} sessionId="session-1" />);

      expect(ref.current).not.toBeNull();
      expect(ref.current!.getTerminal()).toBe(fakeTerminal);
    });

    it('should return null from getTerminal when terminal is not initialized', () => {
      const nullRef = { current: null };
      vi.mocked(useTerminal).mockReturnValue({
        isConnected: false,
        error: null,
        reconnect: mockReconnect,
        search: mockSearch,
        sendInput: mockSendInput,
        terminal: nullRef as ReturnType<typeof useTerminal>['terminal'],
      });

      const ref = createRef<TerminalViewHandle>();
      render(<TerminalView ref={ref} sessionId="session-1" />);

      expect(ref.current!.getTerminal()).toBeNull();
    });

    it('should expose focus() which delegates to terminal.focus()', () => {
      const fakeTerminal = {
        focus: vi.fn(),
        buffer: { active: { getLine: vi.fn() } },
      } as unknown;
      const terminalRef = { current: fakeTerminal };
      vi.mocked(useTerminal).mockReturnValue({
        isConnected: false,
        error: null,
        reconnect: mockReconnect,
        search: mockSearch,
        sendInput: mockSendInput,
        terminal: terminalRef as ReturnType<typeof useTerminal>['terminal'],
      });

      const ref = createRef<TerminalViewHandle>();
      render(<TerminalView ref={ref} sessionId="test-session" />);

      expect(ref.current).not.toBeNull();
      ref.current!.focus();

      expect((fakeTerminal as { focus: ReturnType<typeof vi.fn> }).focus).toHaveBeenCalled();
    });
  });

  describe('Host-key prompt (#60)', () => {
    const refusal: HostKeyRefusal = {
      code: 'HOST_KEY_UNKNOWN',
      presented: { fingerprint: 'SHA256:presentedKeyFingerprintAAAAAAAAAAAAAAAAAAAA', algorithm: 'ssh-ed25519' },
      expected: null,
      serverProfileId: 'profile-a',
    };
    const writer = { ...mockUser, permissions: [...mockUser.permissions, 'servers:read', 'servers:write'] };
    const retryConnect = vi.fn();
    const dismissHostKey = vi.fn();

    function withRefusal(r: HostKeyRefusal | null) {
      vi.mocked(useTerminal).mockReturnValue({
        isConnected: false,
        error: null,
        reconnect: mockReconnect,
        search: mockSearch,
        sendInput: mockSendInput,
        terminal: mockTerminalRef as ReturnType<typeof useTerminal>['terminal'],
        hostKeyRefusal: r,
        retryConnect,
        dismissHostKey,
      });
    }

    beforeEach(() => {
      retryConnect.mockReset();
      dismissHostKey.mockReset();
      vi.mocked(trustHostKey).mockReset().mockResolvedValue({ id: 'profile-a' } as ServerProfile);
      vi.mocked(getServerProfile)
        .mockReset()
        .mockResolvedValue({ hostname: 'server-a.example.test' } as ServerProfile);
    });

    it('shows no dialog without a refusal', () => {
      withRefusal(null);
      render(<TerminalView sessionId="session-1" />, { wrapperOptions: { user: writer } });
      expect(screen.queryByTestId('host-key-dialog')).not.toBeInTheDocument();
    });

    it('opens the dialog on a refusal and retries the connection after trust', async () => {
      const user = userEvent.setup();
      withRefusal(refusal);
      render(<TerminalView sessionId="session-1" />, { wrapperOptions: { user: writer } });

      expect(screen.getByTestId('host-key-dialog')).toHaveAttribute('data-state', 'unknown');
      await user.click(screen.getByRole('button', { name: 'Trust and connect' }));

      expect(trustHostKey).toHaveBeenCalledWith('profile-a', refusal.presented.fingerprint, undefined);
      await waitFor(() => expect(retryConnect).toHaveBeenCalledTimes(1));
      expect(dismissHostKey).not.toHaveBeenCalled();
    });

    it('reports an untrusted key when the prompt is cancelled', async () => {
      const user = userEvent.setup();
      withRefusal(refusal);
      render(<TerminalView sessionId="session-1" />, { wrapperOptions: { user: writer } });

      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(dismissHostKey).toHaveBeenCalledWith(HOST_KEY_UNTRUSTED_MESSAGE);
      expect(retryConnect).not.toHaveBeenCalled();
    });

    it('reports a refused changed key when the mismatch prompt is cancelled', async () => {
      const user = userEvent.setup();
      withRefusal({ ...refusal, code: 'HOST_KEY_MISMATCH', expected: 'SHA256:trustedB' });
      render(<TerminalView sessionId="session-1" />, { wrapperOptions: { user: writer } });

      expect(screen.getByTestId('host-key-dialog')).toHaveAttribute('data-state', 'mismatch');
      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(dismissHostKey).toHaveBeenCalledWith(HOST_KEY_MISMATCH_MESSAGE);
    });
  });

  describe('status for the status bar (#77)', () => {
    it('reports latency, size and the last host-key refusal until it connects', () => {
      const onStatusChange = vi.fn();
      const refusal = { code: 'HOST_KEY_MISMATCH', presented: { fingerprint: 'SHA256:x', algorithm: 'ssh-ed25519' }, expected: 'SHA256:y', serverProfileId: 'p1' };
      vi.mocked(useTerminal).mockReturnValue({
        isConnected: false,
        error: null,
        reconnect: mockReconnect,
        search: mockSearch,
        sendInput: mockSendInput,
        terminal: mockTerminalRef as ReturnType<typeof useTerminal>['terminal'],
        hostKeyRefusal: refusal as HostKeyRefusal,
        latencyMs: null,
        size: { cols: 100, rows: 30 },
      } as unknown as ReturnType<typeof useTerminal>);
      const { rerender } = render(<TerminalView sessionId="s1" onStatusChange={onStatusChange} />);
      expect(onStatusChange).toHaveBeenLastCalledWith({ latencyMs: null, cols: 100, rows: 30, hostKeyRefusal: 'HOST_KEY_MISMATCH' });

      vi.mocked(useTerminal).mockReturnValue({
        isConnected: true,
        error: null,
        reconnect: mockReconnect,
        search: mockSearch,
        sendInput: mockSendInput,
        terminal: mockTerminalRef as ReturnType<typeof useTerminal>['terminal'],
        hostKeyRefusal: null,
        latencyMs: 17,
        size: { cols: 100, rows: 30 },
      } as unknown as ReturnType<typeof useTerminal>);
      rerender(<TerminalView sessionId="s1" onStatusChange={onStatusChange} />);
      expect(onStatusChange).toHaveBeenLastCalledWith({ latencyMs: 17, cols: 100, rows: 30, hostKeyRefusal: null });
    });
  });
});
