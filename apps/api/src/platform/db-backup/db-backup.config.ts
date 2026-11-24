// =============================================================================
// The db-backup slice, configured once (issue #52)
// =============================================================================
//
// `DbBackupModule` is the CONFIGURED dynamic module of
// `@marinoscar/platform-api/db-backup`: `/api/admin/db-backup` (`db_backup:read`,
// `:write`, `:restore`, system `admin` only), the four job types
// (`db.backup.run`, `db.backup.sweep`, `db.restore.run`,
// `db.restore.old-db-drop`), the schedule task and the Doctor checks
// (`backup.schedule`, `backup.pg-client`, `backup.rls-bypass`, `backup.mirrors`).
//
// SELF-HOSTED. `deploymentMode: 'self-hosted'` keeps the in-app restore on. The
// archive target is the storage slice's active provider (`database-backups/`
// prefix, deployment scope), configured at runtime at `/admin/settings/storage`;
// no `target` and no mirror is passed. Schedule and retention are the
// `databaseBackup` system settings namespace, edited in the admin UI. No
// environment variable is added for any of it.
//
// No `RestoreCarryOver` is registered: ShellKeep holds no deployment state that
// must survive a restore. The slice itself carries the backup catalog
// (`database_backup_runs`) and the restore's own job row across the swap; the
// SSH secrets are ciphertext in `credentials`-store rows inside the archive and
// open again with the same `SECRETS_ENCRYPTION_KEY`, which is held outside the
// database. See docs/runbooks/database-backup-restore.md.
// =============================================================================

import { DbBackupModule as PlatformDbBackupModule } from '@marinoscar/platform-api/db-backup';

import { resolveApiVersion } from '../../openapi/version';
import { DbBackupHostModule } from './db-backup-host.module';

/** Backups, restores, their four job types, the admin routes and the Doctor checks. */
export const dbBackupModule = PlatformDbBackupModule.forRoot({
  appName: 'shellkeep',
  appVersion: resolveApiVersion,
  deploymentMode: 'self-hosted',
  imports: [DbBackupHostModule],
});
