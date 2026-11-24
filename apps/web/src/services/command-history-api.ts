import { api } from './api';

// The key panel's History tab (issue #173, epic #171). Route: `GET /api/sessions/:id/command-history`. Access is
// the terminal's (`sessions:write` plus the right to connect). The API redacts secrets before it answers; the web
// never logs an entry. Wire shapes are declared here: the web never imports API source.

export interface CommandHistoryEntry {
  command: string;
  /** Part of the command was masked as a secret (`[REDACTED:<kind>]`); running it as shown will not work. */
  masked: boolean;
}

export interface CommandHistory {
  /** The shell whose history file was read, or `null` when the server has none. */
  shell: 'bash' | 'zsh' | 'fish' | null;
  /** Newest first, deduplicated. */
  entries: CommandHistoryEntry[];
  /** Older commands exist than the part of the file the API reads. */
  truncated: boolean;
  /** Entries left out for being entirely a secret (a count only). */
  dropped: number;
}

/** The caps the API enforces. */
export const COMMAND_HISTORY_LIMITS = { query: 200, limit: 500 } as const;

export async function getCommandHistory(sessionId: string, query?: string, limit?: number): Promise<CommandHistory> {
  const params = new URLSearchParams();
  const q = query?.trim();
  if (q) params.set('query', q);
  if (limit) params.set('limit', String(limit));
  const qs = params.toString();
  const response = await api.get<CommandHistory>(`/sessions/${encodeURIComponent(sessionId)}/command-history${qs ? `?${qs}` : ''}`);
  return response ?? { shell: null, entries: [], truncated: false, dropped: 0 };
}
