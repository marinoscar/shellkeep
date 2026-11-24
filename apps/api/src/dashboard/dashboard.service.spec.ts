import { ForbiddenException } from '@nestjs/common';
import type { Principal } from '@marinoscar/platform-api/core';

import { accessibleListWhere } from '../platform/sharing/sharing-access';
import type { DashboardRunsSource } from './dashboard-runs.source';
import { DASHBOARD_FAILED_WINDOW_MS, DASHBOARD_RECENT_LIMIT } from './dashboard.schema';
import { DashboardService } from './dashboard.service';

// `runInOrg` is the platform's transaction helper; here it hands the fake client to the callback.
const runInOrgCalls: Array<{ userId: string; orgId: string }> = [];
jest.mock('@marinoscar/platform-api/core', () => ({
  ...jest.requireActual('@marinoscar/platform-api/core'),
  runInOrg: (_client: unknown, scope: { userId: string; orgId: string }, fn: (tx: unknown) => unknown) => {
    runInOrgCalls.push(scope);
    return fn((global as any).__dashboardTx);
  },
}));
// The visibility filter is the sharing slice's (proven against a real database in test/dashboard); here it returns a marker.
const VISIBLE = { __visible: true };
jest.mock('../platform/sharing/sharing-access', () => ({
  ...jest.requireActual('../platform/sharing/sharing-access'),
  accessibleListWhere: jest.fn(),
}));

const USER = '11111111-1111-4111-8111-111111111111';
const ORG = '22222222-2222-4222-8222-222222222222';
const PROFILE = '33333333-3333-4333-8333-333333333333';
const ALL = ['sessions:read', 'servers:read', 'runbooks:read'];

const principal = (permissions: string[] = ALL, activeOrgId: string | undefined = ORG): Principal => ({
  kind: 'user',
  userId: USER,
  email: 'person-a@example.test',
  credential: 'session',
  roles: ['contributor'],
  permissions,
  activeOrgId,
});

const sessionRow = (i: number, status: 'active' | 'detached') => ({
  id: `44444444-4444-4444-8444-44444444444${i}`,
  name: `session-${i}`,
  status,
  serverProfileId: PROFILE,
  lastActivityAt: new Date(Date.UTC(2026, 10, 24, 10, i)),
  createdAt: new Date(Date.UTC(2026, 10, 24, 9, i)),
  serverProfile: { name: 'web-01' },
});

