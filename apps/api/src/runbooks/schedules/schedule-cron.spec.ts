import { ScheduleCronError, assertValidSchedule, isValidTimezone, nextFireAfter, nextFireTimes } from './schedule-cron';

const iso = (dates: Date[]) => dates.map((d) => d.toISOString());

describe('schedule cron', () => {
  it('accepts exactly five fields and an IANA zone', () => {
    expect(() => assertValidSchedule('*/5 * * * *', 'UTC')).not.toThrow();
    for (const bad of ['* * * *', '* * * * * *', '@daily', '', '61 * * * *']) {
      expect(() => assertValidSchedule(bad, 'UTC')).toThrow(ScheduleCronError);
    }
    expect(() => assertValidSchedule('* * * * *', 'Mars/Base')).toThrow(expect.objectContaining({ issue: 'TIMEZONE_INVALID' }));
    expect(isValidTimezone('Europe/Berlin')).toBe(true);
    expect(isValidTimezone(' UTC')).toBe(false);
  });

  it('the next slot is strictly after the instant, so a missed slot is never caught up', () => {
    const at = new Date('2026-01-01T00:01:00.000Z');
    expect(nextFireAfter('* * * * *', 'UTC', at)?.toISOString()).toBe('2026-01-01T00:02:00.000Z');
    // Hours of downtime: the next future slot only.
    expect(nextFireAfter('0 * * * *', 'UTC', new Date('2026-01-01T09:30:00.000Z'))?.toISOString()).toBe('2026-01-01T10:00:00.000Z');
  });

  it('Europe/Berlin fires at 03:00 local before and after the DST changes', () => {
    // Spring forward on 2026-03-29 (CET to CEST): 02:00Z before, 01:00Z after.
    expect(iso(nextFireTimes('0 3 * * *', 'Europe/Berlin', new Date('2026-03-27T12:00:00Z'), 4))).toEqual([
      '2026-03-28T02:00:00.000Z',
      '2026-03-29T01:00:00.000Z',
      '2026-03-30T01:00:00.000Z',
      '2026-03-31T01:00:00.000Z',
    ]);
    // Fall back on 2026-10-25.
    expect(iso(nextFireTimes('0 3 * * *', 'Europe/Berlin', new Date('2026-10-23T12:00:00Z'), 4))).toEqual([
      '2026-10-24T01:00:00.000Z',
      '2026-10-25T02:00:00.000Z',
      '2026-10-26T02:00:00.000Z',
      '2026-10-27T02:00:00.000Z',
    ]);
  });

  it('a wall-clock time the spring gap skips fires once, an hour later; the repeated hour fires once', () => {
    expect(iso(nextFireTimes('30 2 * * *', 'Europe/Berlin', new Date('2026-03-28T12:00:00Z'), 1))).toEqual(['2026-03-29T01:30:00.000Z']);
    const fall = iso(nextFireTimes('30 2 * * *', 'Europe/Berlin', new Date('2026-10-24T12:00:00Z'), 3));
    expect(fall.filter((d) => d.startsWith('2026-10-25'))).toHaveLength(1);
  });
});
