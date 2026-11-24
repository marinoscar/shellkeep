// =============================================================================
// The app's binding of the telemetry slice (issue #53)
// =============================================================================
//
// `TelemetryModule.forRoot` serves the API side of observability: the `telemetry`
// settings and the runtime export gate (`/api/admin/telemetry/config`,
// `GET /api/telemetry/config`), the runtime GreptimeDB connection, the explorer
// (SQL, schema, export), the dashboard with its metric groups and health verdict,
// the stack-agent surface, the assistant (reported as disabled until #55), two
// server-only job types (`telemetry.retention.apply`, `telemetry.stack.deploy`) and
// the Doctor checks. It replaces the hand-wired OpenTelemetry setup and the
// previous collector-to-trace-UI stack.
//
// Permissions: `telemetry:read|write|query` (system scope, admin only; registered by
// the platform permission manifest, `app-registrations/platform-slices.ts`).
//
// The `telemetry` settings namespace is registered by `settings/registry.ts` and
// the `telemetry_greptime` credential purpose by `app-registrations/credentials.ts`,
// both before the registries freeze when the application bootstraps. The connection
// to GreptimeDB is runtime configuration (`/admin/settings/telemetry`); the
// `GREPTIME_*` environment values are only the deployment default.
//
// The app's own dashboard metric groups (`APP_METRIC_GROUPS`) follow the six platform
// groups. Needs `jobsModule` and `settingsModule` (both global) in the same application.
// =============================================================================

import { TelemetryModule } from '@marinoscar/platform-api/telemetry';

import { APP_METRIC_GROUPS } from '../../app-registrations/telemetry';
import { platformHost } from '../platform-host';
import { TelemetryHostModule } from './telemetry-host.module';

export const telemetryModule = TelemetryModule.forRoot({
  host: platformHost,
  imports: [TelemetryHostModule],
  metricGroups: APP_METRIC_GROUPS,
});
