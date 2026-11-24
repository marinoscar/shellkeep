-- =============================================================================
-- Create the application database role and hand it the database
-- =============================================================================
--
-- Row-level security does not apply to a superuser, so the platform's tenant
-- tables (forced RLS since platform migration 0025) are not isolated until the
-- API connects as an ordinary role that OWNS them. This script creates that
-- role and moves ownership (#45). The API connects as it since #52: its login
-- is POSTGRES_USER / POSTGRES_PASSWORD, and every org-table access goes through
-- the platform's runInOrg / asSystem. Procedure, switch and rollback:
-- docs/runbooks/application-role.md.
--
-- Run it as a SUPERUSER, connected to the application database, AFTER
-- `npm run prisma:migrate` (so the tables the migrations create are owned too),
-- with the API stopped:
--
--   psql -v ON_ERROR_STOP=1 -v app=shellkeep_app -v app_password="$APP_DB_PASSWORD" \
--        -d "$POSTGRES_DB" -f apps/api/prisma/sql/create-app-role.sql
--
--   app           (required) the role name, normally shellkeep_app
--   app_password  (required when the role does not exist yet) its login password
--   db            (optional) the database to hand over; must be the one connected to
--   createdb      (optional, default on) give the role CREATEDB. The in-app restore
--                 (#52) replays the archive into a scratch database and renames it
--                 into place, which needs it; the pre-flight guides a manual restore
--                 otherwise. Pass -v createdb=off for a role that never restores in
--                 the application (the backup itself needs no such right).
--
-- The role: LOGIN NOSUPERUSER NOBYPASSRLS [CREATEDB]. An existing role is checked:
-- the script refuses one that is SUPERUSER or BYPASSRLS, and otherwise changes
-- only the one attribute above (CREATEDB, granted when createdb is on). It never
-- grants BYPASSRLS or SUPERUSER, and never CREATEROLE.
--
-- What moves to the role: the database, schema public, and every table,
-- partitioned table, view, materialized view, foreign table, sequence,
-- function, procedure, aggregate and type (enum, domain, range, standalone
-- composite) in schema public that is not a member of an extension. Indexes,
-- constraints, triggers and TOAST tables follow their table. Extensions
-- (uuid-ossp and any other) and the objects they own stay with the superuser.
--
-- Idempotent: an object the role already owns is skipped. The transfer is one
-- transaction and ends with a check that rolls it back if anything the
-- application should own is still owned by someone else. The statements are
-- generated with \gexec because psql does not substitute :'app' inside a
-- dollar-quoted body.
-- =============================================================================

\set ON_ERROR_STOP on
\set QUIET on

-- --- Preconditions -----------------------------------------------------------

SELECT current_database() AS current_db,
       (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS is_superuser \gset

\if :{?app}
\else
  DO $$ BEGIN RAISE EXCEPTION 'create-app-role: pass the application role, e.g. -v app=kvox_app'; END $$;
  \quit
\endif

\if :{?db}
\else
  \set db :current_db
\endif

\if :{?createdb}
\else
  \set createdb on
\endif

SELECT (:'db' = current_database()) AS db_matches,
       EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app') AS role_exists,
       COALESCE((SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = :'app'), false) AS role_privileged \gset

\if :is_superuser
\else
  DO $$ BEGIN RAISE EXCEPTION 'create-app-role: run this as a superuser (the bootstrap login), not as the application role'; END $$;
  \quit
\endif

\if :db_matches
\else
  DO $$ BEGIN RAISE EXCEPTION 'create-app-role: db must be the database this session is connected to'; END $$;
  \quit
\endif

\if :role_exists
\else
  \if :{?app_password}
    CREATE ROLE :"app" LOGIN PASSWORD :'app_password' NOSUPERUSER NOBYPASSRLS;
  \else
    DO $$ BEGIN RAISE EXCEPTION 'create-app-role: the role does not exist; pass -v app_password=... to create it'; END $$;
    \quit
  \endif
\endif

\if :role_privileged
  DO $$ BEGIN RAISE EXCEPTION 'create-app-role: refusing a role that is SUPERUSER or BYPASSRLS; row-level security would stay inert'; END $$;
  \quit
\endif

-- CREATEDB for the in-app restore (see the header). Idempotent.
\if :createdb
  ALTER ROLE :"app" CREATEDB;
\endif

-- --- The transfer ------------------------------------------------------------

BEGIN;

-- Carried into the closing check (a DO body cannot see psql variables).
SELECT set_config('create_app_role.app', :'app', true) \gset

ALTER DATABASE :"db" OWNER TO :"app";
ALTER SCHEMA public OWNER TO :"app";

-- Tables (ordinary and partitioned), views, materialized views, foreign tables.
-- Before sequences: an owned-by sequence follows its table.
SELECT format('ALTER %s %I.%I OWNER TO %I',
              CASE c.relkind WHEN 'v' THEN 'VIEW'
                             WHEN 'm' THEN 'MATERIALIZED VIEW'
                             WHEN 'f' THEN 'FOREIGN TABLE'
                             ELSE 'TABLE' END,
              n.nspname, c.relname, :'app')
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
   AND c.relowner <> (SELECT oid FROM pg_roles WHERE rolname = :'app')
   AND NOT EXISTS (SELECT 1 FROM pg_depend d
                    WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
 ORDER BY c.relkind, c.relname
\gexec

-- Sequences (a sequence that follows its table is already owned by the role).
SELECT format('ALTER SEQUENCE %I.%I OWNER TO %I', n.nspname, c.relname, :'app')
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relkind = 'S'
   AND c.relowner <> (SELECT oid FROM pg_roles WHERE rolname = :'app')
   AND NOT EXISTS (SELECT 1 FROM pg_depend d
                    WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
 ORDER BY c.relname
\gexec

-- Types: enums, domains, ranges and standalone composites. An array type, a
-- multirange and a table's row type follow their element, range or table.
SELECT format('ALTER TYPE %I.%I OWNER TO %I', n.nspname, t.typname, :'app')
  FROM pg_type t
  JOIN pg_namespace n ON n.oid = t.typnamespace
 WHERE n.nspname = 'public'
   AND (t.typtype IN ('e', 'r')
        OR (t.typtype = 'd')
        OR (t.typtype = 'c' AND EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = t.typrelid AND c.relkind = 'c')))
   AND t.typowner <> (SELECT oid FROM pg_roles WHERE rolname = :'app')
   AND NOT EXISTS (SELECT 1 FROM pg_depend d
                    WHERE d.classid = 'pg_type'::regclass AND d.objid = t.oid AND d.deptype = 'e')
 ORDER BY t.typname
\gexec

-- Functions, procedures, aggregates (a platform migration may create some).
SELECT format('ALTER ROUTINE %s OWNER TO %I', p.oid::regprocedure, :'app')
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proowner <> (SELECT oid FROM pg_roles WHERE rolname = :'app')
   AND NOT EXISTS (SELECT 1 FROM pg_depend d
                    WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
 ORDER BY p.proname
\gexec

-- --- Closing check -----------------------------------------------------------
-- Anything the application should own but does not fails the script, and the
-- transaction with it.

DO $check$
DECLARE
  app_oid  oid := (SELECT oid FROM pg_roles WHERE rolname = current_setting('create_app_role.app'));
  leftover text;
BEGIN
  SELECT string_agg(kind || ' ' || name, E'\n  ' ORDER BY kind, name) INTO leftover FROM (
    SELECT 'relation' AS kind, c.relname::text AS name
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S', 'c')
       AND c.relowner <> app_oid
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
    UNION ALL
    SELECT 'type', t.typname::text
      FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'public'
       AND t.typtype IN ('e', 'r', 'd')
       AND t.typowner <> app_oid
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_type'::regclass AND d.objid = t.oid AND d.deptype = 'e')
    UNION ALL
    SELECT 'routine', p.oid::regprocedure::text
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proowner <> app_oid
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
    UNION ALL
    SELECT 'schema', nspname::text FROM pg_namespace WHERE nspname = 'public' AND nspowner <> app_oid
    UNION ALL
    SELECT 'database', datname::text FROM pg_database WHERE datname = current_database() AND datdba <> app_oid
  ) s;

  IF leftover IS NOT NULL THEN
    RAISE EXCEPTION E'objects still not owned by the application role:\n  %', leftover;
  END IF;
END
$check$;

COMMIT;

\echo 'create-app-role: done; the database and every application-owned object belong to the role'
