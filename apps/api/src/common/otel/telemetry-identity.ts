// =============================================================================
// This app's telemetry identity (issue #53)
// =============================================================================
//
// The resolvers live in `@marinoscar/platform-api/otel-core/sdk`, which knows no
// product identity. This file binds them to the app's, ONCE, so every surface that
// names the service or the instance (the SDK resource in `instrumentation.ts`,
// `otel.serviceName` in `config/configuration.ts`, the telemetry app-info port)
// agrees by construction.
//
//   service.name     `OTEL_SERVICE_NAME`, else `shellkeep-api`
//   app.instance.id  the `telemetry.instanceId` setting, else `shellkeep`
//
// THE GATE STARTS AT THE SLUG, so the first exported batch is never unlabelled.
//
// SAFE TO IMPORT BEFORE THE SDK STARTS: `instrumentation.ts` imports it ahead of
// `initializeOtel()`. It reads only the Nest-free `sdk` subpath, nothing that the
// auto-instrumentation patches. Keep it that way.
// =============================================================================

import {
  ATTR_APP_INSTANCE_ID,
  resolveServiceName as resolvePlatformServiceName,
  resolveTelemetryInstanceId as resolvePlatformInstanceId,
  telemetryGate,
} from '@marinoscar/platform-api/otel-core/sdk';

/** The product slug (`packages/shared/identity.json` `cliName`): the default `app.instance.id`. */
export const APP_SLUG = 'shellkeep';

export { ATTR_APP_INSTANCE_ID };

/** The service name this process reports to OpenTelemetry: `OTEL_SERVICE_NAME`, else `shellkeep-api`. */
export function resolveServiceName(): string {
  return resolvePlatformServiceName(`${APP_SLUG}-api`);
}

/** The instance id telemetry is stamped with: the administrator's `telemetry.instanceId`, else the slug. */
export function resolveTelemetryInstanceId(configured: string | null | undefined): string {
  return resolvePlatformInstanceId(configured, APP_SLUG);
}

telemetryGate.setInstanceId(resolveTelemetryInstanceId(null));
