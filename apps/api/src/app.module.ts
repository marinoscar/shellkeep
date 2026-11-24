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
import { telemetryModule } from './platform/telemetry/telemetry.config';
import { identityModule } from './platform/identity/identity.config';
import { credentialsModules } from './platform/credentials/credentials.config';
import { emailModule } from './platform/email/email.config';
import { BroadcastsModule, notificationsModule } from './platform/notifications/notifications.config';
import { dbBackupModule } from './platform/db-backup/db-backup.config';
import { AiModule } from './platform/ai/ai.config';
import { alertsModule } from './platform/alerts/alerts.config';
import { webhooksModule } from './platform/webhooks/webhooks.config';
import { sharingModule } from './platform/sharing/sharing.config';
import { exportsModule } from './platform/exports/exports.config';
import { androidAppModule } from './platform/android-app/android-app.config';
import { userDataModule } from './platform/user-data/user-data.config';
import { jobsModule, nodeCredentialModule, nodesModule } from './platform/jobs/jobs.config';
import {
  ProfileImageModule,
  StorageConfigModule,
  StorageModule,
} from './platform/storage/storage.config';
import { ServerProfilesModule } from './server-profiles/server-profiles.module';
import { TerminalModule } from './terminal/terminal.module';
import { RunbooksModule } from './runbooks/runbooks.module';
import { TerminalAiModule } from './terminal-ai/terminal-ai.module';
import { DashboardModule } from './dashboard/dashboard.module';

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
    // maxListeners: the platform slices and the runbook engine (#62) each listen to `job.settled`; the default of 10
    // trips eventemitter2's leak warning, which is a listener count and not a leak.
    EventEmitterModule.forRoot({ maxListeners: 30 }),

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
    // The platform's telemetry slice (#53): the runtime export gate and GreptimeDB connection
    // (`/api/admin/telemetry/config`, `GET /api/telemetry/config`), the explorer, the dashboard
    // with the app's "Terminal" group, the stack agent surface and the retention job
    // (`telemetry:read|write|query`). Replaces the former trace UI stack.
    telemetryModule,
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
    // Outbound webhooks (#54): signed, retried deliveries of ShellKeep and platform events to the
    // endpoints a member, an organization or the deployment registers (`/api/webhooks`,
    // `/api/org/webhooks`, `/api/admin/webhooks`), and the `webhook` notification channel.
    // After the jobs queue, notifications and credentials it depends on.
    webhooksModule,
    // Alerts (#54): rules over the terminal metrics, node events and fleet health, incidents and
    // their notifications (`/api/admin/alerts`). After telemetry, notifications and webhooks.
    alertsModule,
    // The platform AI slice (#55): `GET /api/ai/config`, `/api/ai/*` behind the kill switch and `ai:use`,
    // `/api/admin/ai/*`, the `ai.*` job types and the key stores. No provider key in the environment.
    // Feature modules import this same `AiModule`, never the platform's.
    AiModule,
    // Sharing (#71): groups, members and invites (`/api/groups`), grants (`/api/grants`) and the
    // "shared with me" list over `server_profile` and `runbook` (`app-registrations/sharing.ts`).
    // Links are disabled per resource type. After notifications and the jobs queue it depends on.
    sharingModule,
    // Data export (#68): `GET /api/exports/sources`, `POST|GET /api/exports`, `GET /api/exports/:id` and the
    // `export.run` and `export.purge` jobs, over the sources of `app-registrations/exports.ts` (`server-profiles`,
    // `terminal-sessions`, `runbook-runs`) and the platform's `user-data`. No credential ever leaves the server.
    // After storage, notifications, the jobs queue and sharing.
    exportsModule,
    // User data deletion (#69): `/api/user-data/*` (the per-user Danger Zone, `user.data.purge`), the admin factory
    // reset (`/api/admin/factory-reset/*`, `system:factory_reset`) and organization offboarding, over the decisions
    // of `app-registrations/user-data.ts`. After storage, the jobs queue, sharing and exports (the offboarding precondition).
    userDataModule,
    ServerProfilesModule,
    TerminalModule,
    // Runbooks (#61): versioned procedure definitions, target preview and secret parameters.
    RunbooksModule,
    TerminalAiModule,
    // The Home dashboard (#78): `GET /api/dashboard/summary`, one bounded read over what the caller may see.
    DashboardModule,
    // The Android companion (#74): trusted apps, `/.well-known/assetlinks.json`, hosted APK releases, signed
    // download links and the `android_app` push channel's sender. After storage and notifications.
    androidAppModule,
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
