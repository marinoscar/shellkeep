// =============================================================================
// The runbook run API error codes (issue #62)
// =============================================================================

import { registerErrorCode } from '@marinoscar/platform-api/core';

export const RUNBOOK_RUN_ERROR_CODES = {
  /** 503: `runbooks.enabled` is off. */
  DISABLED: 'RUNBOOKS_DISABLED',
  /** 422: a parameter value failed the definition (type, required, enum, pattern). */
  PARAMS_INVALID: 'RUNBOOK_PARAMS_INVALID',
  /** 422: a `secretRefs` name does not exist in the organization's runbook secrets. */
  SECRET_REF_UNKNOWN: 'RUNBOOK_SECRET_REF_UNKNOWN',
  /** 422: the selector resolved to no server the caller may run on. */
  NO_TARGETS: 'RUNBOOK_NO_TARGETS',
  /** 403: the person who started a run may not approve it. */
  SELF_APPROVAL: 'RUNBOOK_SELF_APPROVAL',
  /** 409: the approval was already decided or expired. */
  APPROVAL_NOT_PENDING: 'RUNBOOK_APPROVAL_NOT_PENDING',
  /** 409: the run is not in a state that allows this action. */
  RUN_STATE: 'RUNBOOK_RUN_STATE',
  /** 428: the runbook has a destructive step and the launch carried no (or a wrong) confirmation (#67). */
  CONFIRMATION_REQUIRED: 'RUNBOOK_CONFIRMATION_REQUIRED',
} as const;

let registered = false;

export function registerRunbookRunErrorCodes(): void {
  if (registered) return;
  registered = true;
  registerErrorCode({ code: RUNBOOK_RUN_ERROR_CODES.DISABLED, status: 503, description: 'Runbooks are switched off (system setting runbooks.enabled).' });
  registerErrorCode({
    code: RUNBOOK_RUN_ERROR_CODES.PARAMS_INVALID,
    status: 422,
    description: 'A run parameter failed the definition; `details.issues` lists each problem.',
  });
  registerErrorCode({
    code: RUNBOOK_RUN_ERROR_CODES.SECRET_REF_UNKNOWN,
    status: 422,
    description: 'A secret reference names a runbook secret that does not exist.',
  });
  registerErrorCode({
    code: RUNBOOK_RUN_ERROR_CODES.NO_TARGETS,
    status: 422,
    description: 'The target selection resolved to no server this run may use.',
  });
  registerErrorCode({
    code: RUNBOOK_RUN_ERROR_CODES.SELF_APPROVAL,
    status: 403,
    description: 'The person who started a run cannot approve it (runbooks.approvals.allowSelfApproval is off).',
  });
  registerErrorCode({
    code: RUNBOOK_RUN_ERROR_CODES.APPROVAL_NOT_PENDING,
    status: 409,
    description: 'The approval was already decided or has expired.',
  });
  registerErrorCode({
    code: RUNBOOK_RUN_ERROR_CODES.RUN_STATE,
    status: 409,
    description: 'The run is not in a state that allows this action.',
  });
  registerErrorCode({
    code: RUNBOOK_RUN_ERROR_CODES.CONFIRMATION_REQUIRED,
    status: 428,
    description:
      'The runbook has a destructive step: repeat the launch with `confirm: { runbookName, targetCount }` naming the runbook exactly and the number of servers the run resolves to. `details` carries the findings and that count.',
  });
}
