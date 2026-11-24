// =============================================================================
// ShellKeep's starter alert rules and rule kinds (issue #54)
// =============================================================================
//
// What this proves, with invented placeholders only:
//
//   1. the four rules seed DISABLED under their stable keys, every config validates against its
//      kind, and the metric names resolve to the tables the terminal metrics (#53) become;
//   2. a second seed creates nothing and NEVER overwrites a rule an administrator edited or
//      enabled (the "never overwritten" rule), and a replica that loses the insert race is
//      not an error;
//   3. `terminal_ssh_connect_p95` interpolates the histogram buckets of the window and breaches
//      above its threshold; `terminal_job_stalled` breaches when no job of the type succeeded in
//      time (or none is on record);
//   4. the metric rules build the statement the slice runs (a rate, with the outcome filters).
// =============================================================================

import '../../src/shellkeep.manifest';
import '../../src/app-registrations/registrations';

import {
  alertRuleKindRegistry,
  buildMetricThresholdSql,
  parseAlertConfig,
  registerBuiltinAlertKinds,
  resolveMetricTable,
  type AlertEvaluationContext,
  type AlertMetricTable,
} from '@marinoscar/platform-api/alerts';

import { histogramQuantile } from '../../src/terminal/alerts/histogram-quantile';
import { TerminalAlertRulesSeed } from '../../src/terminal/alerts/terminal-alert-rules.seed';
import {
  SSH_CONNECT_BUCKET_TABLE,
  TERMINAL_ALERT_KIND_IDS,
  jobStalledKind,
  sshConnectP95Kind,
} from '../../src/terminal/alerts/terminal.alert-rule-kinds';
import {
  TERMINAL_STARTER_ALERT_RULES,
  TERMINAL_STARTER_RULE_KEYS,
} from '../../src/terminal/alerts/terminal.starter-alert-rules';

// `AlertsModule.forRoot` registers the five built-in kinds when the app composes; this spec does not compose it.
registerBuiltinAlertKinds();

const NOW = new Date('2026-11-23T12:00:00.000Z');

/** An in-memory `alert_rules` with the unique `key`, as the seed uses it. */
function fakeDb(options: { raceOnCreate?: boolean } = {}) {
  const rows = new Map<string, Record<string, unknown>>();
  const db = {
    alertRule: {
      findUnique: jest.fn(async ({ where }: { where: { key: string } }) => rows.get(where.key) ?? null),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (options.raceOnCreate) throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
        rows.set(data.key as string, { id: `id-${rows.size}`, ...data });
        return data;
      }),
    },
  };
  return { db, rows };
}

