/**
 * Runs `task` over `items` with at most `limit` in flight, in order of start, and reports each
 * settled item. Used by the Servers page's bulk test and bulk delete (#79): client-side calls, so a
 * slow server never blocks the others and the API never sees more than `limit` at once.
 */
export async function runPool<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
  onSettled?: (item: T, outcome: { ok: true; value: R } | { ok: false; error: unknown }) => void,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      try {
        const value = await task(item);
        onSettled?.(item, { ok: true, value });
      } catch (error) {
        onSettled?.(item, { ok: false, error });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
}
