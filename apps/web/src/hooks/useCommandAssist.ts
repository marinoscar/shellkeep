import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../services/api';
import {
  streamCommandAssist,
  type AssistContextFrame,
  type AssistResultFrame,
} from '../services/terminal-assist-api';

export type CommandAssistStatus = 'idle' | 'streaming' | 'done' | 'error' | 'consent';

export interface CommandAssistState {
  status: CommandAssistStatus;
  /** The raw token stream so far. */
  streamed: string;
  context: AssistContextFrame | null;
  result: AssistResultFrame | null;
  /** An API or in-band error code, when `status` is `error`. */
  errorCode: string | null;
  errorMessage: string | null;
}

const INITIAL: CommandAssistState = {
  status: 'idle',
  streamed: '',
  context: null,
  result: null,
  errorCode: null,
  errorMessage: null,
};

/** Drives one command-assist request at a time; a new `ask` cancels the previous one. */
export function useCommandAssist(sessionId: string | null) {
  const [state, setState] = useState<CommandAssistState>(INITIAL);
  const controller = useRef<AbortController | null>(null);
  const last = useRef<{ prompt: string; includeScreen: boolean } | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const ask = useCallback(
    async (prompt: string, includeScreen: boolean) => {
      if (!sessionId || prompt.trim() === '') return;
      controller.current?.abort();
      const mine = new AbortController();
      controller.current = mine;
      last.current = { prompt, includeScreen };
      setState({ ...INITIAL, status: 'streaming' });
      const live = () => controller.current === mine;
      try {
        await streamCommandAssist(
          { sessionId, prompt: prompt.trim(), includeScreen },
          {
            onContext: (context) => live() && setState((s) => ({ ...s, context })),
            onDelta: (text) => live() && setState((s) => ({ ...s, streamed: s.streamed + text })),
            onResult: (result) => live() && setState((s) => ({ ...s, result, status: 'done' })),
            onError: (code) =>
              live() && setState((s) => ({ ...s, status: 'error', errorCode: code, errorMessage: null })),
          },
          mine.signal,
        );
        if (live()) setState((s) => (s.status === 'streaming' ? { ...s, status: 'done' } : s));
      } catch (error) {
        if (!live()) return;
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
    },
    [sessionId],
  );

  /** Re-ask the last question (Regenerate, or the retry after consent). */
  const retry = useCallback(() => {
    if (last.current) void ask(last.current.prompt, last.current.includeScreen);
  }, [ask]);

  const cancel = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    setState(INITIAL);
  }, []);

  return { state, ask, retry, cancel };
}
