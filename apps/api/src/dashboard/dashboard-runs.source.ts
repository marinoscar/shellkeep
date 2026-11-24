// =============================================================================
// The port of the "runs" part of the Home dashboard (issue #78)
// =============================================================================
//
// Runbook RUNS are the runbook engine's (#62). `RunbooksModule` binds `DASHBOARD_RUNS_SOURCE` to
// `runbooks/engine/runs-dashboard.source.ts` (one bounded read, counts plus `LIMIT limit`, no N+1, over the
// runs the principal may see). Without a binding the dashboard answers `runs: null`. The `runbooks:read`
// gate stays in `DashboardService`: a source is never asked for a caller without it.
// =============================================================================

import type { Principal } from '@marinoscar/platform-api/core';

import type { DashboardRuns } from './dashboard.schema';

/** Injection token of the optional {@link DashboardRunsSource}. */
export const DASHBOARD_RUNS_SOURCE = Symbol('DASHBOARD_RUNS_SOURCE');

export interface DashboardRunsQuery {
  /** `failedLast24h` counts failed runs queued at or after this instant (the Runs list's `since` cuts `created_at`). */
  readonly failedSince: Date;
  /** The most rows `recent` may carry. */
  readonly limit: number;
}

/** Summarizes the runs a principal may see. Bound by the runbook engine (#62). */
export interface DashboardRunsSource {
  summarize(principal: Principal, query: DashboardRunsQuery): Promise<DashboardRuns>;
}
