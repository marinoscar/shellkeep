// Must stay the first import: registers the static registries that the DTOs
// below are composed from (see shellkeep.manifest.ts).
import './shellkeep.manifest';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';

import { PrismaModule } from './prisma/prisma.module';
import { platformHostModule } from './platform/platform-host.module';
import { doctorModule } from './platform/doctor.config';
import { hostCoreModule } from './platform/host-core.config';
import { aboutModule } from './platform/about/about.config';
import { identityModule } from './platform/identity/identity.config';
import { credentialsModules } from './platform/credentials/credentials.config';
import { emailModule } from './platform/email/email.config';
import { BroadcastsModule, notificationsModule } from './platform/notifications/notifications.config';
import { dbBackupModule } from './platform/db-backup/db-backup.config';
import { jobsModule, nodeCredentialModule, nodesModule } from './platform/jobs/jobs.config';
import {
  ProfileImageModule,
  StorageConfigModule,
  StorageModule,
} from './platform/storage/storage.config';
import { ServerProfilesModule } from './server-profiles/server-profiles.module';
import { TerminalModule } from './terminal/terminal.module';
import { LoggerModule } from './common/logger/logger.module';

import configuration from './config/configuration';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),

    // Scheduling (must be at root level for NestJS 11)
    ScheduleModule.forRoot(),

    // Event emitter for async events
    EventEmitterModule.forRoot(),

    // Database
    PrismaModule,

    // The platform's DI-time host ports (audit sink, `PLATFORM_PRISMA`), bound
    // to ShellKeep's services (#47). Global.
    platformHostModule,
    // The platform Doctor (#47, #46): the slices and the terminal domain register
    // their read-only health checks with it. `GET /api/admin/doctor`.
    doctorModule,

    // The platform's job queue and worker-node fleet (#49): `/api/admin/jobs`,
    // `/api/nodes`, `/api/admin/nodes`, the in-process worker, the lease reaper and the
    // `jobs`, `retention` and `nodes` system namespaces. Global, and before identity,
    // whose housekeeping handlers register into the queue's registry. The `nod_`
    // credential family backs identity's `IDENTITY_NODE_CREDENTIALS` port.
    jobsModule,
    nodesModule,
    nodeCredentialModule,

    // Logger
    LoggerModule,

    // Feature modules
    // The platform's identity slice (#47): `/api/auth/*`, `/api/users`,
    // `/api/roles`, `/api/allowlist`, `/api/pat`, `/api/auth/device/*` and,
    // outside production, `/api/auth/test/login`, in single-organization mode.
    // Replaces ShellKeep's own auth, users, allowlist, device-auth and
    // test-auth modules. Global: it provides `PatService` and the guards'
    // dependencies to every module.
    identityModule,
    // The platform credential stores (#48): the identity slice's sign-in secrets and
    // the server profiles' SSH secrets (`ssh` purpose).
    ...credentialsModules,
    // The host core (#46): event bus, app metrics, maintenance mode (`MaintenanceGuard`
    // is the platform's only `APP_GUARD`), the `{ data }` envelope, the exception
    // filter, request ids and the health probes (`/api/health`, `/live`, `/ready`).
    // Imported before any module that registers a guard, so the guard stays first.
    hostCoreModule,
    // `GET /api/admin/about` (#46), with the `terminal` section the terminal module adds.
    aboutModule,
    // The platform storage slice (#50): `/api/storage/objects`, `/api/storage/status`, the
    // stale-upload sweep and post-upload processing, over the provider configured at runtime
    // (`/admin/settings/storage`; no environment variables).
    StorageModule,
    // `/api/admin/storage-config` (Admin only, `storage_config:*`) and the provider migration routes.
    StorageConfigModule,
    // `/api/user-settings/profile-image` and the public `/api/users/:userId/avatar/:objectId`.
    ProfileImageModule,
    // The platform email slice (#51): SES and SMTP configured at runtime
    // (`/admin/settings/email`, `/api/email-settings`); no environment variable.
    emailModule,
    // The platform notifications slice (#51): the in-app inbox and SSE stream
    // (`/api/notifications`), Web Push with runtime VAPID keys (`/api/admin/push-config`),
    // the preferences matrix and the dispatcher. Global; `NotificationsService` is injectable anywhere.
    notificationsModule,
    // Admin broadcasts (`/api/admin/broadcasts`, `broadcasts:read|write`).
    BroadcastsModule,
    // The platform database backup slice (#52): `/api/admin/db-backup` (backups to the
    // storage provider, schedule and retention, in-app restore), its four job types and
    // Doctor checks. After storage, notifications and the jobs queue it depends on.
    dbBackupModule,
    ServerProfilesModule,
    TerminalModule,
  ],
  providers: [
    // Global validation pipe (Zod)
    {
      provide: APP_PIPE,
      useClass: ZodValidationPipe,
    },
  ],
})
export class AppModule {}
