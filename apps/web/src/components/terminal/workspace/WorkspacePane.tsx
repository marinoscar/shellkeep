import { memo, useCallback, useRef, useState } from 'react';
import { TerminalView } from '../TerminalView';
import type { TerminalViewHandle } from '../TerminalView';
import { TerminalConnectionAlert } from '../TerminalConnectionAlert';

/** What a pane reports to the workspace about its connection. */
export interface PaneStatus {
  connected: boolean;
}

export interface WorkspacePaneProps {
  sessionId: string;
  showScrollButtons: boolean;
  /** Called with the pane's handle on mount and `null` on unmount. */
  registerView: (sessionId: string, handle: TerminalViewHandle | null) => void;
  /** Called when the pane's connection state changes. */
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
  registerView,
  onStatus,
}: WorkspacePaneProps) {
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

  return (
    <>
      <TerminalView
        ref={ref}
        sessionId={sessionId}
        onConnectionChange={onConnectionChange}
        onError={setError}
        showScrollButtons={showScrollButtons}
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
