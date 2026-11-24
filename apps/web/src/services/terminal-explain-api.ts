// Terminal explain client (#58). One POST, one streamed answer (no reconnect: a reconnect would
// bill the user twice), plus a dry-run preview that never reaches a model.

import { postSse } from '@marinoscar/platform-web/core';
import { API_BASE_URL, api } from './api';
import type { CommandRisk } from './terminal-assist-api';

export type ExplainRequest =
  | { mode: 'selection'; sessionId: string; selection: string }
  | { mode: 'last_error'; sessionId: string };

export interface ExplainFinding {
  kind: string;
  count: number;
}

export interface ExplainContextFrame {
  findings: ExplainFinding[];
  lines: number;
  truncated: boolean;
}

export interface ExplainResultFrame {
  markdown: string;
  suggestedCommand?: { command: string; risk: CommandRisk; destructive: boolean; reasons: string[] };
}

export interface ExplainPreview {
  text: string;
  findings: ExplainFinding[];
  truncated: boolean;
}

export interface ExplainHandlers {
  onContext?: (frame: ExplainContextFrame) => void;
  onDelta?: (text: string) => void;
  onResult?: (frame: ExplainResultFrame) => void;
  /** An in-band failure, after streaming began. */
  onError?: (code: string) => void;
}

export async function streamTerminalExplain(
  request: ExplainRequest,
  handlers: ExplainHandlers,
  signal?: AbortSignal,
): Promise<void> {
  await postSse<Record<string, unknown>>({
    url: `${API_BASE_URL}/ai/terminal/explain`,
    body: request,
    authorization: () => {
      const token = api.getAccessToken();
      return token ? `Bearer ${token}` : null;
    },
    reauthenticate: () => api.refreshToken(),
    ...(signal ? { signal } : {}),
    onFrame: (event, data) => {
      switch (event) {
        case 'context':
          handlers.onContext?.(data as unknown as ExplainContextFrame);
          break;
        case 'delta':
          handlers.onDelta?.(String(data.text ?? ''));
          break;
        case 'result':
          handlers.onResult?.(data as unknown as ExplainResultFrame);
          break;
        case 'error':
          handlers.onError?.(String(data.code ?? 'AI_PROVIDER_UNAVAILABLE'));
          break;
        default:
          break;
      }
    },
  });
}

/** The exact redacted text an explain call would send. Makes no model call. */
export async function previewTerminalExplain(request: ExplainRequest): Promise<ExplainPreview> {
  return api.post<ExplainPreview>('/ai/terminal/explain/preview', request);
}
