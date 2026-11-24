# Runbook: Set up and tune alerts

> **Audience:** operators · **API:** `/api/admin/alerts` · **Permission:** `alerts:read` to look, `alerts:write` to change (administrators) · **Added by:** #54

Use this when you want to be told that SSH connects are failing or slow, that terminal WebSocket authentications are being refused in bulk, or that the idle-session reaper stopped, without watching a dashboard. It covers enabling the four ShellKeep starter rules, tuning them, acknowledging incidents and what happens when telemetry is off. The alerts page arrives with the web change of #54; until then use the API (OpenAPI reference at `/api/docs`, tag `Alerts`).

## 1. Before you start

- You need an Admin account (`alerts:read` and `alerts:write`).
- Three of the four rules read the terminal metrics of the telemetry slice, so telemetry must be on (switch it on in `/admin/settings/telemetry`). The reaper rule reads the job queue and works with telemetry off.
- Notifications go to every holder of `alerts:read` on the channels they allow in their own preferences (`alerts.alert_fired`, `alerts.alert_resolved`; bell, email and push). Email needs a configured transport.
- List the rules: `GET /api/admin/alerts/rules`. Every starter rule exists and is **disabled**.

## 2. The four ShellKeep starter rules

Seeded at start, disabled, under permanent keys, and never overwritten: an edit, an enabled flag or a threshold you set survives every restart and upgrade. A starter rule can be edited and disabled, not deleted.

| Key | Condition | Severity | Notes |
|---|---|---|---|
| `shellkeep.ssh_connect_failures` | More than 10 SSH connects failed over 10 minutes | warning | `metric_threshold`: a `rate` (the counter's increase per minute) of `app_terminal_ssh_connect_duration_seconds_count` above 1 over 600 s, where `outcome` is neither `ok` nor `host_key_unknown` (an unknown key is a prompt, not a failure). Edit the threshold in per-minute units |
| `shellkeep.ssh_connect_slow` | p95 of the connect duration above 5 s | warning | `terminal_ssh_connect_p95`: the quantile of the histogram over the last 5 minutes, held for 10 minutes (`forSeconds` 600) |
| `shellkeep.ws_auth_denied_spike` | More than 20 WebSocket authentications refused over 5 minutes | warning | `metric_threshold`: a rate of `app.terminal.ws.auth_denied` above 4 per minute over 300 s. A spike can be token abuse or a broken client; the `reason` label is in the metric |
| `shellkeep.reaper_stalled` | No `terminal.session.reap` job succeeded for 30 minutes | critical | `terminal_job_stalled`: reads the queue table; it runs every 5 minutes, so 30 minutes is six missed passes. `forSeconds` 300 absorbs the first minutes of a fresh stack |

The two ShellKeep rule kinds (`terminal_ssh_connect_p95`, `terminal_job_stalled`) are listed by `GET /api/admin/alerts/kinds` with the JSON Schema of their config. Kind ids are permanent.

## 3. Enable and test a rule

1. Dry-run: `POST /api/admin/alerts/rules/<id>/test` returns what the rule observes right now (labels, value, breached or not, summary). Nothing is stored or sent.
2. Enable: `PATCH /api/admin/alerts/rules/<id>` with `{ "enabled": true }`. Within a minute `lastEvaluatedAt` is set and `lastError` is `null`.
3. To exercise `shellkeep.ssh_connect_failures`, enable it and point a profile at a closed port: each failed connect records `outcome=refused`, and once more than 10 land inside the window the rule fires an incident and the notification.

## 4. Incidents, tuning and channels

- `GET /api/admin/alerts/incidents?state=firing`, `POST .../incidents/<id>/acknowledge`, `GET /api/admin/alerts/summary`. States: `pending` (breached, waiting out `forSeconds`), `firing`, `resolved`. Acknowledging marks that someone is on it; it does not silence anything. Resolved incidents are kept 90 days.
- `forSeconds` is how long the condition must hold before the alert fires; `cooldownSeconds` (default 900) suppresses the notification (not the incident) when the same rule fires again soon after a resolve; `notifyChannels` restricts a rule to some channels (empty: each recipient's preferences).
- `webhook` (default on) also emits `alerts.alert.fired` and `alerts.alert.resolved` to the deployment's webhook endpoints ([webhooks runbook](webhooks.md)).

## 5. When telemetry is off

A `metric_threshold` rule and `terminal_ssh_connect_p95` cannot be evaluated while telemetry is off or the store is unreachable: `lastError` says so and open incidents are left as they were. `shellkeep.reaper_stalled` is unaffected. Enable the platform's `telemetry.unavailable` starter rule to be told about the outage.

## 6. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| A rule never fires | Disabled, or the condition does not hold | Check `enabled`, `lastEvaluatedAt` and `lastError`; run the test route |
| `lastError`: the store has no table for the metric | Nobody has connected since the store began, or telemetry is off | Open a terminal once; check telemetry |
| Fired but nobody was notified | Inside the cooldown, a restricted `notifyChannels`, or the holders muted the event | Check cooldown, channels and preferences |
| `shellkeep.reaper_stalled` fires on a fresh stack | No reap job has run yet | It clears after the first pass (within 5 minutes); `forSeconds` already absorbs it |
| The reaper rule fires for real | The cron or the worker stopped, or the job keeps failing | Admin > Jobs, filter `terminal.session.reap`; the Doctor check `terminal.sessions.reaper` |
| Delete answers `409 ALERT_STARTER_RULE_PROTECTED` | Starter rules cannot be deleted | Disable it |

## See also

- [Webhooks runbook](webhooks.md), [local exceptions](../platform-adoption/local-exceptions.md#webhooks-and-alerts-54)
