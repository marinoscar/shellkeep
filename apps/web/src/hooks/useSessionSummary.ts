import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../services/api';
import {
  getSessionSummary,
  requestSessionSummary,
  type SessionSummary,
} from '../services/session-summary-api';

/** How often a pending summary is read again. */
export const SUMMARY_POLL_MS = 3000;

export type SessionSummaryUiStatus = 'idle' | 'starting' | 'pending' | 'succeeded' | 'failed' | 'consent' | 'error';

export interface SessionSummaryUiState {
  status: SessionSummaryUiStatus;
  summary: SessionSummary | null;
  /** An API error code (`AI_OUTPUT_SHARING_DISABLED`, ...) or the failed summary's `errorCode`. */
  errorCode: string | null;
  errorMessage: string | null;
}

const INITIAL: SessionSummaryUiState = { status: 'idle', summary: null, errorCode: null, errorMessage: null };

/**
 * Asks for a summary of a session and polls `GET .../summaries/:id` every 3 s until it settles
 * (issue #59). One summary at a time; `start` while one is pending just follows it.
 */
export function useSessionSummary(sessionId: string | null) {
  const [state, setState] = useState<SessionSummaryUiState>(INITIAL);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const run = useRef(0);

  const stop = useCallback(() => {
    run.current += 1;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => stop, [stop]);
  // A different session starts clean.
  useEffect(() => {
    stop();
    setState(INITIAL);
  }, [sessionId, stop]);

  const follow = useCallback(
    (id: string, summaryId: string, mine: number) => {
      const tick = async () => {
        try {
          const summary = await getSessionSummary(id, summaryId);
          if (run.current !== mine) return;
          if (summary.status === 'pending') {
            setState({ status: 'pending', summary, errorCode: null, errorMessage: null });
            timer.current = setTimeout(() => void tick(), SUMMARY_POLL_MS);
          } else {
            setState({
              status: summary.status,
              summary,
              errorCode: summary.errorCode,
              errorMessage: null,
            });
          }
        } catch (error) {
          if (run.current !== mine) return;
          setState({
            status: 'error',
            summary: null,
            errorCode: error instanceof ApiError ? (error.code ?? null) : null,
            errorMessage: error instanceof Error ? error.message : 'Could not read the summary',
          });
        }
      };
      void tick();
    },
    [],
  );

  const start = useCallback(async () => {
    if (!sessionId) return;
    stop();
    const mine = run.current;
    setState({ ...INITIAL, status: 'starting' });
    try {
      const accepted = await requestSessionSummary(sessionId);
      if (run.current !== mine) return;
      follow(sessionId, accepted.summaryId, mine);
    } catch (error) {
      if (run.current !== mine) return;
      if (error instanceof ApiError && error.code === 'AI_CONSENT_REQUIRED') {
        setState({ ...INITIAL, status: 'consent' });
      } else {
        setState({
          ...INITIAL,
          status: 'error',
          errorCode: error instanceof ApiError ? (error.code ?? null) : null,
          errorMessage: error instanceof Error ? error.message : 'The request failed',
        });
      }
    }
  }, [sessionId, stop, follow]);

  /** Opens an earlier summary from the history list. */
  const open = useCallback(
    (summary: SessionSummary) => {
      stop();
      const mine = run.current;
      if (summary.status === 'pending' && sessionId) {
        setState({ status: 'pending', summary, errorCode: null, errorMessage: null });
        follow(sessionId, summary.id, mine);
      } else {
        setState({ status: summary.status === 'pending' ? 'pending' : summary.status, summary, errorCode: summary.errorCode, errorMessage: null });
      }
    },
    [sessionId, stop, follow],
  );

  const reset = useCallback(() => {
    stop();
    setState(INITIAL);
  }, [stop]);

  return { state, start, open, reset };
}
