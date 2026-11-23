// =============================================================================
// The app-metric manifest (issue #46)
// =============================================================================
//
// The app-metric registry is static: filled before bootstrap, frozen after. The
// platform's metrics and the event bus's are registered first, then each slice's
// own list. ShellKeep declares no metric of its own yet (telemetry is #53), so
// only the identity slice's lists follow.
// =============================================================================

import { registerPlatformHostAppMetrics } from '@marinoscar/platform-api/host';
import { OAUTH_APP_METRICS, ORGANIZATIONS_APP_METRICS } from '@marinoscar/platform-api/identity';

registerPlatformHostAppMetrics(ORGANIZATIONS_APP_METRICS, OAUTH_APP_METRICS);
