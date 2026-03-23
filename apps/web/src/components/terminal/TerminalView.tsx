import { useRef, useEffect, useImperativeHandle, forwardRef } from 'react';
import { Box } from '@mui/material';
import { useTerminal } from '../../hooks/useTerminal';
import type { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';

export interface TerminalViewHandle {
  getTerminal: () => Terminal | null;
  sendInput: (data: string) => void;
  focus: () => void;
}

interface TerminalViewProps {
  sessionId: string;
  onConnectionChange?: (connected: boolean) => void;
  onError?: (error: string) => void;
}

export const TerminalView = forwardRef<TerminalViewHandle, TerminalViewProps>(
  function TerminalView({ sessionId, onConnectionChange, onError }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { isConnected, error, terminal, sendInput } = useTerminal(sessionId, containerRef);

  useImperativeHandle(ref, () => ({
    getTerminal: () => terminal.current,
    sendInput,
    focus: () => terminal.current?.focus(),
  }), [terminal, sendInput]);

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
      ref={containerRef}
      sx={{
        width: '100%',
        height: '100%',
        bgcolor: '#1e1e1e',
        overflow: 'hidden',
        '& .xterm': {
          height: '100%',
          padding: '4px',
        },
        '& .xterm-viewport': {
          overflow: 'hidden !important',
        },
        '& .xterm-screen': {
          height: '100% !important',
        },
      }}
    />
  );
});
