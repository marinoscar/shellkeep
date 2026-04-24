import { useRef, useEffect, useImperativeHandle, forwardRef } from 'react';
import { Box } from '@mui/material';
import { useTerminal } from '../../hooks/useTerminal';
import { useTouchScroll } from '../../hooks/useTouchScroll';
import { TerminalScrollButtons } from './TerminalScrollButtons';
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
  showScrollButtons?: boolean;
}

export const TerminalView = forwardRef<TerminalViewHandle, TerminalViewProps>(
  function TerminalView({ sessionId, onConnectionChange, onError, showScrollButtons = false }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { isConnected, error, terminal, sendInput } = useTerminal(sessionId, containerRef);
  useTouchScroll(containerRef);

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
    </Box>
  );
});
