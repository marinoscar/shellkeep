// =============================================================================
// OpenTelemetry bootstrap: the FIRST import of `main.ts` (issue #53)
// =============================================================================
//
// Auto-instrumentation can only patch modules required AFTER `sdk.start()`, so
// `main.ts` imports this file before anything else. The bootstrap itself is the
// platform's (`@marinoscar/platform-api/otel-core/sdk`, a Nest-free entry); this
// file only hands it the app's identity:
//
//   - OTEL_ENABLED !== 'true': logs "OpenTelemetry disabled", installs nothing.
//     Every instrument and span is the API's no-op.
//   - OTEL_ENABLED === 'true': OTLP/HTTP traces, metrics (every 60 s) and logs to
//     OTEL_EXPORTER_OTLP_ENDPOINT (default http://localhost:4318), each behind the
//     runtime telemetry gate, which starts CLOSED: nothing is exported until the
//     `telemetry.enabled` system setting opens it. Health probes are not traced;
//     fs instrumentation is off. SIGTERM shuts the SDK down.
//
// Import the `sdk` subpath only, never the Nest-facing `otel-core` index.
// =============================================================================

import { initializeOtel } from '@marinoscar/platform-api/otel-core/sdk';

import { resolveServiceName, resolveTelemetryInstanceId } from './common/otel/telemetry-identity';

// Started on import; nothing needs the handle (SIGTERM shutdown is the SDK's own).
initializeOtel({
  serviceName: resolveServiceName(),
  // The instance id the gate stamps until the telemetry settings are read.
  instanceId: resolveTelemetryInstanceId(null),
});
