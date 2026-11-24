// Terminal command assist client (#57). One POST, one streamed answer: no reconnect, because a
// reconnect would send the prompt (and bill the user) twice. A failure before the first byte
// rejects with the platform's `ApiError` (`code` AI_CONSENT_REQUIRED, AI_DISABLED, ...).

import { postSse } from '@marinoscar/platform-web/core';
import { API_BASE_URL, api } from './api';

export type CommandRisk = 'low' | 'medium' | 'high';

export interface AssistContextFrame {
  os: string | null;
  shell: string | null;
  cwd: string | null;
  screenLines: number;
  findings: Array<{ kind: string; count: number }>;
}

export interface AssistResultFrame {
  command: string;
  explanation: string;
  risk: CommandRisk;
  destructive: boolean;
  reasons: string[];
}

export interface AssistHandlers {
  onContext?: (frame: AssistContextFrame) => void;
  onDelta?: (text: string) => void;
  onResult?: (frame: AssistResultFrame) => void;
  /** An in-band failure, after streaming began. */
  onError?: (code: string) => void;
}

export interface AssistRequest {
  sessionId: string;
  prompt: string;
  includeScreen: boolean;
}

export async function streamCommandAssist(
  request: AssistRequest,
  handlers: AssistHandlers,
  signal?: AbortSignal,
): Promise<void> {
  await postSse<Record<string, unknown>>({
    url: `${API_BASE_URL}/ai/terminal/assist`,
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
          handlers.onContext?.(data as unknown as AssistContextFrame);
          break;
        case 'delta':
          handlers.onDelta?.(String(data.text ?? ''));
          break;
        case 'result':
          handlers.onResult?.(data as unknown as AssistResultFrame);
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
