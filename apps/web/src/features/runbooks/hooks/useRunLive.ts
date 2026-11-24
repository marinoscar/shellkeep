/**
 * One run, kept live (issue #65): `GET /api/runbook-runs/:id` once, then the run stream patches it
 * in place (`applySnapshot`, `applyRunEvent`): no refetch per event. An `approval` event refetches
 * once, debounced. After three failed stream attempts the hook polls every 5 s instead.
 *
 * Log chunks are not state: they go to the subscribers (the log drawer) through `onChunk`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getRun } from '../api/runbooksApi';
import { openRunStream, type RunStreamState } from '../api/runStream';
import type { RunChunkEvent, RunDetail } from '../api/types';
import { applyRunEvent, applySnapshot, isRunFinished } from '../lib/runState';
import { errorMessage } from './useAsync';

export const POLL_INTERVAL_MS = 5000;

export interface RunLive {
  run: RunDetail | null;
  loading: boolean;
  error: string | null;
  streamState: RunStreamState | 'polling';
  reload: () => Promise<void>;
  /** Subscribe to the live log chunks of the run; returns the unsubscribe. */
  onChunk: (listener: (chunk: RunChunkEvent) => void) => () => void;
}

export function useRunLive(runId: string | undefined): RunLive {
  const [run, setRun] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [streamState, setStreamState] = useState<RunLive['streamState']>('connecting');
  const listeners = useRef(new Set<(chunk: RunChunkEvent) => void>());
  const pendingSnapshot = useRef<Parameters<typeof applySnapshot>[1] | null>(null);

  const reload = useCallback(async () => {
    if (!runId) return;
    try {
      const fresh = await getRun(runId);
      setRun(fresh);
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'Could not load the run'));
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    if (!runId) return undefined;
    setLoading(true);
    setRun(null);
    let cancelled = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let approvalTimer: ReturnType<typeof setTimeout> | null = null;

    void (async () => {
      await reload();
      if (cancelled) return;
      // A snapshot that arrived before the first GET resolved.
      if (pendingSnapshot.current) {
        const snap = pendingSnapshot.current;
        pendingSnapshot.current = null;
        setRun((current) => (current ? applySnapshot(current, snap) : current));
      }
    })();

    const connection = openRunStream({
      runId,
      onStateChange: (state) => {
        if (!cancelled) setStreamState(state);
      },
      onSnapshot: (snapshot) => {
        setRun((current) => {
          if (!current) {
            pendingSnapshot.current = snapshot;
            return current;
          }
          return applySnapshot(current, snapshot);
        });
      },
      onEvent: (event) => {
        if (event.type === 'chunk') {
          for (const listener of listeners.current) listener(event);
          return;
        }
        if (event.type === 'approval') {
          if (approvalTimer) clearTimeout(approvalTimer);
          approvalTimer = setTimeout(() => void reload(), 500);
          return;
        }
        setRun((current) => (current ? applyRunEvent(current, event) : current));
      },
      onGiveUp: () => {
        if (cancelled) return;
        setStreamState('polling');
        pollTimer = setInterval(() => void reload(), POLL_INTERVAL_MS);
      },
    });

    return () => {
      cancelled = true;
      connection.close();
      if (pollTimer) clearInterval(pollTimer);
      if (approvalTimer) clearTimeout(approvalTimer);
    };
  }, [runId, reload]);

  // Stop polling once the run is over: nothing will change.
  const finished = run ? isRunFinished(run.status) : false;
  useEffect(() => {
    if (finished && streamState === 'polling') setStreamState('closed');
  }, [finished, streamState]);

  const onChunk = useCallback((listener: (chunk: RunChunkEvent) => void) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  return { run, loading, error, streamState, reload, onChunk };
}
