// =============================================================================
// The alerts slice, configured once (issue #54)
// =============================================================================
//
// `@marinoscar/platform-api/alerts`: rules over telemetry metrics, worker-node events and fleet
// health, incidents with a pending/firing/resolved state machine, a notification to the holders
// of `alerts:read` on every transition and an optional webhook, under `/api/admin/alerts`.
//
// `seedStarterRules: true` seeds the PLATFORM's eight starter rules, disabled. The app's own
// starter rules and rule kinds are the domain's (`src/<domain>/alerts/`, seeded by its own
// service, because the slice's list is fixed); see docs/platform-adoption/local-exceptions.md.
//
// The manifest half lives where the other slices' does: the two email templates and the two
// events in `app-registrations/notifications.ts`, the `app.alerts.*` metrics in
// `platform/host-app-metrics.ts`, the permissions in `app-registrations/platform-slices.ts`, the
// app's rule kinds in `app-registrations/webhooks.ts`.
//
// The jobs and telemetry modules are imported so the metric and verdict kinds can read the store.
// The webhook port is bound to the webhooks slice through `AlertsWebhookAdapter`, which also
// registers the `alerts.alert.fired` and `alerts.alert.resolved` events in the webhooks catalog.
// =============================================================================

import { Module } from '@nestjs/common';
import { ALERTS_WEBHOOK_EMITTER, AlertsModule as PlatformAlertsModule } from '@marinoscar/platform-api/alerts';

import { jobsModule } from '../jobs/jobs.config';
import { telemetryModule } from '../telemetry/telemetry.config';
import { webhooksModule } from '../webhooks/webhooks.config';
import { AlertsWebhookAdapter, registerAlertWebhookEvents } from './alerts-webhooks.adapter';

registerAlertWebhookEvents();

/** Binds the alerts webhook port to `WebhooksService.emit`. */
@Module({
  imports: [webhooksModule],
  providers: [AlertsWebhookAdapter, { provide: ALERTS_WEBHOOK_EMITTER, useExisting: AlertsWebhookAdapter }],
  exports: [ALERTS_WEBHOOK_EMITTER],
})
export class AlertsWebhooksHostModule {}

/** The slice, mounted once in `AppModule`. */
export const alertsModule = PlatformAlertsModule.forRoot({
  seedStarterRules: true,
  imports: [jobsModule, telemetryModule, AlertsWebhooksHostModule],
});
