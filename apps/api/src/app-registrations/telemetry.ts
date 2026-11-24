// =============================================================================
// This app's telemetry registrations (issue #53)
// =============================================================================
//
// What ShellKeep adds to the platform's telemetry slice, as pure data: no `register()`
// call, no Nest, no service import.
//
//   APP_METRICS        extra `app.*` instruments, registered by `platform/host-app-metrics.ts`
//                      after the platform's (counters and histograms are created by the
//                      metrics host and emitted with `add`/`record`; a gauge is declared here
//                      and created by its own provider).
//   APP_METRIC_GROUPS  extra Telemetry Dashboard groups, passed to
//                      `TelemetryModule.forRoot({ metricGroups })` after the six platform groups.
//
// Both are consumed before the registries freeze at bootstrap.
// =============================================================================

import type { AppMetricDef } from '@marinoscar/platform-api/otel-core';
import type { MetricGroupDef } from '@marinoscar/platform-api/telemetry';

import { TERMINAL_METRIC_GROUP } from '../terminal/telemetry/terminal.metric-group';
import { TERMINAL_APP_METRICS } from '../terminal/telemetry/terminal.metrics';

/** ShellKeep's own `app.*` metrics. */
export const APP_METRICS: readonly AppMetricDef[] = [...TERMINAL_APP_METRICS];

/** ShellKeep's own dashboard metric groups. */
export const APP_METRIC_GROUPS: readonly MetricGroupDef[] = [TERMINAL_METRIC_GROUP];
