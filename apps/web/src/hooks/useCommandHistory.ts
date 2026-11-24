import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../services/api';
import { getCommandHistory, type CommandHistory } from '../services/command-history-api';

/** How long typing in the search box waits before the list is asked for. */
export const HISTORY_SEARCH_DEBOUNCE_MS = 250;

export type CommandHistoryProblem = 'sftp-unavailable' | 'rate-limited' | 'failed';

function problemOf(error: unknown): CommandHistoryProblem {
  if (error instanceof ApiError) {
    if (error.code === 'SFTP_UNAVAILABLE') return 'sftp-unavailable';
    if (error.status === 429) return 'rate-limited';
  }
  return 'failed';
}

/**
 * The session server's recent shell commands for the key panel's History tab (#173): searched on the server
 * (against the redacted text) after a short pause in typing. Entries are never logged.
 */
export function useCommandHistory(sessionId: string) {
  const [query, setQuery] = useState('');
  const [history, setHistory] = useState<CommandHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<CommandHistoryProblem | null>(null);
  const searched = useRef(query.trim());
  searched.current = query.trim();
  const loadedOnce = useRef(false);

  const load = useCallback(
    async (text: string) => {
      setLoading(true);
      setProblem(null);
      try {
        const next = await getCommandHistory(sessionId, text);
        // A slower answer to an older search must not replace a newer one.
        if (text === searched.current) setHistory(next);
      } catch (error) {
        if (text === searched.current) setProblem(problemOf(error));
      } finally {
        if (text === searched.current) setLoading(false);
      }
    },
    [sessionId],
  );

  useEffect(() => {
    const text = query.trim();
    const timer = setTimeout(() => {
      loadedOnce.current = true;
      void load(text);
    }, loadedOnce.current ? HISTORY_SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(timer);
  }, [query, load]);

  const reload = useCallback(() => load(searched.current), [load]);

  return { query, setQuery, history, loading, problem, reload };
}
