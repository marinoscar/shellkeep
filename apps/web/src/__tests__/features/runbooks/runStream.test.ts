import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openRunStream } from '../../../features/runbooks/api/runStream';
import { api } from '../../../services/api';
import { RUN_ID } from './fixtures';

/** A response whose body is the given SSE text, then closes (a server disconnect). */
function sseResponse(text: string): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

const SNAPSHOT = `event: snapshot\ndata: ${JSON.stringify({ run: { id: RUN_ID, status: 'running', finishedAt: null }, targets: [], steps: [] })}\n\n`;
const chunk = (seq: number, data: string) =>
  `id: aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:${seq}\nevent: chunk\ndata: ${JSON.stringify({ type: 'chunk', runId: RUN_ID, targetId: 't', stepIndex: 0, stepRowId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', seq, stream: 'stdout', data })}\n\n`;

const header = (init: RequestInit | undefined, name: string) => (init?.headers as Record<string, string> | undefined)?.[name];

describe('openRunStream', () => {
  beforeEach(() => {
    api.setAccessToken('token-a');
  });

  it('sends the bearer token, and on reconnect sends Last-Event-ID so the server replays from there', async () => {
    const calls: RequestInit[] = [];
    let attempt = 0;
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      calls.push(init!);
      attempt += 1;
      if (attempt === 1) return sseResponse(SNAPSHOT + chunk(0, 'one\n') + chunk(1, 'two\n'));
      // The replay after the reconnect: the server sends what follows the given id.
      if (attempt === 2) return sseResponse(SNAPSHOT + chunk(2, 'three\n'));
      // Then a connection that stays open.
      return new Response(new ReadableStream<Uint8Array>({ start: () => undefined }), { status: 200 });
    }) as unknown as typeof fetch;
    const events: string[] = [];
    let snapshots = 0;
    const conn = openRunStream({
      runId: RUN_ID,
      fetchImpl,
      sleep: () => Promise.resolve(),
      onSnapshot: () => {
        snapshots += 1;
      },
      onEvent: (event) => {
        if (event.type === 'chunk') events.push(event.data);
      },
    });
    await vi.waitFor(() => expect(events).toEqual(['one\n', 'two\n', 'three\n']));
    conn.close();
    expect(header(calls[0], 'Authorization')).toBe('Bearer token-a');
    expect(header(calls[0], 'Last-Event-ID')).toBeUndefined();
    expect(header(calls[1], 'Last-Event-ID')).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:1');
    expect(snapshots).toBeGreaterThanOrEqual(2);
    expect(String((fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0])).toContain(`/runbook-runs/${RUN_ID}/logs/stream`);
  });

  it('gives up after three consecutive failures so the caller can poll', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 503 })) as unknown as typeof fetch;
    const onGiveUp = vi.fn();
    const states: string[] = [];
    openRunStream({
      runId: RUN_ID,
      fetchImpl,
      sleep: () => Promise.resolve(),
      onSnapshot: () => undefined,
      onEvent: () => undefined,
      onGiveUp,
      onStateChange: (s) => states.push(s),
    });
    await vi.waitFor(() => expect(onGiveUp).toHaveBeenCalledTimes(1));
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(states.at(-1)).toBe('gave_up');
  });

  it('targets one server on its own stream path', async () => {
    const fetchImpl = vi.fn(async () => sseResponse(SNAPSHOT)) as unknown as typeof fetch;
    const conn = openRunStream({ runId: RUN_ID, targetId: 'tg', fetchImpl, sleep: () => new Promise(() => undefined), onSnapshot: () => undefined, onEvent: () => undefined });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    conn.close();
    expect(String((fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0])).toContain(`/runbook-runs/${RUN_ID}/targets/tg/logs/stream`);
  });
});
