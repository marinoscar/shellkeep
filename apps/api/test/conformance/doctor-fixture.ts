// =============================================================================
// How ShellKeep boots itself for the `doctor-read-only` suite (issue #46)
// =============================================================================
//
// The suite cannot build this app. It hands the fixture two doubles, a Prisma
// client that records every call and a storage provider that refuses every write,
// and asks for the app booted with them installed under the app's own tokens; it
// then runs every check the booted `DoctorCheckRegistry` holds.
//
// `PrismaService` carries the recording client (every service and `PLATFORM_PRISMA`
// read through it). ShellKeep has no storage provider yet (#50) and no system
// Prisma client (#52), so those two overrides join the fixture with their slices.
// Everything else is the real `AppModule` over `createTestApp`'s mocked database.
// =============================================================================

import type { DoctorConformanceFixture } from '@marinoscar/platform-api/doctor/testing';

import { PrismaService } from '../../src/prisma/prisma.service';
import { closeTestApp, createTestApp, type TestContext } from '../helpers/test-app.helper';

export const doctorConformanceFixture: DoctorConformanceFixture = {
  createContext: ({ prisma }) =>
    createTestApp({
      useMockDatabase: true,
      overrideProviders: [{ provide: PrismaService, useValue: prisma.client }],
    }),
  closeContext: (context) => closeTestApp(context as TestContext),
};
