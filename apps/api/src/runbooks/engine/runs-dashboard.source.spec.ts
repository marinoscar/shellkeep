import { ForbiddenException } from '@nestjs/common';

import { targetCountsOf } from './run-target-counts';
import { RunsDashboardSource } from './runs-dashboard.source';

// `runInOrg` is the platform's transaction helper; here it hands the fake transaction to the callback.
jest.mock('@marinoscar/platform-api/core', () => ({
  ...jest.requireActual('@marinoscar/platform-api/core'),
  runInOrg: (_client: unknown, _scope: unknown, fn: (tx: unknown) => unknown) => fn((global as any).__tx),
}));

const principal = (activeOrgId: string | null = 'org-1') =>
  ({ kind: 'user', userId: 'user-1', permissions: ['runbooks:read'], activeOrgId }) as never;

describe('RunsDashboardSource', () => {
  const READABLE = { id: { in: ['rb-1'] } };
  let tx: any;
  let source: RunsDashboardSource;
  const readableWhere = jest.fn();
  const query = { failedSince: new Date('2026-11-23T12:00:00.000Z'), limit: 5 };

  beforeEach(() => {
    tx = {
      runbookRun: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
      runbookRunTarget: { groupBy: jest.fn().mockResolvedValue([]) },
    };
    (global as any).__tx = tx;
    readableWhere.mockResolvedValue(READABLE);
    source = new RunsDashboardSource({} as never, { readableWhere } as never);
  });

  it('refuses a caller with no active organization', async () => {
    await expect(source.summarize(principal(null), query)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('answers zeros and no rows, and never reads targets, for a caller who sees no run', async () => {
    await expect(source.summarize(principal(), query)).resolves.toEqual({ running: 0, failedLast24h: 0, recent: [] });
    expect(tx.runbookRunTarget.groupBy).not.toHaveBeenCalled();
  });

  it('counts over the runs the caller started or may read, in their organization', async () => {
    await source.summarize(principal(), query);
    const visible = { orgId: 'org-1', OR: [{ initiatedBy: 'user-1' }, { runbook: READABLE }] };
    expect(tx.runbookRun.count).toHaveBeenNthCalledWith(1, { where: { AND: [visible, { status: 'running' }] } });
    expect(tx.runbookRun.count).toHaveBeenNthCalledWith(2, {
      where: { AND: [visible, { status: 'failed', createdAt: { gte: query.failedSince } }] },
    });
    expect(tx.runbookRun.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: visible, take: 5 }));
  });

  it('shapes the recent runs with the target split from ONE grouped query (no N+1)', async () => {
    tx.runbookRun.count.mockResolvedValueOnce(2).mockResolvedValueOnce(1);
    tx.runbookRun.findMany.mockResolvedValue([
      { id: 'r1', runbookId: 'rb-1', status: 'running', startedAt: new Date('2026-11-24T10:00:00.000Z'), runbook: { name: 'Patch' } },
      { id: 'r2', runbookId: 'rb-2', status: 'queued', startedAt: null, runbook: { name: 'Rotate' } },
    ]);
    tx.runbookRunTarget.groupBy.mockResolvedValue([
      { runId: 'r1', status: 'succeeded', _count: { _all: 2 } },
      { runId: 'r1', status: 'failed', _count: { _all: 1 } },
      { runId: 'r1', status: 'running', _count: { _all: 1 } },
    ]);
    const result = await source.summarize(principal(), query);
    expect(result).toEqual({
      running: 2,
      failedLast24h: 1,
      recent: [
        { id: 'r1', runbookId: 'rb-1', runbookName: 'Patch', status: 'running', targets: { total: 4, succeeded: 2, failed: 1, running: 1 }, startedAt: '2026-11-24T10:00:00.000Z' },
        { id: 'r2', runbookId: 'rb-2', runbookName: 'Rotate', status: 'queued', targets: { total: 0, succeeded: 0, failed: 0, running: 0 }, startedAt: null },
      ],
    });
    expect(tx.runbookRunTarget.groupBy).toHaveBeenCalledTimes(1);
    expect(tx.runbookRun.findMany).toHaveBeenCalledTimes(1);
  });
});

describe('targetCountsOf', () => {
  it('counts cancelled as failed and waiting or queued as running, and ignores other runs', () => {
    const grouped = [
      { runId: 'a', status: 'cancelled', _count: { _all: 1 } },
      { runId: 'a', status: 'waiting', _count: { _all: 2 } },
      { runId: 'a', status: 'queued', _count: { _all: 1 } },
      { runId: 'a', status: 'pending', _count: { _all: 3 } },
      { runId: 'b', status: 'succeeded', _count: { _all: 9 } },
    ];
    expect(targetCountsOf(grouped, 'a')).toEqual({ total: 7, succeeded: 0, failed: 1, running: 3 });
  });
});
