// =============================================================================
// The `runbook-runs` export source (issue #68)
// =============================================================================
//
// What it WILL export (the contract #62 fills in): per run, its target and step status, timings,
// exit codes and the ARTIFACT OBJECT IDS of its logs. It never exports log contents (command
// output may hold secrets; the log bundle of #63 handles those), step output as rows, a secret
// parameter or a resolved command line.
//
// WHY IT EXPORTS NOTHING YET. The run tables (runs, run targets, run steps) arrive with the run
// engine (#62); until then there is nothing to read. The source is registered now so the sources
// route, the permission (`runbooks:read`), the request shape (`from`, `to`, `runbookId`) and the
// dialog are final, and so #62 only has to fill `runbookRunTables`.
//
// EXTENSION POINT for #62: implement `runbookRunTables` below. Rules that implementation keeps:
//   - read through `ctx.db` with an explicit owner filter (`ctx.subjectId`, the requester's own
//     runs) and never write;
//   - list the exported columns as an ALLOWLIST and `select` exactly them (`pagedRows` and
//     `columnsOf` from `platform/exports/export-paging.ts` do both), so no log or output column is
//     ever read;
//   - export storage object ids only, never object bytes or signed URLs;
//   - cut `from` and `to` (inclusive days) in `ctx.timeZone` with `zonedDayStart`, as the
//     terminal-sessions source does, and filter on `runbookId` when given;
//   - extend `runbook-runs.export-source.spec.ts` and the db spec with the new tables' sentinels.
// =============================================================================

import type { ExportContext, ExportSource, ExportTable } from '@marinoscar/platform-api/exports';
import { z } from 'zod';

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

/** The exclusive end day of the request's range, for the `createdAt < end` bound (#62 uses it). */
export const runbookRunsRangeEndDay = (req: RunbookRunsExportRequest): string => nextDay(req.to);

/**
 * The run datasets. EXTENSION POINT (#62): yield one `ExportTable` per run table, from an
 * allowlist of non-secret columns. Yields nothing until the run tables exist.
 */
// eslint-disable-next-line require-yield
export async function* runbookRunTables(_ctx: ExportContext, _req: RunbookRunsExportRequest): AsyncGenerator<ExportTable> {
  return;
}

export const RUNBOOK_RUNS_EXPORT_SOURCE: ExportSource<RunbookRunsExportRequest> = {
  id: RUNBOOK_RUNS_EXPORT_SOURCE_ID,
  scope: 'user',
  label: 'Runbook runs',
  description:
    'Your runbook runs in a date range: run, target and step status, timings, exit codes and log artifact ids. Log contents are never exported.',
  permission: RUNBOOK_PERMISSIONS.RUNBOOKS_READ.id,
  requestSchema: runbookRunsExportRequestSchema,
  formats: ['json', 'csv', 'xlsx'],
  columnTypes: ['string', 'number', 'boolean', 'datetime'],
  collect: (ctx, req) => runbookRunTables(ctx, req),
};
