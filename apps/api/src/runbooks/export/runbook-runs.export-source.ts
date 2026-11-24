// =============================================================================
// The `runbook-runs` export source (issues #68, #62)
// =============================================================================
//
// What it exports: the REQUESTER'S OWN runs (the runs they started) created in the date range, and per
// run its targets, steps, approvals and command-execution METADATA: status, timings, exit codes,
// counts and ids. The dataset is five tables: `runbook_runs`, `runbook_run_targets`, `runbook_run_steps`,
// `runbook_approvals`, `runbook_command_executions`.
//
// What it never exports (each is simply absent from its allowlist, so it is never even read):
//   - run `params`, `secretRefs`, `targetSelector` and `strategy` (parameter values may be sensitive);
//   - a step's `outputTail`, `aiTranscript`, `aiSummary` and `logStorageKey` (command output may hold
//     secrets; logs stay behind the run's own routes);
//   - a command execution's `commandPreview` (only its `commandSha256`), and an approval's `message`,
//     `comment` and `payload` (AI approvals carry the command);
//   - a target's host, user and host-key fingerprint, and its `errorMessage` (free text).
// Run artifacts (#63) are storage objects, not data: they are not exported, and no storage key or object id
// appears in any table.
//
// Rules the implementation keeps:
//   - read through `ctx.db` (the export's bypass client, which spans organizations) with an explicit
//     owner filter on EVERY table (`run.initiatedBy = ctx.subjectId`, through the run relation for the
//     child tables), and never write. This is narrower than the Runs list (which also shows runs of
//     runbooks shared with the caller): an export is a person's own record;
//   - the columns are allowlists and `select` lists exactly them (`pagedRows`, `columnsOf`);
//   - `from` and `to` (inclusive days) are cut in `ctx.timeZone` with `zonedDayStart` on the run's
//     `createdAt`; `runbookId` narrows to one runbook. Children follow their run's filter.
// =============================================================================

import { zonedDayStart, type ExportContext, type ExportSource, type ExportTable } from '@marinoscar/platform-api/exports';
import { z } from 'zod';

import { columnsOf, pagedRows } from '../../platform/exports/export-paging';
import { RUNBOOK_PERMISSIONS } from '../../app-registrations/permissions';
import { nextDay } from '../../terminal/export/terminal-sessions.export-source';

export const RUNBOOK_RUNS_EXPORT_SOURCE_ID = 'runbook-runs';

export const runbookRunsExportRequestSchema = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
    runbookId: z.uuid().optional(),
  })
  .strict()
  .refine((req) => req.from <= req.to, { message: '`from` must not be after `to`', path: ['to'] });
export type RunbookRunsExportRequest = z.infer<typeof runbookRunsExportRequestSchema>;

/** The exclusive end day of the request's range, for the `createdAt < end` bound. */
export const runbookRunsRangeEndDay = (req: RunbookRunsExportRequest): string => nextDay(req.to);

/** The only columns that leave the server, per table. */
export const RUNBOOK_RUN_EXPORT_COLUMNS = columnsOf([
  ['id', 'Id', 'string'],
  ['runbookId', 'Runbook id', 'string'],
  ['version', 'Version', 'number'],
  ['status', 'Status', 'string'],
  ['trigger', 'Trigger', 'string'],
  ['retryOfRunId', 'Retry of run id', 'string'],
  ['dryRun', 'Dry run', 'boolean'],
  ['destructive', 'Destructive', 'boolean'],
  ['errorCode', 'Error code', 'string'],
  ['startedAt', 'Started at', 'datetime'],
  ['finishedAt', 'Finished at', 'datetime'],
  ['createdAt', 'Created at', 'datetime'],
]);

export const RUNBOOK_RUN_TARGET_EXPORT_COLUMNS = columnsOf([
  ['id', 'Id', 'string'],
  ['runId', 'Run id', 'string'],
  ['serverProfileId', 'Server profile id', 'string'],
  ['serverName', 'Server name', 'string'],
  ['position', 'Position', 'number'],
  ['batchIndex', 'Batch', 'number'],
  ['status', 'Status', 'string'],
  ['errorCode', 'Error code', 'string'],
  ['startedAt', 'Started at', 'datetime'],
  ['finishedAt', 'Finished at', 'datetime'],
  ['createdAt', 'Created at', 'datetime'],
]);

export const RUNBOOK_RUN_STEP_EXPORT_COLUMNS = columnsOf([
  ['id', 'Id', 'string'],
  ['runId', 'Run id', 'string'],
  ['runTargetId', 'Run target id', 'string'],
  ['stepIndex', 'Step index', 'number'],
  ['stepId', 'Step', 'string'],
  ['kind', 'Kind', 'string'],
  ['name', 'Name', 'string'],
  ['status', 'Status', 'string'],
  ['exitCode', 'Exit code', 'number'],
  ['durationMs', 'Duration (ms)', 'number'],
  ['logBytes', 'Log bytes', 'number'],
  ['logTruncated', 'Log truncated', 'boolean'],
  ['errorCode', 'Error code', 'string'],
  ['startedAt', 'Started at', 'datetime'],
  ['finishedAt', 'Finished at', 'datetime'],
  ['createdAt', 'Created at', 'datetime'],
]);

