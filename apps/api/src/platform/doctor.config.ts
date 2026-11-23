// =============================================================================
// The platform Doctor (issue #47)
// =============================================================================
//
// `GET /api/admin/doctor` (`system_settings:read`) runs every registered
// read-only health check: the host core's, the identity slice's (`auth.*`,
// `tenancy.*`) and the app's own domain checks. Each
// registers itself with the registry this module provides from its own
// `onModuleInit`.
// =============================================================================

import { DoctorModule } from '@marinoscar/platform-api/doctor';

import { platformHost } from './platform-host';

export const doctorModule = DoctorModule.forRoot({
  host: platformHost,
  supportBundle: { appSlug: 'shellkeep' },
});