describe('DashboardService', () => {
  let tx: {
    serverProfile: { count: jest.Mock };
    terminalSession: { groupBy: jest.Mock; findMany: jest.Mock };
  };
  let enrich: jest.Mock;
  const make = (runs?: DashboardRunsSource) =>
    new DashboardService({} as any, { enrich } as any, runs);

  beforeEach(() => {
    runInOrgCalls.length = 0;
    tx = {
      serverProfile: {
        // 7 visible; 2 untrusted keys, 3 reachable, 1 unreachable (the AND's second member says which).
        count: jest.fn().mockImplementation(async ({ where }) => {
          if (!('AND' in where)) return 7;
          const extra = where.AND[1];
          if ('fingerprint' in extra) return 2;
          return extra.lastTestOk === true ? 3 : 1;
        }),
      },
      terminalSession: {
        groupBy: jest.fn().mockResolvedValue([
          { status: 'active', _count: { _all: 1 } },
          { status: 'detached', _count: { _all: 3 } },
        ]),
        findMany: jest.fn().mockResolvedValue([sessionRow(1, 'active'), sessionRow(2, 'detached')]),
      },
    };
    (global as any).__dashboardTx = tx;
    enrich = jest.fn().mockImplementation(async (p: Principal) => ({ ...p, groupIds: ['g-1'] }));
    (accessibleListWhere as jest.Mock).mockReset().mockResolvedValue(VISIBLE);
  });

  it('counts the servers the caller may see, through the sharing filter, enriched with their groups', async () => {
    const result = await make().summary(principal());

    expect(accessibleListWhere).toHaveBeenCalledTimes(1);
    const options = (accessibleListWhere as jest.Mock).mock.calls[0][0];
    expect(options).toMatchObject({ type: 'server_profile', table: 'server_profiles', filter: 'all' });
    expect(options.principal.groupIds).toEqual(['g-1']);
    expect(tx.serverProfile.count).toHaveBeenCalledWith({ where: VISIBLE });
    expect(tx.serverProfile.count).toHaveBeenCalledWith({ where: { AND: [VISIBLE, { fingerprint: null }] } });
    expect(result.servers).toEqual({ total: 7, reachable: 3, unreachable: 1, unknown: 3, hostKeyUntrusted: 2 });
  });

  it('counts reachability from the stored test outcome, with the Servers page\'s own filter (#79)', async () => {
    await make().summary(principal());
    expect(tx.serverProfile.count).toHaveBeenCalledWith({
      where: { AND: [VISIBLE, { lastTestAt: { not: null }, lastTestOk: true }] },
    });
    expect(tx.serverProfile.count).toHaveBeenCalledWith({
      where: { AND: [VISIBLE, { lastTestAt: { not: null }, lastTestOk: false }] },
    });
  });

  it('answers servers: null without servers:read, and does not query or enrich', async () => {
    const result = await make().summary(principal(['sessions:read', 'runbooks:read']));
    expect(result.servers).toBeNull();
    expect(accessibleListWhere).not.toHaveBeenCalled();
    expect(tx.serverProfile.count).not.toHaveBeenCalled();
    expect(enrich).not.toHaveBeenCalled();
  });

  it("counts only the caller's own live sessions in the request's organization, five at most", async () => {
    const result = await make().summary(principal());

    const where = { userId: USER, orgId: ORG, status: { in: ['active', 'detached'] } };
    expect(tx.terminalSession.groupBy).toHaveBeenCalledWith(expect.objectContaining({ by: ['status'], where }));
    expect(tx.terminalSession.findMany).toHaveBeenCalledTimes(1);
    expect(tx.terminalSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where, take: DASHBOARD_RECENT_LIMIT, orderBy: [{ lastActivityAt: 'desc' }, { id: 'asc' }] }),
    );
    expect(runInOrgCalls).toEqual([{ userId: USER, orgId: ORG }]);
    expect(result.sessions).toMatchObject({ active: 4, attached: 1, detached: 3 });
    expect(result.sessions.recent).toEqual([
      expect.objectContaining({ id: sessionRow(1, 'active').id, status: 'active', serverName: 'web-01', lastActivityAt: '2026-11-24T10:01:00.000Z' }),
      expect.objectContaining({ id: sessionRow(2, 'detached').id, status: 'detached' }),
    ]);
  });

  it('never selects the hostname or a credential column for the session list', async () => {
    await make().summary(principal());
    const { select } = tx.terminalSession.findMany.mock.calls[0][0];
    expect(JSON.stringify(select)).not.toMatch(/hostname|encrypted|password|privateKey/);
  });

  it('runs a fixed number of queries whatever the number of rows (no N+1)', async () => {
    tx.terminalSession.findMany.mockResolvedValue([1, 2, 3, 4, 5].map((i) => sessionRow(i, 'detached')));
    await make().summary(principal());
    expect(tx.serverProfile.count).toHaveBeenCalledTimes(4);
    expect(tx.terminalSession.groupBy).toHaveBeenCalledTimes(1);
    expect(tx.terminalSession.findMany).toHaveBeenCalledTimes(1);
  });

  describe('runs', () => {
    const summary = {
      running: 1,
      failedLast24h: 2,
      recent: [
        {
          id: '55555555-5555-4555-8555-555555555555',
          runbookId: '66666666-6666-4666-8666-666666666666',
          runbookName: 'Patch and collect logs',
          status: 'running',
          targets: { total: 4, succeeded: 2, failed: 1, running: 1 },
          startedAt: '2026-11-24T10:00:00.000Z',
        },
      ],
    };

    it('is null until a runs source is bound (#62), even with runbooks:read', async () => {
      const result = await make().summary(principal());
      expect(result.runs).toBeNull();
    });

    it('comes from the bound source, asked for the last 24 hours and five rows', async () => {
      const source = { summarize: jest.fn().mockResolvedValue(summary) };
      const now = new Date('2026-11-24T12:00:00.000Z');
      const result = await make(source).summary(principal(), now);
      expect(result.runs).toEqual(summary);
      expect(source.summarize).toHaveBeenCalledWith(expect.objectContaining({ userId: USER }), {
        failedSince: new Date(now.getTime() - DASHBOARD_FAILED_WINDOW_MS),
        limit: DASHBOARD_RECENT_LIMIT,
      });
    });

    it('is null without runbooks:read, and the source is never asked', async () => {
      const source = { summarize: jest.fn().mockResolvedValue(summary) };
      const result = await make(source).summary(principal(['sessions:read', 'servers:read']));
      expect(result.runs).toBeNull();
      expect(source.summarize).not.toHaveBeenCalled();
    });

    it('rejects a source answer that breaks the response schema', async () => {
      const source = { summarize: jest.fn().mockResolvedValue({ ...summary, recent: Array(6).fill(summary.recent[0]) }) };
      await expect(make(source).summary(principal())).rejects.toThrow();
    });
  });

  it('refuses a principal with no active organization', async () => {
    await expect(make().summary(principal(ALL, ''))).rejects.toBeInstanceOf(ForbiddenException);
  });
});
