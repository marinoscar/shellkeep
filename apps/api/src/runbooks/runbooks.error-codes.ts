// =============================================================================
// The runbook error codes (issue #61)
// =============================================================================
//
// Registered with the platform's error-code registry at import time (before the
// registry freezes at bootstrap). The filter passes a code through only for an
// exception of the registered status.
// =============================================================================

import { registerErrorCode } from '@marinoscar/platform-api/core';

export const RUNBOOK_ERROR_CODES = {
  /** 422: the definition failed the schema; `details.issues` carries the Zod issue paths. */
  DEFINITION_INVALID: 'RUNBOOK_DEFINITION_INVALID',
  /** 422: the selector names `groupIds` and server groups do not exist yet (#71). */
  TARGET_GROUPS_UNAVAILABLE: 'RUNBOOK_TARGET_GROUPS_UNAVAILABLE',
  /** 409: another live runbook in the organization has this name (case-insensitive). */
  NAME_TAKEN: 'RUNBOOK_NAME_TAKEN',
  /** 409: the runbook is archived; restore it first. */
  ARCHIVED: 'RUNBOOK_ARCHIVED',
  /** 409: the runbook has a run that has not finished; cancel it or wait before deleting the runbook. */
  HAS_ACTIVE_RUNS: 'RUNBOOK_HAS_ACTIVE_RUNS',
  /** 428: a definition PUT without `If-Match`. */
  IF_MATCH_REQUIRED: 'RUNBOOK_IF_MATCH_REQUIRED',
} as const;

let registered = false;

export function registerRunbookErrorCodes(): void {
  if (registered) return;
  registered = true;
  registerErrorCode({
    code: RUNBOOK_ERROR_CODES.DEFINITION_INVALID,
    status: 422,
    description: 'The runbook definition is not valid; `details.issues` lists each problem with its path.',
  });
  registerErrorCode({
    code: RUNBOOK_ERROR_CODES.TARGET_GROUPS_UNAVAILABLE,
    status: 422,
    description: 'The target selector names server groups, which are not available yet.',
  });
  registerErrorCode({
    code: RUNBOOK_ERROR_CODES.NAME_TAKEN,
    status: 409,
    description: 'Another runbook in the organization already has this name.',
  });
  registerErrorCode({
    code: RUNBOOK_ERROR_CODES.ARCHIVED,
    status: 409,
    description: 'The runbook is archived; restore it before changing it.',
  });
  registerErrorCode({
    code: RUNBOOK_ERROR_CODES.HAS_ACTIVE_RUNS,
    status: 409,
    description: 'The runbook has a run that has not finished, so it cannot be deleted yet.',
  });
  registerErrorCode({
    code: RUNBOOK_ERROR_CODES.IF_MATCH_REQUIRED,
    status: 428,
    description: 'Changing a definition needs an `If-Match` header carrying the version being replaced.',
  });
}
