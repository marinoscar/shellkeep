import { useRef, useEffect, useImperativeHandle, forwardRef, useState, useMemo, useCallback } from 'react';
import { Box, Chip, useTheme } from '@mui/material';
import {
  ArrowBack as ArrowLeftIcon,
  ArrowDownward as ArrowDownIcon,
  ArrowForward as ArrowRightIcon,
  ArrowUpward as ArrowUpIcon,
  ManageSearchOutlined as ExplainIcon,
  OpenWith as ArrowModeIcon,
} from '@mui/icons-material';
import { useTerminal } from '../../hooks/useTerminal';
import { useTouchScroll } from '../../hooks/useTouchScroll';
import { TerminalScrollButtons } from './TerminalScrollButtons';
import { useTerminalFileLinks, type TerminalFileLinksConfig } from './files/useTerminalFileLinks';
import { TerminalFileLinkMenu } from './files/TerminalFileLinkMenu';
import { HostKeyDialog } from '../server-profiles/HostKeyDialog';
import { HOST_KEY_MISMATCH_MESSAGE, HOST_KEY_UNTRUSTED_MESSAGE } from '../../services/terminal-ws';
import type { Terminal } from '@xterm/xterm';
import type { HostKeyErrorCode } from '../../types/terminal';
import { DEFAULT_TERMINAL_SETTINGS, type ResolvedTerminalSettings } from '../../lib/terminal/settings';
import { resolveTerminalTheme } from '../../lib/terminal/appearance';
import type { TerminalInputModifiers } from '../../lib/terminal/keys/modifiedInput';
import type { ModifierStore } from '../../lib/terminal/keys/modifierState';
import { createHeldKeySender, DRAG_GEARS, type ArrowDirection, type DragReading } from '../../lib/terminal/keys/arrowRepeat';
import { useTerminalArrowMode } from './useTerminalArrowMode';
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
  /**
   * File references in the output (#155): the session's server. Give it only to a user who
   * may use the files API (`sessions:write`, the terminal's own rule). Omitted: no file links.
   */
  fileLinks?: TerminalFileLinksConfig | null;
  /** The key bar's armed or locked modifiers, applied to typed input (#166). */
  inputModifiers?: TerminalInputModifiers | null;
  /**
   * Long-press-and-drag arrow mode on touch (#168): the shared modifier store
   * (its armed modifiers apply to the whole drag) and the haptics option.
   * Omitted: no arrow mode.
   */
  arrowMode?: TerminalArrowModeConfig | null;
}

export interface TerminalArrowModeConfig {
  modifiers?: ModifierStore | null;
  haptics: boolean;
}

const ARROW_ICONS: Record<ArrowDirection, typeof ArrowUpIcon> = {
  up: ArrowUpIcon,
  down: ArrowDownIcon,
  left: ArrowLeftIcon,
  right: ArrowRightIcon,
};

/** The subtle overlay while arrow mode is on: the direction and the gear (#168). */
function ArrowModeIndicator({ state }: { state: DragReading }) {
  const Icon = state.direction ? ARROW_ICONS[state.direction] : ArrowModeIcon;
  const label = state.direction
    ? `Arrow mode: ${state.direction}, speed ${state.gear} of ${DRAG_GEARS.length}`
    : 'Arrow mode: drag to move the cursor';
  return (
    <Box
      role="status"
      aria-label={label}
      data-testid="terminal-arrow-mode"
      data-direction={state.direction ?? undefined}
      data-gear={state.gear}
      sx={{
        position: 'absolute',
        top: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 3,
        pointerEvents: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        px: 1.25,
        py: 0.5,
        borderRadius: 4,
        bgcolor: 'background.paper',
        color: 'text.primary',
        boxShadow: 2,
        opacity: 0.9,
        '@keyframes terminalArrowMode': { from: { opacity: 0 }, to: { opacity: 0.9 } },
        animation: 'terminalArrowMode 120ms ease-out',
        '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
      }}
    >
      <Icon fontSize="small" aria-hidden />
      <Box component="span" aria-hidden sx={{ display: 'flex', gap: 0.5 }}>
        {DRAG_GEARS.map((_, i) => (
          <Box
            key={i}
            component="span"
            data-testid="terminal-arrow-mode-gear"
            data-on={i < state.gear ? 'true' : undefined}
            sx={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              bgcolor: i < state.gear ? 'primary.main' : 'action.disabled',
            }}
          />
        ))}
      </Box>
    </Box>
  );
}

export const TerminalView = forwardRef<TerminalViewHandle, TerminalViewProps>(
  function TerminalView({ sessionId, onConnectionChange, onError, onStatusChange, showScrollButtons = false, preferences = DEFAULT_TERMINAL_SETTINGS, isReservedKey, onExplainSelection, fileLinks, inputModifiers, arrowMode }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const appMode = useTheme().palette.mode;
  const appearance = useMemo(() => ({ preferences, appMode, isReservedKey }), [preferences, appMode, isReservedKey]);
  // The links read the terminal `useTerminal` holds; it is created after this hook runs.
  const xtermHolder = useRef<{ current: Terminal | null } | null>(null);
  const getXterm = useCallback(() => xtermHolder.current?.current ?? null, []);
  // Arrow mode (#168) runs after the links exist; the links ask it, at touch end, whether it took the gesture.
  const arrowClaimed = useRef<() => boolean>(() => false);
  const fileLinkOptions = useMemo(() => ({ isTouchClaimed: () => arrowClaimed.current() }), []);
  const fileLinkState = useTerminalFileLinks(sessionId, containerRef, getXterm, fileLinks, fileLinkOptions);
  const terminalOptions = useMemo(
    () => ({ fileLinks: fileLinkState.source, inputModifiers }),
    [fileLinkState.source, inputModifiers],
  );
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
  } = useTerminal(sessionId, containerRef, appearance, terminalOptions);
  xtermHolder.current = terminal ?? null;
  useTouchScroll(containerRef);

  // Long-press-and-drag arrows (#168): through this pane's terminal, its cursor
  // mode, and the modifiers armed when the drag began.
  const arrowModifiers = arrowMode?.modifiers ?? null;
  const beginArrowHold = useCallback(
    () =>
      createHeldKeySender({
        modifiers: arrowModifiers,
        applicationCursor: () => terminal.current?.modes?.applicationCursorKeysMode ?? false,
        write: sendInput,
      }),
    [arrowModifiers, terminal, sendInput],
  );
  const arrow = useTerminalArrowMode(wrapperRef, containerRef, {
    enabled: Boolean(arrowMode),
    beginHold: beginArrowHold,
    haptics: arrowMode?.haptics ?? false,
    isLinkAt: fileLinkState.isLinkAt,
  });
  arrowClaimed.current = arrow.isTouchClaimed;

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
      ref={wrapperRef}
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
      {arrow.state && <ArrowModeIndicator state={arrow.state} />}
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
      {fileLinks && (
        <TerminalFileLinkMenu
          sessionId={sessionId}
          profileId={fileLinks.profileId}
          onShowInFileBrowser={fileLinks.onShowInFileBrowser}
          state={fileLinkState.menu}
          onClose={fileLinkState.closeMenu}
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
