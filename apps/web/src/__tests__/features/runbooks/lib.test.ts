import { describe, it, expect } from 'vitest';
import { LogBuffer } from '../../../features/runbooks/lib/logBuffer';
import { applyRunEvent, applySnapshot, isRunFinished } from '../../../features/runbooks/lib/runState';
import { diffLines } from '../../../features/runbooks/lib/jsonDiff';
import { emptyDefinition, issuesToFieldErrors, move, newStep, stepErrorCount } from '../../../features/runbooks/lib/builder';
import { formatCountdown, formatDuration } from '../../../features/runbooks/lib/format';
import { STEP_KINDS } from '../../../features/runbooks/api/types';
import { ApiError } from '../../../services/api';
import { parseTargetsParam, runLauncherPath } from '../../../pages/runbooks/RunLauncherPage';
import { arrangeTargets } from '../../../pages/runbooks/RunDetailPage';
import { makeRun, makeTarget, RUN_ID } from './fixtures';

describe('LogBuffer', () => {
  it('writes chunks in seq order and holds one that arrives ahead of a gap', () => {
    const buffer = new LogBuffer(0);
    expect(buffer.push({ seq: 1, data: 'b' })).toEqual([]);
    expect(buffer.held).toBe(1);
    expect(buffer.push({ seq: 0, data: 'a' })).toEqual(['a', 'b']);
    expect(buffer.push({ seq: 2, data: 'c' })).toEqual(['c']);
  });

  it('drops a replayed seq it already wrote or holds', () => {
    const buffer = new LogBuffer(0);
    buffer.push({ seq: 0, data: 'a' });
    buffer.push({ seq: 2, data: 'c' });
    expect(buffer.push({ seq: 0, data: 'a' })).toEqual([]);
    expect(buffer.push({ seq: 2, data: 'c' })).toEqual([]);
    expect(buffer.push({ seq: 1, data: 'b' })).toEqual(['b', 'c']);
  });

  it('takes the first chunk as the baseline when started without one, and flushes a gap on demand', () => {
    const buffer = new LogBuffer(null);
    expect(buffer.push({ seq: 7, data: 'x' })).toEqual(['x']);
    buffer.push({ seq: 10, data: 'z' });
    buffer.push({ seq: 9, data: 'y' });
    expect(buffer.flush()).toEqual(['y', 'z']);
    expect(buffer.expected).toBe(11);
  });
});

describe('run state patching', () => {
  it('patches a step and a target from events, recounting the targets', () => {
    const run = makeRun();
    const t0 = run.targets[0]!;
    const stepped = applyRunEvent(run, { type: 'step', runId: RUN_ID, targetId: t0.id, stepIndex: 0, status: 'failed', exitCode: 2, durationMs: 1500 });
    expect(stepped.targets[0]!.steps[0]).toMatchObject({ status: 'failed', exitCode: 2, durationMs: 1500 });
    expect(stepped.targets[1]).toBe(run.targets[1]);
    const targeted = applyRunEvent(stepped, { type: 'target', runId: RUN_ID, targetId: t0.id, status: 'failed', errorCode: 'STEP_FAILED' });
    expect(targeted.counts).toMatchObject({ total: 2, failed: 1, pending: 1 });
    expect(applyRunEvent(targeted, { type: 'run', runId: 'other', status: 'failed' })).toBe(targeted);
  });

  it('returns the same object for an event that changes nothing', () => {
    const run = makeRun();
    expect(applyRunEvent(run, { type: 'step', runId: RUN_ID, targetId: run.targets[0]!.id, stepIndex: 0, status: 'pending' })).toBe(run);
  });

  it('applies a snapshot', () => {
    const run = makeRun();
    const t1 = run.targets[1]!;
    const next = applySnapshot(run, {
      run: { id: RUN_ID, status: 'succeeded', finishedAt: '2026-01-01T00:10:00.000Z' },
      targets: [{ id: t1.id, status: 'succeeded', errorCode: null }],
      steps: [{ id: t1.steps[1]!.id, runTargetId: t1.id, stepIndex: 1, status: 'succeeded', exitCode: 0, durationMs: 20 }],
    });
    expect(next.status).toBe('succeeded');
    expect(next.targets[1]!.status).toBe('succeeded');
    expect(next.targets[1]!.steps[1]!.status).toBe('succeeded');
    expect(isRunFinished(next.status)).toBe(true);
  });

  it('filters and sorts the matrix rows', () => {
    const targets = [
      makeTarget(0, 1, { status: 'succeeded' }),
      makeTarget(1, 1, { status: 'failed' }),
      makeTarget(2, 1, { status: 'running' }),
    ];
    expect(arrangeTargets(targets, 'all', 'status').map((t) => t.status)).toEqual(['failed', 'running', 'succeeded']);
    expect(arrangeTargets(targets, 'failed', 'position').map((t) => t.position)).toEqual([1]);
  });
});

describe('builder model', () => {
  it('creates a step of every kind with a unique id', () => {
    const steps = emptyDefinition().steps;
    for (const kind of STEP_KINDS) {
      const step = newStep(kind, steps);
      expect(step.kind).toBe(kind);
      expect(step.id).toMatch(/^[a-z][a-z0-9_-]{0,47}$/);
      expect(steps.map((s) => s.id)).not.toContain(step.id);
    }
    expect(newStep('command', steps).id).toBe('command-2');
  });

  it('moves within bounds', () => {
    expect(move(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(move(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
  });

  it('maps API issue paths to field keys', () => {
    const error = new ApiError('Invalid', 422, 'RUNBOOK_DEFINITION_INVALID', {
      issues: [
        { path: ['steps', 1, 'command'], code: 'too_small', message: 'Required' },
        { path: ['definition', 'parameters', 0, 'name'], code: 'invalid', message: 'Bad name' },
      ],
    });
    const errors = issuesToFieldErrors(error)!;
    expect(errors).toEqual({ 'steps.1.command': 'Required', 'parameters.0.name': 'Bad name' });
    expect(stepErrorCount(errors, 1)).toBe(1);
    expect(stepErrorCount(errors, 0)).toBe(0);
    expect(issuesToFieldErrors(new Error('x'))).toBeNull();
  });
});

describe('formatting and links', () => {
  it('formats durations and countdowns', () => {
    expect(formatDuration(850)).toBe('850 ms');
    expect(formatDuration(12_400)).toBe('12.4 s');
    expect(formatDuration(185_000)).toBe('3m 05s');
    expect(formatDuration(3_720_000)).toBe('1h 02m');
    expect(formatCountdown(new Date(1000).toISOString(), 2000)).toBe('expired');
  });

  it('diffs two JSON documents by line', () => {
    const lines = diffLines('a\nb\nc', 'a\nc\nd');
    expect(lines).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'removed', text: 'b' },
      { kind: 'same', text: 'c' },
      { kind: 'added', text: 'd' },
    ]);
  });

  it('parses and builds the launcher deep link', () => {
    const a = '00000000-4444-4444-8444-444444444444';
    const b = '00000001-4444-4444-8444-444444444444';
    expect(parseTargetsParam(`${a},not-an-id,${b},${a}`)).toEqual([a, b]);
    expect(parseTargetsParam(null)).toEqual([]);
    expect(runLauncherPath([a, b], 'rb')).toBe(`/runbooks/rb/run?targets=${a},${b}`);
    expect(runLauncherPath([a])).toBe(`/runbooks/run?targets=${a}`);
  });
});
