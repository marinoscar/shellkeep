// =============================================================================
// The runbook schedule API error codes (issue #66)
// =============================================================================

import { registerErrorCode } from '@marinoscar/platform-api/core';

export const RUNBOOK_SCHEDULE_ERROR_CODES = {
  /** 422: the cron expression, the time zone, the version pin or the parameters are not valid. */
  INVALID: 'RUNBOOK_SCHEDULE_INVALID',
  /** 409: the schedule is of a destructive runbook version that nobody has approved. */
  APPROVAL_REQUIRED: 'RUNBOOK_SCHEDULE_APPROVAL_REQUIRED',
  /** 409: the schedule's previous run is still active and its overlap policy is `skip`. */
  OVERLAP: 'RUNBOOK_SCHEDULE_OVERLAP',
  /** 403: the person a schedule runs as may not approve it (runbooks.approvals.allowSelfApproval is off). */
  SELF_APPROVAL: 'RUNBOOK_SCHEDULE_SELF_APPROVAL',
} as const;

let registered = false;

export function registerRunbookScheduleErrorCodes(): void {
  if (registered) return;
  registered = true;
  registerErrorCode({
    code: RUNBOOK_SCHEDULE_ERROR_CODES.INVALID,
    status: 422,
    description: 'A schedule field is not valid (cron expression, time zone, version pin, parameters); `details` names the field.',
  });
  registerErrorCode({
    code: RUNBOOK_SCHEDULE_ERROR_CODES.APPROVAL_REQUIRED,
    status: 409,
    description:
      'The schedule is of a destructive runbook version that has no approval: someone with runbooks:approve must approve the schedule before it can be enabled or run.',
  });
  registerErrorCode({
    code: RUNBOOK_SCHEDULE_ERROR_CODES.OVERLAP,
    status: 409,
    description: 'The previous run of this schedule is still active and its overlap policy is `skip`.',
  });
  registerErrorCode({
    code: RUNBOOK_SCHEDULE_ERROR_CODES.SELF_APPROVAL,
    status: 403,
    description: 'The person a schedule runs as cannot approve it (runbooks.approvals.allowSelfApproval is off).',
  });
}
