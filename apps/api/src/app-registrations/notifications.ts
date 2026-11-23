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
  registerPlatformEmailTemplates,
} from '@marinoscar/platform-api/email';
import {
  BROADCASTS_NOTIFICATIONS,
  NODES_NOTIFICATIONS,
  OPS_NOTIFICATIONS,
  registerNotifications,
  registerPlatformNotificationChannels,
} from '@marinoscar/platform-api/notifications';

import { IDENTITY_NOTIFICATIONS } from '../notifications-registry/identity.notifications';
import { EMAIL_MODULE_OPTIONS } from '../platform/email/email.options';

let registered = false;

/** Fills the channel, template and event registries. Idempotent per process. */
export function registerShellkeepNotifications(): void {
  if (registered) return;
  registered = true;

  // 1. Channels: email, browser (the bell) and push. No app channel.
  registerPlatformNotificationChannels();

  // 2. Email templates. The render context first, with the options `EmailModule.forRoot`
  //    receives, so a template rendered before Nest composes anything names the product.
  configureEmailRendering(EMAIL_MODULE_OPTIONS);
  registerPlatformEmailTemplates();

  // 3. Notifications, in the order the preferences matrix shows them.
  registerNotifications([
    ...IDENTITY_NOTIFICATIONS,
    ...BROADCASTS_NOTIFICATIONS,
    ...OPS_NOTIFICATIONS,
    ...NODES_NOTIFICATIONS,
  ]);
  // The runbook events are NOT here: `registerRunbookNotifications()` (#61).
}

registerShellkeepNotifications();
