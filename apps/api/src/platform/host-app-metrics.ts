// =============================================================================
// The app-metric manifest (issue #46)
// =============================================================================
//
// The app-metric registry is static: filled before bootstrap, frozen after. The
// platform's metrics and the event bus's are registered first, then each slice's
// own list, then the app's. ShellKeep declares `app.ssh.host_key_checks` (#60), `app.runbooks.definitions_saved` (#61) and its
// own `APP_METRICS` (`app-registrations/telemetry.ts`, #53); the identity slice's lists
// follow the platform's.
// =============================================================================

import { registerPlatformHostAppMetrics } from '@marinoscar/platform-api/host';
import { RUNBOOK_APP_METRICS } from '../runbooks/runbooks.metrics';
import { SSH_APP_METRICS } from '../ssh/ssh.metrics';
import { OAUTH_APP_METRICS, ORGANIZATIONS_APP_METRICS } from '@marinoscar/platform-api/identity';

import { APP_METRICS } from '../app-registrations/telemetry';

registerPlatformHostAppMetrics(
  ORGANIZATIONS_APP_METRICS,
  OAUTH_APP_METRICS,
  SSH_APP_METRICS,
  RUNBOOK_APP_METRICS,
  APP_METRICS,
);
