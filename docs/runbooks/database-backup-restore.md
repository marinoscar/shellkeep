# Runbook: Database Backup and Restore

**Audience:** the administrator of a ShellKeep deployment. Issue: #52. Design: the platform's db-backup slice (`@marinoscar/platform-api/db-backup`); page: Admin, Database Backup (`/admin/settings/db-backup`).

## What it does

- **Backup:** `pg_dump` streams a custom-format archive into object storage under `database-backups/`, then the run is verified by the slice and recorded in `database_backup_runs`. The archive is never buffered in memory or on disk. A schedule and retention are the `databaseBackup` system settings (the page's configuration panel). A failed run emails the administrators (notifications, #51).
- **Restore:** a pre-flight (read-only: it creates, drops and renames nothing) reports whether the restore can work; the restore replays the archive into a scratch database, verifies it, renames it into place, keeps the old database for rollback and exits so the supervisor restarts the API. Restore needs `db_backup:restore` and a typed confirmation.
- Permissions: `db_backup:read`, `db_backup:write` and `db_backup:restore`, held by the system `admin` role only.

## Prerequisites

- Object storage configured and active (Admin, Storage; [storage-configuration.md](storage-configuration.md)). Without it a backup fails with a clear error.
- The API image carries `pg_dump`, `pg_restore` and `psql` of at least the server's major version (the Dockerfile pins the client; `backup.pg-client` in the Doctor checks it).
- The API connects as the application role ([application-role.md](application-role.md)). It needs `CREATEDB` for the in-app restore; a database restored into a cluster that lacks the extensions the schema uses fails, so create them first as the superuser.

## Row-level security

Every dump and restore carries BOTH `--enable-row-security` and `PGOPTIONS=-c app.rls_bypass=on`; the slice does it. The flag alone exits 0 with an archive that holds no rows. Doctor `backup.rls-bypass` compares a bypass count with a count over the dump's own startup option. The connection must be direct (no transaction-mode pooler).

## Taking and checking a backup

1. Admin, Database Backup, Run backup now. Wait for `completed`.
2. Verify it (the page's Verify action); open the signed download link and save the archive.
3. Check the size is plausible, not tiny: an empty-table archive is the failure the RLS pair prevents.

## Restoring

1. Take a fresh backup first (it is your undo).
2. Open the restore dialog on the archive, read the pre-flight, type the confirmation.
3. The API restarts on the restored database. Sign in again; server profiles, terminal sessions and settings are back as of the archive.
4. Keep the old database until you are satisfied; the slice drops it on its sweep job.

## Keys and secrets

An archive holds SSH secrets as ciphertext and the credential store's rows. They are only as safe as `SECRETS_ENCRYPTION_KEY`: **never store the key next to the archives.** Restoring under a different key keeps every row but cannot open a stored secret. ShellKeep registers no restore carry-over: there is no deployment state outside the database to bring across.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Pre-flight refuses: cannot create database | the application role lacks `CREATEDB` | re-run `create-app-role.sql` as the superuser (it grants it), or restore manually with the guided block |
| `backup.pg-client` warns | the client in the image is older than the server | bump the pin in `apps/api/Dockerfile` (`test/pg-client-version.spec.ts` holds it equal to the slice's floor) |
| `backup.rls-bypass` fails | a custom `PGOPTIONS`, a pooler, or a role that cannot set the option | connect directly; remove the override |
| Archive restores with empty tables | a dump without the bypass option | never take a manual `pg_dump` without both halves |
