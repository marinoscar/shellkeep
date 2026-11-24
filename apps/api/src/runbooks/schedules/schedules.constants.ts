// =============================================================================
// The runbook schedules' permanent names (issue #66)
// =============================================================================
//
// THE JOB TYPE STRING IS PERMANENT once jobs of that type exist (pinned by `test/jobs/job-type-snapshot.spec.ts`).
// The failure reasons are stored on `runbook_schedules.disabled_reason` and shown by the UI: never rename one.
// =============================================================================

/** The system job a cron queues every minute; the handler fires the schedules that are due. */
export const RUNBOOK_SCHEDULES_TICK_TYPE = 'runbook.schedules.tick';

/** The system access reason of the tick (ids take hyphens, never dots). Registered by `runbooks.registrations.ts`. */
export const RUNBOOKS_SCHEDULES_REASON = 'runbooks-schedules';

/** The most schedules one tick fires; the rest are picked up by the next tick a minute later. */
export const TICK_BATCH = 100;

/** The overlap policies. `skip`: no new run while the previous one is active. `queue` and `allow`: always create the run. */
export const OVERLAP_POLICIES = ['skip', 'queue', 'allow'] as const;
export type OverlapPolicy = (typeof OVERLAP_POLICIES)[number];

/** Why the system switched a schedule off. */
export const SCHEDULE_DISABLED_REASONS = {
  /** The person it runs as is gone, disabled, or no longer holds `runbooks:run`, `servers:read` or access to the runbook. */
  PERMISSION_REVOKED: 'PERMISSION_REVOKED',
  /** A destructive version has no approval (a new version under `latest`, or an edit of targets or parameters). */
  APPROVAL_REQUIRED: 'APPROVAL_REQUIRED',
  RUNBOOK_ARCHIVED: 'RUNBOOK_ARCHIVED',
  /** The pinned version no longer exists. */
  VERSION_MISSING: 'VERSION_MISSING',
  /** The run was refused at creation (parameters, a secret, the targets no longer valid). */
  RUN_REJECTED: 'RUN_REJECTED',
} as const;
export type ScheduleDisabledReason = (typeof SCHEDULE_DISABLED_REASONS)[keyof typeof SCHEDULE_DISABLED_REASONS];

/** The `outcome` label of the `app.runbooks.schedule_fires` counter. */
export const SCHEDULE_FIRE_OUTCOMES = ['fired', 'skipped_overlap', 'disabled', 'failed'] as const;
export type ScheduleFireOutcome = (typeof SCHEDULE_FIRE_OUTCOMES)[number];
