import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createSnippet,
  deleteSnippet,
  listSnippets,
  reorderSnippets,
  updateSnippet,
  type SavedSnippet,
  type Snippet,
  type SnippetInput,
} from '../services/snippets-api';

/** How long typing in the search box waits before the list is asked for. */
export const SNIPPET_SEARCH_DEBOUNCE_MS = 200;

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * The caller's snippets for the key panel's Snippets tab (#172): the list (searched on the server, after a
 * short pause in typing), create, edit, delete and move. A move is optimistic and puts the list back when the
 * API refuses. Snippet text is never logged.
 */
export function useSnippets(enabled = true) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<Snippet[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const searched = useRef(query);
  searched.current = query.trim();
  const loadedOnce = useRef(false);

  const load = useCallback(async (text: string) => {
    setLoading(true);
    setError(null);
    try {
      const next = await listSnippets(text);
      // A slower answer to an older search must not replace a newer one.
      if (text === searched.current) setItems(next);
    } catch (err) {
      if (text === searched.current) setError(messageOf(err, 'Could not load your snippets'));
    } finally {
      if (text === searched.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    const text = query.trim();
    // The first load is immediate; a later search waits for a pause in typing.
    const timer = setTimeout(() => {
      loadedOnce.current = true;
      void load(text);
    }, loadedOnce.current ? SNIPPET_SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(timer);
  }, [enabled, query, load]);

  const reload = useCallback(() => load(searched.current), [load]);

  const create = useCallback(
    async (input: SnippetInput): Promise<SavedSnippet> => {
      const saved = await createSnippet(input);
      await reload();
      return saved;
    },
    [reload],
  );

  const update = useCallback(
    async (id: string, input: Partial<SnippetInput>): Promise<SavedSnippet> => {
      const saved = await updateSnippet(id, input);
      await reload();
      return saved;
    },
    [reload],
  );

  const remove = useCallback(
    async (id: string): Promise<void> => {
      await deleteSnippet(id);
      await reload();
    },
    [reload],
  );

  /** Moves a snippet one place up (`-1`) or down (`1`). Only the unfiltered list has an order to change. */
  const move = useCallback(
    async (id: string, direction: -1 | 1): Promise<void> => {
      if (searched.current !== '') return;
      const from = items.findIndex((item) => item.id === id);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= items.length) return;
      const next = [...items];
      [next[from], next[to]] = [next[to], next[from]];
      const before = items;
      setItems(next.map((item, index) => ({ ...item, position: index })));
      try {
        setItems(await reorderSnippets(next.map((item) => item.id)));
      } catch (err) {
        setItems(before);
        setError(messageOf(err, 'Could not save the new order'));
      }
    },
    [items],
  );

  return { query, setQuery, items, loading, error, reload, create, update, remove, move };
}
