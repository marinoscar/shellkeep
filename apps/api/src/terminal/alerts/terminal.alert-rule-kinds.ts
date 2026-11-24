// =============================================================================
// ShellKeep's alert rule kinds (issue #54)
// =============================================================================
//
// Two conditions the platform's five built-in kinds cannot express, added with
// `registerAlertRuleKind` rather than by editing the package. KIND IDS ARE PERMANENT once a
// rule of the kind exists.
//
//   terminal_ssh_connect_p95   a quantile (p95 by default) of the SSH connect duration
//                              histogram (`app.terminal.ssh.connect.duration`, #53) over a
//                              window, compared to a number of seconds. `metric_threshold`
//                              aggregates a column; it cannot interpolate buckets.
//   terminal_job_stalled       no job of a type succeeded for a while (the session reaper,
//                              `terminal.session.reap`). A job-based kind: it reads the
//                              queue's own table, not telemetry, so it still works while
//                              the telemetry store is off.
//
// Both only READ. The first runs ONE statement through the guarded telemetry facade, every
// identifier and value through the facade's builders (nothing from a rule's config reaches
// SQL as text; the table is a constant). The second runs one indexed `findFirst`.
// =============================================================================

import { z } from 'zod';
import {
  registerAlertRuleKind,
  type AlertEvaluationContext,
  type AlertObservation,
  type AlertRuleKind,
  type AlertRuleView,
} from '@marinoscar/platform-api/alerts';

import { TERMINAL_SESSION_REAP_TYPE } from '../jobs/session-reap.handler';
import { histogramQuantile } from './histogram-quantile';

/** The ids of ShellKeep's kinds. PERMANENT. */
export const TERMINAL_ALERT_KIND_IDS = {
  SSH_CONNECT_P95: 'terminal_ssh_connect_p95',
  JOB_STALLED: 'terminal_job_stalled',
} as const;

/** The histogram's bucket table (the metric's name with the unit and the OTLP suffix). */
export const SSH_CONNECT_BUCKET_TABLE = 'app_terminal_ssh_connect_duration_seconds_bucket';

// ---------------------------------------------------------------------------
// terminal_ssh_connect_p95
// ---------------------------------------------------------------------------

export const sshConnectP95ConfigSchema = z
  .object({
    /** The look-back window (60 s to 24 h). */
    windowSeconds: z.number().int().min(60).max(86_400).default(600),
    /** The quantile, in (0, 1]. */
    quantile: z.number().gt(0).max(1).default(0.95),
    /** Breached when the quantile exceeds this many seconds. */
    thresholdSeconds: z.number().gt(0).max(3_600).default(5),
  })
  .strict();
export type SshConnectP95Config = z.infer<typeof sshConnectP95ConfigSchema>;

function formatSeconds(value: number): string {
  return value >= 10 ? value.toFixed(1) : value.toFixed(2);
}

export const sshConnectP95Kind: AlertRuleKind<SshConnectP95Config> = {
  id: TERMINAL_ALERT_KIND_IDS.SSH_CONNECT_P95,
  label: 'SSH connect latency (quantile)',
  description:
    'A quantile of the SSH connect duration over a window, from the histogram buckets, compared to a number of seconds.',
  configSchema: sshConnectP95ConfigSchema,

  async evaluate(ctx: AlertEvaluationContext, rule: AlertRuleView<SshConnectP95Config>): Promise<AlertObservation[]> {
    const { windowSeconds, quantile, thresholdSeconds } = rule.config;
    const telemetry = await ctx.telemetry();
    const table = telemetry.tables.get(SSH_CONNECT_BUCKET_TABLE);
    const label = `SSH connect p${Math.round(quantile * 100)}`;
    if (!table || !table.columns.has('le')) {
      // Nobody has connected since the store began (a fresh stack): nothing to alert on.
      return [{ labels: {}, value: null, breached: false, summary: `${label}: no data yet` }];
    }

    const { sql, dialect } = telemetry.query;
    const from = new Date(ctx.now.getTime() - windowSeconds * 1000);
    const value = sql.ident(dialect.valueColumn);
    // A histogram bucket is a cumulative counter per series: its increase over the window is
    // max - min, summed across the series (API instances) that share a bound.
    const seriesColumns = [...new Set([...table.tags, 'le'])];
    const inner =
      `SELECT ${[...seriesColumns.map((c) => sql.ident(c)), `MAX(${value}) - MIN(${value}) AS ${sql.ident('inc')}`].join(', ')} ` +
      `FROM ${sql.ident(table.name)} WHERE ${sql.between(dialect.timestampColumn, from, ctx.now)} ` +
      `GROUP BY ${seriesColumns.map((c) => sql.ident(c)).join(', ')}`;
    const statement =
      `SELECT ${dialect.castText(sql.ident('le'))} AS ${sql.ident('le')}, SUM(${sql.ident('inc')}) AS ${sql.ident('value')} ` +
      `FROM (${inner}) AS ${sql.ident('series')} GROUP BY ${sql.ident('le')}`;

    const result = await telemetry.query.query(statement, { maxRows: 200 });
    const buckets = new Map<string, number>();
    for (const row of result.rows) {
      const count = Number(row[1]);
      if (row[0] !== null && row[0] !== undefined && Number.isFinite(count)) buckets.set(String(row[0]), count);
    }

    const observed = histogramQuantile(quantile, buckets);
    if (observed === null) {
      return [{ labels: {}, value: null, breached: false, summary: `${label}: no connects in the window` }];
    }
    return [
      {
        labels: {},
        value: observed,
        breached: observed > thresholdSeconds,
        summary: `${label} is ${formatSeconds(observed)} s over ${Math.round(windowSeconds / 60)} min (> ${thresholdSeconds} s)`,
      },
    ];
  },

  describe: (rule) =>
    `p${Math.round(rule.config.quantile * 100)} of SSH connect duration over ${rule.config.windowSeconds}s > ${rule.config.thresholdSeconds}s`,
};

