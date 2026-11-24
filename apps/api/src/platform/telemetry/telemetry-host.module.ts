// =============================================================================
// The telemetry slice's host ports (issue #53)
// =============================================================================
//
//   TELEMETRY_AUDIT_SINK       -> AUDIT_SINK (the platform host's, over `audit_events`)
//   TELEMETRY_SETTINGS_STORE   -> telemetry-settings-store.adapter.ts
//   TELEMETRY_CREDENTIAL_STORE -> telemetry-credentials.adapter.ts (purpose `telemetry_greptime`)
//   TELEMETRY_JOBS             -> telemetry-jobs.adapter.ts (the platform queue)
//   TELEMETRY_AI               -> telemetry-ai.adapter.ts   (the platform AI slice, #55)
//   TELEMETRY_APP_INFO         -> telemetry-app-info.adapter.ts
//
// `CredentialsModule` is imported explicitly (it is not global, so the list of code
// that can read a plaintext secret stays visible in a diff). The settings, jobs and
// Prisma providers are global.
// =============================================================================

import { Module } from '@nestjs/common';
import { AUDIT_SINK } from '@marinoscar/platform-api/core';
import { CredentialsModule } from '@marinoscar/platform-api/credentials';
import {
  TELEMETRY_AI,
  TELEMETRY_APP_INFO,
  TELEMETRY_AUDIT_SINK,
  TELEMETRY_CREDENTIAL_STORE,
  TELEMETRY_JOBS,
  TELEMETRY_SETTINGS_STORE,
} from '@marinoscar/platform-api/telemetry';

import { AiModule } from '../ai/ai.config';
import { TelemetryAiAdapter } from './telemetry-ai.adapter';
import { TelemetryAppInfoAdapter } from './telemetry-app-info.adapter';
import { TelemetryCredentialsAdapter } from './telemetry-credentials.adapter';
import { TelemetryJobsAdapter } from './telemetry-jobs.adapter';
import { TelemetrySettingsStoreAdapter } from './telemetry-settings-store.adapter';

const PORTS = [
  { provide: TELEMETRY_AUDIT_SINK, useExisting: AUDIT_SINK },
  { provide: TELEMETRY_SETTINGS_STORE, useClass: TelemetrySettingsStoreAdapter },
  { provide: TELEMETRY_CREDENTIAL_STORE, useClass: TelemetryCredentialsAdapter },
  { provide: TELEMETRY_JOBS, useClass: TelemetryJobsAdapter },
  { provide: TELEMETRY_AI, useClass: TelemetryAiAdapter },
  { provide: TELEMETRY_APP_INFO, useClass: TelemetryAppInfoAdapter },
];

@Module({
  imports: [CredentialsModule, AiModule],
  providers: PORTS,
  exports: PORTS.map((port) => port.provide),
})
export class TelemetryHostModule {}
