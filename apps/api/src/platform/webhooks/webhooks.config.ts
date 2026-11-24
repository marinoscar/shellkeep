// =============================================================================
// The webhooks slice, configured once (issue #54)
// =============================================================================
//
// `@marinoscar/platform-api/webhooks`: signed, outbound deliveries of platform and
// ShellKeep events to endpoints a member, an organization or the deployment
// registers (`/api/webhooks`, `/api/org/webhooks`, `/api/admin/webhooks`), through the
// job queue with retries and a circuit breaker.
//
// EVERY OPTION IS THE SLICE'S DEFAULT except the product name in the `User-Agent`:
// https only, no private, loopback or link-local targets, ports 80, 443, 8443 and
// 1024 and above, 20 consecutive failures open the circuit, 24 hours of secret
// overlap on a rotation, 30 days of delivery history. The SSRF guard stays ON.
// A deployment that must reach an internal receiver sets `allowedHosts` (one vouched
// host) or `allowPrivateTargets` (an on-premises network) HERE, in code, never in an
// environment variable; see docs/runbooks/webhooks.md.
//
// The three registrations that must precede composition live in the manifests:
// the signing-secret credential purposes (`app-registrations/credentials.ts`), the
// `webhook` notification channel and the endpoint-disabled email
// (`app-registrations/notifications.ts`) and the three metrics
// (`platform/host-app-metrics.ts`).
// =============================================================================

import { WebhooksModule } from '@marinoscar/platform-api/webhooks';

import { WebhooksHostModule } from './webhooks-host.module';

/** The slice, mounted once in `AppModule`. */
export const webhooksModule = WebhooksModule.forRoot({
  appName: 'shellkeep',
  imports: [WebhooksHostModule],
});
