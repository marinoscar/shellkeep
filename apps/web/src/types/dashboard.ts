/**
 * The Home dashboard summary, `GET /api/dashboard/summary` (issue #78). The API's
 * Zod schema (`apps/api/src/dashboard/dashboard.schema.ts`) is the source of truth.
 */

/** Fleet health over the servers the caller may see. `null` without `servers:read`. */
export interface DashboardServers {
  total: number;
  reachable: number;
  unreachable: number;
  /** Servers with no stored connection-test result (the dashboard never connects). */
  unknown: number;
  hostKeyUntrusted: number;
}

export interface DashboardSessionSummary {
  id: string;
  name: string;
  status: 'active' | 'detached';
  serverProfileId: string;
  serverName: string;
  lastActivityAt: string;
  createdAt: string;
}

export interface DashboardSessions {
  /** Not terminated: attached plus detached. */
  active: number;
  attached: number;
  detached: number;
  recent: DashboardSessionSummary[];
}

export interface DashboardRunSummary {
  id: string;
  runbookId: string;
  runbookName: string;
  status: string;
  targets: { total: number; succeeded: number; failed: number; running: number };
  startedAt: string | null;
}

/** `null` without `runbooks:read`, and until the runbook engine (#62) records runs. */
export interface DashboardRuns {
  running: number;
  failedLast24h: number;
  recent: DashboardRunSummary[];
}

export interface DashboardSummary {
  servers: DashboardServers | null;
  sessions: DashboardSessions;
  runs: DashboardRuns | null;
}
