// =============================================================================
// The platform host module (issue #47)
// =============================================================================
//
// Binds the DI-time host ports every packaged slice reaches the app through:
//
//   AUDIT_SINK             -> `audit_events` (PrismaAuditSink)
//   PLATFORM_PRISMA        -> the existing PrismaService
//   SYSTEM_SETTINGS_STORE  -> the platform settings slice's `SystemSettingsService` (#48)
//
// `PlatformHostModule.forRoot` is GLOBAL, so the identity slice (which injects
// `PLATFORM_PRISMA` in a dozen services) and the routes that report an audit
// event resolve them without importing anything. It imports the settings module
// because the store adapter injects `SystemSettingsService`.
// =============================================================================

import { PlatformHostModule } from '@marinoscar/platform-api/core';

import { PrismaService } from '../prisma/prisma.service';
import { PrismaAuditSink } from './audit-sink.adapter';
import { settingsModule } from './settings/settings.config';
import { SystemSettingsStoreAdapter } from './system-settings-store.adapter';

export const platformHostModule = PlatformHostModule.forRoot({
  audit: { useClass: PrismaAuditSink },
  settings: { useClass: SystemSettingsStoreAdapter },
  prisma: { useExisting: PrismaService },
  imports: [settingsModule],
});
