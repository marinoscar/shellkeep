// =============================================================================
// ShellKeep's alert rule kinds (issue #54)
// =============================================================================
//
// Import-time registration for the alerts slice's open kind registry: static, frozen when
// the application boots. Imported by `registrations.ts`.
//
//   registerTerminalAlertKinds   terminal_ssh_connect_p95, terminal_job_stalled
//
// The alerts slice's own email templates and notification events are in `notifications.ts`;
// its metrics in `platform/host-app-metrics.ts`; its permissions come with the `alerts`
// entry of `platform-slices.ts`. The starter rules are seeded at start by
// `terminal/alerts/terminal-alert-rules.seed.ts`.
// =============================================================================

import { registerTerminalAlertKinds } from '../terminal/alerts/terminal.alert-rule-kinds';

registerTerminalAlertKinds();
