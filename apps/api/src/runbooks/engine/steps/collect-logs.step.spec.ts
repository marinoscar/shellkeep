import { runbookDefinitionSchema } from '../../schema/runbook-definition.schema';
import { COLLECT_LOGS_SCRIPT, collectLogsEnv, journalSince } from './collect-logs.step';

const parse = (step: Record<string, unknown>) =>
  runbookDefinitionSchema.safeParse({ schemaVersion: 1, steps: [{ id: 'logs', name: 'Logs', kind: 'collect_logs', ...step }] });

describe('collect_logs: the environment and the script', () => {
  it('passes every user value through the environment, newline separated', () => {
    const step = { paths: ['/var/log/app/*.log', '/var/log/b.log'], journalUnits: ['nginx.service', 'ssh@1.service'], since: '2h', maxBytesPerFile: 1_048_576 };
    expect(collectLogsEnv(step)).toEqual({
      SK_PATHS: '/var/log/app/*.log\n/var/log/b.log',
      SK_UNITS: 'nginx.service\nssh@1.service',
      SK_MAX_FILE: '1048576',
      SK_SINCE: '2h',
    });
  });

  it('converts the since window to journalctl form: m becomes min, h and d stay', () => {
    expect(journalSince('30m')).toBe('30min');
    expect(journalSince('2h')).toBe('2h');
    expect(journalSince('7d')).toBe('7d');
    expect(journalSince(undefined)).toBe('');
    expect(collectLogsEnv({ paths: [], journalUnits: ['x'], maxBytesPerFile: 1024, since: '15m' }).SK_SINCE).toBe('15min');
  });

  it('keeps the script text constant: no path, unit or number of a step can be part of it', () => {
    const hostile = { paths: ['/var/log/$(reboot)', '/tmp/a;rm -rf /'], journalUnits: ['a.service'], maxBytesPerFile: 4096 };
    const env = collectLogsEnv(hostile);
    expect(COLLECT_LOGS_SCRIPT).not.toContain('reboot');
    expect(COLLECT_LOGS_SCRIPT).not.toContain('/tmp/a');
    expect(COLLECT_LOGS_SCRIPT).not.toContain('a.service');
    expect(env.SK_PATHS).toContain('$(reboot)');
    // the only expansions of user data are quoted, except the one unquoted glob of a path variable
    expect(COLLECT_LOGS_SCRIPT).toContain('for f in $g;');
    expect(COLLECT_LOGS_SCRIPT).toContain('tail -c "$SK_MAX_FILE"');
    expect(COLLECT_LOGS_SCRIPT.split('\n').at(-1)).toBe('tar -czf - -C "$stage" .');
  });
});

describe('collect_logs: the definition schema', () => {
  it('defaults failIfEmpty to false and keeps schemaVersion 1', () => {
    const parsed = parse({ paths: ['/var/log/syslog'] });
    expect(parsed.success).toBe(true);
    const step = parsed.success ? parsed.data.steps[0] : null;
    expect(step).toMatchObject({ kind: 'collect_logs', failIfEmpty: false, maxBytesPerFile: 10 * 2 ** 20, maxTotalBytes: 100 * 2 ** 20 });
    expect(parsed.success && parsed.data.schemaVersion).toBe(1);
    expect(parse({ paths: ['/var/log/syslog'], failIfEmpty: true }).success).toBe(true);
  });

  it('refuses a path with a line break or another control character, and a relative or ".." path', () => {
    for (const bad of ['/var/log/a\n/etc/shadow', '/var/log/a\r', '/var/log/\u0007', 'var/log/a', '/var/../etc/passwd']) {
      expect(parse({ paths: [bad] }).success).toBe(false);
    }
  });

  it('accepts a path that merely looks hostile: it is data, never evaluated', () => {
    expect(parse({ paths: ['/var/log/$(reboot)', '/tmp/a;rm -rf /', '/tmp/`id`', '/tmp/with space/*.log'] }).success).toBe(true);
  });

  it('still needs a path or a journal unit', () => {
    expect(parse({}).success).toBe(false);
    expect(parse({ journalUnits: ['nginx.service'] }).success).toBe(true);
  });
});
