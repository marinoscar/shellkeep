// =============================================================================
// The platform host module (issue #47)
// =============================================================================
//
// Binds the DI-time host ports every packaged slice reaches the app through:
//
//   AUDIT_SINK       -> `audit_events` (PrismaAuditSink)
//   PLATFORM_PRISMA  -> the existing PrismaService
//
// `SYSTEM_SETTINGS_STORE` is not bound: ShellKeep's system settings stay its own
// until the settings slice is adopted (#48), and the identity slice does not
// inject the port. `PlatformHostModule.forRoot` is GLOBAL, so the identity slice
// (which injects `PLATFORM_PRISMA` in a dozen services) and the routes that
// report an audit event resolve them without importing anything.
// =============================================================================

import { PlatformHostModule } from '@marinoscar/platform-api/core';

import { PrismaService } from '../prisma/prisma.service';
import { PrismaAuditSink } from './audit-sink.adapter';

export const platformHostModule = PlatformHostModule.forRoot({
  audit: { useClass: PrismaAuditSink },
  prisma: { useExisting: PrismaService },
});
