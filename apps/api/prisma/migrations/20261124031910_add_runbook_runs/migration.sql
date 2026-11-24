-- =============================================================================
-- Runbook runs: the execution engine's tables (#62)
-- =============================================================================
--
-- Six org-owned tables, each with a NOT NULL org_id and a FORCEd
-- <table>_org_isolation policy copied from 0025_org_scoped_rls:
--
--   runbook_runs                a run of one runbook version over a set of servers
--   runbook_run_targets         one server of a run (a snapshot of its connection facts)
--   runbook_run_steps           one step on one target: status, exit code, output tail
--   runbook_run_log_chunks      the live output buffer; moved to object storage when a step ends
--   runbook_command_executions  one row per command sent over SSH (hash and redacted preview)
--   runbook_approvals           approval gates and the canary pause
--
-- ORG CONSISTENCY. Every link between two of these tables, and to runbooks, is a
-- COMPOSITE foreign key that includes org_id (a foreign-key check bypasses
-- row-level security). A run reaches its version through (runbook_id, version).
--
-- STATUS COLUMNS are text with a CHECK constraint listing the allowed values, so a new
-- status is a migration, never a silent string.
--
-- No backfill: the tables are new. The transaction carries app.rls_bypass as the
-- first statement, as every migration that touches an org table does.
-- =============================================================================

BEGIN;
SELECT set_config('app.rls_bypass', 'on', true);

-- CreateTable
CREATE TABLE "runbook_runs" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "runbook_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "trigger" TEXT NOT NULL DEFAULT 'manual',
    "initiated_by" UUID,
    "retry_of_run_id" UUID,
    "params" JSONB NOT NULL DEFAULT '{}',
    "secret_refs" JSONB NOT NULL DEFAULT '{}',
    "target_selector" JSONB NOT NULL,
    "strategy" JSONB NOT NULL,
    "cancel_requested_at" TIMESTAMPTZ,
    "started_at" TIMESTAMPTZ,
    "finished_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "runbook_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "runbook_run_targets" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "server_profile_id" UUID,
    "position" INTEGER NOT NULL,
    "batch_index" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "server_name" VARCHAR(255) NOT NULL,
    "hostname" VARCHAR(255) NOT NULL,
    "port" INTEGER NOT NULL,
    "username" VARCHAR(255) NOT NULL,
    "host_key_fingerprint" VARCHAR(255),
    "next_step_index" INTEGER NOT NULL DEFAULT 0,
    "error_code" VARCHAR(64),
    "error_message" VARCHAR(500),
    "cancel_requested_at" TIMESTAMPTZ,
    "started_at" TIMESTAMPTZ,
    "finished_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "runbook_run_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "runbook_run_steps" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "run_target_id" UUID NOT NULL,
    "step_index" INTEGER NOT NULL,
    "step_id" VARCHAR(48) NOT NULL,
    "kind" VARCHAR(32) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "exit_code" INTEGER,
    "duration_ms" INTEGER,
    "output_tail" TEXT,
    "log_bytes" INTEGER NOT NULL DEFAULT 0,
    "log_truncated" BOOLEAN NOT NULL DEFAULT false,
    "log_storage_key" VARCHAR(512),
    "error_code" VARCHAR(64),
    "started_at" TIMESTAMPTZ,
    "finished_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "runbook_run_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "runbook_run_log_chunks" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "run_step_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "ord" BIGSERIAL NOT NULL,
    "stream" VARCHAR(8) NOT NULL,
    "data" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "runbook_run_log_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "runbook_command_executions" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "server_profile_id" UUID,
    "run_step_id" UUID,
    "origin" VARCHAR(16) NOT NULL,
    "command_sha256" CHAR(64) NOT NULL,
    "command_preview" TEXT NOT NULL,
    "exit_code" INTEGER,
    "signal" VARCHAR(16),
    "timed_out" BOOLEAN NOT NULL DEFAULT false,
    "bytes" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ,

    CONSTRAINT "runbook_command_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "runbook_approvals" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "run_target_id" UUID,
    "scope_key" VARCHAR(36) NOT NULL,
    "scope" VARCHAR(8) NOT NULL,
    "kind" VARCHAR(8) NOT NULL,
    "step_index" INTEGER NOT NULL,
    "step_name" VARCHAR(120) NOT NULL,
    "message" VARCHAR(2000) NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMPTZ NOT NULL,
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ,
    "comment" VARCHAR(1000),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "runbook_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "runbook_runs_org_id_created_at_idx" ON "runbook_runs"("org_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "runbook_runs_org_id_status_idx" ON "runbook_runs"("org_id", "status");

-- CreateIndex
CREATE INDEX "runbook_runs_runbook_id_idx" ON "runbook_runs"("runbook_id");

-- CreateIndex
CREATE INDEX "runbook_runs_initiated_by_idx" ON "runbook_runs"("initiated_by");

-- CreateIndex
CREATE UNIQUE INDEX "runbook_runs_id_org_id_key" ON "runbook_runs"("id", "org_id");

