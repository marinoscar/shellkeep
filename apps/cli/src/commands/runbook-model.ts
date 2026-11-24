import { renderTable } from './output.js';

// The run shapes the `runbook` commands share  (issue #72)
//
// GET /api/runbook-runs/:id returns the run row with its targets, their steps and
// `counts`. The row also carries the run's parameters and strategy, which the CLI
// has no reason to print, so every command projects the response onto an explicit
// field list (as `servers list` does): a field added to the response later
// cannot reach a terminal or a pipe by accident. Secret parameters are never in
// the response (`secretRefs` holds names only) and are not projected either.

/** The run statuses after which nothing more happens. */
export const TERMINAL_RUN_STATUSES: readonly string[] = ['succeeded', 'failed', 'partially_failed', 'aborted', 'cancelled'];

/** Whether a run has finished. */
export function isTerminalRun(status: string): boolean {
  return TERMINAL_RUN_STATUSES.includes(status);
}

interface ApiStep {
  stepIndex: number;
  name?: string | null;
  status: string;
  exitCode?: number | null;
  durationMs?: number | null;
}

interface ApiTarget {
  id: string;
  serverProfileId?: string | null;
  serverName?: string | null;
  status: string;
  errorCode?: string | null;
  steps?: ApiStep[];
}

/** The API's run, the fields these commands read. */
export interface ApiRun {
  id: string;
  runbookId?: string | null;
  runbookName?: string | null;
  status: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  createdAt?: string | null;
  counts?: Record<string, number>;
  targets?: ApiTarget[];
}

export interface StepRow {
  index: number;
  name: string | null;
  status: string;
  exitCode: number | null;
  durationMs: number | null;
}

export interface TargetRow {
  id: string;
  serverId: string | null;
  server: string;
  status: string;
  errorCode: string | null;
  steps: StepRow[];
}

/** What `runbook status` prints and `--json` carries. */
export interface RunRow {
  id: string;
  runbookId: string | null;
  runbook: string | null;
  status: string;
  finished: boolean;
  /** True only when the run succeeded and every target did. */
  succeeded: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  counts: Record<string, number>;
  targets: TargetRow[];
}

/** Projects the API's run onto {@link RunRow}. */
export function toRunRow(run: ApiRun): RunRow {
  const targets: TargetRow[] = (run.targets ?? []).map((target) => ({
    id: target.id,
    serverId: target.serverProfileId ?? null,
    server: target.serverName ?? target.serverProfileId ?? target.id,
    status: target.status,
    errorCode: target.errorCode ?? null,
    steps: (target.steps ?? [])
      .map((step) => ({
        index: step.stepIndex,
        name: step.name ?? null,
        status: step.status,
        exitCode: step.exitCode ?? null,
        durationMs: step.durationMs ?? null,
      }))
      .sort((a, b) => a.index - b.index),
  }));
  return {
    id: run.id,
    runbookId: run.runbookId ?? null,
    runbook: run.runbookName ?? null,
    status: run.status,
    finished: isTerminalRun(run.status),
    succeeded: run.status === 'succeeded' && targets.length > 0 && targets.every((target) => target.status === 'succeeded'),
    startedAt: run.startedAt ?? null,
    finishedAt: run.finishedAt ?? null,
    counts: run.counts ?? {},
    targets,
  };
}

function shorten(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}~`;
}

/** The one-line summary: `run <id>  <status>  3 targets: 2 succeeded, 1 failed`. */
export function summarizeRun(run: RunRow): string {
  const parts = Object.entries(run.counts)
    .filter(([key, value]) => key !== 'total' && value > 0)
    .map(([key, value]) => `${value} ${key}`);
  const total = run.counts.total ?? run.targets.length;
  return `run ${run.id}  ${run.status}${run.runbook !== null ? `  (${run.runbook})` : ''}  ${total} target${total === 1 ? '' : 's'}${parts.length > 0 ? `: ${parts.join(', ')}` : ''}`;
}

/** The servers x steps matrix as plain text: a row per server, a column per step. */
export function renderRunMatrix(run: RunRow): string {
  const indexes = [...new Set(run.targets.flatMap((target) => target.steps.map((step) => step.index)))].sort((a, b) => a - b);
  const names = new Map<number, string>();
  for (const target of run.targets) {
    for (const step of target.steps) if (step.name !== null && !names.has(step.index)) names.set(step.index, step.name);
  }
  const headers = [
    'SERVER',
    'STATUS',
    ...indexes.map((index) => {
      const name = names.get(index);
      return name !== undefined ? `${index + 1}:${shorten(name, 16)}` : `${index + 1}`;
    }),
  ];
  const rows = run.targets.map((target) => [
    target.server,
    target.errorCode !== null ? `${target.status} (${target.errorCode})` : target.status,
    ...indexes.map((index) => target.steps.find((step) => step.index === index)?.status ?? '-'),
  ]);
  return rows.length === 0 ? '(no targets yet)' : renderTable(headers, rows);
}
