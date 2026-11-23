// =============================================================================
// Identity's host ports, bound to ShellKeep (issue #47)
// =============================================================================
//
// The identity slice reaches the app through ports. This module binds them. It
// must be `@Global()`: the slice's `JwtAuthGuard` is instantiated in EVERY module
// whose controllers use `@Auth()`, so the ports it injects have to resolve there.
//
//   IDENTITY_NOTIFIER         -> log only               PLATFORM-ADOPTION-SHIM(#51)
//   IDENTITY_JOBS             -> in-process handlers    PLATFORM-ADOPTION-SHIM(#49)
//   IDENTITY_NODE_CREDENTIALS -> resolves nothing       PLATFORM-ADOPTION-SHIM(#49)
//   IDENTITY_PROFILE_IMAGES   -> the stored `profile` user setting
//   USER_DEFAULTS             -> the platform's core defaults plus the app's initial namespaces
//   IDENTITY_AUTH_CREDENTIALS -> the deployment credential store (#48)
//   IDENTITY_METRICS          -> the host core's AppMetricsService (#46)
//   IDENTITY_EVENT_BUS        -> the host core's event bus (#46)
//
// Google still reads the environment: the credential store backs only a provider
// that keeps its secrets in it.
//
// Each shim is listed in docs/platform-adoption/local-exceptions.md with the
// issue that removes it.
// =============================================================================

import { Global, Module } from '@nestjs/common';
import { CredentialsModule, CredentialsService } from '@marinoscar/platform-api/credentials';
import { AppMetricsService, EVENT_BUS } from '@marinoscar/platform-api/host';
import {
  IDENTITY_AUTH_CREDENTIALS,
  IDENTITY_EVENT_BUS,
  IDENTITY_JOBS,
  IDENTITY_METRICS,
  IDENTITY_NODE_CREDENTIALS,
  IDENTITY_NOTIFIER,
  IDENTITY_PROFILE_IMAGES,
  USER_DEFAULTS,
} from '@marinoscar/platform-api/identity';

import { IdentityJobsAdapter } from './identity-jobs.adapter';
import { IdentityNodeCredentialsAdapter } from './identity-node-credentials.adapter';
import { IdentityNotifierAdapter } from './identity-notifier.adapter';
import { ShellkeepProfileImages, ShellkeepUserDefaults } from './identity-user.adapters';

const PORTS = [
  { provide: IDENTITY_NOTIFIER, useClass: IdentityNotifierAdapter },
  { provide: IDENTITY_JOBS, useClass: IdentityJobsAdapter },
  { provide: IDENTITY_NODE_CREDENTIALS, useClass: IdentityNodeCredentialsAdapter },
  { provide: USER_DEFAULTS, useClass: ShellkeepUserDefaults },
  { provide: IDENTITY_PROFILE_IMAGES, useClass: ShellkeepProfileImages },
  { provide: IDENTITY_AUTH_CREDENTIALS, useExisting: CredentialsService },
  { provide: IDENTITY_METRICS, useExisting: AppMetricsService },
  { provide: IDENTITY_EVENT_BUS, useExisting: EVENT_BUS },
];

@Global()
@Module({
  imports: [CredentialsModule],
  providers: PORTS,
  exports: PORTS.map((port) => port.provide),
})
export class IdentityHostModule {}
