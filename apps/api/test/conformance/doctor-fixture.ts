// =============================================================================
// How ShellKeep boots itself for the `doctor-read-only` suite (issue #46)
// =============================================================================
//
// The suite cannot build this app. It hands the fixture two doubles, a Prisma
// client that records every call and a storage provider that refuses every write,
// and asks for the app booted with them installed under the app's own tokens; it
// then runs every check the booted `DoctorCheckRegistry` holds.
//
// Three overrides carry the doubles:
//   - `PrismaService`       what every service and `PLATFORM_PRISMA` read through;
//   - `PrismaSystemService` the bypass client the storage slice's checks use
//                           (`forSystem` and `runAsSystem` answer the same recording double);
//   - `STORAGE_PROVIDER`    the object store the two storage checks read (#50).
// Everything else is the real `AppModule` over `createTestApp`'s mocked database.
//
// Background timers are stopped after boot. The suite attributes every Prisma
// write inside a check's run window to that check, and a slow check (the backup
// pg-client probe spawns `pg_dump --version`) can span a `@Cron` tick that enqueues
// a housekeeping job; the write would be blamed on the check. Stopping every
// cron, interval and timeout makes the audit independent of the wall clock.
// =============================================================================

import { SchedulerRegistry } from '@nestjs/schedule';
import type { DoctorConformanceFixture } from '@marinoscar/platform-api/doctor/testing';
import { STORAGE_PROVIDER } from '@marinoscar/platform-api/storage';

import { PrismaSystemService } from '../../src/prisma/prisma-system.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { closeTestApp, createTestApp, type TestContext } from '../helpers/test-app.helper';

function stopScheduledWork(context: TestContext): void {
  const registry = context.app.get(SchedulerRegistry, { strict: false });
  for (const job of registry.getCronJobs().values()) {
    void job.stop();
  }
  for (const name of registry.getIntervals()) {
    registry.deleteInterval(name);
  }
  for (const name of registry.getTimeouts()) {
    registry.deleteTimeout(name);
  }
}

export const doctorConformanceFixture: DoctorConformanceFixture = {
  createContext: async ({ prisma, storage }) => {
    const context = await createTestApp({
      useMockDatabase: true,
      overrideProviders: [
        { provide: PrismaService, useValue: prisma.client },
        {
          provide: PrismaSystemService,
          useValue: {
            forSystem: () => prisma.client,
            runAsSystem: (_reason: string, fn: (tx: unknown) => unknown) => fn(prisma.client),
            $connect: async () => undefined,
            $disconnect: async () => undefined,
          },
        },
        { provide: STORAGE_PROVIDER, useValue: storage.provider },
      ],
    });
    stopScheduledWork(context);
    return context;
  },
  closeContext: (context) => closeTestApp(context as TestContext),
};
