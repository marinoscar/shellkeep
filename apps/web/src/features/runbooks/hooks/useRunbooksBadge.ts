import { usePermissions } from '@marinoscar/platform-web/identity/headless';
import { usePendingApprovalCount } from './usePendingApprovalCount';

/**
 * The Runbooks destination's badge (#65): the pending approvals, for a viewer who may read them.
 * A module-level function, as the shell asks (`ShellDestination.badge`); `0` draws no badge.
 */
export function useRunbooksBadge(): number {
  const { hasPermission } = usePermissions();
  return usePendingApprovalCount(hasPermission('runbooks:read'));
}
