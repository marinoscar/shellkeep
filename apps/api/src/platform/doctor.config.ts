// =============================================================================
// The platform Doctor (issue #47)
// =============================================================================
//
// `GET /api/admin/doctor` (`system_settings:read`) runs every registered
// read-only health check. Mounted here because the identity slice registers its
// `auth.*` and `tenancy.*` checks with the registry this module provides, so it
// cannot boot without it. The rest of the host core (event bus, maintenance,
// the response envelope) is #46.
// =============================================================================

import { DoctorModule } from '@marinoscar/platform-api/doctor';

import { platformHost } from './platform-host';

export const doctorModule = DoctorModule.forRoot({
  host: platformHost,
  supportBundle: { appSlug: 'shellkeep' },
});
