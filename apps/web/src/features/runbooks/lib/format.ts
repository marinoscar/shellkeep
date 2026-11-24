/** Formatting helpers of the runbooks views (issue #65). */

/** `850 ms`, `12.4 s`, `3m 05s`, `1h 02m`. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const totalSec = ms / 1000;
  if (totalSec < 60) return `${totalSec.toFixed(1)} s`;
  const sec = Math.floor(totalSec % 60);
  const min = Math.floor(totalSec / 60) % 60;
  const hours = Math.floor(totalSec / 3600);
  if (hours > 0) return `${hours}h ${String(min).padStart(2, '0')}m`;
  return `${min}m ${String(sec).padStart(2, '0')}s`;
}

/** The elapsed time between two instants (now when `end` is absent). */
export function elapsedMs(start: string | null, end: string | null, now: number = Date.now()): number | null {
  if (!start) return null;
  const from = new Date(start).getTime();
  const to = end ? new Date(end).getTime() : now;
  return Math.max(0, to - from);
}

/** `in 3h 12m`, `in 45s`, `expired`. */
export function formatCountdown(expiresAt: string, now: number = Date.now()): string {
  const ms = new Date(expiresAt).getTime() - now;
  if (ms <= 0) return 'expired';
  return `in ${formatDuration(ms).replace(/\.\d s$/, ' s')}`;
}

/** A JSON path as the key the builder files its field errors under: `steps.0.command`. */
export const pathKey = (path: readonly (string | number)[]): string => path.join('.');
