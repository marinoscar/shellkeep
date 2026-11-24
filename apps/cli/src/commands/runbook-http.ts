import { buildUrl, resolveApiBaseUrl } from '@marinoscar/platform-cli/api-client';

import { loadCredentials } from '../credentials.js';

import { type CommandDeps, defaultDeps } from './deps.js';

// The raw HTTP the runbook commands need  (issue #72)
//
// `ApiClient` reads JSON. Two routes are not JSON: the step log (`text/plain`) and
// the run log streams (`text/event-stream`, a response that never ends while a run
// is live). Both go through `deps.fetch`, an authenticated request relative to
// `/api`, so a test substitutes a fake server and nothing here touches the network
// in a test. The token is added inside the default implementation and is never
// returned, logged or put in an error message.

/** What the runbook commands reach outside themselves for, beyond {@link CommandDeps}. */
export interface RunbookDeps extends CommandDeps {
  /** An authenticated request to an API route (`path` is relative to `/api`). */
  fetch(path: string, init?: { headers?: Record<string, string>; signal?: AbortSignal; query?: Record<string, string> }): Promise<Response>;
  /** Waits; a test makes it instant. */
  sleep(ms: number): Promise<void>;
}

/** The real thing: the stored login and real time. */
export function defaultRunbookDeps(): RunbookDeps {
  return {
    ...defaultDeps(),
    fetch: async (path, init = {}) => {
      const { serverUrl, token } = loadCredentials();
      const url = buildUrl(resolveApiBaseUrl(serverUrl), path, init.query);
      return fetch(url, {
        headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` },
        ...(init.signal !== undefined ? { signal: init.signal } : {}),
      });
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

/** One server-sent event. */
export interface SseEvent {
  id: string | undefined;
  event: string;
  data: string;
}

/**
 * Reads a server-sent-events body: yields each event once its blank line arrives.
 * Comment lines (`:`) are skipped; `data:` lines of one event are joined with a newline.
 */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = '';
  let id: string | undefined;
  let event = '';
  let data: string[] = [];
  const flush = (): SseEvent | undefined => {
    const out = data.length > 0 || event !== '' ? { id, event: event === '' ? 'message' : event, data: data.join('\n') } : undefined;
    event = '';
    data = [];
    return out;
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.search(/\r\n|\n|\r/);
      while (newline !== -1) {
        const match = /^(\r\n|\n|\r)/.exec(buffer.slice(newline));
        const width = match?.[0].length ?? 1;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + width);
        if (line === '') {
          const ready = flush();
          if (ready !== undefined) yield ready;
        } else if (!line.startsWith(':')) {
          const colon = line.indexOf(':');
          const field = colon === -1 ? line : line.slice(0, colon);
          const text = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
          if (field === 'id') id = text;
          else if (field === 'event') event = text;
          else if (field === 'data') data.push(text);
        }
        newline = buffer.search(/\r\n|\n|\r/);
      }
    }
  } finally {
    reader.releaseLock();
  }
}
