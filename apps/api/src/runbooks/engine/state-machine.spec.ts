import {
  IllegalTransitionError,
  RUN_STATUSES,
  RUN_TRANSITIONS,
  STEP_STATUSES,
  STEP_TRANSITIONS,
  TARGET_STATUSES,
  TARGET_TRANSITIONS,
  assertTransition,
  canTransition,
  isTerminal,
  type StateKind,
} from './state-machine';

type Case = { kind: StateKind; all: readonly string[]; legal: ReadonlyArray<readonly [string, string]> };

const CASES: Case[] = [
  {
    kind: 'run',
    all: RUN_STATUSES,
    legal: [
      ['queued', 'resolving'], ['queued', 'running'], ['queued', 'cancelling'], ['queued', 'cancelled'], ['queued', 'failed'],
      ['resolving', 'running'], ['resolving', 'cancelling'], ['resolving', 'cancelled'], ['resolving', 'failed'],
      ['running', 'paused'], ['running', 'cancelling'], ['running', 'succeeded'], ['running', 'failed'],
      ['running', 'partially_failed'], ['running', 'aborted'],
      ['paused', 'running'], ['paused', 'cancelling'], ['paused', 'aborted'],
      ['cancelling', 'cancelled'],
    ],
  },
  {
    kind: 'target',
    all: TARGET_STATUSES,
    legal: [
      ['pending', 'queued'], ['pending', 'skipped'], ['pending', 'cancelled'],
      ['queued', 'running'], ['queued', 'failed'], ['queued', 'cancelled'],
      ['running', 'waiting'], ['running', 'succeeded'], ['running', 'failed'], ['running', 'cancelled'],
      ['waiting', 'queued'], ['waiting', 'failed'], ['waiting', 'cancelled'],
    ],
  },
  {
    kind: 'step',
    all: STEP_STATUSES,
    legal: [
      ['pending', 'running'], ['pending', 'skipped'], ['pending', 'cancelled'], ['pending', 'failed'],
      ['running', 'waiting_approval'], ['running', 'succeeded'], ['running', 'failed'], ['running', 'timed_out'], ['running', 'cancelled'],
      ['waiting_approval', 'succeeded'], ['waiting_approval', 'failed'], ['waiting_approval', 'cancelled'],
    ],
  },
];

describe.each(CASES)('$kind state machine', ({ kind, all, legal }) => {
  const legalSet = new Set(legal.map(([from, to]) => `${from}>${to}`));

  it('lists every legal transition (the table equals the documented set)', () => {
    const table = { run: RUN_TRANSITIONS, target: TARGET_TRANSITIONS, step: STEP_TRANSITIONS }[kind] as Record<string, readonly string[]>;
    const actual = Object.entries(table).flatMap(([from, tos]) => tos.map((to) => `${from}>${to}`));
    expect(new Set(actual)).toEqual(legalSet);
    expect(actual).toHaveLength(legalSet.size);
  });

  it.each(legal.map(([from, to]) => [from, to]))('allows %s -> %s', (from, to) => {
    expect(() => assertTransition(kind, from!, to!)).not.toThrow();
    expect(canTransition(kind, from!, to!)).toBe(true);
  });

  it('refuses every other pair with IllegalTransitionError', () => {
    const illegal = all.flatMap((from) => all.map((to) => [from, to] as const)).filter(([from, to]) => !legalSet.has(`${from}>${to}`));
    expect(illegal.length).toBe(all.length * all.length - legal.length);
    for (const [from, to] of illegal) {
      expect(() => assertTransition(kind, from, to)).toThrow(IllegalTransitionError);
    }
  });

  it('refuses an unknown status', () => {
    expect(() => assertTransition(kind, 'nope', all[0]!)).toThrow(IllegalTransitionError);
    expect(() => assertTransition(kind, all[0]!, 'nope')).toThrow(IllegalTransitionError);
  });

  it('names the kind and both statuses in the error', () => {
    const error = (() => {
      try {
        assertTransition(kind, 'succeeded', 'pending');
      } catch (e) {
        return e as IllegalTransitionError;
      }
    })();
    expect(error).toMatchObject({ kind, from: 'succeeded', to: 'pending' });
  });
});

describe('isTerminal', () => {
  it('is true only for statuses with no way out', () => {
    expect(isTerminal('run', 'succeeded')).toBe(true);
    expect(isTerminal('run', 'running')).toBe(false);
    expect(isTerminal('target', 'skipped')).toBe(true);
    expect(isTerminal('step', 'timed_out')).toBe(true);
    expect(isTerminal('step', 'waiting_approval')).toBe(false);
  });
});
