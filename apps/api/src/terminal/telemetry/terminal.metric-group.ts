// =============================================================================
// The "Terminal" dashboard metric group (issue #53)
// =============================================================================
//
// ShellKeep's one dashboard group, passed to `TelemetryModule.forRoot({ metricGroups })`
// (`app-registrations/telemetry.ts` -> `platform/telemetry/telemetry.config.ts`), after
// the platform's six. Served by `GET /api/admin/telemetry/dashboard/metrics?group=terminal`
// and drawn by the dashboard with no web change: it renders any group the API reports.
//
// WHAT IT READS. The tables the `app.terminal.*` metrics become in GreptimeDB (naming:
// dots to `_`, `_total` on counters, `_seconds_{bucket,sum,count}` on a histogram of
// unit `s`; see `terminal.metrics.ts`):
//
//   app_terminal_sessions                              gauge      status
//   app_terminal_ws_connections                        gauge
//   app_terminal_ssh_connections                       gauge
//   app_terminal_ws_auth_denied_total                  counter    reason
//   app_terminal_ssh_connect_duration_seconds_count    counter    outcome   (the histogram's own count)
//   app_terminal_ssh_connect_duration_seconds_bucket   histogram  le
//   app_terminal_sessions_reaped_total                 counter    action
//
// The session gauge is database-wide (every replica reports the same value, so it is read
// as a maximum); the two connection gauges are per process (summed across replicas). A
// family whose table does not exist yet (a fresh stack, a deployment nobody has opened a
// terminal on) is skipped, never an error: the section shows "no data yet".
//
// "SSH connect success" is `ok` over every attempt that was actually tried. An unknown host
// key (`host_key_unknown`) is an expected prompt, not a failed connect, so it is left out of
// the denominator.
// =============================================================================

import type { MetricGroupDef } from '@marinoscar/platform-api/telemetry';

declare module '@marinoscar/platform-api/telemetry' {
  interface MetricGroupIds {
    /** ShellKeep's terminal: sessions, WebSocket connections, SSH connects and the reaper. */
    terminal: true;
  }
}

/** The API's own tables carry the service and the instance (their `host_name` is the API container). */
const FILTERS = ['service', 'instance'] as const;

/** Every outcome a connect was actually attempted with; the denominator of the success ratio. */
const ATTEMPTED_OUTCOMES = ['ok', 'auth_failed', 'timeout', 'host_key_mismatch', 'refused', 'error'] as const;

export const TERMINAL_METRIC_GROUP: MetricGroupDef = {
  id: 'terminal',
  label: 'Terminal',
  title: 'Terminal',
  // The platform's six groups use 10 to 60; an app's go after them.
  order: 70,
  description:
    'live sessions and connections, SSH connect success and latency, WebSocket authentication refusals, idle-session reaping',
  families: [
    {
      key: 'terminalSessions',
      group: 'terminal',
      label: 'Terminal sessions',
      table: 'app_terminal_sessions',
      kind: 'gauge',
      unit: 'count',
      groupBy: 'status',
      requiredColumns: ['status'],
      // The same database-wide value from every replica: the maximum, never the sum.
      seriesAggregate: 'max',
      bucketAggregate: 'max',
      filters: FILTERS,
      tileGroups: ['active', 'detached'],
    },
    {
      key: 'terminalWsConnections',
      group: 'terminal',
      label: 'WebSocket connections',
      table: 'app_terminal_ws_connections',
      kind: 'gauge',
      unit: 'count',
      requiredColumns: [],
      // One value per API process: the fleet's total is their sum.
      seriesAggregate: 'sum',
      bucketAggregate: 'max',
      filters: FILTERS,
    },
    {
      key: 'terminalSshConnections',
      group: 'terminal',
      label: 'SSH connections',
      table: 'app_terminal_ssh_connections',
      kind: 'gauge',
      unit: 'count',
      requiredColumns: [],
      seriesAggregate: 'sum',
      bucketAggregate: 'max',
      filters: FILTERS,
    },
    {
      key: 'terminalSshConnects',
      group: 'terminal',
      label: 'SSH connects',
      table: 'app_terminal_ssh_connect_duration_seconds_count',
      kind: 'counter',
      unit: 'count',
      rate: 'count',
      groupBy: 'outcome',
      requiredColumns: ['outcome'],
      filters: FILTERS,
    },
    {
      key: 'terminalSshConnectP95',
      group: 'terminal',
      label: 'SSH connect p95',
      table: 'app_terminal_ssh_connect_duration_seconds_bucket',
      kind: 'histogram',
      unit: 'seconds',
      quantile: 0.95,
      requiredColumns: ['le'],
      filters: FILTERS,
      series: false,
    },
    {
      key: 'terminalWsAuthDenied',
      group: 'terminal',
      label: 'WebSocket auth refusals',
      table: 'app_terminal_ws_auth_denied_total',
      kind: 'counter',
      unit: 'count',
      rate: 'count',
      groupBy: 'reason',
      requiredColumns: ['reason'],
      filters: FILTERS,
    },
    {
      key: 'terminalSessionsReaped',
      group: 'terminal',
      label: 'Sessions reaped',
      table: 'app_terminal_sessions_reaped_total',
      kind: 'counter',
      unit: 'count',
      rate: 'count',
      groupBy: 'action',
      requiredColumns: ['action'],
      filters: FILTERS,
    },
  ],
  ratios: [
    {
      key: 'terminalSshConnectSuccess',
      group: 'terminal',
      label: 'SSH connect success',
      unit: '%',
      numerator: [{ family: 'terminalSshConnects', groups: ['ok'] }],
      denominator: [{ family: 'terminalSshConnects', groups: [...ATTEMPTED_OUTCOMES] }],
      scale: 100,
    },
  ],
  presentation: {
    tiles: [
      { metric: 'terminalSessions.active', label: 'Active sessions', color: 'ok' },
      { metric: 'terminalSessions.detached', label: 'Detached sessions' },
      { metric: 'terminalWsConnections' },
      { metric: 'terminalSshConnections' },
      { metric: 'terminalSshConnectSuccess' },
      { metric: 'terminalSshConnectP95' },
      { metric: 'terminalWsAuthDenied' },
      { metric: 'terminalSessionsReaped' },
    ],
    series: [
      { title: 'Sessions by status', metrics: ['terminalSessions'], colors: { active: 'ok', detached: 'info' } },
      {
        title: 'SSH connects by outcome',
        metrics: ['terminalSshConnects'],
        colors: {
          ok: 'ok',
          host_key_unknown: 'info',
          timeout: 'warn',
          refused: 'warn',
          host_key_mismatch: 'crit',
          auth_failed: 'crit',
          error: 'crit',
        },
      },
      {
        title: 'WebSocket auth refusals by reason',
        metrics: ['terminalWsAuthDenied'],
        colors: { invalid_token: 'warn', forbidden: 'warn', expired: 'info', maintenance: 'info', timeout: 'warn' },
      },
      { title: 'Connections', metrics: ['terminalWsConnections', 'terminalSshConnections'] },
    ],
  },
};
