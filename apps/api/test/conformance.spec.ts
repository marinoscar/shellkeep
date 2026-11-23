// =============================================================================
// Platform conformance (issue #47)
// =============================================================================
//
// `runPlatformConformance` runs the platform's executable rules over ShellKeep's
// own source and registrations. Suites adopted with their slice are added here:
// `cron-enqueue-only`, `user-owned-data` and `identity` from #47, `settings` and
// `credentials` from #48, `host` and `doctor-read-only` from #46, `on-event-no-io` and
// `nodes` from #49; storage, notifications, AI and the rest follow with #50-#55.
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
// Register the `on-event-no-io` suite (jobs) and the `nodes` suite.
import '@marinoscar/platform-api/jobs/testing';
import '@marinoscar/platform-api/nodes/testing';
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
    // Queue rule 1: a `@Cron` only decides whether work is due and enqueues it. The terminal's
    // session cleanup is enqueue-only since #49 (it queues `terminal.session.reap`); the two
    // storage crons still work inline until #50 deletes them for the storage slice.
    // The three permanent exemptions (lease reaper, temp-file janitor, node secret sweep) live in
    // the platform package, outside this source root.
    cronEnqueueOnly: {
      exempt: [
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
    // Queue rule 1, the `@OnEvent` half. SKIPPED until #50 with a reason: ShellKeep's own
    // `storage/processing/object-processing.service.ts` runs a download and a storage-provider
    // call inside its `@OnEvent(OBJECT_UPLOADED_EVENT)` body, and ShellKeep has no other listener,
    // so the suite cannot scan around it. #50 deletes that module for the storage slice (its
    // post-upload processing becomes a job); the skip is deleted there and the suite runs with
    // `{ minListenerFiles: 1 }`. Listed in docs/platform-adoption/local-exceptions.md.
    onEventNoIo: {
      skip: "ShellKeep's own storage module does object I/O in an @OnEvent body until #50 replaces it with the storage slice",
    },
    // Every app route under /api/nodes carries @NodeRoute() with a declared credential and ownership;
    // the platform's own control and data plane routes are discovered from the booted module graph.
    nodes: { rootModule: AppModule, minPlatformRoutes: 10 },
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
      // ui, features, terminal, maintenance, jobs, nodes and retention.
      minSystemNamespaces: 7,
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
