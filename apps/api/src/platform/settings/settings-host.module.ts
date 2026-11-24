// =============================================================================
// The settings slice's host ports, bound to ShellKeep (issue #48)
// =============================================================================
//
//   SETTINGS_DATA            -> core's runInOrg over PrismaService
//   SETTINGS_PROFILE_IMAGES  -> the platform's profile normalisation and avatar check (#50)
//
// `@Global()` so the slice's services resolve both ports from whichever module
// instantiates them. `PLATFORM_PRISMA` is bound by `platformHostModule`.
// =============================================================================

import { Global, Module } from '@nestjs/common';
import { SETTINGS_DATA, SETTINGS_PROFILE_IMAGES } from '@marinoscar/platform-api/settings';

import { SettingsDataAdapter } from './settings-data.adapter';
import { ShellkeepSettingsProfileImages } from './settings-profile-images.adapter';

const PORTS = [
  { provide: SETTINGS_DATA, useClass: SettingsDataAdapter },
  { provide: SETTINGS_PROFILE_IMAGES, useClass: ShellkeepSettingsProfileImages },
];

@Global()
@Module({
  providers: PORTS,
  exports: PORTS.map((port) => port.provide),
})
export class SettingsHostModule {}