describe('the four ShellKeep starter rules', () => {
  it('has the four permanent keys', () => {
    expect(TERMINAL_STARTER_ALERT_RULES.map((entry) => entry.key)).toEqual([
      'shellkeep.ssh_connect_failures',
      'shellkeep.ssh_connect_slow',
      'shellkeep.ws_auth_denied_spike',
      'shellkeep.reaper_stalled',
    ]);
    expect(Object.values(TERMINAL_STARTER_RULE_KEYS)).toHaveLength(4);
  });

  it('seeds every rule disabled, keyed, with its config validated and defaulted by its kind', async () => {
    const { db, rows } = fakeDb();
    const created = await new TerminalAlertRulesSeed(db as never).seed();

    expect(created).toBe(4);
    expect([...rows.keys()].sort()).toEqual(TERMINAL_STARTER_ALERT_RULES.map((entry) => entry.key).sort());
    for (const row of rows.values()) {
      expect(row.enabled).toBe(false);
      expect(row.key).toMatch(/^shellkeep\./);
      expect(parseAlertConfig(row.kind as string, row.config)).toBeDefined();
    }
    expect(rows.get('shellkeep.ssh_connect_slow')).toMatchObject({ kind: 'terminal_ssh_connect_p95', severity: 'warning' });
    expect(rows.get('shellkeep.reaper_stalled')).toMatchObject({ kind: 'terminal_job_stalled', severity: 'critical' });
    expect(rows.get('shellkeep.ssh_connect_failures')).toMatchObject({ kind: 'metric_threshold', severity: 'warning' });
    expect(rows.get('shellkeep.ws_auth_denied_spike')).toMatchObject({ kind: 'metric_threshold', severity: 'warning' });
  });

  it('a second seed creates nothing and does not overwrite an edited, enabled rule', async () => {
    const { db, rows } = fakeDb();
    const seed = new TerminalAlertRulesSeed(db as never);
    await seed.seed();

    // An administrator enables a rule, raises its threshold and renames it.
    const edited = rows.get('shellkeep.ssh_connect_failures')!;
    edited.enabled = true;
    edited.name = 'Our SSH failures';
    (edited.config as { threshold: number }).threshold = 25;
    const before = JSON.stringify([...rows.values()]);

    expect(await seed.seed()).toBe(0);
    expect(db.alertRule.create).toHaveBeenCalledTimes(4); // only the first pass created
    expect(JSON.stringify([...rows.values()])).toBe(before);
    expect(rows.get('shellkeep.ssh_connect_failures')).toMatchObject({ enabled: true, name: 'Our SSH failures' });
  });

  it('fills in only the missing rule when one is absent', async () => {
    const { db, rows } = fakeDb();
    const seed = new TerminalAlertRulesSeed(db as never);
    await seed.seed();
    rows.delete('shellkeep.reaper_stalled');
    expect(await seed.seed()).toBe(1);
    expect(rows.get('shellkeep.reaper_stalled')?.enabled).toBe(false);
  });

  it('treats a lost insert race (another replica seeded it first) as done, and logs a real failure without throwing', async () => {
    const race = fakeDb({ raceOnCreate: true });
    await expect(new TerminalAlertRulesSeed(race.db as never).seed()).resolves.toBe(0);

    const broken = { alertRule: { findUnique: jest.fn().mockRejectedValue(new Error('db down')), create: jest.fn() } };
    await expect(new TerminalAlertRulesSeed(broken as never).onApplicationBootstrap()).resolves.toBeUndefined();
  });

  it('registers both kinds with permanent ids next to the five built-in ones', () => {
    const ids = alertRuleKindRegistry.list().map((kind) => kind.id);
    expect(ids).toEqual(expect.arrayContaining([TERMINAL_ALERT_KIND_IDS.SSH_CONNECT_P95, TERMINAL_ALERT_KIND_IDS.JOB_STALLED]));
    expect(TERMINAL_ALERT_KIND_IDS).toEqual({ SSH_CONNECT_P95: 'terminal_ssh_connect_p95', JOB_STALLED: 'terminal_job_stalled' });
  });
});

describe('the metric rules read the tables the terminal metrics become', () => {
  const tables = new Map<string, AlertMetricTable>([
    [
      'app_terminal_ssh_connect_duration_seconds_count',
      { name: 'app_terminal_ssh_connect_duration_seconds_count', columns: new Set(['greptime_timestamp', 'greptime_value', 'outcome', 'service', 'instance']), tags: ['instance', 'outcome', 'service'] },
    ],
    [
      'app_terminal_ws_auth_denied_total',
      { name: 'app_terminal_ws_auth_denied_total', columns: new Set(['greptime_timestamp', 'greptime_value', 'reason', 'service', 'instance']), tags: ['instance', 'reason', 'service'] },
    ],
  ]);
  const query = {
    sql: {
      literal: (value: string) => `'${value.replace(/'/g, "''")}'`,
      ident: (name: string) => `"${name.replace(/"/g, '""')}"`,
      timestamp: (date: Date) => `'${date.toISOString()}'`,
      between: (column: string, from: Date, to: Date) => `"${column}" >= '${from.toISOString()}' AND "${column}" < '${to.toISOString()}'`,
    },
    dialect: { timestampColumn: 'greptime_timestamp', valueColumn: 'greptime_value', castText: (expr: string) => `CAST(${expr} AS TEXT)` },
  };

  const rule = (key: string) => TERMINAL_STARTER_ALERT_RULES.find((entry) => entry.key === key)!.rule;

  it('connect failures: a rate of the non-ok, non-prompt outcomes over 10 minutes (more than 10 in 10 minutes)', () => {
    const config = parseAlertConfig('metric_threshold', rule(TERMINAL_STARTER_RULE_KEYS.SSH_CONNECT_FAILURES).config) as Parameters<typeof buildMetricThresholdSql>[0];
    const table = resolveMetricTable(config.metric, tables)!;
    expect(table.name).toBe('app_terminal_ssh_connect_duration_seconds_count');
    expect(config).toMatchObject({ aggregation: 'rate', windowSeconds: 600, comparator: 'gt', threshold: 1 });

    const sql = buildMetricThresholdSql(config, table, query as never, NOW);
    expect(sql).toContain(`"outcome" <> 'ok'`);
    expect(sql).toContain(`"outcome" <> 'host_key_unknown'`);
    expect(sql).toContain('/ 10 AS'); // per minute over 600 s
  });

  it('WebSocket refusals: the dotted metric name resolves to the _total table, a rate over 5 minutes', () => {
    const config = parseAlertConfig('metric_threshold', rule(TERMINAL_STARTER_RULE_KEYS.WS_AUTH_DENIED_SPIKE).config) as Parameters<typeof buildMetricThresholdSql>[0];
    const table = resolveMetricTable(config.metric, tables)!;
    expect(table.name).toBe('app_terminal_ws_auth_denied_total');
    expect(config).toMatchObject({ aggregation: 'rate', windowSeconds: 300, threshold: 4 });
    expect(buildMetricThresholdSql(config, table, query as never, NOW)).toContain('/ 5 AS');
  });
});

