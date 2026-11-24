import { useTerminalAiAvailable } from '../../../components/terminal/ai/useTerminalAiAvailable';

/**
 * Whether the runbook AI controls may show (#64): the deployment's AI is on and the viewer holds `ai:use`.
 * The same fail-closed rule as the terminal AI panel; the API stays the gate.
 */
export function useRunbookAiAvailable(): boolean {
  return useTerminalAiAvailable();
}
