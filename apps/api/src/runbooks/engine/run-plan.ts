// =============================================================================
// The dispatch plan of a run (issue #62)
// =============================================================================
//
// PURE: `planAdvance` turns a snapshot of a run (its status, strategy and the status of every target)
// into the changes the coordinator applies. Nothing here touches a database or a queue, so every rule
// of the strategy is unit-tested without either (`run-plan.spec.ts`).
//
//   1. a run that finished does nothing; a run still `queued`/`resolving` has no targets yet;
//   2. `cancelling`: pending targets are cancelled, parked (`waiting`) ones too (no job holds them);
//      the run becomes `cancelled` once nothing is in flight;
//   3. the FAILURE BUDGET: more failed targets than `maxFailures` allows (a count, or a percent of the
//      resolved targets rounded UP) aborts the run: pending targets are cancelled and, with
//      `abortInFlight`, the in-flight ones are asked to cancel;
//   4. otherwise DISPATCH: a sliding window keeps `concurrency` targets in flight; with `batchSize` the
//      next wave starts only when every target of the current wave is settled;
//   5. CANARY (`pauseAfterFirstBatch`): once wave 0 is settled and targets remain, the run pauses and a
//      run-scope approval of kind `gate` is created; its approval releases the rest;
//   6. when nothing is pending or in flight the run is FINISHED: `succeeded` (every target succeeded or
//      was skipped), `failed` (none succeeded) or `partially_failed`; `aborted` and `cancelled` stay.
//
// `waiting` (parked at an approval or an AI task) counts as in flight: it holds its concurrency slot.
// =============================================================================

import type { RunStrategy } from '../schema/runbook-definition.schema';
import { IN_FLIGHT_TARGET_STATUSES, isSettledTarget, type RunStatus, type TargetStatus } from './state-machine';

export interface PlanTarget {
  id: string;
  position: number;
  batchIndex: number;
  status: TargetStatus;
}

export interface PlanInput {
  runStatus: RunStatus;
  /** `finished_at` is set. */
  finished: boolean;
  strategy: Pick<RunStrategy, 'concurrency' | 'batchSize' | 'maxFailures' | 'abortInFlight' | 'pauseAfterFirstBatch'>;
  targets: readonly PlanTarget[];
  /** The canary gate was approved (`runbook_approvals` step -1, status `approved`). */
  canaryApproved: boolean;
}

export interface AdvancePlan {
  /** pending -> cancelled */
  cancelPending: string[];
  /** waiting -> cancelled (no job holds a parked target) */
  cancelWaiting: string[];
  /** queued or running targets asked to cancel (`cancel_requested_at`) */
  requestCancel: string[];
  /** pending -> queued, and a `runbook.target.run` job each */
  dispatch: string[];
  /** The run's new status; `null` leaves it. */
  runStatus: RunStatus | null;
  /** Create the canary gate approval (idempotent). */
  createCanaryGate: boolean;
  /** Set `finished_at`. */
  finish: boolean;
}

const EMPTY: AdvancePlan = Object.freeze({
  cancelPending: [],
  cancelWaiting: [],
  requestCancel: [],
  dispatch: [],
  runStatus: null,
  createCanaryGate: false,
  finish: false,
}) as AdvancePlan;

const noop = (): AdvancePlan => ({ ...EMPTY, cancelPending: [], cancelWaiting: [], requestCancel: [], dispatch: [] });

/** The most failures a run tolerates: a count, or a percent of the resolved targets rounded up. */
export function failureAllowance(maxFailures: RunStrategy['maxFailures'], resolvedTargets: number): number {
  if ('count' in maxFailures) return maxFailures.count;
  return Math.ceil((resolvedTargets * maxFailures.percent) / 100);
}

/** The final status of a run whose targets are all settled. */
export function finalRunStatus(runStatus: RunStatus, targets: readonly Pick<PlanTarget, 'status'>[]): RunStatus {
  if (runStatus === 'aborted') return 'aborted';
  if (runStatus === 'cancelling' || runStatus === 'cancelled') return 'cancelled';
  const succeeded = targets.filter((t) => t.status === 'succeeded').length;
  const skipped = targets.filter((t) => t.status === 'skipped').length;
  if (succeeded + skipped === targets.length) return 'succeeded';
  if (succeeded === 0) return 'failed';
  return 'partially_failed';
}

