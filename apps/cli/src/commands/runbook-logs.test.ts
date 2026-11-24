import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetCliForTests, useTestCliIdentity } from '@marinoscar/platform-cli/testing';

import { fakeRunbookDeps, programWith, sseFrame, sseResponse } from '../__support__/fakes.js';
import { APP_CLI_OPTIONS } from '../app.js';

import { CommandExit } from './exit.js';
import { readSse } from './runbook-http.js';
import { FROM_START_EVENT_ID, RECONNECT_LIMIT, followLogs } from './runbook-logs.js';
import { runbookCommand } from './runbook.js';

const RUN = '44444444-4444-4444-8444-444444444444';
const T1 = '55555555-5555-4555-8555-555555555555';
const T2 = '66666666-6666-4666-8666-666666666666';
const STEP = '77777777-7777-4777-8777-777777777777';

let restore: () => void;
beforeEach(() => {
  resetCliForTests();
  restore = useTestCliIdentity(APP_CLI_OPTIONS.identity, '0.1.0');
});
afterEach(() => restore());

const runBody = (status: string, targets: string[] = [T1]) => ({
  id: RUN,
  status,
  targets: targets.map((id, index) => ({
    id,
    serverProfileId: `s${index}`,
    serverName: index === 0 ? 'alpha' : 'beta',
    status: 'running',
    steps: [{ stepIndex: 0, name: 'update', status: 'running' }],
  })),
});

const chunk = (seq: number, data: string, targetId = T1) =>
  sseFrame('chunk', { type: 'chunk', runId: RUN, targetId, stepIndex: 0, stepRowId: STEP, seq, stream: 'stdout', data }, `${STEP}:${seq}`);

function bodyOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const text of chunks) controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

async function collect(chunks: string[]) {
  const events = [];
  for await (const event of readSse(bodyOf(chunks))) events.push(event);
  return events;
}

describe('the SSE reader', () => {
  it('parses events split across reads, comments, CRLF and multi-line data', async () => {
    const events = await collect([': hello\n\nid: 1:2\nevent: chu', 'nk\ndata: a\ndata: b\n\n', 'event: heartbeat\r\ndata: {}\r\n\r\n']);
    expect(events).toEqual([
      { id: '1:2', event: 'chunk', data: 'a\nb' },
      { id: '1:2', event: 'heartbeat', data: '{}' },
    ]);
  });
});

describe('runbook logs (no follow)', () => {
  it('prints the log of every started step, redaction being the server\'s', async () => {
    const harness = fakeRunbookDeps(
      () => ({ ...runBody('succeeded'), targets: [{ id: T1, serverName: 'alpha', status: 'succeeded', steps: [{ stepIndex: 0, status: 'succeeded' }, { stepIndex: 1, status: 'pending' }] }] }),
      (call) => (call.path === `/runbook-runs/${RUN}/targets/${T1}/steps/0/log` ? new Response('updated 3 packages\n') : new Response('no', { status: 500 })),
    );
    const program = programWith((root) => runbookCommand(harness.deps)(root));

    await program.parseAsync(['runbook', 'logs', RUN], { from: 'user' });

    expect(harness.out()).toBe('updated 3 packages\n');
    expect(harness.fetched).toHaveLength(1);
  });

  it('prefixes lines with the server when several are shown, and --target narrows to one', async () => {
    const respond = () => ({
      id: RUN,
      status: 'failed',
      targets: [
        { id: T1, serverProfileId: 's0', serverName: 'alpha', status: 'succeeded', steps: [{ stepIndex: 0, status: 'succeeded' }] },
        { id: T2, serverProfileId: 's1', serverName: 'beta', status: 'failed', steps: [{ stepIndex: 0, status: 'failed' }] },
      ],
    });
    const handler = (call: { path: string }) => new Response(call.path.includes(T1) ? 'one\ntwo\n' : 'boom\n');

    const both = fakeRunbookDeps(respond, handler);
    await programWith((root) => runbookCommand(both.deps)(root)).parseAsync(['runbook', 'logs', RUN], { from: 'user' });
    expect(both.out()).toBe('[alpha] one\n[alpha] two\n[beta] boom\n');

    const one = fakeRunbookDeps(respond, handler);
    await programWith((root) => runbookCommand(one.deps)(root)).parseAsync(['runbook', 'logs', RUN, '--target', 's1'], { from: 'user' });
    expect(one.out()).toBe('boom\n');

    const missing = fakeRunbookDeps(respond, handler);
    await expect(programWith((root) => runbookCommand(missing.deps)(root)).parseAsync(['runbook', 'logs', RUN, '--target', 'nope'], { from: 'user' })).rejects.toBeInstanceOf(CommandExit);
  });
});

