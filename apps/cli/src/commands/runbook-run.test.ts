import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetCliForTests, useTestCliIdentity } from '@marinoscar/platform-cli/testing';

import { type Call, fakeRunbookDeps, programWith } from '../__support__/fakes.js';
import { APP_CLI_OPTIONS } from '../app.js';

import { CommandExit } from './exit.js';
import { coerceParams, parsePairs, parseTargets } from './runbook-run.js';
import { runbookCommand } from './runbook.js';

const RUNBOOK = '11111111-1111-4111-8111-111111111111';
const SERVER_A = '22222222-2222-4222-8222-222222222222';
const SERVER_B = '33333333-3333-4333-8333-333333333333';
const RUN = '44444444-4444-4444-8444-444444444444';

let restore: () => void;
beforeEach(() => {
  resetCliForTests();
  restore = useTestCliIdentity(APP_CLI_OPTIONS.identity, '0.1.0');
});
afterEach(() => restore());

const step = (stepIndex: number, status: string) => ({ stepIndex, name: `step ${stepIndex + 1}`, status, exitCode: status === 'succeeded' ? 0 : 1, durationMs: 10 });
const target = (id: string, serverName: string, status: string) => ({
  id,
  serverProfileId: id,
  serverName,
  status,
  steps: [step(0, status === 'succeeded' ? 'succeeded' : 'failed')],
});

/** A run response that moves through `statuses`, one per GET. */
function runResponses(statuses: Array<{ status: string; targets: ReturnType<typeof target>[] }>) {
  let reads = 0;
  return (call: Call): unknown => {
    if (call.method === 'POST') return { runId: RUN };
    const state = statuses[Math.min(reads, statuses.length - 1)]!;
    reads += 1;
    return { id: RUN, runbookName: 'Patch', status: state.status, counts: { total: state.targets.length }, targets: state.targets, params: { TOKEN: 'leaked' } };
  };
}

async function run(args: string[], respond: (call: Call) => unknown) {
  const harness = fakeRunbookDeps(respond);
  const program = programWith((root) => runbookCommand(harness.deps)(root));
  let failure: unknown;
  try {
    await program.parseAsync(['runbook', 'run', RUNBOOK, ...args], { from: 'user' });
  } catch (error) {
    failure = error;
  }
  return { ...harness, failure };
}

describe('parsing', () => {
  it('splits --targets into server ids and tags', () => {
    expect(parseTargets(`${SERVER_A},tag:staging, tag:web ,${SERVER_B}`)).toEqual({ serverIds: [SERVER_A, SERVER_B], tags: { any: ['staging', 'web'] } });
    expect(parseTargets('tag:prod')).toEqual({ tags: { any: ['prod'] } });
  });

  it('refuses an entry that is neither an id nor a tag', () => {
    expect(() => parseTargets('web-01')).toThrow(/neither a server id nor tag/);
    expect(() => parseTargets('tag:')).toThrow(/tag name/);
    expect(() => parseTargets(' , ')).toThrow(/empty/);
  });

  it('parses NAME=value pairs and types them by the definition', () => {
    expect(parsePairs('--param', ['A=1', 'B=x=y'])).toEqual({ A: '1', B: 'x=y' });
    expect(() => parsePairs('--param', ['nope'])).toThrow(/NAME=value/);
    const defs = [
      { name: 'COUNT', type: 'number' },
      { name: 'FORCE', type: 'boolean' },
      { name: 'NOTE', type: 'string' },
      { name: 'PASSWORD', type: 'secret' },
    ];
    expect(coerceParams({ COUNT: '3', FORCE: 'true', NOTE: 'hi' }, defs)).toEqual({ COUNT: 3, FORCE: true, NOTE: 'hi' });
    expect(() => coerceParams({ COUNT: 'x' }, defs)).toThrow(/number/);
    expect(() => coerceParams({ NOPE: '1' }, defs)).toThrow(/no parameter/);
  });

  it('refuses a secret value on the command line, naming --secret-ref', () => {
    expect(() => coerceParams({ PASSWORD: 'hunter2' }, [{ name: 'PASSWORD', type: 'secret' }])).toThrow(/--secret-ref/);
  });
});

