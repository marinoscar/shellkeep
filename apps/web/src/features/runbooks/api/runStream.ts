/**
 * The live run stream (issue #65): `GET /api/runbook-runs/:id/logs/stream` (or one target's
 * `.../targets/:targetId/logs/stream`) read with `fetch`, because the route is guarded by the
 * ordinary bearer `@Auth()` and `EventSource` cannot send an `Authorization` header (the token
 * never goes in a URL). The SSE framing is the platform's `SseParser`.
 *
 * Unlike the platform's `connectSse` (the notification feed, which has no replay), this API
 * DOES honour `Last-Event-ID`: every `chunk` frame carries `id: <stepRowId>:<seq>` and a
 * reconnect sends the last one seen, so the server replays the chunks after it. The log views
 * still drop a `(stepRowId, seq)` they already hold (`LogBuffer`), because the replay and the
 * live tail can overlap at the seam.
 *
 * After `maxFailures` consecutive failed attempts (an attempt that never delivered its
 * `snapshot`) the stream gives up and calls `onGiveUp`: the caller polls instead.
 */
import { SseParser } from '@marinoscar/platform-web/core';
import { API_BASE_URL, api } from '../../../services/api';
import type { RunEvent, RunSnapshot } from './types';

export type RunStreamState = 'connecting' | 'open' | 'reconnecting' | 'gave_up' | 'closed';

export interface RunStreamOptions {
  runId: string;
  /** Only this server's events. */
  targetId?: string;
  onSnapshot: (snapshot: RunSnapshot) => void;
  onEvent: (event: RunEvent) => void;
  onStateChange?: (state: RunStreamState) => void;
  /** Called once, after `maxFailures` consecutive failures: switch to polling. */
  onGiveUp?: () => void;
  /** Default 3. */
  maxFailures?: number;
  /** Test seams. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** The `Last-Event-ID` of the first attempt (a view that already holds chunks). */
  lastEventId?: string | null;
}

export interface RunStreamConnection {
  close: () => void;
  /** The last chunk id seen: what the next reconnect sends. */
  lastEventId: () => string | null;
}

export function runStreamUrl(runId: string, targetId?: string): string {
  return targetId
    ? `${API_BASE_URL}/runbook-runs/${runId}/targets/${targetId}/logs/stream`
    : `${API_BASE_URL}/runbook-runs/${runId}/logs/stream`;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function openRunStream(options: RunStreamOptions): RunStreamConnection {
  const fetchImpl = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const sleep = options.sleep ?? defaultSleep;
  const maxFailures = options.maxFailures ?? 3;
  let lastEventId: string | null = options.lastEventId ?? null;
  let closed = false;
  let controller: AbortController | null = null;

  const setState = (state: RunStreamState) => {
    if (!closed || state === 'closed') options.onStateChange?.(state);
  };

  const dispatch = (event: string, data: string, sawSnapshot: () => void) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    if (event === 'snapshot') {
      sawSnapshot();
      options.onSnapshot(parsed as RunSnapshot);
    } else if (event === 'chunk' || event === 'step' || event === 'target' || event === 'run' || event === 'approval') {
      options.onEvent(parsed as RunEvent);
    }
    // `heartbeat` and unknown frames: nothing to do.
  };

  /** One attempt. Resolves `true` when it delivered a snapshot (a healthy connection). */
  const attempt = async (): Promise<boolean> => {
    controller = new AbortController();
    let healthy = false;
    const headers: Record<string, string> = { Accept: 'text/event-stream' };
    const token = api.getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (lastEventId) headers['Last-Event-ID'] = lastEventId;
    try {
      let response = await fetchImpl(runStreamUrl(options.runId, options.targetId), {
        headers,
        credentials: 'include',
        signal: controller.signal,
      });
      if (response.status === 401 && (await api.refreshToken())) {
        const fresh = api.getAccessToken();
        if (fresh) headers.Authorization = `Bearer ${fresh}`;
        response = await fetchImpl(runStreamUrl(options.runId, options.targetId), {
          headers,
          credentials: 'include',
          signal: controller.signal,
        });
      }
      if (!response.ok || !response.body) return false;
      setState('open');
      const parser = new SseParser();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const frame of parser.push(decoder.decode(value, { stream: true }))) {
          if (frame.id) lastEventId = frame.id;
          dispatch(frame.event, frame.data, () => {
            healthy = true;
          });
        }
      }
    } catch {
      // A network error or an abort: the loop decides.
    }
    return healthy;
  };

  void (async () => {
    let failures = 0;
    setState('connecting');
    while (!closed) {
      const healthy = await attempt();
      if (closed) break;
      failures = healthy ? 0 : failures + 1;
      if (failures >= maxFailures) {
        setState('gave_up');
        options.onGiveUp?.();
        return;
      }
      setState('reconnecting');
      await sleep(Math.min(1000 * 2 ** failures, 10_000));
    }
  })();

  return {
    close: () => {
      if (closed) return;
      closed = true;
      controller?.abort();
      setState('closed');
    },
    lastEventId: () => lastEventId,
  };
}
