// =============================================================================
// The runs half of the Home dashboard (issues #78, #62)
// =============================================================================
//
// Binds `DASHBOARD_RUNS_SOURCE` (`dashboard/dashboard-runs.source.ts`). ONE `runInOrg` transaction and a
// fixed number of queries, whatever the number of runs: two COUNTs, one `LIMIT` read with the runbook
// name joined in, and one grouped COUNT of the targets of the listed runs (no N+1).
//
// Visibility is the Runs list's rule (`RunbookRunsService.list`): the caller started the run, or may read
// its runbook (`RunbooksService.readableWhere`: owned, owned by a group of theirs, shared with them). The
// two tiles count what the page they link to lists:
//   - `running`      runs with status `running`            (`/runs?status=running`)
//   - `failedLast24h` runs with status `failed` queued at or after `failedSince` (`/runs?status=failed&since=24h`;
//                     the list's `since` cuts `created_at`, so the tile and the list agree)
// The `runbooks:read` gate stays in `DashboardService`. No parameter, secret or log is read.
// =============================================================================

import { ForbiddenException, Injectable } from '@nestjs/common';
import { runInOrg, type Principal } from '@marinoscar/platform-api/core';
import type { Prisma } from '@prisma/client';

import type { DashboardRunsQuery, DashboardRunsSource } from '../../dashboard/dashboard-runs.source';
import type { DashboardRuns } from '../../dashboard/dashboard.schema';
import { PrismaService } from '../../prisma/prisma.service';
import { RunbooksService } from '../runbooks.service';
import { targetCountsOf } from './run-target-counts';

@Injectable()
export class RunsDashboardSource implements DashboardRunsSource {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runbooks: RunbooksService,
  ) {}

  async summarize(principal: Principal, query: DashboardRunsQuery): Promise<DashboardRuns> {
    const orgId = principal.activeOrgId;
    if (!orgId) throw new ForbiddenException('No active organization');
    return runInOrg(this.prisma, { userId: principal.userId, orgId }, async (tx) => {
      const readable = await this.runbooks.readableWhere(tx, principal);
      const visible: Prisma.RunbookRunWhereInput = { orgId, OR: [{ initiatedBy: principal.userId }, { runbook: readable }] };

      const running = await tx.runbookRun.count({ where: { AND: [visible, { status: 'running' }] } });
      const failedLast24h = await tx.runbookRun.count({
        where: { AND: [visible, { status: 'failed', createdAt: { gte: query.failedSince } }] },
      });
      const rows = await tx.runbookRun.findMany({
        where: visible,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: query.limit,
        select: { id: true, runbookId: true, status: true, startedAt: true, runbook: { select: { name: true } } },
      });
      const grouped = rows.length
        ? await tx.runbookRunTarget.groupBy({
            by: ['runId', 'status'],
            where: { orgId, runId: { in: rows.map((r) => r.id) } },
            _count: { _all: true },
          })
        : [];
      return {
        running,
        failedLast24h,
        recent: rows.map((row) => ({
          id: row.id,
          runbookId: row.runbookId,
          runbookName: row.runbook.name,
          status: row.status,
          targets: targetCountsOf(grouped, row.id),
          startedAt: row.startedAt ? row.startedAt.toISOString() : null,
        })),
      };
    });
  }
}
