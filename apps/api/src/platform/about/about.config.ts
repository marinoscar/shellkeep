// =============================================================================
// The About module, bound to ShellKeep (issue #46)
// =============================================================================
//
// `GET /api/admin/about` (`system_settings:read`, readable during a maintenance
// window) is the host slice's. The one fact it cannot find for itself is this
// app's own version, so the app hands it `resolveApiVersion`. The app's own About
// section is registered by `app-registrations/host.ts`.
// =============================================================================

import { AboutModule } from '@marinoscar/platform-api/host';

import { resolveApiVersion } from '../../openapi/version';
import { platformHost } from '../platform-host';

export const aboutModule = AboutModule.forRoot({ apiVersion: resolveApiVersion, host: platformHost });
