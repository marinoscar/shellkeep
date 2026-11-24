import { useAiFeatures } from '@marinoscar/platform-web/ai/headless';
import { usePermissions } from '@marinoscar/platform-web/identity/headless';

/** The permission every consumer route under `/api/ai/*` requires (`AiEnabledGuard` plus this). */
export const AI_USE_PERMISSION = 'ai:use';

/**
 * Whether the terminal AI panel may show (issue #77): the deployment's `ai`
 * feature is on AND the viewer holds `ai:use`.
 *
 * The feature flag is read with the platform's `useAiFeatures`, which reads
 * ONLY the shell's `AiConfigProvider` and never fetches: until that provider
 * is mounted (#55 adopts the AI slice and mounts it), or while its answer is
 * pending or failed, AI counts as off and the panel is absent. Fail closed;
 * the API remains the gate.
 */
export function useTerminalAiAvailable(): boolean {
  const { ai } = useAiFeatures();
  const { hasPermission } = usePermissions();
  return ai && hasPermission(AI_USE_PERMISSION);
}
