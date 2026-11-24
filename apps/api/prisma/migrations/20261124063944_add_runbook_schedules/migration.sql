-- =============================================================================
-- Runbook schedules (#66)
-- =============================================================================
--
-- runbook_schedules: a recurring run of one runbook (cron + IANA time zone), run as its
-- creator. An org table: NOT NULL org_id, forced <table>_org_isolation policy copied from
-- 0025_org_scoped_rls, and a COMPOSITE foreign key (runbook_id, org_id) to runbooks.
--
-- runbook_runs.schedule_id names the schedule that fired a run. It is a composite key
-- (schedule_id, org_id) with NO ACTION: a column-list SET NULL would also null org_id,
-- so deleting a schedule nulls its runs' schedule_id first (the service does, in one
-- transaction). A NULL schedule_id skips the check (MATCH SIMPLE).
--
-- No backfill: the table is new. The transaction carries app.rls_bypass as the first
-- statement, as every migration that touches an org table does.
-- =============================================================================

BEGIN;
SELECT set_config('app.rls_bypass', 'on', true);

-- AlterTable
ALTER TABLE "runbook_runs" ADD COLUMN     "schedule_id" UUID;

-- CreateTable
CREATE TABLE "runbook_schedules" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "runbook_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "cron" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "version_pin" TEXT NOT NULL DEFAULT 'latest',
    "params" JSONB NOT NULL DEFAULT '{}',
    "secret_refs" JSONB NOT NULL DEFAULT '{}',
    "target_selector" JSONB NOT NULL,
    "strategy" JSONB,
    "overlap" TEXT NOT NULL DEFAULT 'skip',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "next_run_at" TIMESTAMPTZ,
    "last_run_id" UUID,
    "last_fired_at" TIMESTAMPTZ,
    "run_as_user_id" UUID,
    "disabled_reason" VARCHAR(64),
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ,
    "approved_version" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "runbook_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "runbook_schedules_enabled_next_run_at_idx" ON "runbook_schedules"("enabled", "next_run_at");

-- CreateIndex
CREATE INDEX "runbook_schedules_org_id_idx" ON "runbook_schedules"("org_id");

-- CreateIndex
CREATE INDEX "runbook_schedules_runbook_id_idx" ON "runbook_schedules"("runbook_id");

-- CreateIndex
CREATE INDEX "runbook_schedules_run_as_user_id_idx" ON "runbook_schedules"("run_as_user_id");

-- CreateIndex
CREATE INDEX "runbook_schedules_approved_by_idx" ON "runbook_schedules"("approved_by");

-- CreateIndex
CREATE UNIQUE INDEX "runbook_schedules_id_org_id_key" ON "runbook_schedules"("id", "org_id");

-- CreateIndex
CREATE INDEX "runbook_runs_schedule_id_idx" ON "runbook_runs"("schedule_id");

-- AddForeignKey
ALTER TABLE "runbook_runs" ADD CONSTRAINT "runbook_runs_schedule_id_org_id_fkey" FOREIGN KEY ("schedule_id", "org_id") REFERENCES "runbook_schedules"("id", "org_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runbook_schedules" ADD CONSTRAINT "runbook_schedules_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runbook_schedules" ADD CONSTRAINT "runbook_schedules_runbook_id_org_id_fkey" FOREIGN KEY ("runbook_id", "org_id") REFERENCES "runbooks"("id", "org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runbook_schedules" ADD CONSTRAINT "runbook_schedules_run_as_user_id_fkey" FOREIGN KEY ("run_as_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runbook_schedules" ADD CONSTRAINT "runbook_schedules_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =============================================================================
-- CHECK constraints
-- =============================================================================

ALTER TABLE "runbook_schedules" ADD CONSTRAINT "runbook_schedules_overlap_check"
  CHECK ("overlap" IN ('skip','queue','allow'));

-- =============================================================================
-- Row-level security, as in 0025_org_scoped_rls (policy listed under rlsPolicies in platform.lock).
-- =============================================================================

ALTER TABLE "runbook_schedules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "runbook_schedules" FORCE ROW LEVEL SECURITY;
CREATE POLICY "runbook_schedules_org_isolation" ON "runbook_schedules"
  USING      ("org_id" = NULLIF(current_setting('app.org_id', true), '')::uuid
              OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("org_id" = NULLIF(current_setting('app.org_id', true), '')::uuid
              OR current_setting('app.rls_bypass', true) = 'on');

COMMIT;
