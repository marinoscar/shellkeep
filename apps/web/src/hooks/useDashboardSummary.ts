import { useCallback, useEffect, useRef, useState } from 'react';
import { getDashboardSummary } from '../services/dashboard-api';
import type { DashboardSummary } from '../types/dashboard';

/** How often the summary refreshes while the page is visible. */
export const DASHBOARD_REFRESH_MS = 30_000;

export interface UseDashboardSummaryResult {
  summary: DashboardSummary | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const isVisible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';

/**
 * The Home dashboard summary (#78). Refreshes when the window regains focus or the tab
 * becomes visible again, and every {@link DASHBOARD_REFRESH_MS} while visible; a hidden tab
 * makes no requests. No WebSocket: the summary is a cheap bounded read.
 *
 * A failed refresh keeps the last summary on screen and reports the error.
 */
export function useDashboardSummary(): UseDashboardSummaryResult {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const inFlight = useRef<Promise<void> | null>(null);

  const refresh = useCallback(() => {
    if (inFlight.current) return inFlight.current;
    const run = getDashboardSummary()
      .then((next) => {
        if (!mounted.current) return;
        setSummary(next);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!mounted.current) return;
        setError(err instanceof Error ? err.message : 'Could not load the dashboard');
      })
      .finally(() => {
        inFlight.current = null;
        if (mounted.current) setIsLoading(false);
      });
    inFlight.current = run;
    return run;
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();

    const timer = window.setInterval(() => {
      if (isVisible()) void refresh();
    }, DASHBOARD_REFRESH_MS);
    const onFocus = () => void refresh();
    const onVisibility = () => {
      if (isVisible()) void refresh();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      mounted.current = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh]);

  return { summary, isLoading, error, refresh };
}
