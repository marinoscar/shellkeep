// =============================================================================
// The db-backup slice's host ports (issue #52)
// =============================================================================
//
// `@Global()`, passed to `DbBackupModule.forRoot({ imports })`
// (./db-backup.config.ts):
//
//   DB_BACKUP_NOTIFIER         -> NotificationsService   (db_backup.backup_failed, db_backup.restore_completed)
//   DB_BACKUP_MAINTENANCE      -> MaintenanceModeService (the restore swap's in-memory gate)
//   DB_BACKUP_METRICS          -> AppMetricsService      (the app.backup.* instruments)
//   DB_BACKUP_DEPLOYMENT_MODE  -> DeploymentModeService  (`DEPLOYMENT_MODE`, restore is off in `saas`)
//   DB_BACKUP_SYSTEM_DATA      -> PrismaSystemService    (the `backup.rls-bypass` Doctor check)
//
// `NotificationsService`, `MaintenanceModeService`, `AppMetricsService` and
// `DeploymentModeService` come from global modules (notifications, host core).
//
// The tenant client is the core port `PLATFORM_PRISMA` (`PlatformHostModule`,
// bound to `PrismaService`): the slice reads only `database_backup_runs`,
// `jobs`, `users` and `audit_events` through it, none of which carries
// row-level security. The org tables are reached by `pg_dump` and `pg_restore`
// alone, plus the Doctor check below.
//
// This file is on the reviewed allowlist of
// `test/tenancy/system-injection-boundary.spec.ts`: the `backup.rls-bypass`
// Doctor check counts every organization's rows through the bypass client,
// under the `doctor` access reason.
// =============================================================================

import { Global, Module } from '@nestjs/common';
import {
  DB_BACKUP_DEPLOYMENT_MODE,
  DB_BACKUP_MAINTENANCE,
  DB_BACKUP_METRICS,
  DB_BACKUP_NOTIFIER,
  DB_BACKUP_SYSTEM_DATA,
} from '@marinoscar/platform-api/db-backup';
import { AppMetricsService, DeploymentModeService, MaintenanceModeService } from '@marinoscar/platform-api/host';
import { NotificationsService } from '@marinoscar/platform-api/notifications';

import { PrismaSystemService } from '../../prisma/prisma-system.service';

const BINDINGS = [
  { provide: DB_BACKUP_NOTIFIER, useExisting: NotificationsService },
  { provide: DB_BACKUP_MAINTENANCE, useExisting: MaintenanceModeService },
  { provide: DB_BACKUP_METRICS, useExisting: AppMetricsService },
  { provide: DB_BACKUP_DEPLOYMENT_MODE, useExisting: DeploymentModeService },
  { provide: DB_BACKUP_SYSTEM_DATA, useExisting: PrismaSystemService },
];

@Global()
@Module({
  providers: BINDINGS,
  exports: BINDINGS.map((binding) => binding.provide),
})
export class DbBackupHostModule {}
