// =============================================================================
// The extension point for the "runs" part of the Home dashboard (issue #78)
// =============================================================================
//
// Runbook RUNS are the runbook engine's (#62). Until a module binds `DASHBOARD_RUNS_SOURCE`, the
// dashboard answers `runs: null`. The engine binds it with a provider that answers ONE bounded
// read (counts plus `LIMIT limit`, no N+1) over the runs the principal may see:
//
//   { provide: DASHBOARD_RUNS_SOURCE, useExisting: RunsDashboardSource }
//
// and `DashboardModule` imports that module. The `runbooks:read` gate stays in
// `DashboardService`: a source is never asked for a caller without it.
// =============================================================================

import type { Principal } from '@marinoscar/platform-api/core';

import type { DashboardRuns } from './dashboard.schema';

/** Injection token of the optional {@link DashboardRunsSource}. */
export const DASHBOARD_RUNS_SOURCE = Symbol('DASHBOARD_RUNS_SOURCE');

export interface DashboardRunsQuery {
  /** `failedLast24h` counts runs that failed at or after this instant. */
  readonly failedSince: Date;
  /** The most rows `recent` may carry. */
  readonly limit: number;
}

/** Summarizes the runs a principal may see. Bound by the runbook engine (#62). */
export interface DashboardRunsSource {
  summarize(principal: Principal, query: DashboardRunsQuery): Promise<DashboardRuns>;
}
