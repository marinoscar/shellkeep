import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Alert, Box, IconButton, Snackbar, Tooltip } from '@mui/material';
import { ArrowBack as ArrowBackIcon } from '@mui/icons-material';
import { useNavigate, useParams } from 'react-router-dom';
import { useShellMainVariant } from '@marinoscar/platform-web/shell/headless';
import { TerminalView } from '../components/terminal/TerminalView';
import type { TerminalViewHandle } from '../components/terminal/TerminalView';
import { TerminalToolbar } from '../components/terminal/TerminalToolbar';
import { TerminalKeyShortcutsBar } from '../components/terminal/TerminalKeyShortcutsBar';
import { TerminalConnectionAlert } from '../components/terminal/TerminalConnectionAlert';
import { NewSessionDialog } from '../components/terminal/NewSessionDialog';
import { useTerminalActions } from '../components/terminal/useTerminalActions';
import type { TerminalActionNotice } from '../components/terminal/useTerminalActions';
import { useTerminalLayout } from '../components/terminal/useTerminalLayout';
import { getSession, updateSession } from '../services/terminal-api';
import type { KeyShortcut, TerminalSession } from '../types';
import { encodeShortcut } from '../lib/terminal/encodeKeystroke';
import { useTerminalSettings } from '../hooks/useTerminalSettings';
import { useKeyboardInset } from '../hooks/useKeyboardInset';

/**
 * How far the frame's bottom must rise so the key shortcuts bar sits directly
 * on top of the on-screen keyboard. `useKeyboardInset` measures the keyboard
 * from the bottom of the layout viewport; the page itself already ends `gap`
 * pixels above that (the phone bottom bar's clearance, gate 3), so only the
 * rest is added. Exported for tests.
 */
export function keyDockOffset(keyboardInset: number, gapBelowPage: number): number {
  return Math.max(0, Math.round(keyboardInset - Math.max(0, gapBelowPage)));
}

/**
 * The terminal workspace at `/sessions/:id` (issue #77). It fills the shell's
 * full-bleed `<main>` (`useShellMainVariant`): no negative margins and no
 * height computed from the AppBar. Layout chain (docs/SCROLLING.md, "CSS
 * Layout Requirements"):
 *
 *   <main> (flex column) → root (flex: 1, minHeight: 0, relative)
 *     → frame (absolute; bottom = the key dock offset; flex column)
 *       → toolbar, panes (flexGrow: 1, minHeight: 0), status, key bar
 *
 * Nothing in the frame is in flow for the page, so the terminal never sizes
 * the document and the document never scrolls.
 */
