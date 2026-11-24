/**
 * The schedule editor's cron presets (issue #66). A preset builds a 5-field expression; `custom` is typed by hand
 * and checked by the API (`GET /api/runbook-schedules/preview`), which is the one source of truth for validity.
 */
export type CronPreset = 'hourly' | 'daily' | 'weekly' | 'custom';

export interface CronParts {
  preset: CronPreset;
  /** Minute of the hour (hourly) or of the day. */
  minute: number;
  hour: number;
  /** 0 (Sunday) to 6. */
  weekday: number;
  custom: string;
}

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

export const DEFAULT_CRON_PARTS: CronParts = { preset: 'daily', minute: 0, hour: 2, weekday: 1, custom: '0 2 * * *' };

export function buildCron(parts: CronParts): string {
  switch (parts.preset) {
    case 'hourly':
      return `${parts.minute} * * * *`;
    case 'daily':
      return `${parts.minute} ${parts.hour} * * *`;
    case 'weekly':
      return `${parts.minute} ${parts.hour} * * ${parts.weekday}`;
    case 'custom':
      return parts.custom.trim();
  }
}

/** The preset an expression matches, so the editor opens an existing schedule on the right controls. */
export function parseCron(cron: string): CronParts {
  const f = cron.trim().split(/\s+/);
  const num = (text: string | undefined) => (text !== undefined && /^\d+$/.test(text) ? Number(text) : null);
  const base = { ...DEFAULT_CRON_PARTS, custom: cron };
  if (f.length === 5) {
    const [m, h, dom, mon, dow] = f;
    if (num(m) !== null && h === '*' && dom === '*' && mon === '*' && dow === '*') return { ...base, preset: 'hourly', minute: num(m)! };
    if (num(m) !== null && num(h) !== null && dom === '*' && mon === '*' && dow === '*') return { ...base, preset: 'daily', minute: num(m)!, hour: num(h)! };
    if (num(m) !== null && num(h) !== null && dom === '*' && mon === '*' && num(dow) !== null && num(dow)! <= 6) {
      return { ...base, preset: 'weekly', minute: num(m)!, hour: num(h)!, weekday: num(dow)! };
    }
  }
  return { ...base, preset: 'custom' };
}

/** The runtime's IANA zone, falling back to UTC. */
export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** The zones to offer; a runtime without `Intl.supportedValuesOf` gets a short list. */
export function timezoneOptions(): string[] {
  const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
  const zones = supported ? supported('timeZone') : [];
  return zones.length > 0 ? ['UTC', ...zones.filter((z) => z !== 'UTC')] : ['UTC', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo'];
}

/** What a disabled reason means to the person (the API stores the code). */
export const DISABLED_REASON_COPY: Record<string, string> = {
  PERMISSION_REVOKED: 'Turned off: permission revoked. The person it runs as can no longer run this runbook on these servers.',
  APPROVAL_REQUIRED: 'Turned off: waiting for approval. A destructive version needs a second person to approve this schedule.',
  RUNBOOK_ARCHIVED: 'Turned off: the runbook is archived.',
  VERSION_MISSING: 'Turned off: the version it was pinned to no longer exists.',
  RUN_REJECTED: 'Turned off: its run could not be created. Check its parameters, secrets and servers.',
};
