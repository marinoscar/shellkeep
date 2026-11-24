import { useRef, useEffect, useImperativeHandle, forwardRef } from 'react';
import { Box } from '@mui/material';
import { useTerminal } from '../../hooks/useTerminal';
import { useTouchScroll } from '../../hooks/useTouchScroll';
import { TerminalScrollButtons } from './TerminalScrollButtons';
import { HostKeyDialog } from '../server-profiles/HostKeyDialog';
import { HOST_KEY_MISMATCH_MESSAGE, HOST_KEY_UNTRUSTED_MESSAGE } from '../../services/terminal-ws';
import type { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';

export interface TerminalViewHandle {
  getTerminal: () => Terminal | null;
  sendInput: (data: string) => void;
  focus: () => void;
  /** Open a fresh socket for the session (after a maintenance refusal, #46). */
  reconnect: () => void;
}

interface TerminalViewProps {
  sessionId: string;
  onConnectionChange?: (connected: boolean) => void;
  onError?: (error: string) => void;
  showScrollButtons?: boolean;
}

export const TerminalView = forwardRef<TerminalViewHandle, TerminalViewProps>(
  function TerminalView({ sessionId, onConnectionChange, onError, showScrollButtons = false }, ref) {
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
