// =============================================================================
// The host core, bound to ShellKeep (issue #46)
// =============================================================================
//
// `@marinoscar/platform-api/host` owns the plumbing ShellKeep used to carry: the
// event bus, the platform's app metrics, maintenance mode (`MaintenanceGuard`,
// the platform's only `APP_GUARD`, first), the `{ data }` response envelope, the
// request log line, the exception filter, request ids and the health probes
// (`/api/health`, `/api/health/live`, `/api/health/ready`). ShellKeep configures
// it here, once:
//
//   - the app-metric manifest runs FIRST, so the registry order is the
//     platform's, then the identity slice's, and a collision names the app;
//   - the `maintenance` settings namespace is registered by
//     `platform/settings/registry.ts`, which `shellkeep.manifest.ts` imports
//     before this file, so `forRoot()` leaves it alone;
//   - the app's access decorators (`platformHost`) guard the maintenance routes;
//   - `EVENT_BUS_ADAPTER` and `OTEL_ENABLED` are read by the package itself.
//
// The maintenance routes (`GET`/`PUT /api/admin/maintenance`) require the
// platform defaults, `system_settings:read` and `system_settings:write`.
// =============================================================================

import './host-app-metrics';

import { PlatformHostCoreModule } from '@marinoscar/platform-api/host';

import { platformHost } from './platform-host';

export const hostCoreModule = PlatformHostCoreModule.forRoot({ host: platformHost });
