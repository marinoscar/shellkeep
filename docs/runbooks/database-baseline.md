# Runbook: Baseline the ShellKeep Database onto the Platform Migration History

Use this **once per database**, the first time a ShellKeep build that depends on `@marinoscar/platform-db` is deployed against a database that already holds data (production, staging, a developer's long-lived database). It records which existing migration *is* platform `0001_initial`, proves the live schema matches, and lets `prisma migrate deploy` apply the platform migrations `0002` to `0043` and ShellKeep's `org_id` migration.

The generic procedure and the tool's reference live in the platform packages (`node_modules/@marinoscar/platform-db/README.md`, "Baseline adoption"). This page is ShellKeep's exact sequence. Issue: #45. The production run is sequenced by #84.

## What is different about ShellKeep

- `20260124223146_initial` is byte-identical to platform `0001_initial`, so it maps by sha256 and needs no `--map` file.
- No old migration created `server_profiles`, `terminal_sessions` or the enums `AuthMethod` and `SessionStatus`; a deployed database has them because of `prisma db push`. #45 added `20260124223147_add_terminal_domain` (sorts before `..._add_server_profile_color`). On a database that already has the tables it is **marked applied, never run**.
- Those tables are not in platform `0001`, so the dry run lists them as undeclared. `apps/api/prisma/platform.lock` declares them as the deviation `shellkeep:domain-schema` (see `docs/platform-adoption/local-exceptions.md`).
- The platform migrations `0002` to `0043` are committed as installed directories (`apps/api/prisma/migrations/20261123...`) with `platform.lock`. The baseline therefore installs nothing in production; it only proves the mapping.
- `0025` and later enable row-level security on platform tables. The baseline refuses to proceed past them without `--allow-rls`, which is the operator's statement that the application role is `NOSUPERUSER NOBYPASSRLS` ([application-role.md](application-role.md)). The API itself keeps connecting as the bootstrap superuser until #52, so the policies are inert and behaviour does not change.
- `shellkeep_domain_org_id` adds `org_id NOT NULL` to `server_profiles` and `terminal_sessions` and backfills the default organization (created by platform `0023`). The domain tables are not under RLS.

## Order of operations (production, via #84)

`infra/deploy/update.sh` runs `npx prisma migrate deploy` on every update. On an existing database the new image's migrate step would try to run `20260124223147_add_terminal_domain` against tables that already exist and fail with `type "AuthMethod" already exists`. So the resolve below must happen **before** the new image's migrate step.

1. Maintenance window; back up (`pg_dump -Fc`).
2. `migrate resolve --applied 20260124223147_add_terminal_domain` (section 3).
3. Create the application role and, optionally, run the baseline dry run (sections 4 and 5).
4. Deploy the new image: its `prisma migrate deploy` applies `0002` to `0043` and `shellkeep_domain_org_id`.
5. Checks (section 7) and `prisma:seed`.

Never run `db:baseline --apply` from a deploy update. Run the baseline **before** `shellkeep_domain_org_id` is applied and do not re-run it afterwards: the deviation records the pre-`org_id` shape of the two tables, so a later dry run reports the `org_id` statements as blocking (expected).

## 1. Rehearse on a restored copy

Production is touched only after the whole procedure has run clean on a copy.

1. `pg_dump -Fc` the production database (there is no db-backup slice yet).
2. On a **trusted non-production cluster** (the copy holds production SSH ciphertexts: never a laptop; drop it afterwards): `createdb shellkeep_rehearsal` and `pg_restore --no-owner --no-acl -d shellkeep_rehearsal <dump>`.
3. Point a shell at the copy and **check twice**, because every step below writes to whatever these name:

   ```bash
   export POSTGRES_HOST=... POSTGRES_PORT=... POSTGRES_USER=... POSTGRES_PASSWORD=... POSTGRES_DB=shellkeep_rehearsal
   cd apps/api
   ```
4. Record row counts: `SELECT count(*) FROM users`, `server_profiles`, `terminal_sessions`.
5. Run sections 3 to 8 on the copy.
6. Keep the reports; the production run must print the same ones. A difference means the copy is not faithful.

> **What was rehearsed in #45.** There was no production access when #45 was implemented, so the procedure was run on a **stand-in** built to look like a deployed pre-adoption database (the old `initial` migration applied, the domain tables created as `db push` creates them, both old migrations recorded in `_prisma_migrations`, sample rows). Its reports are attached to #45. **The rehearsal on a restored copy of real production remains an operator step**, sequenced by #84. If the real copy differs from `0001` in more than the declared deviation (for example `DEFAULT uuid_generate_v4()` on `id` columns that `db push` dropped), the dry run reports it as `DIFF_BLOCKING`: handle it per section 6 and record why here.

## 2. Prerequisites

- `npm install` at the repository root (the `platform` CLI comes from `@marinoscar/platform-db`).
- A role that may `CREATE DATABASE` (the dry run builds a throwaway shadow database), or pass `--shadow-database-url` with an empty database you made.
- A fresh backup (section 9).

## 3. Mark the domain migration applied

On **every existing database** (rehearsal copy, staging, production), before anything else:

```bash
npm run prisma -- migrate resolve --applied 20260124223147_add_terminal_domain
```

It writes one ledger row; it creates nothing. A fresh, empty database does not need it: `prisma migrate deploy` runs the migration.

## 4. Create the application role

`--allow-rls` (next section) states that the application role is not a superuser. Create it first, following [application-role.md](application-role.md) (it only creates the role and moves ownership; the API is not switched).

## 5. Dry run

```bash
npm run db:baseline -- --through 1 --allow-rls
```

Expected, in order:

- B1: `platform:0001_initial -> 20260124223146_initial [sha256]`; `app-only` for `20260124223147_add_terminal_domain`, `20260322203853_add_server_profile_color` and `..._shellkeep_domain_org_id`; `0002` to `0043` mapped by `[sha256]` to the committed directories.
- B2: ledger `0 problem(s)`.
- B3: `0 blocking, 11 declared` (the `shellkeep:domain-schema` deviation).
- B4: indexes and policies `0 problem(s)`.
- B5: `0 to resolve, 0 to install only`, then `nothing to do`.

Without the deviation in `platform.lock` the same run reports eleven `BLOCKING` statements (the two enums, the two tables, four indexes, three foreign keys). Without `--allow-rls` it refuses with `RLS_OPT_IN_REQUIRED`.

`--apply` is **not needed** in this repository: the installed directories and `platform.lock` are already committed, so there is nothing to install or resolve (the first run in #45, before they existed, installed them). Do not pass `--apply` unless the dry run asks for it.

## 6. Fixing differences

| You see | Do |
|---|---|
| `DIFF_BLOCKING` with a statement you did not expect | The live database differs from `0001` plus the declared domain schema. If the app intends it, add it under `deviations` in `platform.lock`; if not, write a forward migration. Do not edit `0001`. |
| `DEFAULT uuid_generate_v4()` differences on `id` columns | `prisma db push` drops defaults that the schema does not declare. Platform `0005_drop_stale_uuid_defaults` drops them anyway; declare the printed statements, or lower `--through`. Record the decision here. |
| `LEDGER_ROW_MISSING` / `LEDGER_CHECKSUM_MISMATCH` | Section 3 not done, or a migration file was edited. Restore it from Git; never edit an applied migration. |
| `LEDGER_FAILED_ROW` | Find it with `SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL;`, then `migrate resolve --rolled-back` or `--applied` per what the migration left behind. |
| `RLS_OPT_IN_REQUIRED` | Create the role (section 4) and pass `--allow-rls`. |
| `--map` | Only if the copy differs from `0001` by more than comments; write the reason here. Not needed for ShellKeep today. |

## 7. Apply the migrations and check

```bash
npm run prisma:migrate        # applies 0002..0043 and shellkeep_domain_org_id
npm run db:check              # installed files equal the package; lock consistent
npm run db:check:database     # the lock, the files and _prisma_migrations agree
npm run db:drift              # the migrations equal the composed schema; indexes and policies present
npm run prisma:seed
```

Then check the data:

```sql
SELECT count(*) FROM users;              -- same as before
SELECT count(*) FROM server_profiles;    -- same as before
SELECT count(*) FROM terminal_sessions;  -- same as before
SELECT count(*) FROM server_profiles WHERE org_id IS DISTINCT FROM (SELECT id FROM organizations WHERE is_default);  -- 0
SELECT count(*) FROM terminal_sessions WHERE org_id IS DISTINCT FROM (SELECT id FROM organizations WHERE is_default); -- 0
```

## 8. A fresh database

A new environment needs none of the above:

```bash
createdb shellkeep
npm run prisma:migrate && npm run prisma:seed
npm run db:check:database && npm run db:drift
```

`apps/api/test/prisma/domain-org-id.db.spec.ts` (`npm run test:db`) and the `db-fresh` CI job cover this on every PR.

## 9. Rollback

The baseline writes only ledger rows (`migrate resolve --applied`). `prisma migrate deploy` then applies the platform migrations and `shellkeep_domain_org_id`. To undo: **restore the backup taken before the window**, and revert the PR (migration directories, `platform.lock`, fragments). For a rehearsal, drop the scratch database.

## 10. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `type "AuthMethod" already exists` on `migrate deploy` | Section 3 was skipped on an existing database | `migrate resolve --applied 20260124223147_add_terminal_domain`, then retry |
| `relation "server_profiles" does not exist` on a fresh database | The domain migration is missing or sorts after the color migration | It must be `20260124223147_...`, before `20260322203853_...` |
| `P3005` on `migrate deploy` | The database was never managed by Prisma Migrate | Record every old migration with `migrate resolve --applied`, in order, then continue at section 3 |
| `permission denied to create database` | The role cannot create the shadow database | Create an empty database and pass `--shadow-database-url` |
| `platform.lock ... LOCAL_MODIFIED` from `db:check` | An installed `migration.sql` changed (comments count) | Restore it from Git |
