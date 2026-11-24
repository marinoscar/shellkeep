import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../services/api';
import {
  previewTerminalExplain,
  streamTerminalExplain,
  type ExplainContextFrame,
  type ExplainPreview,
  type ExplainRequest,
  type ExplainResultFrame,
} from '../services/terminal-explain-api';

/**
 * `idle`; `preview` (a selection waits for the user to confirm what will be sent); `streaming`;
 * `done`; `error`; `consent` (the notice must be accepted first).
 */
export type TerminalExplainStatus = 'idle' | 'preview' | 'streaming' | 'done' | 'error' | 'consent';

export interface TerminalExplainState {
  status: TerminalExplainStatus;
  request: ExplainRequest | null;
  /** The redacted text that would be (or was) sent; `null` until loaded. */
  preview: ExplainPreview | null;
  previewLoading: boolean;
  /** The raw token stream so far. */
  streamed: string;
  context: ExplainContextFrame | null;
  result: ExplainResultFrame | null;
  errorCode: string | null;
  errorMessage: string | null;
}

const INITIAL: TerminalExplainState = {
  status: 'idle',
  request: null,
  preview: null,
  previewLoading: false,
  streamed: '',
  context: null,
  result: null,
  errorCode: null,
  errorMessage: null,
};

/**
 * Drives one explain request at a time (issue #58). A selection first shows "What will be sent"
 * (the server's dry-run preview) and waits for `send`; the last error is sent at once, with the
 * preview available on demand. A new request cancels the previous one.
 */
export function useTerminalExplain(sessionId: string | null) {
  const [state, setState] = useState<TerminalExplainState>(INITIAL);
  const controller = useRef<AbortController | null>(null);
  const current = useRef<ExplainRequest | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const fail = useCallback((error: unknown, request: ExplainRequest) => {
    if (error instanceof ApiError && error.code === 'AI_CONSENT_REQUIRED') {
      setState((s) => ({ ...INITIAL, status: 'consent', request, preview: s.preview }));
      return;
    }
    setState({
      ...INITIAL,
      status: 'error',
      request,
      errorCode: error instanceof ApiError ? (error.code ?? null) : null,
      errorMessage: error instanceof Error ? error.message : 'The request failed',
    });
  }, []);

  const loadPreview = useCallback(
    async (request: ExplainRequest, mine: AbortController, keepStatus: boolean) => {
      setState((s) => ({ ...s, previewLoading: true }));
      try {
        const preview = await previewTerminalExplain(request);
        if (controller.current === mine || keepStatus) setState((s) => ({ ...s, preview, previewLoading: false }));
      } catch (error) {
        if (controller.current !== mine && !keepStatus) return;
        if (keepStatus) setState((s) => ({ ...s, previewLoading: false }));
        else fail(error, request);
      }
    },
    [fail],
  );

  const send = useCallback(
    async (request: ExplainRequest | null = current.current) => {
      if (!request) return;
      controller.current?.abort();
      const mine = new AbortController();
      controller.current = mine;
      current.current = request;
      setState((s) => ({ ...INITIAL, status: 'streaming', request, preview: s.preview }));
      const live = () => controller.current === mine;
      try {
        await streamTerminalExplain(
          request,
          {
            onContext: (context) => live() && setState((s) => ({ ...s, context })),
            onDelta: (text) => live() && setState((s) => ({ ...s, streamed: s.streamed + text })),
            onResult: (result) => live() && setState((s) => ({ ...s, result, status: 'done' })),
            onError: (code) => live() && setState((s) => ({ ...s, status: 'error', errorCode: code, errorMessage: null })),
          },
          mine.signal,
        );
        if (live()) setState((s) => (s.status === 'streaming' ? { ...s, status: 'done' } : s));
      } catch (error) {
        if (live()) fail(error, request);
      }
    },
    [fail],
  );

  /** Start: a selection previews first; the last error is sent immediately. */
  const begin = useCallback(
    async (request: ExplainRequest) => {
      if (!sessionId) return;
      controller.current?.abort();
      const mine = new AbortController();
      controller.current = mine;
      current.current = request;
      if (request.mode === 'last_error') {
        await send(request);
        return;
      }
      setState({ ...INITIAL, status: 'preview', request });
      await loadPreview(request, mine, false);
    },
    [sessionId, send, loadPreview],
  );

  /** Load "What will be sent" for the request in hand without sending it. */
  const showPreview = useCallback(() => {
    const request = current.current;
    if (!request) return;
    void loadPreview(request, controller.current ?? new AbortController(), true);
  }, [loadPreview]);

  /** Re-run after consent was accepted, or Regenerate. */
  const retry = useCallback(() => {
    const request = current.current;
    if (request) void begin(request);
  }, [begin]);

  const cancel = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    current.current = null;
    setState(INITIAL);
  }, []);

  return { state, begin, send, showPreview, retry, cancel };
}