export const RUNBOOK_APPROVAL_EXPORT_COLUMNS = columnsOf([
  ['id', 'Id', 'string'],
  ['runId', 'Run id', 'string'],
  ['runTargetId', 'Run target id', 'string'],
  ['scope', 'Scope', 'string'],
  ['kind', 'Kind', 'string'],
  ['stepIndex', 'Step index', 'number'],
  ['stepName', 'Step name', 'string'],
  ['status', 'Status', 'string'],
  ['expiresAt', 'Expires at', 'datetime'],
  ['decidedBy', 'Decided by', 'string'],
  ['decidedAt', 'Decided at', 'datetime'],
  ['createdAt', 'Created at', 'datetime'],
]);

export const RUNBOOK_COMMAND_EXECUTION_EXPORT_COLUMNS = columnsOf([
  ['id', 'Id', 'string'],
  ['runStepId', 'Run step id', 'string'],
  ['serverProfileId', 'Server profile id', 'string'],
  ['origin', 'Origin', 'string'],
  ['commandSha256', 'Command SHA-256', 'string'],
  ['exitCode', 'Exit code', 'number'],
  ['signal', 'Signal', 'string'],
  ['timedOut', 'Timed out', 'boolean'],
  ['bytes', 'Output bytes', 'number'],
  ['outcome', 'Outcome', 'string'],
  ['approvedBy', 'Approved by', 'string'],
  ['startedAt', 'Started at', 'datetime'],
  ['finishedAt', 'Finished at', 'datetime'],
]);

/** The run filter every table carries: the requester's own runs, created in the range, optionally of one runbook. */
export function runbookRunsWhere(ctx: ExportContext, req: RunbookRunsExportRequest): Record<string, unknown> {
  return {
    initiatedBy: ctx.subjectId,
    createdAt: { gte: zonedDayStart(req.from, ctx.timeZone), lt: zonedDayStart(runbookRunsRangeEndDay(req), ctx.timeZone) },
    ...(req.runbookId ? { runbookId: req.runbookId } : {}),
  };
}

/** The run datasets: runs, targets, steps, approvals and command-execution metadata. */
export async function* runbookRunTables(ctx: ExportContext, req: RunbookRunsExportRequest): AsyncGenerator<ExportTable> {
  const run = runbookRunsWhere(ctx, req);
  yield {
    dataset: 'runbook_runs',
    title: 'Runbook runs',
    columns: RUNBOOK_RUN_EXPORT_COLUMNS,
    rows: pagedRows(ctx, ctx.db.runbookRun, run, RUNBOOK_RUN_EXPORT_COLUMNS),
  };
  yield {
    dataset: 'runbook_run_targets',
    title: 'Run targets',
    columns: RUNBOOK_RUN_TARGET_EXPORT_COLUMNS,
    rows: pagedRows(ctx, ctx.db.runbookRunTarget, { run }, RUNBOOK_RUN_TARGET_EXPORT_COLUMNS),
  };
  yield {
    dataset: 'runbook_run_steps',
    title: 'Run steps',
    columns: RUNBOOK_RUN_STEP_EXPORT_COLUMNS,
    rows: pagedRows(ctx, ctx.db.runbookRunStep, { run }, RUNBOOK_RUN_STEP_EXPORT_COLUMNS),
  };
  yield {
    dataset: 'runbook_approvals',
    title: 'Run approvals',
    columns: RUNBOOK_APPROVAL_EXPORT_COLUMNS,
    rows: pagedRows(ctx, ctx.db.runbookApproval, { run }, RUNBOOK_APPROVAL_EXPORT_COLUMNS),
  };
  yield {
    dataset: 'runbook_command_executions',
    title: 'Run commands',
    columns: RUNBOOK_COMMAND_EXECUTION_EXPORT_COLUMNS,
    rows: pagedRows(ctx, ctx.db.runbookCommandExecution, { step: { run } }, RUNBOOK_COMMAND_EXECUTION_EXPORT_COLUMNS),
  };
}

export const RUNBOOK_RUNS_EXPORT_SOURCE: ExportSource<RunbookRunsExportRequest> = {
  id: RUNBOOK_RUNS_EXPORT_SOURCE_ID,
  scope: 'user',
  label: 'Runbook runs',
  description:
    'Your runbook runs in a date range: run, target, step, approval and command metadata (status, timings, exit codes, command hashes). Parameters, logs and command text are never exported.',
  permission: RUNBOOK_PERMISSIONS.RUNBOOKS_READ.id,
  requestSchema: runbookRunsExportRequestSchema,
  formats: ['json', 'csv', 'xlsx'],
  columnTypes: ['string', 'number', 'boolean', 'datetime'],
  collect: (ctx, req) => runbookRunTables(ctx, req),
};
