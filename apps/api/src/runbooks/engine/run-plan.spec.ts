import { failureAllowance, finalRunStatus, planAdvance, type PlanInput, type PlanTarget } from './run-plan';
import type { RunStatus, TargetStatus } from './state-machine';

const strategy = (over: Partial<PlanInput['strategy']> = {}): PlanInput['strategy'] => ({
  concurrency: 2,
  maxFailures: { count: 0 },
  abortInFlight: false,
  pauseAfterFirstBatch: false,
  ...over,
});

/** Targets t0..t(n-1) with the given statuses (default pending) and batch indexes. */
function targets(statuses: TargetStatus[], batches?: number[]): PlanTarget[] {
  return statuses.map((status, position) => ({ id: `t${position}`, position, batchIndex: batches?.[position] ?? 0, status }));
}

const input = (over: Partial<PlanInput> & Pick<PlanInput, 'targets'>): PlanInput => ({
  runStatus: 'running',
  finished: false,
  strategy: strategy(),
  canaryApproved: false,
  ...over,
});

describe('planAdvance: the sliding window', () => {
  it('starts `concurrency` targets from the front of the order', () => {
    const plan = planAdvance(input({ targets: targets(['pending', 'pending', 'pending', 'pending', 'pending']) }));
    expect(plan.dispatch).toEqual(['t0', 't1']);
    expect(plan.finish).toBe(false);
  });

  it('keeps `concurrency` in flight: one finishing frees exactly one slot', () => {
    const plan = planAdvance(input({ targets: targets(['succeeded', 'running', 'pending', 'pending', 'pending']) }));
    expect(plan.dispatch).toEqual(['t2']);
  });

  it('counts queued and waiting targets as in flight', () => {
    expect(planAdvance(input({ targets: targets(['queued', 'waiting', 'pending']) })).dispatch).toEqual([]);
  });

  it('dispatches nothing while the window is full', () => {
    const plan = planAdvance(input({ targets: targets(['running', 'running', 'pending']) }));
    expect(plan.dispatch).toEqual([]);
    expect(plan.finish).toBe(false);
  });

  it('never exceeds concurrency across a whole run', () => {
    let state = targets(Array(7).fill('pending'));
    let maxInFlight = 0;
    for (let tick = 0; tick < 30; tick += 1) {
      const plan = planAdvance(input({ targets: state, strategy: strategy({ concurrency: 3 }) }));
      state = state.map((t) => (plan.dispatch.includes(t.id) ? { ...t, status: 'queued' as const } : t));
      maxInFlight = Math.max(maxInFlight, state.filter((t) => t.status === 'queued' || t.status === 'running').length);
      // the oldest in-flight target finishes
      const done = state.find((t) => t.status === 'queued' || t.status === 'running');
      if (done) state = state.map((t) => (t.id === done.id ? { ...t, status: 'succeeded' as const } : t));
    }
    expect(maxInFlight).toBe(3);
    expect(state.every((t) => t.status === 'succeeded')).toBe(true);
  });
});

describe('planAdvance: waves (batchSize)', () => {
  const waves = strategy({ concurrency: 10, batchSize: 2, maxFailures: { count: 5 } });
  const batches = [0, 0, 1, 1, 2];

  it('starts only the current wave', () => {
    const plan = planAdvance(input({ strategy: waves, targets: targets(Array(5).fill('pending'), batches) }));
    expect(plan.dispatch).toEqual(['t0', 't1']);
  });

  it('waits for the WHOLE wave: one settled target does not start the next wave', () => {
    const plan = planAdvance(input({ strategy: waves, targets: targets(['succeeded', 'running', 'pending', 'pending', 'pending'], batches) }));
    expect(plan.dispatch).toEqual([]);
  });

  it('starts the next wave when every target of the current one is settled', () => {
    const plan = planAdvance(input({ strategy: waves, targets: targets(['succeeded', 'failed', 'pending', 'pending', 'pending'], batches) }));
    expect(plan.dispatch).toEqual(['t2', 't3']);
  });
});

