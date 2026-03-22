import { useRef, useEffect } from 'react';
import { Box } from '@mui/material';
import { useTerminal } from '../../hooks/useTerminal';
import '@xterm/xterm/css/xterm.css';

interface TerminalViewProps {
  sessionId: string;
  onConnectionChange?: (connected: boolean) => void;
  onError?: (error: string) => void;
}

export function TerminalView({ sessionId, onConnectionChange, onError }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { isConnected, error } = useTerminal(sessionId, containerRef);

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
        '& .xterm': {
          height: '100%',
          padding: '4px',
        },
      }}
    />
  );
}
