// =============================================================================
// ShellKeep's notification manifest (issue #51)
// =============================================================================
//
// THE explicit, grep-able list of every channel, email template and notification
// this application has. Imported by `registrations.ts` (so before anything reads the
// registries, and before the application bootstraps and freezes them). It lives here,
// not in `platform/notifications/`, because that folder is base code and may not name
// the terminal domain (`test/architecture/base-domain-boundary.spec.ts`).
//
// Order, which is behaviour: channels before events (an event may only declare a
// registered channel); templates before notifications (a binding may only name a
// registered template); the platform's before the app's. The preferences matrix lists
// events in registration order, so APPEND, never insert.
//
// Never register from `onModuleInit`: several Nest applications share one module graph
// in a Jest worker, and the second would hit a frozen registry.
// =============================================================================

import {
  configureEmailRendering,
  registerEmailTemplates,
  registerPlatformEmailTemplates,
} from '@marinoscar/platform-api/email';
import { ALERTS_NOTIFICATIONS, registerAlertsEmailTemplates } from '@marinoscar/platform-api/alerts';
import {
  BROADCASTS_NOTIFICATIONS,
  NODES_NOTIFICATIONS,
  OPS_NOTIFICATIONS,
  isRegisteredNotificationChannel,
  registerNotificationChannel,
  registerNotifications,
  registerPlatformNotificationChannels,
} from '@marinoscar/platform-api/notifications';
import {
  WEBHOOKS_NOTIFICATIONS,
  WEBHOOK_NOTIFICATION_CHANNEL,
  registerWebhooksEmailTemplates,
} from '@marinoscar/platform-api/webhooks';

import { SHARING_EMAIL_TEMPLATES, SHELLKEEP_EMAIL_TEMPLATES } from '../email-templates';
import { DB_BACKUP_NOTIFICATIONS } from '../platform/db-backup/db-backup.notifications';
import { IDENTITY_NOTIFICATIONS } from '../notifications-registry/identity.notifications';
import { TERMINAL_NOTIFICATIONS } from '../notifications-registry/terminal.notifications';
import { EMAIL_MODULE_OPTIONS } from '../platform/email/email.options';
import { SHARING_NOTIFICATIONS } from '../platform/sharing/sharing.notifications';

let registered = false;

/** Fills the channel, template and event registries. Idempotent per process. */
export function registerShellkeepNotifications(): void {
  if (registered) return;
  registered = true;

  // 1. Channels: email, browser (the bell) and push. No app channel.
  registerPlatformNotificationChannels();
  // The webhooks slice's `webhook` channel (#54): a member's notifications, forwarded to their own
  // webhook endpoints that subscribe to `notification.<eventKey>`. ShellKeep's own events do not
  // opt in (`withWebhookChannel`): the terminal's webhooks are the events of
  // `terminal/webhooks/terminal.webhook-events.ts`. The id belongs to the slice (a second channel
  // of the same id is `DUPLICATE_ID`); `WebhooksModule.forRoot` registers its sender.
  if (!isRegisteredNotificationChannel(WEBHOOK_NOTIFICATION_CHANNEL.id)) {
    registerNotificationChannel(WEBHOOK_NOTIFICATION_CHANNEL);
  }

  // 2. Email templates. The render context first, with the options `EmailModule.forRoot`
  //    receives, so a template rendered before Nest composes anything names the product.
  configureEmailRendering(EMAIL_MODULE_OPTIONS);
  registerPlatformEmailTemplates();
  registerEmailTemplates(SHELLKEEP_EMAIL_TEMPLATES);
  // The alerts slice's two emails (#54) and the webhooks slice's one (`webhooks.endpoint_disabled`, #54).
  registerAlertsEmailTemplates();
  registerWebhooksEmailTemplates();
  // The sharing slice's two emails (#71): `group-invitation` and `shared-with-you`.
  registerEmailTemplates(SHARING_EMAIL_TEMPLATES);

  // 3. Notifications, in the order the preferences matrix shows them.
  registerNotifications([
    ...IDENTITY_NOTIFICATIONS,
    ...BROADCASTS_NOTIFICATIONS,
    ...OPS_NOTIFICATIONS,
    ...NODES_NOTIFICATIONS,
    ...TERMINAL_NOTIFICATIONS,
    // Database backup (#52): `db_backup.backup_failed` and the mandatory `db_backup.restore_completed`.
    ...DB_BACKUP_NOTIFICATIONS,
    // Alerts (#54): `alerts.alert_fired` and `alerts.alert_resolved`, to the holders of `alerts:read`.
    ...ALERTS_NOTIFICATIONS,
    // Webhooks (#54): `webhooks.endpoint_disabled`, to the owner of an endpoint the slice switched off.
    ...WEBHOOKS_NOTIFICATIONS,
    // Sharing (#71): `groups.invitation` and `sharing.shared_with_you`, on the email and browser channels.
    ...SHARING_NOTIFICATIONS,
  ]);
  // The runbook events are NOT here: `registerRunbookNotifications()` (#61).
}

registerShellkeepNotifications();
