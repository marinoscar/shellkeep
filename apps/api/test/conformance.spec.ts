// =============================================================================
// Platform conformance (issue #47)
// =============================================================================
//
// `runPlatformConformance` runs the platform's executable rules over ShellKeep's
// own source and registrations. Suites adopted with their slice are added here:
// `cron-enqueue-only`, `user-owned-data` and `identity` from #47, `settings` and
// `credentials` from #48, `host` and `doctor-read-only` from #46; the jobs, storage,
// notifications, AI and the rest follow with #49-#55.
//
// The registries are filled by the first two imports, as `main.ts` fills them.
// =============================================================================
import '../src/shellkeep.manifest';
import '../src/app-registrations/registrations';

import { Module } from '@nestjs/common';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildPermissionCatalog,
  catalogGrants,
  permissionRegistry,
  roleRegistry,
  userOwnedModelRegistry,
} from '@marinoscar/platform-api/core';
// Register the `credentials`, `identity` and `settings` suites with the conformance harness.
import '@marinoscar/platform-api/credentials/testing';
// Register the `doctor-read-only` and `host` suites.
import '@marinoscar/platform-api/doctor/testing';
import '@marinoscar/platform-api/host/testing';
import { STORAGE_CREDENTIAL_PURPOSE_DEF } from '@marinoscar/platform-api/storage';
import { discoverControllers } from '@marinoscar/platform-api/identity/testing';
import '@marinoscar/platform-api/settings/testing';
import { runPlatformConformance } from '@marinoscar/platform-api/testing';

import { AppModule } from '../src/app.module';
import { doctorConformanceFixture } from './conformance/doctor-fixture';
import {
  SETTINGS_CATALOG_STALE_MESSAGE,
  SYSTEM_SETTINGS_CATALOG_RELATIVE_PATH,
} from '../src/platform/settings/settings-catalog';

const catalogPath = join(__dirname, '..', SYSTEM_SETTINGS_CATALOG_RELATIVE_PATH);

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
    // Every system and user namespace is declared and bounded (no secret-named field), the
    // settings permissions are registered with the right scope, and the committed system
    // defaults catalog the seed reads is current.
    settings: {
      permissions: permissionRegistry.list(),
      catalog: {
        contents: existsSync(catalogPath) ? readFileSync(catalogPath, 'utf8') : undefined,
        staleMessage: SETTINGS_CATALOG_STALE_MESSAGE,
      },
      // ui, features, terminal (+ the platform's OAuth server namespace).
      minSystemNamespaces: 3,
    },
    // Every credential purpose has a platform or app owner, every user purpose's fallback
    // address resolves (`ssh` has none), and no credential presentation schema carries a
    // secret-shaped field. ShellKeep registers no deployment (system or organization)
    // purpose until #50 adopts storage, and the suite refuses a scan of zero purposes, so
    // the owner check runs over the platform's storage definition, the first one #50
    // registers. The user purposes are the registry's own (`ssh`).
    credentials: { appOwners: ['app'], purposes: [STORAGE_CREDENTIAL_PURPOSE_DEF] },
    // The host core is mounted exactly once, `MaintenanceGuard` is the only `APP_GUARD` and runs
    // first (no global JWT guard), and the `{ data }` envelope and the exception filter are global.
    host: { rootModule: AppModule },
    // Every Doctor check the booted app registers runs against a recording Prisma client and a
    // storage provider that refuses writes: none may write, throw, time out or return an invalid
    // outcome. The platform registers 13 (the host's `core.*`, `db.*`, `secrets.*`,
    // `maintenance.mode` and `network.egress`, and the identity slice's `auth.*` and
    // `tenancy.mode`); the terminal adds four (`terminal.ssh.client`, `terminal.tmux.probe`,
    // `terminal.sessions.reaper`, `terminal.ssh.legacy-secrets`). The fifth terminal item,
    // `terminal.ssh.egress`, is an egress contributor graded by `network.egress`.
    doctorReadOnly: { fixture: doctorConformanceFixture, minChecks: 17 },
  },
});
