-- =============================================================================
-- Runbook safety (issue #67): dry runs, destructive-run confirmation and the two-person approval
-- =============================================================================
--
-- Three columns on `runbook_runs`:
--   dry_run      a rehearsal: connects, probes, executes nothing that changes a server
--   destructive  the definition had a destructive step when the run was launched
--   error_code   why a run that never started ended (APPROVAL_REJECTED, APPROVAL_EXPIRED, CANCELLED)
--
-- `runbook_approvals.kind` grows to varchar(16) and its CHECK gains `destructive_run`: the approval a
-- destructive run waits on before its start job is enqueued. `runbook_command_executions.origin` gains
-- `dry_run` (a read-only probe of a dry run), so the audit trail tells a probe from a command.
--
-- No new table and no new policy: the existing `<table>_org_isolation` policies keep covering these rows.
-- The transaction carries app.rls_bypass as the rules for org tables require.
-- =============================================================================

BEGIN;
SELECT set_config('app.rls_bypass', 'on', true);

ALTER TABLE "runbook_approvals" ALTER COLUMN "kind" SET DATA TYPE VARCHAR(16);

ALTER TABLE "runbook_runs"
  ADD COLUMN "dry_run" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "destructive" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "error_code" VARCHAR(64);

ALTER TABLE "runbook_approvals" DROP CONSTRAINT "runbook_approvals_kind_check";
ALTER TABLE "runbook_approvals" ADD CONSTRAINT "runbook_approvals_kind_check"
  CHECK ("kind" IN ('step','gate','destructive_run'));

ALTER TABLE "runbook_command_executions" DROP CONSTRAINT "runbook_command_executions_origin_check";
ALTER TABLE "runbook_command_executions" ADD CONSTRAINT "runbook_command_executions_origin_check"
  CHECK ("origin" IN ('step','ai_agent','dry_run'));

COMMIT;
