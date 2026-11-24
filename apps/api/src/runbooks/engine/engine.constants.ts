// =============================================================================
// The runbook engine's permanent names (issue #62)
// =============================================================================
//
// JOB TYPE STRINGS ARE PERMANENT once jobs of that type exist (the snapshot in
// `test/jobs/job-type-snapshot.spec.ts` pins them). The bus channels and failure
// codes are persisted or relayed to browsers: never rename one.
// =============================================================================

/** Resolves the targets of a queued run, snapshots them and starts the first wave. */
export const RUNBOOK_RUN_START_TYPE = 'runbook.run.start';
/** Runs one segment of a run on one target over one SSH connection. SERVER-ONLY. */
export const RUNBOOK_TARGET_RUN_TYPE = 'runbook.target.run';
/** Advances the dispatch of one run (the coordinator). */
export const RUNBOOK_RUN_ADVANCE_TYPE = 'runbook.run.advance';
/** The reconcile sweep (system job): stuck runs, lost executors, expired approvals, orphan log chunks. */
export const RUNBOOK_LOGS_COMPACT_TYPE = 'runbook.logs.compact';

/** The `jobs.reason` of every run job. Registered in `app-registrations/jobs.ts`. */
export const RUNBOOK_JOB_REASON = 'runbook_run';

export const RUNBOOK_RUN_SUBJECT = 'runbook_run';
export const RUNBOOK_RUN_TARGET_SUBJECT = 'runbook_run_target';

/** The system access reason of the reconcile job (registered by `runbooks.registrations.ts`; ids take hyphens, never dots). */
export const RUNBOOKS_RECONCILE_REASON = 'runbooks-reconcile';

/** EVENT_BUS channels. The payloads stay under the 7,500-byte envelope. */
export const RUNBOOK_RUN_CHANNEL = 'runbooks.run';
export const RUNBOOK_CANCEL_CHANNEL = 'runbooks.cancel';

/** In-process event (EventEmitter2) emitted AFTER the commit that finished a run; consumed by #63 and #66. */
export const RUNBOOK_RUN_FINISHED_INTERNAL_EVENT = 'runbooks.run.finished';

/** The approval step index of a canary pause (a real step index is never negative). */
export const CANARY_STEP_INDEX = -1;

/** How long a cancel takes to reach a running segment at most (a poll; the bus message is faster). */
export const CANCEL_POLL_MS = 2_000;

/** Output kept on the step row for the matrix. */
export const OUTPUT_TAIL_BYTES = 4_096;
/** One log chunk, UTF-8 safe. */
export const LOG_CHUNK_BYTES = 4_096;
/** `command_preview` cap. */
export const COMMAND_PREVIEW_BYTES = 2_048;
/** The largest file a `file_upload` step sends. */
export const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;

/** Orphan log chunks (no live segment writing them) are moved to storage after this long. */
export const ORPHAN_CHUNK_AGE_MS = 60 * 60 * 1000;

/** The codes stored on a failed target or step (`error_code`). Not HTTP codes. */
export const FAILURE_CODES = {
  PERMISSION_REVOKED: 'PERMISSION_REVOKED',
  HOST_KEY_UNKNOWN: 'HOST_KEY_UNKNOWN',
  HOST_KEY_MISMATCH: 'HOST_KEY_MISMATCH',
  SSH_UNREACHABLE: 'SSH_UNREACHABLE',
  SSH_AUTH_FAILED: 'SSH_AUTH_FAILED',
  PACKAGE_MANAGER_UNKNOWN: 'PACKAGE_MANAGER_UNKNOWN',
  UNSUPPORTED_OPTION: 'UNSUPPORTED_OPTION',
  DEST_EXISTS: 'DEST_EXISTS',
  STEP_KIND_NOT_AVAILABLE: 'STEP_KIND_NOT_AVAILABLE',
  EXECUTOR_LOST: 'EXECUTOR_LOST',
  APPROVAL_REJECTED: 'APPROVAL_REJECTED',
  APPROVAL_EXPIRED: 'APPROVAL_EXPIRED',
  SUDO_PASSWORD_REQUIRED: 'SUDO_PASSWORD_REQUIRED',
  STEP_FAILED: 'STEP_FAILED',
  STEP_TIMED_OUT: 'STEP_TIMED_OUT',
  CANCELLED: 'CANCELLED',
  SECRET_UNAVAILABLE: 'SECRET_UNAVAILABLE',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  UPLOAD_CHECKSUM_MISMATCH: 'UPLOAD_CHECKSUM_MISMATCH',
  FORBIDDEN: 'FORBIDDEN',
  INTERNAL: 'INTERNAL',
} as const;
export type FailureCode = (typeof FAILURE_CODES)[keyof typeof FAILURE_CODES];
