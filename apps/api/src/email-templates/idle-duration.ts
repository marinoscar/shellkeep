/** Longest listing of sessions a single notification carries; the rest are counted. */
export const MAX_LISTED_SESSIONS = 10;

/**
 * An idle duration as a person reads it: "45 minutes", "3 hours", "1 day 2 hours".
 * Pure, locale-free (the copy is English like every ShellKeep template).
 */
export function formatIdleDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  if (total < 1) return 'less than a minute';
  if (total < 60) return plural(total, 'minute');
  const hours = Math.floor(total / 60);
  if (hours < 24) {
    const rest = total % 60;
    return rest === 0 ? plural(hours, 'hour') : `${plural(hours, 'hour')} ${plural(rest, 'minute')}`;
  }
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours === 0 ? plural(days, 'day') : `${plural(days, 'day')} ${plural(restHours, 'hour')}`;
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}
