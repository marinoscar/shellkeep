// =============================================================================
// The terminal's app metrics (issue #53)
// =============================================================================
//
// Declared here, registered with the platform's app-metric registry by
// `app-registrations/telemetry.ts` (`APP_METRICS`, after the platform's own, before
// the registries freeze at bootstrap) and recorded through `TerminalMetricsService`
// and `AppMetricsService`. The dashboard's "Terminal" group
// (`terminal.metric-group.ts`) reads the tables these names become.
//
//   key                 name                                kind       unit        attributes                      table
//   terminalSessions    app.terminal.sessions               gauge      {session}   status (active, detached)       app_terminal_sessions
//   terminalWsConns     app.terminal.ws.connections         gauge      {connection} none                          app_terminal_ws_connections
//   terminalWsAuthDeny  app.terminal.ws.auth_denied         counter    {denial}    reason (5 values below)         app_terminal_ws_auth_denied_total
//   terminalSshConnect  app.terminal.ssh.connect.duration   histogram  s           outcome (SSH_CONNECT_OUTCOMES)  app_terminal_ssh_connect_duration_seconds_*
//   terminalSshConns    app.terminal.ssh.connections        gauge      {connection} none                          app_terminal_ssh_connections
//   terminalReaped      app.terminal.sessions.reaped        counter    {session}   action (3 values below)         app_terminal_sessions_reaped_total
//
// PRIVACY AND CARDINALITY: every attribute is an `enum`, so a value outside its set
// becomes `other`. NEVER a user id, hostname, session id, profile id or org id as a
// metric attribute; `org.id`, `session.id` and `server_profile.id` go on SPANS only
// (`terminal.ssh.connect`, `terminal.ws.session`). No terminal input or output is
// ever put in a metric, span or log.
//
// The metric NAMES are permanent: they are the GreptimeDB table names.
// =============================================================================

import type { AppMetricDef } from '@marinoscar/platform-api/otel-core';

import { SSH_CONNECT_OUTCOMES } from '../../ssh/ssh-connect-outcome';

export const TERMINAL_SESSIONS_METRIC = 'terminalSessions';
export const TERMINAL_WS_CONNECTIONS_METRIC = 'terminalWsConnections';
export const TERMINAL_WS_AUTH_DENIED_METRIC = 'terminalWsAuthDenied';
export const TERMINAL_SSH_CONNECT_DURATION_METRIC = 'terminalSshConnectDuration';
export const TERMINAL_SSH_CONNECTIONS_METRIC = 'terminalSshConnections';
export const TERMINAL_SESSIONS_REAPED_METRIC = 'terminalSessionsReaped';

/** The session states the gauge reports. */
export const TERMINAL_SESSION_GAUGE_STATUSES = ['active', 'detached'] as const;

/** Why the gateway refused or ended an authentication. */
export const WS_AUTH_DENIED_REASONS = ['invalid_token', 'forbidden', 'expired', 'maintenance', 'timeout'] as const;
export type WsAuthDeniedReason = (typeof WS_AUTH_DENIED_REASONS)[number];

/** What the reaper did to a session. */
export const SESSION_REAP_ACTIONS = ['detached', 'terminated', 'purged'] as const;
export type SessionReapAction = (typeof SESSION_REAP_ACTIONS)[number];

/** Connect-duration buckets, in seconds. */
export const SSH_CONNECT_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30] as const;

declare module '@marinoscar/platform-api/otel-core' {
  interface AppMetricKeys {
    terminalSessions: true;
    terminalWsConnections: true;
    terminalWsAuthDenied: true;
    terminalSshConnectDuration: true;
    terminalSshConnections: true;
    terminalSessionsReaped: true;
  }
}

export const TERMINAL_APP_METRICS: readonly AppMetricDef[] = [
  {
    key: TERMINAL_SESSIONS_METRIC,
    name: 'app.terminal.sessions',
    kind: 'gauge',
    unit: '{session}',
    description: 'Terminal sessions by status (active, detached), database-wide; read every 60 seconds.',
    attributes: { status: { kind: 'enum', values: TERMINAL_SESSION_GAUGE_STATUSES } },
  },
  {
    key: TERMINAL_WS_CONNECTIONS_METRIC,
    name: 'app.terminal.ws.connections',
    kind: 'gauge',
    unit: '{connection}',
    description: 'Authenticated terminal WebSocket connections held by this API process.',
  },
  {
    key: TERMINAL_WS_AUTH_DENIED_METRIC,
    name: 'app.terminal.ws.auth_denied',
    kind: 'counter',
    unit: '{denial}',
    description: 'Terminal WebSocket authentications refused or expired, by reason.',
    attributes: { reason: { kind: 'enum', values: WS_AUTH_DENIED_REASONS } },
  },
  {
    key: TERMINAL_SSH_CONNECT_DURATION_METRIC,
    name: 'app.terminal.ssh.connect.duration',
    kind: 'histogram',
    unit: 's',
    description: 'Time to open an SSH connection (handshake, host-key check, authentication), by outcome.',
    buckets: SSH_CONNECT_BUCKETS,
    attributes: { outcome: { kind: 'enum', values: SSH_CONNECT_OUTCOMES } },
  },
  {
    key: TERMINAL_SSH_CONNECTIONS_METRIC,
    name: 'app.terminal.ssh.connections',
    kind: 'gauge',
    unit: '{connection}',
    description: 'Live interactive SSH connections held by this API process.',
  },
  {
    key: TERMINAL_SESSIONS_REAPED_METRIC,
    name: 'app.terminal.sessions.reaped',
    kind: 'counter',
    unit: '{session}',
    description: 'Terminal sessions moved on by the idle-session reaper, by action.',
    attributes: { action: { kind: 'enum', values: SESSION_REAP_ACTIONS } },
  },
];
