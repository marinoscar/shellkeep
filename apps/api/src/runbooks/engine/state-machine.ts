// =============================================================================
// The run, target and step state machines (issue #62)
// =============================================================================
//
// PURE: transition tables and nothing else (no Nest, no Prisma). Every status write of the engine goes
// through `assertTransition`, so an illegal move (a succeeded target running again, a finished run
// resuming) is a loud `IllegalTransitionError` instead of a row quietly drifting.
//
// The values are the CHECK constraints of the run tables (migration `add_runbook_runs`): a new status
// is a migration AND an entry here.
//
//   run     queued -> resolving -> running <-> paused ; running -> succeeded | failed | partially_failed
//           | aborted (failure budget) ; any live state -> cancelling -> cancelled
//   target  pending -> queued -> running -> succeeded | failed | cancelled ; running <-> waiting
//           (an approval gate or an AI task parks the target; a resume queues it again)
//   step    pending -> running -> succeeded | failed | timed_out | cancelled ; running ->
//           waiting_approval -> succeeded | failed | cancelled ; pending -> skipped
// =============================================================================

export const RUN_STATUSES = [
  'queued',
  'resolving',
  'running',
  'paused',
  'cancelling',
  'succeeded',
  'failed',
  'partially_failed',
  'aborted',
  'cancelled',
] as const;
export const TARGET_STATUSES = ['pending', 'queued', 'running', 'waiting', 'succeeded', 'failed', 'skipped', 'cancelled'] as const;
export const STEP_STATUSES = [
  'pending',
  'running',
  'waiting_approval',
  'succeeded',
  'failed',
  'skipped',
  'timed_out',
  'cancelled',
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];
export type TargetStatus = (typeof TARGET_STATUSES)[number];
export type StepStatus = (typeof STEP_STATUSES)[number];

export type StateKind = 'run' | 'target' | 'step';

type Table<S extends string> = Readonly<Record<S, readonly S[]>>;

export const RUN_TRANSITIONS: Table<RunStatus> = {
  queued: ['resolving', 'running', 'cancelling', 'cancelled', 'failed'],
  resolving: ['running', 'cancelling', 'cancelled', 'failed'],
  running: ['paused', 'cancelling', 'succeeded', 'failed', 'partially_failed', 'aborted'],
  paused: ['running', 'cancelling', 'aborted'],
  cancelling: ['cancelled'],
  succeeded: [],
  failed: [],
  partially_failed: [],
  aborted: [],
  cancelled: [],
};

export const TARGET_TRANSITIONS: Table<TargetStatus> = {
  pending: ['queued', 'skipped', 'cancelled'],
  queued: ['running', 'failed', 'cancelled'],
  running: ['waiting', 'succeeded', 'failed', 'cancelled'],
  waiting: ['queued', 'failed', 'cancelled'],
  succeeded: [],
  failed: [],
  skipped: [],
  cancelled: [],
};

export const STEP_TRANSITIONS: Table<StepStatus> = {
  pending: ['running', 'skipped', 'cancelled', 'failed'],
  running: ['waiting_approval', 'succeeded', 'failed', 'timed_out', 'cancelled'],
  waiting_approval: ['succeeded', 'failed', 'cancelled'],
  succeeded: [],
  failed: [],
  skipped: [],
  timed_out: [],
  cancelled: [],
};

const TABLES: { run: Table<RunStatus>; target: Table<TargetStatus>; step: Table<StepStatus> } = {
  run: RUN_TRANSITIONS,
  target: TARGET_TRANSITIONS,
  step: STEP_TRANSITIONS,
};

export class IllegalTransitionError extends Error {
  constructor(
    readonly kind: StateKind,
    readonly from: string,
    readonly to: string,
  ) {
    super(`Illegal ${kind} transition: ${from} -> ${to}`);
    this.name = 'IllegalTransitionError';
  }
}

/** Whether `from -> to` is a legal move (an unknown status is never legal). */
export function canTransition(kind: StateKind, from: string, to: string): boolean {
  const table = TABLES[kind] as Readonly<Record<string, readonly string[]>>;
  return table[from]?.includes(to) ?? false;
}

/** @throws IllegalTransitionError when `from -> to` is not in the table. */
export function assertTransition(kind: StateKind, from: string, to: string): void {
  if (!canTransition(kind, from, to)) throw new IllegalTransitionError(kind, from, to);
}

/** A status with no way out. (For a run, `aborted` and `cancelling` still wait for in-flight targets: see `finished_at`.) */
export function isTerminal(kind: StateKind, status: string): boolean {
  const table = TABLES[kind] as Readonly<Record<string, readonly string[]>>;
  return (table[status]?.length ?? 1) === 0;
}

/** Target statuses that count as settled (no work left on that target). */
export const SETTLED_TARGET_STATUSES: readonly TargetStatus[] = ['succeeded', 'failed', 'skipped', 'cancelled'];
export const IN_FLIGHT_TARGET_STATUSES: readonly TargetStatus[] = ['queued', 'running', 'waiting'];

export const isSettledTarget = (status: string): boolean => (SETTLED_TARGET_STATUSES as readonly string[]).includes(status);
