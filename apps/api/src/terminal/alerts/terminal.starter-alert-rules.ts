// =============================================================================
// ShellKeep's starter alert rules (issue #54)
// =============================================================================
//
// Four rules over the terminal's metrics (#53) and the reaper job (#49), seeded DISABLED by
// a stable key and NEVER overwritten (`TerminalAlertRulesSeed`): an administrator's edits,
// enabling and thresholds survive every restart. KEYS ARE PERMANENT. A starter rule cannot be
// deleted through the API, only edited and disabled.
//
// The platform's own starter rules (`nodes.*`, `jobs.*`, `telemetry.*`) are the slice's; the
// slice has no hook for an app's, so these are seeded by ShellKeep's own service with the
// same "insert if the key is absent" rule (docs/platform-adoption/local-exceptions.md).
//
// COUNTER RATES. The `rate` aggregation of `metric_threshold` is the counter's increase per
// MINUTE over the window. So "more than 10 failed connects in 10 minutes" is a rate above
// 1 per minute over a 600 s window, and "more than 20 refusals in 5 minutes" is a rate above
// 4 per minute over a 300 s window. Edit the threshold in those units.
//
// An unknown host key (`host_key_unknown`) is an expected prompt, not a failure, so the
// connect-failure rule excludes it as well as `ok`.
// =============================================================================

import type { CreateAlertRule } from '@marinoscar/platform-contract/alerts';

import { TERMINAL_ALERT_KIND_IDS } from './terminal.alert-rule-kinds';

/** The stable keys of ShellKeep's starter rules. PERMANENT. */
export const TERMINAL_STARTER_RULE_KEYS = {
  SSH_CONNECT_FAILURES: 'shellkeep.ssh_connect_failures',
  SSH_CONNECT_SLOW: 'shellkeep.ssh_connect_slow',
  WS_AUTH_DENIED_SPIKE: 'shellkeep.ws_auth_denied_spike',
  REAPER_STALLED: 'shellkeep.reaper_stalled',
} as const;

export interface TerminalStarterRule {
  /** The stable key (`alert_rules.key`). */
  readonly key: string;
  /** The rule; always seeded disabled. */
  readonly rule: Omit<CreateAlertRule, 'enabled'>;
}

const base = { notifyChannels: [] as string[], webhook: true, cooldownSeconds: 900 };

export const TERMINAL_STARTER_ALERT_RULES: readonly TerminalStarterRule[] = [
  {
    key: TERMINAL_STARTER_RULE_KEYS.SSH_CONNECT_FAILURES,
    rule: {
      ...base,
      name: 'SSH connects are failing',
      description:
        'More than 10 SSH connects failed over 10 minutes (a rate above 1 per minute): refused, timed out, rejected credentials or a changed host key. An unknown host key is not counted.',
      kind: 'metric_threshold',
      severity: 'warning',
      forSeconds: 0,
      config: {
        metric: 'app_terminal_ssh_connect_duration_seconds_count',
        aggregation: 'rate',
        windowSeconds: 600,
        comparator: 'gt',
        threshold: 1,
        filters: [
          { attr: 'outcome', op: 'neq', value: 'ok' },
          { attr: 'outcome', op: 'neq', value: 'host_key_unknown' },
        ],
      },
    },
  },
  {
    key: TERMINAL_STARTER_RULE_KEYS.SSH_CONNECT_SLOW,
    rule: {
      ...base,
      name: 'SSH connects are slow',
      description:
        'The 95th percentile of the SSH connect duration (over the last 5 minutes) stayed above 5 seconds for 10 minutes.',
      kind: TERMINAL_ALERT_KIND_IDS.SSH_CONNECT_P95,
      severity: 'warning',
      forSeconds: 600,
      config: { windowSeconds: 300, quantile: 0.95, thresholdSeconds: 5 },
    },
  },
  {
    key: TERMINAL_STARTER_RULE_KEYS.WS_AUTH_DENIED_SPIKE,
    rule: {
      ...base,
      name: 'Terminal WebSocket refusals spiking',
      description:
        'More than 20 terminal WebSocket authentications were refused over 5 minutes (a rate above 4 per minute): possible token abuse or a broken client.',
      kind: 'metric_threshold',
      severity: 'warning',
      forSeconds: 0,
      config: {
        metric: 'app.terminal.ws.auth_denied',
        aggregation: 'rate',
        windowSeconds: 300,
        comparator: 'gt',
        threshold: 4,
      },
    },
  },
  {
    key: TERMINAL_STARTER_RULE_KEYS.REAPER_STALLED,
    rule: {
      ...base,
      name: 'Session reaper stalled',
      description:
        'No `terminal.session.reap` job succeeded for 30 minutes (it normally runs every 5): idle sessions are not being detached or closed. Check Admin > Jobs.',
      kind: TERMINAL_ALERT_KIND_IDS.JOB_STALLED,
      severity: 'critical',
      // Five minutes of grace: right after the rule is enabled on a fresh stack the first job may not have run yet.
      forSeconds: 300,
      config: { jobType: 'terminal.session.reap', staleSeconds: 1800 },
    },
  },
];
