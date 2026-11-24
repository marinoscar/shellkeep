import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { TerminalView } from '../TerminalView';
import type { TerminalArrowModeConfig, TerminalViewHandle, TerminalViewStatus } from '../TerminalView';
import { TerminalConnectionAlert } from '../TerminalConnectionAlert';
import type { ResolvedTerminalSettings } from '../../../lib/terminal/settings';
import type { TerminalFileLinksConfig } from '../files/useTerminalFileLinks';
import type { TerminalInputModifiers } from '../../../lib/terminal/keys/modifiedInput';

/** What a pane reports to the workspace: its connection, latency, size and host-key state. */
export interface PaneStatus extends Partial<TerminalViewStatus> {
  connected?: boolean;
}

export interface WorkspacePaneProps {
  sessionId: string;
  showScrollButtons: boolean;
  /** The user's terminal preferences (#80), applied live to the pane's terminal. */
  preferences?: ResolvedTerminalSettings;
  /** Keys the page handles itself (the AI assist shortcut); never sent to the PTY (#57). */
  isReservedKey?: (event: KeyboardEvent) => boolean;
  /** Explain this pane's selected text (#58). Omit when AI is unavailable. */
  onExplainSelection?: (sessionId: string) => void;
  /**
   * The session's server profile, for file links in the output (#155). Omitted (not yet
   * loaded, or the user may not use the files API): no file links.
   */
  fileLinksProfileId?: string;
  /** "Show in file browser" for a file link (#156). Omitted: the action is hidden. */
  onShowInFileBrowser?: TerminalFileLinksConfig['onShowInFileBrowser'];
  /** The key bar's modifiers, applied to typed input (#166); shared by every pane. */
  inputModifiers?: TerminalInputModifiers | null;
  /** Long-press-and-drag arrow mode on touch (#168); shared by every pane. */
  arrowMode?: TerminalArrowModeConfig | null;
  /** Called with the pane's handle on mount and `null` on unmount. */
  registerView: (sessionId: string, handle: TerminalViewHandle | null) => void;
  /** Called with what changed in the pane's status. */
  onStatus: (sessionId: string, status: PaneStatus) => void;
}

/**
 * One session's terminal inside the workspace: a `TerminalView` (its own
 * xterm and WebSocket, through `useTerminal`) and its connection alert (#93,
 * #46, #60). Memoised, so a tab switch or a status change elsewhere does not
 * re-render every pane.
 */
export const WorkspacePane = memo(function WorkspacePane({
  sessionId,
  showScrollButtons,
  preferences,
  isReservedKey,
  onExplainSelection,
  fileLinksProfileId,
  onShowInFileBrowser,
  inputModifiers,
  arrowMode,
  registerView,
  onStatus,
}: WorkspacePaneProps) {
  const fileLinks = useMemo<TerminalFileLinksConfig | null>(
    () => (fileLinksProfileId ? { profileId: fileLinksProfileId, onShowInFileBrowser } : null),
    [fileLinksProfileId, onShowInFileBrowser],
  );
  const [error, setError] = useState<string | null>(null);
  const handle = useRef<TerminalViewHandle | null>(null);

  const ref = useCallback(
    (next: TerminalViewHandle | null) => {
      handle.current = next;
      registerView(sessionId, next);
    },
    [registerView, sessionId],
  );

  const onConnectionChange = useCallback(
    (connected: boolean) => {
      // A (re)connected session clears whatever went wrong before.
      if (connected) setError(null);
      onStatus(sessionId, { connected });
    },
    [onStatus, sessionId],
  );

  const onStatusChange = useCallback(
    (status: TerminalViewStatus) => onStatus(sessionId, status),
    [onStatus, sessionId],
  );

  return (
    <>
      <TerminalView
        ref={ref}
        sessionId={sessionId}
        onConnectionChange={onConnectionChange}
        onError={setError}
        onStatusChange={onStatusChange}
        showScrollButtons={showScrollButtons}
        preferences={preferences}
        isReservedKey={isReservedKey}
        onExplainSelection={onExplainSelection ? () => onExplainSelection(sessionId) : undefined}
        fileLinks={fileLinks}
        inputModifiers={inputModifiers}
        arrowMode={arrowMode}
      />
      <TerminalConnectionAlert
        error={error}
        onDismiss={() => setError(null)}
        onRetry={() => {
          setError(null);
          handle.current?.reconnect();
        }}
      />
    </>
  );
});