describe('histogramQuantile', () => {
  const buckets = (entries: Record<string, number>) => new Map(Object.entries(entries));

  it('interpolates inside the bucket that crosses the rank', () => {
    // 100 observations: 50 within 1 s, 90 within 5 s, all within 10 s. p95 lies in (5, 10]: rank 95.
    const value = histogramQuantile(0.95, buckets({ '1': 50, '5': 90, '10': 100, '+Inf': 100 }));
    expect(value).toBeCloseTo(5 + 5 * ((95 - 90) / (100 - 90)), 6);
  });

  it('answers the last finite bound for observations in +Inf, and null without observations', () => {
    expect(histogramQuantile(0.95, buckets({ '1': 0, '5': 0, '10': 90, '+Inf': 100 }))).toBe(10);
    expect(histogramQuantile(0.95, buckets({ '1': 0, '+Inf': 0 }))).toBeNull();
    expect(histogramQuantile(0.95, new Map())).toBeNull();
  });

  it('tolerates a non-monotonic series (a counter reset in the window)', () => {
    const value = histogramQuantile(0.5, buckets({ '1': 10, '5': 4, '10': 20, '+Inf': 20 }));
    expect(value).not.toBeNull();
    expect(value as number).toBeGreaterThan(0);
  });
});

describe('terminal_ssh_connect_p95', () => {
  const tableOf = (): AlertMetricTable => ({
    name: SSH_CONNECT_BUCKET_TABLE,
    columns: new Set(['greptime_timestamp', 'greptime_value', 'le', 'service', 'instance']),
    tags: ['instance', 'le', 'service'],
  });

  function ctxWith(rows: Array<[string, number]> | null, statements: string[] = []): AlertEvaluationContext {
    const tables = new Map<string, AlertMetricTable>(rows === null ? [] : [[SSH_CONNECT_BUCKET_TABLE, tableOf()]]);
    return {
      now: NOW,
      signal: new AbortController().signal,
      db: {} as never,
      verdict: async () => ({ level: 'ok', reasons: [] }),
      staleHeartbeatSeconds: async () => 60,
      telemetry: async () => ({
        tables,
        query: {
          sql: {
            literal: (v: string) => `'${v}'`,
            ident: (n: string) => `"${n}"`,
            timestamp: (d: Date) => `'${d.toISOString()}'`,
            between: (c: string, f: Date, t: Date) => `"${c}" >= '${f.toISOString()}' AND "${c}" < '${t.toISOString()}'`,
          },
          dialect: { timestampColumn: 'greptime_timestamp', valueColumn: 'greptime_value', castText: (e: string) => `CAST(${e} AS TEXT)` },
          query: async (statement: string) => {
            statements.push(statement);
            return { rows: rows ?? [] };
          },
        },
      }) as never,
    };
  }

  const rule = (config: object = {}) => ({
    id: 'r1',
    key: 'shellkeep.ssh_connect_slow',
    name: 'SSH connects are slow',
    severity: 'warning' as const,
    kind: TERMINAL_ALERT_KIND_IDS.SSH_CONNECT_P95,
    config: sshConnectP95Kind.configSchema.parse(config),
  });

  it('breaches when the p95 is above the threshold, naming the value in seconds', async () => {
    const statements: string[] = [];
    // 100 connects, 10 of them slower than 5 s: p95 is between 5 and 10.
    const [observation] = await sshConnectP95Kind.evaluate(
      ctxWith([['1', 40], ['5', 90], ['10', 100], ['+Inf', 100]], statements),
      rule(),
    );
    expect(observation.breached).toBe(true);
    expect(observation.value).toBeGreaterThan(5);
    expect(observation.summary).toMatch(/p95 is \d+\.\d+ s over 5 min \(> 5 s\)|p95 is \d+\.\d+ s over 10 min \(> 5 s\)/);
    // One statement, over the constant table, with a window from the config.
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain(`FROM "${SSH_CONNECT_BUCKET_TABLE}"`);
  });

  it('does not breach when the connects are fast', async () => {
    const [observation] = await sshConnectP95Kind.evaluate(ctxWith([['1', 98], ['5', 100], ['+Inf', 100]]), rule());
    expect(observation.breached).toBe(false);
    expect(observation.value).toBeLessThanOrEqual(5);
  });

  it('is not breached and says why when nobody connected or the table does not exist yet', async () => {
    const [empty] = await sshConnectP95Kind.evaluate(ctxWith([['1', 0], ['+Inf', 0]]), rule());
    expect(empty).toMatchObject({ breached: false, value: null });
    const [noTable] = await sshConnectP95Kind.evaluate(ctxWith(null), rule());
    expect(noTable).toMatchObject({ breached: false, value: null });
    expect(noTable.summary).toContain('no data yet');
  });

  it('validates its config: strict, bounded, with defaults', () => {
    expect(sshConnectP95Kind.configSchema.parse({})).toEqual({ windowSeconds: 600, quantile: 0.95, thresholdSeconds: 5 });
    expect(sshConnectP95Kind.configSchema.safeParse({ quantile: 2 }).success).toBe(false);
    expect(sshConnectP95Kind.configSchema.safeParse({ windowSeconds: 5 }).success).toBe(false);
    expect(sshConnectP95Kind.configSchema.safeParse({ sql: 'DROP TABLE x' }).success).toBe(false);
  });
});

