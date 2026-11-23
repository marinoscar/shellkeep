// =============================================================================
// The storage slice's host port (issue #50)
// =============================================================================
//
// `STORAGE_SYSTEM_DATA` is the bypass client the slice needs for the four paths
// that cross organizations: the stale-upload sweep, the stranded-object count
// of the provider-switch gate, the public avatar route and the avatar
// replacement across an organization switch. It is bound to
// `PrismaSystemService`, a SEPARATE connection pool whose every transaction sets
// the transaction-local `app.rls_bypass` flag under a registered access reason;
// the tenant pool (`PrismaService`) never carries that flag.
//
// Everything else the slice reads or writes in `storage_objects` and
// `storage_object_chunks` goes through `PLATFORM_PRISMA` (`PrismaService`) and
// the slice's own `runInOrg`, which is why the API can connect as the
// `shellkeep_app` role (#52).
// =============================================================================

import { Global, Module } from '@nestjs/common';
import { STORAGE_SYSTEM_DATA, type StorageSystemData } from '@marinoscar/platform-api/storage';

import { PrismaSystemService } from '../../prisma/prisma-system.service';

/** Binds `STORAGE_SYSTEM_DATA` to the app's bypass client. Global: the slice's modules inject it. */
@Global()
@Module({
  providers: [
    {
      provide: STORAGE_SYSTEM_DATA,
      inject: [PrismaSystemService],
      useFactory: (system: PrismaSystemService): StorageSystemData => ({
        asSystem: (reason) =>
          system.forSystem(reason) as unknown as ReturnType<StorageSystemData['asSystem']>,
      }),
    },
  ],
  exports: [STORAGE_SYSTEM_DATA],
})
export class StorageHostModule {}
