// =============================================================================
// The runbook audit trail (issue #67)
// =============================================================================
//
// Two reads over what the engine already records, never a second copy:
//
//   per run   `trail(principal, runId)`: one chronological list of the run's lifecycle events (created,
//             destructive confirmation, started, approvals requested and decided, cancel requested,
//             finished) and EVERY `runbook_command_executions` row of the run (server, who started it, who
//             approved it, origin, redacted preview, sha256, exit code, timings, outcome).
//             `exportRows` streams the same rows in batches (CSV or JSON), so a run of thousands of
//             commands is never held in one string.
//   org-wide  `commands(principal, query)`: "what ran on server X last week", across all runs, newest first,
//             paginated; only runs the caller may see (they started it, or may read its runbook).
//
// WHAT A ROW CARRIES: the command's sha256 and its redacted, 2 KiB preview (written by the executor with
// the run's secret values redacted); NEVER the command text or any output. The sha256 lets an auditor match
// an exact command without the engine keeping a secret.
//
// LIFECYCLE EVENTS come from the run's own rows (created, started, cancel requested, finished, approvals),
// plus the `audit_events` the engine wrote after commit (`runbook_run.destructive_confirmed`,
// `runbook_run.target_cancelled`). A run with no `audit_events` still has its lifecycle.
// =============================================================================

import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { runInOrg, type Principal } from '@marinoscar/platform-api/core';
import type { Prisma } from '@prisma/client';

import type { OwnerScope } from '../../common/types/owner-scope';
import { PrismaService } from '../../prisma/prisma.service';
import type { OrgTx } from '../engine/run-coordinator.service';
import { RunbookRunsService } from '../engine/runbook-runs.service';
import { RunbooksService } from '../runbooks.service';
import { csvRow } from './audit-csv';

export interface AuditEntry {
  /** ISO timestamp. */
  at: string;
  kind: 'event' | 'command';
  /** For an event: `run.created`, `run.started`, `approval.requested`, ... Null for a command. */
  event: string | null;
  /** Who did it: the person behind the event, or the person who started the run for a command. */
  userId: string | null;
  approverUserId: string | null;
  serverProfileId: string | null;
  serverName: string | null;
  stepIndex: number | null;
  stepName: string | null;
  origin: string | null;
  commandPreview: string | null;
  commandSha256: string | null;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean | null;
  durationMs: number | null;
  outcome: string | null;
  /** A short, non-secret note (a status, a count, an error code). */
  detail: string | null;
  dryRun: boolean;
}

export interface CommandEntry extends AuditEntry {
  id: string;
  runId: string;
  runbookId: string;
  runbookName: string;
}

export const AUDIT_COLUMNS = [
  'at', 'kind', 'event', 'userId', 'approverUserId', 'serverProfileId', 'serverName', 'stepIndex', 'stepName', 'origin',
  'commandPreview', 'commandSha256', 'exitCode', 'signal', 'timedOut', 'durationMs', 'outcome', 'detail', 'dryRun',
] as const satisfies ReadonlyArray<keyof AuditEntry>;

export interface CommandsQuery {
  serverId?: string | undefined;
  userId?: string | undefined;
  runId?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  page: number;
  pageSize: number;
}

const BATCH = 500;

const blank = (): Omit<AuditEntry, 'at' | 'kind' | 'dryRun'> => ({
  event: null, userId: null, approverUserId: null, serverProfileId: null, serverName: null, stepIndex: null, stepName: null, origin: null,
  commandPreview: null, commandSha256: null, exitCode: null, signal: null, timedOut: null, durationMs: null, outcome: null, detail: null,
});

const outcomeOf = (row: { finishedAt: Date | null; timedOut: boolean; signal: string | null; exitCode: number | null }): string => {
  if (!row.finishedAt) return 'unknown';
  if (row.timedOut) return 'timed_out';
  if (row.signal) return 'killed';
  if (row.exitCode === null) return 'unknown';
  return row.exitCode === 0 ? 'succeeded' : 'failed';
};

const COMMAND_INCLUDE = {
  step: {
    select: {
      stepIndex: true,
      name: true,
      runId: true,
      target: { select: { serverName: true } },
      run: { select: { initiatedBy: true, dryRun: true, runbookId: true, runbook: { select: { name: true } } } },
    },
  },
} satisfies Prisma.RunbookCommandExecutionInclude;
type CommandRow = Prisma.RunbookCommandExecutionGetPayload<{ include: typeof COMMAND_INCLUDE }>;

