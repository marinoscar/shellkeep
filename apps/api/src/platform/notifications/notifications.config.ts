// =============================================================================
// The notifications slice's composition (issue #51)
// =============================================================================
//
// One `NotificationsModule.forRoot()`: the dispatcher, the email, browser and
// push channels, `/api/notifications` (inbox, preferences matrix, SSE stream,
// push subscriptions), `/api/admin/push-config` (runtime VAPID keys, the private
// key in the credential store under purpose `push_vapid`), the VAPID doctor
// check and the job-failure and node-offline notifiers. `BroadcastsModule` is
// the admin broadcast routes (`/api/admin/broadcasts`).
//
// The channel, template and event registries are filled by
// `app-registrations/notifications.ts` (imported by `shellkeep.manifest.ts`, first
// in `main.ts`, `app.module.ts` and the test setup), before this module composes.
// =============================================================================

import { BroadcastsModule, NotificationsModule } from '@marinoscar/platform-api/notifications';

import { emailModule } from '../email/email.config';
import { NotificationsHostModule } from './notifications-host.module';

export const notificationsModule = NotificationsModule.forRoot({
  imports: [emailModule, NotificationsHostModule],
});

export { BroadcastsModule };