// ---------------------------------------------------------------------------
// terminal_job_stalled
// ---------------------------------------------------------------------------

export const jobStalledConfigSchema = z
  .object({
    /** The job type to watch. */
    jobType: z.string().min(1).max(128).default(TERMINAL_SESSION_REAP_TYPE),
    /** Breached when no job of the type has succeeded for this long (60 s to 7 days). */
    staleSeconds: z.number().int().min(60).max(604_800).default(1_800),
  })
  .strict();
export type JobStalledConfig = z.infer<typeof jobStalledConfigSchema>;

/** The one read of the queue table the kind makes (the tenant client carries no row-level security on `jobs`). */
interface JobsReader {
  job: {
    findFirst(args: {
      where: { type: string; status: 'succeeded' };
      orderBy: { finishedAt: 'desc' };
      select: { finishedAt: true };
    }): Promise<{ finishedAt: Date | null } | null>;
  };
}

export const jobStalledKind: AlertRuleKind<JobStalledConfig> = {
  id: TERMINAL_ALERT_KIND_IDS.JOB_STALLED,
  label: 'Job stalled',
  description: 'No job of a given type has succeeded for a while: its cron stopped, its worker is down or it keeps failing.',
  configSchema: jobStalledConfigSchema,

  async evaluate(ctx: AlertEvaluationContext, rule: AlertRuleView<JobStalledConfig>): Promise<AlertObservation[]> {
    const { jobType, staleSeconds } = rule.config;
    const last = await (ctx.db as unknown as JobsReader).job.findFirst({
      where: { type: jobType, status: 'succeeded' },
      orderBy: { finishedAt: 'desc' },
      select: { finishedAt: true },
    });
    const finishedAt = last?.finishedAt ?? null;
    const ageSeconds = finishedAt ? Math.max(0, (ctx.now.getTime() - finishedAt.getTime()) / 1000) : null;
    const breached = ageSeconds === null || ageSeconds > staleSeconds;
    const staleMinutes = Math.round(staleSeconds / 60);
    return [
      {
        labels: { job_type: jobType },
        value: ageSeconds === null ? null : Math.round(ageSeconds / 60),
        breached,
        summary:
          ageSeconds === null
            ? `${jobType}: no job has succeeded (none on record)`
            : `${jobType}: last success ${Math.round(ageSeconds / 60)} min ago (limit ${staleMinutes} min)`,
      },
    ];
  },

  describe: (rule) => `no ${rule.config.jobType} job succeeded for ${Math.round(rule.config.staleSeconds / 60)} min`,
};

let registered = false;

/** Registers the kinds. Idempotent per process; call before the application bootstraps (the registry freezes). */
export function registerTerminalAlertKinds(): void {
  if (registered) return;
  registered = true;
  registerAlertRuleKind(sshConnectP95Kind);
  registerAlertRuleKind(jobStalledKind);
}
