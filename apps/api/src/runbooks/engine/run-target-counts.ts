// =============================================================================
// The succeeded / failed / running split of a run's targets
// =============================================================================
//
// One definition for the Runs list (#65) and the Home dashboard (#78), so a tile and the list it
// links to count the same way. PURE: it folds the rows of ONE grouped query
// (`runbookRunTarget.groupBy({ by: ['runId', 'status'] })`) and never reads the database.
// =============================================================================

export interface RunTargetCounts {
  total: number;
  succeeded: number;
  failed: number;
  running: number;
}

export interface TargetStatusGroup {
  runId: string;
  status: string;
  _count: { _all: number };
}

/** The split of one run. `cancelled` counts as failed; `running`, `waiting` and `queued` count as running. */
export function targetCountsOf(grouped: readonly TargetStatusGroup[], runId: string): RunTargetCounts {
  const counts: RunTargetCounts = { total: 0, succeeded: 0, failed: 0, running: 0 };
  for (const g of grouped) {
    if (g.runId !== runId) continue;
    const n = g._count._all;
    counts.total += n;
    if (g.status === 'succeeded') counts.succeeded += n;
    else if (g.status === 'failed' || g.status === 'cancelled') counts.failed += n;
    else if (g.status === 'running' || g.status === 'waiting' || g.status === 'queued') counts.running += n;
  }
  return counts;
}
