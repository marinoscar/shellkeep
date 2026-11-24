// =============================================================================
// A hand-off from the TUI to the terminal bridge  (issue #72)
// =============================================================================
//
// The Sessions screen cannot run the bridge inside Ink: Ink owns stdin (raw
// mode and its own key handling) and stdout (it redraws the frame). So an
// "attach" there records the session id here and exits the menu; `runApp`
// (run.ts) takes it after the TUI has released the terminal and runs the bridge
// in the plain terminal, then ends the process with the bridge's exit code.
// =============================================================================

let pending: string | undefined;

/** Records the session to attach to once the TUI has exited. */
export function requestAttach(sessionId: string): void {
  pending = sessionId;
}

/** Takes (and clears) the recorded session id. */
export function takePendingAttach(): string | undefined {
  const value = pending;
  pending = undefined;
  return value;
}
