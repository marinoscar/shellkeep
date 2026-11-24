// =============================================================================
// The app's binding of the exports slice's host ports (issue #68)
// =============================================================================
//
//   EXPORTS_SYSTEM_DATA  PrismaSystemService: the bypass client. Reasons
//                        `export` (a source's reads across organizations, always
//                        filtered on the owner or the organization; the status
//                        and download routes' storage-object lookups) and
//                        `purge` (the expiry of export files).
//   EXPORTS_NOTIFIER     ExportsNotifierAdapter (NotificationsService).
//
// PLATFORM_PRISMA, AUDIT_SINK, STORAGE_PROVIDER and JobsService come from the
// app's global modules.
//
// This file is on the reviewed allowlist of
// `test/tenancy/system-injection-boundary.spec.ts`.
// =============================================================================

import { Module } from '@nestjs/common';
import { EXPORTS_NOTIFIER, EXPORTS_SYSTEM_DATA, type ExportsSystemData } from '@marinoscar/platform-api/exports';

import { PrismaSystemService } from '../../prisma/prisma-system.service';
import { ExportsNotifierAdapter } from './exports-notifier.adapter';

@Module({
  providers: [
    ExportsNotifierAdapter,
    {
      provide: EXPORTS_SYSTEM_DATA,
      inject: [PrismaSystemService],
      useFactory: (system: PrismaSystemService): ExportsSystemData => ({
        asSystem: (reason) => system.forSystem(reason) as unknown as ReturnType<ExportsSystemData['asSystem']>,
      }),
    },
    { provide: EXPORTS_NOTIFIER, useExisting: ExportsNotifierAdapter },
  ],
  exports: [EXPORTS_SYSTEM_DATA, EXPORTS_NOTIFIER],
})
export class ExportsHostModule {}
