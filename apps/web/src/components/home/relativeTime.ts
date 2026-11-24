/** A short "time ago" label for the Home panels: `just now`, `12m ago`, `3h ago`, then the date. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const diffMin = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  return new Date(iso).toLocaleDateString();
}