describe('runbook run', () => {
  it('starts a run and exits 0 without waiting', async () => {
    const { calls, out, failure } = await run([`--targets`, `${SERVER_A},tag:staging`], (call) => (call.method === 'POST' ? { runId: RUN } : undefined));

    expect(failure).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: 'POST', path: `/runbooks/${RUNBOOK}/runs` });
    expect(calls[0]?.body).toEqual({ params: {}, secretRefs: {}, targets: { serverIds: [SERVER_A], tags: { any: ['staging'] } } });
    expect(out()).toContain(`Started run ${RUN}`);
  });

  it('--json without --wait prints the run id', async () => {
    const { out } = await run(['--json'], () => ({ runId: RUN }));
    expect(JSON.parse(out())).toEqual({ runId: RUN });
  });

  it('--wait exits 0 when every target succeeded', async () => {
    const done = { status: 'succeeded', targets: [target(SERVER_A, 'alpha', 'succeeded'), target(SERVER_B, 'beta', 'succeeded')] };
    const { failure, out, sleeps, calls } = await run(
      ['--wait'],
      runResponses([{ status: 'running', targets: [target(SERVER_A, 'alpha', 'running'), target(SERVER_B, 'beta', 'queued')] }, done]),
    );

    expect(failure).toBeUndefined();
    expect(sleeps).toEqual([3000]);
    expect(calls.filter((call) => call.method === 'GET')).toHaveLength(2);
    expect(out()).toContain('alpha');
    expect(out()).toContain('succeeded');
  });

  it('--wait exits 1 when a target failed', async () => {
    const { failure } = await run(
      ['--wait'],
      runResponses([{ status: 'partially_failed', targets: [target(SERVER_A, 'alpha', 'succeeded'), target(SERVER_B, 'beta', 'failed')] }]),
    );

    expect(failure).toBeInstanceOf(CommandExit);
    expect((failure as CommandExit).exitCode).toBe(1);
  });

  it('--wait exits 1 for a run marked succeeded while a target is not (never trusts the run alone)', async () => {
    const { failure } = await run(['--wait'], runResponses([{ status: 'succeeded', targets: [target(SERVER_A, 'alpha', 'succeeded'), target(SERVER_B, 'beta', 'skipped')] }]));
    expect((failure as CommandExit).exitCode).toBe(1);
  });

  it('--wait exits 1 for a cancelled run', async () => {
    const { failure } = await run(['--wait'], runResponses([{ status: 'cancelled', targets: [target(SERVER_A, 'alpha', 'cancelled')] }]));
    expect((failure as CommandExit).exitCode).toBe(1);
  });

  it('--wait --json prints the final run, without parameters, and still exits by the outcome', async () => {
    const { failure, out } = await run(
      ['--wait', '--json'],
      runResponses([{ status: 'failed', targets: [target(SERVER_A, 'alpha', 'failed')] }]),
    );

    const printed = JSON.parse(out()) as Record<string, unknown>;
    expect(printed).toMatchObject({ id: RUN, status: 'failed', succeeded: false, finished: true, timedOut: false });
    expect(out()).not.toContain('leaked');
    expect(printed).not.toHaveProperty('params');
    expect((failure as CommandExit).exitCode).toBe(1);
  });

  it('--wait --json exits 0 on success', async () => {
    const { failure, out } = await run(['--wait', '--json'], runResponses([{ status: 'succeeded', targets: [target(SERVER_A, 'alpha', 'succeeded')] }]));
    expect(failure).toBeUndefined();
    expect(JSON.parse(out())).toMatchObject({ succeeded: true });
  });

  it('--timeout stops waiting, exit 1, and says the run continues', async () => {
    const running = { status: 'running', targets: [target(SERVER_A, 'alpha', 'running')] };
    const { failure, sleeps } = await run(['--wait', '--interval', '1', '--timeout', '2'], runResponses([running]));

    expect(sleeps).toEqual([1000, 1000]);
    expect((failure as CommandExit).exitCode).toBe(1);
    expect((failure as CommandExit).message).toMatch(/timed out/);
  });

  it('--dry-run sends dryRun, always waits, and prints the per-target plan', async () => {
    const dryRun = (status: string, targets: unknown[]) => ({ id: RUN, runbookName: 'Patch', status, dryRun: true, counts: { total: targets.length }, targets });
    const planTarget = (id: string, name: string) => ({
      id,
      serverProfileId: id,
      serverName: name,
      status: 'succeeded',
      steps: [step(0, 'succeeded'), { stepIndex: 1, name: 'gate', status: 'skipped', exitCode: null, durationMs: null }],
    });
    const { failure, calls, out, err } = await run(['--dry-run', '--targets', `${SERVER_A}`], (call) =>
      call.method === 'POST' ? { runId: RUN } : dryRun('succeeded', [planTarget(SERVER_A, 'alpha')]),
    );

    expect(failure).toBeUndefined();
    expect(calls[0]).toMatchObject({ method: 'POST', body: { dryRun: true, params: {}, secretRefs: {} } });
    expect(calls.some((c) => c.method === 'GET')).toBe(true);
    expect(err()).toContain('DRY RUN run');
    expect(out()).toContain('would_run');
    expect(out()).toContain('not_simulated');
    expect(out()).toContain('nothing was executed');
  });

  it('--dry-run --json carries the plan and exits 1 when a precondition failed', async () => {
    const failing = { id: SERVER_A, serverProfileId: SERVER_A, serverName: 'alpha', status: 'failed', steps: [step(0, 'failed')] };
    const { failure, out } = await run(['--dry-run', '--json'], (call) =>
      call.method === 'POST' ? { runId: RUN } : { id: RUN, status: 'failed', dryRun: true, counts: { total: 1 }, targets: [failing] },
    );

    expect((failure as CommandExit).exitCode).toBe(1);
    expect((failure as CommandExit).message).toMatch(/would run cleanly/);
    const body = JSON.parse(out());
    expect(body).toMatchObject({ dryRun: true, plan: [{ server: 'alpha', steps: [{ index: 0, verdict: 'precondition_failed' }] }] });
  });

  it('a real run does not send dryRun', async () => {
    const { calls } = await run([], () => ({ runId: RUN }));
    expect(calls[0]?.body).not.toHaveProperty('dryRun');
  });

  it('reads the definition to type --param values and sends secret refs by name', async () => {
    const { calls, failure } = await run(
      ['--param', 'COUNT=3', '--param', 'FORCE=false', '--secret-ref', 'API_KEY=deploy-key', '--runbook-version', '2'],
      (call) => {
        if (call.method === 'POST') return { runId: RUN };
        return { version: 2, definition: { parameters: [{ name: 'COUNT', type: 'number' }, { name: 'FORCE', type: 'boolean' }, { name: 'API_KEY', type: 'secret' }] } };
      },
    );

    expect(failure).toBeUndefined();
    expect(calls[0]).toMatchObject({ method: 'GET', path: `/runbooks/${RUNBOOK}/versions/2` });
    expect(calls[1]?.body).toEqual({ version: 2, params: { COUNT: 3, FORCE: false }, secretRefs: { API_KEY: 'deploy-key' } });
  });

  it('a usage error starts nothing', async () => {
    const { failure, calls } = await run(['--targets', 'web-01'], () => ({ runId: RUN }));
    expect((failure as { exitCode: number }).exitCode).toBe(2);
    expect(calls).toEqual([]);
  });
});
