import { approvalsQuerySchema } from './dto/run.dto';
import { RunbookApprovalsService, type ApprovalsPage } from './runbook-approvals.service';

// `runInOrg` is the platform's transaction helper; here it hands the fake transaction to the callback.
jest.mock('@marinoscar/platform-api/core', () => ({
  ...jest.requireActual('@marinoscar/platform-api/core'),
  runInOrg: (_client: unknown, _scope: unknown, fn: (tx: unknown) => unknown) => fn((global as any).__tx),
}));

const principal = {
  kind: 'user',
  userId: 'user-1',
  email: 'person-a@example.test',
  credential: 'session',
  roles: [],
  permissions: ['runbooks:read', 'runbooks:approve'],
  activeOrgId: 'org-1',
} as never;

function approvalRow(over: Record<string, unknown> = {}) {
  return {
    id: 'ap-1', orgId: 'org-1', runId: 'run-1', runTargetId: 'tg-1', scopeKey: 'tg-1', scope: 'target', kind: 'gate',
    stepIndex: 1, stepName: 'Confirm', message: 'Check the canary', status: 'pending', expiresAt: new Date(5000),
    decidedBy: null, decidedAt: null, comment: null, createdAt: new Date(1000),
    run: { version: 3, initiatedBy: 'user-2', initiator: { displayName: 'Person B', email: 'person-b@example.test' }, runbook: { name: 'Patch' } },
    target: { serverName: 'web-01' },
    ...over,
  };
}

describe('RunbookApprovalsService.list (#65 inbox fields)', () => {
  let tx: any;
  let settings: { effective: jest.Mock };
  let service: RunbookApprovalsService;

  beforeEach(() => {
    tx = { runbookApproval: { count: jest.fn().mockResolvedValue(1), findMany: jest.fn().mockResolvedValue([approvalRow()]) } };
    (global as any).__tx = tx;
    settings = { effective: jest.fn().mockResolvedValue({ approvals: { allowSelfApproval: true } }) };
    const runbooks = { readableWhere: jest.fn().mockResolvedValue({ ownerUserId: 'user-1' }) };
    service = new RunbookApprovalsService(
      {} as never, {} as never, {} as never, {} as never, settings as never, {} as never, runbooks as never, {} as never,
    );
  });

  it('answers { count } only for count=true, without reading the rows or the settings', async () => {
    tx.runbookApproval.count.mockResolvedValue(4);
    const query = approvalsQuerySchema.parse({ status: 'pending', count: 'true' });
    await expect(service.list(principal, query)).resolves.toEqual({ count: 4 });
    expect(tx.runbookApproval.findMany).not.toHaveBeenCalled();
    expect(settings.effective).not.toHaveBeenCalled();
    expect(tx.runbookApproval.count.mock.calls[0][0].where).toMatchObject({ orgId: 'org-1', status: 'pending' });
  });

  it('parses count=false and an absent count as a page', () => {
    expect(approvalsQuerySchema.parse({ count: 'false' }).count).toBe(false);
    expect(approvalsQuerySchema.parse({}).count).toBe(false);
  });

  it('carries the server name, the requester and the organization self-approval rule', async () => {
    const page = await service.list(principal, approvalsQuerySchema.parse({}));
    expect(page).toMatchObject({ total: 1, page: 1, pageSize: 20, allowSelfApproval: true });
    const item = (page as ApprovalsPage).items[0];
    expect(item).toMatchObject({
      id: 'ap-1', kind: 'gate', targetName: 'web-01', initiatedBy: 'user-2', initiatedByName: 'Person B', runbookName: 'Patch', runbookVersion: 3,
    });
    expect(settings.effective).toHaveBeenCalledWith('org-1');
  });

  it('names no server for a run-scope approval and falls back to the email', async () => {
    tx.runbookApproval.findMany.mockResolvedValue([
      approvalRow({ runTargetId: null, scope: 'run', target: null, run: { version: 1, initiatedBy: 'user-2', initiator: { displayName: null, email: 'person-b@example.test' }, runbook: { name: 'Patch' } } }),
    ]);
    const page = (await service.list(principal, approvalsQuerySchema.parse({}))) as ApprovalsPage;
    expect(page.items[0]).toMatchObject({ targetName: null, initiatedByName: 'person-b@example.test' });
  });
});

describe('runs query `since` (#65: Home links /runs?status=failed&since=24h)', () => {
  // Imported here so the approvals spec above stays about approvals.
  const { runsQuerySchema, sinceToDate } = jest.requireActual('./dto/run.dto') as typeof import('./dto/run.dto');

  it('accepts a number and m, h or d, and refuses anything else', () => {
    expect(runsQuerySchema.parse({ since: '24h' }).since).toBe('24h');
    expect(runsQuerySchema.safeParse({ since: '24 hours' }).success).toBe(false);
    expect(runsQuerySchema.safeParse({ since: '1w' }).success).toBe(false);
  });

  it('turns the window into its start', () => {
    const now = Date.UTC(2026, 0, 2);
    expect(sinceToDate('24h', now).toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(sinceToDate('30m', now).getTime()).toBe(now - 30 * 60_000);
    expect(sinceToDate('7d', now).getTime()).toBe(now - 7 * 86_400_000);
  });
});

describe('RunbookRunsService.list (#65: the runs list and its filters)', () => {
  const { RunbookRunsService } = jest.requireActual('./runbook-runs.service') as typeof import('./runbook-runs.service');
  const { runsQuerySchema } = jest.requireActual('./dto/run.dto') as typeof import('./dto/run.dto');

  it('carries each run\'s server split and filters by the since window', async () => {
    const tx = {
      runbookRun: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([
          { id: 'run-1', runbookId: 'rb-1', version: 1, status: 'failed', trigger: 'manual', initiatedBy: 'user-1', createdAt: new Date(0), startedAt: null, finishedAt: null, runbook: { name: 'Patch' } },
        ]),
      },
      runbookRunTarget: {
        groupBy: jest.fn().mockResolvedValue([
          { runId: 'run-1', status: 'succeeded', _count: { _all: 3 } },
          { runId: 'run-1', status: 'failed', _count: { _all: 1 } },
          { runId: 'run-1', status: 'running', _count: { _all: 2 } },
        ]),
      },
    };
    (global as any).__tx = tx;
    const runbooks = { readableWhere: jest.fn().mockResolvedValue({ ownerUserId: 'user-1' }) };
    const service = new RunbookRunsService({} as never, {} as never, runbooks as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    const page = await service.list(principal, runsQuerySchema.parse({ status: 'failed', since: '24h' }));
    expect(page.items[0]).toMatchObject({ runbookName: 'Patch', targets: { total: 6, succeeded: 3, failed: 1, running: 2 } });
    const where = tx.runbookRun.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('failed');
    expect(where.createdAt.gte).toBeInstanceOf(Date);
    expect(tx.runbookRunTarget.groupBy.mock.calls[0][0].where).toEqual({ orgId: 'org-1', runId: { in: ['run-1'] } });
  });
});