export function planAdvance(input: PlanInput): AdvancePlan {
  const { runStatus, strategy } = input;
  if (input.finished || runStatus === 'queued' || runStatus === 'resolving') return noop();

  const plan = noop();
  const byPosition = [...input.targets].sort((a, b) => a.position - b.position);
  const status = new Map<string, TargetStatus>(byPosition.map((t) => [t.id, t.status]));
  const set = (ids: string[], to: TargetStatus): void => ids.forEach((id) => status.set(id, to));
  const idsWith = (s: TargetStatus): string[] => byPosition.filter((t) => status.get(t.id) === s).map((t) => t.id);
  const inFlightIds = (): string[] => byPosition.filter((t) => (IN_FLIGHT_TARGET_STATUSES as readonly string[]).includes(status.get(t.id)!)).map((t) => t.id);
  const settleIfDone = (finalFrom: RunStatus): void => {
    if (byPosition.every((t) => isSettledTarget(status.get(t.id)!))) {
      plan.finish = true;
      const next = finalRunStatus(
        finalFrom,
        byPosition.map((t) => ({ status: status.get(t.id)! })),
      );
      if (next !== runStatus) plan.runStatus = next;
    }
  };

  // 2. Cancelling (or already cancelled): nothing new starts.
  if (runStatus === 'cancelling' || runStatus === 'cancelled') {
    plan.cancelPending = idsWith('pending');
    plan.cancelWaiting = idsWith('waiting');
    set(plan.cancelPending, 'cancelled');
    set(plan.cancelWaiting, 'cancelled');
    settleIfDone('cancelling');
    return plan;
  }

  // 3. The failure budget (also re-evaluated on an `aborted` run, which still drains).
  const resolved = byPosition.filter((t) => status.get(t.id) !== 'skipped').length;
  const failed = byPosition.filter((t) => status.get(t.id) === 'failed').length;
  const aborting = runStatus === 'aborted' || failed > failureAllowance(strategy.maxFailures, resolved);
  if (aborting) {
    plan.cancelPending = idsWith('pending');
    set(plan.cancelPending, 'cancelled');
    if (strategy.abortInFlight) {
      plan.cancelWaiting = idsWith('waiting');
      set(plan.cancelWaiting, 'cancelled');
      plan.requestCancel = byPosition.filter((t) => ['queued', 'running'].includes(status.get(t.id)!)).map((t) => t.id);
    }
    if (runStatus !== 'aborted') plan.runStatus = 'aborted';
    settleIfDone('aborted');
    return plan;
  }

  // 4 and 5. Dispatch.
  const pending = idsWith('pending');
  const batchOf = new Map(byPosition.map((t) => [t.id, t.batchIndex]));
  const gated = strategy.pauseAfterFirstBatch && !input.canaryApproved;
  const wave0 = byPosition.filter((t) => t.batchIndex === 0);
  const wave0Settled = wave0.every((t) => isSettledTarget(status.get(t.id)!));

  if (runStatus === 'paused') return plan;

  let eligible = pending;
  if (strategy.batchSize !== undefined) {
    const open = byPosition.filter((t) => !isSettledTarget(status.get(t.id)!));
    const current = open.length > 0 ? Math.min(...open.map((t) => t.batchIndex)) : 0;
    eligible = pending.filter((id) => batchOf.get(id) === current);
  }
  if (gated) {
    if (wave0Settled && pending.length > 0) {
      plan.runStatus = 'paused';
      plan.createCanaryGate = true;
      return plan;
    }
    eligible = eligible.filter((id) => batchOf.get(id) === 0);
  }

  const slots = Math.max(0, strategy.concurrency - inFlightIds().length);
  plan.dispatch = eligible.slice(0, slots);
  set(plan.dispatch, 'queued');

  // 6. Finished?
  if (plan.dispatch.length === 0) settleIfDone(runStatus);
  return plan;
}