describe('runbook logs --follow', () => {
  it('streams chunks until the run event ends it, asking for everything stored on the first connection', async () => {
    const harness = fakeRunbookDeps(
      () => runBody('running'),
      () =>
        sseResponse([
          sseFrame('snapshot', { run: { id: RUN, status: 'running' }, targets: [], steps: [] }),
          chunk(0, 'hello '),
          sseFrame('heartbeat', {}),
          chunk(1, 'world\n'),
          sseFrame('run', { type: 'run', runId: RUN, status: 'succeeded' }),
        ], { hang: true }),
    );
    await followLogs(harness.deps, RUN, undefined);

    expect(harness.out()).toBe('hello world\n');
    expect(harness.fetched).toHaveLength(1);
    expect(harness.fetched[0]).toMatchObject({ path: `/runbook-runs/${RUN}/logs/stream` });
    expect(harness.fetched[0]?.headers['last-event-id']).toBe(FROM_START_EVENT_ID);
    expect(harness.fetched[0]?.headers.accept).toBe('text/event-stream');
  });

  it('reconnects with the id of the last chunk and does not repeat or lose output', async () => {
    const harness = fakeRunbookDeps(
      () => runBody('running'),
      (_call, attempt) =>
        attempt === 0
          ? sseResponse([sseFrame('snapshot', { run: { status: 'running' } }), chunk(0, 'a\n'), chunk(1, 'b\n')]) // the connection drops here
          : sseResponse([sseFrame('snapshot', { run: { status: 'running' } }), chunk(2, 'c\n'), sseFrame('run', { status: 'failed' })], { hang: true }),
    );

    await followLogs(harness.deps, RUN, undefined);

    expect(harness.out()).toBe('a\nb\nc\n');
    expect(harness.fetched).toHaveLength(2);
    expect(harness.fetched[1]?.headers['last-event-id']).toBe(`${STEP}:1`);
    expect(harness.sleeps).toEqual([1000]);
  });

  it('backs off between failed attempts and gives up after the limit', async () => {
    const harness = fakeRunbookDeps(() => runBody('running'), () => new Response('unavailable', { status: 503 }));

    const failure = await followLogs(harness.deps, RUN, undefined).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(CommandExit);
    expect((failure as CommandExit).exitCode).toBe(1);
    expect(harness.fetched).toHaveLength(RECONNECT_LIMIT + 1);
    expect(harness.sleeps).toEqual([1000, 2000, 4000, 8000, 10000, 10000]);
  });

  it('does not retry a refusal', async () => {
    const harness = fakeRunbookDeps(() => runBody('running'), () => new Response('forbidden', { status: 403 }));
    const failure = await followLogs(harness.deps, RUN, undefined).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(CommandExit);
    expect(harness.fetched).toHaveLength(1);
  });

  it('a reconnect after the run ended replays what was missed, then stops', async () => {
    const harness = fakeRunbookDeps(
      () => runBody('running'),
      (_call, attempt) =>
        attempt === 0
          ? sseResponse([chunk(0, 'a\n')])
          : sseResponse([sseFrame('snapshot', { run: { status: 'succeeded' } }), chunk(1, 'b\n')], { hang: true }),
    );

    await followLogs(harness.deps, RUN, undefined, { idleMs: 20 });

    expect(harness.out()).toBe('a\nb\n');
  });

  it('--target uses the per-target stream and needs no prefix', async () => {
    const harness = fakeRunbookDeps(
      () => runBody('running', [T1, T2]),
      () => sseResponse([chunk(0, 'only beta\n', T2), sseFrame('run', { status: 'succeeded' })], { hang: true }),
    );
    await followLogs(harness.deps, RUN, 's1');
    expect(harness.fetched[0]?.path).toBe(`/runbook-runs/${RUN}/targets/${T2}/logs/stream`);
    expect(harness.out()).toBe('only beta\n');
  });

  it('prefixes interleaved output of several servers by line, across chunk boundaries', async () => {
    const harness = fakeRunbookDeps(
      () => runBody('running', [T1, T2]),
      () => sseResponse([chunk(0, 'par', T1), chunk(1, 'x\n', T2), chunk(2, 'tial\n', T1), sseFrame('run', { status: 'succeeded' })], { hang: true }),
    );
    await followLogs(harness.deps, RUN, undefined);
    expect(harness.out()).toBe('[alpha] par[beta] x\ntial\n');
  });

  it('--json writes one object per chunk', async () => {
    const harness = fakeRunbookDeps(
      () => runBody('running'),
      () => sseResponse([chunk(0, 'hi\n'), sseFrame('run', { status: 'succeeded' })], { hang: true }),
    );
    await followLogs(harness.deps, RUN, undefined, { json: true });
    expect(JSON.parse(harness.out().trim())).toEqual({ server: 'alpha', targetId: T1, step: 1, stream: 'stdout', data: 'hi\n' });
  });

  it('a run that already ended is dumped from the stored logs, with no stream', async () => {
    const harness = fakeRunbookDeps(
      () => ({ id: RUN, status: 'succeeded', targets: [{ id: T1, serverName: 'alpha', status: 'succeeded', steps: [{ stepIndex: 0, status: 'succeeded' }] }] }),
      () => new Response('stored\n'),
    );
    await followLogs(harness.deps, RUN, undefined);
    expect(harness.out()).toBe('stored\n');
    expect(harness.fetched.map((call) => call.path)).toEqual([`/runbook-runs/${RUN}/targets/${T1}/steps/0/log`]);
  });
});
