// =============================================================================
// The platform credential stores (issue #48)
// =============================================================================
//
// `@marinoscar/platform-api/credentials` needs no host port of its own: it reaches
// the database through the core `PLATFORM_PRISMA` port bound in
// `platform/platform-host.module.ts`. What the app supplies is its purposes,
// registered at import time by `app-registrations/credentials.ts`, before the
// application bootstraps (the registries freeze then).
//
//   CredentialsModule      the deployment's secrets (the identity slice's sign-in
//                          providers read theirs from it; ShellKeep stores none yet)
//   UserCredentialsModule  a user's own secrets (SSH credentials, purpose `ssh`)
//   OrgCredentialsModule   an organization's secrets (unused until org-owned servers, #71)
//
// None is global: a module that reads a plaintext secret imports the module it
// needs, so every reader is a visible line. They are listed here so a broken
// provider graph fails at boot.
// =============================================================================

import {
  CredentialsModule,
  OrgCredentialsModule,
  UserCredentialsModule,
} from '@marinoscar/platform-api/credentials';

export const credentialsModules = [CredentialsModule, UserCredentialsModule, OrgCredentialsModule] as const;
