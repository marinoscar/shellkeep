import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, IconButton, Snackbar, Tooltip, Typography } from '@mui/material';
import {
  ArrowBack as ArrowBackIcon,
  AutoAwesomeOutlined as AssistantIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import { useNavigate, useParams } from 'react-router-dom';
import { useShellContextPaneVisible, useShellMainVariant } from '@marinoscar/platform-web/shell/headless';
import { useAuth, usePermissions } from '@marinoscar/platform-web/identity/headless';
import type { TerminalViewHandle } from '../components/terminal/TerminalView';
import { TerminalToolbar } from '../components/terminal/TerminalToolbar';
import { TerminalKeyShortcutsBar } from '../components/terminal/TerminalKeyShortcutsBar';
import { NewSessionDialog } from '../components/terminal/NewSessionDialog';
import { TERMINAL_WRITE_PERMISSION } from '../components/terminal/TerminalAccessGate';
import { useTerminalActions } from '../components/terminal/useTerminalActions';
import type { TerminalActionNotice } from '../components/terminal/useTerminalActions';
import { useTerminalLayout } from '../components/terminal/useTerminalLayout';
import { SplitLayout } from '../components/terminal/workspace/SplitLayout';
import { SplitControls } from '../components/terminal/workspace/SplitControls';
import { WorkspaceTabs } from '../components/terminal/workspace/WorkspaceTabs';
import { WorkspacePane } from '../components/terminal/workspace/WorkspacePane';
import type { PaneStatus } from '../components/terminal/workspace/WorkspacePane';
import { SessionSwitcherMenu } from '../components/terminal/workspace/SessionSwitcherMenu';
import { TerminalStatusBar } from '../components/terminal/workspace/TerminalStatusBar';
import type { HostKeyStatus } from '../components/terminal/workspace/TerminalStatusBar';
import { TerminalAiPanel } from '../components/terminal/ai/TerminalAiPanel';
import { useTerminalAiAvailable } from '../components/terminal/ai/useTerminalAiAvailable';
import { insertSuggestedCommand } from '../components/terminal/ai/insertCommand';
import { RenameSessionDialog } from '../components/terminal/workspace/RenameSessionDialog';
import { useWorkspaceLayout } from '../components/terminal/workspace/useWorkspaceLayout';
import {
  activateTab,
  closePane,
  closeTab,
  moveTab,
  openTab,
  setSplitDirection,
  splitWith,
  unsplit,
  visiblePanes,
} from '../components/terminal/workspace/workspaceLayout';
import { getServerProfile, getSession, updateSession } from '../services/terminal-api';
import type { KeyShortcut, ServerProfile, TerminalSession } from '../types';
import { encodeShortcut } from '../lib/terminal/encodeKeystroke';
import { useTerminalSettings } from '../hooks/useTerminalSettings';
import { DEFAULT_TERMINAL_SETTINGS, isKeyBarVisible } from '../lib/terminal/settings';
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
 * The terminal workspace at `/sessions/:id` (issue #77): open sessions as tabs,
 * two of them as a split, every pane its own `TerminalView` and WebSocket. It
 * fills the shell's full-bleed `<main>` (`useShellMainVariant`): no negative
 * margins and no height computed from the AppBar. Layout chain
 * (docs/SCROLLING.md, "CSS Layout Requirements"):
 *
 *   <main> (flex column) → root (flex: 1, minHeight: 0, relative)
 *     → frame (absolute; bottom = the key dock offset; flex column)
 *       → tabs, toolbar, SplitLayout (flex: 1, minHeight: 0) → panes → TerminalView,
 *         the gutter, the key bar
 *
 * Nothing in the frame is in flow for the page, so the terminal never sizes
 * the document and the document never scrolls.
 */
export default function TerminalWorkspacePage() {
  const { id: routeId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  useShellMainVariant('full-bleed');
  const { isPhone, isWide, isTouch } = useTerminalLayout();
  const { user } = useAuth();
  const { hasPermission } = usePermissions();
  const canWrite = hasPermission(TERMINAL_WRITE_PERMISSION);
  // The Sessions context pane lists the sessions beside the expanded rail;
  // wherever the platform does not draw it, the toolbar offers a menu.
  const switcherPaneVisible = useShellContextPaneVisible('sessions');
  // The AI panel: only with the `ai` feature on and `ai:use` (fail closed).
  const aiAvailable = useTerminalAiAvailable();
  const [aiOpen, setAiOpen] = useState(false);
  // The last "Suggest command" answer; #57 sets it from its API.
  const [aiSuggestion] = useState<string | null>(null);

  const { layout, commit, current } = useWorkspaceLayout(routeId, user?.id ?? null);
  const [sessions, setSessions] = useState<Record<string, TerminalSession>>({});
  const [status, setStatus] = useState<Record<string, PaneStatus>>({});
  const [ratio, setRatio] = useState(50);
  const [notice, setNotice] = useState<(TerminalActionNotice & { open: boolean }) | null>(null);
  const [newSessionDialogOpen, setNewSessionDialogOpen] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  // The user's terminal preferences and key shortcuts (#80): one source of
  // truth for the panes, the key bar and the toolbar toggles.
  const { terminal: preferences, keyShortcuts: storedShortcuts, updateTerminal } =
    useTerminalSettings();
  const showScrollButtons = preferences?.showScrollButtons ?? DEFAULT_TERMINAL_SETTINGS.showScrollButtons;
  const keyShortcuts = storedShortcuts ?? [];
  // `auto` (the default) shows the key bar on a phone or a touch screen, where
  // there is no Esc, Tab or Ctrl key; `always` and `never` are the user's.
  const keyShortcutsOpen = isKeyBarVisible(
    preferences?.showKeyBar ?? DEFAULT_TERMINAL_SETTINGS.showKeyBar,
    isPhone || isTouch,
  );

  // ---- the panes' handles --------------------------------------------------
  const views = useRef(new Map<string, TerminalViewHandle>());
  const registerView = useCallback((sessionId: string, handle: TerminalViewHandle | null) => {
    if (handle) views.current.set(sessionId, handle);
    else views.current.delete(sessionId);
  }, []);
  const onPaneStatus = useCallback((sessionId: string, patch: PaneStatus) => {
    setStatus((prev) => {
      const before = prev[sessionId] ?? {};
      const changed = (Object.keys(patch) as Array<keyof PaneStatus>).some((k) => before[k] !== patch[k]);
      return changed ? { ...prev, [sessionId]: { ...before, ...patch } } : prev;
    });
  }, []);
  const activeId = layout?.active ?? null;
  const getView = useCallback(() => (activeId ? (views.current.get(activeId) ?? null) : null), [activeId]);

  // ---- the key bar sits on the keyboard ------------------------------------
  const rootRef = useRef<HTMLDivElement>(null);
  const keyboardInset = useKeyboardInset();
  const [dockOffset, setDockOffset] = useState(0);
  useLayoutEffect(() => {
    const root = rootRef.current;
    const gap = root ? window.innerHeight - root.getBoundingClientRect().bottom : 0;
    setDockOffset(keyDockOffset(keyboardInset, gap));
  }, [keyboardInset]);

  // ---- the open sessions' details --------------------------------------------
  const tabsKey = layout?.tabs.join(',') ?? '';
  const requested = useRef(new Set<string>());
  useEffect(() => {
    const ids = tabsKey ? tabsKey.split(',') : [];
    for (const sessionId of ids) {
      if (requested.current.has(sessionId)) continue;
      requested.current.add(sessionId);
      getSession(sessionId)
        .then((loaded) => setSessions((prev) => ({ ...prev, [sessionId]: loaded })))
        .catch(() => {
          // Gone, or never ours: drop the tab (the last one leaves the workspace).
          requested.current.delete(sessionId);
          const now = current();
          if (now) commit(closeTab(now, sessionId));
        });
    }
  }, [tabsKey, commit, current]);

  // Focus the session the user just switched to. Not on load, and not on a
  // phone, where focusing raises the on-screen keyboard uninvited.
  const previousActive = useRef<string | null>(null);
  useEffect(() => {
    const previous = previousActive.current;
    previousActive.current = activeId;
    if (!activeId || !previous || previous === activeId || isPhone) return;
    const timer = setTimeout(() => views.current.get(activeId)?.focus(), 0);
    return () => clearTimeout(timer);
  }, [activeId, isPhone]);

  // The focused pane's server profile, for the status bar's host-key state
  // (#60). Read again each time the pane connects: the user may just have
  // trusted the key in the host-key dialog.
  const activeProfileId = activeId
    ? (sessions[activeId]?.serverProfileId ?? sessions[activeId]?.serverProfile.id)
    : undefined;
  const activeConnected = activeId ? (status[activeId]?.connected ?? false) : false;
  const [profiles, setProfiles] = useState<Record<string, ServerProfile>>({});
  useEffect(() => {
    if (!activeProfileId) return;
    let cancelled = false;
    getServerProfile(activeProfileId)
      .then((profile) => {
        if (!cancelled) setProfiles((prev) => ({ ...prev, [activeProfileId]: profile }));
      })
      .catch(() => {
        // Without `servers:read` the bar just leaves the host key out.
      });
    return () => {
      cancelled = true;
    };
  }, [activeProfileId, activeConnected]);

  const notify = useCallback((next: TerminalActionNotice) => setNotice({ ...next, open: true }), []);
  const activeSession = activeId ? (sessions[activeId] ?? null) : null;
  const actions = useTerminalActions({
    getView,
    session: activeSession,
    notify,
    onSessionCreated: (created) => {
      setSessions((prev) => ({ ...prev, [created.id]: created }));
      const now = current();
      if (now) commit(openTab(now, created.id));
    },
  });

  // ---- layout transitions ----------------------------------------------------
  const update = useCallback(
    (fn: (l: NonNullable<typeof layout>) => NonNullable<typeof layout> | null) => {
      const now = current();
      if (now) commit(fn(now));
    },
    [commit, current],
  );

  const handleRename = useCallback(
    async (sessionId: string, name: string) => {
      try {
        const updated = await updateSession(sessionId, { name });
        setSessions((prev) => ({ ...prev, [sessionId]: updated }));
      } catch {
        notify({ message: 'Could not rename the session', severity: 'error' });
      }
    },
    [notify],
  );

  const handleSendShortcut = useCallback(
    (shortcut: KeyShortcut) => {
      const data = encodeShortcut(shortcut);
      const view = getView();
      if (!data || !view) return;
      view.sendInput(data);
      view.focus();
    },
    [getView],
  );

  const handleToggleScrollButtons = useCallback(() => {
    void updateTerminal({ showScrollButtons: !showScrollButtons }).catch(() => undefined);
  }, [showScrollButtons, updateTerminal]);

  // The toolbar's key bar toggle stores the choice (#80): hiding it is
  // `never`, showing it is `always`, on this and every other device.
  const handleToggleKeyShortcuts = useCallback(() => {
    void updateTerminal({ showKeyBar: keyShortcutsOpen ? 'never' : 'always' }).catch(() => undefined);
  }, [keyShortcutsOpen, updateTerminal]);

  const renderPane = useCallback(
    (sessionId: string) => (
      <WorkspacePane
        sessionId={sessionId}
        showScrollButtons={showScrollButtons}
        preferences={preferences ?? undefined}
        registerView={registerView}
        onStatus={onPaneStatus}
      />
    ),
    [showScrollButtons, preferences, registerView, onPaneStatus],
  );

  const tabs = useMemo(
    () =>
      (layout?.tabs ?? []).map((sessionId) => ({
        id: sessionId,
        session: sessions[sessionId] ?? null,
        connected: status[sessionId]?.connected ?? false,
      })),
    [layout?.tabs, sessions, status],
  );

  if (!layout || !activeId) return null;

  // A phone shows one pane; a split stays in the URL for a wider screen.
  const visible = isPhone ? [activeId] : visiblePanes(layout);
  const splitOnScreen = visible.length > 1 && layout.split ? layout.split.dir : null;
  const splitCandidates = layout.tabs
    .filter((t) => t !== activeId)
    .map((t) => ({ id: t, label: sessions[t]?.name ?? t }));
  const sessionName = (sessionId: string) => sessions[sessionId]?.name ?? '';

  const activeStatus = status[activeId] ?? {};
  const activeProfile = activeProfileId ? profiles[activeProfileId] : undefined;
  const hostKey: HostKeyStatus | null =
    activeStatus.hostKeyRefusal === 'HOST_KEY_MISMATCH'
      ? 'mismatch'
      : activeStatus.hostKeyRefusal === 'HOST_KEY_UNKNOWN'
        ? 'unknown'
        : activeProfile
          ? activeProfile.fingerprint
            ? 'trusted'
            : 'unknown'
          : null;

  const renderHeader = (sessionId: string, index: number) => (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 1,
        minHeight: 28,
        flexShrink: 0,
        bgcolor: 'background.paper',
        borderBottom: 1,
        borderColor: 'divider',
      }}
    >
      <Typography variant="caption" sx={{ fontWeight: 600 }}>
        {index + 1}
      </Typography>
      <Typography variant="caption" noWrap sx={{ flex: 1, fontFamily: 'monospace', color: 'text.secondary' }}>
        {sessionName(sessionId)}
        {sessions[sessionId] ? ` · ${sessions[sessionId].serverProfile.name}` : ''}
      </Typography>
      <IconButton
        size="small"
        aria-label={`Close pane ${index + 1}`}
        onClick={() => update((l) => closePane(l, sessionId))}
        sx={{ p: 0.25 }}
      >
        <CloseIcon sx={{ fontSize: 14 }} />
      </IconButton>
    </Box>
  );

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
        <WorkspaceTabs
          variant={isPhone ? 'chips' : 'tabs'}
          tabs={tabs}
          activeId={activeId}
          onActivate={(sessionId) => update((l) => activateTab(l, sessionId))}
          onClose={(sessionId) => update((l) => closeTab(l, sessionId))}
          onRename={(sessionId) => setRenaming(sessionId)}
          onReorder={(from, to) => update((l) => moveTab(l, from, to))}
          onNewSession={canWrite ? () => setNewSessionDialogOpen(true) : undefined}
          trailing={
            <>
              {!switcherPaneVisible && (
                <SessionSwitcherMenu activeId={activeId} onSelect={(sessionId) => update((l) => openTab(l, sessionId))} />
              )}
              {aiAvailable && (
                <Button
                  size="small"
                  variant={aiOpen ? 'contained' : 'outlined'}
                  startIcon={<AssistantIcon fontSize="small" />}
                  aria-pressed={aiOpen}
                  onClick={() => setAiOpen((o) => !o)}
                  sx={{ minHeight: 32, ml: 0.5 }}
                >
                  AI
                </Button>
              )}
              {!isPhone && (
                <SplitControls
                  current={splitOnScreen}
                  candidates={splitCandidates}
                  onSplit={(dir, other) => update((l) => splitWith(l, dir, other))}
                  onSetDirection={(dir) => update((l) => setSplitDirection(l, dir))}
                  onUnsplit={() => update(unsplit)}
                />
              )}
            </>
          }
        />
        <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0, bgcolor: 'background.default' }}>
          <Tooltip title="Back to sessions">
            <IconButton onClick={() => navigate('/sessions')} sx={{ ml: { xs: 0, sm: 1 } }} aria-label="Back to sessions">
              <ArrowBackIcon />
            </IconButton>
          </Tooltip>
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <TerminalToolbar
              sessionName={activeSession?.name ?? ''}
              isConnected={status[activeId]?.connected ?? false}
              onOpenNewTab={() => window.open(`/sessions/${activeId}`, '_blank')}
              onDisconnect={() => navigate('/sessions')}
              onRename={(name) => void handleRename(activeId, name)}
              showScrollButtons={showScrollButtons}
              onToggleScrollButtons={handleToggleScrollButtons}
              onCopyAll={actions.copyAll}
              onDownload={actions.downloadHistory}
              isDownloading={actions.isDownloading}
              onPaste={actions.paste}
              onUpload={actions.uploadFile}
              onNewSession={canWrite ? () => setNewSessionDialogOpen(true) : undefined}
              serverProfileName={activeSession?.serverProfile.name}
              serverProfileColor={activeSession?.serverProfile.color}
              keyShortcutsOpen={keyShortcutsOpen}
              onToggleKeyShortcuts={handleToggleKeyShortcuts}
              compact={isPhone}
              onRequestRename={() => setRenaming(activeId)}
            />
          </Box>
        </Box>

        {/* Never `overflow: hidden` between here and the xterm (docs/SCROLLING.md). */}
        <Box data-testid="terminal-body" sx={{ display: 'flex', flex: 1, minHeight: 0, minWidth: 0 }}>
          <SplitLayout
            paneIds={layout.tabs}
            visible={visible}
            direction={layout.split?.dir ?? 'v'}
            ratio={ratio}
            onRatioChange={setRatio}
            focusedId={activeId}
            onFocusPane={(sessionId) => {
              if (sessionId !== activeId) update((l) => activateTab(l, sessionId));
            }}
            renderHeader={renderHeader}
            renderPane={renderPane}
          />
          {aiAvailable && (
            <TerminalAiPanel
              open={aiOpen}
              onClose={() => setAiOpen(false)}
              variant={isWide ? 'side' : 'sheet'}
              suggestion={aiSuggestion}
              onInsert={(command) => {
                insertSuggestedCommand(getView(), command);
                if (!isWide) setAiOpen(false);
              }}
            />
          )}
        </Box>
        {/* The status bar is the bottom gutter: outside the FitAddon host (docs/SCROLLING.md). */}
        <TerminalStatusBar
          session={activeSession}
          connected={activeConnected}
          latencyMs={activeStatus.latencyMs ?? null}
          cols={activeStatus.cols ?? null}
          rows={activeStatus.rows ?? null}
          hostKey={hostKey}
          fingerprint={activeProfile?.fingerprint ?? null}
          algorithm={activeProfile?.hostKeyAlgorithm ?? null}
          compact={isPhone}
        />

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
      <RenameSessionDialog
        name={renaming ? sessionName(renaming) : null}
        onClose={() => setRenaming(null)}
        onSave={(name) => {
          if (renaming) void handleRename(renaming, name);
        }}
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
