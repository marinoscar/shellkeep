// =============================================================================
// ShellKeep's credential purposes (issue #48)
// =============================================================================
//
// A credential's PURPOSE IS ALSO ITS AES-GCM SUB-KEY DOMAIN
// (`user:<userId>:<purpose>`): renaming a purpose orphans every secret stored
// under it. `ssh` is permanent.
//
//   smtp, email_ses, push_vapid  the deployment's mail and Web Push secrets (#51)
//   webhook_signing  an endpoint's signing secret, per tier (#54)
//   runbook_secret  an organization's runbook secret parameters (#61, org tier only)
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
  type CredentialPurposeDef,
  type UserCredentialPurposeDef,
} from '@marinoscar/platform-api/credentials';
import { TELEMETRY_GREPTIME_CREDENTIAL_PURPOSE } from '@marinoscar/platform-api/telemetry';

import { SES_CREDENTIAL_PURPOSE_DEF, SMTP_CREDENTIAL_PURPOSE_DEF } from '@marinoscar/platform-api/email';
import { PUSH_VAPID_CREDENTIAL_PURPOSE_DEF } from '@marinoscar/platform-api/notifications';
import { STORAGE_CREDENTIAL_PURPOSE_DEF } from '@marinoscar/platform-api/storage';
import {
  WEBHOOK_SIGNING_CREDENTIAL_PURPOSE_DEF,
  WEBHOOK_SIGNING_USER_CREDENTIAL_PURPOSE_DEF,
} from '@marinoscar/platform-api/webhooks';

import { RUNBOOK_SECRET_PURPOSE_DEF } from '../runbooks/runbooks.credentials';
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

/**
 * The deployment credential purposes ShellKeep stores (#53): the telemetry slice's two GreptimeDB
 * passwords (`reader`, `admin`), saved from the admin telemetry page and held only in the
 * deployment tier. The `GREPTIME_*` environment values are just the deployment default.
 */
export const APP_CREDENTIAL_PURPOSES: readonly CredentialPurposeDef[] = [
  {
    purpose: TELEMETRY_GREPTIME_CREDENTIAL_PURPOSE,
    owner: 'telemetry',
    label: 'GreptimeDB passwords',
    tiers: ['system'],
  },
];

let registered = false;

/** Registers the purposes. Idempotent per process (registering twice is `DUPLICATE_ID`). */
export function registerShellkeepCredentialPurposes(): void {
  if (registered) return;
  registered = true;
  // The deployment's object-storage secret access key (the storage slice's own definition, #50).
  registerCredentialPurpose(STORAGE_CREDENTIAL_PURPOSE_DEF);
  // The email slice's two transports and the notifications slice's Web Push key (#51), all
  // configured at runtime in the admin UI: the SMTP password, the SES access key pair and the
  // VAPID private key. Never an environment variable.
  registerCredentialPurpose(SMTP_CREDENTIAL_PURPOSE_DEF);
  registerCredentialPurpose(SES_CREDENTIAL_PURPOSE_DEF);
  registerCredentialPurpose(PUSH_VAPID_CREDENTIAL_PURPOSE_DEF);
  // The organization's runbook secret parameters (#61): write-only, org tier only.
  registerCredentialPurpose(RUNBOOK_SECRET_PURPOSE_DEF);
  for (const def of APP_CREDENTIAL_PURPOSES) registerCredentialPurpose(def);
  for (const def of APP_USER_CREDENTIAL_PURPOSES) registerUserCredentialPurpose(def);
  // Webhook signing secrets (#54): the deployment's and an organization's tier, then a member's own.
  // Each endpoint's secret is one credential under this purpose; it is shown twice in its life
  // (create, rotate) and never listed, logged or put in a payload.
  registerCredentialPurpose(WEBHOOK_SIGNING_CREDENTIAL_PURPOSE_DEF);
  registerUserCredentialPurpose(WEBHOOK_SIGNING_USER_CREDENTIAL_PURPOSE_DEF);
}
