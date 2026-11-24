import type { DashboardRuns, DashboardSessionSummary, DashboardSummary } from '../../../types/dashboard';

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

export function makeDashboardSession(overrides: Partial<DashboardSessionSummary> = {}): DashboardSessionSummary {
  return {
    id: 'session-1',
    name: 'deploy-hotfix',
    status: 'active',
    serverProfileId: 'profile-1',
    serverName: 'server-a',
    lastActivityAt: minutesAgo(2),
    createdAt: minutesAgo(30),
    ...overrides,
  };
}

export function makeDashboardRuns(overrides: Partial<DashboardRuns> = {}): DashboardRuns {
  return {
    running: 1,
    failedLast24h: 2,
    recent: [
      {
        id: 'run-1',
        runbookId: 'runbook-1',
        runbookName: 'Patch and collect logs',
        status: 'running',
        targets: { total: 4, succeeded: 2, failed: 1, running: 1 },
        startedAt: minutesAgo(5),
      },
    ],
    ...overrides,
  };
}

export function makeDashboardSummary(overrides: Partial<DashboardSummary> = {}): DashboardSummary {
  return {
    servers: { total: 14, reachable: 0, unreachable: 2, unknown: 1, hostKeyUntrusted: 3 },
    sessions: {
      active: 5,
      attached: 2,
      detached: 3,
      recent: [
        makeDashboardSession(),
        makeDashboardSession({ id: 'session-2', name: 'logs-tail', status: 'detached', serverName: 'server-b' }),
      ],
    },
    runs: null,
    ...overrides,
  };
}
