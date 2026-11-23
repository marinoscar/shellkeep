// =============================================================================
// Platform conformance (issue #47)
// =============================================================================
//
// `runPlatformConformance` runs the platform's executable rules over ShellKeep's
// own source and registrations. Suites adopted with their slice are added here:
// `cron-enqueue-only`, `user-owned-data` and `identity` from #47; the jobs,
// storage, settings, notifications, AI and the rest follow with #46 and #48-#55.
//
// The registries are filled by the first two imports, as `main.ts` fills them.
// =============================================================================
import '../src/shellkeep.manifest';
import '../src/app-registrations/registrations';

import { Module } from '@nestjs/common';
import { join } from 'node:path';

import {
  buildPermissionCatalog,
  catalogGrants,
  permissionRegistry,
  roleRegistry,
  userOwnedModelRegistry,
} from '@marinoscar/platform-api/core';
// Registers the `identity` suite with the conformance harness.
import { discoverControllers } from '@marinoscar/platform-api/identity/testing';
import { runPlatformConformance } from '@marinoscar/platform-api/testing';

import { AppModule } from '../src/app.module';

const API_DIR = join(__dirname, '..');

/**
 * The root the identity suite walks: every controller reachable from `AppModule`.
 * Each must declare `@Auth(...)` or `@Public()`; there is no global JWT guard, so a
 * route with neither is public by accident.
 */
@Module({ controllers: discoverControllers(AppModule) })
class IdentityConformanceRoot {}

runPlatformConformance({
  sourceRoots: [join(API_DIR, 'src')],
  suites: {
    // Queue rule 1: a `@Cron` only decides whether work is due and enqueues it. ShellKeep has
    // no job queue until #49, so its three housekeeping crons still work inline. Each is a
    // permanent-looking exemption only for now: #49 turns the terminal one into the
    // `terminal.session.reap` job and #50 deletes the two storage ones for the storage slice.
    // The three permanent exemptions (lease reaper, temp-file janitor, node secret sweep) live in
    // the platform package, outside this source root.
    cronEnqueueOnly: {
      exempt: [
        {
          file: 'terminal/tasks/session-cleanup.task.ts',
          why: 'Inline session reaping until #49 (2.1) moves it to the terminal.session.reap job',
        },
        {
          file: 'storage/tasks/storage-cleanup.task.ts',
          why: 'ShellKeep storage module cleanup works inline until #50 (2.2) deletes it for the storage slice',
        },
        {
          file: 'storage/tasks/storage-expiry.task.ts',
          why: 'ShellKeep storage module expiry works inline until #50 (2.2) deletes it for the storage slice',
        },
      ],
      minCronFiles: 1,
    },
    // Every model with a foreign key to `User` is classified for the user-data machinery
    // (`app-registrations/user-owned-models.ts` and the platform's own list).
    userOwnedData: {
      schemaPath: join(API_DIR, 'prisma', 'schema'),
      policies: userOwnedModelRegistry.list(),
      rawSqlAllowlist: [
        {
          file: 'prisma/prisma.service.ts',
          why: 'Test-only cleanDatabase() truncates every table (refuses to run outside NODE_ENV=test)',
        },
        {
          file: 'health/indicators/database.indicator.ts',
          why: 'Liveness probe: SELECT 1, touches no table',
        },
      ],
      registerIn: 'src/app-registrations/user-owned-models.ts',
    },
    // Every route declares its access, every permission and role a route names is registered,
    // org-scoped permissions are granted only to org roles (and system ones to system roles).
    identity: {
      rootModule: IdentityConformanceRoot,
      permissions: permissionRegistry.list(),
      roles: roleRegistry.list(),
      grants: catalogGrants(buildPermissionCatalog()),
    },
  },
});
