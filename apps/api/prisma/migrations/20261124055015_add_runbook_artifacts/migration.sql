-- =============================================================================
-- Runbook artifacts: collected logs and the zip bundle of a run (#63)
-- =============================================================================
--
-- One org-owned table with a NOT NULL org_id and a FORCEd runbook_artifacts_org_isolation policy
-- copied from 0025_org_scoped_rls. Its links to the run, the target and the step are COMPOSITE foreign
-- keys that include org_id (a foreign-key check bypasses row-level security).
--
--   kind  target_archive   one tar.gz a collect_logs step collected on one server
--         bundle           the zip of a whole run (run_target_id and run_step_id are NULL)
--
-- RAW-SQL INDEX (intentional schema drift, listed in rawSqlIndexes of platform.lock):
-- runbook_artifacts_bundle_uniq_idx makes a second bundle of one run impossible, so two
-- concurrent bundle jobs cannot both insert one. Never "fix" it with @@unique.
--
-- No backfill: the table is new. The transaction carries app.rls_bypass as the first statement.
-- =============================================================================

BEGIN;
SELECT set_config('app.rls_bypass', 'on', true);

-- CreateTable
CREATE TABLE "runbook_artifacts" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "run_target_id" UUID,
    "run_step_id" UUID,
    "kind" TEXT NOT NULL,
    "storage_key" VARCHAR(512) NOT NULL,
    "file_count" INTEGER NOT NULL DEFAULT 0,
    "size_bytes" BIGINT NOT NULL DEFAULT 0,
    "sha256" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ,

    CONSTRAINT "runbook_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "runbook_artifacts_run_id_kind_idx" ON "runbook_artifacts"("run_id", "kind");

-- CreateIndex
CREATE INDEX "runbook_artifacts_org_id_idx" ON "runbook_artifacts"("org_id");

-- CreateIndex
CREATE INDEX "runbook_artifacts_run_target_id_idx" ON "runbook_artifacts"("run_target_id");

-- CreateIndex
CREATE INDEX "runbook_artifacts_run_step_id_idx" ON "runbook_artifacts"("run_step_id");

-- CreateIndex
CREATE INDEX "runbook_artifacts_expires_at_idx" ON "runbook_artifacts"("expires_at");

-- AddForeignKey
ALTER TABLE "runbook_artifacts" ADD CONSTRAINT "runbook_artifacts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runbook_artifacts" ADD CONSTRAINT "runbook_artifacts_run_id_org_id_fkey" FOREIGN KEY ("run_id", "org_id") REFERENCES "runbook_runs"("id", "org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runbook_artifacts" ADD CONSTRAINT "runbook_artifacts_run_target_id_org_id_fkey" FOREIGN KEY ("run_target_id", "org_id") REFERENCES "runbook_run_targets"("id", "org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runbook_artifacts" ADD CONSTRAINT "runbook_artifacts_run_step_id_org_id_fkey" FOREIGN KEY ("run_step_id", "org_id") REFERENCES "runbook_run_steps"("id", "org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CHECK constraint: the allowed kinds.
ALTER TABLE "runbook_artifacts" ADD CONSTRAINT "runbook_artifacts_kind_check"
  CHECK ("kind" IN ('target_archive','bundle'));

-- One bundle per run (partial unique index; Prisma cannot express it).
CREATE UNIQUE INDEX "runbook_artifacts_bundle_uniq_idx" ON "runbook_artifacts"("run_id") WHERE "kind" = 'bundle';

-- Row-level security, as in 0025_org_scoped_rls.
ALTER TABLE "runbook_artifacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "runbook_artifacts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "runbook_artifacts_org_isolation" ON "runbook_artifacts"
  USING      ("org_id" = NULLIF(current_setting('app.org_id', true), '')::uuid
              OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("org_id" = NULLIF(current_setting('app.org_id', true), '')::uuid
              OR current_setting('app.rls_bypass', true) = 'on');

COMMIT;
