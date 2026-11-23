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
//   USER_DEFAULTS             -> the composed user-settings defaults
//
// IDENTITY_METRICS, IDENTITY_EVENT_BUS and IDENTITY_AUTH_CREDENTIALS are
// deliberately UNBOUND: the ports are optional (identity then records no
// metrics, invalidates its principal cache in this process only, and Google
// reads the environment). They are bound by #46 (host) and #48 (credentials).
//
// Each shim is listed in docs/platform-adoption/local-exceptions.md with the
// issue that removes it.
// =============================================================================

import { Global, Module } from '@nestjs/common';
import {
  IDENTITY_JOBS,
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
];

@Global()
@Module({
  providers: PORTS,
  exports: PORTS.map((port) => port.provide),
})
export class IdentityHostModule {}
