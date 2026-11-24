/**
 * Patching a loaded run from its live events (issue #65). Pure: the run view keeps ONE
 * `RunDetail` and folds every snapshot, `run`, `target` and `step` event into it, so the stream
 * never triggers a refetch (an `approval` event is the caller's to refetch, debounced).
 */
import type { RunDetail, RunEvent, RunSnapshot, RunStepRow, RunTargetRow, StepStatus, TargetStatus } from '../api/types';

function recount(targets: RunTargetRow[]): RunDetail['counts'] {
  const counts: RunDetail['counts'] = { total: targets.length };
  for (const t of targets) counts[t.status] = (counts[t.status] ?? 0) + 1;
  return counts;
}

function patchStep(
  target: RunTargetRow,
  stepIndex: number,
  patch: Partial<Pick<RunStepRow, 'status' | 'exitCode' | 'durationMs'>>,
): RunTargetRow {
  const index = target.steps.findIndex((s) => s.stepIndex === stepIndex);
  if (index < 0) return target;
  const current = target.steps[index]!;
  const next = { ...current, ...patch };
  if (next.status === current.status && next.exitCode === current.exitCode && next.durationMs === current.durationMs) {
    return target;
  }
  const steps = target.steps.slice();
  steps[index] = next;
  return { ...target, steps };
}

/** Apply a stream snapshot (the state at connect time) to a loaded run. */
export function applySnapshot(run: RunDetail, snapshot: RunSnapshot): RunDetail {
  const targetStatus = new Map(snapshot.targets.map((t) => [t.id, t]));
  const stepsByTarget = new Map<string, RunSnapshot['steps']>();
  for (const step of snapshot.steps) {
    stepsByTarget.set(step.runTargetId, [...(stepsByTarget.get(step.runTargetId) ?? []), step]);
  }
  const targets = run.targets.map((target) => {
    let next = target;
    const t = targetStatus.get(target.id);
    if (t && (t.status !== target.status || t.errorCode !== target.errorCode)) {
      next = { ...next, status: t.status, errorCode: t.errorCode };
    }
    for (const step of stepsByTarget.get(target.id) ?? []) {
      next = patchStep(next, step.stepIndex, { status: step.status, exitCode: step.exitCode, durationMs: step.durationMs });
    }
    return next;
  });
  return {
    ...run,
    status: snapshot.run.status,
    finishedAt: snapshot.run.finishedAt,
    targets,
    counts: recount(targets),
  };
}

/** Fold one event into the run; returns the same object when nothing changed. */
export function applyRunEvent(run: RunDetail, event: RunEvent): RunDetail {
  if (event.runId !== run.id) return run;
  switch (event.type) {
    case 'run':
      if (event.status === run.status && (event.finishedAt ?? null) === run.finishedAt) return run;
      return { ...run, status: event.status as RunDetail['status'], finishedAt: event.finishedAt ?? run.finishedAt };
    case 'target': {
      let changed = false;
      const targets = run.targets.map((t) => {
        if (t.id !== event.targetId || (t.status === event.status && t.errorCode === (event.errorCode ?? t.errorCode))) return t;
        changed = true;
        return { ...t, status: event.status as TargetStatus, errorCode: event.errorCode ?? t.errorCode };
      });
      return changed ? { ...run, targets, counts: recount(targets) } : run;
    }
    case 'step': {
      let changed = false;
      const targets = run.targets.map((t) => {
        if (t.id !== event.targetId) return t;
        const next = patchStep(t, event.stepIndex, {
          status: event.status as StepStatus,
          ...(event.exitCode !== undefined ? { exitCode: event.exitCode } : {}),
          ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}),
        });
        if (next !== t) changed = true;
        return next;
      });
      return changed ? { ...run, targets } : run;
    }
    default:
      return run;
  }
}

/** Whether the run is over (nothing will change any more). */
export const isRunFinished = (status: string): boolean =>
  ['succeeded', 'failed', 'partially_failed', 'aborted', 'cancelled'].includes(status);