-- CreateIndex
CREATE INDEX "runbook_run_targets_run_id_status_idx" ON "runbook_run_targets"("run_id", "status");

-- CreateIndex
CREATE INDEX "runbook_run_targets_org_id_idx" ON "runbook_run_targets"("org_id");

-- CreateIndex
CREATE INDEX "runbook_run_targets_server_profile_id_idx" ON "runbook_run_targets"("server_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "runbook_run_targets_id_org_id_key" ON "runbook_run_targets"("id", "org_id");

-- CreateIndex
CREATE UNIQUE INDEX "runbook_run_targets_run_id_position_key" ON "runbook_run_targets"("run_id", "position");

-- CreateIndex
CREATE INDEX "runbook_run_steps_run_id_idx" ON "runbook_run_steps"("run_id");

-- CreateIndex
CREATE INDEX "runbook_run_steps_org_id_idx" ON "runbook_run_steps"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "runbook_run_steps_id_org_id_key" ON "runbook_run_steps"("id", "org_id");

-- CreateIndex
CREATE UNIQUE INDEX "runbook_run_steps_run_target_id_step_index_key" ON "runbook_run_steps"("run_target_id", "step_index");

-- CreateIndex
CREATE UNIQUE INDEX "runbook_run_log_chunks_ord_key" ON "runbook_run_log_chunks"("ord");

-- CreateIndex
CREATE INDEX "runbook_run_log_chunks_run_id_ord_idx" ON "runbook_run_log_chunks"("run_id", "ord");

-- CreateIndex
CREATE INDEX "runbook_run_log_chunks_org_id_idx" ON "runbook_run_log_chunks"("org_id");

-- CreateIndex
CREATE INDEX "runbook_run_log_chunks_created_at_idx" ON "runbook_run_log_chunks"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "runbook_run_log_chunks_run_step_id_seq_key" ON "runbook_run_log_chunks"("run_step_id", "seq");

-- CreateIndex
CREATE INDEX "runbook_command_executions_org_id_server_profile_id_started_idx" ON "runbook_command_executions"("org_id", "server_profile_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "runbook_command_executions_run_step_id_idx" ON "runbook_command_executions"("run_step_id");

-- CreateIndex
CREATE INDEX "runbook_command_executions_server_profile_id_idx" ON "runbook_command_executions"("server_profile_id");

-- CreateIndex
CREATE INDEX "runbook_approvals_org_id_status_expires_at_idx" ON "runbook_approvals"("org_id", "status", "expires_at");

-- CreateIndex
CREATE INDEX "runbook_approvals_run_id_idx" ON "runbook_approvals"("run_id");

-- CreateIndex
CREATE INDEX "runbook_approvals_decided_by_idx" ON "runbook_approvals"("decided_by");

-- CreateIndex
CREATE UNIQUE INDEX "runbook_approvals_run_id_step_index_scope_key_key" ON "runbook_approvals"("run_id", "step_index", "scope_key");

-- AddForeignKey
ALTER TABLE "runbook_runs" ADD CONSTRAINT "runbook_runs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runbook_runs" ADD CONSTRAINT "runbook_runs_runbook_id_org_id_fkey" FOREIGN KEY ("runbook_id", "org_id") REFERENCES "runbooks"("id", "org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runbook_runs" ADD CONSTRAINT "runbook_runs_runbook_id_version_fkey" FOREIGN KEY ("runbook_id", "version") REFERENCES "runbook_versions"("runbook_id", "version") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runbook_runs" ADD CONSTRAINT "runbook_runs_initiated_by_fkey" FOREIGN KEY ("initiated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runbook_run_targets" ADD CONSTRAINT "runbook_run_targets_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runbook_run_targets" ADD CONSTRAINT "runbook_run_targets_run_id_org_id_fkey" FOREIGN KEY ("run_id", "org_id") REFERENCES "runbook_runs"("id", "org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runbook_run_steps" ADD CONSTRAINT "runbook_run_steps_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runbook_run_steps" ADD CONSTRAINT "runbook_run_steps_run_id_org_id_fkey" FOREIGN KEY ("run_id", "org_id") REFERENCES "runbook_runs"("id", "org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runbook_run_steps" ADD CONSTRAINT "runbook_run_steps_run_target_id_org_id_fkey" FOREIGN KEY ("run_target_id", "org_id") REFERENCES "runbook_run_targets"("id", "org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runbook_run_log_chunks" ADD CONSTRAINT "runbook_run_log_chunks_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runbook_run_log_chunks" ADD CONSTRAINT "runbook_run_log_chunks_run_id_org_id_fkey" FOREIGN KEY ("run_id", "org_id") REFERENCES "runbook_runs"("id", "org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runbook_run_log_chunks" ADD CONSTRAINT "runbook_run_log_chunks_run_step_id_org_id_fkey" FOREIGN KEY ("run_step_id", "org_id") REFERENCES "runbook_run_steps"("id", "org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runbook_command_executions" ADD CONSTRAINT "runbook_command_executions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runbook_command_executions" ADD CONSTRAINT "runbook_command_executions_run_step_id_org_id_fkey" FOREIGN KEY ("run_step_id", "org_id") REFERENCES "runbook_run_steps"("id", "org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runbook_approvals" ADD CONSTRAINT "runbook_approvals_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runbook_approvals" ADD CONSTRAINT "runbook_approvals_run_id_org_id_fkey" FOREIGN KEY ("run_id", "org_id") REFERENCES "runbook_runs"("id", "org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runbook_approvals" ADD CONSTRAINT "runbook_approvals_run_target_id_org_id_fkey" FOREIGN KEY ("run_target_id", "org_id") REFERENCES "runbook_run_targets"("id", "org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runbook_approvals" ADD CONSTRAINT "runbook_approvals_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =============================================================================
-- CHECK constraints: the allowed values of every status-like column.
-- =============================================================================

ALTER TABLE "runbook_runs" ADD CONSTRAINT "runbook_runs_status_check"
  CHECK ("status" IN ('queued','resolving','running','paused','cancelling','succeeded','failed','partially_failed','aborted','cancelled'));
ALTER TABLE "runbook_runs" ADD CONSTRAINT "runbook_runs_trigger_check"
  CHECK ("trigger" IN ('manual','api','schedule'));
ALTER TABLE "runbook_run_targets" ADD CONSTRAINT "runbook_run_targets_status_check"
  CHECK ("status" IN ('pending','queued','running','waiting','succeeded','failed','skipped','cancelled'));
ALTER TABLE "runbook_run_steps" ADD CONSTRAINT "runbook_run_steps_status_check"
  CHECK ("status" IN ('pending','running','waiting_approval','succeeded','failed','skipped','timed_out','cancelled'));
ALTER TABLE "runbook_run_log_chunks" ADD CONSTRAINT "runbook_run_log_chunks_stream_check"
  CHECK ("stream" IN ('stdout','stderr','system'));
ALTER TABLE "runbook_command_executions" ADD CONSTRAINT "runbook_command_executions_origin_check"
  CHECK ("origin" IN ('step','ai_agent'));
ALTER TABLE "runbook_approvals" ADD CONSTRAINT "runbook_approvals_status_check"
  CHECK ("status" IN ('pending','approved','rejected','expired'));
ALTER TABLE "runbook_approvals" ADD CONSTRAINT "runbook_approvals_kind_check"
  CHECK ("kind" IN ('step','gate'));
ALTER TABLE "runbook_approvals" ADD CONSTRAINT "runbook_approvals_scope_check"
  CHECK ("scope" IN ('run','target'));

-- =============================================================================
-- Row-level security, as in 0025_org_scoped_rls. The policy names are listed
-- under rlsPolicies in platform.lock and asserted against pg_policies by the
-- drift test. NULLIF(..., '') because current_setting(name, true) is the empty
-- string on a connection that ever held a transaction-local value.
-- =============================================================================

ALTER TABLE "runbook_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "runbook_runs" FORCE ROW LEVEL SECURITY;
CREATE POLICY "runbook_runs_org_isolation" ON "runbook_runs"
  USING      ("org_id" = NULLIF(current_setting('app.org_id', true), '')::uuid
              OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("org_id" = NULLIF(current_setting('app.org_id', true), '')::uuid
              OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "runbook_run_targets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "runbook_run_targets" FORCE ROW LEVEL SECURITY;
CREATE POLICY "runbook_run_targets_org_isolation" ON "runbook_run_targets"
  USING      ("org_id" = NULLIF(current_setting('app.org_id', true), '')::uuid
              OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("org_id" = NULLIF(current_setting('app.org_id', true), '')::uuid
              OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "runbook_run_steps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "runbook_run_steps" FORCE ROW LEVEL SECURITY;
CREATE POLICY "runbook_run_steps_org_isolation" ON "runbook_run_steps"
  USING      ("org_id" = NULLIF(current_setting('app.org_id', true), '')::uuid
              OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("org_id" = NULLIF(current_setting('app.org_id', true), '')::uuid
              OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "runbook_run_log_chunks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "runbook_run_log_chunks" FORCE ROW LEVEL SECURITY;
CREATE POLICY "runbook_run_log_chunks_org_isolation" ON "runbook_run_log_chunks"
  USING      ("org_id" = NULLIF(current_setting('app.org_id', true), '')::uuid
              OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("org_id" = NULLIF(current_setting('app.org_id', true), '')::uuid
              OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "runbook_command_executions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "runbook_command_executions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "runbook_command_executions_org_isolation" ON "runbook_command_executions"
  USING      ("org_id" = NULLIF(current_setting('app.org_id', true), '')::uuid
              OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("org_id" = NULLIF(current_setting('app.org_id', true), '')::uuid
              OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "runbook_approvals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "runbook_approvals" FORCE ROW LEVEL SECURITY;
CREATE POLICY "runbook_approvals_org_isolation" ON "runbook_approvals"
  USING      ("org_id" = NULLIF(current_setting('app.org_id', true), '')::uuid
              OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("org_id" = NULLIF(current_setting('app.org_id', true), '')::uuid
              OR current_setting('app.rls_bypass', true) = 'on');

COMMIT;
