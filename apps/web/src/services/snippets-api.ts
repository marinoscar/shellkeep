import { api } from './api';

// The key panel's saved terminal text (issue #172, epic #171). Routes: `/api/snippets`. Access is the
// terminal's (`sessions:write`); a snippet belongs to its creator alone. Wire shapes are declared here: the
// web never imports API source. A snippet is never logged by the web either.

export interface Snippet {
  id: string;
  title: string;
  body: string;
  tags: string[];
  /** 0-based and dense per user: the list is already in this order. */
  position: number;
  createdAt: string;
  updatedAt: string;
}

/** `looks-like-secret`: the body looks like a password, key or token. The snippet was saved anyway. */
export type SnippetWarning = 'looks-like-secret';

/** What create and update answer: the snippet and the secret warning. */
export interface SavedSnippet extends Snippet {
  warning: SnippetWarning | null;
}

export interface SnippetInput {
  title: string;
  body: string;
  tags: string[];
}

/** The caps the API enforces (the editor mirrors them; the API is the authority). */
export const SNIPPET_LIMITS = { title: 80, bodyBytes: 4096, tags: 8, tag: 24, perUser: 200, query: 100 } as const;

export async function listSnippets(query?: string): Promise<Snippet[]> {
  const q = query?.trim();
  const response = await api.get<{ items: Snippet[] }>(`/snippets${q ? `?query=${encodeURIComponent(q)}` : ''}`);
  return response?.items ?? [];
}

export function createSnippet(input: SnippetInput): Promise<SavedSnippet> {
  return api.post<SavedSnippet>('/snippets', input);
}

export function updateSnippet(id: string, input: Partial<SnippetInput>): Promise<SavedSnippet> {
  return api.patch<SavedSnippet>(`/snippets/${id}`, input);
}

export async function deleteSnippet(id: string): Promise<void> {
  await api.delete<void>(`/snippets/${id}`);
}

/** Puts `ids` first, in that order; answers the whole list in its new order. */
export async function reorderSnippets(ids: string[]): Promise<Snippet[]> {
  const response = await api.put<{ items: Snippet[] }>('/snippets/order', { ids });
  return response?.items ?? [];
}
