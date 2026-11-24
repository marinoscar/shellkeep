// =============================================================================
// The notifications slice's host ports (issue #51)
// =============================================================================
//
//   NOTIFICATIONS_EVENT_BUS  the host core's cross-replica event bus, with its oversize
//                            check, so the SSE stream publishes a reference instead of a
//                            notification too large for the Postgres adapter's NOTIFY
//   NOTIFICATIONS_METRICS    the host core's `AppMetricsService`
//
// Global: the dispatcher and every channel sender inject the tokens.
// =============================================================================

import { Global, Module } from '@nestjs/common';
import { AppMetricsService, EVENT_BUS, exceedsEventBusPayloadLimit } from '@marinoscar/platform-api/host';
import type { EventBus } from '@marinoscar/platform-api/host';
import { NOTIFICATIONS_EVENT_BUS, NOTIFICATIONS_METRICS } from '@marinoscar/platform-api/notifications';
import type { NotificationsEventBus } from '@marinoscar/platform-api/notifications';

/** The stream's view of the host core's event bus. */
export function notificationsEventBusOf(bus: EventBus): NotificationsEventBus {
  return {
    publish: (channel, payload) => bus.publish(channel, payload),
    subscribe: (channel, handler) => bus.subscribe(channel, handler),
    exceedsPayloadLimit: exceedsEventBusPayloadLimit,
  };
}

@Global()
@Module({
  providers: [
    { provide: NOTIFICATIONS_EVENT_BUS, inject: [EVENT_BUS], useFactory: notificationsEventBusOf },
    { provide: NOTIFICATIONS_METRICS, useExisting: AppMetricsService },
  ],
  exports: [NOTIFICATIONS_EVENT_BUS, NOTIFICATIONS_METRICS],
})
export class NotificationsHostModule {}
