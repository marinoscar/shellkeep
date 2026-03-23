import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { render } from '../../utils/test-utils';
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

// Mock xterm CSS import
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

import { TerminalView, type TerminalViewHandle } from '../../../components/terminal/TerminalView';
import { useTerminal } from '../../../hooks/useTerminal';

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

    it('should call useTerminal with the provided sessionId', () => {
      render(<TerminalView sessionId="test-session-42" />);

      expect(useTerminal).toHaveBeenCalledWith(
        'test-session-42',
        expect.objectContaining({ current: expect.anything() }),
      );
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
});