describe('planAdvance: the failure budget', () => {
  const budget = (maxFailures: PlanInput['strategy']['maxFailures'], over: Partial<PlanInput['strategy']> = {}) =>
    strategy({ concurrency: 10, maxFailures, ...over });

  it('{count: 2} tolerates two failures and aborts on the third', () => {
    const two = planAdvance(input({ strategy: budget({ count: 2 }), targets: targets(['failed', 'failed', 'running', 'pending']) }));
    expect(two.runStatus).toBeNull();
    expect(two.dispatch).toEqual(['t3']);

    const three = planAdvance(input({ strategy: budget({ count: 2 }), targets: targets(['failed', 'failed', 'failed', 'running', 'pending']) }));
    expect(three.runStatus).toBe('aborted');
    expect(three.cancelPending).toEqual(['t4']);
    expect(three.dispatch).toEqual([]);
    expect(three.finish).toBe(false); // t3 is still running
  });

  it('{count: 0} is fail-fast', () => {
    const plan = planAdvance(input({ strategy: budget({ count: 0 }), targets: targets(['failed', 'pending', 'pending']) }));
    expect(plan.runStatus).toBe('aborted');
    expect(plan.cancelPending).toEqual(['t1', 't2']);
    expect(plan.finish).toBe(true);
  });

  it('a percent budget rounds the allowance UP', () => {
    expect(failureAllowance({ percent: 25 }, 10)).toBe(3);
    expect(failureAllowance({ percent: 10 }, 5)).toBe(1);
    expect(failureAllowance({ percent: 0 }, 5)).toBe(0);
    expect(failureAllowance({ count: 4 }, 100)).toBe(4);

    const tenAt25 = (failed: number) =>
      planAdvance(
        input({
          strategy: budget({ percent: 25 }),
          targets: targets([...Array(failed).fill('failed'), ...Array(10 - failed).fill('pending')] as TargetStatus[]),
        }),
      );
    expect(tenAt25(3).runStatus).toBeNull();
    expect(tenAt25(4).runStatus).toBe('aborted');
  });

  it('the percentage is of the RESOLVED targets: a skipped one is not counted', () => {
    // 4 resolved + 1 skipped, 25% of 4 = 1: the second failure aborts
    const plan = planAdvance(
      input({ strategy: budget({ percent: 25 }), targets: targets(['skipped', 'failed', 'failed', 'pending', 'pending']) }),
    );
    expect(plan.runStatus).toBe('aborted');
  });

  it('abortInFlight asks queued and running targets to cancel and cancels parked ones', () => {
    const plan = planAdvance(
      input({
        strategy: budget({ count: 0 }, { abortInFlight: true }),
        targets: targets(['failed', 'running', 'queued', 'waiting', 'pending']),
      }),
    );
    expect(plan.runStatus).toBe('aborted');
    expect(plan.requestCancel).toEqual(['t1', 't2']);
    expect(plan.cancelWaiting).toEqual(['t3']);
    expect(plan.cancelPending).toEqual(['t4']);
  });

  it('without abortInFlight the running targets drain', () => {
    const plan = planAdvance(input({ strategy: budget({ count: 0 }), targets: targets(['failed', 'running', 'waiting', 'pending']) }));
    expect(plan.requestCancel).toEqual([]);
    expect(plan.cancelWaiting).toEqual([]);
  });

  it('an aborted run finishes as `aborted` once its in-flight targets settle', () => {
    const plan = planAdvance(
      input({ runStatus: 'aborted', strategy: budget({ count: 0 }), targets: targets(['failed', 'succeeded', 'cancelled']) }),
    );
    expect(plan).toMatchObject({ finish: true, runStatus: null });
  });
});

describe('planAdvance: cancel', () => {
  it('cancels pending and parked targets and finishes `cancelled` when nothing is in flight', () => {
    const plan = planAdvance(input({ runStatus: 'cancelling', targets: targets(['succeeded', 'waiting', 'pending']) }));
    expect(plan).toMatchObject({ cancelPending: ['t2'], cancelWaiting: ['t1'], runStatus: 'cancelled', finish: true });
  });

  it('waits for a running target before it finishes', () => {
    const plan = planAdvance(input({ runStatus: 'cancelling', targets: targets(['running', 'pending']) }));
    expect(plan).toMatchObject({ cancelPending: ['t1'], runStatus: null, finish: false });
  });

  it('never dispatches', () => {
    expect(planAdvance(input({ runStatus: 'cancelling', targets: targets(['pending', 'pending']) })).dispatch).toEqual([]);
  });
});

