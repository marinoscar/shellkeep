-- =============================================================================
-- Runbooks: versioned, reusable multi-step procedures (#61)
-- =============================================================================
--
-- Two org-owned tables, each with a NOT NULL org_id and a FORCEd
-- <table>_org_isolation policy copied from 0025_org_scoped_rls:
--
--   runbooks          the named runbook (metadata, archive flag, latest version)
--   runbook_versions  one IMMUTABLE row per saved definition version
--
-- ORG CONSISTENCY. A version reaches its runbook through the COMPOSITE key
-- (runbook_id, org_id) -> runbooks (id, org_id), with the supporting
-- UNIQUE (id, org_id): a foreign-key check bypasses row-level security, so a
-- plain key would let one organization store a reference to another's runbook.
--
-- RAW-SQL INDEX (intentional schema drift, listed under rawSqlIndexes in
-- platform.lock):
--   runbooks_org_name_live_uniq_idx  unique live name per organization,
--                                    case-insensitive; an archived runbook
--                                    does not block its name. Prisma cannot
--                                    express a partial expression index.
--
-- No backfill: the tables are new, so the policies are enabled at once. The
-- transaction carries app.rls_bypass as the first statement, as every
-- migration that touches an org table does.
-- =============================================================================

BEGIN;
SELECT set_config('app.rls_bypass', 'on', true);

-- CreateTable
CREATE TABLE "runbooks" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "owner_user_id" UUID,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "tags" TEXT[],
    "latest_version_id" UUID,
    "archived_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "runbooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "runbook_versions" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "runbook_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "definition" JSONB NOT NULL,
    "definition_sha256" CHAR(64) NOT NULL,
    "changelog" VARCHAR(500),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "runbook_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "runbooks_org_id_idx" ON "runbooks"("org_id");

-- CreateIndex
CREATE INDEX "runbooks_owner_user_id_idx" ON "runbooks"("owner_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "runbooks_id_org_id_key" ON "runbooks"("id", "org_id");

-- CreateIndex
CREATE INDEX "runbook_versions_org_id_idx" ON "runbook_versions"("org_id");

-- CreateIndex
CREATE INDEX "runbook_versions_created_by_idx" ON "runbook_versions"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "runbook_versions_runbook_id_version_key" ON "runbook_versions"("runbook_id", "version");

-- AddForeignKey
ALTER TABLE "runbooks" ADD CONSTRAINT "runbooks_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runbooks" ADD CONSTRAINT "runbooks_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runbook_versions" ADD CONSTRAINT "runbook_versions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runbook_versions" ADD CONSTRAINT "runbook_versions_runbook_id_org_id_fkey" FOREIGN KEY ("runbook_id", "org_id") REFERENCES "runbooks"("id", "org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runbook_versions" ADD CONSTRAINT "runbook_versions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex (partial: one live runbook per organization and lower-cased name)
CREATE UNIQUE INDEX "runbooks_org_name_live_uniq_idx" ON "runbooks"("org_id", lower("name")) WHERE "archived_at" IS NULL;

-- =============================================================================
-- Row-level security, as in 0025_org_scoped_rls. The policy names are listed
-- under rlsPolicies in platform.lock and asserted against pg_policies by the
-- drift test. NULLIF(..., '') because current_setting(name, true) is the empty
-- string on a connection that ever held a transaction-local value.
-- =============================================================================

ALTER TABLE "runbooks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "runbooks" FORCE ROW LEVEL SECURITY;
CREATE POLICY "runbooks_org_isolation" ON "runbooks"
  USING      ("org_id" = NULLIF(current_setting('app.org_id', true), '')::uuid
              OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("org_id" = NULLIF(current_setting('app.org_id', true), '')::uuid
              OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "runbook_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "runbook_versions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "runbook_versions_org_isolation" ON "runbook_versions"
  USING      ("org_id" = NULLIF(current_setting('app.org_id', true), '')::uuid
              OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("org_id" = NULLIF(current_setting('app.org_id', true), '')::uuid
              OR current_setting('app.rls_bypass', true) = 'on');

COMMIT;
