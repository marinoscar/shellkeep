import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, IconButton, Snackbar, Tooltip, Typography } from '@mui/material';
import {
  ArrowBack as ArrowBackIcon,
  AutoAwesomeOutlined as AssistantIcon,
  Close as CloseIcon,
  FolderOpenOutlined as FilesIcon,
} from '@mui/icons-material';
import { useNavigate, useParams } from 'react-router-dom';
import { useShellContextPaneVisible, useShellMainVariant } from '@marinoscar/platform-web/shell/headless';
import { useAuth, usePermissions } from '@marinoscar/platform-web/identity/headless';
import type { TerminalViewHandle } from '../components/terminal/TerminalView';
import { TerminalToolbar } from '../components/terminal/TerminalToolbar';
import { TerminalKeyShortcutsBar } from '../components/terminal/TerminalKeyShortcutsBar';
import { TerminalKeyPanel } from '../components/terminal/keys/TerminalKeyPanel';
import { useAttachFile } from '../components/terminal/keys/useAttachFile';
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
import { AI_ASSIST_ACTION, matchesAiAssistShortcut } from '../lib/terminal/aiAssistShortcut';
import { AI_EXPLAIN_ACTION, matchesAiExplainShortcut } from '../lib/terminal/aiExplainShortcut';
import { EXPLAIN_SELECTION_MAX } from '../components/terminal/ai/ExplainPanel';
import { ExplainMenuButton } from '../components/terminal/ai/ExplainMenuButton';
import type { ExplainTrigger } from '../components/terminal/ai/ExplainPanel';
import { FileBrowserPanel } from '../components/terminal/files/FileBrowserPanel';
import type { TerminalFileLinksConfig } from '../components/terminal/files/useTerminalFileLinks';
import type { FileBrowserReveal } from '../components/files/browser/FileBrowser';
import { revealOf } from '../lib/files/browser';
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
import type { ServerProfile, TerminalSession } from '../types';
import { createModifierInputInterceptor } from '../lib/terminal/keys/modifiedInput';
import { encodeChord, type ActiveModifiers } from '../lib/terminal/keys/encodeKey';
import type { Chord } from '../lib/terminal/keys/keyModel';
import { createHeldKeySender, type KeyHold } from '../lib/terminal/keys/arrowRepeat';
import {
  encodeResolvedKey,
  resolveKeyGroups,
  type KeyActionId,
  type ResolvedKey,
} from '../lib/terminal/keys/keyRow';
import { useModifierState } from '../hooks/useModifierState';
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

/** The docked key panel's height when no keyboard height has been seen yet (#167). */
export const KEY_PANEL_DEFAULT_HEIGHT = 280;
/** A keyboard shorter than this is not a phone keyboard (an accessory bar, a toast). */
const KEY_PANEL_MIN_HEIGHT = 160;

/**
 * The height of the key panel that replaces the phone keyboard (#167): the
 * keyboard's last height above the page, so the key row stays where it was,
 * else a default. Exported for tests.
 */
export function keyPanelDockHeight(lastKeyboardHeight: number): number {
  return lastKeyboardHeight >= KEY_PANEL_MIN_HEIGHT ? lastKeyboardHeight : KEY_PANEL_DEFAULT_HEIGHT;
}