@Injectable()
export class RunbookAuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runs: RunbookRunsService,
    private readonly runbooks: RunbooksService,
  ) {}

  private scopeOf(principal: Principal): OwnerScope {
    if (!principal.activeOrgId) throw new ForbiddenException('No active organization');
    return { userId: principal.userId, orgId: principal.activeOrgId };
  }

  // ---------------------------------------------------------------------------
  // One run
  // ---------------------------------------------------------------------------

  /** 404 unless the caller may read the run (checked before an export streams its first byte). */
  assertVisible(principal: Principal, runId: string): Promise<void> {
    return this.runs.requireVisible(principal, runId);
  }

  /** The chronological trail of one run: events and commands merged; `page` slices it. */
  async trail(principal: Principal, runId: string, page: { page: number; pageSize: number }) {
    await this.runs.requireVisible(principal, runId);
    const scope = this.scopeOf(principal);
    const { events, approver } = await this.loadEvents(scope, runId);
    const commands: AuditEntry[] = [];
    await this.eachCommandBatch(scope, runId, async (rows) => {
      for (const row of rows) commands.push(this.commandEntry(row, approver(row.startedAt)));
    });
    const all = this.merge(events, commands);
    return {
      items: all.slice((page.page - 1) * page.pageSize, page.page * page.pageSize),
      total: all.length,
      events: events.length,
      commands: commands.length,
      page: page.page,
      pageSize: page.pageSize,
    };
  }

  /** The same rows as `trail`, in order, as an async stream of entries (commands are read in batches). */
  async *exportRows(principal: Principal, runId: string): AsyncGenerator<AuditEntry> {
    await this.runs.requireVisible(principal, runId);
    const scope = this.scopeOf(principal);
    const { events, approver } = await this.loadEvents(scope, runId);
    let next = 0;
    let after: { startedAt: Date; id: string } | null = null;
    for (;;) {
      const rows = await runInOrg(this.prisma, scope, (tx) => this.commandPage(tx, scope.orgId, { step: { runId } }, after));
      if (rows.length === 0) break;
      for (const row of rows) {
        const entry = this.commandEntry(row, approver(row.startedAt));
        while (next < events.length && events[next]!.at <= entry.at) yield events[next++]!;
        yield entry;
      }
      const last = rows[rows.length - 1]!;
      after = { startedAt: last.startedAt, id: last.id };
      if (rows.length < BATCH) break;
    }
    while (next < events.length) yield events[next++]!;
  }

  /** The export as a byte stream of chunks: CSV (RFC 4180, formula-safe) or one JSON array. */
  async *exportChunks(principal: Principal, runId: string, format: 'csv' | 'json'): AsyncGenerator<string> {
    if (format === 'csv') {
      yield csvRow(AUDIT_COLUMNS);
      for await (const entry of this.exportRows(principal, runId)) yield csvRow(AUDIT_COLUMNS.map((c) => entry[c]));
      return;
    }
    yield '[';
    let first = true;
    for await (const entry of this.exportRows(principal, runId)) {
      yield `${first ? '' : ','}\n${JSON.stringify(entry)}`;
      first = false;
    }
    yield '\n]\n';
  }

  private async loadEvents(scope: OwnerScope, runId: string): Promise<{ events: AuditEntry[]; approver: (at: Date) => string | null }> {
    const data = await runInOrg(this.prisma, scope, async (tx) => {
      const run = await tx.runbookRun.findFirst({ where: { id: runId, orgId: scope.orgId }, include: { runbook: { select: { name: true } } } });
      if (!run) throw new NotFoundException('Run not found');
      const approvals = await tx.runbookApproval.findMany({ where: { runId, orgId: scope.orgId }, orderBy: { createdAt: 'asc' } });
      return { run, approvals };
    });
    const { run, approvals } = data;
    const recorded = await this.prisma.auditEvent.findMany({
      where: {
        OR: [
          { targetType: 'runbook_run', targetId: runId, action: { in: ['runbook_run.destructive_confirmed', 'runbook_run.target_cancelled', 'runbook_run.cancelled'] } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      select: { action: true, actorUserId: true, createdAt: true, meta: true },
    });

    const events: AuditEntry[] = [];
    const push = (at: Date, event: string, userId: string | null, detail: string | null, extra: Partial<AuditEntry> = {}): void => {
      events.push({ ...blank(), at: at.toISOString(), kind: 'event', event, userId, detail, dryRun: run.dryRun, ...extra });
    };

    push(run.createdAt, 'run.created', run.initiatedBy, `${run.runbook.name} v${run.version}; trigger ${run.trigger}${run.dryRun ? '; dry run' : ''}${run.destructive ? '; destructive' : ''}`);
    for (const row of recorded) {
      if (row.action === 'runbook_run.destructive_confirmed') push(row.createdAt, 'run.destructive_confirmed', row.actorUserId, 'The runbook name and the server count were confirmed');
      if (row.action === 'runbook_run.target_cancelled') push(row.createdAt, 'target.cancelled', row.actorUserId, null);
    }
    if (run.startedAt) push(run.startedAt, 'run.started', run.initiatedBy, null);
    if (run.cancelRequestedAt) {
      const by = recorded.find((r) => r.action === 'runbook_run.cancelled')?.actorUserId ?? null;
      push(run.cancelRequestedAt, 'run.cancel_requested', by, null);
    }
    for (const approval of approvals) {
      const what = `${approval.kind === 'destructive_run' ? 'destructive run' : approval.kind === 'gate' ? 'canary check' : approval.stepName}`;
      push(approval.createdAt, 'approval.requested', run.initiatedBy, what);
      if (approval.decidedAt) push(approval.decidedAt, 'approval.decided', approval.decidedBy, `${approval.status}: ${what}`);
    }
    if (run.finishedAt) push(run.finishedAt, 'run.finished', null, `${run.status}${run.errorCode ? `; ${run.errorCode}` : ''}`);
    events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

    // The approver of a command: the destructive-run approval covers the whole run; otherwise the latest
    // approved step or canary decision made before the command started.
    const destructive = approvals.find((a) => a.kind === 'destructive_run' && a.status === 'approved');
    const approved = approvals.filter((a) => a.status === 'approved' && a.decidedAt && a.decidedBy).sort((a, b) => a.decidedAt!.getTime() - b.decidedAt!.getTime());
    const approver = (at: Date): string | null => {
      if (destructive?.decidedBy) return destructive.decidedBy;
      let found: string | null = null;
      for (const a of approved) if (a.decidedAt! <= at) found = a.decidedBy;
      return found;
    };
    return { events, approver };
  }

  private async eachCommandBatch(scope: OwnerScope, runId: string, handle: (rows: CommandRow[]) => Promise<void>): Promise<void> {
    let after: { startedAt: Date; id: string } | null = null;
    for (;;) {
      const rows = await runInOrg(this.prisma, scope, (tx) => this.commandPage(tx, scope.orgId, { step: { runId } }, after));
      if (rows.length === 0) return;
      await handle(rows);
      if (rows.length < BATCH) return;
      const last = rows[rows.length - 1]!;
      after = { startedAt: last.startedAt, id: last.id };
    }
  }

  /** One batch, oldest first, after a `(startedAt, id)` cursor. */
  private commandPage(tx: OrgTx, orgId: string, where: Prisma.RunbookCommandExecutionWhereInput, after: { startedAt: Date; id: string } | null): Promise<CommandRow[]> {
    return tx.runbookCommandExecution.findMany({
      where: {
        orgId,
        ...where,
        ...(after ? { OR: [{ startedAt: { gt: after.startedAt } }, { startedAt: after.startedAt, id: { gt: after.id } }] } : {}),
      },
      orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
      take: BATCH,
      include: COMMAND_INCLUDE,
    });
  }

  private commandEntry(row: CommandRow, approverUserId: string | null): AuditEntry {
    return {
      ...blank(),
      at: row.startedAt.toISOString(),
      kind: 'command',
      userId: row.step?.run.initiatedBy ?? null,
      approverUserId,
      serverProfileId: row.serverProfileId,
      serverName: row.step?.target.serverName ?? null,
      stepIndex: row.step?.stepIndex ?? null,
      stepName: row.step?.name ?? null,
      origin: row.origin,
      commandPreview: row.commandPreview,
      commandSha256: row.commandSha256,
      exitCode: row.exitCode,
      signal: row.signal,
      timedOut: row.timedOut,
      durationMs: row.finishedAt ? row.finishedAt.getTime() - row.startedAt.getTime() : null,
      outcome: outcomeOf(row),
      dryRun: row.step?.run.dryRun ?? false,
    };
  }

  private merge(events: AuditEntry[], commands: AuditEntry[]): AuditEntry[] {
    // Stable: at equal times an event precedes the commands it caused.
    return [...events, ...commands].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.kind === b.kind ? 0 : a.kind === 'event' ? -1 : 1));
  }

  // ---------------------------------------------------------------------------
  // Org-wide
  // ---------------------------------------------------------------------------

  /** Commands across all runs the caller may see, newest first. */
  async commands(principal: Principal, query: CommandsQuery) {
    const scope = this.scopeOf(principal);
    return runInOrg(this.prisma, scope, async (tx) => {
      const readable = await this.runbooks.readableWhere(tx, principal);
      const where: Prisma.RunbookCommandExecutionWhereInput = {
        orgId: scope.orgId,
        step: {
          run: {
            OR: [{ initiatedBy: principal.userId }, { runbook: readable }],
            ...(query.userId ? { initiatedBy: query.userId } : {}),
            ...(query.runId ? { id: query.runId } : {}),
          },
        },
        ...(query.serverId ? { serverProfileId: query.serverId } : {}),
        ...(query.from || query.to ? { startedAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } } : {}),
      };
      const [total, rows] = await Promise.all([
        tx.runbookCommandExecution.count({ where }),
        tx.runbookCommandExecution.findMany({
          where,
          orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          include: COMMAND_INCLUDE,
        }),
      ]);
      const items: CommandEntry[] = rows.map((row) => ({
        ...this.commandEntry(row, null),
        id: row.id,
        runId: row.step?.runId ?? '',
        runbookId: row.step?.run.runbookId ?? '',
        runbookName: row.step?.run.runbook.name ?? '',
      }));
      return { items, total, page: query.page, pageSize: query.pageSize };
    });
  }
}
