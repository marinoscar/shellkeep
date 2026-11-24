# Runbook: The Application Database Role

**Audience:** whoever operates ShellKeep's database. Issue: #45. Model: the platform's application-role procedure; the script is `apps/api/prisma/sql/create-app-role.sql`.

## Status: switched (#52)

The API connects as `shellkeep_app` (`POSTGRES_USER` / `POSTGRES_PASSWORD`). Every access to an org-owned table goes through the platform's scoped client (`runInOrg`, `forOrg`) or, for the reviewed cross-organization reads, the bypass client (`asSystem` / `runAsSystem`); `apps/api/test/tenancy/system-injection-boundary.spec.ts` enforces both. Doctor `db.rls_role` passes once the switch is made. The staging and production switch is an operator step (#84): section 4.

## The target

| | |
|---|---|
| Role | `shellkeep_app`: `LOGIN NOSUPERUSER NOBYPASSRLS CREATEDB` |
| Owns | the database, schema `public`, and every table, sequence, type and function in `public` that is not an extension member |
| Does not own | extensions (`uuid-ossp` and any other); they stay with the bootstrap superuser |

`CREATEDB` is for the in-app restore, which replays an archive into a scratch database and renames it into place (pass `-v createdb=off` to withhold it; the backup itself needs no such right, and the pre-flight then guides a manual restore). The role never gets `SUPERUSER`, `BYPASSRLS` or `CREATEROLE`. Backups and restores lift row-level security for their own session with `--enable-row-security` plus `PGOPTIONS=-c app.rls_bypass=on`, not through the role.

## 1. Prerequisites

- A superuser login to the cluster. The script runs as that login, never as the application role.
- A fresh backup.
- A password for the role, generated and stored where you keep secrets (`openssl rand -base64 24`).
- `psql` 14 or newer.
- A window where the API is stopped (the transfer is one transaction touching catalog rows only; a few seconds on this database).

## 2. Run the script

Run it after `npm run prisma:migrate`, so the tables the migrations create are owned too. It is idempotent; running it before the migrations and again after is expected.

```bash
cd apps/api
psql -v ON_ERROR_STOP=1 -v app=shellkeep_app -v app_password='<the password>' \
  --host=<db host> --port=<db port> --username=postgres --dbname=<POSTGRES_DB> \
  -f prisma/sql/create-app-role.sql
```

What it does, in one transaction:

- creates the role if missing (`LOGIN NOSUPERUSER NOBYPASSRLS`; `app_password` is required only then);
- refuses a role that is `SUPERUSER` or `BYPASSRLS`, a session that is not a superuser, and a `db` that is not the connected database;
- moves the database, schema `public`, every table, view, sequence, function and enum (the extension members excepted) to the role;
- ends with a check that rolls everything back if anything the application should own still belongs to someone else.

It ends with `create-app-role: done; ...`. A re-run changes nothing.

## 3. Rehearse on the copy

On the restored copy from [database-baseline.md](database-baseline.md) section 1:

1. Run the script (above) against the copy. The role is cluster-wide, so on the same cluster it creates the real role; that is harmless (it owns nothing outside the copy until you run the script on another database).
2. Check ownership:

   ```sql
   SELECT tableowner, count(*) FROM pg_tables WHERE schemaname = 'public' GROUP BY 1;   -- only shellkeep_app
   SELECT datdba::regrole FROM pg_database WHERE datname = current_database();          -- shellkeep_app
   SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'shellkeep_app';         -- f | f
   ```
3. Run the migrations **as the role** against the copy; they must report nothing pending and fail on no permission:

   ```bash
   POSTGRES_USER=shellkeep_app POSTGRES_PASSWORD=<the password> npm run prisma:migrate
   ```
4. Prove isolation: connected as the role with `app.org_id` unset, `SELECT count(*) FROM storage_objects;` returns 0 (not an error). That is the expected, correct answer for a forced-RLS table; the API reads it through `runInOrg`.

> **What was rehearsed in #45.** On the stand-in described in [database-baseline.md](database-baseline.md): the role was created before the baseline, ownership of 56 tables and the database moved after the migrations, a second run changed nothing, `prisma migrate deploy` as the role reported nothing pending, and `storage_objects` read as 0 rows. A rehearsal on a restored copy of production remains an operator step (#84).

## 4. The switch (#52)

Preconditions: the role script has run on this database (section 2) after the latest `prisma:migrate`; a fresh backup exists; the `SECRETS_ENCRYPTION_KEY` is unchanged.

1. Stop the API (`docker compose ... stop api`).
2. Run the script (section 2) as the superuser. It also grants `CREATEDB`.
3. In the deployment `.env`, set `POSTGRES_USER=shellkeep_app` and `POSTGRES_PASSWORD=<the role's password>`. Nothing else changes: `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB` and `POSTGRES_SSL` stay. Keep the superuser's login out of the application's `.env`; it is for you (extensions, the script, a manual restore).
4. Run `npm run prisma:migrate` with the same `.env` (migrations run as the role, which owns `_prisma_migrations`), then start the API.
5. Verify, as the API's role: `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user;` returns `f | f`; the admin Doctor page shows `db.rls_role` passing, `backup.pg-client` and `backup.rls-bypass` passing.
6. Open Admin, Database Backup: take a backup, verify it, download it through the signed link. See [database-backup-restore.md](database-backup-restore.md).

The extensions (`uuid-ossp`, and `vector` or `pg_trgm` if a future slice needs them) are created by the superuser only; an application role cannot, and a restore does not recreate them: the target cluster must already have them.

## 5. Rollback

- **Switch back:** put the superuser's login back in `POSTGRES_USER` / `POSTGRES_PASSWORD` and restart. Ownership may stay with `shellkeep_app` (the superuser still has full access). Never grant `BYPASSRLS` to `shellkeep_app` as a fix: a dump and a restore lift row-level security for their own session, not through the role.
- **Undo the ownership move:** `REASSIGN OWNED BY shellkeep_app TO postgres;` as the superuser, then `DROP ROLE shellkeep_app` if desired. Or restore the backup.
