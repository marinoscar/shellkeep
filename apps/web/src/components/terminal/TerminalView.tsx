import { useRef, useEffect, useImperativeHandle, forwardRef, useState } from 'react';
import { Box } from '@mui/material';
import { useTerminal } from '../../hooks/useTerminal';
import { useTouchScroll } from '../../hooks/useTouchScroll';
import { TerminalScrollButtons } from './TerminalScrollButtons';
import { HostKeyDialog } from '../server-profiles/HostKeyDialog';
import { HOST_KEY_MISMATCH_MESSAGE, HOST_KEY_UNTRUSTED_MESSAGE } from '../../services/terminal-ws';
import type { Terminal } from '@xterm/xterm';
import type { HostKeyErrorCode } from '../../types/terminal';
import '@xterm/xterm/css/xterm.css';

export interface TerminalViewHandle {
  getTerminal: () => Terminal | null;
  sendInput: (data: string) => void;
  focus: () => void;
  /** Open a fresh socket for the session (after a maintenance refusal, #46). */
  reconnect: () => void;
}

/** What the terminal status bar shows about one pane (#77). */
export interface TerminalViewStatus {
  /** The heartbeat's last round trip in ms, or `null` while not measured. */
  latencyMs: number | null;
  /** The pty size the pane last fitted to, or `null` before the first fit. */
  cols: number | null;
  rows: number | null;
  /**
   * The last host-key refusal of this pane (#60) until it connects: the key is
   * unknown or changed. `null` once connected or when there was none.
   */
  hostKeyRefusal: HostKeyErrorCode | null;
}

interface TerminalViewProps {
  sessionId: string;
  onConnectionChange?: (connected: boolean) => void;
  onError?: (error: string) => void;
  /** The pane's latency, size and host-key state, for the status bar (#77). */
  onStatusChange?: (status: TerminalViewStatus) => void;
  showScrollButtons?: boolean;
}

export const TerminalView = forwardRef<TerminalViewHandle, TerminalViewProps>(
  function TerminalView({ sessionId, onConnectionChange, onError, onStatusChange, showScrollButtons = false }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const {
    isConnected,
    error,
    terminal,
    sendInput,
    reconnect,
    hostKeyRefusal,
    retryConnect,
    dismissHostKey,
    latencyMs = null,
    size = null,
  } = useTerminal(sessionId, containerRef);
  useTouchScroll(containerRef);

  useImperativeHandle(ref, () => ({
    getTerminal: () => terminal.current,
    sendInput,
    focus: () => terminal.current?.focus(),
    reconnect,
  }), [terminal, sendInput, reconnect]);

  // Notify parent of connection changes
  useEffect(() => {
    onConnectionChange?.(isConnected);
  }, [isConnected, onConnectionChange]);

  // The last host-key refusal stays reported (a declined prompt closes the
  // dialog but the key is still not trusted) until the pane connects.
  const [lastRefusal, setLastRefusal] = useState<HostKeyErrorCode | null>(null);
  useEffect(() => {
    if (hostKeyRefusal) setLastRefusal(hostKeyRefusal.code);
    else if (isConnected) setLastRefusal(null);
  }, [hostKeyRefusal, isConnected]);

  useEffect(() => {
    onStatusChange?.({
      latencyMs,
      cols: size?.cols ?? null,
      rows: size?.rows ?? null,
      hostKeyRefusal: lastRefusal,
    });
  }, [latencyMs, size?.cols, size?.rows, lastRefusal, onStatusChange]);

  // Notify parent of errors
  useEffect(() => {
    if (error) {
      onError?.(error);
    }
  }, [error, onError]);

  return (
    <Box
      onContextMenu={(e) => e.preventDefault()}
      sx={{
        position: 'relative',
        width: '100%',
        height: '100%',
      }}
    >
      <Box
        ref={containerRef}
        data-testid="terminal-xterm-host"
        sx={{
          width: '100%',
          height: '100%',
          bgcolor: '#1e1e1e',
          touchAction: 'none',
          '& .xterm': {
            height: '100%',
            padding: '4px',
            boxSizing: 'border-box',
          },
        }}
      />
      <TerminalScrollButtons containerRef={containerRef} visible={showScrollButtons} />
      {/* An unknown or changed host key (#60): trust it, then ask for the session again. */}
      <HostKeyDialog
        refusal={hostKeyRefusal ?? null}
        onTrusted={() => {
          retryConnect?.();
          terminal.current?.focus();
        }}
        onCancel={() =>
          dismissHostKey?.(
            hostKeyRefusal?.code === 'HOST_KEY_MISMATCH'
              ? HOST_KEY_MISMATCH_MESSAGE
              : HOST_KEY_UNTRUSTED_MESSAGE,
          )
        }
      />
    </Box>
  );
});
