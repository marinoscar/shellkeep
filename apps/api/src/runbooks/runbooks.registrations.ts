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

import { registerRunbookNotifications } from '../notifications-registry/runbooks.notifications';
import { registerRunbookErrorCodes } from './runbooks.error-codes';

let registered = false;

/** Idempotent per process. */
export function registerRunbookRegistrations(): void {
  if (registered) return;
  registered = true;
  registerRunbookErrorCodes();
  registerRunbookNotifications();
}
