// =============================================================================
// Platform conformance (issue #47)
// =============================================================================
//
// `runPlatformConformance` runs the platform's executable rules over ShellKeep's
// own source and registrations. Suites adopted with their slice are added here:
// `cron-enqueue-only`, `user-owned-data` and `identity` from #47, `settings` and
// `credentials` from #48, `host` and `doctor-read-only` from #46, `on-event-no-io` and
// `nodes` from #49, `storage` from #50, `email` and `notifications` from #51, `dbBackup` from #52; AI and the rest follow with #53-#55.
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
// Register the `storage` suite.
import '@marinoscar/platform-api/storage/testing';
// Register the `email` and `notifications` suites (#51).
import '@marinoscar/platform-api/email/testing';
import '@marinoscar/platform-api/notifications/testing';
// Register the `dbBackup` suite (#52).
import '@marinoscar/platform-api/db-backup/testing';
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
    // session cleanup is enqueue-only since #49 (it queues `terminal.session.reap`), and the
    // storage crons went with ShellKeep's own storage module in #50: the stale-upload sweep is
    // the storage slice's (it enqueues `storage.cleanup.stale-uploads`). No ShellKeep exemption remains.
    // The three permanent exemptions (lease reaper, temp-file janitor, node secret sweep) live in
    // the platform package, outside this source root.
    cronEnqueueOnly: {
      exempt: [],
      minCronFiles: 1,
    },
    // Queue rule 1, the `@OnEvent` half. SKIPPED with a reason that is no longer a violation:
    // ShellKeep declares no `@OnEvent` listener at all since #50 deleted its own storage module
    // (`storage/processing`, the app's only one). #51 did not add one: the notifications slice's
    // listeners (job failure, broadcast failure, node offline) ship compiled in the package, the
    // suite scans the app's `.ts` sources only (the package's own listeners are scanned in the
    // platform's repository), and it refuses a scan that finds no listener (`minListenerFiles` is
    // a positive integer, so it cannot pass vacuously). Re-enable it with `{ minListenerFiles: 1 }`
    // in the PR that adds ShellKeep's first listener. Listed in
    // docs/platform-adoption/local-exceptions.md.
    onEventNoIo: {
      skip: 'ShellKeep declares no @OnEvent listener (the suite refuses a scan that finds none); re-enable with the first one',
    },
    // The email slice (#51): every platform template is registered, ShellKeep's own render a
    // complete message from sample data and escape markup in it, and neither the stored settings
    // nor the admin view declares a secret-bearing field. The sample uses invented names only.
    email: {
      samples: {
        'terminal-session-reaped': {
          sessions: [{ name: 'Session <b>A</b>', serverName: 'server-a.example.test', idleMinutes: 185 }],
          moreCount: 0,
        },
      },
    },
    // The notifications slice (#51): the platform's channels and events are registered, every
    // event that declares email has a template, no `notify` call sits inside a `$transaction`
    // (the reaper's call follows the committed update; nothing is allowlisted) and neither the Web
    // Push settings nor their admin view carries a secret.
    notifications: {},
    // The storage slice (#50): the registered key prefixes are well formed, disjoint and complete
    // (ShellKeep's two writers' prefixes must be among them), org-scoped prefixes build
    // org-segmented keys, no storage setting is secret-named, per-row routing keeps an object on
    // its own bucket, every driver writes its secrets to its own address, and the provider
    // extensions behave.
    storage: { requiredPrefixIds: ['session-logs', 'runbook-artifacts'] },
    // The db-backup slice (#52): every dump and restore carries BOTH halves of the row-level
    // security pair (`--enable-row-security` and `PGOPTIONS=-c app.rls_bypass=on`), the restore is
    // server-only and the backup node-eligible with its profile and broker, the three permissions
    // are system scope, every registered restore carry-over binds `$1` (none is registered), and
    // `database-backups/` is a registered deployment-scope key prefix.
    dbBackup: {},
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
      // ui, features, terminal, maintenance, jobs, nodes, retention, storage, notifications, ssh and databaseBackup.
      minSystemNamespaces: 11,
    },
    // Every credential purpose has a platform or app owner, every user purpose's fallback
    // address resolves (`ssh` has none), and no credential presentation schema carries a
    // secret-shaped field. The deployment purpose is the storage slice's (#50); the user
    // purpose is ShellKeep's `ssh`.
    credentials: { appOwners: ['app'] },
    // The host core is mounted exactly once, `MaintenanceGuard` is the only `APP_GUARD` and runs
    // first (no global JWT guard), and the `{ data }` envelope and the exception filter are global.
    host: { rootModule: AppModule },
    // Every Doctor check the booted app registers runs against a recording Prisma client and a
    // storage provider that refuses writes: none may write, throw, time out or return an invalid
    // outcome. The platform registers 15 (the host's `core.*`, `db.*`, `secrets.*`,
    // `maintenance.mode` and `network.egress`, the identity slice's `auth.*` and
    // `tenancy.mode`, and the storage slice's `storage.config` and `storage.bucket`) and the db-backup
    // slice's four (`backup.schedule`, `backup.pg-client`, `backup.rls-bypass`, `backup.mirrors`, #52); the terminal
    // adds five (`terminal.ssh.client`, `terminal.tmux.probe`, `terminal.sessions.reaper`,
    // `terminal.ssh.legacy-secrets`, and the SSH slice's `ssh.host_key_policy`). The last item,
    // `terminal.ssh.egress`, is an egress contributor graded by `network.egress`.
    doctorReadOnly: { fixture: doctorConformanceFixture, minChecks: 24 },
  },
});
