// =============================================================================
// Cron arithmetic for runbook schedules (issue #66)
// =============================================================================
//
// PURE: no Nest, no Prisma, no clock of its own (every function takes the instant it works from), so a test
// injects the time and never waits for it.
//
// A schedule is a 5-field cron expression evaluated in an IANA time zone (`cron-parser`). Exactly five fields:
// the six-field form with seconds, `@daily`-style aliases and a missing field are refused, so what a person
// reads in the editor is what runs. The next fire time is always the first slot STRICTLY AFTER the instant
// given, so a missed slot is never caught up: after downtime the schedule fires once, at its next slot.
//
// DST. `cron-parser` evaluates the fields as local wall-clock time: `0 3 * * *` in `Europe/Berlin` fires at
// 03:00 local on every day, which is 02:00Z in winter and 01:00Z in summer. A wall-clock time the spring-forward
// gap skips (02:30 on that day) fires once, an hour later (03:30 local); one the fall-back repeats fires once.
// =============================================================================

import { parseExpression } from 'cron-parser';

/** How many upcoming times the preview shows. */
export const PREVIEW_COUNT = 5;

export type ScheduleCronIssue = 'CRON_INVALID' | 'TIMEZONE_INVALID';

export class ScheduleCronError extends Error {
  constructor(
    readonly issue: ScheduleCronIssue,
    message: string,
  ) {
    super(message);
    this.name = 'ScheduleCronError';
  }
}

/** Whether `timezone` names a time zone this runtime knows. */
export function isValidTimezone(timezone: string): boolean {
  if (typeof timezone !== 'string' || timezone.trim() === '' || timezone !== timezone.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** Throws a {@link ScheduleCronError} unless `cron` is a valid 5-field expression and `timezone` an IANA zone. */
export function assertValidSchedule(cron: string, timezone: string): void {
  if (!isValidTimezone(timezone)) throw new ScheduleCronError('TIMEZONE_INVALID', `"${timezone}" is not an IANA time zone`);
  const fields = cron.trim().split(/\s+/);
  if (cron.trim() === '' || fields.length !== 5) {
    throw new ScheduleCronError('CRON_INVALID', 'A schedule is a cron expression of exactly five fields: minute hour day-of-month month day-of-week');
  }
  try {
    parseExpression(fields.join(' '), { tz: timezone, currentDate: new Date(0) });
  } catch (error) {
    throw new ScheduleCronError('CRON_INVALID', `The cron expression is not valid: ${error instanceof Error ? error.message : 'unreadable'}`);
  }
}

/** The first fire time strictly after `after`, or `null` when the expression never fires again. */
export function nextFireAfter(cron: string, timezone: string, after: Date): Date | null {
  assertValidSchedule(cron, timezone);
  try {
    const iterator = parseExpression(cron.trim().split(/\s+/).join(' '), { tz: timezone, currentDate: after });
    return iterator.next().toDate();
  } catch {
    return null;
  }
}

/** The next `count` fire times after `after` (fewer when the expression runs out). */
export function nextFireTimes(cron: string, timezone: string, after: Date, count: number = PREVIEW_COUNT): Date[] {
  assertValidSchedule(cron, timezone);
  const iterator = parseExpression(cron.trim().split(/\s+/).join(' '), { tz: timezone, currentDate: after });
  const out: Date[] = [];
  for (let i = 0; i < count; i += 1) {
    try {
      out.push(iterator.next().toDate());
    } catch {
      break;
    }
  }
  return out;
}
