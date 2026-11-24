import { useRef, useEffect, useImperativeHandle, forwardRef, useState, useMemo } from 'react';
import { Box, Chip, useTheme } from '@mui/material';
import { ManageSearchOutlined as ExplainIcon } from '@mui/icons-material';
import { useTerminal } from '../../hooks/useTerminal';
import { useTouchScroll } from '../../hooks/useTouchScroll';
import { TerminalScrollButtons } from './TerminalScrollButtons';
import { HostKeyDialog } from '../server-profiles/HostKeyDialog';
import { HOST_KEY_MISMATCH_MESSAGE, HOST_KEY_UNTRUSTED_MESSAGE } from '../../services/terminal-ws';
import type { Terminal } from '@xterm/xterm';
import type { HostKeyErrorCode } from '../../types/terminal';
import { DEFAULT_TERMINAL_SETTINGS, type ResolvedTerminalSettings } from '../../lib/terminal/settings';
import { resolveTerminalTheme } from '../../lib/terminal/appearance';
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
  /**
   * The user's terminal preferences (#80): font, size, line height, cursor,
   * scrollback, theme, bell and copy-on-select. A change applies to the open
   * terminal in place, without reconnecting. Default: the built-in defaults.
   */
  preferences?: ResolvedTerminalSettings;
  /** Keys the page handles itself (the AI assist shortcut); they never reach the PTY (#57). */
  isReservedKey?: (event: KeyboardEvent) => boolean;
  /** Explain the selected text (#58). Omit when AI is unavailable: no chip is drawn. */
  onExplainSelection?: () => void;
}

export const TerminalView = forwardRef<TerminalViewHandle, TerminalViewProps>(
  function TerminalView({ sessionId, onConnectionChange, onError, onStatusChange, showScrollButtons = false, preferences = DEFAULT_TERMINAL_SETTINGS, isReservedKey, onExplainSelection }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const appMode = useTheme().palette.mode;
  const appearance = useMemo(() => ({ preferences, appMode, isReservedKey }), [preferences, appMode, isReservedKey]);
  const background = resolveTerminalTheme(preferences.theme, appMode).background;
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
    bellCount = 0,
    hasSelection = false,
  } = useTerminal(sessionId, containerRef, appearance);
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
          bgcolor: background,
          touchAction: 'none',
          '& .xterm': {
            height: '100%',
            padding: '4px',
            boxSizing: 'border-box',
          },
        }}
      />
      {/* The visual bell (#80): a brief flash over the terminal, re-keyed per bell. */}
      {bellCount > 0 && (
        <Box
          key={bellCount}
          data-testid="terminal-visual-bell"
          aria-hidden
          sx={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            bgcolor: 'text.primary',
            opacity: 0,
            '@keyframes terminalBell': { from: { opacity: 0.15 }, to: { opacity: 0 } },
            animation: 'terminalBell 200ms ease-out',
            '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
          }}
        />
      )}
      {/* The selection's Explain action (#58): a floating chip, only while text is selected. */}
      {onExplainSelection && hasSelection && (
        <Chip
          label="Explain"
          size="small"
          color="secondary"
          icon={<ExplainIcon />}
          clickable
          aria-label="Explain selection"
          // Keep the click from taking focus, which would clear the selection before it is read.
          onMouseDown={(e) => e.preventDefault()}
          onClick={onExplainSelection}
          sx={{ position: 'absolute', top: 8, right: 16, zIndex: 2, boxShadow: 2 }}
        />
      )}
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