describe('planAdvance: canary (pauseAfterFirstBatch)', () => {
  const canary = strategy({ concurrency: 10, batchSize: 1, pauseAfterFirstBatch: true });
  const batches = [0, 1, 1];

  it('runs only wave 0 first', () => {
    const plan = planAdvance(input({ strategy: canary, targets: targets(['pending', 'pending', 'pending'], batches) }));
    expect(plan.dispatch).toEqual(['t0']);
  });

  it('pauses and creates the gate once wave 0 is settled and targets remain', () => {
    const plan = planAdvance(input({ strategy: canary, targets: targets(['succeeded', 'pending', 'pending'], batches) }));
    expect(plan).toMatchObject({ runStatus: 'paused', createCanaryGate: true, dispatch: [] });
  });

  it('does not pause while wave 0 is still running', () => {
    const plan = planAdvance(input({ strategy: canary, targets: targets(['running', 'pending', 'pending'], batches) }));
    expect(plan).toMatchObject({ runStatus: null, createCanaryGate: false, dispatch: [] });
  });

  it('does nothing while paused', () => {
    expect(planAdvance(input({ runStatus: 'paused', strategy: canary, targets: targets(['succeeded', 'pending'], [0, 1]) }))).toMatchObject({
      dispatch: [],
      runStatus: null,
    });
  });

  it('continues with the rest once the gate is approved', () => {
    const plan = planAdvance(input({ strategy: canary, canaryApproved: true, targets: targets(['succeeded', 'pending', 'pending'], batches) }));
    expect(plan.dispatch).toEqual(['t1', 't2']);
    expect(plan.createCanaryGate).toBe(false);
  });

  it('works with a sliding window too: batch 0 is the canary, the rest slide', () => {
    const sliding = strategy({ concurrency: 3, pauseAfterFirstBatch: true });
    const gated = planAdvance(input({ strategy: sliding, targets: targets(['pending', 'pending', 'pending'], [0, 1, 1]) }));
    expect(gated.dispatch).toEqual(['t0']);
    const released = planAdvance(input({ strategy: sliding, canaryApproved: true, targets: targets(['succeeded', 'pending', 'pending'], [0, 1, 1]) }));
    expect(released.dispatch).toEqual(['t1', 't2']);
  });

  it('a canary that is the whole run does not pause', () => {
    const plan = planAdvance(input({ strategy: canary, targets: targets(['succeeded'], [0]) }));
    expect(plan).toMatchObject({ createCanaryGate: false, runStatus: 'succeeded', finish: true });
  });
});

describe('planAdvance: the final status', () => {
  const finalOf = (statuses: TargetStatus[], runStatus: RunStatus = 'running', over: Partial<PlanInput['strategy']> = {}) =>
    planAdvance(input({ runStatus, strategy: strategy({ maxFailures: { count: 100 }, ...over }), targets: targets(statuses) }));

  it('succeeded: every target succeeded or was skipped', () => {
    expect(finalOf(['succeeded', 'skipped'])).toMatchObject({ runStatus: 'succeeded', finish: true });
    expect(finalOf(['skipped'])).toMatchObject({ runStatus: 'succeeded', finish: true });
  });

  it('failed: no target succeeded', () => {
    expect(finalOf(['failed', 'failed'])).toMatchObject({ runStatus: 'failed', finish: true });
    expect(finalOf(['failed', 'skipped'])).toMatchObject({ runStatus: 'failed', finish: true });
  });

  it('partially_failed: a mix', () => {
    expect(finalOf(['succeeded', 'failed'])).toMatchObject({ runStatus: 'partially_failed', finish: true });
    expect(finalOf(['succeeded', 'cancelled'])).toMatchObject({ runStatus: 'partially_failed', finish: true });
  });

  it('does nothing for a finished run, or one that has not resolved its targets', () => {
    const base = input({ targets: targets(['succeeded']) });
    expect(planAdvance({ ...base, finished: true })).toMatchObject({ dispatch: [], finish: false, runStatus: null });
    expect(planAdvance({ ...base, runStatus: 'queued' })).toMatchObject({ dispatch: [], finish: false });
    expect(planAdvance({ ...base, runStatus: 'resolving' })).toMatchObject({ dispatch: [], finish: false });
  });

  it('finalRunStatus keeps aborted and cancelled', () => {
    expect(finalRunStatus('aborted', [{ status: 'succeeded' }])).toBe('aborted');
    expect(finalRunStatus('cancelling', [{ status: 'succeeded' }])).toBe('cancelled');
  });
});