export default function TerminalWorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  useShellMainVariant('full-bleed');
  const { isPhone } = useTerminalLayout();

  const viewRef = useRef<TerminalViewHandle>(null);
  const [session, setSession] = useState<TerminalSession | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [terminalError, setTerminalError] = useState<string | null>(null);
  const [notice, setNotice] = useState<(TerminalActionNotice & { open: boolean }) | null>(null);
  const [newSessionDialogOpen, setNewSessionDialogOpen] = useState(false);
  const { settings, updateSettings } = useTerminalSettings();
  const showScrollButtons = settings?.terminal?.showScrollButtons ?? true;
  const keyShortcuts = settings?.terminal?.keyShortcuts ?? [];
  // Open by default on a phone, where there is no Esc, Tab or Ctrl key.
  const [keyShortcutsOpen, setKeyShortcutsOpen] = useState(isPhone);

  // The key bar sits on the keyboard: the frame's bottom follows the inset.
  const rootRef = useRef<HTMLDivElement>(null);
  const keyboardInset = useKeyboardInset();
  const [dockOffset, setDockOffset] = useState(0);
  useLayoutEffect(() => {
    const root = rootRef.current;
    const gap = root ? window.innerHeight - root.getBoundingClientRect().bottom : 0;
    setDockOffset(keyDockOffset(keyboardInset, gap));
  }, [keyboardInset]);

  const notify = useCallback((next: TerminalActionNotice) => setNotice({ ...next, open: true }), []);
  const getView = useCallback(() => viewRef.current, []);
  const actions = useTerminalActions({
    getView,
    session,
    notify,
    onSessionCreated: (created) => navigate(`/sessions/${created.id}`),
  });

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    getSession(id)
      .then((loaded) => {
        if (!cancelled) setSession(loaded);
      })
      .catch(() => {
        if (!cancelled) navigate('/sessions');
      });
    return () => {
      cancelled = true;
    };
  }, [id, navigate]);

  const handleToggleScrollButtons = useCallback(() => {
    void updateSettings({ terminal: { showScrollButtons: !showScrollButtons } });
  }, [showScrollButtons, updateSettings]);

  const handleSendShortcut = useCallback((shortcut: KeyShortcut) => {
    const data = encodeShortcut(shortcut);
    if (!data) return;
    viewRef.current?.sendInput(data);
    viewRef.current?.focus();
  }, []);

  const handleConnectionChange = useCallback((connected: boolean) => {
    setIsConnected(connected);
    // A (re)connected session clears whatever went wrong before.
    if (connected) setTerminalError(null);
  }, []);

  const handleRename = useCallback(
    async (newName: string) => {
      if (!id) return;
      try {
        setSession(await updateSession(id, { name: newName }));
      } catch {
        notify({ message: 'Could not rename the session', severity: 'error' });
      }
    },
    [id, notify],
  );

  if (!id || !session) {
    return null;
  }

  return (
    <Box ref={rootRef} data-testid="terminal-workspace" sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
      <Box
        data-testid="terminal-workspace-frame"
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: `${dockOffset}px`,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          boxSizing: 'border-box',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0, bgcolor: 'background.default' }}>
          <Tooltip title="Back to sessions">
            <IconButton onClick={() => navigate('/sessions')} sx={{ ml: 1 }} aria-label="Back to sessions">
              <ArrowBackIcon />
            </IconButton>
          </Tooltip>
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <TerminalToolbar
              sessionName={session.name}
              isConnected={isConnected}
              onOpenNewTab={() => window.open(`/sessions/${id}`, '_blank')}
              onDisconnect={() => navigate('/sessions')}
              onRename={handleRename}
              showScrollButtons={showScrollButtons}
              onToggleScrollButtons={handleToggleScrollButtons}
              onCopyAll={actions.copyAll}
              onDownload={actions.downloadHistory}
              isDownloading={actions.isDownloading}
              onPaste={actions.paste}
              onUpload={actions.uploadFile}
              onNewSession={() => setNewSessionDialogOpen(true)}
              serverProfileName={session.serverProfile.name}
              serverProfileColor={session.serverProfile.color}
              keyShortcutsOpen={keyShortcutsOpen}
              onToggleKeyShortcuts={() => setKeyShortcutsOpen((o) => !o)}
            />
          </Box>
        </Box>

        {/* The panes. Never `overflow: hidden` here (docs/SCROLLING.md). */}
        <Box data-testid="terminal-panes" sx={{ flexGrow: 1, minHeight: 0, position: 'relative' }}>
          <TerminalView
            ref={viewRef}
            sessionId={id}
            onConnectionChange={handleConnectionChange}
            onError={setTerminalError}
            showScrollButtons={showScrollButtons}
          />
          <TerminalConnectionAlert
            error={terminalError}
            onDismiss={() => setTerminalError(null)}
            onRetry={() => {
              setTerminalError(null);
              viewRef.current?.reconnect();
            }}
          />
        </Box>
        {/* The bottom gutter, outside the FitAddon host (docs/SCROLLING.md). */}
        <Box sx={{ height: '30px', flexShrink: 0 }} aria-hidden />

        {/* Last in the frame, so it sits directly on the keyboard. */}
        <Box data-testid="terminal-key-dock" sx={{ flexShrink: 0 }}>
          <TerminalKeyShortcutsBar open={keyShortcutsOpen} shortcuts={keyShortcuts} onSend={handleSendShortcut} />
        </Box>
      </Box>

      <NewSessionDialog
        open={newSessionDialogOpen}
        onClose={() => setNewSessionDialogOpen(false)}
        onCreate={actions.createNewSession}
      />
      <Snackbar
        open={notice?.open ?? false}
        autoHideDuration={4000}
        onClose={() => setNotice((n) => (n ? { ...n, open: false } : n))}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setNotice((n) => (n ? { ...n, open: false } : n))}
          severity={notice?.severity ?? 'info'}
          variant="filled"
        >
          {notice?.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
