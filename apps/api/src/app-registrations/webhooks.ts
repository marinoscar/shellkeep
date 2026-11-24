// =============================================================================
// ShellKeep's webhook events (issue #54)
// =============================================================================
//
// Import-time registration for the webhooks slice's open event catalog: a static registry
// that freezes when the application boots, so it cannot be filled from a provider. Imported
// by `registrations.ts`.
//
//   registerTerminalWebhookEvents   terminal.session.created, terminal.session.terminated,
//                                   server_profile.host_key_changed
//
// The slice's channel, email template and notification event are in `notifications.ts`; the
// signing-secret credential purposes in `credentials.ts`; the slice's metrics in
// `platform/host-app-metrics.ts`. ShellKeep's alert rule kinds are in `alerts.ts`.
// =============================================================================

import { registerTerminalWebhookEvents } from '../terminal/webhooks/terminal.webhook-events';

registerTerminalWebhookEvents();
