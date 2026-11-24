import { ApiError } from '@marinoscar/platform-cli/api-client';
import { DashboardSource, type DashboardReducer, pollFeed } from '@marinoscar/platform-cli/tui';

import { type CommandDeps, defaultDeps } from '../commands/deps.js';
import type { RunRow } from '../commands/runbook-model.js';
import { fetchRun } from '../commands/runbook-status.js';

// The data of the Runs screen  (issue #72)
//
// A `DashboardSource` polling GET /api/runbook-runs (newest first): the screen
// shows the latest runs with their live status. The reducer is pure; the poll is
// the only I/O and it takes the API through `CommandDeps`, so a test feeds the
// source without a server.

/** One line of the runs list. */
export interface RunSummary {
  id: string;
  runbook: string;
  status: string;
  trigger: string | null;
  createdAt: string | null;
  finishedAt: string | null;
}

/** What one poll returns. */
export type RunsPoll =
  | { kind: 'ok'; at: string; runs: RunSummary[] }
  | { kind: 'forbidden'; at: string; message: string };

/** The screen's data (the platform adds the connection fields). */
export interface RunsData {
  runs: RunSummary[] | undefined;
  updatedAt: string | undefined;
  forbidden: string | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export const runsReducer: DashboardReducer<RunsData, RunsPoll> = {
  initial: () => ({ runs: undefined, updatedAt: undefined, forbidden: undefined }),
  hydrate: (state) => state,
  reduce: (state, poll) =>
    poll.kind === 'ok' ? { runs: poll.runs, updatedAt: poll.at, forbidden: undefined } : { ...state, forbidden: poll.message },
  parseEvent: (frame) => {
    if (!isRecord(frame)) return undefined;
    if (frame.kind === 'ok' && Array.isArray(frame.runs) && typeof frame.at === 'string') return frame as unknown as RunsPoll;
    if (frame.kind === 'forbidden' && typeof frame.message === 'string' && typeof frame.at === 'string') return frame as unknown as RunsPoll;
    return undefined;
  },
};

interface ApiRunListItem {
  id: string;
  runbookName?: string | null;
  status: string;
  trigger?: string | null;
  createdAt?: string | null;
  finishedAt?: string | null;
}

/** One poll of the run list. */
export function fetchRuns(deps: CommandDeps, now: () => Date = () => new Date()): (signal: AbortSignal) => Promise<RunsPoll> {
  return async (signal) => {
    try {
      const page = await deps.client().get<{ items: ApiRunListItem[] }>('/runbook-runs', { query: { page: 1, pageSize: 20 }, signal });
      return {
        kind: 'ok',
        at: now().toISOString(),
        runs: page.items.map((run) => ({
          id: run.id,
          runbook: run.runbookName ?? '-',
          status: run.status,
          trigger: run.trigger ?? null,
          createdAt: run.createdAt ?? null,
          finishedAt: run.finishedAt ?? null,
        })),
      };
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        return { kind: 'forbidden', at: now().toISOString(), message: 'Your account does not have the runbooks:read permission.' };
      }
      throw error;
    }
  };
}

/** Where the Runs screen gets its data. */
export interface RunsScreenSource {
  /** The live list. The screen starts and stops it. */
  dashboard: DashboardSource<RunsData, RunsPoll>;
  /** One run with its servers x steps matrix. */
  detail(id: string): Promise<RunRow>;
}

/** The real source: the stored login, polling every 3 s. */
export function defaultRunsSource(intervalMs = 3000): RunsScreenSource {
  const deps = defaultDeps();
  return {
    dashboard: new DashboardSource(runsReducer, pollFeed(fetchRuns(deps), { intervalMs })),
    detail: (id) => fetchRun(deps, id),
  };
}
