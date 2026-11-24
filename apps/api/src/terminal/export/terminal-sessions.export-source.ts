// =============================================================================
// The `terminal-sessions` export source (issue #68)
// =============================================================================
//
// METADATA ONLY: name, status, the tmux session name, size, the server profile id and the
// timestamps of a user's own sessions in a date range. The tmux scrollback (and any session log or
// history snapshot) is NEVER read: it may hold secrets typed into the terminal. The columns are an
// allowlist and the query's `select` lists exactly them.
//
// The range is by the creation day, in the requester's time zone (`ctx.timeZone`), both days
// inclusive.
// =============================================================================

import { SessionStatus } from '@prisma/client';
import { zonedDayStart, type ExportContext, type ExportSource, type ExportTable } from '@marinoscar/platform-api/exports';
import { z } from 'zod';

import { columnsOf, pagedRows } from '../../platform/exports/export-paging';
import { APP_PERMISSION_IDS } from '../../app-registrations/permissions';

export const TERMINAL_SESSIONS_EXPORT_SOURCE_ID = 'terminal-sessions';

/** The only columns that leave the server. */
export const TERMINAL_SESSION_EXPORT_COLUMNS = columnsOf([
  ['id', 'Id', 'string'],
  ['serverProfileId', 'Server profile id', 'string'],
  ['name', 'Name', 'string'],
  ['status', 'Status', 'string'],
  ['tmuxSessionId', 'Tmux session', 'string'],
  ['cols', 'Columns', 'number'],
  ['rows', 'Rows', 'number'],
  ['lastActivityAt', 'Last activity at', 'datetime'],
  ['terminatedAt', 'Terminated at', 'datetime'],
  ['createdAt', 'Created at', 'datetime'],
  ['updatedAt', 'Updated at', 'datetime'],
]);

const STATUSES = Object.values(SessionStatus) as [SessionStatus, ...SessionStatus[]];

export const terminalSessionsExportRequestSchema = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
    status: z.enum(STATUSES).optional(),
  })
  .strict()
  .refine((req) => req.from <= req.to, { message: '`from` must not be after `to`', path: ['to'] });
export type TerminalSessionsExportRequest = z.infer<typeof terminalSessionsExportRequestSchema>;

/** The day after an ISO date (`YYYY-MM-DD`). */
export function nextDay(day: string): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

async function* collect(ctx: ExportContext, req: TerminalSessionsExportRequest): AsyncGenerator<ExportTable> {
  const where: Record<string, unknown> = {
    userId: ctx.subjectId,
    createdAt: { gte: zonedDayStart(req.from, ctx.timeZone), lt: zonedDayStart(nextDay(req.to), ctx.timeZone) },
    ...(req.status ? { status: req.status } : {}),
  };
  yield {
    dataset: 'terminal_sessions',
    title: 'Terminal sessions',
    columns: TERMINAL_SESSION_EXPORT_COLUMNS,
    rows: pagedRows(ctx, ctx.db.terminalSession, where, TERMINAL_SESSION_EXPORT_COLUMNS),
  };
}

export const TERMINAL_SESSIONS_EXPORT_SOURCE: ExportSource<TerminalSessionsExportRequest> = {
  id: TERMINAL_SESSIONS_EXPORT_SOURCE_ID,
  scope: 'user',
  label: 'Terminal sessions',
  description:
    'Metadata of your terminal sessions in a date range (name, status, server, size, timestamps). Terminal content is never exported.',
  permission: APP_PERMISSION_IDS.SESSIONS_READ,
  requestSchema: terminalSessionsExportRequestSchema,
  formats: ['json', 'csv', 'xlsx'],
  columnTypes: ['string', 'number', 'datetime'],
  collect,
};
