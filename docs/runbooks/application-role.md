# Runbook: The Application Database Role

**Audience:** whoever operates ShellKeep's database. Issue: #45. Model: the platform's application-role procedure; the script is `apps/api/prisma/sql/create-app-role.sql`.

## Status: created, not switched

#45 adds the role and the script. **The API keeps connecting as the bootstrap superuser** (`POSTGRES_USER`) until #52. Reason: the platform's storage tables have forced row-level security (platform `0025`), and ShellKeep's storage code does not yet read them through the platform's `runInOrg`. Under an ordinary role that owns the tables, every storage query would return no rows. Do not change `POSTGRES_USER` before #52.

Until the switch the role exists so that (a) the baseline can be run with `--allow-rls` ([database-baseline.md](database-baseline.md)), and (b) the switch is a credentials change instead of a migration project.

## The target

| | |
|---|---|
| Role | `shellkeep_app`: `LOGIN NOSUPERUSER NOBYPASSRLS` |
| Owns | the database, schema `public`, and every table, sequence, type and function in `public` that is not an extension member |
| Does not own | extensions (`uuid-ossp` and any other); they stay with the bootstrap superuser |

The role never gets `SUPERUSER` or `BYPASSRLS`. Backups and restores lift row-level security for their own session with `--enable-row-security` plus `PGOPTIONS=-c app.rls_bypass=on`, not through the role.

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
4. Prove isolation: connected as the role with `app.org_id` unset, `SELECT count(*) FROM storage_objects;` returns 0 (not an error). That is the expected, correct answer for a forced-RLS table; it is exactly why the API cannot be switched before #52.

> **What was rehearsed in #45.** On the stand-in described in [database-baseline.md](database-baseline.md): the role was created before the baseline, ownership of 56 tables and the database moved after the migrations, a second run changed nothing, `prisma migrate deploy` as the role reported nothing pending, and `storage_objects` read as 0 rows. A rehearsal on a restored copy of production remains an operator step (#84).

## 4. The switch (#52, not now)

When #52 lands: put the role's login in `POSTGRES_USER` / `POSTGRES_PASSWORD` for the API, restart it, run the migrations as the role, and check the Doctor result for `db.rls_role` once the Doctor slice is adopted. Take one backup right away and confirm it completes.

## 5. Rollback

Ownership changes are reversible: `REASSIGN OWNED BY shellkeep_app TO postgres;` as the superuser, then `DROP ROLE shellkeep_app` if desired. Or restore the backup.