describe('terminal_job_stalled', () => {
  const ctxWith = (finishedAt: Date | null): AlertEvaluationContext =>
    ({
      now: NOW,
      signal: new AbortController().signal,
      db: { job: { findFirst: jest.fn(async () => (finishedAt ? { finishedAt } : null)) } } as never,
      telemetry: async () => {
        throw new Error('the job kind must not need telemetry');
      },
      verdict: async () => ({ level: 'ok', reasons: [] }),
      staleHeartbeatSeconds: async () => 60,
    }) as never;

  const rule = () => ({
    id: 'r2',
    key: 'shellkeep.reaper_stalled',
    name: 'Session reaper stalled',
    severity: 'critical' as const,
    kind: TERMINAL_ALERT_KIND_IDS.JOB_STALLED,
    config: jobStalledKind.configSchema.parse({}),
  });

  it('defaults to the reaper job and 30 minutes', () => {
    expect(rule().config).toEqual({ jobType: 'terminal.session.reap', staleSeconds: 1800 });
  });

  it('is not breached while a job succeeded within the limit', async () => {
    const [observation] = await jobStalledKind.evaluate(ctxWith(new Date(NOW.getTime() - 4 * 60_000)), rule());
    expect(observation).toMatchObject({ breached: false, value: 4, labels: { job_type: 'terminal.session.reap' } });
  });

  it('breaches when the last success is older than the limit', async () => {
    const [observation] = await jobStalledKind.evaluate(ctxWith(new Date(NOW.getTime() - 45 * 60_000)), rule());
    expect(observation).toMatchObject({ breached: true, value: 45 });
    expect(observation.summary).toContain('45 min ago');
  });

  it('breaches when no job of the type has ever succeeded', async () => {
    const [observation] = await jobStalledKind.evaluate(ctxWith(null), rule());
    expect(observation).toMatchObject({ breached: true, value: null });
  });
});
