// =============================================================================
// The runbooks' import-time registrations (issue #61)
// =============================================================================
//
// Everything the registries need before they freeze at bootstrap: the error codes and
// the three runbook notification events (defined by #51, registered here when the
// runbooks feature is mounted, so the preferences matrix lists only events that can
// fire). The credential purpose is registered with the other purposes in
// `app-registrations/credentials.ts`. Imported by `app-registrations/registrations.ts`.
// =============================================================================

import { registerSystemAccessReason } from '@marinoscar/platform-api/core';

import { registerRunbookNotifications } from '../notifications-registry/runbooks.notifications';
import { RUNBOOKS_ARTIFACTS_PURGE_REASON, RUNBOOKS_RECONCILE_REASON } from './engine/engine.constants';
import { registerRunbookRunErrorCodes } from './engine/engine.error-codes';
import { registerRunbookErrorCodes } from './runbooks.error-codes';

let registered = false;

/** Idempotent per process. */
export function registerRunbookRegistrations(): void {
  if (registered) return;
  registered = true;
  registerRunbookErrorCodes();
  registerRunbookRunErrorCodes();
  registerSystemAccessReason({
    id: RUNBOOKS_RECONCILE_REASON,
    description:
      'The runbook reconcile job (runbook.logs.compact) finds stuck runs, lost executors, expired approvals and orphan log chunks across every organization.',
  });
  registerSystemAccessReason({
    id: RUNBOOKS_ARTIFACTS_PURGE_REASON,
    description:
      'The runbook artifacts purge (runbook.artifacts.purge) finds runs past the retention window across every organization and deletes their stored logs, archives and bundle.',
  });
  registerRunbookNotifications();
}
