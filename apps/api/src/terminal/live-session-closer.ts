/**
 * The port the session reaper uses to close a live SSH stream held by this process.
 * `SessionManagerService` implements it (bound with `useExisting` in `TerminalModule`). A token and a type
 * keep the reaper from importing the manager class, which would pull `ssh.service` into its import graph.
 */
export const LIVE_SESSION_CLOSER = Symbol('LIVE_SESSION_CLOSER');

export interface LiveSessionCloser {
  /** Tells attached clients `session_ended` and closes the SSH stream. A no-op when none is held. */
  terminateSession(sessionId: string): Promise<void>;
}
