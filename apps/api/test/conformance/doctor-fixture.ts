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
// =============================================================================

import type { DoctorConformanceFixture } from '@marinoscar/platform-api/doctor/testing';
import { STORAGE_PROVIDER } from '@marinoscar/platform-api/storage';

import { PrismaSystemService } from '../../src/prisma/prisma-system.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { closeTestApp, createTestApp, type TestContext } from '../helpers/test-app.helper';

export const doctorConformanceFixture: DoctorConformanceFixture = {
  createContext: ({ prisma, storage }) =>
    createTestApp({
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
    }),
  closeContext: (context) => closeTestApp(context as TestContext),
};
