import { LogSink, TRUNCATED_MARKER, splitUtf8, tailUtf8, type SinkStream } from './log-sink';
import type { RunEvent } from './run-events';

const SECRET = ['sentinel', 'secret', Math.random().toString(36).slice(2, 10)].join('-');

function harness(over: { secrets?: string[]; maxBytes?: number } = {}) {
  const chunks: Array<{ runStepId: string; seq: number; stream: SinkStream; data: string; bytes: number }> = [];
  const events: RunEvent[] = [];
  const sink = new LogSink({
    runId: 'run',
    targetId: 'target',
    stepIndex: 2,
    runStepId: 'step-row',
    secrets: over.secrets ?? [],
    maxBytes: over.maxBytes ?? 1_000_000,
    idleFlushMs: 20,
    ports: {
      insertChunk: async (c) => void chunks.push(c),
      publish: async (e) => void events.push(e),
    },
  });
  return { sink, chunks, events, text: () => chunks.map((c) => c.data).join('') };
}

describe('LogSink', () => {
  it('redacts the exact secret values and publishes the redacted text only', async () => {
    const h = harness({ secrets: [SECRET] });
    h.sink.push('stdout', Buffer.from(`token is ${SECRET} ok\n`));
    await h.sink.close();
    expect(h.text()).toBe('token is [REDACTED:literal] ok\n');
    expect(JSON.stringify(h.events)).not.toContain(SECRET);
    expect(h.sink.outputTail()).not.toContain(SECRET);
  });

  it('never lets a secret straddle two reads (line buffering)', async () => {
    const h = harness({ secrets: [SECRET] });
    h.sink.push('stdout', Buffer.from(`a ${SECRET.slice(0, 7)}`));
    h.sink.push('stdout', Buffer.from(`${SECRET.slice(7)} b\n`));
    await h.sink.close();
    expect(h.text()).toBe('a [REDACTED:literal] b\n');
  });

  it('holds back enough of a multi-line secret to redact it whole', async () => {
    const multi = `${SECRET}\nline-two-${SECRET}`;
    const h = harness({ secrets: [multi] });
    h.sink.push('stdout', Buffer.from(`x ${multi.slice(0, 12)}`));
    h.sink.push('stdout', Buffer.from(`${multi.slice(12)} y\n`));
    await h.sink.close();
    expect(h.text()).not.toContain(SECRET);
    expect(h.text()).toContain('[REDACTED:literal]');
  });

  it('assigns increasing seq numbers and publishes each chunk with its ids', async () => {
    const h = harness();
    h.sink.push('stdout', Buffer.from('one\n'));
    h.sink.push('stderr', Buffer.from('two\n'));
    await h.sink.close();
    expect(h.chunks.map((c) => c.seq)).toEqual([0, 1]);
    expect(h.chunks.map((c) => c.stream)).toEqual(['stdout', 'stderr']);
    expect(h.events[0]).toMatchObject({ type: 'chunk', runId: 'run', targetId: 'target', stepIndex: 2, stepRowId: 'step-row', seq: 0 });
  });

  it('splits a long output into chunks of at most 4 KiB without cutting a multi-byte character', async () => {
    const h = harness();
    h.sink.push('stdout', Buffer.from(`${'é'.repeat(5_000)}\n`));
    await h.sink.close();
    expect(h.chunks.length).toBeGreaterThan(2);
    for (const c of h.chunks) expect(Buffer.byteLength(c.data, 'utf8')).toBeLessThanOrEqual(4096);
    expect(h.text()).toBe(`${'é'.repeat(5_000)}\n`);
  });

  it('carries a multi-byte character split across two reads', async () => {
    const h = harness();
    const bytes = Buffer.from('€\n');
    h.sink.push('stdout', bytes.subarray(0, 1));
    h.sink.push('stdout', bytes.subarray(1));
    await h.sink.close();
    expect(h.text()).toBe('€\n');
  });

  it('caps the output: one system marker, then nothing, and `truncated` is set', async () => {
    const h = harness({ maxBytes: 50 });
    h.sink.push('stdout', Buffer.from(`${'x'.repeat(40)}\n`));
    h.sink.push('stdout', Buffer.from(`${'y'.repeat(40)}\n`));
    h.sink.push('stdout', Buffer.from('more\n'));
    await h.sink.close();
    expect(h.sink.truncated).toBe(true);
    expect(h.chunks.filter((c) => c.stream === 'system')).toEqual([expect.objectContaining({ data: TRUNCATED_MARKER })]);
    expect(h.text()).not.toContain('more');
  });

  it('flushes a partial line after the idle delay', async () => {
    const h = harness();
    h.sink.push('stdout', Buffer.from('progress 50%'));
    expect(h.chunks).toHaveLength(0);
    await new Promise((r) => setTimeout(r, 80));
    await h.sink.close();
    expect(h.text()).toBe('progress 50%');
  });

  it('keeps the tail for the matrix', async () => {
    const h = harness();
    h.sink.push('stdout', Buffer.from(`${'a'.repeat(10_000)}END\n`));
    await h.sink.close();
    expect(Buffer.byteLength(h.sink.outputTail())).toBeLessThanOrEqual(4096);
    expect(h.sink.outputTail().endsWith('END\n')).toBe(true);
  });
});

describe('utf8 helpers', () => {
  it('splitUtf8 and tailUtf8 respect character boundaries', () => {
    expect(splitUtf8('aé€😀', 3).join('')).toBe('aé€😀');
    expect(splitUtf8('€€€', 3)).toEqual(['€', '€', '€']);
    expect(tailUtf8('€€€', 4)).toBe('€');
    expect(tailUtf8('abc', 10)).toBe('abc');
  });
});
