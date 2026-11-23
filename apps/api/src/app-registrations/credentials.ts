// =============================================================================
// ShellKeep's credential purposes (issue #48)
// =============================================================================
//
// A credential's PURPOSE IS ALSO ITS AES-GCM SUB-KEY DOMAIN
// (`user:<userId>:<purpose>`): renaming a purpose orphans every secret stored
// under it. `ssh` is permanent.
//
//   ssh  a user's SSH secrets, one credential per field of a server profile
//        (`profile.<profileId>.password | private_key | passphrase`)
//
// NO FALLBACK, EVER: `system: null` and `fallback: []` mean the resolver never
// answers an SSH secret from an organization or deployment credential. A server
// profile's secret is its owner's alone (org-owned or group-shared servers,
// #71 and #35, use `OrgCredentialsService` with the same names).
//
// Registered at import time by `registrations.ts`, before the registries freeze
// at bootstrap.
// =============================================================================

import {
  registerCredentialPurpose,
  registerUserCredentialPurpose,
  type UserCredentialPurposeDef,
} from '@marinoscar/platform-api/credentials';

import { STORAGE_CREDENTIAL_PURPOSE_DEF } from '@marinoscar/platform-api/storage';

import { SSH_CREDENTIAL_PURPOSE } from '../server-profiles/ssh-credentials';

/** The user credential purposes ShellKeep stores (kinds of key a user brings). */
export const APP_USER_CREDENTIAL_PURPOSES: readonly UserCredentialPurposeDef[] = [
  {
    purpose: SSH_CREDENTIAL_PURPOSE,
    label: 'SSH credentials',
    description: 'Password, private key and passphrase of a saved server',
    system: null,
    fallback: [],
  },
];

let registered = false;

/** Registers the purposes. Idempotent per process (registering twice is `DUPLICATE_ID`). */
export function registerShellkeepCredentialPurposes(): void {
  if (registered) return;
  registered = true;
  // The deployment's object-storage secret access key (the storage slice's own definition, #50).
  registerCredentialPurpose(STORAGE_CREDENTIAL_PURPOSE_DEF);
  for (const def of APP_USER_CREDENTIAL_PURPOSES) registerUserCredentialPurpose(def);
}
