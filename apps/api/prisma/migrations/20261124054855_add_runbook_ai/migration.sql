-- =============================================================================
-- The AI-executed runbook step (issue #64)
-- =============================================================================
--
--   runbook_runs.ai_stop_requested_at       "Stop AI": the agents of the run end before their next tool call
--   runbook_run_steps.ai_transcript         the redacted conversation of an `ai_task` step, kept while it waits for an approval
--   runbook_run_steps.ai_summary            the model's closing summary of the step (redacted, capped)
--   runbook_approvals.payload               what an AI approval asks for (the redacted command and reason, or the plan)
--   runbook_approvals.kind                  gains `ai_command` and `ai_plan`
--   runbook_command_executions.outcome      how an AI agent command ended (`refused`: the policy said no, nothing ran)
--   runbook_command_executions.approved_by  the person who approved an AI agent command (a plain id: the audit row outlives the user)
--
-- Every new column is nullable, so a rollback leaves them unused. No new table and no new policy: the existing
-- `<table>_org_isolation` policies keep covering these rows. The transaction carries app.rls_bypass as the rules
-- for org tables require.
-- =============================================================================

BEGIN;
SELECT set_config('app.rls_bypass', 'on', true);

ALTER TABLE "runbook_runs" ADD COLUMN "ai_stop_requested_at" TIMESTAMPTZ;

ALTER TABLE "runbook_run_steps"
  ADD COLUMN "ai_transcript" JSONB,
  ADD COLUMN "ai_summary" TEXT;

ALTER TABLE "runbook_approvals" ADD COLUMN "payload" JSONB;

ALTER TABLE "runbook_command_executions"
  ADD COLUMN "outcome" VARCHAR(16),
  ADD COLUMN "approved_by" UUID;

ALTER TABLE "runbook_approvals" DROP CONSTRAINT "runbook_approvals_kind_check";
ALTER TABLE "runbook_approvals" ADD CONSTRAINT "runbook_approvals_kind_check"
  CHECK ("kind" IN ('step','gate','destructive_run','ai_command','ai_plan'));

ALTER TABLE "runbook_command_executions" ADD CONSTRAINT "runbook_command_executions_outcome_check"
  CHECK ("outcome" IS NULL OR "outcome" IN ('succeeded','failed','timed_out','cancelled','refused'));

COMMIT;