/**
 * The terminal workspace at `/sessions/:id` (issue #77): open sessions as tabs,
 * two of them as a split, every pane its own `TerminalView` and WebSocket. It
 * fills the shell's full-bleed `<main>` (`useShellMainVariant`): no negative
 * margins and no height computed from the AppBar. Layout chain
 * (docs/specs/terminal.md, "CSS Layout Requirements"):
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
  // Bumped by the AI assist shortcut and the key bar's AI key: the prompt takes focus (#57).
  const [aiFocus, setAiFocus] = useState(0);
  // The Files panel (#156): the files API's rule is the terminal's (`sessions:write`). It
  // shares the side area with the AI panel by taking turns: opening one closes the other.
  const [filesOpen, setFilesOpen] = useState(false);
  const [filesReveal, setFilesReveal] = useState<FileBrowserReveal | null>(null);
  const revealSeq = useRef(0);
  // The full key panel (#167) takes turns with both: opening any one closes the others.
  const [keyPanelOpen, setKeyPanelOpen] = useState(false);
  useEffect(() => {
    if (aiOpen) setFilesOpen(false);
  }, [aiOpen]);
  useEffect(() => {
    if (aiOpen || filesOpen) setKeyPanelOpen(false);
  }, [aiOpen, filesOpen]);
  const toggleFiles = useCallback(() => {
    // The toolbar opens the panel following the terminal, not at an earlier reveal.
    setFilesReveal(null);
    setFilesOpen((open) => !open);
    setAiOpen(false);
  }, []);

  const { layout, commit, current } = useWorkspaceLayout(routeId, user?.id ?? null);
  const [sessions, setSessions] = useState<Record<string, TerminalSession>>({});
  const [status, setStatus] = useState<Record<string, PaneStatus>>({});
  const [ratio, setRatio] = useState(50);
  const [notice, setNotice] = useState<(TerminalActionNotice & { open: boolean }) | null>(null);
  const [newSessionDialogOpen, setNewSessionDialogOpen] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  // The user's terminal preferences and key shortcuts (#80): one source of
  // truth for the panes, the key bar and the toolbar toggles.
  const {
    terminal: preferences,
    actionShortcuts,
    keyLayout,
    keyOptions,
    updateTerminal,
  } = useTerminalSettings();
  // The key bar's Ctrl, Alt and Shift (#166): one state for every pane, applied
  // to bar keys here and to typed input inside each pane's terminal.
  const modifiers = useModifierState();
  const consumeModifiers = modifiers.consume;
  const inputModifiers = useMemo(() => createModifierInputInterceptor(modifiers.store), [modifiers.store]);
  // Long-press-and-drag arrows on the terminal (#168): the same modifiers and haptics as the keys.
  const keyHaptics = keyOptions?.haptics ?? false;
  const arrowMode = useMemo(() => ({ modifiers: modifiers.store, haptics: keyHaptics }), [modifiers.store, keyHaptics]);
  const showScrollButtons = preferences?.showScrollButtons ?? DEFAULT_TERMINAL_SETTINGS.showScrollButtons;
  // Mod+Shift+A (or the user's rebinding) opens the assistant with the prompt focused; the
  // terminal keeps the key from the PTY through `isReservedKey` (#57).
  const aiAssistBinding = actionShortcuts[AI_ASSIST_ACTION];
  const aiExplainBinding = actionShortcuts[AI_EXPLAIN_ACTION];
  const isReservedKey = useCallback(
    (event: KeyboardEvent) =>
      aiAvailable && (matchesAiAssistShortcut(event, aiAssistBinding) || matchesAiExplainShortcut(event, aiExplainBinding)),
    [aiAvailable, aiAssistBinding, aiExplainBinding],
  );
  const openAssistant = useCallback(() => {
    setAiOpen(true);
    setAiFocus((n) => n + 1);
  }, []);
  useEffect(() => {
    if (!aiAvailable) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!matchesAiAssistShortcut(event, aiAssistBinding)) return;
      event.preventDefault();
      openAssistant();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [aiAvailable, aiAssistBinding, openAssistant]);
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

  // Explain (#58): the selection or the last error goes to the AI panel's Explain action. The
  // selection is read here, when asked, and sent only after the panel shows what will be sent.
  const [explainTrigger, setExplainTrigger] = useState<ExplainTrigger | null>(null);
  const explainSeq = useRef(0);
  const selectionOf = useCallback((id: string | null): string => {
    const terminal = id ? views.current.get(id)?.getTerminal() : null;
    return terminal?.hasSelection() ? terminal.getSelection().slice(-EXPLAIN_SELECTION_MAX) : '';
  }, []);
  const getSelection = useCallback(() => selectionOf(activeId), [selectionOf, activeId]);
  /** `auto` (the shortcut): the selection when there is one, else the last error. */
  const requestExplain = useCallback(
    (mode: 'auto' | 'selection' | 'last_error', paneId: string | null = activeId) => {
      const selection = mode === 'last_error' ? '' : selectionOf(paneId);
      const resolved = mode !== 'last_error' && selection.trim() !== '' ? 'selection' : 'last_error';
      setAiOpen(true);
      setExplainTrigger({
        id: ++explainSeq.current,
        mode: resolved,
        ...(paneId ? { sessionId: paneId } : {}),
        ...(resolved === 'selection' ? { selection } : {}),
      });
    },
    [activeId, selectionOf],
  );
  useEffect(() => {
    if (!aiAvailable) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!matchesAiExplainShortcut(event, aiExplainBinding)) return;
      event.preventDefault();
      requestExplain('auto');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [aiAvailable, aiExplainBinding, requestExplain]);
  const onExplainPaneSelection = useCallback((paneId: string) => requestExplain('selection', paneId), [requestExplain]);

  // ---- the key bar sits on the keyboard ------------------------------------
  const rootRef = useRef<HTMLDivElement>(null);
  const keyboardInset = useKeyboardInset();
  const [dockOffset, setDockOffset] = useState(0);
  useLayoutEffect(() => {
    const root = rootRef.current;
    const gap = root ? window.innerHeight - root.getBoundingClientRect().bottom : 0;
    setDockOffset(keyDockOffset(keyboardInset, gap));
  }, [keyboardInset]);
  // The keyboard's last height above the page: the docked key panel takes it (#167).
  const lastKeyboardHeight = useRef(0);
  useEffect(() => {
    if (dockOffset > 0) lastKeyboardHeight.current = dockOffset;
  }, [dockOffset]);

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

  // A bar key or a pop-up entry: encoded with the active modifiers (which
  // releases the one-shots) and the pane's cursor-key mode (#166).
  // While the key panel replaces the phone keyboard (#167), a key must not
  // focus the terminal: that would raise the keyboard over the panel.
  const keyboardReplaced = useRef(false);
  const sendEncoded = useCallback(
    (encode: (options: { modifiers: ActiveModifiers; applicationCursor: boolean }) => string) => {
      const view = getView();
      if (!view) return;
      const applicationCursor = view.getTerminal()?.modes?.applicationCursorKeysMode ?? false;
      const data = encode({ modifiers: consumeModifiers(), applicationCursor });
      if (!data) return;
      view.sendInput(data);
      if (!keyboardReplaced.current) view.focus();
    },
    [getView, consumeModifiers],
  );

  const handleSendKey = useCallback(
    (key: ResolvedKey) => sendEncoded((options) => encodeResolvedKey(key, options)),
    [sendEncoded],
  );

  // A held key or the arrow-drag key (#168): the modifiers armed now apply to the
  // whole hold and are released when it ends; the cursor mode is read per send.
  const beginKeyHold = useCallback((): KeyHold | null => {
    const view = getView();
    if (!view) return null;
    return createHeldKeySender({
      modifiers: modifiers.store,
      applicationCursor: () => view.getTerminal()?.modes?.applicationCursorKeysMode ?? false,
      write: (data) => view.sendInput(data),
      onEnd: () => {
        if (!keyboardReplaced.current) view.focus();
      },
    });
  }, [getView, modifiers.store]);

  const handleSendChord = useCallback(
    (chord: Chord) => sendEncoded((options) => encodeChord(chord, options)),
    [sendEncoded],
  );

  // ---- the key row and the full key panel (#167) ---------------------------------
  // `attach-file` uploads into the session's working directory: the files API's
  // rule is the terminal's (`sessions:write`), and it needs the session's server.
  const attachAvailable = canWrite && Boolean(activeProfileId);
  const attach = useAttachFile({ profileId: activeProfileId, sessionId: activeId, notify });
  const availableActions = useMemo(() => {
    const out = new Set<KeyActionId>();
    if (aiAvailable) out.add('ai');
    if (attachAvailable) out.add('attach-file');
    // The arrow-drag key (#168) sends through the active pane, like every key.
    out.add('arrow-drag');
    // `snippets` (#172) stays hidden until it exists.
    return out;
  }, [aiAvailable, attachAvailable]);
  const keyGroups = useMemo(
    () => (keyLayout ? resolveKeyGroups(keyLayout, availableActions) : null),
    [keyLayout, availableActions],
  );
  // Anything but a phone (`sm` and up: tablets, landscape, an unfolded foldable):
  // a side panel, the phone keyboard stays up. A phone: the panel replaces the
  // keyboard in the key dock. (The AI and Files panels keep their own `isWide` rule.)
  const keyPanelSide = !isPhone;
  const keyPanelVariant: 'side' | 'dock' = keyPanelSide ? 'side' : 'dock';
  const keyPanelShown = keyPanelOpen && keyShortcutsOpen;
  const keyPanelDocked = keyPanelShown && keyPanelVariant === 'dock';
  const keyPanelId = useId();
  const keyPanelRef = useRef<HTMLDivElement>(null);
  const [keyPanelHeight, setKeyPanelHeight] = useState(KEY_PANEL_DEFAULT_HEIGHT);
  useEffect(() => {
    keyboardReplaced.current = keyPanelDocked;
  }, [keyPanelDocked]);

  const toggleKeyPanel = useCallback(() => {
    if (keyPanelOpen) {
      setKeyPanelOpen(false);
      return;
    }
    setAiOpen(false);
    setFilesOpen(false);
    if (!keyPanelSide) {
      // Take the keyboard's place: its height, then dismiss it by blurring xterm's textarea.
      setKeyPanelHeight(keyPanelDockHeight(lastKeyboardHeight.current));
      keyboardReplaced.current = true;
      getView()?.getTerminal()?.blur?.();
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && focused.closest('.xterm')) focused.blur();
    }
    setKeyPanelOpen(true);
  }, [keyPanelOpen, keyPanelSide, getView]);

  const closeKeyPanel = useCallback(() => {
    setKeyPanelOpen(false);
    if (keyPanelSide) {
      // The side panel never took the terminal's focus for long: give it back.
      getView()?.focus();
    } else {
      // Without raising the keyboard: focus goes back to the panel's toggle.
      document.getElementById(`${keyPanelId}-toggle`)?.focus();
    }
  }, [keyPanelSide, getView, keyPanelId]);

  // The keyboard button: close the docked panel and bring the phone keyboard back.
  const showKeyboard = useCallback(() => {
    keyboardReplaced.current = false;
    setKeyPanelOpen(false);
    getView()?.focus();
  }, [getView]);

  // Docked, the panel holds the focus (a button raises no keyboard).
  useEffect(() => {
    if (!keyPanelDocked) return;
    keyPanelRef.current?.querySelector<HTMLElement>('[role="tab"]')?.focus();
  }, [keyPanelDocked]);

  // The keyboard came back while the panel replaced it (the user tapped the terminal):
  // the keyboard wins and the panel closes.
  const previousInset = useRef(keyboardInset);
  useEffect(() => {
    const previous = previousInset.current;
    previousInset.current = keyboardInset;
    if (keyPanelDocked && previous === 0 && keyboardInset > 0) setKeyPanelOpen(false);
  }, [keyboardInset, keyPanelDocked]);

  const handleKeyAction = useCallback(
    (action: KeyActionId) => {
      if (action === 'ai') openAssistant();
      else if (action === 'attach-file') attach.pick();
    },
    [openAssistant, attach],
  );

  const keyHandlers = {
    onKey: handleSendKey,
    onAction: handleKeyAction,
    onToggleModifier: modifiers.tap,
    onSendChord: handleSendChord,
    modifierState: modifiers.state,
    haptics: keyOptions?.haptics ?? false,
    beginHold: beginKeyHold,
  };

  const handleToggleScrollButtons = useCallback(() => {
    void updateTerminal({ showScrollButtons: !showScrollButtons }).catch(() => undefined);
  }, [showScrollButtons, updateTerminal]);

  // The toolbar's key bar toggle stores the choice (#80): hiding it is
  // `never`, showing it is `always`, on this and every other device.
  const handleToggleKeyShortcuts = useCallback(() => {
    void updateTerminal({ showKeyBar: keyShortcutsOpen ? 'never' : 'always' }).catch(() => undefined);
  }, [keyShortcutsOpen, updateTerminal]);

  // File links in the output (#155): the files API takes the terminal's own rule
  // (`sessions:write` plus connect rights on the server, which an open terminal implies).
  const fileLinksProfileIdOf = useCallback(
    (sessionId: string) =>
      canWrite ? (sessions[sessionId]?.serverProfileId ?? sessions[sessionId]?.serverProfile.id) : undefined,
    [canWrite, sessions],
  );

  // "Show in file browser" from a file link (#155): the panel opens at the file's folder
  // with the file selected. A link in a pane on another server switches to that pane first.
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const showInFileBrowser = useCallback<NonNullable<TerminalFileLinksConfig['onShowInFileBrowser']>>(
    (target) => {
      const now = current();
      const profileOf = (sessionId: string) =>
        sessionsRef.current[sessionId]?.serverProfileId ?? sessionsRef.current[sessionId]?.serverProfile.id;
      if (now && profileOf(now.active) !== target.profileId) {
        const owner = now.tabs.find((sessionId) => profileOf(sessionId) === target.profileId);
        if (owner) commit(activateTab(now, owner));
      }
      setFilesReveal({ ...revealOf(target.path, target.type), seq: ++revealSeq.current });
      setAiOpen(false);
      setFilesOpen(true);
    },
    [commit, current],
  );

  const renderPane = useCallback(
    (sessionId: string) => (
      <WorkspacePane
        sessionId={sessionId}
        showScrollButtons={showScrollButtons}
        preferences={preferences ?? undefined}
        isReservedKey={isReservedKey}
        onExplainSelection={aiAvailable ? onExplainPaneSelection : undefined}
        fileLinksProfileId={fileLinksProfileIdOf(sessionId)}
        onShowInFileBrowser={canWrite ? showInFileBrowser : undefined}
        inputModifiers={inputModifiers}
        arrowMode={arrowMode}
        registerView={registerView}
        onStatus={onPaneStatus}
      />
    ),
    [
      showScrollButtons,
      preferences,
      isReservedKey,
      aiAvailable,
      onExplainPaneSelection,
      fileLinksProfileIdOf,
      canWrite,
      showInFileBrowser,
      inputModifiers,
      arrowMode,
      registerView,
      onPaneStatus,
    ],
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

  const filesAvailable = canWrite && Boolean(activeProfileId);
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
              {filesAvailable && (
                <Button
                  size="small"
                  variant={filesOpen ? 'contained' : 'outlined'}
                  startIcon={<FilesIcon fontSize="small" />}
                  aria-pressed={filesOpen}
                  onClick={toggleFiles}
                  sx={{ minHeight: 32, ml: 0.5 }}
                >
                  Files
                </Button>
              )}
              {aiAvailable && (
                <ExplainMenuButton
                  disabled={!activeId}
                  hasSelection={() => getSelection() !== ''}
                  onExplain={(mode) => requestExplain(mode)}
                />
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

        {/* Never `overflow: hidden` between here and the xterm (docs/specs/terminal.md). */}
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
          {keyPanelShown && keyPanelVariant === 'side' && keyGroups && (
            <TerminalKeyPanel
              ref={keyPanelRef}
              id={keyPanelId}
              variant="side"
              groups={keyGroups}
              onClose={closeKeyPanel}
              {...keyHandlers}
            />
          )}
          {aiAvailable && (
            <TerminalAiPanel
              open={aiOpen}
              onClose={() => setAiOpen(false)}
              variant={isWide ? 'side' : 'sheet'}
              sessionId={activeId}
              focusRequest={aiFocus}
              explainTrigger={explainTrigger}
              onExplainTriggerHandled={() => setExplainTrigger(null)}
              getSelection={getSelection}
              onInsert={(command) => {
                insertSuggestedCommand(getView(), command);
                if (!isWide) setAiOpen(false);
              }}
            />
          )}
          {filesAvailable && activeProfileId && (
            <FileBrowserPanel
              open={filesOpen}
              onClose={() => setFilesOpen(false)}
              variant={isWide ? 'side' : 'sheet'}
              profileId={activeProfileId}
              sessionId={activeId}
              reveal={filesReveal}
            />
          )}
        </Box>
        {/* The status bar is the bottom gutter: outside the FitAddon host (docs/specs/terminal.md). */}
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
          <TerminalKeyShortcutsBar
            open={keyShortcutsOpen}
            groups={keyGroups}
            {...keyHandlers}
            panelOpen={keyPanelShown}
            onTogglePanel={toggleKeyPanel}
            panelId={keyPanelId}
          />
          {keyPanelDocked && keyGroups && (
            <TerminalKeyPanel
              ref={keyPanelRef}
              id={keyPanelId}
              variant="dock"
              height={keyPanelHeight}
              groups={keyGroups}
              onClose={closeKeyPanel}
              onShowKeyboard={showKeyboard}
              {...keyHandlers}
            />
          )}
        </Box>
      </Box>

      {/* The attach key's file picker (#167): outside the frame, whose last child is the key dock. */}
      {attachAvailable && (
        <input
          ref={attach.inputRef}
          type="file"
          hidden
          aria-label="File to attach"
          data-testid="terminal-attach-input"
          onChange={attach.onInputChange}
        />
      )}
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
