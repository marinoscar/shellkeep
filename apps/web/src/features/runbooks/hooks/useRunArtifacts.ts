import { useCallback, useEffect, useRef, useState } from 'react';
import { getRunArtifacts, requestRunBundle } from '../api/runbooksApi';
import type { RunArtifacts } from '../api/types';
import { errorMessage } from './useAsync';

/** How often the list is read again while a bundle is being built. */
export const BUNDLE_POLL_MS = 3000;

/**
 * The artifacts of one run: the per-server archives and the bundle state. While the bundle is
 * `building` the list is polled every {@link BUNDLE_POLL_MS}; `build()` queues it (deduplicated by the API).
 */
export function useRunArtifacts(runId: string) {
  const [data, setData] = useState<RunArtifacts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const generation = useRef(0);

  const load = useCallback(async () => {
    const mine = ++generation.current;
    try {
      const value = await getRunArtifacts(runId);
      if (mine === generation.current) {
        setData(value);
        setError(null);
      }
    } catch (err) {
      if (mine === generation.current) setError(errorMessage(err));
    } finally {
      if (mine === generation.current) setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    setLoading(true);
    void load();
    return () => {
      generation.current += 1;
    };
  }, [load]);

  const status = data?.bundle.status;
  useEffect(() => {
    if (status !== 'building') return undefined;
    const timer = setInterval(() => void load(), BUNDLE_POLL_MS);
    return () => clearInterval(timer);
  }, [status, load]);

  const build = useCallback(async () => {
    setBuilding(true);
    setError(null);
    try {
      await requestRunBundle(runId);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBuilding(false);
    }
  }, [runId, load]);

  return { data, loading, error, building, build, reload: load };
}
